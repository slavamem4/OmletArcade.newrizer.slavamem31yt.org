'use strict';
/**
 * /api/feed, /api/notifications, /api/reports.
 *
 * The feed is what your friends did; notifications are what the platform owes
 * you an answer on. Both are append-only tables that purge.js trims, so this
 * router never grows the database without bound.
 */
const express = require('express');
const { db, sql, insertReturning } = require('../db');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const users = require('../services/users');
const audit = require('../services/audit');

const router = express.Router();
router.use(auth.required());

const REPORT_REASONS = ['abuse', 'spam', 'cheating', 'other'];

/* --------------------------------------------------------------------- feed */

router.get('/feed', errors.wrap(async (req, res) => {
  const { limit, before } = validate.parse(req.query, {
    limit: ['int', { min: 1, max: 50, default: 30 }],
    before: ['int', { min: 0, default: 0 }],
  });
  const rows = await users.feedFor(req.user.id, { limit, before });
  res.json({
    items: rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      kind: row.kind,
      payload: sql.parse(row.payload) || {},
      createdAt: Number(row.created_at || 0),
    })),
  });
}));

/* ------------------------------------------------------------ notifications */

function publicNotification(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    payload: sql.parse(row.payload) || {},
    readAt: row.read_at ? Number(row.read_at) : null,
    createdAt: Number(row.created_at || 0),
  };
}

router.get('/notifications', errors.wrap(async (req, res) => {
  const rows = await db().query(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC ${sql.limit(50, 0)}`,
    [req.user.id],
  );
  const unread = rows.filter((row) => !row.read_at).length;
  res.json({ notifications: rows.map(publicNotification), unread });
}));

router.post('/notifications/read', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, { id: ['int', { min: 1, optional: true }] });
  const at = Date.now();
  let info;
  if (body.id) {
    info = await db().run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL`,
      [at, req.user.id, body.id],
    );
  } else {
    info = await db().run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
      [at, req.user.id],
    );
  }
  res.json({ marked: info.changes });
}));

/* ------------------------------------------------------------------ reports */

router.post('/reports', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    targetId: ['int', { min: 1, optional: true }],
    targetKind: ['enum', { values: ['user', 'party', 'server', 'message', 'general'], default: 'user' }],
    reason: ['enum', { values: REPORT_REASONS }],
    detail: ['text', { optional: true, max: 500 }],
  });
  // oneOf() yields null for a value outside the list, so enforce it here:
  // a bad reason is a client bug or a probe, not a row in the queue.
  if (!body.reason) throw errors.bad('Pick one of: ' + REPORT_REASONS.join(', '));
  if (!body.targetKind) body.targetKind = 'user';
  if (body.targetKind === 'user' && body.targetId) {
    const target = await users.findOptional(body.targetId);
    if (!target) throw errors.notFound('That player does not exist');
  }
  // Cap one reporter at 20 open reports so the queue cannot be flooded.
  const open = await db().get(
    `SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND status = 'open'`,
    [req.user.id],
  );
  if (Number(open.n) >= 20) throw errors.tooMany('You have too many open reports, wait for a moderator');

  const id = await insertReturning(
    'reports',
    ['reporter_id', 'target_id', 'target_kind', 'reason', 'detail', 'status', 'created_at'],
    [req.user.id, body.targetId || null, body.targetKind, body.reason, body.detail || '', 'open', Date.now()],
  );
  await audit.record({
    actorId: req.user.id,
    action: 'report.create',
    target: body.targetId ? `${body.targetKind}:${body.targetId}` : body.targetKind,
    ip: req.ip,
    detail: { reason: body.reason },
  });
  res.status(201).json({ id: Number(id), status: 'open' });
}));

module.exports = router;
