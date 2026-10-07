'use strict';
/**
 * /api/chat — message history and sending.
 *
 * The server stores ciphertext. It never sees a key, never sees plaintext, and
 * cannot be asked to decrypt: the columns are `ciphertext`, `iv`, `tag` and
 * nothing reads them back except the sender's and recipient's devices.
 */
const express = require('express');
const { db, sql, insertReturning } = require('../db');
const { config } = require('../config');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const parties = require('../services/parties');
const users = require('../services/users');
const realtime = require('../realtime');

const router = express.Router();
router.use(auth.required());

const MAX_CIPHERTEXT_BYTES = 8 * 1024;

function dmKey(a, b) {
  return `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
}

async function ensureChannel(kind, memberKey, partyId = null) {
  const existing = await db().get(`SELECT * FROM channels WHERE member_key = ?`, [memberKey]);
  if (existing) return existing;
  const id = await insertReturning('channels', ['kind', 'member_key', 'party_id', 'created_at'], [kind, memberKey, partyId, Date.now()]);
  return db().get(`SELECT * FROM channels WHERE id = ?`, [id]);
}

async function assertCanDm(user, peerId) {
  if (Number(peerId) === Number(user.id)) throw errors.bad('You cannot message yourself');
  const peer = await users.findOptional(peerId);
  if (!peer) throw errors.notFound('That player does not exist');
  const blocked = await db().get(
    `SELECT user_id FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`,
    [user.id, peerId, peerId, user.id],
  );
  if (blocked) throw errors.forbidden('Messages are blocked between you two');
  const friends = await db().get(`SELECT 1 AS x FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'`, [user.id, peerId]);
  if (!friends) throw errors.forbidden('You can only message friends');
  return peer;
}

function messageRow(row) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    senderId: Number(row.sender_id),
    ciphertext: row.ciphertext,
    iv: row.iv,
    tag: row.tag || '',
    meta: sql.parse(row.meta) || {},
    createdAt: Number(row.created_at || 0),
    sender: row.username ? { id: Number(row.sender_id), username: row.username, displayName: row.display_name, avatarSeed: row.avatar_seed } : null,
  };
}

async function history(channelId, { limit = 50, before = 0 } = {}) {
  const size = Math.min(100, Math.max(1, Number(limit) || 50));
  const params = [Number(channelId)];
  let where = 'm.channel_id = ?';
  if (before) { where += ' AND m.id < ?'; params.push(Number(before)); }
  const rows = await db().query(
    `SELECT m.*, u.username, u.display_name, u.avatar_seed FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE ${where} ORDER BY m.id DESC ${sql.limit(size, 0)}`,
    params,
  );
  return rows.reverse().map(messageRow);
}

/** Keep every channel bounded so history cannot grow without limit. */
async function trimChannel(channelId) {
  const keep = config.retention.messagesPerChannel;
  const rows = await db().query(`SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC ${sql.limit(1, keep)}`, [Number(channelId)]);
  if (!rows.length) return 0;
  const info = await db().run(`DELETE FROM messages WHERE channel_id = ? AND id < ?`, [Number(channelId), rows[0].id]);
  return info.changes;
}

/** Build the client shape for a message that was just written. */
function buildMessage(id, channelId, senderId, body, user) {
  const meta = { kind: body.kind, replyTo: body.replyTo || null };
  return {
    id: Number(id),
    channelId: Number(channelId),
    senderId: Number(senderId),
    ciphertext: body.ciphertext,
    iv: body.iv,
    tag: body.tag || '',
    meta,
    createdAt: Date.now(),
    sender: users.publicUser(user),
  };
}

const messageSpec = {
  ciphertext: ['blob', { maxBytes: MAX_CIPHERTEXT_BYTES, message: 'That message is too large' }],
  iv: ['blob', { maxBytes: 32, message: 'Bad encryption nonce' }],
  tag: ['blob', { maxBytes: 32, optional: true, default: '' }],
  kind: ['enum', { values: ['text', 'system', 'image'], fallback: 'text' }],
  replyTo: ['id', { optional: true }],
};

router.get('/dm/:userId', errors.wrap(async (req, res) => {
  const { userId } = validate.parse(req.params, { userId: ['id'] });
  await assertCanDm(req.user, userId);
  const channel = await ensureChannel('dm', dmKey(req.user.id, userId));
  res.json({
    channel: { id: Number(channel.id), kind: 'dm', peerId: userId },
    messages: await history(channel.id, req.query),
  });
}));

router.post('/dm/:userId', errors.wrap(async (req, res) => {
  const { userId } = validate.parse(req.params, { userId: ['id'] });
  const peer = await assertCanDm(req.user, userId);
  const body = validate.parse(req.body, messageSpec);
  const channel = await ensureChannel('dm', dmKey(req.user.id, userId));
  const id = await insertReturning('messages', ['channel_id', 'sender_id', 'ciphertext', 'iv', 'tag', 'meta', 'created_at'], [
    Number(channel.id), req.user.id, body.ciphertext, body.iv, body.tag || '', sql.json({ kind: body.kind, replyTo: body.replyTo || null }), Date.now(),
  ]);
  await trimChannel(channel.id);
  const message = buildMessage(id, channel.id, req.user.id, body, req.user);
  realtime.sendToUser(userId, { type: 'message', scope: 'dm', channelId: Number(channel.id), peerId: req.user.id, message });
  realtime.sendToUserExcept(req.user.id, req.sessionId, { type: 'message', scope: 'dm', channelId: Number(channel.id), peerId: userId, message });
  res.status(201).json({ message, peer: users.publicUser(peer) });
}));

router.get('/party/:partyId', errors.wrap(async (req, res) => {
  const { partyId } = validate.parse(req.params, { partyId: ['id'] });
  if (!await parties.isMember(partyId, req.user.id)) throw errors.forbidden('Join the room to read its chat');
  const channel = await ensureChannel('party', `party:${partyId}`, partyId);
  res.json({ channel: { id: Number(channel.id), kind: 'party', partyId }, messages: await history(channel.id, req.query) });
}));

router.post('/party/:partyId', errors.wrap(async (req, res) => {
  const { partyId } = validate.parse(req.params, { partyId: ['id'] });
  if (!await parties.isMember(partyId, req.user.id)) throw errors.forbidden('Join the room before posting in it');
  const body = validate.parse(req.body, messageSpec);
  const channel = await ensureChannel('party', `party:${partyId}`, partyId);
  const id = await insertReturning('messages', ['channel_id', 'sender_id', 'ciphertext', 'iv', 'tag', 'meta', 'created_at'], [
    Number(channel.id), req.user.id, body.ciphertext, body.iv, body.tag || '', sql.json({ kind: body.kind, replyTo: body.replyTo || null }), Date.now(),
  ]);
  await trimChannel(channel.id);
  const message = buildMessage(id, channel.id, req.user.id, body, req.user);
  realtime.broadcastToParty(partyId, { type: 'message', scope: 'party', channelId: Number(channel.id), partyId, message });
  res.status(201).json({ message });
}));

/** Global lobby: one room per game, open to everyone signed in. */
router.get('/lobby/:game', errors.wrap(async (req, res) => {
  const { game } = validate.parse(req.params, { game: ['text', { max: 32 }] });
  const key = `lobby:${game.toLowerCase()}`;
  const channel = await ensureChannel('lobby', key);
  res.json({ channel: { id: Number(channel.id), kind: 'lobby', game }, messages: await history(channel.id, req.query) });
}));

router.post('/lobby/:game', errors.wrap(async (req, res) => {
  const { game } = validate.parse(req.params, { game: ['text', { max: 32 }] });
  const key = `lobby:${game.toLowerCase()}`;
  const body = validate.parse(req.body, messageSpec);
  const channel = await ensureChannel('lobby', key);
  const budget = require('../security/rate-limit').check(`lobby:${req.user.id}`, 10, 4);
  if (!budget.allowed) throw errors.tooMany('The lobby is moving too fast for you right now', budget.retryAfter);
  const id = await insertReturning('messages', ['channel_id', 'sender_id', 'ciphertext', 'iv', 'tag', 'meta', 'created_at'], [
    Number(channel.id), req.user.id, body.ciphertext, body.iv, body.tag || '', sql.json({ kind: body.kind, replyTo: body.replyTo || null }), Date.now(),
  ]);
  await trimChannel(channel.id);
  const message = buildMessage(id, channel.id, req.user.id, body, req.user);
  realtime.broadcastToChannel(Number(channel.id), { type: 'message', scope: 'lobby', channelId: Number(channel.id), game, message });
  res.status(201).json({ message });
}));

/** Subscribe a socket to a channel so pushes arrive without polling. */
router.post('/subscribe', errors.wrap(async (req, res) => {
  const { channelId, partyId } = validate.parse(req.body, { channelId: ['id', { optional: true }], partyId: ['id', { optional: true }] });
  let id = channelId;
  if (partyId) {
    if (!await parties.isMember(partyId, req.user.id)) throw errors.forbidden('Join the room first');
    const channel = await ensureChannel('party', `party:${partyId}`, partyId);
    id = Number(channel.id);
  }
  if (!id) throw errors.bad('Give a channel or a party to subscribe to');
  realtime.subscribe(req.user.id, req.sessionId, Number(id));
  res.json({ ok: true, channelId: Number(id) });
}));

module.exports = router;
module.exports.trimChannel = trimChannel;
module.exports.history = history;
