'use strict';
/**
 * Anti-DDoS layer 2: proof of work.
 *
 * When an IP earns a ban, lifting it requires solving a hash puzzle. A botnet
 * with a million idle sockets still has to burn CPU per attempt, and a real
 * user behind a shared NAT pays once every few minutes.
 *
 * Flow:
 *   429 + Retry-After + X-PoW-Required: 1
 *   GET  /api/security/challenge      -> { challenge, difficulty, expiresAt }
 *   POST /api/security/challenge      -> { nonce }  (verified, pass minted)
 *   subsequent requests send X-PoW-Pass: <pass>
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const cache = require('../lib/cache');
const { safeEqual } = require('../crypto');
const { bad, tooMany } = require('../errors');
const rateLimit = require('./rate-limit');

const pending = cache.create({ name: 'pow:pending', max: 20000, ttlMs: 10 * 60 * 1000 });
const passes = cache.create({ name: 'pow:passes', max: 40000, ttlMs: config.limits.powTtlSeconds * 1000 });
const issued = cache.create({ name: 'pow:issued', max: 40000, ttlMs: 60 * 60 * 1000 });

const CHALLENGE_TTL_MS = 120000;
const MAX_SOLVE_MS = 10000;

function hasLeadingZeroBits(digest, bits) {
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i += 1) if (digest[i] !== 0) return false;
  const rest = bits % 8;
  if (rest === 0) return true;
  return (digest[fullBytes] & (0xff << (8 - rest))) === 0;
}

function issueChallenge(ip) {
  const perIp = issued.get(ip) || 0;
  if (perIp >= config.limits.powMaxPerIp) {
    throw tooMany('Too many challenges requested from this network', 600);
  }
  issued.set(ip, perIp + 1);
  const challenge = crypto.randomBytes(16).toString('base64url');
  pending.set(challenge, { ip, createdAt: Date.now() });
  return {
    challenge,
    difficulty: config.limits.powDifficultyBits,
    algorithm: 'sha256',
    format: 'sha256(challenge + ":" + nonce) must have N leading zero bits',
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    maxSolveMs: MAX_SOLVE_MS,
  };
}

/**
 * Verify a solution. Timing-safe on the nonce echo, constant work on the hash.
 * Returns the pass token, or throws 400/429.
 */
function solve(ip, { challenge, nonce, elapsedMs }) {
  const record = pending.get(challenge);
  if (!record) throw bad('That challenge expired, request a new one');
  if (!safeEqual(record.ip, ip)) throw bad('Challenge was issued to a different network');
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 128) throw bad('Nonce is not valid');
  if (Number.isFinite(Number(elapsedMs)) && Number(elapsedMs) < 1) throw bad('Solution is not believable');
  if (Date.now() - record.createdAt > CHALLENGE_TTL_MS) {
    pending.delete(challenge);
    throw bad('That challenge expired, request a new one');
  }
  const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
  if (!hasLeadingZeroBits(digest, config.limits.powDifficultyBits)) throw bad('Solution does not meet the difficulty');
  pending.delete(challenge);
  const pass = jwt.sign(
    { ip, purpose: 'pow', jti: crypto.randomBytes(8).toString('hex') },
    config.jwtSecret,
    { expiresIn: config.limits.powTtlSeconds },
  );
  passes.set(`${ip}:${pass}`, true);
  return { pass, expiresInSeconds: config.limits.powTtlSeconds };
}

function hasValidPass(ip, pass) {
  if (typeof pass !== 'string' || pass.length < 20 || pass.length > 2048) return false;
  if (!passes.has(`${ip}:${pass}`)) return false;
  try {
    const payload = jwt.verify(pass, config.jwtSecret, { algorithms: ['HS256'] });
    return payload.purpose === 'pow' && safeEqual(String(payload.ip), ip);
  } catch {
    return false;
  }
}

function consumePass(ip, pass) {
  passes.delete(`${ip}:${pass}`);
}

/** Does this request need to solve a puzzle before it may proceed? */
function required(ip) {
  if (!rateLimit.isBanned(`ip:${ip}`)) return false;
  return rateLimit.strikesFor(`ip:${ip}`) >= 2;
}

/** Called after a successful PoW: lift the ban, keep the strike history. */
function redeem(ip) {
  rateLimit.unban(`ip:${ip}`);
}

function stats() {
  return { pending: pending.size, passes: passes.size, issued: issued.size };
}

function reset() {
  pending.clear();
  passes.clear();
  issued.clear();
}

module.exports = {
  issueChallenge, solve, hasValidPass, consumePass, required, redeem, hasLeadingZeroBits, stats, reset,
  CHALLENGE_TTL_MS,
};
