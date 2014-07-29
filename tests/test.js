// Test sqlrest
process.env.DATABASE_URL = "postgres://@localhost/sqlrest_test";
var knex = require('knex')({
	client: 'pg',
  	connection: process.env.DATABASE_URL
});

main = require('../server')

var request = require('supertest')
var should = require('should')

function debug(done) {
	return function(err, res) {
		if (err) {
	  		console.log("Error: ", err);
	  		console.log("Response: ", res.text);
		}
		if (done) {
			done();
		}
	}
}

describe('authentication endpoints', function(){
  agent = request.agent(main.server);
  master_agent = request.agent(main.server);

  var user1;
  var cookie;

  it('clears the old db', function(done) {
  	knex(main.config.USER_TABLE).del().then(function() {
  		return knex(main.config.ROLE_TABLE).del();
  	}).then(function() {
  		return 	knex(main.config.ACCESS_TABLE).del();
  	}).then(function() {
  		return 	knex.schema.dropTableIfExists('sent_emails');
  	}).then(function() {
  		done()
  	});
  });

  // *************** Authentication

  it('registers a new user', function(done){
  	agent
  	.get('/me')
  	.expect(401);
  	
  	agent
  	.post('/register')
  	.send({email:'tester5@test.com', password:'secret'})
  	.set('Content-Type', 'application/json')
  	.expect(200, debug(done));
  });

  it('returns 401 on bad login', function(done) {
  	agent
  	.post('/login')
  	.send({email:'foobar', password:'wrong'})
  	.set('Content-Type', 'application/json')
  	.expect(401, debug(done));
  });

  it('can login', function(done) {
  	agent
  	.post('/login')
  	.send({email:'tester5@test.com', password:'secret'})
  	.set('Content-Type', 'application/json')
   	.expect(200, function(err, res) {
     		should.exist(res.headers['set-cookie']);
     		cookie = res.headers['set-cookie'];
     		done();
     });
  });

  it('can logout', function(done) {
    agent
    .post('/logout')
    .send({})
    .expect(200, function(err, res) {
      res.headers['set-cookie'][0].should.containEql('express:sess=;');

      agent
      .get('/me')
      .set('cookie', '') // Superagent doesn't seem to forget the cookies properly
      .expect(401, debug(done));
    });
  });

  it('can login again', function(done) {
    agent
    .post('/login')
    .send({email:'tester5@test.com', password:'secret'})
    .set('Content-Type', 'application/json')
    .expect(200, function(err, res) {
        should.exist(res.headers['set-cookie']);
        cookie = res.headers['set-cookie'];
        done();
     });
  });

  it('can get user info', function(done) {
  	agent
  	.get('/me')
  	.expect(200, function(err, res) {
  		user1 = res.body;
      user1.should.have.property('email');
      user1.should.have.property('id');
  		done();
  	});
  });

  // *************** Roles

  it('fails if user tries to make themselves an admin', function(done) {
  	agent
  	.post('/roles/admin')
  	.send({user_id: user1.id})
  	.set('Content-Type', 'application/json')
  	.expect(403, debug(done));
  });

  it('superuser can make a user an admin', function(done) {
  	master_agent
  	.post('/roles/admin')
  	.send({user_id: user1.id})
  	.set('Authorization', main.config.MASTER_API_KEY)
  	.expect(200, debug(done));
  });

  it('and user now has admin role', function(done) {
    agent
    .get('/me')
    .expect(200, function(err, res) {
      res.body.should.have.property('roles');
      res.body.roles.should.containEql('admin');
      done();
    });
  });

  it('admin user can create a new table', function(done) {
  	agent
  	.post('/tables/sent_emails/$meta')
  	.send({"id":"key", receiver:"string,50", send_date:"dateTime", count:"integer"})
  	.expect(200, debug(done));
  });

  it('returns an error if you try to create a table again', function(done) {
  	agent
  	.post('/tables/sent_emails/$meta')
  	.send({"id":"key", receiver:"string,50", send_date:"dateTime", count:"integer"})
  	.expect(500, debug(done));
  });

  it('returns the table schema if admin', function(done) {
  	agent
  	.get('/tables/sent_emails/$meta')
  	.expect(200, function(err, res) {
  		res.body.should.have.property('id');
  		res.body.should.have.property('receiver');
  		res.body.should.have.property('send_date');
  		res.body.should.have.property('count');
  		done();
  	});
  });

  it('can insert rows into new table', function(done) {
  	agent
  	.post('/tables/sent_emails')
  	.send({receiver:'scottp@heroku.com', count:5, send_date:"2014-08-08"})
  	.expect(200, debug(done));

  });

  it('can remove admin role from user', function(done) {
    master_agent
    .delete('/roles/admin/' + user1.id)
    .set('Authorization', main.config.MASTER_API_KEY)
    .expect(200, done);
  });

  it('can return an error trying to insert without admin role', function(done) {
    agent
    .post('/tables/sent_emails')
    .send({receiver:'scottp2@heroku.com', count:5, send_date:"2014-08-08"})
    .expect(403, debug(done));
  });

  // **************** User-role permissions

  it('superuser can assign create user perms on sent_emails table', function(done) {
    master_agent
    .post('/tables/sent_emails/$acl')
    .send({user: 'read,write,list', user_column: 'owner_id'})
    .set('Authorization', main.config.MASTER_API_KEY)
    .expect(200, function(err, res) {
      // and table schema contains owner_id column now
      agent
      .get('/tables/sent_emails/$meta')
      .expect(200, function(err, res) {
        res.body.should.have.property('owner_id');
        done();
      });
    });
  });

  it('inserted records are tagged by the user id', function(done) {
    agent
    .post('/tables/sent_emails')
    .send({receiver:"joe@joesamp.com", send_date:"2014-12-12"})
    .expect(200, function(err, res) {
      res.body.should.have.property('id');
      var id = res.body.id;
      agent
      .get('/tables/sent_emails/' + id)
      .expect(200, function(err, res) {
        var record = res.body;
        record.should.have.property('owner_id');
        should.exist(record['owner_id']);
        record['owner_id'].should.equal(user1.id);
        done();
      });
    });
  });


  it('only records owned by user are returned', function(done) {
    master_agent
    .post('/tables/sent_emails')
    .send({receiver:"master@joesamp.com", send_date:"2014-12-13"})
    .set('Authorization', main.config.MASTER_API_KEY)
    .expect(200, function(err, res) {
      master_agent
      .get('/tables/sent_emails')
      .set('Authorization', main.config.MASTER_API_KEY)
      .expect(200, function(err, res) {
        res.body.length.should.be.greaterThan(1);

        // Now query as user
        agent
        .get('/tables/sent_emails')
        .expect(200, function(err, res) {
          var records = res.body;
          records.length.should.be.greaterThan(0);
          var other_records = res.body.filter(function(row) {return row.owner_id != user1.id});
          other_records.length.should.equal(0);
          done();
        });
      });
    });
  });



});

