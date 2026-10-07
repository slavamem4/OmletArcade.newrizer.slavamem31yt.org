'use strict';
/**
 * /api/parties — voice rooms.
 *
 * The only endpoint that returns a LiveKit token is POST /:id/voice, and it
 * re-checks membership inside the same request that mints the token.
 */
const express = require('express');
const parties = require('../services/parties');
const livekit = require('../services/livekit');
const users = require('../services/users');
const validate = require('../lib/validate');
const errors = require('../errors');
const { sql } = require('../db');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const realtime = require('../realtime');

const router = express.Router();
router.use(auth.required());

router.get('/', errors.wrap(async (req, res) => {
  const kind = validate.parse(req.query, { kind: ['enum', { optional: true, values: parties.KINDS }] }).kind;
  const rows = await parties.list({ kind, limit: Number(req.query.limit) || 30 });
  res.json({ parties: await Promise.all(rows.map((row) => parties.view(row, req.user.id))) });
}));

router.get('/invites', errors.wrap(async (req, res) => {
  const rows = await parties.pendingInvites(req.user.id);
  res.json({
    invites: rows.map((row) => ({
      id: Number(row.id),
      partyId: Number(row.party_id),
      partyName: row.party_name,
      partyKind: row.party_kind,
      partyCode: row.party_code,
      inviter: { id: Number(row.inviter_id), username: row.inviter_name, displayName: row.inviter_display },
      createdAt: Number(row.created_at || 0),
    })),
  });
}));

router.post('/', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    name: ['text', { max: 48, message: 'Room name must be 48 characters or fewer' }],
    game: ['text', { optional: true, max: 48, default: '' }],
    kind: ['enum', { values: ['party', 'minecraft'], fallback: 'party' }],
    maxMembers: ['int', { min: 2, max: 50, fallback: 8 }],
    locked: ['bool', { fallback: false }],
    mcServerId: ['id', { optional: true }],
  });
  const party = await parties.create({ ...body, ownerId: req.user.id });
  await audit.record({ actorId: req.user.id, action: 'party.create', target: String(party.id), ip: req.clientIp });
  res.status(201).json({ party: await parties.view(party, req.user.id) });
}));

router.get('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  res.json({ party: await parties.view(party, req.user.id), events: await parties.events(id, 30) });
}));

router.patch('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const patch = validate.parse(req.body, {
    name: ['text', { optional: true, max: 48 }],
    game: ['text', { optional: true, max: 48 }],
    locked: ['bool', { optional: true }],
    maxMembers: ['int', { optional: true, min: 2, max: 50 }],
  });
  const party = await parties.update(id, req.user.id, patch);
  const view = await parties.view(party, req.user.id);
  realtime.broadcastToParty(id, { type: 'party.updated', party: view });
  res.json({ party: view });
}));

router.post('/:id/join', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const inviteId = validate.parse(req.body || {}, { inviteId: ['id', { optional: true }] }).inviteId;
  if (inviteId) {
    const { db } = require('../db');
    await db().run(`DELETE FROM party_invites WHERE id = ? AND invitee_id = ?`, [inviteId, req.user.id]);
  }
  const party = await parties.join(id, req.user.id, { invited: !!inviteId });
  const view = await parties.view(party, req.user.id);
  realtime.broadcastToParty(id, { type: 'party.member_joined', partyId: id, member: view.members[view.members.length - 1] });
  realtime.notifyFriends(req.user.id, { type: 'presence.party', userId: req.user.id, username: req.user.username, partyId: id });
  res.json({ party: view });
}));

router.post('/:id/leave', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const result = await parties.leave(id, req.user.id);
  realtime.broadcastToParty(id, { type: 'party.member_left', partyId: id, userId: req.user.id, closed: result.closed });
  res.json(result);
}));

router.delete('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const party = await parties.findById(id);
  const memberIds = (await parties.members(id)).map((row) => Number(row.user_id));
  await parties.close(id, req.user.id);
  for (const memberId of memberIds) realtime.sendToUser(memberId, { type: 'party.closed', partyId: id });
  await audit.record({ actorId: req.user.id, action: 'party.close', target: String(party.id), ip: req.clientIp });
  res.json({ ok: true });
}));

router.post('/:id/invite', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { userId } = validate.parse(req.body, { userId: ['id'] });
  await parties.invite(id, req.user.id, userId);
  realtime.sendToUser(userId, {
    type: 'party.invite',
    partyId: id,
    inviter: { id: req.user.id, username: req.user.username, displayName: req.user.display_name },
  });
  res.json({ ok: true });
}));

router.post('/:id/kick', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { userId } = validate.parse(req.body, { userId: ['id'] });
  await parties.kick(id, req.user.id, userId);
  realtime.sendToUser(userId, { type: 'party.kicked', partyId: id });
  realtime.broadcastToParty(id, { type: 'party.member_left', partyId: id, userId, closed: false });
  res.json({ ok: true });
}));

router.get('/:id/events', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  if (!await parties.isMember(id, req.user.id)) throw errors.forbidden('Join the room to read its activity');
  const rows = await parties.events(id, Number(req.query.limit) || 50);
  res.json({
    events: rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      payload: sql.parse(row.payload) || {},
      user: row.username ? { id: Number(row.user_id), username: row.username, displayName: row.display_name, avatarSeed: row.avatar_seed } : null,
      createdAt: Number(row.created_at || 0),
    })),
  });
}));

/**
 * Mint a LiveKit token. Membership is re-checked here, not trusted from the
 * client, and the token is scoped to this room only.
 */
router.post('/:id/voice', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { publish } = validate.parse(req.body || {}, { publish: ['bool', { fallback: true }] });
  const party = await parties.findById(id);
  if (!sql.asBool(party.live)) throw errors.conflict('That room is closed');
  if (!await parties.isMember(id, req.user.id)) throw errors.forbidden('Join the room before opening the mic');

  // A moderator mute is enforced server side by withholding the publish grant.
  const muted = require('../realtime').isMuted(id, req.user.id);
  const canPublish = publish && !muted;
  const grant = await livekit.issueToken({
    userId: req.user.id,
    username: req.user.display_name,
    room: party.room_name,
    canPublish,
    canSubscribe: true,
    metadata: { partyId: id, role: Number(party.owner_id) === req.user.id ? 'host' : 'member', e2ee: sql.asBool(party.e2ee) },
  });
  await users.touch(req.user.id);
  res.json({ ...grant, e2ee: sql.asBool(party.e2ee), partyId: id });
}));

module.exports = router;
