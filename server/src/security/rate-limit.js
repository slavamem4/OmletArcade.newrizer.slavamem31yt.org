'use strict';
/**
 * Anti-DDoS layer 1: adaptive budgets.
 *
 * Three things run here, in order, for every request:
 *   1. a hard temporary ban check (per IP),
 *   2. a token-bucket budget (per IP, and per account when signed in),
 *   3. penalty accounting that escalates: budget blown -> strike -> ban whose
 *      length doubles per strike -> proof-of-work challenge before the ban
 *      lifts (see ./pow.js).
 *
 * State is in-process and bounded (cache.js): a flood of distinct IPs cannot
 * grow the heap, the oldest entries are evicted, and a restart clears bans,
 * which is the correct trade for a single-instance web service.
 */
const cache = require('../lib/cache');

const buckets = cache.create({ name: 'rl:buckets', max: 60000, ttlMs: 24 * 60 * 60 * 1000 });
const concurrent = new Set();

const MAX_BAN_SECONDS = 24 * 60 * 60;

class Bucket {
  constructor(limit, burst) {
    this.limit = limit;
    this.burst = burst;
    this.tokens = burst;
    this.ts = Date.now();
    this.hits = 0;
    this.strikes = 0;
    this.banUntil = 0;
    this.penaltyUntil = 0;
    this.blocked = 0;
  }

  refill(now) {
    const elapsed = (now - this.ts) / 1000;
    if (elapsed <= 0) return;
    this.ts = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * (this.limit / 60));
  }

  /** @returns {{allowed:boolean, retryAfter:number, reason:string}} */
  take(now, cost = 1) {
    if (this.banUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((this.banUntil - now) / 1000), reason: 'banned' };
    }
    this.refill(now);
    this.hits += 1;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true, retryAfter: 0, reason: 'ok' };
    }
    this.blocked += 1;
    const retryAfter = Math.max(1, Math.ceil(((cost - this.tokens) / (this.limit / 60))));
    return { allowed: false, retryAfter, reason: 'budget' };
  }

  escalate(now) {
    this.strikes += 1;
    const seconds = Math.min(MAX_BAN_SECONDS, 60 * 2 ** Math.min(this.strikes, 10));
    this.banUntil = now + seconds * 1000;
    return seconds;
  }
}

function bucketFor(key, limit, burst) {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = new Bucket(limit, burst);
    buckets.set(key, bucket);
  }
  return bucket;
}

function checkIp(ip, limits) {
  return bucketFor(`ip:${ip}`, limits.ipPerMinute, limits.ipBurst).take(Date.now());
}

function checkUser(userId, limits) {
  return bucketFor(`user:${userId}`, limits.userPerMinute, limits.userBurst).take(Date.now());
}

function check(key, limit, burst, cost = 1) {
  return bucketFor(key, limit, burst).take(Date.now(), cost);
}

/**
 * Record an abuse event. Returns the ban length in seconds (0 when the strike
 * did not escalate to a ban yet).
 */
function penalize(key, limits, { immediate = false } = {}) {
  const bucket = bucketFor(key, limits.ipPerMinute, limits.ipBurst);
  const now = Date.now();
  if (immediate) return bucket.escalate(now);
  // A single blown budget is a warning; repeated ones are an attack.
  if (bucket.blocked >= limits.ipBanThreshold) {
    bucket.blocked = 0;
    return bucket.escalate(now);
  }
  return 0;
}

function banNow(key, seconds) {
  const bucket = bucketFor(key, 1, 1);
  bucket.banUntil = Date.now() + seconds * 1000;
  bucket.strikes = Math.max(bucket.strikes, 4);
  return seconds;
}

function isBanned(key) {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  return bucket.banUntil > Date.now();
}

function unban(key) {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  bucket.banUntil = 0;
  bucket.blocked = 0;
  return true;
}

function strikesFor(key) {
  const bucket = buckets.get(key);
  return bucket ? bucket.strikes : 0;
}

function clearPenalty(key) {
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket.strikes = 0;
  bucket.blocked = 0;
  bucket.banUntil = 0;
  bucket.penaltyUntil = 0;
}

/** In-flight accounting used by the load-shedding guard. */
function enter(id) {
  concurrent.add(id);
  return concurrent.size;
}

function leave(id) {
  concurrent.delete(id);
  return concurrent.size;
}

function concurrency() {
  return concurrent.size;
}

/** Drop everything: used by the purge endpoint and by tests. */
function reset() {
  buckets.clear();
  concurrent.clear();
}

function snapshot() {
  return {
    trackedKeys: buckets.size,
    concurrent: concurrent.size,
    bans: [...buckets].filter(([, b]) => b.banUntil > Date.now()).length,
  };
}

module.exports = {
  checkIp, checkUser, check, penalize, banNow, isBanned, unban, strikesFor, clearPenalty,
  enter, leave, concurrency, reset, snapshot, buckets,
};
