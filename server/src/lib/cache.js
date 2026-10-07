'use strict';
/**
 * Bounded caches. Every map here has a hard entry cap and a TTL, swept on an
 * interval, so a flood of distinct IPs cannot grow the heap without limit.
 * When the cap is hit the oldest-inserted entries are evicted (Map keeps
 * insertion order, so the first key is the oldest).
 */
const { config } = require('../config');

class BoundedMap extends Map {
  constructor({ name, max = config.retention.cacheMaxEntries, ttlMs = Infinity, onEvict } = {}) {
    super();
    this.name = name;
    this.max = max;
    this.ttlMs = ttlMs;
    this.onEvict = onEvict;
    this.evictions = 0;
  }

  set(key, value) {
    if (this.has(key)) super.delete(key);
    const entry = this.ttlMs === Infinity ? { value } : { value, expires: Date.now() + this.ttlMs };
    super.set(key, entry);
    while (this.size > this.max) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      const removed = this.get(oldest.value);
      super.delete(oldest.value);
      this.evictions += 1;
      if (this.onEvict && removed) this.onEvict(oldest.value, removed.value);
    }
    return this;
  }

  get(key) {
    const entry = super.get(key);
    if (!entry) return undefined;
    if (entry.expires !== undefined && entry.expires <= Date.now()) {
      super.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return super.delete(key);
  }

  sweep(now = Date.now()) {
    if (this.ttlMs === Infinity) return 0;
    let removed = 0;
    for (const [key, entry] of this) {
      if (entry.expires !== undefined && entry.expires <= now) {
        super.delete(key);
        removed += 1;
        if (this.onEvict) this.onEvict(key, entry.value);
      }
    }
    return removed;
  }

  stats() {
    return { name: this.name, entries: this.size, cap: this.max, evictions: this.evictions };
  }
}

const registry = new Set();

function create(options) {
  const map = new BoundedMap(options);
  registry.add(map);
  return map;
}

function sweepAll() {
  const now = Date.now();
  let total = 0;
  for (const map of registry) total += map.sweep(now);
  return total;
}

function statsAll() {
  return [...registry].map((map) => map.stats());
}

/** Drop every cache entry (used by the purge endpoint). */
function clearAll() {
  let total = 0;
  for (const map of registry) {
    total += map.size;
    map.clear();
  }
  return total;
}

let sweepTimer = null;
function startSweeper() {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(() => { sweepAll(); }, config.retention.cacheSweepIntervalMs);
  sweepTimer.unref();
  return sweepTimer;
}

function stopSweeper() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

module.exports = { BoundedMap, create, sweepAll, statsAll, clearAll, startSweeper, stopSweeper };
