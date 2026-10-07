'use strict';
/**
 * Session handling.
 *
 * Access token: short-lived HS256 JWT, carries the session id so it can be
 * revoked without touching the database on every request.
 * Refresh token: opaque, stored only as a SHA-256 hash, rotated on every use,
 * and tied to a family. Replaying an already-rotated token revokes the whole
 * family, which is what happens when a token is stolen.
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { db, sql, insertReturning } = require('../db');
const { randomToken, tokenHash, safeEqual } = require('../crypto');
const { unauthorized } = require('../errors');
const logger = require('../logger');

function signAccessToken(user, sessionId) {
  return jwt.sign(
    {
      sub: String(user.id),
      sid: String(sessionId),
      usr: user.username,
      role: user.role,
      typ: 'access',
    },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.auth.accessTokenTtlSeconds, issuer: 'omlet-arcade' },
  );
}

function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'omlet-arcade',
      maxAge: config.auth.accessTokenTtlSeconds + 30,
    });
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) return null;
    return payload;
  } catch {
    return null;
  }
}

async function createSession(user, { device = '', ip = '', userAgent = '' } = {}) {
  const family = crypto.randomBytes(12).toString('hex');
  const refresh = randomToken(48);
  const sessionId = await insertReturning('sessions',
    ['user_id', 'refresh_hash', 'family', 'device', 'ip', 'user_agent', 'expires_at', 'created_at'],
    [
      user.id,
      tokenHash(refresh),
      family,
      String(device).slice(0, 120),
      String(ip).slice(0, 64),
      String(userAgent).slice(0, 250),
      Date.now() + config.auth.refreshTokenTtlDays * 86400000,
      Date.now(),
    ]);

  // Cap concurrent sessions per account: oldest wins the boot.
  const sessions = await db().query(
    `SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC`,
    [user.id],
  );
  if (sessions.length > config.auth.maxSessionsPerUser) {
    const stale = sessions.slice(0, sessions.length - config.auth.maxSessionsPerUser).map((row) => row.id);
    for (const id of stale) {
      await db().run(`UPDATE sessions SET revoked_at = ? WHERE id = ?`, [Date.now(), id]);
    }
  }

  return {
    accessToken: signAccessToken(user, sessionId),
    refreshToken: refresh,
    sessionId,
    expiresIn: config.auth.accessTokenTtlSeconds,
  };
}

/**
 * Rotate a refresh token. Returns null when the token is unknown, expired, or
 * already used (which also kills the family).
 */
async function rotate(refreshToken, { device = '', ip = '', userAgent = '' } = {}) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20) return null;
  const hash = tokenHash(refreshToken);
  const row = await db().get(`SELECT * FROM sessions WHERE refresh_hash = ?`, [hash]);
  if (!row) return null;
  if (row.revoked_at) {
    // Replay detected: burn every session in the family.
    await db().run(`UPDATE sessions SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL`, [Date.now(), row.family]);
    logger.warn('refresh token replay: family revoked', { family: row.family, user: row.user_id });
    return null;
  }
  if (Number(row.expires_at) <= Date.now()) return null;

  await db().run(`UPDATE sessions SET revoked_at = ? WHERE id = ?`, [Date.now(), row.id]);
  const user = await db().get(`SELECT * FROM users WHERE id = ?`, [row.user_id]);
  if (!user || user.status !== 'active') return null;

  const next = randomToken(48);
  const sessionId = await insertReturning('sessions',
    ['user_id', 'refresh_hash', 'family', 'device', 'ip', 'user_agent', 'expires_at', 'created_at'],
    [
      user.id,
      tokenHash(next),
      row.family,
      String(device).slice(0, 120) || row.device,
      String(ip).slice(0, 64),
      String(userAgent).slice(0, 250) || row.user_agent,
      Date.now() + config.auth.refreshTokenTtlDays * 86400000,
      Date.now(),
    ]);

  return {
    accessToken: signAccessToken(user, sessionId),
    refreshToken: next,
    sessionId,
    expiresIn: config.auth.accessTokenTtlSeconds,
    user,
  };
}

async function revokeSession(sessionId) {
  await db().run(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, [Date.now(), sessionId]);
}

async function revokeAllSessions(userId) {
  await db().run(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [Date.now(), userId]);
}

async function listSessions(userId) {
  const rows = await db().query(
    `SELECT id, device, ip, user_agent, created_at, expires_at FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    [userId, Date.now()],
  );
  return rows;
}

async function sessionActive(sessionId) {
  const row = await db().get(
    `SELECT id FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    [sessionId, Date.now()],
  );
  return !!row;
}

/** Delete expired rows; called by the cleanup loop. */
async function purgeExpired() {
  const info = await db().run(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, [
    Date.now(),
    Date.now() - 86400000,
  ]);
  return info.changes;
}

function bearer(req) {
  const header = req.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

/** Resolve the caller. Throws 401 when the token is missing or dead. */
async function loadUser(req) {
  const token = bearer(req);
  if (!token) throw unauthorized('Sign in to continue');
  const payload = verifyAccessToken(token);
  if (!payload) throw unauthorized('Your session expired, sign in again');
  if (!safeEqual(String(payload.typ), 'access')) throw unauthorized();
  if (!await sessionActive(payload.sid)) throw unauthorized('This session was signed out');
  const user = await db().get(`SELECT * FROM users WHERE id = ?`, [Number(payload.sub)]);
  if (!user) throw unauthorized('Account no longer exists');
  if (user.status === 'banned') throw unauthorized('This account is suspended');
  req.user = user;
  req.sessionId = Number(payload.sid);
  req.tokenPayload = payload;
  return user;
}

module.exports = {
  signAccessToken, verifyAccessToken, createSession, rotate, revokeSession, revokeAllSessions,
  listSessions, sessionActive, purgeExpired, bearer, loadUser,
};
