'use strict';
/**
 * Client render harness.
 *
 * Loads the real browser scripts (unmodified) into jsdom with a fake fetch,
 * walks every route, and asserts the app rendered real content instead of an
 * error banner. This is the "one runnable check per non-trivial logic block"
 * for the client: it exercises Router.resolve, every screen's render path, the
 * Api wrapper, the crypto module's key derivation, and the sheet helpers.
 *
 * Run: node /home/user/omlet-arcade/server/test/client.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('/tmp/clienttest/node_modules/jsdom');

const WEB = '/home/user/omlet-arcade/web';
const ORDER = [
  'assets/icons/icons.js', 'js/dom.js', 'js/ui.js', 'js/api.js', 'js/socket.js', 'js/e2ee.js',
  'js/roomkey.js', 'js/voice.js', 'js/screens/auth.js', 'js/screens/home.js',
  'js/screens/parties.js', 'js/screens/friends.js', 'js/screens/chat.js',
  'js/screens/minecraft.js', 'js/screens/feed.js', 'js/screens/profile.js',
  'js/screens/settings.js', 'js/router.js',
];

/* ------------------------------------------------------------------ fixtures */

/**
 * The peer's key has to be a real key, because the client imports it before
 * agreeing on a shared secret. P-256 is what the client falls back to when the
 * WebView does not offer X25519, so the harness exercises that path.
 */
const WC = require('node:crypto').webcrypto;
const PEER_CURVE = { name: 'ECDH', namedCurve: 'P-256' };
let peerPair = null;
function peerKeys() {
  if (peerPair) return peerPair;
  throw new Error('peerKeys() used before fixtures were prepared');
}

const ME = { id: 1, username: 'nova', displayName: 'Nova', level: 4, xp: 1250, presence: 'online', hasIdentityKey: true, bio: 'bedrock only', e2eeEnabled: true };
const PEER = { id: 2, username: 'kilo', displayName: 'Kilo', level: 9, xp: 4400, presence: 'offline', lastSeenAt: Date.now() - 900000, hasIdentityKey: true, e2eeEnabled: true };
const SERVER = {
  id: 11, ownerId: 1, name: 'Weekend survival', address: 'mc.example.net', port: 19132,
  edition: 'bedrock', maxPlayers: 10, motd: 'bring blocks', status: 'running', version: '1.21',
};
const PARTY = {
  id: 7, name: 'Squad alpha', kind: 'party', ownerId: 1, locked: false, maxMembers: 8,
  memberCount: 2, e2eeEnabled: true, createdAt: Date.now() - 60000, game: 'MC',
};

/** Every route the screens call, with the shape each screen reads. */
const ROUTES = {
  'GET /api/security/bootstrap': () => ({ pow: { enabled: false, bits: 16 }, limits: {} }),
  'GET /api/security/status': () => ({ banned: false, powRequired: false, strikes: 0 }),
  'GET /api/users/me': () => ({ user: ME, settings: { privacy: { friendRequests: 'everyone', calls: 'friends', showPresence: true, discoverable: true }, voice: { inputGain: 100, outputVolume: 90 }, e2ee: { enforce: true } } }),
  'GET /api/users/me/stats': () => ({ friends: 3, parties: 2, servers: 1, sessions: 2 }),
  'PATCH /api/users/me': () => ({ user: ME }),
  'PATCH /api/users/me/settings': () => ({ ok: true }),
  'GET /api/users/2': () => ({ user: PEER, relationship: 'accepted', inParty: null }),
  'GET /api/users/2/friends': () => ({ friends: [PEER] }),
  'GET /api/users/search?q=ki': () => ({ users: [PEER] }),
  'GET /api/keys/me': () => ({ identityPublicKey: 'cHVibGlj', fingerprint: '1234 5678 9012 3456 7890 1234', algorithm: { agreement: 'X25519', kdf: 'HKDF-SHA256', cipher: 'AES-256-GCM', media: 'AES-128-CTR-HMAC' } }),
  'GET /api/keys/user/2': () => ({ userId: 2, identityPublicKey: peerKeys().publicKey, curve: peerKeys().curve, updatedAt: Date.now() }),
  'GET /api/keys/fingerprint/2': () => ({ mine: '1234 5678', theirs: '4321 8765', theirsUsername: 'kilo', howToVerify: 'Read both numbers aloud.' }),
  'PUT /api/keys/identity': () => ({ ok: true }),
  'POST /api/keys/identity/verify': () => ({ privateKey: 'cHJpdmF0ZQ==', fingerprint: '1234 5678' }),
  'GET /api/friends': () => ({ friends: [PEER], incoming: [], outgoing: [], blocked: [] }),
  'GET /api/friends/blocked': () => ({ blocked: [] }),
  'POST /api/friends/request': () => ({ ok: true }),
  'GET /api/parties': () => ({ parties: [PARTY] }),
  'GET /api/parties/invites': () => ({ invites: [{ id: 3, partyId: 7, partyName: PARTY.name, partyKind: 'party', inviter: PEER, createdAt: Date.now() - 30000 }] }),
  'POST /api/parties': () => ({ party: PARTY }),
  'GET /api/parties/7': () => ({ party: Object.assign({}, PARTY, { members: [ME, PEER] }), messages: [], isOwner: true, isMember: true }),
  'POST /api/parties/7/join': () => ({ party: PARTY }),
  'POST /api/parties/7/voice': () => ({ token: 'jwt', room: 'p7', url: 'wss://example', e2ee: { enabled: true, keyId: 'k1' } }),
  'GET /api/chat/dm/2': () => ({ channel: { id: 5, kind: 'dm', peerId: 2 }, messages: [{ id: 9, channelId: 5, senderId: 2, ciphertext: 'AA', iv: 'AA', tag: 'AA', createdAt: Date.now() - 5000 }] }),
  'POST /api/chat/dm/2': (body) => ({ message: { id: 10, channelId: 5, senderId: 1, ciphertext: body.ciphertext, iv: body.iv, tag: body.tag, createdAt: Date.now() } }),
  'GET /api/minecraft': () => ({ servers: [SERVER] }),
  'POST /api/minecraft': () => ({ server: SERVER }),
  'GET /api/minecraft/11': () => ({ server: SERVER, players: [{ playerId: 1, username: 'nova', displayName: 'Nova', player: 'Nova', joinedAt: Date.now() - 60000 }], party: Object.assign({}, PARTY, { isMember: true, members: [ME] }) }),
  'POST /api/minecraft/11/join': () => ({ party: PARTY }),
  'GET /api/feed?limit=30': () => ({ items: [{ id: 1, userId: 2, kind: 'party_created', payload: { name: 'Squad' }, createdAt: Date.now() - 120000 }] }),
  'GET /api/notifications': () => ({ notifications: [{ id: 1, kind: 'party_invite', payload: { partyId: 7 }, readAt: null, createdAt: Date.now() - 60000 }] }),
  'GET /api/system/purge/report': () => ({ heapUsedMb: 40, caches: [{ entries: 12 }], logRing: 100, uptimeSeconds: 900, disk: { dataBytes: 2048, tmpBytes: 512 } }),
  'POST /api/system/purge': () => ({ cleared: { cacheEntries: 12, messages: 0, notifications: 1 } }),
  'GET /api/auth/sessions': () => ({ sessions: [{ id: 's1', device: 'Pixel 8', ip: '10.0.0.2', createdAt: Date.now() - 3600000, current: true }] }),
  'POST /api/calls': () => ({ callId: 21, code: 'AB34' }),
  'POST /api/calls/21/accept': () => ({ party: PARTY }),
  'POST /api/calls/21/decline': () => ({ ok: true }),
  'GET /api/broadcasts': () => ({ broadcasts: [{ id: 31, partyId: 7, title: 'Ranked grind', game: 'MC', viewers: 3, streamer: PEER, startedAt: Date.now() - 60000 }] }),
  'POST /api/broadcasts': () => ({ broadcast: { id: 31, party: PARTY } }),
  'GET /api/chat/party/7': () => ({ channel: { id: 8, kind: 'party', partyId: 7 }, messages: [] }),
  'POST /api/chat/party/7': (body) => ({ message: { id: 12, channelId: 8, senderId: 1, ciphertext: body.ciphertext, iv: body.iv, tag: body.tag, createdAt: Date.now() } }),
  'GET /api/keys/members/7': () => ({ members: [Object.assign({}, ME, { identityPublicKey: 'cHVibGlj' }), Object.assign({}, PEER, { identityPublicKey: 'cGVlcg==' })] }),
  'GET /api/keys/wrapped/dm/1:2': () => ({ wrapped: [], keyId: null }),
  'POST /api/reports': () => ({ ok: true }),
  'POST /api/auth/register': () => ({ accessToken: 'a', refreshToken: 'r', user: ME }),
  'POST /api/auth/login': () => ({ accessToken: 'a', refreshToken: 'r', user: ME }),
  'POST /api/auth/logout': () => ({ ok: true }),
  'POST /api/notifications/read': () => ({ ok: true }),
};

function preparePeerKeys() {
  return WC.subtle.generateKey(PEER_CURVE, true, ['deriveBits']).then(async (pair) => {
    const pub = await WC.subtle.exportKey('spki', pair.publicKey);
    const priv = await WC.subtle.exportKey('pkcs8', pair.privateKey);
    peerPair = {
      publicKey: Buffer.from(pub).toString('base64'),
      privateKey: Buffer.from(priv).toString('base64'),
      curve: 'P-256',
    };
    return peerPair;
  });
}

function fakeFetch(window, calls) {
  return async function (input, init) {
    const url = String(input);
    const method = ((init && init.method) || 'GET').toUpperCase();
    const short = url.replace(/^https?:\/\/[^/]+/, '');
    const key = method + ' ' + short.split('?')[0];
    const withQuery = method + ' ' + short;
    calls.push(key);
    const handler = ROUTES[withQuery] || ROUTES[key];
    if (!handler) {
      return new window.Response(JSON.stringify({ error: { message: 'no fixture for ' + key } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    const body = handler(init && init.body ? JSON.parse(init.body) : {});
    return new window.Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/* --------------------------------------------------------------------- dom */

function makeWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="app" id="app">
    </div><div id="overlays"></div></body></html>`, { url: 'https://app.test/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom ships neither fetch types nor WebCrypto; the WebView does. Node's
  // undici Response and webcrypto stand in so the real client code runs.
  window.Response = Response;
  window.Request = Request;
  window.Headers = Headers;
  Object.defineProperty(window, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
  window.TextEncoder = require('node:util').TextEncoder;
  window.TextDecoder = require('node:util').TextDecoder;
  window.LivekitClient = { RoomEvent: {}, ExternalE2EEKeyProvider: null, E2EEManager: null };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLCanvasElement.prototype.getContext = function () {
    return { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, beginPath() {}, scale() {}, arc() {}, fill() {}, rect() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, translate() {}, rotate() {}, save() {}, restore() {}, clearRect() {}, fillRect() {}, quadraticCurveTo() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  };
  window.navigator.vibrate = () => true;
  window.OMLET_CONFIG = { apiBase: 'https://api.test' };
  return { dom, window };
}

function loadScripts(dom, window) {
  // Injected as real <script> elements so each file runs in the window's own
  // context, exactly as the browser would run it from index.html.
  for (const file of ORDER) {
    const script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(WEB, file), 'utf8');
    script.dataset.src = file;
    window.document.body.appendChild(script);
  }
}

function stubSocket(window) {
  const handlers = {};
  window.Socket = {
    connect() {}, disconnect() {}, send() {},
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => {}; },
    emitLocal(type, payload) { (handlers[type] || []).forEach((fn) => fn(payload)); },
    ready: true,
  };
}

async function bootClient() {
  await preparePeerKeys();
  const { dom, window } = makeWindow();
  const calls = [];
  window.fetch = fakeFetch(window, calls);
  loadScripts(dom, window);
  stubSocket(window);
  window.localStorage.setItem('oa.accessToken', 'test-access');
  window.localStorage.setItem('oa.refreshToken', 'test-refresh');
  window.localStorage.setItem('oa.user', JSON.stringify(ME));
  window.Api.init({});
  window.Router.boot();
  return { window, calls };
}

/** Render one route and return the screen root's text plus any error banners. */
async function renderRoute(window, hash) {
  window.location.hash = hash;
  window.Router.go(hash, { force: true });
  // Let the async render finish.
  for (let i = 0; i < 20; i += 1) await new Promise((r) => window.setTimeout(r, 5));
  const view = window.document.querySelector('#screen-scroll .screen');
  return {
    text: view.textContent || '',
    html: view.innerHTML || '',
    children: view.children.length,
    errors: Array.from(view.querySelectorAll('.banner--error')).filter((n) => !n.classList.contains('hidden')).map((n) => n.textContent),
  };
}

/* -------------------------------------------------------------------- tests */

test('every route renders content and no error banner', async () => {
  const { window } = await bootClient();
  const routes = [
    ['#/home', 'Start a party'],
    ['#/parties', 'Squad alpha'],
    ['#/party/7', 'Squad alpha'],
    ['#/friends', 'Kilo'],
    ['#/friends?tab=requests', 'Nothing pending'],
    // The fixture ciphertext is not ours, so the screen must say so instead of
    // rendering garbage: that is the tamper signal working.
    ['#/chat/2', 'Unreadable: wrong key or tampered message'],
    ['#/minecraft', 'Weekend survival'],
    ['#/minecraft/11', 'mc.example.net:19132'],
    ['#/feed', 'started a party'],
    ['#/notifications', 'Party invite'],
    ['#/profile', 'Nova'],
    ['#/profile/2', 'Kilo'],
    ['#/settings', 'Encryption key'],
    ['#/settings/sessions', 'Pixel 8'],
    ['#/streams', 'watching'],
    ['#/auth', 'Sign in'],
    // Regression: the signup link used to re-render the sign-in form because
    // the screen was registered under a slash key the router never resolves.
    ['#/auth/signup', 'Repeat password'],
  ];
  for (const [hash, expect] of routes) {
    const result = await renderRoute(window, hash);
    assert.deepEqual(result.errors, [], `${hash} rendered an error banner: ${result.errors.join('; ')}`);
    assert.ok(result.children > 0, `${hash} rendered nothing`);
    assert.ok(result.text.toLowerCase().includes(expect.toLowerCase()), `${hash} is missing "${expect}", got: ${result.text.slice(0, 220)}`);
  }
});

test('unknown route falls back to home instead of a blank screen', async () => {
  const { window } = await bootClient();
  await renderRoute(window, '#/nope/1/2/3');
  assert.equal(window.location.hash, '#/home');
  const view = window.document.querySelector('#screen-scroll .screen');
  assert.ok((view.textContent || '').length > 20, 'home fallback rendered nothing');
});

test('Api attaches the bearer token and surfaces typed errors', async () => {
  const { window, calls } = await bootClient();
  await window.Api.get('/api/users/me');
  assert.ok(calls.includes('GET /api/users/me'));
  const seen = [];
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const headers = init.headers || {};
    seen.push(typeof headers.get === 'function'
      ? (headers.get('Authorization') || headers.get('authorization'))
      : (headers.Authorization || headers.authorization));
    return realFetch(input, init);
  };
  await window.Api.get('/api/friends');
  assert.equal(seen[0], 'Bearer test-access');
  window.fetch = realFetch;
  await assert.rejects(() => window.Api.get('/api/does-not-exist'), (err) => err.status === 404);
});

test('E2EE seals and opens a DM frame with a real key pair', async () => {
  const { window } = await bootClient();
  const identity = await window.E2EE.ensureIdentity('correct horse battery staple');
  assert.ok(identity.publicKey && identity.publicKey.length > 20, 'no public key published');
  assert.ok(identity.fingerprint, 'no fingerprint for verification');
  // Same curve on both sides: derive a second identity and use its public half
  // as the peer's key, which is exactly what /api/keys/user/:id hands back.
  const other = await window.E2EE.generateIdentity();
  const peer = { id: 2, identityPublicKey: other.publicKey, curve: other.curve, username: 'kilo' };
  const pair = await window.RoomKey.forDirect(peer);
  assert.equal(pair.scopeId, '1:2');
  const sealed = await window.E2EE.seal(pair.key, 'hello from nova', 'chat:dm:' + pair.scopeId);
  const opened = await window.E2EE.open(pair.key, sealed, 'chat:dm:' + pair.scopeId);
  assert.equal(opened, 'hello from nova');
  const wrongAad = await window.E2EE.open(pair.key, sealed, 'chat:dm:9:9');
  assert.equal(wrongAad, null, 'a rewritten AAD must not open');
});

test('room key wraps to one blob and opens for the addressed member only', async () => {
  const { window } = await bootClient();
  const alice = await window.E2EE.generateIdentity();
  const bob = await window.E2EE.generateIdentity();
  const roomKey = window.E2EE.newRoomKey();
  const scope = 'party';
  const scopeId = '7';
  const sealed = await window.E2EE.wrapRoomKey(roomKey, alice.privateKey, bob.publicKey, scope, scopeId, 1, 2, alice.curve);
  const blob = window.E2EE.packFrame(sealed);
  assert.equal(typeof blob, 'string');
  // base64url, which the server's blob validator accepts and decodes.
  assert.ok(/^[A-Za-z0-9_-]+$/.test(blob), 'the packed blob must be base64url, the server stores one column');
  assert.ok(Buffer.from(blob, 'base64').length >= 29, 'iv + tag + at least one byte of ciphertext');
  const frame = window.E2EE.unpackFrame(blob);
  assert.deepEqual(Object.keys(frame).sort(), ['ciphertext', 'iv', 'tag']);
  const openedByBob = await window.E2EE.unwrapRoomKey(frame, bob.privateKey, alice.publicKey, scope, scopeId, 2, 1, bob.curve);
  assert.equal(openedByBob, roomKey, 'the addressed member must recover the room key');
  const mallory = await window.E2EE.generateIdentity();
  const openedByMallory = await window.E2EE.unwrapRoomKey(frame, mallory.privateKey, alice.publicKey, scope, scopeId, 3, 1, mallory.curve);
  assert.equal(openedByMallory, null, 'a third key must not open the blob');
  assert.equal(window.E2EE.unpackFrame('AAAA'), null, 'a truncated blob must be rejected, not decrypted');
});

test('recovery blob round-trips the identity key through PBKDF2', async () => {
  const { window } = await bootClient();
  const identity = await window.E2EE.generateIdentity();
  const blob = await window.E2EE.makeRecoveryBlob(identity.privateKey, 'pw-for-recovery', ME.id);
  assert.ok(blob.recoveryBlob && blob.recoverySalt, 'recovery blob is incomplete');
  const restored = await window.E2EE.openRecoveryBlob(blob.recoveryBlob, blob.recoverySalt, 'pw-for-recovery', ME.id);
  assert.equal(restored, identity.privateKey, 'recovery did not restore the same key');
  const wrong = await window.E2EE.openRecoveryBlob(blob.recoveryBlob, blob.recoverySalt, 'wrong-password', ME.id);
  assert.equal(wrong, null, 'a wrong password must not yield a key');
});
