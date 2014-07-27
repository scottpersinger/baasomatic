function User(id) {
	this.id = id;
}

module.exports = function Auth(config, knex, DB) {
	function _has_superuser_header(headers) {
		return headers.authorization && headers.authorization == config.MASTER_API_KEY;
	}

	function _has_role(user, roles, callback) {
		console.log("HAS ROLES, ", roles);
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
			console.log("Packet ", packet);
			knex(config.USER_TABLE).returning('id').insert(packet).then(function(rows) {
				console.log(rows);
				return res.json({user_id: rows[0]});
			}).catch(function(err) {
				res.json(500, {error: err});
			});
		},

		load_user: function(req, res, next) {
			if (req.session && req.session.user_id) {
				req.user = new User(req.session.user_id);
				req.user.is_superuser = _has_superuser_header(req.headers);
			} else {
				req.user = null;
			}
			next();
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
     		res.send(config.OK_RESULT);
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
				res.json(config.OK_RESULT);
			});
		},

		has_role: function(roles) {
			return function(req, res, next) {
				if (roles.indexOf(config.SUPERUSER_ROLE) >= 0 && 
					_has_superuser_header(req.headers)) {
					return next();
				}
				_has_role(req.user, roles, function(flag) {
					if (flag) {
						next();
					} else {
						return res.json(401, {error: "Not authorized"});
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
				res.json(401, {error: "Not authorized"});
			}
		},

		is_superuser: function(req, res, next) {
			if (req.is_superuser) {
				return next();
			} else if (this._has_superuser_header(req.headers)) {
				req.is_superuser = true;
				return next();
			} else {
				return res.json(401, {error: "Unauthorized"});
			}
		},

		me: function(req, res, next) {
			if (req.session.user_id) {
				knex.select('*').
					from(config.USER_TABLE).
					where({id: req.session.user_id}).
					then(function(rows) {
						if (rows.length > 0) {
							rows[0][config.USER_CRYPTED_PASSWORD_COL] = '****';
							return res.json(rows[0]);
						} else {
							return res.send(404, "Not found");
						}
					});
			} else {
				res.send(401, "Not logged in");
			}
		}
	}
}

