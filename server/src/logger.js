'use strict';
/**
 * Structured logger.
 *
 * Two jobs beyond printing: redaction (secrets must not reach disk or a log
 * aggregator) and bounded retention (the in-memory ring and the on-disk log
 * both have hard caps, so a noisy attacker cannot fill the disk).
 */
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const level = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

const RING_MAX = 500;
const ring = [];
const REDACT_KEYS = /(passw|secret|token|authorization|cookie|apikey|api_key|private|credential|hash|blob|key)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 400;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const LOG_FILE = process.env.LOG_FILE || null;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'function') return '[fn]';
  if (type === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code };
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACT_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

function write(record) {
  const line = JSON.stringify(record);
  if (LOG_FILE) {
    try {
      const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
      if (stat && stat.size > MAX_FILE_BYTES) {
        // Rotate by truncation: keep the newest half. One file, one cap.
        const handle = fs.openSync(LOG_FILE, 'r+');
        const keep = Buffer.alloc(Math.floor(MAX_FILE_BYTES / 2));
        const read = fs.readSync(handle, keep, 0, keep.length, stat.size - keep.length);
        fs.ftruncateSync(handle, 0);
        fs.writeSync(handle, keep, 0, read, 0);
        fs.closeSync(handle);
      }
      fs.appendFileSync(LOG_FILE, `${line}\n`);
    } catch {
      // Logging must never take the process down.
    }
  }
  const stream = record.level === 'error' || record.level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
  ring.push(record);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function emit(lvl, message, meta) {
  if (LEVELS[lvl] < level) return;
  const record = {
    ts: new Date().toISOString(),
    level: lvl,
    msg: message,
  };
  if (meta !== undefined) record.meta = redact(meta);
  write(record);
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
  ring: () => ring.slice(-200),
  clearRing: () => { ring.length = 0; },
  ringSize: () => ring.length,
  redact,
  levelName: () => Object.keys(LEVELS).find((key) => LEVELS[key] === level),
  logFile: () => LOG_FILE,
  logPath: () => (LOG_FILE ? path.resolve(LOG_FILE) : null),
};
