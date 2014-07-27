var Promise = require("bluebird");

module.exports = function DB(config, knex) {
	return {
		ensure_user_table : function () {
			return knex.schema.hasTable(config.USER_TABLE).then(function(exists) {
				if (!exists) {
					console.log("Creating users table " + config.USER_TABLE);
					knex.schema.createTable(config.USER_TABLE, function(table) {
						table.increments('id');
						table.string('username', 255).unique();
						table.string('email', 255).unique();
						table.string('crypted_password', 255);
						table.string('salt', 255);
					}).catch(function(err) {
						throw err;
					});
				}
			});
		},

		ensure_role_table : function () {
			return knex.schema.hasTable(config.ROLE_TABLE).then(function(exists) {
				if (!exists) {
					console.log("Creating role table " + config.ROLE_TABLE);
					knex.schema.createTable(config.ROLE_TABLE, function(table) {
						table.integer('user_id').unsigned();
						table.string('role', 255);
						table.primary(['user_id', 'role']);
					}).catch(function(err) {
						throw err;
					});
				}
			});
		},

		ensure_access_table : function () {
			return knex.schema.hasTable(config.ACCESS_TABLE).then(function(exists) {
				if (!exists) {
					console.log("Creating access_control table " + config.ACCESS_TABLE);
					knex.schema.createTable(config.ACCESS_TABLE, function(table) {
						table.increments('id');
						table.string('table_name', 255);
						table.string('level', 128);
						table.boolean('read').defaultTo('false');
						table.boolean('write').defaultTo('false');
						table.boolean('list').defaultTo('false');
					}).catch(function(err) {
						throw err;
					});
				}
			});
		}



	}
}

