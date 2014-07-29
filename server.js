var express = require('express')
  , bodyParser = require('body-parser')
  , expressValidator = require('express-validator')
  , session = require('cookie-session')
  , namespace = require('express-namespace')
  , URL = require('url')

config = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://@localhost/connect_dev',
  USER_TABLE : '_users',
  ROLE_TABLE : '_roles',
  ACCESS_TABLE : '_access_control',
  MASTER_API_USER : 'admin',
  MASTER_API_KEY : 'secret',
  USER_USERNAME_COL : 'username',
  USER_EMAIL_COL : 'email',
  SUPERUSER_ROLE : 'superuser',
  USER_CRYPTED_PASSWORD_COL: 'crypted_password',
  OK_RESULT: JSON.stringify({result: "OK"})
}

var knex = require('knex')({
	client: 'pg',
  debug: false,
	connection: config.DATABASE_URL
});

u = URL.parse(config.DATABASE_URL);
knex.client.connectionSettings = {user: '', database: u.path.substring(1), port: u.port, host: u.host};

var DBUtil = require('./dbutil')(config, knex);
var auth = require('./auth')(config, knex, DBUtil);
var db = require('./db')(config, knex, DBUtil, auth);

DBUtil.ensure_user_table();
DBUtil.ensure_role_table();
DBUtil.ensure_access_table();

var app = express();
app.use(function(req, res, next) {
  if (req.headers['content-type'] == undefined && req.body) {
    req.headers['content-type'] = 'application/json';
  }
  next();
});
app.use(bodyParser());
app.use(expressValidator());
app.use(session(
    {
        secret: process.env.COOKIE_SECRET || "93HIEH88312KSJS9(&F"
    }));

app.use(function(req, res, next){
  //console.log("HEADERS: ", req.headers);
  //console.log('%s %s', req.method, req.url);
  //console.log("BODY: ", req.body);
  next();
});
app.use(auth.load_user);


app.post('/register', auth.register);
app.post('/login', auth.login);
app.post('/logout', auth.logged_in, auth.logout);

app.post('/roles/:role', auth.has_role(['superuser', 'admin']), auth.create_role);
app.delete('/roles/:role/:user_id', auth.has_role(['superuser', 'admin']), auth.delete_role);

app.get('/me', auth.logged_in, auth.me);


// Database

app.get(   '/tables', auth.has_role(['superuser', 'admin']), db.tables);
app.post(  '/tables/:table/\\$acl', auth.has_role(['superuser','admin']), db.create_acl);
app.get(   '/tables/:table/\\$acl', auth.has_role(['superuser','admin']), db.get_acl);
app.delete('/tables/:table/\\$acl/:level', auth.has_role(['superuser','admin']), db.delete_acl);

app.get(   '/tables/:table/\\$meta', db.schema);
app.post(  '/tables/:table/\\$meta', db.create_table);
app.get(   '/tables/:table',         db.select);
app.get(   '/tables/:table/:pk',     db.find);
app.post(  '/tables/:table',         db.create);
app.post(  '/tables/:table/:pk',     db.update);
app.delete('/tables/:table/:pk',     db.delete);


app.use('*', function(req, res, next) {
  var err = new Error("Page not found");
  err.status = 404;
  next(err);
});
app.use(function(err, req, res, next){
  console.error(err.stack);
  res.json(500, {error: err.message, status:err.status});
});

function errorHandler(err, req, res, next) {
  res.json(500, { error: err });
}

var port = Number(process.env.PORT || 3000);

var server = app.listen(port, function() {
    console.log('Listening on port %d', server.address().port);
});

module.exports = {server: server, knex: knex, config:config};

