var Promise = require("bluebird");
var extend = require('util')._extend;

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
			var table = req.params.table;

			Promise.map(Object.keys(perms), function(level) {
				var p = perms[level];
				if (level == 'user_column' || level=='group_column') {
					return '';
				}
				return knex(config.ACCESS_TABLE).
					where({table_name:table, level:level}).
					del().then(function() {
						return knex(config.ACCESS_TABLE).
							returning('id').
							insert({table_name:table, 
								    level:level,
									read: p.indexOf('read') != -1 || p == 'all', 
									write: p.indexOf('write') != -1 || p == 'all', 
									list: p.indexOf('list') != -1 || p == 'all',
									user_column: level == 'user' ? perms['user_column'] : null,
									group_column: level == 'group' ? perms['group_column'] : null
								    }).then(function(rows) {
								    	if (level == 'user' && perms['user_column']) {
								    		DB.ensure_column(table, perms['user_column'], function() {
								    		});
								    	}
										return "Inserted perm";
									}).catch(function(err) {
										return err;
									});
					});
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

		schema: function(req, res) {
			var table = req.params.table;
			_user_authorized_for_table(req, res, table, 'read', function() {
				knex(table).columnInfo().then(function(schema) {
					res.json(schema);
				})
			});
		},

		create_table: function(req, res, next) {
			var table = req.params.table;
			knex.schema.hasTable(table).then(function(exists) {
				if (!exists) {
					knex.schema.createTable(table, function(table) {
						for (col in req.body) {
							var ctype = req.body[col];
							if (ctype == 'key') {
								table.increments(col);
							} else {
								var parts = ctype.split(",");
								var coldef = '';
								if (parts.length > 1) {
									coldef = "table." + parts[0] + "('" + col + "', " + parts[1] + ")";
								} else {
									coldef = "table." + parts[0] + "('" + col + "')";
								}
								//console.log(coldef);
								eval(coldef);
							}
						}
					}).then(function() {
						res.json({result: "Table created"});
					}).catch(function(err) {
						next(err);
					});
				} else {
					res.send(500, {error: "Table already exists"});
				}
			});
		},

		select: function(req, res) {
			var table = req.params.table;
			var where = {};
			table_perms(table, 'list', 'user', function(rows) {
				var owner_id = null;
				if (rows.length > 0 && rows[0].user_column && !req.user.is_admin && !req.user.is_superuser) {
					where[rows[0].user_column] = req.user.id;
				}
				_user_authorized_for_table(req, res, table, 'list', function() {
					knex.select('*').
						from(table).
						where(where).
						then(function(rows) {
							res.json(rows);
						}).catch(function(err) {
							throw err;
						});	
				});
			});
		},

		find: function(req, res) {
			var table = req.params.table;
			var pk = req.params.pk;
			_user_authorized_for_table(req, res, table, 'read', function() {
				knex.select('*').
					from(table).
					where({id: pk}).
					then(function(rows) {
						res.json(rows[0]);
					}).catch(function(err) {
						throw err;
					});	
			});
		},

		create: function(req, res, next) {
			var table = req.params.table;
			var record = req.body;

			table_perms(table, 'write', 'user', function(rows) {
				if (rows.length > 0 && rows[0].user_column) {
					record[rows[0].user_column] = req.user.id;
				}
				_user_authorized_for_table(req, res, table, 'write', function() {
					return knex(table).
						returning('id').
						insert(record).
						then(function(rows) {
							var pkg = extend({id: rows[0]}, req.body);
							res.json(pkg);
						}).catch(function (err) {
							next(err);
						});
				});
			})
		},

		update: function(req, res) {
			var table = req.params.table;
			var pk = req.params.pk;
			_user_authorized_for_table(req, res, table, 'write', function() {
				knex(table).
					where({id: pk}).
					update(req.body).
					then(function(rows) {
						if (rows == 0) {
							res.json(404, {error: "Record not found"})
						} else {
							res.json({result: rows + " records updated"});
						}
					}).catch(function(err) {
						throw err;
					});	
			});
		},

		delete: function(req, res) {
			var table = req.params.table;
			var pk = req.params.pk;
			_user_authorized_for_table(req, res, table, 'write', function() {
				knex(table).
					where({id: pk}).
					del().then(function(row) {
						res.json({result: "Record deleted"});
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
					where[operation] = true;
					return knex.select('level').
						from(config.ACCESS_TABLE).
						where(where).
						then(function(rows) {
							levels = rows.map(function(row) {return row.level});
							//console.log("Access level query returned ", levels);
							if (levels.length == 0) {
								return res.json(403, {error: "Forbidden"});
							}
							if (levels.indexOf('world') != -1) {
								return callback();
							} else if (user != null && (levels.indexOf('guest') != -1 || levels.indexOf('user') != -1)) {
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

	// @param level - optional level to filter on
	// @param callback - callback when done
	function table_perms(table, operation, level, callback) {
		if (callback == undefined) {
			callback = level;
			level = null;
		}
		var where = {table_name:table};
		where[operation] = true;
		if (level) {
			where['level'] = level;
		}
		knex.select('*')
		.from(config
		.ACCESS_TABLE)
		.where(where)
		.then(function(rows) {
			callback(rows);
		});
	}

}
