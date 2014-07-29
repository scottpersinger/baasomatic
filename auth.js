function User(id) {
	this.id = id;
}

module.exports = function Auth(config, knex, DB) {
	function _has_superuser_header(headers) {
		return headers.authorization && headers.authorization == config.MASTER_API_KEY;
	}

	function _has_role(user, roles, callback) {
		if (roles.indexOf(config.SUPERUSER_ROLE) != -1 && user.is_superuser) {
			callback(true);
		}
		knex.select('user_id').
			from(config.ROLE_TABLE).
			where({user_id : user.id}).
			whereIn('role', roles).then(function(rows) {
				if (rows.length > 0) {
					callback(true);
				} else {
					callback(false);
				}
			});
	}


	return {
		register: function(req, res, next) {
			var packet = {};
			if (req.body.username) {
				packet[config.USER_USERNAME_COL] = req.body.username;
			}
			packet[config.USER_EMAIL_COL] = req.body.email;
			packet[config.USER_CRYPTED_PASSWORD_COL] = req.body.password;
			knex(config.USER_TABLE).returning('id').insert(packet).then(function(rows) {
				return res.json({user_id: rows[0]});
			}).catch(function(err) {
				res.json(500, {error: err});
			});
		},

		load_user: function(req, res, next) {
			if (req.session && req.session.user_id) {
				req.user = new User(req.session.user_id);
				req.user.is_superuser = _has_superuser_header(req.headers);
			} else if (_has_superuser_header(req.headers)) {
				req.user = new User(0);
				req.user.is_superuser = true;
			} else {
				req.user = null;
			}
			if (req.user) {
				_has_role(req.user, ['admin'], function(result) {
					req.user.is_admin = result;
					next();
				})
			} else {
				next();
			}
		},

		login : function (req, res) {
			DB.ensure_user_table().then(function() {
				var q = {};
				q[config.USER_EMAIL_COL] = req.body.email;
				q[config.USER_CRYPTED_PASSWORD_COL] = req.body.password;
				knex.select('*').
					from(config.USER_TABLE).
					where(q).
					then(function(rows) {
						if (rows.length > 0) {
							req.session.user_id = rows[0].id;
							res.send(config.OK_RESULT);
						} else {
							res.json(401, {error: "Not authorized"});
						}
					});
			}).catch(function(err) {
				res.send(err);
			});
		},

		logout: function(req, res) {
			req.session = null;
     		res.json(config.OK_RESULT);
		},

		create_role: function(req, res) {
			user_id = req.body.user_id;
			if (req.params.role == config.SUPERUSER_ROLE) {
				return res.json(500, {error: "Cannot create superuser role"});
			}
			packet = {user_id: user_id, role: req.params.role};
			knex(config.ROLE_TABLE).returning('user_id').insert(packet).then(function(rows) {
				res.json(config.OK_RESULT);
			}).catch(function(err) {
				res.json(500, {error: err});
			});
		},

		delete_role: function(req, res) {
			var role = req.params.role;
			var user_id = req.params.user_id;
			knex(config.ROLE_TABLE).where({user_id:user_id}).del().then(function(rows) {
				if (rows[0] > 0) {
					res.json({result: "Role deleted"});
				} else {
					res.json({result: "Role not found"});
				}
			})
		},

		has_role: function(roles) {
			return function(req, res, next) {
				if (roles.indexOf(config.SUPERUSER_ROLE) >= 0 && 
					_has_superuser_header(req.headers)) {
					return next();
				}
				if (!req.user) {
					return res.json(401, {error: "Must login"});
				}
				_has_role(req.user, roles, function(flag) {
					if (flag) {
						next();
					} else {
						return res.json(403, {error: "Forbidden"});
					}
				});
			}
		},

		check_has_role: function(user, roles, callback) {
			return _has_role(user, roles, callback);
		},

		logged_in: function(req, res, next) {
			if (req.session && req.session.user_id) {
				next();
			} else {
				return res.json(401, {error: "Not authorized"});
			}
		},

		me: function(req, res, next) {
			if (req.session.user_id) {
				knex.select('role').
					from(config.ROLE_TABLE).
					where({user_id: req.user.id}).
					then(function(roles) {
						roles = roles.map(function(row) {return row.role});
						knex.select('*').
							from(config.USER_TABLE).
							where({id: req.session.user_id}).
							then(function(rows) {
								if (rows.length > 0) {
									rows[0][config.USER_CRYPTED_PASSWORD_COL] = '****';
									rows[0]['roles'] = roles;
									return res.json(rows[0]);
								} else {
									return res.send(404, "Not found");
								}
							});
					})
			} else {
				res.send(401, "Not logged in");
			}
		}
	}
}

