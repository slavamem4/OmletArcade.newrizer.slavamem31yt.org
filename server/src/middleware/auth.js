'use strict';
/**
 * Auth middleware. `required` rejects; `optional` attaches when a valid token
 * is present and stays silent otherwise (used by the lobby, which is readable
 * while signed out but personalised when signed in).
 */
const auth = require('../security/auth');
const { forbidden } = require('../errors');

function required() {
  return async (req, res, next) => {
    try {
      await auth.loadUser(req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

function optional() {
  return async (req, res, next) => {
    try {
      await auth.loadUser(req);
    } catch {
      req.user = null;
    }
    next();
  };
}

function admin() {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'mod')) {
      next(forbidden('This area is for moderators'));
      return;
    }
    next();
  };
}

module.exports = { required, optional, admin };
