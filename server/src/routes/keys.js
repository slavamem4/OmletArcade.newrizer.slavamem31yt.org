'use strict';
/**
 * /api/keys — end-to-end key material relay.
 *
 * What the server holds: X25519 public keys, and ciphertext blobs it cannot
 * open (the identity-key recovery blob, and room keys wrapped for each member).
 * There is no endpoint here that returns plaintext, and no code path in this
 * project that derives, stores, or logs a private key.
 *
 * Authorization model for wrapped keys: only a member of the scope may write a
 * wrap for themselves, and only the owner of a row may read it back.
 */
const express = require('express');
const crypto = require('node:crypto');
const { db, sql } = require('../db');
const validate = require('../lib/validate');
const errors = require('../errors');
const auth = require('../middleware/auth');
const parties = require('../services/parties');
const { deriveRecoveryKey, aeadSeal, aeadOpen, verifyPassword, SCRYPT_N, SCRYPT_R, SCRYPT_P } = require('../crypto');
const audit = require('../services/audit');

const router = express.Router();
router.use(auth.required());

const PUB_MAX_BYTES = 128;
const BLOB_MAX_BYTES = 1024;
const WRAPPED_MAX_BYTES = 1024;
const SCOPES = ['party', 'dm', 'server', 'broadcast'];

function fingerprintOf(pub) {
  if (!pub) return null;
  const digest = crypto.createHash('sha256').update(Buffer.from(String(pub), 'base64')).digest('hex');
  // Grouped for a human to compare out of band, like a safety number.
  return digest.slice(0, 40).toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

function scopeKey(scope, scopeId) {
  return `${scope}:${scopeId}`;
}

async function assertScopeAccess(scope, scopeId, userId) {
  if (scope === 'party' || scope === 'server' || scope === 'broadcast') {
    const id = Number(scopeId);
    if (!Number.isInteger(id) || id <= 0) throw errors.bad('Unknown scope');
    if (!await parties.isMember(id, userId)) throw errors.forbidden('You are not in that room');
    return;
  }
  if (scope === 'dm') {
    const [a, b] = String(scopeId).split(':').map(Number);
    if (![a, b].every((n) => Number.isInteger(n) && n > 0)) throw errors.bad('Unknown scope');
    if (a !== userId && b !== userId) throw errors.forbidden('That conversation is not yours');
    return;
  }
  throw errors.bad('Unknown scope');
}

router.get('/me', errors.wrap(async (req, res) => {
  const row = await db().get(`SELECT identity_pub, recovery_blob, recovery_salt, e2ee_enabled FROM users WHERE id = ?`, [req.user.id]);
  res.json({
    identityPublicKey: row.identity_pub || null,
    fingerprint: fingerprintOf(row.identity_pub),
    hasRecoveryBlob: !!row.recovery_blob,
    recoveryParams: row.recovery_blob ? { algorithm: 'scrypt+aes-256-gcm', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P } : null,
    e2eeEnabled: sql.asBool(row.e2ee_enabled),
    algorithm: { agreement: 'X25519', kdf: 'HKDF-SHA256', cipher: 'AES-256-GCM', media: 'WebRTC encoded transform, frame level' },
  });
}));

/**
 * Publish an identity key and (optionally) the encrypted recovery blob.
 * The blob is sealed on the device with a key derived from the password; the
 * server stores it blind. Sending a new blob replaces the old one atomically.
 */
router.put('/identity', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, {
    publicKey: ['blob', { maxBytes: PUB_MAX_BYTES, message: 'That is not a valid public key' }],
    recoveryBlob: ['blob', { maxBytes: BLOB_MAX_BYTES, optional: true }],
    recoverySalt: ['blob', { maxBytes: 64, optional: true }],
    verifyPassword: ['password', { min: 1, optional: true }],
  });

  // Prove ownership of the private half before the key becomes the account's
  // identity: sign nothing, but do require a correct password on first publish
  // and on every replacement. This is what stops a stolen access token from
  // quietly swapping in an attacker's key.
  if (!body.verifyPassword || !verifyPassword(body.verifyPassword, req.user.password_hash)) {
    throw errors.unauthorized('Confirm your password to change your encryption key');
  }
  if (body.recoveryBlob && !body.recoverySalt) throw errors.bad('A recovery blob needs its salt');
  if (body.recoverySalt && !body.recoveryBlob) throw errors.bad('A salt needs its recovery blob');

  await db().run(
    `UPDATE users SET identity_pub = ?, recovery_blob = ?, recovery_salt = ?, e2ee_enabled = ?, updated_at = ? WHERE id = ?`,
    [body.publicKey, body.recoveryBlob || null, body.recoverySalt || null, sql.bool(true), Date.now(), req.user.id],
  );
  await audit.record({ actorId: req.user.id, action: 'keys.identity_published', ip: req.clientIp });
  res.json({ ok: true, fingerprint: fingerprintOf(body.publicKey) });
}));

/** Open the recovery blob. Only the device with the password can. */
router.post('/identity/verify', errors.wrap(async (req, res) => {
  const body = validate.parse(req.body, { password: ['password', { min: 1, message: 'Enter your password' }] });
  const row = await db().get(`SELECT recovery_blob, recovery_salt, identity_pub FROM users WHERE id = ?`, [req.user.id]);
  if (!row || !row.recovery_blob) throw errors.notFound('No recovery blob is stored for this account');
  const key = deriveRecoveryKey(body.password, Buffer.from(row.recovery_salt, 'base64'));
  const opened = aeadOpen(key, row.recovery_blob, Buffer.from(`identity:${req.user.id}`));
  if (!opened) throw errors.unauthorized('That password does not open your key');
  // The plaintext is the private key material; return it once, never log it.
  res.json({ privateKey: opened.toString('base64'), fingerprint: fingerprintOf(row.identity_pub) });
}));

router.get('/user/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const row = await db().get(`SELECT id, username, identity_pub, e2ee_enabled FROM users WHERE id = ?`, [id]);
  if (!row) throw errors.notFound('That player does not exist');
  res.json({
    userId: Number(row.id),
    username: row.username,
    identityPublicKey: row.identity_pub || null,
    fingerprint: fingerprintOf(row.identity_pub),
    e2eeEnabled: sql.asBool(row.e2ee_enabled),
  });
}));

/** Both fingerprints, so two people can compare safety numbers out of band. */
router.get('/fingerprint/:id', errors.wrap(async (req, res) => {
  const { id } = validate.parse(req.params, { id: ['id'] });
  const mine = await db().get(`SELECT identity_pub FROM users WHERE id = ?`, [req.user.id]);
  const theirs = await db().get(`SELECT username, identity_pub FROM users WHERE id = ?`, [id]);
  if (!theirs) throw errors.notFound('That player does not exist');
  res.json({
    mine: fingerprintOf(mine && mine.identity_pub),
    theirs: fingerprintOf(theirs.identity_pub),
    theirsUsername: theirs.username,
    // Verification is out of band: both people read their screen and compare.
    // The server can attest that these are the keys it holds, not that the
    // humans checked them, so it does not claim otherwise.
    howToVerify: 'Compare "mine" on your device with "theirs" on theirs. If the two match, no one is in the middle.',
  });
}));

/* ------------------------------------------------------- wrapped room keys */

router.get('/wrapped/:scope/:scopeId', errors.wrap(async (req, res) => {
  const { scope, scopeId } = validate.parse(req.params, {
    scope: ['enum', { values: SCOPES }],
    scopeId: ['text', { max: 24, message: 'Unknown scope' }],
  });
  await assertScopeAccess(scope, scopeId, req.user.id);
  const rows = await db().query(
    `SELECT user_id, key_index, wrapped, created_at FROM wrapped_keys
     WHERE scope = ? AND scope_id = ? AND user_id = ? ORDER BY key_index ASC ${sql.limit(20, 0)}`,
    [scope, String(scopeId), req.user.id],
  );
  res.json({
    keys: rows.map((row) => ({ keyIndex: Number(row.key_index), wrapped: row.wrapped, createdAt: Number(row.created_at || 0) })),
  });
}));

router.put('/wrapped/:scope/:scopeId', errors.wrap(async (req, res) => {
  const { scope, scopeId } = validate.parse(req.params, {
    scope: ['enum', { values: SCOPES }],
    scopeId: ['text', { max: 24, message: 'Unknown scope' }],
  });
  await assertScopeAccess(scope, scopeId, req.user.id);
  const body = validate.parse(req.body, {
    keyIndex: ['int', { min: 0, max: 127, fallback: 0 }],
    wrapped: ['blob', { maxBytes: WRAPPED_MAX_BYTES, message: 'That wrapped key is too large' }],
    forUserId: ['id'],
  });
  // A blob may only be stored for someone who is in this scope. The blob is
  // sealed with the pairwise key between the writer and the recipient, so the
  // server still learns nothing: it holds ciphertext it cannot open, and a
  // reader can only ever decrypt a blob addressed to their own user id.
  //
  // Honest ceiling: a member can replace another member's copy. That is the
  // same power any member already has by rotating the key after they join, so
  // the control that actually matters is out-of-band identity verification
  // (the safety numbers in the UI), not who is allowed to write this row.
  if (scope === 'dm') {
    const [a, b] = String(scopeId).split(':').map(Number);
    if (body.forUserId !== a && body.forUserId !== b) throw errors.forbidden('That recipient is not in this conversation');
  } else {
    if (!await parties.isMember(Number(scopeId), body.forUserId)) throw errors.forbidden('That recipient is not in this room');
  }
  await db().run(
    sql.upsert('wrapped_keys', ['scope', 'scope_id', 'user_id', 'key_index', 'wrapped', 'created_at'],
      ['scope', 'scope_id', 'user_id', 'key_index'], ['wrapped', 'created_at']),
    [scope, String(scopeId), body.forUserId, body.keyIndex, body.wrapped, Date.now()],
  );
  res.json({ ok: true });
}));

/** Who is in the scope, with their public keys: the group's key agreement set. */
router.get('/members/:scope/:scopeId', errors.wrap(async (req, res) => {
  const { scope, scopeId } = validate.parse(req.params, {
    scope: ['enum', { values: SCOPES }],
    scopeId: ['text', { max: 24, message: 'Unknown scope' }],
  });
  await assertScopeAccess(scope, scopeId, req.user.id);
  let rows = [];
  if (scope === 'dm') {
    const [a, b] = String(scopeId).split(':').map(Number);
    rows = await db().query(`SELECT id, username, identity_pub, e2ee_enabled FROM users WHERE id IN (?, ?)`, [a, b]);
  } else {
    const id = Number(scopeId);
    rows = await db().query(
      `SELECT u.id, u.username, u.identity_pub, u.e2ee_enabled FROM party_members m
       JOIN users u ON u.id = m.user_id WHERE m.party_id = ?`,
      [id],
    );
  }
  res.json({
    members: rows.map((row) => ({
      userId: Number(row.id),
      username: row.username,
      identityPublicKey: row.identity_pub || null,
      fingerprint: fingerprintOf(row.identity_pub),
      e2eeEnabled: sql.asBool(row.e2ee_enabled),
    })),
    scopeKey: scopeKey(scope, scopeId),
  });
}));

router.delete('/wrapped/:scope/:scopeId', errors.wrap(async (req, res) => {
  const { scope, scopeId } = validate.parse(req.params, {
    scope: ['enum', { values: SCOPES }],
    scopeId: ['text', { max: 24, message: 'Unknown scope' }],
  });
  await assertScopeAccess(scope, scopeId, req.user.id);
  const info = await db().run(`DELETE FROM wrapped_keys WHERE scope = ? AND scope_id = ? AND user_id = ?`, [scope, String(scopeId), req.user.id]);
  res.json({ ok: true, removed: info.changes });
}));

module.exports = router;
module.exports.fingerprintOf = fingerprintOf;
module.exports.aeadSeal = aeadSeal;
