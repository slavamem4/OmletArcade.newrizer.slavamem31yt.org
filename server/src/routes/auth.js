'use strict';
/**
 * /api/auth
 *
 * Brute-force defence lives here rather than in the generic limiter: the
 * per-account failure counter and lock are what stop a distributed attack that
 * rotates source IPs but keeps guessing one password.
 */
const express = require('express');
const { config } = require('../config');
const { db, sql, insertReturning } = require('../db');
const validate = require('../lib/validate');
const { hashPassword, verifyPassword, randomToken } = require('../crypto');
const auth = require('../security/auth');
const rateLimit = require('../security/rate-limit');
const users = require('../services/users');
const errors = require('../errors');
const logger = require('../logger');
const audit = require('../services/audit');

const router = express.Router();

/** Auth endpoints cost more than a normal request: they run scrypt. */
function authBudget(req, res, next) {
  const result = rateLimit.check(`auth:${req.clientIp}`, config.limits.authPerMinute, config.limits.authBurst);
  if (!result.allowed) {
    next(errors.tooMany('Too many sign-in attempts from this network, wait a moment', result.retryAfter));
    return;
  }
  next();
}

function clientMeta(req) {
  return {
    device: String(req.get('x-device') || req.get('user-agent') || 'unknown').slice(0, 120),
    ip: req.clientIp,
    userAgent: String(req.get('user-agent') || '').slice(0, 250),
  };
}

router.post('/register', authBudget, errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    username: ['username', { message: 'Use 3-20 letters, numbers or underscores, starting with a letter' }],
    password: ['password', { min: 8, message: 'Password must be at least 8 characters' }],
    email: ['email', { optional: true, message: 'That email does not look right' }],
    displayName: ['text', { optional: true, max: 32, message: 'Display name must be 32 characters or fewer' }],
  });

  const existing = await users.findByUsername(body.username);
  if (existing) throw errors.conflict('That name is taken');
  if (body.email) {
    const emailTaken = await db().get(`SELECT id FROM users WHERE email = ?`, [body.email]);
    if (emailTaken) throw errors.conflict('That email is already registered');
  }

  const now = Date.now();
  const userId = await insertReturning('users', [
    'username', 'username_lower', 'email', 'password_hash', 'display_name', 'avatar_seed', 'level', 'xp', 'role', 'settings', 'created_at', 'updated_at',
  ], [
    body.username,
    body.username,
    body.email || null,
    hashPassword(body.password),
    body.displayName || body.username,
    randomToken(6),
    1,
    0,
    'user',
    sql.json(users.defaults()),
    now,
    now,
  ]);

  const user = await users.findById(userId);
  const session = await auth.createSession(user, clientMeta(req));
  await audit.record({ actorId: user.id, action: 'auth.register', ip: req.clientIp });
  await users.addFeedItem(user.id, 'joined', { username: user.username });
  logger.info('user registered', { user: user.id, ip: req.clientIp });
  res.status(201).json({ user: users.publicUser(user), ...session });
}));

router.post('/login', authBudget, errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    username: ['text', { max: 64, message: 'Enter your name or email' }],
    password: ['password', { min: 1, message: 'Enter your password' }],
  });

  const identifier = body.username.trim().toLowerCase();
  const row = identifier.includes('@')
    ? await db().get(`SELECT * FROM users WHERE email = ?`, [identifier])
    : await db().get(`SELECT * FROM users WHERE username_lower = ?`, [identifier]);

  // Always run a hash comparison, even with no matching row, so response time
  // does not reveal which names exist.
  const probeHash = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const candidate = row || { password_hash: probeHash, id: 0, status: 'active', failed_logins: 0 };
  const ok = verifyPassword(body.password, candidate.password_hash);

  if (!row || !ok) {
    if (row) {
      const failures = Number(row.failed_logins || 0) + 1;
      const lockUntil = failures >= config.auth.maxFailedLogins ? Date.now() + config.auth.loginLockSeconds * 1000 : null;
      await db().run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`, [failures, lockUntil, row.id]);
      if (lockUntil) {
        await auth.revokeAllSessions(row.id);
        logger.warn('account locked after failed logins', { user: row.id, failures, ip: req.clientIp });
      }
    }
    rateLimit.penalize(`ip:${req.clientIp}`, config.limits);
    await audit.record({ actorId: row ? row.id : null, action: 'auth.login_failed', ip: req.clientIp });
    throw errors.unauthorized('That name and password do not match');
  }

  if (row.status === 'banned') throw errors.forbidden('This account is suspended');
  if (row.locked_until && Number(row.locked_until) > Date.now()) {
    const seconds = Math.ceil((Number(row.locked_until) - Date.now()) / 1000);
    throw errors.tooMany(`Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} min`, seconds);
  }

  await db().run(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = ? WHERE id = ?`, [Date.now(), row.id]);
  const user = await users.findById(row.id);
  await users.setPresence(user.id, 'online');
  const session = await auth.createSession(user, clientMeta(req));
  await audit.record({ actorId: user.id, action: 'auth.login', ip: req.clientIp });
  res.json({ user: users.publicUser(user), ...session });
}));

router.post('/refresh', errors.wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const token = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  const rotated = await auth.rotate(token, clientMeta(req));
  if (!rotated) throw errors.unauthorized('That session is no longer valid, sign in again');
  const { user, ...session } = rotated;
  await users.setPresence(user.id, 'online');
  res.json({ user: users.publicUser(user), ...session });
}));

router.post('/logout', errors.wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const token = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  if (token) {
    const { tokenHash } = require('../crypto');
    await db().run(`UPDATE sessions SET revoked_at = ? WHERE refresh_hash = ? AND revoked_at IS NULL`, [Date.now(), tokenHash(token)]);
  }
  res.json({ ok: true });
}));

router.get('/sessions', requireAuth(), errors.wrap(async (req, res) => {
  const rows = await auth.listSessions(req.user.id);
  res.json({
    sessions: rows.map((row) => ({
      id: Number(row.id),
      device: row.device,
      ip: row.ip,
      current: Number(row.id) === req.sessionId,
      createdAt: Number(row.created_at || 0),
      expiresAt: Number(row.expires_at || 0),
    })),
  });
}));

router.post('/sessions/revoke-others', requireAuth(), errors.wrap(async (req, res) => {
  const info = await db().run(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?`,
    [Date.now(), req.user.id, req.sessionId],
  );
  await audit.record({
    actorId: req.user.id,
    action: 'auth.sessions_revoked_others',
    target: String(info.changes),
    ip: req.clientIp,
  });
  res.json({ revoked: info.changes });
}));

router.delete('/sessions/:id', requireAuth(), errors.wrap(async (req, res) => {
  const id = validate.parse(req.params, { id: ['id'] }).id;
  if (id === req.sessionId) throw errors.bad('Sign out from the device you want to leave');
  const info = await db().run(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`, [Date.now(), id, req.user.id]);
  if (!info.changes) throw errors.notFound('That session is already gone');
  await audit.record({ actorId: req.user.id, action: 'auth.session_revoked', target: String(id), ip: req.clientIp });
  res.json({ ok: true });
}));

router.post('/password', requireAuth(), errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    currentPassword: ['password', { min: 1, message: 'Enter your current password' }],
    newPassword: ['password', { min: 8, message: 'New password must be at least 8 characters' }],
  });
  if (!verifyPassword(body.currentPassword, req.user.password_hash)) {
    rateLimit.penalize(`ip:${req.clientIp}`, config.limits);
    throw errors.unauthorized('That is not your current password');
  }
  await db().run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [hashPassword(body.newPassword), Date.now(), req.user.id]);
  await auth.revokeAllSessions(req.user.id);
  await audit.record({ actorId: req.user.id, action: 'auth.password_changed', ip: req.clientIp });
  // Every session is revoked on a password change, so hand back a fresh one.
  const user = await users.findById(req.user.id);
  const session = await auth.createSession(user, clientMeta(req));
  res.json({ ok: true, ...session });
}));

function requireAuth() {
  return require('../middleware/auth').required();
}

module.exports = router;
