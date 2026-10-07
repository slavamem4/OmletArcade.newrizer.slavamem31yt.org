'use strict';
/**
 * Parties (voice rooms), Minecraft crews and broadcasts.
 *
 * A party is a row plus a LiveKit room name. Membership is the only thing that
 * authorises a LiveKit token: `join` writes the membership, `voiceToken` checks
 * it. The two are deliberately separate functions so the token path can never
 * be reached without a membership check having run in the same request.
 */
const { db, sql, insertReturning } = require('../db');
const { config } = require('../config');
const { bad, forbidden, notFound, conflict } = require('../errors');
const { shortId } = require('../crypto');
const users = require('./users');
const audit = require('./audit');

const KINDS = ['party', 'call', 'minecraft', 'broadcast'];

async function findById(id) {
  const row = await db().get(`SELECT * FROM parties WHERE id = ?`, [Number(id)]);
  if (!row) throw notFound('That room is gone');
  return row;
}

async function members(partyId) {
  return db().query(
    `SELECT m.user_id, m.role, m.joined_at, u.username, u.display_name, u.avatar_seed, u.level, u.presence, u.last_seen_at, u.e2ee_enabled
     FROM party_members m JOIN users u ON u.id = m.user_id
     WHERE m.party_id = ? ORDER BY m.joined_at ASC`,
    [Number(partyId)],
  );
}

async function isMember(partyId, userId) {
  const row = await db().get(`SELECT user_id FROM party_members WHERE party_id = ? AND user_id = ?`, [Number(partyId), Number(userId)]);
  return !!row;
}

async function create({ ownerId, name, kind = 'party', game = '', maxMembers = 8, locked = false, mcServerId = null, meta = {} }) {
  if (!KINDS.includes(kind)) throw bad('Unknown room kind');
  const cleanName = (name || '').trim();
  if (!cleanName || cleanName.length > 48) throw bad('Give the room a name of 48 characters or fewer');
  const owner = await users.findById(ownerId);

  // One live room per owner per kind: stops a single account flooding the list.
  const existing = await db().get(
    `SELECT id FROM parties WHERE owner_id = ? AND kind = ? AND live = ?`,
    [Number(ownerId), kind, sql.bool(true)],
  );
  if (existing && kind !== 'call') await close(existing.id, ownerId, { silent: true });

  const roomName = kind === 'party' ? `party-${Date.now().toString(36)}${shortId(3)}` : `${kind}-${Date.now().toString(36)}${shortId(3)}`;
  const id = await insertReturning('parties',
    ['code', 'name', 'kind', 'owner_id', 'game', 'room_name', 'e2ee', 'locked', 'max_members', 'mc_server_id', 'meta', 'live', 'created_at', 'updated_at'],
    [
      shortId(5).toUpperCase(),
      cleanName,
      kind,
      Number(ownerId),
      String(game || '').slice(0, 48),
      roomName,
      sql.bool(config.e2ee.required),
      sql.bool(locked),
      Math.min(50, Math.max(2, Number(maxMembers) || 8)),
      mcServerId,
      sql.json(meta || {}),
      sql.bool(true),
      Date.now(),
      Date.now(),
    ]);
  await db().run(`INSERT INTO party_members (party_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`, [id, Number(ownerId), Date.now()]);
  await addEvent(id, ownerId, 'created', { name: cleanName, kind });
  await users.addFeedItem(ownerId, 'party_created', { partyId: id, name: cleanName, game });
  return findById(id);
}

async function addEvent(partyId, userId, kind, payload = {}) {
  await db().run(`INSERT INTO party_events (party_id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`, [
    Number(partyId), userId, String(kind).slice(0, 32), sql.json(payload), Date.now(),
  ]);
  // Bounded history per party.
  const rows = await db().query(`SELECT id FROM party_events WHERE party_id = ? ORDER BY id DESC ${sql.limit(1, config.retention.eventsPerParty)}`, [Number(partyId)]);
  if (rows.length) await db().run(`DELETE FROM party_events WHERE party_id = ? AND id < ?`, [Number(partyId), rows[0].id]);
}

async function events(partyId, limit = 50) {
  const size = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = await db().query(
    `SELECT e.*, u.username, u.display_name, u.avatar_seed FROM party_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.party_id = ? ORDER BY e.id DESC ${sql.limit(size, 0)}`,
    [Number(partyId)],
  );
  return rows.reverse();
}

async function list({ kind = null, limit = 30 } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 30));
  const params = [sql.bool(true)];
  let where = 'p.live = ?';
  if (kind) { where += ' AND p.kind = ?'; params.push(kind); }
  return db().query(
    `SELECT p.*, u.username AS owner_username, u.display_name AS owner_name, u.avatar_seed AS owner_avatar,
       (SELECT COUNT(*) FROM party_members m WHERE m.party_id = p.id) AS member_count
     FROM parties p JOIN users u ON u.id = p.owner_id
     WHERE ${where} ORDER BY p.updated_at DESC ${sql.limit(size, 0)}`,
    params,
  );
}

async function join(partyId, userId, { invited = false } = {}) {
  const party = await findById(partyId);
  if (!sql.asBool(party.live)) throw conflict('That room is closed');
  if (await isMember(partyId, userId)) return party;

  const count = await db().get(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`, [Number(partyId)]);
  if (Number(count.n) >= Number(party.max_members)) throw conflict('That room is full');
  if (sql.asBool(party.locked) && !invited && Number(party.owner_id) !== Number(userId)) throw forbidden('That room is invite only');

  // Blocked either way round means no shared room.
  const blocked = await db().get(
    `SELECT 1 AS x FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`,
    [Number(party.owner_id), Number(userId), Number(userId), Number(party.owner_id)],
  );
  if (blocked) throw forbidden('You cannot join this room');

  await db().run(`INSERT INTO party_members (party_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`, [Number(partyId), Number(userId), Date.now()]);
  await db().run(`UPDATE parties SET updated_at = ? WHERE id = ?`, [Date.now(), Number(partyId)]);
  await addEvent(partyId, userId, 'joined');
  await users.awardXp(userId, 10);
  return party;
}

async function leave(partyId, userId) {
  const party = await findById(partyId);
  const info = await db().run(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`, [Number(partyId), Number(userId)]);
  if (!info.changes) return { closed: false };
  await addEvent(partyId, userId, 'left');

  const remaining = await db().get(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`, [Number(partyId)]);
  if (Number(remaining.n) === 0) {
    await close(partyId, userId, { silent: true });
    return { closed: true };
  }
  if (Number(party.owner_id) === Number(userId)) {
    const next = await db().get(`SELECT user_id FROM party_members WHERE party_id = ? ORDER BY joined_at ASC ${sql.limit(1, 0)}`, [Number(partyId)]);
    if (next) {
      await db().run(`UPDATE parties SET owner_id = ?, updated_at = ? WHERE id = ?`, [next.user_id, Date.now(), Number(partyId)]);
      await db().run(`UPDATE party_members SET role = 'owner' WHERE party_id = ? AND user_id = ?`, [Number(partyId), next.user_id]);
      await db().run(`UPDATE party_members SET role = 'member' WHERE party_id = ? AND user_id != ?`, [Number(partyId), next.user_id]);
      await addEvent(partyId, next.user_id, 'promoted');
    }
  }
  return { closed: false };
}

async function close(partyId, userId, { silent = false } = {}) {
  const party = await findById(partyId);
  const isOwner = Number(party.owner_id) === Number(userId);
  const requester = await users.findOptional(userId);
  const isStaff = requester && (requester.role === 'admin' || requester.role === 'mod');
  if (!isOwner && !isStaff && !silent) throw forbidden('Only the host can close this room');
  await db().run(`UPDATE parties SET live = ?, updated_at = ? WHERE id = ?`, [sql.bool(false), Date.now(), Number(partyId)]);
  await db().run(`DELETE FROM party_members WHERE party_id = ?`, [Number(partyId)]);
  await db().run(`DELETE FROM party_invites WHERE party_id = ?`, [Number(partyId)]);
  await addEvent(partyId, userId, 'closed');
  return { closed: true };
}

async function invite(partyId, inviterId, inviteeId) {
  if (Number(inviterId) === Number(inviteeId)) throw bad('You are already in the room');
  if (!await isMember(partyId, inviterId)) throw forbidden('Join the room before inviting to it');
  const invitee = await users.findOptional(inviteeId);
  if (!invitee) throw notFound('That player does not exist');
  const blocked = await db().get(`SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?`, [Number(inviteeId), Number(inviterId)]);
  if (blocked) throw forbidden('That player is not accepting invites from you');
  await db().run(
    sql.upsert('party_invites', ['party_id', 'inviter_id', 'invitee_id', 'created_at'], ['party_id', 'invitee_id'], ['inviter_id', 'created_at']),
    [Number(partyId), Number(inviterId), Number(inviteeId), Date.now()],
  );
  await db().run(`INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'party_invite', ?, ?)`, [
    Number(inviteeId), sql.json({ partyId: Number(partyId), inviterId: Number(inviterId) }), Date.now(),
  ]);
  return { ok: true };
}

async function pendingInvites(userId) {
  return db().query(
    `SELECT i.*, p.name AS party_name, p.kind AS party_kind, p.code AS party_code, u.username AS inviter_name, u.display_name AS inviter_display
     FROM party_invites i JOIN parties p ON p.id = i.party_id JOIN users u ON u.id = i.inviter_id
     WHERE i.invitee_id = ? ORDER BY i.created_at DESC ${sql.limit(50, 0)}`,
    [Number(userId)],
  );
}

async function kick(partyId, actorId, targetId) {
  const party = await findById(partyId);
  if (Number(party.owner_id) !== Number(actorId)) throw forbidden('Only the host can remove someone');
  if (Number(targetId) === Number(actorId)) throw bad('Use leave to remove yourself');
  const info = await db().run(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`, [Number(partyId), Number(targetId)]);
  if (!info.changes) throw notFound('They are not in the room');
  await addEvent(partyId, actorId, 'kicked', { userId: Number(targetId) });
  await audit.record({ actorId, action: 'party.kick', target: `${partyId}:${targetId}` });
  return { ok: true };
}

async function update(partyId, actorId, patch) {
  const party = await findById(partyId);
  if (Number(party.owner_id) !== Number(actorId)) throw forbidden('Only the host can change the room');
  const sets = [];
  const params = [];
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(String(patch.name).slice(0, 48)); }
  if (patch.game !== undefined) { sets.push('game = ?'); params.push(String(patch.game).slice(0, 48)); }
  if (patch.locked !== undefined) { sets.push('locked = ?'); params.push(sql.bool(patch.locked)); }
  if (patch.maxMembers !== undefined) { sets.push('max_members = ?'); params.push(Math.min(50, Math.max(2, Number(patch.maxMembers) || 8))); }
  if (!sets.length) return party;
  sets.push('updated_at = ?');
  params.push(Date.now(), Number(partyId));
  await db().run(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(partyId);
}

/** Shape a party row for a client, including membership state. */
async function view(party, viewerId) {
  const rows = await members(party.id);
  const invites = await db().get(`SELECT COUNT(*) AS n FROM party_invites WHERE party_id = ?`, [Number(party.id)]);
  return {
    id: Number(party.id),
    code: party.code,
    name: party.name,
    kind: party.kind,
    game: party.game,
    live: sql.asBool(party.live),
    locked: sql.asBool(party.locked),
    e2ee: sql.asBool(party.e2ee),
    maxMembers: Number(party.max_members),
    ownerId: Number(party.owner_id),
    mcServerId: party.mc_server_id ? Number(party.mc_server_id) : null,
    meta: sql.parse(party.meta) || {},
    createdAt: Number(party.created_at || 0),
    memberCount: rows.length,
    pendingInvites: Number(invites && invites.n || 0),
    isMember: viewerId ? rows.some((row) => Number(row.user_id) === Number(viewerId)) : false,
    isOwner: viewerId ? Number(party.owner_id) === Number(viewerId) : false,
    members: rows.map((row) => ({
      id: Number(row.user_id),
      username: row.username,
      displayName: row.display_name,
      avatarSeed: row.avatar_seed,
      level: Number(row.level || 1),
      role: row.role,
      presence: users.presenceCache.get(Number(row.user_id)) ? 'online' : (row.presence || 'offline'),
      lastSeenAt: Number(row.last_seen_at || 0),
    })),
  };
}

module.exports = {
  findById, members, isMember, create, join, leave, close, invite, pendingInvites, kick, update, view, events, addEvent, list, KINDS,
};
