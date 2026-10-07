'use strict';
/**
 * Purge: everything that is cache, expired, or stale gets deleted.
 *
 * Called on a timer and from the in-app "clear space" action. It reports what
 * it removed so the settings screen can show a real number instead of a
 * promise, and the admin purge endpoint returns the same shape.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { db, sql } = require('../db');
const { config } = require('../config');
const cache = require('../lib/cache');
const logger = require('../logger');
const auth = require('../security/auth');
const rateLimit = require('../security/rate-limit');
const pow = require('../security/pow');
const audit = require('./audit');
const users = require('./users');

const DAY = 86400000;

/** Delete every message past the newest N in each channel. */
async function trimMessages() {
  const keep = config.retention.messagesPerChannel;
  const channels = await db().query(`SELECT id FROM channels ${sql.limit(1000, 0)}`);
  let removed = 0;
  for (const channel of channels) {
    const rows = await db().query(`SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC ${sql.limit(1, keep)}`, [channel.id]);
    if (!rows.length) continue;
    const info = await db().run(`DELETE FROM messages WHERE channel_id = ? AND id < ?`, [channel.id, rows[0].id]);
    removed += info.changes;
  }
  return removed;
}

async function trimPartyEvents() {
  const keep = config.retention.eventsPerParty;
  const parties = await db().query(`SELECT id FROM parties ${sql.limit(1000, 0)}`);
  let removed = 0;
  for (const party of parties) {
    const rows = await db().query(`SELECT id FROM party_events WHERE party_id = ? ORDER BY id DESC ${sql.limit(1, keep)}`, [party.id]);
    if (!rows.length) continue;
    const info = await db().run(`DELETE FROM party_events WHERE party_id = ? AND id < ?`, [party.id, rows[0].id]);
    removed += info.changes;
  }
  return removed;
}

/**
 * Full sweep. `deep` also clears in-process caches and the log ring, which is
 * what the in-app purge asks for; the scheduled run keeps the limiter state so
 * an ongoing attack is not forgiven every fifteen minutes.
 */
async function run({ deep = false } = {}) {
  const now = Date.now();
  const stats = {
    startedAt: now,
    sessionsExpired: await auth.purgeExpired(),
    notifications: (await db().run(`DELETE FROM notifications WHERE created_at < ?`, [now - 60 * DAY])).changes,
    feedItems: await users.trimFeed(),
    auditRows: await audit.trim(),
    messages: await trimMessages(),
    partyEvents: await trimPartyEvents(),
    mcSessions: (await db().run(`DELETE FROM mc_sessions WHERE left_at IS NOT NULL AND left_at < ?`, [now - 7 * DAY])).changes,
    broadcasts: (await db().run(`DELETE FROM broadcasts WHERE live = ? AND ended_at IS NOT NULL AND ended_at < ?`, [sql.bool(false), now - 14 * DAY])).changes,
    bansExpired: (await db().run(`DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at < ?`, [now])).changes,
    staleParties: (await db().run(
      `DELETE FROM parties WHERE live = ? AND updated_at < ?`,
      [sql.bool(true), now - 7 * DAY],
    )).changes,
    staleInvites: (await db().run(`DELETE FROM party_invites WHERE created_at < ?`, [now - 7 * DAY])).changes,
    staleWrappedKeys: (await db().run(`DELETE FROM wrapped_keys WHERE created_at < ?`, [now - 180 * DAY])).changes,
    cacheEntries: cache.sweepAll(),
    logRing: 0,
    logFileBytes: 0,
  };

  if (deep) {
    stats.cacheEntries += cache.clearAll();
    logger.clearRing();
    rateLimit.reset();
    pow.reset();
    const logPath = logger.logPath();
    if (logPath && fs.existsSync(logPath)) {
      try {
        stats.logFileBytes = fs.statSync(logPath).size;
        fs.writeFileSync(logPath, '');
      } catch (err) {
        logger.warn('purge: could not truncate the log file', { message: err.message });
      }
    }
  }

  stats.durationMs = Date.now() - now;
  stats.heapUsedMb = Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10;
  await db().run(`INSERT INTO purge_log (scope, stats, created_at) VALUES (?, ?, ?)`, [
    deep ? 'deep' : 'scheduled', sql.json(stats), now,
  ]);
  // Keep the purge history itself bounded.
  const rows = await db().query(`SELECT id FROM purge_log ORDER BY id DESC ${sql.limit(1, 50)}`);
  if (rows.length) await db().run(`DELETE FROM purge_log WHERE id < ?`, [rows[0].id]);

  logger.info('purge complete', stats);
  return stats;
}

/** What the client can safely be told before it wipes its own storage. */
async function report() {
  const disk = (() => {
    try {
      const usage = { tmpBytes: 0, dataBytes: 0 };
      const tmp = os.tmpdir();
      for (const entry of fs.readdirSync(tmp)) {
        if (!entry.startsWith('omlet-')) continue;
        try { usage.tmpBytes += fs.statSync(path.join(tmp, entry)).size; } catch { /* raced */ }
      }
      const dataDir = process.env.DATA_DIR || path.join(config.serverRoot, 'var');
      if (fs.existsSync(dataDir)) {
        for (const entry of fs.readdirSync(dataDir)) {
          try { usage.dataBytes += fs.statSync(path.join(dataDir, entry)).size; } catch { /* raced */ }
        }
      }
      return usage;
    } catch {
      return { tmpBytes: 0, dataBytes: 0 };
    }
  })();
  return {
    caches: cache.statsAll(),
    realtime: require('../realtime').stats(),
    logRing: logger.ringSize(),
    logFile: logger.logFile() ? logger.logPath() : null,
    heapUsedMb: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
    uptimeSeconds: Math.round(process.uptime()),
    disk,
  };
}

function startScheduler() {
  const timer = setInterval(() => {
    run({ deep: false }).catch((err) => logger.error('scheduled purge failed', { message: err.message }));
  }, config.retention.cleanupIntervalMs);
  timer.unref();
  return timer;
}

module.exports = { run, report, startScheduler, trimMessages, trimPartyEvents };
