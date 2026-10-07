'use strict';
/**
 * Routers for the social surfaces: users, friends, calls.
 * Mounted separately in index.js so each keeps its own path prefix.
 */
const express = require('express');
const { db, sql } = require('../db');
const users = require('../services/users');
const parties = require('../services/parties');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const realtime = require('../realtime');
const { callCode } = require('../crypto');

/* ------------------------------------------------------------------ users */

const usersRouter = express.Router();
usersRouter.use(auth.required());

usersRouter.get('/search', errors.wrap(async (req, res) => {
  const { q } = validate.parse(req.query, { q: ['text', { max: 32, message: 'Type at least one character' }] });
  if (q.length < 2) throw errors.bad('Type at least two characters');
  const rows = await users.search(q, 20);
  res.json({ users: rows.filter((row) => Number(row.id) !== req.user.id).map(users.publicUser) });
}));

usersRouter.get('/me', errors.wrap(async (req, res) => {
  const fresh = await users.findById(req.user.id);
  res.json({ user: users.publicUser(fresh), settings: await users.getSettings(req.user.id) });
}));

usersRouter.get('/me/stats', errors.wrap(async (req, res) => {
  const id = req.user.id;
  const [friends, parties, servers, sessions] = await Promise.all([
    db().get(`SELECT COUNT(*) AS n FROM friendships WHERE user_id = ? AND status = 'accepted'`, [id]),
    db().get(`SELECT COUNT(DISTINCT party_id) AS n FROM party_members WHERE user_id = ?`, [id]),
    db().get(`SELECT COUNT(*) AS n FROM mc_servers WHERE owner_id = ?`, [id]),
    db().get(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`, [id, Date.now()]),
  ]);
  res.json({
    friends: Number(friends.n),
    parties: Number(parties.n),
    servers: Number(servers.n),
    sessions: Number(sessions.n),
  });
}));

usersRouter.patch('/me', errors.wrap(async (req, res) => {
  // Deliberately not `optional`: an invalid value must surface as a 400 rather
  // than quietly disappear, or a client sending an emoji name would read the
  // 200 as "saved" while nothing changed. A field the client omitted is absent
  // from the parsed body, which is how "leave it alone" is expressed.
  const body = validate.parse(req.body, {
    displayName: ['text', { max: 32, message: 'Display name must be 1-32 characters, no emoji' }],
    bio: ['text', { max: 160, message: 'About you must be 160 characters or fewer, no emoji' }],
  });
  const fields = {};
  if (body.displayName) fields.display_name = body.displayName;
  if (body.bio) fields.bio = body.bio;
  if (!Object.keys(fields).length) throw errors.bad('Nothing to save');
  const fresh = await users.updateProfile(req.user.id, fields);
  res.json({ user: users.publicUser(fresh) });
}));

usersRouter.patch('/me/settings', errors.wrap(async (req, res) => {
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const patch = {};
  if (raw.privacy) {
    patch.privacy = validate.parse(raw.privacy, {
      friendRequests: ['enum', { values: ['everyone', 'friends', 'nobody'], optional: true }],
      calls: ['enum', { values: ['everyone', 'friends', 'nobody'], optional: true }],
      showPresence: ['bool', { optional: true }],
      discoverable: ['bool', { optional: true }],
    });
  }
  if (raw.voice) {
    patch.voice = validate.parse(raw.voice, {
      noiseSuppression: ['bool', { optional: true }],
      echoCancellation: ['bool', { optional: true }],
      inputGain: ['int', { min: 0, max: 200, optional: true }],
      outputVolume: ['int', { min: 0, max: 100, optional: true }],
    });
  }
  if (raw.e2ee) {
    patch.e2ee = validate.parse(raw.e2ee, { enforce: ['bool', { optional: true }] });
  }
  if (raw.appearance) {
    patch.appearance = validate.parse(raw.appearance, { reduceMotion: ['bool', { optional: true }] });
  }
  if (raw.notifications) {
    patch.notifications = validate.parse(raw.notifications, {
      partyInvites: ['bool', { optional: true }],
      friendRequests: ['bool', { optional: true }],
      calls: ['bool', { optional: true }],
      messages: ['bool', { optional: true }],
      broadcasts: ['bool', { optional: true }],
    });
  }
  const current = await users.getSettings(req.user.id);
  const merged = users.saveSettings(req.user.id, users.mergeSettings(current, patch));
  res.json({ settings: merged });
}));

usersRouter.get('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await users.findById(id);
  const friendship = await db().get(`SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?`, [req.user.id, id]);
  const blocked = await db().get(`SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?`, [req.user.id, id]);
  const party = await db().get(
    `SELECT p.id, p.name, p.kind FROM party_members m JOIN parties p ON p.id = m.party_id
     WHERE m.user_id = ? AND p.live = ? ${sql.limit(1, 0)}`,
    [id, sql.bool(true)],
  );
  res.json({
    user: users.publicUser(row),
    relationship: blocked ? 'blocked' : (friendship ? friendship.status : 'none'),
    inParty: party ? { id: Number(party.id), name: party.name, kind: party.kind } : null,
  });
}));

usersRouter.get('/:id/friends', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const isFriend = !!(await db().get(`SELECT 1 AS x FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'`, [req.user.id, id]));
  if (Number(id) !== req.user.id && !isFriend) {
    const settings = await users.getSettings(id);
    if (settings.privacy && settings.privacy.discoverable === false) throw errors.forbidden('This player keeps their friends private');
  }
  const rows = await db().query(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? AND f.status = 'accepted' ORDER BY u.username ASC ${sql.limit(100, 0)}`,
    [id],
  );
  res.json({ friends: rows.map(users.publicUser) });
}));

/* ---------------------------------------------------------------- friends */

const friendsRouter = express.Router();
friendsRouter.use(auth.required());

friendsRouter.get('/', errors.wrap(async (req, res) => {
  const rows = await db().query(
    `SELECT u.*, f.status FROM friendships f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? ORDER BY CASE f.status WHEN 'accepted' THEN 0 ELSE 1 END, u.username ASC ${sql.limit(200, 0)}`,
    [req.user.id],
  );
  res.json({
    friends: rows.filter((row) => row.status === 'accepted').map(users.publicUser),
    outgoing: rows.filter((row) => row.status === 'pending_outgoing').map(users.publicUser),
    incoming: rows.filter((row) => row.status === 'pending_incoming').map(users.publicUser),
  });
}));

friendsRouter.post('/request', errors.wrap(async (req, res) => {
  const { userId } = validate.parse(req.body, { userId: ['id'] });
  if (userId === req.user.id) throw errors.bad('You cannot add yourself');
  const target = await users.findOptional(userId);
  if (!target) throw errors.notFound('That player does not exist');
  if (await db().get(`SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?`, [userId, req.user.id])) {
    throw errors.forbidden('That player is not accepting requests');
  }
  const settings = await users.getSettings(userId);
  if (settings.privacy && settings.privacy.friendRequests === 'nobody') throw errors.forbidden('That player is not accepting requests');

  const existing = await db().get(`SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?`, [req.user.id, userId]);
  if (existing && existing.status === 'accepted') throw errors.conflict('You are already friends');

  const reverse = await db().get(`SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?`, [userId, req.user.id]);
  if (reverse && reverse.status === 'pending_outgoing') {
    // They already asked: accept instead of making them ask twice.
    await db().run(sql.upsert('friendships', ['user_id', 'friend_id', 'status', 'created_at'], ['user_id', 'friend_id'], ['status', 'created_at']),
      [req.user.id, userId, 'accepted', Date.now()]);
    await db().run(`UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`, [userId, req.user.id]);
    realtime.sendToUser(userId, { type: 'friend.accepted', user: users.publicUser(req.user) });
    res.json({ ok: true, status: 'accepted' });
    return;
  }

  await db().run(sql.upsert('friendships', ['user_id', 'friend_id', 'status', 'created_at'], ['user_id', 'friend_id'], ['status', 'created_at']),
    [req.user.id, userId, 'pending_outgoing', Date.now()]);
  await db().run(sql.upsert('friendships', ['user_id', 'friend_id', 'status', 'created_at'], ['user_id', 'friend_id'], ['status', 'created_at']),
    [userId, req.user.id, 'pending_incoming', Date.now()]);
  await db().run(`INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'friend_request', ?, ?)`,
    [userId, sql.json({ from: req.user.id }), Date.now()]);
  realtime.sendToUser(userId, { type: 'friend.request', user: users.publicUser(req.user) });
  res.json({ ok: true, status: 'pending_outgoing' });
}));

friendsRouter.post('/accept', errors.wrap(async (req, res) => {
  const { userId } = validate.parse(req.body, { userId: ['id'] });
  const info = await db().run(`UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending_incoming'`, [req.user.id, userId]);
  if (!info.changes) throw errors.notFound('That request is gone');
  await db().run(sql.upsert('friendships', ['user_id', 'friend_id', 'status', 'created_at'], ['user_id', 'friend_id'], ['status', 'created_at']),
    [userId, req.user.id, 'accepted', Date.now()]);
  realtime.sendToUser(userId, { type: 'friend.accepted', user: users.publicUser(req.user) });
  await users.awardXp(req.user.id, 25);
  res.json({ ok: true });
}));

friendsRouter.delete('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  await db().run(`DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [req.user.id, id, id, req.user.id]);
  realtime.sendToUser(id, { type: 'friend.removed', userId: req.user.id });
  res.json({ ok: true });
}));

friendsRouter.post('/block', errors.wrap(async (req, res) => {
  const { userId } = validate.parse(req.body, { userId: ['id'] });
  if (userId === req.user.id) throw errors.bad('You cannot block yourself');
  await db().run(sql.upsert('blocks', ['user_id', 'blocked_id', 'created_at'], ['user_id', 'blocked_id'], ['created_at']), [req.user.id, userId, Date.now()]);
  await db().run(`DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [req.user.id, userId, userId, req.user.id]);
  // Leave any room the blocker hosts so the blocked player is not stuck in it.
  await db().run(`DELETE FROM party_members WHERE user_id = ? AND party_id IN (SELECT id FROM parties WHERE owner_id = ?)`, [userId, req.user.id]);
  res.json({ ok: true });
}));

friendsRouter.get('/blocked', errors.wrap(async (req, res) => {
  const rows = await db().query(
    `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC ${sql.limit(100, 0)}`,
    [req.user.id],
  );
  res.json({ blocked: rows.map(users.publicUser) });
}));

friendsRouter.delete('/blocked/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  await db().run(`DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?`, [req.user.id, id]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ calls */

const callsRouter = express.Router();
callsRouter.use(auth.required());

/** Ring someone: create a locked two-seat call room and push the invite. */
callsRouter.post('/', errors.wrap(async (req, res) => {
  const { userId, video } = validate.parse(req.body, { userId: ['id'], video: ['bool', { fallback: false }] });
  if (userId === req.user.id) throw errors.bad('You cannot call yourself');
  await users.findById(userId);
  const areFriends = !!(await db().get(`SELECT 1 AS x FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'`, [req.user.id, userId]));
  const settings = await users.getSettings(userId);
  if (settings.privacy && settings.privacy.calls === 'nobody') throw errors.forbidden('This player is not taking calls');
  if (settings.privacy && settings.privacy.calls === 'friends' && !areFriends) throw errors.forbidden('This player only takes calls from friends');
  if (await db().get(`SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?`, [userId, req.user.id])) throw errors.forbidden('This player is not taking calls');
  if (!realtime.isOnline(userId)) throw errors.conflict('They are offline right now');

  const party = await parties.create({
    ownerId: req.user.id,
    name: `${req.user.username} / ${users.publicUser(await users.findById(userId)).username}`,
    kind: 'call',
    maxMembers: 2,
    locked: true,
    meta: { video, callerId: req.user.id, calleeId: userId, code: callCode() },
  });
  await parties.invite(party.id, req.user.id, userId);
  const meta = sql.parse(party.meta) || {};
  realtime.sendToUser(userId, { type: 'call.incoming', callId: party.id, code: meta.code, video, from: users.publicUser(req.user) });
  await db().run(`INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'call', ?, ?)`,
    [userId, sql.json({ callId: party.id, from: req.user.id }), Date.now()]);
  res.status(201).json({ callId: party.id, code: meta.code, party: await parties.view(party, req.user.id) });
}));

callsRouter.get('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  if (party.kind !== 'call') throw errors.bad('That is not a call');
  if (!await parties.isMember(id, req.user.id)) throw errors.forbidden('You are not in this call');
  res.json({ party: await parties.view(party, req.user.id) });
}));

callsRouter.post('/:id/accept', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  if (party.kind !== 'call') throw errors.bad('That is not a call');
  await parties.join(id, req.user.id, { invited: true });
  const meta = sql.parse(party.meta) || {};
  realtime.sendToUser(Number(meta.callerId), { type: 'call.accepted', callId: id, by: req.user.id });
  res.json({ ok: true, party: await parties.view(party, req.user.id) });
}));

callsRouter.post('/:id/decline', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  const meta = sql.parse(party.meta) || {};
  await parties.close(id, req.user.id, { silent: true });
  realtime.sendToUser(Number(meta.callerId), { type: 'call.declined', callId: id, by: req.user.id });
  res.json({ ok: true });
}));

callsRouter.post('/:id/end', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const memberIds = (await parties.members(id)).map((row) => Number(row.user_id));
  await parties.close(id, req.user.id, { silent: true });
  for (const memberId of memberIds) realtime.sendToUser(memberId, { type: 'call.ended', callId: id });
  res.json({ ok: true });
}));

module.exports = { usersRouter, friendsRouter, callsRouter };
