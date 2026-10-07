'use strict';
/**
 * Minecraft hosting.
 *
 * What this server does: keeps the registry of who hosts what, runs the voice
 * room for the crew, tracks who is in the world, and hands out a hardened host
 * pack. It never runs a game server itself and never dials a player's address —
 * the address is stored and displayed, nothing more.
 */
const express = require('express');
const { db, sql, insertReturning } = require('../db');
const { config } = require('../config');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const parties = require('../services/parties');
const users = require('../services/users');
const livekit = require('../services/livekit');
const realtime = require('../realtime');
const audit = require('../services/audit');
const zip = require('../lib/zip');
const pack = require('../services/mc-pack');

const router = express.Router();
router.use(auth.required());

const EDITIONS = ['bedrock', 'java'];

function view(row) {
  return {
    id: Number(row.id),
    name: row.name,
    address: row.address,
    port: Number(row.port),
    edition: row.edition,
    version: row.version || '',
    maxPlayers: Number(row.max_players),
    motd: row.motd || '',
    visibility: row.visibility,
    status: row.status,
    ownerId: Number(row.owner_id),
    partyId: row.party_id ? Number(row.party_id) : null,
    meta: sql.parse(row.meta) || {},
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function findById(id) {
  const row = await db().get(`SELECT * FROM mc_servers WHERE id = ?`, [Number(id)]);
  if (!row) throw errors.notFound('That server is gone');
  return row;
}

async function players(serverId) {
  return db().query(
    `SELECT s.*, u.username, u.display_name, u.avatar_seed FROM mc_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.server_id = ? AND s.left_at IS NULL ORDER BY s.joined_at ASC`,
    [Number(serverId)],
  );
}

router.get('/', errors.wrap(async (req, res) => {
  const rows = await db().query(
    `SELECT s.*, u.username AS owner_username, u.display_name AS owner_name,
       (SELECT COUNT(*) FROM mc_sessions x WHERE x.server_id = s.id AND x.left_at IS NULL) AS in_world
     FROM mc_servers s JOIN users u ON u.id = s.owner_id
     WHERE s.visibility IN ('public', 'friends') OR s.owner_id = ?
     ORDER BY s.updated_at DESC ${sql.limit(50, 0)}`,
    [req.user.id],
  );
  const out = [];
  for (const row of rows) {
    if (row.visibility === 'friends' && Number(row.owner_id) !== req.user.id) {
      const friends = await db().get(`SELECT 1 AS x FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'`, [req.user.id, row.owner_id]);
      if (!friends) continue;
    }
    out.push({ ...view(row), owner: { id: Number(row.owner_id), username: row.owner_username, displayName: row.owner_name }, inWorld: Number(row.in_world || 0) });
  }
  res.json({ servers: out });
}));

router.post('/', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    name: ['text', { max: 40, message: 'Server name must be 40 characters or fewer' }],
    address: ['address', { message: 'Enter a valid address: name, IPv4 or [IPv6]' }],
    port: ['int', { min: 1, max: 65535, fallback: 19132 }],
    edition: ['enum', { values: EDITIONS, fallback: 'bedrock' }],
    version: ['text', { optional: true, max: 24, default: '' }],
    maxPlayers: ['int', { min: 2, max: config.minecraft.maxSlots, fallback: 10 }],
    motd: ['text', { optional: true, max: 80, default: '' }],
    visibility: ['enum', { values: ['private', 'friends', 'public'], fallback: 'friends' }],
  });

  const mine = await db().get(`SELECT COUNT(*) AS n FROM mc_servers WHERE owner_id = ?`, [req.user.id]);
  if (Number(mine.n) >= config.minecraft.maxServersPerUser) {
    throw errors.conflict(`You can host up to ${config.minecraft.maxServersPerUser} servers`);
  }

  const id = await insertReturning('mc_servers',
    ['owner_id', 'name', 'address', 'port', 'edition', 'version', 'max_players', 'motd', 'visibility', 'status', 'meta', 'created_at', 'updated_at'],
    [req.user.id, body.name, body.address, body.port, body.edition, body.version || '', body.maxPlayers, body.motd || '', body.visibility, 'stopped', sql.json({}), Date.now(), Date.now()]);

  const party = await parties.create({
    ownerId: req.user.id,
    name: body.name,
    kind: 'minecraft',
    game: 'Minecraft',
    maxMembers: Math.min(50, body.maxPlayers + 2),
    mcServerId: id,
    meta: { serverId: id, address: body.address, port: body.port, edition: body.edition },
  });
  await db().run(`UPDATE mc_servers SET party_id = ? WHERE id = ?`, [party.id, id]);
  await users.addFeedItem(req.user.id, 'mc_hosting', { serverId: id, name: body.name, edition: body.edition });
  await audit.record({ actorId: req.user.id, action: 'mc.create', target: String(id), ip: req.clientIp });
  res.status(201).json({ server: view(await findById(id)), party: await parties.view(party, req.user.id) });
}));

router.get('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await findById(id);
  const owner = await users.findById(row.owner_id);
  const rows = await players(id);
  const party = row.party_id ? await parties.findById(row.party_id) : null;
  res.json({
    server: view(row),
    owner: users.publicUser(owner),
    players: rows.map((item) => ({
      id: Number(item.user_id), username: item.username, displayName: item.display_name,
      avatarSeed: item.avatar_seed, player: item.player, joinedAt: Number(item.joined_at || 0),
    })),
    party: party ? await parties.view(party, req.user.id) : null,
  });
}));

router.patch('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await findById(id);
  if (Number(row.owner_id) !== req.user.id) throw errors.forbidden('Only the host can change the server');
  const patch = validate.parse(req.body, {
    name: ['text', { optional: true, max: 40 }],
    address: ['address', { optional: true }],
    port: ['int', { optional: true, min: 1, max: 65535 }],
    version: ['text', { optional: true, max: 24 }],
    maxPlayers: ['int', { optional: true, min: 2, max: config.minecraft.maxSlots }],
    motd: ['text', { optional: true, max: 80 }],
    visibility: ['enum', { optional: true, values: ['private', 'friends', 'public'] }],
    status: ['enum', { optional: true, values: ['stopped', 'starting', 'running'] }],
  });
  const columns = { name: 'name', address: 'address', port: 'port', version: 'version', maxPlayers: 'max_players', motd: 'motd', visibility: 'visibility', status: 'status' };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] === undefined || patch[key] === null) continue;
    sets.push(`${column} = ?`);
    params.push(patch[key]);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(Date.now(), id);
    await db().run(`UPDATE mc_servers SET ${sets.join(', ')} WHERE id = ?`, params);
    if (row.party_id) {
      const meta = { ...(sql.parse(row.meta) || {}), address: patch.address || row.address, port: patch.port || row.port };
      const partyMeta = { ...(sql.parse((await parties.findById(row.party_id)).meta) || {}), address: meta.address, port: meta.port };
      await db().run(`UPDATE mc_servers SET meta = ? WHERE id = ?`, [sql.json(meta), id]);
      await db().run(`UPDATE parties SET meta = ?, updated_at = ? WHERE id = ?`, [sql.json(partyMeta), Date.now(), row.party_id]);
      if (patch.name) await parties.update(row.party_id, req.user.id, { name: patch.name });
      realtime.broadcastToParty(row.party_id, { type: 'mc.updated', serverId: id, server: view(await findById(id)) });
    }
  }
  res.json({ server: view(await findById(id)) });
}));

router.delete('/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await findById(id);
  if (Number(row.owner_id) !== req.user.id && req.user.role !== 'admin') throw errors.forbidden('Only the host can remove the server');
  if (row.party_id) await parties.close(row.party_id, req.user.id, { silent: true });
  await db().run(`DELETE FROM mc_sessions WHERE server_id = ?`, [id]);
  await db().run(`DELETE FROM mc_servers WHERE id = ?`, [id]);
  await audit.record({ actorId: req.user.id, action: 'mc.delete', target: String(id), ip: req.clientIp });
  res.json({ ok: true });
}));

router.post('/:id/join', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const { player } = validate.parse(req.body || {}, { player: ['text', { optional: true, max: 16, default: '' }] });
  const row = await findById(id);
  const active = await players(id);
  if (active.length >= Number(row.max_players)) throw errors.conflict('The world is full');
  await db().run(`DELETE FROM mc_sessions WHERE server_id = ? AND user_id = ? AND left_at IS NULL`, [id, req.user.id]);
  await insertReturning('mc_sessions', ['server_id', 'user_id', 'player', 'joined_at'], [id, req.user.id, player || req.user.username, Date.now()]);
  if (row.party_id) {
    try { await parties.join(row.party_id, req.user.id, { invited: true }); } catch { /* voice is optional */ }
    realtime.broadcastToParty(row.party_id, { type: 'mc.player_joined', serverId: id, userId: req.user.id, username: req.user.username });
  }
  res.json({ ok: true, server: view(row), players: (await players(id)).length });
}));

router.post('/:id/leave', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  await db().run(`UPDATE mc_sessions SET left_at = ? WHERE server_id = ? AND user_id = ? AND left_at IS NULL`, [Date.now(), id, req.user.id]);
  const row = await findById(id);
  if (row.party_id) {
    await parties.leave(row.party_id, req.user.id);
    realtime.broadcastToParty(row.party_id, { type: 'mc.player_left', serverId: id, userId: req.user.id });
  }
  res.json({ ok: true });
}));

/** Voice token for the crew room, minted only for a session or membership. */
router.post('/:id/voice', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await findById(id);
  if (!row.party_id) throw errors.conflict('That server has no voice room');
  const party = await parties.findById(row.party_id);
  if (!sql.asBool(party.live)) throw errors.conflict('The voice room is closed');
  if (!await parties.isMember(row.party_id, req.user.id)) throw errors.forbidden('Join the server first');
  const muted = realtime.isMuted(row.party_id, req.user.id);
  const grant = await livekit.issueToken({
    userId: req.user.id,
    username: req.user.display_name,
    room: party.room_name,
    canPublish: !muted,
    canSubscribe: true,
    metadata: { serverId: id, partyId: Number(row.party_id), e2ee: sql.asBool(party.e2ee) },
  });
  res.json({ ...grant, e2ee: sql.asBool(party.e2ee), serverId: id, partyId: Number(row.party_id) });
}));

/** Trims finished sessions; called by the cleanup loop. */
async function purgeSessions() {
  const info = await db().run(`DELETE FROM mc_sessions WHERE left_at IS NOT NULL AND left_at < ?`, [Date.now() - 7 * 86400000]);
  return info.changes;
}

/** The hardened host pack: config, watchdog, firewall and abuse rules. */
router.get('/pack/host.zip', errors.wrap(async (req, res) => {
  const query = validate.parse(req.query, {
    name: ['text', { optional: true, max: 40, default: 'Omlet Arcade Server' }],
    motd: ['text', { optional: true, max: 80, default: 'Hosted with Omlet Arcade' }],
    maxPlayers: ['int', { optional: true, min: 2, max: config.minecraft.maxSlots, default: 10 }],
    port: ['int', { optional: true, min: 1, max: 65535, default: 19132 }],
    edition: ['enum', { values: EDITIONS, fallback: 'bedrock' }],
  });
  const files = pack.build(query);
  const body = zip.create(files);
  await audit.record({ actorId: req.user.id, action: 'mc.pack_download', ip: req.clientIp });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="omlet-host-pack.zip"');
  res.set('Content-Length', String(body.length));
  res.end(body);
}));

module.exports = router;
module.exports.purgeSessions = purgeSessions;
module.exports.view = view;
