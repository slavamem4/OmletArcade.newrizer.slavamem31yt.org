'use strict';
/**
 * Users: profile projection, search, presence, XP, feed.
 *
 * `publicUser` is the only shape that ever leaves the server for another user.
 * Anything added to the users table must be consciously added here too — the
 * default is that it does not leave.
 */
const { db, sql, insertReturning } = require('../db');
const { notFound } = require('../errors');
const cache = require('../lib/cache');

const XP_PER_LEVEL = 500;

// Last-seen is written on every socket ping; a bounded TTL map keeps the write
// pressure off the database and the heap off the floor.
const presenceCache = cache.create({ name: 'presence', max: 50000, ttlMs: 10 * 60 * 1000 });

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || '',
    avatarSeed: row.avatar_seed || '',
    bannerSeed: row.banner_seed || '',
    level: Number(row.level || 1),
    xp: Number(row.xp || 0),
    role: row.role === 'admin' || row.role === 'mod' ? row.role : 'user',
    presence: presenceCache.get(Number(row.id)) ? 'online' : (row.presence || 'offline'),
    e2eeEnabled: sql.asBool(row.e2ee_enabled),
    hasIdentityKey: !!row.identity_pub,
    lastSeenAt: Number(row.last_seen_at || 0),
    createdAt: Number(row.created_at || 0),
  };
}

async function findById(id) {
  const row = await db().get(`SELECT * FROM users WHERE id = ?`, [Number(id)]);
  if (!row) throw notFound('That player does not exist');
  return row;
}

async function findOptional(id) {
  return db().get(`SELECT * FROM users WHERE id = ?`, [Number(id)]);
}

async function findByUsername(username) {
  return db().get(`SELECT * FROM users WHERE username_lower = ?`, [String(username).toLowerCase()]);
}

async function search(term, limit = 20) {
  const like = `%${String(term).toLowerCase().replace(/[%_]/g, '')}%`;
  return db().query(
    `SELECT * FROM users WHERE username_lower LIKE ? AND status = 'active' ORDER BY level DESC, username ASC ${sql.limit(limit, 0)}`,
    [like],
  );
}

async function setPresence(userId, presence) {
  if (presence === 'online') presenceCache.set(Number(userId), Date.now());
  else presenceCache.delete(Number(userId));
  await db().run(`UPDATE users SET presence = ?, last_seen_at = ? WHERE id = ?`, [presence, Date.now(), Number(userId)]);
}

async function touch(userId) {
  presenceCache.set(Number(userId), Date.now());
  await db().run(`UPDATE users SET last_seen_at = ? WHERE id = ?`, [Date.now(), Number(userId)]);
}

function levelFromXp(xp) {
  return Math.max(1, Math.floor(Number(xp || 0) / XP_PER_LEVEL) + 1);
}

async function awardXp(userId, amount) {
  const row = await db().get(`SELECT xp, level FROM users WHERE id = ?`, [Number(userId)]);
  if (!row) return null;
  const xp = Number(row.xp || 0) + Math.max(0, Math.min(1000, Number(amount) || 0));
  const level = levelFromXp(xp);
  await db().run(`UPDATE users SET xp = ?, level = ? WHERE id = ?`, [xp, level, Number(userId)]);
  return { xp, level, leveledUp: level > Number(row.level || 1) };
}

async function updateProfile(userId, fields) {
  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(fields)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (!sets.length) return findById(userId);
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(Number(userId));
  await db().run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(userId);
}

async function saveSettings(userId, settings) {
  await db().run(`UPDATE users SET settings = ?, updated_at = ? WHERE id = ?`, [sql.json(settings), Date.now(), Number(userId)]);
  return sql.parse((await findById(userId)).settings) || {};
}

async function getSettings(userId) {
  const row = await db().get(`SELECT settings FROM users WHERE id = ?`, [Number(userId)]);
  return sql.parse(row && row.settings) || defaults();
}

function defaults() {
  return {
    notifications: { partyInvites: true, friendRequests: true, calls: true, messages: true, broadcasts: true },
    privacy: { friendRequests: 'everyone', calls: 'friends', discoverable: true, showPresence: true },
    voice: { inputGain: 100, outputVolume: 100, noiseSuppression: true, echoCancellation: true, autoJoin: false },
    appearance: { reduceMotion: false, compactLists: false },
    e2ee: { enforce: true, showFingerprint: true },
  };
}

/** Deep-merge a patch onto the defaults, dropping unknown keys. */
function mergeSettings(current, patch) {
  const base = { ...defaults(), ...(current || {}) };
  if (!patch || typeof patch !== 'object') return base;
  for (const [section, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(base, section)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && base[section] && typeof base[section] === 'object') {
      const next = { ...base[section] };
      for (const [key, item] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(base[section], key)) continue;
        if (typeof item !== typeof base[section][key]) continue;
        next[key] = item;
      }
      base[section] = next;
    }
  }
  return base;
}

/* ------------------------------------------------------------------- feed */

async function addFeedItem(userId, kind, payload) {
  const id = await insertReturning('feed_items', ['user_id', 'kind', 'payload', 'created_at'], [
    Number(userId), kind, sql.json(payload || {}), Date.now(),
  ]);
  await trimFeed();
  return id;
}

/** Keep the feed table bounded: drop rows past the newest N. */
async function trimFeed() {
  const keep = require('../config').config.retention.feedItems;
  const rows = await db().query(`SELECT id FROM feed_items ORDER BY id DESC ${sql.limit(1, keep)}`);
  if (!rows.length) return 0;
  const info = await db().run(`DELETE FROM feed_items WHERE id < ?`, [rows[0].id]);
  return info.changes;
}

async function feedFor(userId, { limit = 30, before = 0 } = {}) {
  const friends = await db().query(
    `SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'`,
    [Number(userId)],
  );
  const ids = friends.map((row) => Number(row.friend_id));
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(', ');
  const params = [...ids];
  let where = `user_id IN (${marks})`;
  if (before) { where += ' AND id < ?'; params.push(Number(before)); }
  const size = Math.min(50, Math.max(1, Number(limit) || 30));
  return db().query(`SELECT * FROM feed_items WHERE ${where} ORDER BY id DESC ${sql.limit(size, 0)}`, params);
}

module.exports = {
  publicUser, findById, findOptional, findByUsername, search, setPresence, touch,
  awardXp, levelFromXp, updateProfile, saveSettings, getSettings, mergeSettings, defaults,
  addFeedItem, trimFeed, feedFor, presenceCache, XP_PER_LEVEL,
};
