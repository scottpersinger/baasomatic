var Promise = require("bluebird");

module.exports = function db(config, knex, DB, Auth) {
	return {
		tables: function(req, res) {
			knex('information_schema.tables').
				select('table_name').
				where({table_schema:'public'}).
				then(function(rows) {
						res.json(rows.map(function(row) {return row.table_name}));
					});
		},

		create_acl: function(req, res) {
			console.log(req.body);
			var perms = req.body; // send a list of perm dicts
			var inserts = [];
			var messages = [];

			Promise.map(Object.keys(perms), function(level) {
				var p = perms[level];
				//if (["user","guest","world"].indexOf(level) == -1 && level.indexOf('role.') != 0) {
				//	return "Bad level parameter '" + level + "'";
				//} else {
					return knex(config.ACCESS_TABLE).
						where({table_name:req.params.table, level:level}).
						del().then(function() {
							return knex(config.ACCESS_TABLE).
								returning('id').
								insert({table_name:req.params.table, 
									    level:level,
										read: p.indexOf('read') != -1 || p == 'all', 
										write: p.indexOf('write') != -1 || p == 'all', 
										list: p.indexOf('list') != -1 || p == 'all'}).then(function(rows) {
											return "Inserted perm '" + level + "'";
										}).catch(function(err) {
											return err;
										});
						});
				//}				
			}).then(function(msgs) {
				res.json({messages: msgs});
			}).catch(function(err) {
				res.send(500, err);
			});
		},

		get_acl: function(req, res) {
			knex.select('*').
				from(config.ACCESS_TABLE).
				where({table_name:req.params.table}).
				then(function(rows) {
					res.json(rows.map(function(row) {
						var p = [];
						if (row.read) {
							p.push('read');
						}
						if (row.write) {
							p.push('write');
						}
						if (row.list) {
							p.push('list');
						}
						var r = {};
						r[row.level] = p.join(",")
						return r;
					}));
				});
		},

		delete_acl: function(req, res) {
			var level = req.params.level;
			knex(config.ACCESS_TABLE).
				where({table_name: req.params.table, level: level}).
				delete().then(function() {
					res.json(config.OK_RESULT);
				});
		},

		select: function(req, res) {
			var table = req.params.table;
			_user_authorized_for_table(req, res, table, 'list', function() {
				knex.select('*').
					from(table).
					then(function(rows) {
						res.json(rows);
					}).catch(function(err) {
						throw err;
					});	
			});
		},

		find: function(req, res) {
			var table = req.params.table;
			var pk = req.params.pk;
			_user_authorized_for_table(req, res, table, 'list', function() {
				knex.select('*').
					from(table).
					where({id: pk}).
					then(function(rows) {
						res.json(rows);
					}).catch(function(err) {
						throw err;
					});	
			});
		}

	}

	// =================================
	// INTERNAL ACCESS CONTROL FUNCTIONS
	// =================================

	//
	// @param operation - one of 'read','write','list'
	// @param callback - called with a single boolean indicating status
	function _user_authorized_for_table(req, res, table, operation, callback) {
		var user = req.user;
		if (user.is_superuser) {
			return callback();
		} else {
			Auth.check_has_role(user, "admin", function(result) {
				if (result) {
					return callback();
				} else {
					// Load acl's for the table
					where = {table_name: table};
					where[operation] == true
					return knex.select('level').
						from(config.ACCESS_TABLE).
						where(where).
						then(function(rows) {
							levels = rows.map(function(row) {return row.level});
							if (levels.length == 0) {
								return res.json(403, {error: "Forbidden"});
							}
							if (levels.indexOf('world') != -1) {
								return callback();
							} else if (user != null && levels.indexOf('guest') != -1) {
								return callback();
							} else {
								Auth.check_has_role(user, levels, function(result) {
									if (result) {
										callback();
									} else {
										return res.json(403, {error: "Forbidden"});
									}
								});
							}

						}).catch(function(err) {
							throw err;
						});
				}
			});
		} 
	}

}
