'use strict';
/**
 * End-to-end encryption, client side.
 *
 * Agreement   X25519 (fallback ECDH P-256 on old WebViews)
 * KDF         HKDF-SHA256, direction-bound info strings
 * Cipher      AES-256-GCM, 12-byte IV per message
 * Room keys   32 random bytes, wrapped per member with the pairwise key
 * Recovery    identity private key sealed with PBKDF2(password) + AES-GCM
 *
 * The server stores public keys and ciphertext. It never sees a private key,
 * a room key, or a plaintext message, and there is no code path here that sends
 * one to it.
 */
(function () {
  var subtle = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
  var IDENTITY_KEY = 'oa.identity.v1';
  var CURVE = 'X25519';
  var PBKDF2_ITERATIONS = 250000;
  var SUPPORTED = { X25519: 'X25519', P256: 'P-256' };

  function assertCrypto() {
    if (!subtle) throw new Error('This WebView does not expose WebCrypto; end-to-end encryption is unavailable');
  }

  /* ------------------------------------------------------------- base64 -- */

  function bytesToB64(bytes) {
    var binary = '';
    var view = new Uint8Array(bytes);
    for (var i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64ToBytes(text) {
    var normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    var binary = atob(normalized);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function textToBytes(text) { return new TextEncoder().encode(text); }
  function bytesToText(bytes) { return new TextDecoder().decode(bytes); }

  /* ----------------------------------------------------------- key utils -- */

  async function detectCurve() {
    assertCrypto();
    try {
      var pair = await subtle.generateKey({ name: 'ECDH', namedCurve: SUPPORTED.X25519 }, true, ['deriveBits']);
      if (pair && pair.privateKey) return SUPPORTED.X25519;
    } catch (e) { /* older WebView: fall back */ }
    return SUPPORTED.P256;
  }

  function curveParams(curve) {
    return { name: 'ECDH', namedCurve: curve };
  }

  async function generateIdentity() {
    assertCrypto();
    if (CURVE === 'X25519') CURVE = await detectCurve();
    var pair = await subtle.generateKey(curveParams(CURVE), true, ['deriveBits']);
    var rawPublic = await subtle.exportKey('spki', pair.publicKey);
    var rawPrivate = await subtle.exportKey('pkcs8', pair.privateKey);
    return {
      privateKey: bytesToB64(rawPrivate),
      publicKey: bytesToB64(rawPublic),
      curve: CURVE,
      fingerprint: await fingerprint(bytesToB64(rawPublic)),
    };
  }

  async function importPrivate(b64, curve) {
    assertCrypto();
    return subtle.importKey('pkcs8', b64ToBytes(b64), curveParams(curve || CURVE), true, ['deriveBits']);
  }

  async function importPublic(b64, curve) {
    assertCrypto();
    return subtle.importKey('spki', b64ToBytes(b64), curveParams(curve || CURVE), true, []);
  }

  async function fingerprint(publicKeyB64) {
    assertCrypto();
    var digest = await subtle.digest('SHA-256', b64ToBytes(publicKeyB64));
    var hex = bytesToB64(digest).slice(0, 40).toUpperCase();
    return hex.replace(/(.{4})/g, '$1 ').trim();
  }

  /** Direction-bound pairwise key: A->B and B->A are different keys. */
  function infoFor(scope, scopeId, fromId, toId) {
    return textToBytes('omlet-arcade/e2ee/v1/' + scope + '/' + scopeId + '/' + fromId + '->' + toId);
  }

  async function derivePairKey(myPrivateB64, theirPublicB64, scope, scopeId, fromId, toId, curve) {
    assertCrypto();
    var priv = await importPrivate(myPrivateB64, curve);
    var pub = await importPublic(theirPublicB64, curve);
    // ECDH puts the peer's public key inside the algorithm object: the spec
    // signature is deriveBits(algorithm, baseKey, length).
    var bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
    var material = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: textToBytes('omlet-arcade/e2ee/v1/salt'), info: infoFor(scope, scopeId, fromId, toId) },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /* ------------------------------------------------------- AES-GCM frames - */

  async function aesKeyFromBytes(bytes) {
    assertCrypto();
    return subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function seal(key, plaintext, aad) {
    assertCrypto();
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var params = { name: 'AES-GCM', iv: iv };
    if (aad) params.additionalData = textToBytes(aad);
    var sealed = await subtle.encrypt(params, key, textToBytes(plaintext));
    // The GCM tag rides at the end of the ciphertext; split it so the server
    // columns stay meaningful without the server learning anything from them.
    var all = new Uint8Array(sealed);
    var tag = all.slice(all.length - 16);
    var body = all.slice(0, all.length - 16);
    return { ciphertext: bytesToB64(body), iv: bytesToB64(iv), tag: bytesToB64(tag) };
  }

  async function open(key, frame, aad) {
    assertCrypto();
    if (!frame || !frame.ciphertext || !frame.iv) return null;
    var iv = b64ToBytes(frame.iv);
    if (iv.length !== 12) return null;
    var body = b64ToBytes(frame.ciphertext);
    var tag = frame.tag ? b64ToBytes(frame.tag) : new Uint8Array(0);
    var joined = new Uint8Array(body.length + tag.length);
    joined.set(body, 0);
    joined.set(tag, body.length);
    var params = { name: 'AES-GCM', iv: iv };
    if (aad) params.additionalData = textToBytes(aad);
    try {
      var plain = await subtle.decrypt(params, key, joined);
      return bytesToText(plain);
    } catch (e) {
      return null; // wrong key or tampered frame: the caller shows it as unreadable
    }
  }

  /* -------------------------------------------------------- identity keys - */

  function cacheIdentity(identity) {
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch (e) { /* memory only */ }
  }

  function cachedIdentity() {
    try {
      var raw = localStorage.getItem(IDENTITY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function forgetIdentity() {
    try { localStorage.removeItem(IDENTITY_KEY); } catch (e) { /* noop */ }
  }

  /**
   * Seal the private half for recovery on another device. PBKDF2 rather than a
   * fast hash: an attacker who steals the blob pays 250k rounds per guess.
   */
  async function makeRecoveryBlob(privateKeyB64, password, userId) {
    assertCrypto();
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var base = await subtle.importKey('raw', textToBytes(password), 'PBKDF2', false, ['deriveKey']);
    var key = await subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var sealed = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: textToBytes('identity:' + userId) },
      key,
      textToBytes(privateKeyB64),
    );
    var packed = new Uint8Array(12 + sealed.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(sealed), 12);
    return { recoveryBlob: bytesToB64(packed), recoverySalt: bytesToB64(salt), iterations: PBKDF2_ITERATIONS };
  }

  async function openRecoveryBlob(packedB64, saltB64, password, userId) {
    assertCrypto();
    var packed = b64ToBytes(packedB64);
    if (packed.length <= 28) return null;
    var iv = packed.slice(0, 12);
    var body = packed.slice(12);
    var base = await subtle.importKey('raw', textToBytes(password), 'PBKDF2', false, ['deriveKey']);
    var key = await subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    try {
      var plain = await subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: textToBytes('identity:' + userId) }, key, body);
      return bytesToText(plain);
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------ room keys - */

  function newRoomKey() {
    return bytesToB64(window.crypto.getRandomValues(new Uint8Array(32)));
  }

  /**
   * Room key transport. Unlike a DM, both sides must derive the same key, so
   * the HKDF info is canonicalised on the pair instead of on who wrote first:
   * a wrap by A for B and an unwrap by B of A's blob use one derivation.
   */
  function canonicalPair(a, b) {
    return { from: Math.min(Number(a), Number(b)), to: Math.max(Number(a), Number(b)) };
  }

  /** Wrap a room key for one member using the pairwise key. */
  async function wrapRoomKey(roomKeyB64, myPrivateB64, theirPublicB64, scope, scopeId, myId, theirId, curve) {
    var pair = canonicalPair(myId, theirId);
    var key = await derivePairKey(myPrivateB64, theirPublicB64, scope, scopeId, pair.from, pair.to, curve);
    return seal(key, roomKeyB64, 'room-key:' + scope + ':' + scopeId);
  }

  async function unwrapRoomKey(wrapped, myPrivateB64, theirPublicB64, scope, scopeId, myId, theirId, curve) {
    var pair = canonicalPair(myId, theirId);
    var key = await derivePairKey(myPrivateB64, theirPublicB64, scope, scopeId, pair.from, pair.to, curve);
    return open(key, wrapped, 'room-key:' + scope + ':' + scopeId);
  }

  /**
   * Pack a sealed frame into one opaque base64 blob, in the same layout the
   * server's own AEAD uses: iv (12) | tag (16) | ciphertext. Wrapped room keys
   * are stored as a single column, so the three parts travel together.
   */
  function packFrame(frame) {
    var iv = b64ToBytes(frame.iv);
    var tag = b64ToBytes(frame.tag);
    var body = b64ToBytes(frame.ciphertext);
    var packed = new Uint8Array(iv.length + tag.length + body.length);
    packed.set(iv, 0);
    packed.set(tag, iv.length);
    packed.set(body, iv.length + tag.length);
    return bytesToB64(packed);
  }

  function unpackFrame(packedB64) {
    var packed = b64ToBytes(packedB64);
    if (packed.length < 28) return null;
    return {
      iv: bytesToB64(packed.subarray(0, 12)),
      tag: bytesToB64(packed.subarray(12, 28)),
      ciphertext: bytesToB64(packed.subarray(28)),
    };
  }

  /** The media key handed to the LiveKit cryptor must be raw bytes. */
  function roomKeyBytes(roomKeyB64) {
    var bytes = b64ToBytes(roomKeyB64);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /**
   * Ensure this device has an identity key, publishing it (with a recovery
   * blob) when it does not. Returns the identity.
   */
  async function ensureIdentity(password) {
    assertCrypto();
    var existing = cachedIdentity();
    var me = window.Api.user();
    if (existing && me && existing.userId === me.id && existing.publicKey) return existing;

    var identity = await generateIdentity();
    identity.userId = me ? me.id : null;
    identity.createdAt = Date.now();
    var payload = { publicKey: identity.publicKey, curve: identity.curve };
    if (password) {
      var blob = await makeRecoveryBlob(identity.privateKey, password, identity.userId);
      payload.recoveryBlob = blob.recoveryBlob;
      payload.recoverySalt = blob.recoverySalt;
      payload.verifyPassword = password;
    }
    try {
      await window.Api.put('/api/keys/identity', payload);
    } catch (err) {
      // A wrong password here means the server refused the key change, not that
      // the key is bad. Keep it cached so the next attempt can retry.
      if (err.status !== 401) cacheIdentity(identity);
      throw err;
    }
    cacheIdentity(identity);
    return identity;
  }

  window.E2EE = {
    supported: function () { return !!subtle; },
    curve: function () { return CURVE; },
    detectCurve: detectCurve,
    generateIdentity: generateIdentity,
    ensureIdentity: ensureIdentity,
    cachedIdentity: cachedIdentity,
    cacheIdentity: cacheIdentity,
    forgetIdentity: forgetIdentity,
    fingerprint: fingerprint,
    derivePairKey: derivePairKey,
    seal: seal,
    open: open,
    aesKeyFromBytes: aesKeyFromBytes,
    newRoomKey: newRoomKey,
    wrapRoomKey: wrapRoomKey,
    unwrapRoomKey: unwrapRoomKey,
    roomKeyBytes: roomKeyBytes,
    packFrame: packFrame,
    unpackFrame: unpackFrame,
    makeRecoveryBlob: makeRecoveryBlob,
    openRecoveryBlob: openRecoveryBlob,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS,
  };
})();
