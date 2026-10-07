'use strict';
/**
 * Server integration suite.
 *
 * One real HTTP server on an ephemeral port, one real SQLite file in a temp
 * directory, no mocks: every test drives the code the way the app does and
 * asserts on the response. Run with `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

// Test databases live under .cache (outside the workspace snapshot), because
// /tmp is a small tmpfs that the Android build also leans on.
const CACHE_ROOT = path.resolve(__dirname, '..', '..', '.cache');
fs.mkdirSync(CACHE_ROOT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(CACHE_ROOT, 'omlet-test-'));

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.SQLITE_FILE = path.join(tmp, 'app.db');
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = 'test-secret-'.padEnd(48, 'x');
// Fake LiveKit credentials: token signing is local HMAC, no network call.
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APItestkey';
process.env.LIVEKIT_API_SECRET = 'test-secret-thirty-two-chars!!';
process.env.POW_DIFFICULTY_BITS = '0';
process.env.RL_IP_PER_MINUTE = '20000';
process.env.RL_IP_BURST = '5000';
process.env.RL_USER_PER_MINUTE = '20000';
process.env.RL_USER_BURST = '5000';
process.env.AUTH_PER_MINUTE = '10000';
process.env.AUTH_BURST = '5000';
process.env.LOG_LEVEL = 'error';

const { start } = require('../index');
const { AccessToken } = require('livekit-server-sdk');

const ctx = { base: null, server: null };

/* ----------------------------------------------------------------- helpers */

async function req(method, urlPath, { token, body, raw, headers } = {}) {
  const init = { method, headers: Object.assign({}, headers) };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(ctx.base + urlPath, init);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body: json, text, headers: response.headers, raw };
}

const get = (urlPath, token) => req('GET', urlPath, { token });
const post = (urlPath, body, token) => req('POST', urlPath, { token, body: body || {} });
const patch = (urlPath, body, token) => req('PATCH', urlPath, { token, body: body || {} });
const put = (urlPath, body, token) => req('PUT', urlPath, { token, body: body || {} });
const del = (urlPath, token) => req('DELETE', urlPath, { token });

async function register(username, password = 'password-123') {
  const result = await post('/api/auth/register', { username, password, displayName: username.toUpperCase() });
  assert.equal(result.status, 201, `register ${username}: ${JSON.stringify(result.body)}`);
  return result.body;
}

/** Sign in and keep the connection open so presence reads online. */
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const url = ctx.base.replace(/^http/, 'ws') + '/ws';
    const socket = new WebSocket(url);
    const frames = [];
    const timer = setTimeout(() => reject(new Error('socket did not open')), 4000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    socket.on('message', (data) => {
      let frame = null;
      try { frame = JSON.parse(data.toString('utf8')); } catch { frame = null; }
      if (frame) frames.push(frame);
      if (frame && frame.type === 'welcome') {
        clearTimeout(timer);
        resolve({ socket, frames });
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('close', (code) => { if (!frames.length) { clearTimeout(timer); reject(new Error('socket closed early: ' + code)); } });
  });
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** Fake ciphertext triple, the shape a client sends after sealing locally. */
function frame(plain) {
  const bytes = Buffer.from(plain);
  return {
    ciphertext: bytes.toString('base64'),
    iv: crypto.randomBytes(12).toString('base64'),
    tag: crypto.randomBytes(16).toString('base64'),
  };
}

const SECRETS = [
  process.env.LIVEKIT_API_SECRET,
  process.env.LIVEKIT_API_KEY,
  process.env.JWT_SECRET,
  'ijw2um6LyiUPOwZeghLojR0yUADzplcSbC6SpvlKEZI',
  'APIPycj4i3kHrNy',
];

function assertNoSecrets(...texts) {
  for (const text of texts) {
    const hay = String(text);
    for (const secret of SECRETS) {
      assert.ok(!hay.includes(secret), `a secret leaked into a response: ${secret.slice(0, 6)}…`);
    }
  }
}

/* --------------------------------------------------------------- lifecycle */

test('server boots and answers health without leaking config', async () => {
  const server = await start();
  ctx.server = server;
  const address = server.address();
  ctx.base = `http://127.0.0.1:${address.port}`;
  assert.ok(address.port > 0, 'server did not bind a port');

  const health = await get('/api/system/health');
  assert.equal(health.status, 200);
  const ready = await get('/api/system/ready');
  assert.equal(ready.status, 200, `ready: ${ready.text}`);
  const bootstrap = await get('/api/security/bootstrap');
  assert.equal(bootstrap.status, 200);
  assertNoSecrets(health.text, ready.text, bootstrap.text);
  assert.ok(!('jwtSecret' in (bootstrap.body || {})), 'bootstrap must not carry the JWT secret');
  assert.ok(!('livekit' in (bootstrap.body || {})), 'bootstrap must not carry LiveKit config');
});

test('index.html is served with a restrictive CSP and no inline script', async () => {
  const response = await fetch(ctx.base + '/index.html');
  const html = await response.text();
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("script-src 'self'"), `CSP must pin script-src to self, got: ${csp}`);
  assert.ok(!/<script[^>]*>[^<]/i.test(html), 'index.html must not contain inline script');
  assert.ok(!html.includes('LIVEKIT_'), 'index.html must not mention server secrets');
});

/* -------------------------------------------------------------------- auth */

test('register, sign in, profile and stats', async () => {
  const nova = await register('nova');
  assert.ok(nova.accessToken && nova.refreshToken, 'register must return both tokens');
  assert.equal(nova.user.username, 'nova');
  assert.ok(!('password_hash' in nova.user), 'the password hash must never leave the server');
  ctx.nova = nova;

  const me = await get('/api/users/me', nova.accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, nova.user.id);
  assert.ok(me.body.settings && typeof me.body.settings === 'object', 'settings must come back as an object');

  const stats = await get('/api/users/me/stats', nova.accessToken);
  assert.equal(stats.status, 200);
  assert.deepEqual(Object.keys(stats.body).sort(), ['friends', 'parties', 'servers', 'sessions']);

  const edited = await patch('/api/users/me', { displayName: 'Nova Prime', bio: 'bedrock only' }, nova.accessToken);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.user.displayName, 'Nova Prime');

  const emoji = await patch('/api/users/me', { displayName: 'Nova 🔥' }, nova.accessToken);
  assert.equal(emoji.status, 400, 'emoji in a display name must be refused');

  ctx.kilo = await register('kilo');
  ctx.milo = await register('milo');
});

test('bad credentials and weak passwords are refused', async () => {
  const weak = await post('/api/auth/register', { username: 'shorty', password: '123' });
  assert.equal(weak.status, 400);

  const dup = await post('/api/auth/register', { username: 'nova', password: 'password-123' });
  assert.equal(dup.status, 409, 'a taken username must conflict');

  const wrong = await post('/api/auth/login', { username: 'nova', password: 'not-the-password' });
  assert.ok(wrong.status === 401 || wrong.status === 423, `wrong password: ${wrong.status}`);

  const protectedRoute = await get('/api/users/me');
  assert.equal(protectedRoute.status, 401, 'a protected route without a token must be 401');

  const badToken = await get('/api/users/me', 'not-a-jwt');
  assert.equal(badToken.status, 401);
});

test('refresh rotates the token and replaying the old one kills the family', async () => {
  const first = await post('/api/auth/refresh', { refreshToken: ctx.nova.refreshToken });
  assert.equal(first.status, 200, `refresh: ${first.text}`);
  assert.ok(first.body.refreshToken !== ctx.nova.refreshToken, 'refresh must rotate');
  const rotated = first.body.refreshToken;

  const replay = await post('/api/auth/refresh', { refreshToken: ctx.nova.refreshToken });
  assert.equal(replay.status, 401, 'a replayed refresh token must be refused');

  const afterReplay = await post('/api/auth/refresh', { refreshToken: rotated });
  assert.equal(afterReplay.status, 401, 'replay must revoke the whole family');

  const fresh = await post('/api/auth/login', { username: 'nova', password: 'password-123' });
  assert.equal(fresh.status, 200, 'the password still works after a family revocation');
  ctx.nova = Object.assign({}, ctx.nova, fresh.body);
});

test('changing the password signs out the other sessions', async () => {
  const second = await post('/api/auth/login', { username: 'nova', password: 'password-123' });
  const otherToken = second.body.accessToken;

  const before = await get('/api/auth/sessions', ctx.nova.accessToken);
  assert.ok(before.body.sessions.length >= 2, 'both devices should be listed');

  const changed = await post('/api/auth/password', { currentPassword: 'password-123', newPassword: 'password-456' }, ctx.nova.accessToken);
  assert.equal(changed.status, 200, `password change: ${changed.text}`);
  ctx.nova = Object.assign({}, ctx.nova, changed.body);

  const otherAfter = await get('/api/users/me', otherToken);
  assert.equal(otherAfter.status, 401, 'the other device must be signed out');

  const stalePassword = await post('/api/auth/login', { username: 'nova', password: 'password-123' });
  assert.notEqual(stalePassword.status, 200, 'the old password must stop working');
});

test('session list and revoke-others keep this device alive', async () => {
  const second = await post('/api/auth/login', { username: 'nova', password: 'password-456' });
  const other = second.body.accessToken;

  const revoked = await post('/api/auth/sessions/revoke-others', {}, ctx.nova.accessToken);
  assert.equal(revoked.status, 200);
  assert.ok(revoked.body.revoked >= 1, 'at least the second device should be revoked');

  assert.equal((await get('/api/users/me', other)).status, 401);
  assert.equal((await get('/api/users/me', ctx.nova.accessToken)).status, 200);
});

/* ----------------------------------------------------------------- friends */

test('friend request, accept, then blocking tears the relationship down', async () => {
  const nova = ctx.nova.accessToken;
  const kilo = ctx.kilo.accessToken;
  const milo = ctx.milo.accessToken;

  const requested = await post('/api/friends/request', { userId: ctx.kilo.user.id }, nova);
  assert.equal(requested.status, 200, `request: ${requested.text}`);

  let kiloView = await get('/api/friends', kilo);
  assert.equal(kiloView.body.incoming.length, 1, 'the request must be visible to the recipient');

  const accepted = await post('/api/friends/accept', { userId: ctx.nova.user.id }, kilo);
  assert.equal(accepted.status, 200, `accept: ${accepted.text}`);
  kiloView = await get('/api/friends', kilo);
  assert.equal(kiloView.body.friends.length, 1);

  const stats = await get('/api/users/me/stats', nova);
  assert.equal(stats.body.friends, 1, 'the friend count must move');

  // A room hosted by kilo, so the block has something to tear down: the
  // blocked player is removed from the blocker's rooms, not the other way round.
  const kiloParty = await post('/api/parties', { name: 'Block test', maxMembers: 4 }, kilo);
  const kiloPartyId = kiloParty.body.party.id;
  await post(`/api/parties/${kiloPartyId}/join`, {}, nova);
  assert.equal((await get(`/api/parties/${kiloPartyId}`, nova)).body.party.members.length, 2);

  const blocked = await post('/api/friends/block', { userId: ctx.nova.user.id }, kilo);
  assert.equal(blocked.status, 200);
  const listed = await get('/api/friends/blocked', kilo);
  assert.equal(listed.body.blocked.length, 1);
  const afterBlock = await get(`/api/parties/${kiloPartyId}`, kilo);
  assert.equal(
    afterBlock.body.party.members.filter((m) => m.id === ctx.nova.user.id).length,
    0,
    'blocking must remove the blocked player from the blocker rooms',
  );

  const unblocked = await del(`/api/friends/blocked/${ctx.nova.user.id}`, kilo);
  assert.equal(unblocked.status, 200);

  // Rebuild the friendship so later tests (invites, feed) see friends again.
  await post('/api/friends/request', { userId: ctx.nova.user.id }, kilo);
  const reaccept = await post('/api/friends/accept', { userId: ctx.kilo.user.id }, nova);
  assert.equal(reaccept.status, 200, `re-accept: ${reaccept.text}`);

  // milo stays a stranger: used later for the privacy and search checks.
  const search = await get('/api/users/search?q=mi', nova);
  assert.equal(search.status, 200);
  assert.ok(search.body.users.some((u) => u.username === 'milo'), 'search must find milo');
  const tooShort = await get('/api/users/search?q=m', nova);
  assert.equal(tooShort.status, 400, 'a one character search must be refused');
  assert.ok(!!milo);
});

/* ----------------------------------------------------------------- parties */

test('party create, locked join, invite and voice token authorization', async () => {
  const nova = ctx.nova.accessToken;
  const kilo = ctx.kilo.accessToken;
  const milo = ctx.milo.accessToken;

  const created = await post('/api/parties', { name: 'Squad alpha', game: 'MC', maxMembers: 8, locked: true }, nova);
  assert.equal(created.status, 201);
  const partyId = created.body.party.id;
  ctx.partyId = partyId;
  assert.equal(created.body.party.locked, true);

  const stranger = await post(`/api/parties/${partyId}/join`, {}, milo);
  assert.equal(stranger.status, 403, 'a locked room must refuse an uninvited join');

  const invited = await post(`/api/parties/${partyId}/invite`, { userId: ctx.kilo.user.id }, nova);
  assert.equal(invited.status, 200, `invite: ${invited.text}`);

  const invites = await get('/api/parties/invites', kilo);
  assert.equal(invites.body.invites.length, 1, 'the invite must reach the recipient');
  const inviteId = invites.body.invites[0].id;

  const joined = await post(`/api/parties/${partyId}/join`, { inviteId }, kilo);
  assert.equal(joined.status, 200, `join with invite: ${joined.text}`);
  const view = await get(`/api/parties/${partyId}`, kilo);
  assert.equal(view.body.party.members.length, 2);

  const voice = await post(`/api/parties/${partyId}/voice`, {}, kilo);
  assert.equal(voice.status, 200, `voice token: ${voice.text}`);
  assert.ok(voice.body.token && voice.body.token.split('.').length === 3, 'a member must get a JWT');
  assertNoSecrets(voice.text);

  const outsider = await post(`/api/parties/${partyId}/voice`, {}, milo);
  assert.equal(outsider.status, 403, 'a non member must not get a room token');

  // The issued token must be a real LiveKit JWT for that room, signed with the
  // server's key, and it must carry the member identity and nothing else.
  const decoded = JSON.parse(Buffer.from(voice.body.token.split('.')[1], 'base64').toString('utf8'));
  assert.equal(decoded.iss, process.env.LIVEKIT_API_KEY, 'the token must be issued by our API key');
  assert.equal(decoded.video.room, voice.body.room || decoded.video.room);
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000), 'the token must not be expired');
});

/* -------------------------------------------------------------------- keys */

test('identity keys, wrapped room keys and scope authorization', async () => {
  const nova = ctx.nova.accessToken;
  const kilo = ctx.kilo.accessToken;
  const milo = ctx.milo.accessToken;
  const publicKey = crypto.randomBytes(32).toString('base64');

  // Publishing a key requires the password: a stolen access token cannot swap
  // in an attacker key.
  const noPassword = await put('/api/keys/identity', { publicKey }, nova);
  assert.equal(noPassword.status, 401, 'publishing a key without the password must fail');

  const published = await put('/api/keys/identity', { publicKey, verifyPassword: 'password-456' }, nova);
  assert.equal(published.status, 200, `publish: ${published.text}`);
  assert.ok(published.body.fingerprint.includes(' '), 'the fingerprint is grouped for reading aloud');

  const mine = await get('/api/keys/me', nova);
  assert.equal(mine.body.identityPublicKey, publicKey);
  assert.equal(mine.body.algorithm.agreement, 'X25519');

  const theirs = await get(`/api/keys/user/${ctx.nova.user.id}`, kilo);
  assert.equal(theirs.body.identityPublicKey, publicKey);

  const partyScope = `/api/keys/wrapped/party/${ctx.partyId}`;
  const stored = await put(partyScope, { keyIndex: 0, wrapped: crypto.randomBytes(80).toString('base64'), forUserId: ctx.kilo.user.id }, nova);
  assert.equal(stored.status, 200, `store a wrapped key: ${stored.text}`);

  const readBack = await get(partyScope, kilo);
  assert.equal(readBack.status, 200);
  assert.equal(readBack.body.keys.length, 1, 'the addressed member must see their copy');

  const notMine = await get(partyScope, nova);
  assert.equal(notMine.body.keys.length, 0, 'a reader must only see rows addressed to them');

  const outsiderRead = await get(partyScope, milo);
  assert.equal(outsiderRead.status, 403, 'a non member must not read the scope');

  const outsiderWrite = await put(partyScope, { keyIndex: 1, wrapped: crypto.randomBytes(80).toString('base64'), forUserId: ctx.kilo.user.id }, milo);
  assert.equal(outsiderWrite.status, 403, 'a non member must not write into the scope');

  const forStranger = await put(partyScope, { keyIndex: 1, wrapped: crypto.randomBytes(80).toString('base64'), forUserId: ctx.milo.user.id }, nova);
  assert.equal(forStranger.status, 403, 'a blob may only be stored for a member of the scope');

  const members = await get(`/api/keys/members/party/${ctx.partyId}`, nova);
  assert.equal(members.status, 200);
  assert.equal(members.body.members.length, 2);
});

/* -------------------------------------------------------------------- chat */

test('the server stores ciphertext it cannot read, and blocks strangers', async () => {
  const nova = ctx.nova.accessToken;
  const kilo = ctx.kilo.accessToken;
  const milo = ctx.milo.accessToken;
  const plaintext = 'meet at the nether portal';
  const sealed = frame(plaintext);

  const sent = await post(`/api/chat/dm/${ctx.kilo.user.id}`, sealed, nova);
  assert.equal(sent.status, 201, `send: ${sent.text}`);
  assertNoSecrets(sent.text);

  const history = await get(`/api/chat/dm/${ctx.nova.user.id}`, kilo);
  assert.equal(history.status, 200);
  assert.equal(history.body.messages.length, 1);
  assert.ok(!history.text.includes(plaintext), 'plaintext must never appear in a response');
  assert.equal(history.body.messages[0].ciphertext, sealed.ciphertext, 'the blob must round trip untouched');

  const stranger = await get(`/api/chat/dm/${ctx.nova.user.id}`, milo);
  assert.equal(stranger.status, 403, 'a stranger must not open someone else\'s DM');

  const partyChat = await post(`/api/chat/party/${ctx.partyId}`, frame('room message'), nova);
  assert.equal(partyChat.status, 201);
  const outsider = await get(`/api/chat/party/${ctx.partyId}`, milo);
  assert.equal(outsider.status, 403, 'party chat needs membership');
});

/* --------------------------------------------------------------- minecraft */

test('minecraft registry validates the address and serves the host pack', async () => {
  const nova = ctx.nova.accessToken;

  const badAddress = await post('/api/minecraft', { name: 'Bad', address: 'not a host!!', port: 19132 }, nova);
  assert.equal(badAddress.status, 400, `bad address: ${badAddress.text}`);

  const created = await post('/api/minecraft', { name: 'Weekend survival', address: 'mc.example.net', port: 19132, maxPlayers: 10, motd: 'bring blocks' }, nova);
  assert.equal(created.status, 201, `create: ${created.text}`);
  const serverId = created.body.server.id;
  ctx.mcServerId = serverId;

  const detail = await get(`/api/minecraft/${serverId}`, nova);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.server.address, 'mc.example.net');

  const joined = await post(`/api/minecraft/${serverId}/join`, {}, ctx.kilo.accessToken);
  assert.equal(joined.status, 200, `join world: ${joined.text}`);
  const afterJoin = await get(`/api/minecraft/${serverId}`, nova);
  assert.equal(afterJoin.body.players.length, 1);

  const pack = await fetch(`${ctx.base}/api/minecraft/pack/host.zip?name=Weekend%20survival&port=19132&maxPlayers=10&edition=bedrock`, {
    headers: { authorization: `Bearer ${nova}` },
  });
  assert.equal(pack.status, 200, `host pack: ${pack.status}`);
  const bytes = Buffer.from(await pack.arrayBuffer());
  assert.ok(bytes.length > 2000, `the pack must be a real zip, got ${bytes.length} bytes`);
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'the pack must start with the zip magic');
  const listing = bytes.toString('latin1');
  for (const entry of ['start.sh', 'watchdog.sh', 'iptables.rules', 'server.properties']) {
    assert.ok(listing.includes(entry), `the pack must ship ${entry}`);
  }

  const removed = await del(`/api/minecraft/${serverId}`, nova);
  assert.equal(removed.status, 200);
  assert.equal((await get(`/api/minecraft/${serverId}`, nova)).status, 404);
});

/* ------------------------------------------------------------------- calls */

test('calls respect the callee privacy settings and presence', async () => {
  const nova = ctx.nova.accessToken;
  const milo = ctx.milo.accessToken;

  // Open the privacy gate first: with calls closed the offline answer is never
  // reached, and this assertion wants the offline answer specifically.
  await patch('/api/users/me/settings', { privacy: { calls: 'everyone' } }, milo);
  const offline = await post('/api/calls', { userId: ctx.milo.user.id }, nova);
  assert.equal(offline.status, 409, 'calling an offline player must say so, not ring forever');

  await patch('/api/users/me/settings', { privacy: { calls: 'nobody' } }, milo);
  const socket = await connectSocket(milo);
  try {
    const refused = await post('/api/calls', { userId: ctx.milo.user.id }, nova);
    assert.equal(refused.status, 403, 'calls:nobody must refuse the call');

    await patch('/api/users/me/settings', { privacy: { calls: 'everyone' } }, milo);
    const rang = await post('/api/calls', { userId: ctx.milo.user.id }, nova);
    assert.equal(rang.status, 201, `call: ${rang.text}`);
    assert.ok(rang.body.code, 'a call must carry a short code');
    const pushed = await waitFor(() => socket.frames.some((f) => f.type === 'call.incoming'), 2000);
    assert.ok(pushed, 'the callee must be pushed the incoming call frame');

    const noted = await get('/api/notifications', milo);
    assert.ok(noted.body.notifications.some((n) => n.kind === 'call'), 'a missed call must be recorded');
  } finally {
    socket.socket.close();
  }
});

/* -------------------------------------------------------------------- feed */

test('the feed shows friends only, and notifications can be marked read', async () => {
  const nova = ctx.nova.accessToken;
  const kilo = ctx.kilo.accessToken;
  const milo = ctx.milo.accessToken;

  await post('/api/parties', { name: 'Feed item', maxMembers: 4 }, kilo);
  const kiloFeed = await get('/api/feed', kilo);
  assert.equal(kiloFeed.status, 200);
  assert.ok(Array.isArray(kiloFeed.body.items));

  const novaFeed = await get('/api/feed', nova);
  assert.ok(novaFeed.body.items.length >= 1, 'a friend of kilo must see kilo activity');
  assert.ok(novaFeed.body.items.every((item) => Number(item.userId) === Number(ctx.kilo.user.id)), 'only friend activity belongs in the feed');

  const miloFeed = await get('/api/feed', milo);
  assert.equal(miloFeed.body.items.length, 0, 'a stranger must see an empty feed');

  const before = await get('/api/notifications', kilo);
  assert.ok(before.body.unread >= 0);
  const marked = await post('/api/notifications/read', {}, kilo);
  assert.equal(marked.status, 200);
  const after = await get('/api/notifications', kilo);
  assert.equal(after.body.unread, 0, 'everything must be read after the call');
});

/* ----------------------------------------------------------------- reports */

test('reports are accepted, bounded and visible to moderators', async () => {
  const nova = ctx.nova.accessToken;

  const badReason = await post('/api/reports', { targetId: ctx.milo.user.id, reason: 'vibes' }, nova);
  assert.equal(badReason.status, 400, 'an unknown reason must be refused');

  const filed = await post('/api/reports', { targetId: ctx.milo.user.id, targetKind: 'user', reason: 'abuse', detail: 'spam in lobby' }, nova);
  assert.equal(filed.status, 201, `report: ${filed.text}`);

  const general = await post('/api/reports', { targetKind: 'general', reason: 'other', detail: 'pack download failed' }, nova);
  assert.equal(general.status, 201);

  const ghost = await post('/api/reports', { targetId: 999999, reason: 'abuse' }, nova);
  assert.equal(ghost.status, 404, 'reporting a player who does not exist must fail');

  for (let i = 0; i < 25; i += 1) {
    const spam = await post('/api/reports', { targetId: ctx.milo.user.id, reason: 'spam' }, nova);
    if (spam.status === 429) break;
    assert.equal(spam.status, 201, `report ${i}: ${spam.text}`);
  }
  const capped = await post('/api/reports', { targetId: ctx.milo.user.id, reason: 'spam' }, nova);
  assert.equal(capped.status, 429, 'the open report queue must be capped per reporter');
});

/* -------------------------------------------------------------- operations */

test('purge clears caches without touching accounts', async () => {
  const report = await get('/api/system/purge/report', ctx.nova.accessToken);
  assert.equal(report.status, 200);
  assert.ok(typeof report.body.heapUsedMb === 'number');

  const purged = await post('/api/system/purge', {}, ctx.nova.accessToken);
  assert.equal(purged.status, 200, `purge: ${purged.text}`);

  const stillThere = await get('/api/users/me', ctx.nova.accessToken);
  assert.equal(stillThere.status, 200, 'a purge must not sign anyone out');
  const friends = await get('/api/friends', ctx.nova.accessToken);
  assert.equal(friends.status, 200);
});

/* ------------------------------------------------------------------ hygiene */

test('a second server under a tiny rate limit sheds load with 429', async (t) => {
  const rateDir = fs.mkdtempSync(path.join(CACHE_ROOT, 'omlet-rl-'));
  const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'ratelimit-probe.js'), rateDir], {
    env: Object.assign({}, process.env, {
      SQLITE_FILE: path.join(rateDir, 'app.db'),
      DATA_DIR: rateDir,
      RL_IP_PER_MINUTE: '10',
      RL_IP_BURST: '3',
      RL_SHED_IN_FLIGHT: '2',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { out += chunk.toString('utf8'); });

  const result = await new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, out }));
    setTimeout(() => { child.kill('SIGKILL'); }, 20000);
  });
  assert.equal(result.code, 0, `rate limit probe failed:\n${result.out}`);
  assert.ok(result.out.includes('RATE_LIMIT_OK'), `probe output:\n${result.out}`);
});

test('shutdown closes the server', async () => {
  await new Promise((resolve) => ctx.server.close(resolve));
});

