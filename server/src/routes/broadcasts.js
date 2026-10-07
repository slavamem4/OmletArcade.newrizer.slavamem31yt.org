'use strict';
/**
 * /api/broadcasts — live streaming (screen + microphone).
 *
 * A broadcast is a party of kind `broadcast`: the streamer holds the publish
 * grant, viewers get a subscribe-only token. Peak viewer count is tracked from
 * membership so the list can sort by what people are actually watching.
 */
const express = require('express');
const { db, sql } = require('../db');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const parties = require('../services/parties');
const users = require('../services/users');
const livekit = require('../services/livekit');
const realtime = require('../realtime');
const audit = require('../services/audit');

const router = express.Router();

function view(row) {
  return {
    id: Number(row.party_id || row.id),
    broadcastId: Number(row.id),
    title: row.title,
    game: row.game,
    live: sql.asBool(row.live),
    peakViewers: Number(row.peak_viewers || 0),
    startedAt: Number(row.started_at || 0),
    endedAt: row.ended_at ? Number(row.ended_at) : null,
    streamer: row.username ? { id: Number(row.user_id), username: row.username, displayName: row.display_name, avatarSeed: row.avatar_seed } : null,
    viewers: Number(row.viewers || 0),
  };
}

router.get('/', errors.wrap(async (req, res) => {
  const rows = await db().query(
    `SELECT b.*, p.id AS party_id, p.live, u.username, u.display_name, u.avatar_seed,
       (SELECT COUNT(*) FROM party_members m WHERE m.party_id = p.id) - 1 AS viewers
     FROM broadcasts b
     JOIN parties p ON p.id = b.party_id
     JOIN users u ON u.id = b.user_id
     WHERE b.live = ? ORDER BY viewers DESC, b.started_at DESC ${sql.limit(30, 0)}`,
    [sql.bool(true)],
  );
  res.json({ broadcasts: rows.map(view) });
}));

router.use(auth.required());

router.post('/', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    title: ['text', { max: 60, message: 'Give the stream a title of 60 characters or fewer' }],
    game: ['text', { optional: true, max: 40, default: '' }],
    withCamera: ['bool', { fallback: false }],
  });
  const party = await parties.create({
    ownerId: req.user.id,
    name: body.title,
    kind: 'broadcast',
    game: body.game || '',
    maxMembers: 50,
    meta: { streamerId: req.user.id, withCamera: body.withCamera },
  });
  const id = await require('../db').insertReturning('broadcasts',
    ['user_id', 'title', 'game', 'room_name', 'live', 'peak_viewers', 'started_at'],
    [req.user.id, body.title, body.game || '', party.room_name, sql.bool(true), 0, Date.now()]);
  await db().run(`UPDATE parties SET meta = ? WHERE id = ?`, [sql.json({ ...(sql.parse(party.meta) || {}), broadcastId: id }), party.id]);
  await users.addFeedItem(req.user.id, 'went_live', { broadcastId: id, title: body.title, game: body.game });
  const friendRows = await db().query(
    `SELECT user_id FROM friendships WHERE friend_id = ? AND status = 'accepted' ${sql.limit(200, 0)}`,
    [req.user.id],
  );
  for (const row of friendRows) {
    await db().run(`INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'broadcast', ?, ?)`,
      [Number(row.user_id), sql.json({ broadcastId: id, title: body.title }), Date.now()]);
  }
  realtime.notifyFriends(req.user.id, { type: 'broadcast.started', broadcastId: id, partyId: party.id, title: body.title, by: req.user.id });
  await audit.record({ actorId: req.user.id, action: 'broadcast.start', target: String(id), ip: req.clientIp });
  res.status(201).json({ broadcast: { id: Number(party.id), broadcastId: id, title: body.title, party: await parties.view(party, req.user.id) } });
}));

router.post('/:id/join', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  if (party.kind !== 'broadcast') throw errors.bad('That is not a stream');
  if (!sql.asBool(party.live)) throw errors.conflict('That stream has ended');
  await parties.join(id, req.user.id, { invited: true });
  const count = await db().get(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`, [id]);
  const viewers = Math.max(0, Number(count.n) - 1);
  await db().run(`UPDATE broadcasts SET peak_viewers = MAX(peak_viewers, ?) WHERE party_id = ?`, [viewers, id]);
  realtime.broadcastToParty(id, { type: 'broadcast.viewer_count', partyId: id, viewers });
  res.json({ ok: true, party: await parties.view(party, req.user.id), viewers });
}));

router.post('/:id/leave', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  await parties.leave(id, req.user.id);
  const count = await db().get(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`, [id]);
  realtime.broadcastToParty(id, { type: 'broadcast.viewer_count', partyId: id, viewers: Math.max(0, Number(count.n) - 1) });
  res.json({ ok: true });
}));

/**
 * Streamer token: may publish screen and mic. Viewer token: subscribe only,
 * enforced by the grant, not by the client's goodwill.
 */
router.post('/:id/token', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  if (party.kind !== 'broadcast') throw errors.bad('That is not a stream');
  if (!sql.asBool(party.live)) throw errors.conflict('That stream has ended');
  if (!await parties.isMember(id, req.user.id)) throw errors.forbidden('Join the stream first');
  const isStreamer = Number(party.owner_id) === req.user.id;
  const muted = realtime.isMuted(id, req.user.id);
  const grant = await livekit.issueToken({
    userId: req.user.id,
    username: req.user.display_name,
    room: party.room_name,
    canPublish: isStreamer && !muted,
    canSubscribe: true,
    metadata: { broadcastId: id, role: isStreamer ? 'streamer' : 'viewer', e2ee: sql.asBool(party.e2ee) },
  });
  res.json({ ...grant, role: isStreamer ? 'streamer' : 'viewer', e2ee: sql.asBool(party.e2ee), partyId: id });
}));

router.post('/:id/stop', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  if (Number(party.owner_id) !== req.user.id && req.user.role !== 'admin') throw errors.forbidden('Only the streamer can end the stream');
  const memberIds = (await parties.members(id)).map((row) => Number(row.user_id));
  await db().run(`UPDATE broadcasts SET live = ?, ended_at = ? WHERE party_id = ?`, [sql.bool(false), Date.now(), id]);
  await parties.close(id, req.user.id, { silent: true });
  for (const memberId of memberIds) realtime.sendToUser(memberId, { type: 'broadcast.ended', partyId: id });
  await audit.record({ actorId: req.user.id, action: 'broadcast.stop', target: String(id), ip: req.clientIp });
  res.json({ ok: true });
}));

/** Trims ended broadcasts; called by the cleanup loop. */
async function purge() {
  const info = await db().run(`DELETE FROM broadcasts WHERE live = ? AND ended_at IS NOT NULL AND ended_at < ?`, [sql.bool(false), Date.now() - 14 * 86400000]);
  return info.changes;
}

module.exports = router;
module.exports.purge = purge;
module.exports.view = view;
