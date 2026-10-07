'use strict';
/**
 * Audit trail. Bounded: the cleanup loop trims it to the newest N rows, so an
 * attacker hammering audited endpoints cannot grow the table without limit.
 */
const { db, sql } = require('../db');
const { config } = require('../config');
const logger = require('../logger');

async function record({ actorId = null, action, target = '', ip = '', detail = null }) {
  try {
    await db().run(
      `INSERT INTO audit_log (actor_id, action, target, ip, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [actorId, String(action).slice(0, 64), String(target).slice(0, 120), String(ip).slice(0, 64), sql.json(detail), Date.now()],
    );
  } catch (err) {
    // Auditing must never fail the request it is describing.
    logger.warn('audit write failed', { action, message: err.message });
  }
}

async function recent(limit = 100) {
  const size = Math.min(500, Math.max(1, Number(limit) || 100));
  return db().query(`SELECT * FROM audit_log ORDER BY id DESC ${sql.limit(size, 0)}`);
}

async function trim() {
  const keep = config.retention.auditRows;
  const rows = await db().query(`SELECT id FROM audit_log ORDER BY id DESC ${sql.limit(1, keep)}`);
  if (!rows.length) return 0;
  const info = await db().run(`DELETE FROM audit_log WHERE id < ?`, [rows[0].id]);
  return info.changes;
}

module.exports = { record, recent, trim };
