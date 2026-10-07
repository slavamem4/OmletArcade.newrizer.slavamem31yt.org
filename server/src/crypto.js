'use strict';
/**
 * Server-side cryptography.
 *
 * What lives here: password hashing, opaque token minting, key wrapping for
 * device key recovery, and constant-time comparisons.
 *
 * What does NOT live here: any key that can decrypt user content. End-to-end
 * encryption keys are generated on the device; the server only stores and
 * relays opaque ciphertext (see src/routes/keys.js).
 */
const crypto = require('node:crypto');

const SCRYPT_N = 16384; // memory-hard: 16 MiB per attempt, keeps GPU cracking expensive
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const AES_ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/** Constant-time string compare that never short-circuits on length. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare anyway so timing does not reveal that lengths differed early.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('password required');
  if (password.length > 512) throw new Error('password too long');
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Clamp work factors read from the database so a tampered row cannot be used
  // to make the server spend unbounded memory or CPU.
  if (N < 1024 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 8) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived;
  try {
    derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N, r, p, maxmem: 128 * N * r * 2,
    });
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Opaque token for session/refresh handling. Only the SHA-256 hash is stored,
 * so a database leak does not hand out live sessions.
 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** HKDF-SHA256 with a fixed application salt; used for derived subkeys. */
function hkdf(ikm, info, length = 32) {
  const salt = Buffer.from('omlet-arcade/server/v1');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), length));
}

/**
 * Key derivation for the device key-recovery blob. The plaintext of that blob
 * is the user's E2EE identity key; the server sees only ciphertext.
 * scrypt (not PBKDF2) so an offline dictionary attack on a leaked blob costs
 * 16 MiB of memory per guess.
 */
function deriveRecoveryKey(password, salt) {
  return crypto.scryptSync(password.normalize('NFKC'), salt, 32, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
}

function aeadSeal(key, plaintext, aad = Buffer.alloc(0)) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  if (aad.length) cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function aeadOpen(key, packed, aad = Buffer.alloc(0)) {
  const raw = Buffer.from(String(packed), 'base64');
  if (raw.length < IV_LEN + TAG_LEN) return null;
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const body = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
  if (aad.length) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null; // bad tag or wrong key: null, never an exception to the caller
  }
}

/** Short, URL-safe, human-shareable id (parties, servers, invites). */
function shortId(bytes = 5) {
  return crypto.randomBytes(bytes).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
}

/** Deterministic numeric code for call invites; short lived, so 6 digits is fine. */
function callCode() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = {
  safeEqual,
  hashPassword,
  verifyPassword,
  randomToken,
  tokenHash,
  hkdf,
  deriveRecoveryKey,
  aeadSeal,
  aeadOpen,
  shortId,
  callCode,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
};
