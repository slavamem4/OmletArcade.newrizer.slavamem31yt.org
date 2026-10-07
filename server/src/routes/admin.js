'use strict';
/**
 * /api/admin — moderation and operations. Admin or moderator only.
 */
const express = require('express');
const { db, sql } = require('../db');
const { config } = require('../config');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const rateLimit = require('../security/rate-limit');
const pow = require('../security/pow');
const cache = require('../lib/cache');
const realtime = require('../realtime');
const logger = require('../logger');

const router = express.Router();
router.use(auth.required(), auth.admin());

const TABLES = [
  'users', 'sessions', 'friendships', 'blocks', 'parties', 'party_members', 'party_events',
  'channels', 'messages', 'mc_servers', 'mc_sessions', 'broadcasts', 'feed_items',
  'notifications', 'reports', 'bans', 'wrapped_keys', 'key_packages', 'audit_log',
];

async function counts() {
  const out = {};
  for (const table of TABLES) {
    const row = await db().get(`SELECT COUNT(*) AS n FROM ${table}`);
    out[table] = Number(row ? row.n : 0);
  }
  return out;
}

router.get('/stats', errors.wrap(async (req, res) => {
  res.json({
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    rateLimit: rateLimit.snapshot(),
    pow: pow.stats(),
    caches: cache.statsAll(),
    realtime: realtime.stats(),
    logRing: logger.ringSize(),
    tables: await counts(),
  });
}));

router.get('/audit', errors.wrap(async (req, res) => {
  const { limit } = validate.parse(req.query, { limit: ['int', { min: 1, max: 500, fallback: 100 }] });
  const rows = await audit.recent(limit);
  res.json({
    entries: rows.map((row) => ({
      id: Number(row.id),
      actorId: row.actor_id ? Number(row.actor_id) : null,
      action: row.action,
      target: row.target,
      ip: row.ip,
      detail: sql.parse(row.detail),
      createdAt: Number(row.created_at || 0),
    })),
  });
}));

router.get('/reports', errors.wrap(async (req, res) => {
  const rows = await db().query(`SELECT * FROM reports ORDER BY id DESC ${sql.limit(100, 0)}`);
  res.json({
    reports: rows.map((row) => ({
      id: Number(row.id),
      reporterId: Number(row.reporter_id),
      targetId: row.target_id ? Number(row.target_id) : null,
      targetKind: row.target_kind,
      reason: row.reason,
      detail: row.detail,
      status: row.status,
      createdAt: Number(row.created_at || 0),
    })),
  });
}));

router.post('/reports/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { status } = validate.parse(req.body, { status: ['enum', { values: ['open', 'resolved', 'dismissed'] }] });
  const info = await db().run(`UPDATE reports SET status = ? WHERE id = ?`, [status, id]);
  if (!info.changes) throw errors.notFound('That report is gone');
  await audit.record({ actorId: req.user.id, action: `report.${status}`, target: String(id), ip: req.clientIp });
  res.json({ ok: true });
}));

/**
 * Ban a user and/or an IP. A user ban revokes every session immediately; an IP
 * ban feeds the same limiter the guard uses, so it takes effect on the next
 * request without a restart.
 */
router.post('/bans', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    userId: ['id', { optional: true }],
    ip: ['text', { optional: true, max: 64 }],
    reason: ['text', { optional: true, max: 200, default: '' }],
    hours: ['int', { min: 1, max: 24 * 365, fallback: 24 }],
  });
  if (!body.userId && !body.ip) throw errors.bad('Ban a player, a network, or both');
  const expiresAt = Date.now() + body.hours * 3600000;
  await db().run(`INSERT INTO bans (user_id, ip, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [body.userId || null, body.ip || null, body.reason || '', expiresAt, Date.now()]);

  if (body.userId) {
    await db().run(`UPDATE users SET status = 'banned', updated_at = ? WHERE id = ?`, [Date.now(), body.userId]);
    const auth = require('../security/auth');
    await auth.revokeAllSessions(body.userId);
    realtime.sendToUser(body.userId, { type: 'account.banned', reason: body.reason || '' });
    realtime.closeAll;
    for (const [socketUserId] of []) void socketUserId;
  }
  if (body.ip) rateLimit.banNow(`ip:${body.ip}`, body.hours * 3600);
  await audit.record({ actorId: req.user.id, action: 'admin.ban', target: `${body.userId || ''}/${body.ip || ''}`, ip: req.clientIp, detail: { hours: body.hours } });
  res.status(201).json({ ok: true, expiresAt });
}));

router.delete('/bans/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await db().get(`SELECT * FROM bans WHERE id = ?`, [id]);
  if (!row) throw errors.notFound('That ban is gone');
  await db().run(`DELETE FROM bans WHERE id = ?`, [id]);
  if (row.user_id) await db().run(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`, [Date.now(), Number(row.user_id)]);
  if (row.ip) rateLimit.unban(`ip:${row.ip}`);
  await audit.record({ actorId: req.user.id, action: 'admin.unban', target: String(id), ip: req.clientIp });
  res.json({ ok: true });
}));

router.get('/bans', errors.wrap(async (req, res) => {
  const rows = await db().query(`SELECT * FROM bans ORDER BY id DESC ${sql.limit(200, 0)}`);
  res.json({
    bans: rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id ? Number(row.user_id) : null,
      ip: row.ip,
      reason: row.reason,
      expiresAt: row.expires_at ? Number(row.expires_at) : null,
      createdAt: Number(row.created_at || 0),
      active: !row.expires_at || Number(row.expires_at) > Date.now(),
    })),
  });
}));

router.post('/users/:id/role', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { role } = validate.parse(req.body, { role: ['enum', { values: ['user', 'mod', 'admin'] }] });
  if (req.user.role !== 'admin' && role === 'admin') throw errors.forbidden('Only an admin can promote an admin');
  await db().run(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, [role, Date.now(), id]);
  await audit.record({ actorId: req.user.id, action: 'admin.role', target: `${id}:${role}`, ip: req.clientIp });
  res.json({ ok: true });
}));

/** Silence one player in one room: the voice token stops granting publish. */
router.post('/parties/:partyId/mute', errors.wrap(async (req, res) => {
  const { partyId } = validate.parse(req.params, { partyId: ['id'] });
  const { userId, muted: value } = validate.parse(req.body, { userId: ['id'], muted: ['bool', { fallback: true }] });
  realtime.setMuted(partyId, userId, value);
  realtime.sendToUser(userId, { type: 'voice.muted', partyId, by: req.user.id, muted: value });
  await audit.record({ actorId: req.user.id, action: value ? 'admin.mute' : 'admin.unmute', target: `${partyId}:${userId}`, ip: req.clientIp });
  res.json({ ok: true, muted: value });
}));

module.exports = router;
module.exports.counts = counts;
