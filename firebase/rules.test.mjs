// Rules test suite. Run against the local emulator:
//   firebase emulators:start --only database --project demo-arcade
//   node rules.test.mjs
//
// Every scenario the Android client performs is exercised here, together with
// the abuse cases the rules must refuse. The rules are the only authorisation
// layer in this system, so this file is the safety net for it.

const BASE = 'http://127.0.0.1:9000';
const NS = 'demo-arcade-default-rtdb';
const SV = { '.sv': 'timestamp' };

const ROOM = 'stream_ab12cd34ef56gh78ij90';
const MC = 'mc_zz11yy22xx33ww44vv55';
const CODE = 'K7PQ2M9X';
const KEY_ID = 'a'.repeat(32);
const PUB = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY3ODkw';

let passed = 0;
let failed = 0;

// The emulator accepts an unsigned ID token and trusts its payload, which is
// exactly how a signed-in client looks to the rules.
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const tokenFor = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: 'https://securetoken.google.com/demo-arcade',
    aud: 'demo-arcade',
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
  })}.`;
};

const url = (path, uid) => {
  const auth = uid ? `&auth=${tokenFor(uid)}` : '';
  return `${BASE}/${path}.json?ns=${NS}${auth}`;
};

const call = async (method, path, uid, body) =>
  fetch(url(path, uid), {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const check = async (label, expectation, method, path, uid, body) => {
  const response = await call(method, path, uid, body);
  const allowed = response.ok;
  const want = expectation === 'allow';
  if (allowed === want) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    const text = await response.text();
    console.log(`  FAIL  ${label} -> ${response.status} ${text.slice(0, 120)}`);
  }
  return response;
};

const allow = (label, method, path, uid, body) => check(label, 'allow', method, path, uid, body);
const deny = (label, method, path, uid, body) => check(label, 'deny', method, path, uid, body);

const section = (name) => console.log(`\n${name}`);

// Reset between runs. "owner" is the emulator's admin credential.
await fetch(`${BASE}/.json?ns=${NS}`, {
  method: 'DELETE',
  headers: { authorization: 'Bearer owner' },
});

section('root');
await deny('anonymous cannot read the root', 'GET', '', null);
await deny('anonymous cannot write the root', 'PUT', '', null, { x: 1 });

section('profiles');
const profile = { displayName: 'alice', avatarId: 3, bio: 'hi', createdAt: SV, updatedAt: SV };
await allow('owner writes own profile', 'PUT', 'users/alice', 'alice', profile);
await deny('other user cannot write a profile', 'PUT', 'users/alice', 'bob', profile);
await deny('client cannot set the disabled flag', 'PUT', 'users/alice', 'alice', {
  ...profile,
  disabled: true,
});
await deny('client cannot set disabled on its own', 'PUT', 'users/alice/disabled', 'alice', true);
await deny('unknown profile fields are rejected', 'PUT', 'users/alice', 'alice', {
  ...profile,
  role: 'admin',
});
await deny('display name must be at least 2 chars', 'PUT', 'users/alice', 'alice', {
  ...profile,
  displayName: 'a',
});
await deny('profile updates cannot rewrite createdAt', 'PUT', 'users/alice', 'alice', {
  ...profile,
  createdAt: 1,
});
await deny('unauthenticated cannot read a profile', 'GET', 'users/alice', null);
await allow('signed in user can read a profile', 'GET', 'users/alice', 'bob');

section('device keys');
await allow('owner publishes a public key', 'PUT', 'userKeys/alice', 'alice', {
  keyId: KEY_ID,
  publicKey: PUB,
  algorithm: 'HPKE_X25519_HKDF_SHA256_AES256GCM',
  updatedAt: SV,
});
await deny('nobody else can publish that key', 'PUT', 'userKeys/alice', 'bob', {
  keyId: KEY_ID,
  publicKey: PUB,
  algorithm: 'HPKE_X25519_HKDF_SHA256_AES256GCM',
  updatedAt: SV,
});
await allow('members can read a public key', 'GET', 'userKeys/alice', 'bob');
await allow('bob publishes his key', 'PUT', 'userKeys/bob', 'bob', {
  keyId: 'b'.repeat(32),
  publicKey: PUB,
  algorithm: 'HPKE_X25519_HKDF_SHA256_AES256GCM',
  updatedAt: SV,
});

section('creating a room');
const room = {
  kind: 'stream',
  ownerUid: 'alice',
  ownerName: 'alice',
  title: 'Speedrun night',
  state: 'live',
  maxParticipants: 50,
  e2ee: true,
  createdAt: SV,
};
await deny('cannot create a room owned by someone else', 'PUT', `rooms/${ROOM}`, 'bob', room);
await deny('room id must match the mask', 'PUT', 'rooms/stream_SHORT', 'alice', room);
await allow('owner creates the room', 'PUT', `rooms/${ROOM}`, 'alice', room);
await deny('owner cannot add unknown room fields', 'PUT', `rooms/${ROOM}/secret`, 'alice', 'x');
await deny('a stranger cannot read the room', 'GET', `rooms/${ROOM}`, 'carol');
await allow('owner reads the room', 'GET', `rooms/${ROOM}`, 'alice');
await allow('owner records own membership', 'PUT', `roomMembers/${ROOM}/alice`, 'alice', {
  role: 'owner',
  joinedAt: SV,
});

section('public listing');
const listing = {
  ownerUid: 'alice',
  ownerName: 'alice',
  title: 'Speedrun night',
  game: 'Celeste',
  viewers: 0,
  e2ee: true,
  voiceEnabled: true,
  createdAt: SV,
};
await deny('non owner cannot publish a listing', 'PUT', `listings/stream/${ROOM}`, 'bob', {
  ...listing,
  ownerUid: 'bob',
});
await allow('owner publishes the listing', 'PUT', `listings/stream/${ROOM}`, 'alice', listing);
await allow('anyone signed in browses listings', 'GET', 'listings/stream', 'carol');
await deny('listing cannot claim a room you do not own', 'PUT', `listings/stream/${ROOM}`, 'bob', listing);

section('joining');
await allow('bob joins the live room', 'PUT', `roomMembers/${ROOM}/bob`, 'bob', {
  role: 'viewer',
  joinedAt: SV,
});
await deny('bob cannot invent a role', 'PUT', `roomMembers/${ROOM}/bob`, 'bob', {
  role: 'admin',
  joinedAt: SV,
});
await deny('bob cannot add someone else', 'PUT', `roomMembers/${ROOM}/carol`, 'bob', {
  role: 'viewer',
  joinedAt: SV,
});
await allow('member reads the room record', 'GET', `rooms/${ROOM}`, 'bob');
await allow('member sees the member list', 'GET', `roomMembers/${ROOM}`, 'bob');
await deny('a stranger cannot see the member list', 'GET', `roomMembers/${ROOM}`, 'carol');

section('invite codes');
await allow('host creates the mc room', 'PUT', `rooms/${MC}`, 'alice', {
  kind: 'mc',
  ownerUid: 'alice',
  ownerName: 'alice',
  title: 'Survival world',
  state: 'live',
  maxParticipants: 8,
  e2ee: true,
  createdAt: SV,
});
await allow('host registers the invite code', 'PUT', `joinIndex/${CODE}`, 'alice', MC);
await deny('nobody else can overwrite the code', 'PUT', `joinIndex/${CODE}`, 'bob', ROOM);
await deny('codes outside the alphabet are rejected', 'PUT', 'joinIndex/lowercase', 'alice', MC);
await allow('knowing the code resolves it', 'GET', `joinIndex/${CODE}`, 'bob');
await deny('the code list cannot be enumerated', 'GET', 'joinIndex', 'bob');

section('wrapped room keys');
const envelope = { keyId: KEY_ID, wrappedKey: PUB, senderUid: 'alice', createdAt: SV };
await allow('host wraps the key for bob', 'PUT', `roomKeys/${ROOM}/bob`, 'alice', envelope);
await deny('a member cannot forge an envelope', 'PUT', `roomKeys/${ROOM}/carol`, 'bob', {
  ...envelope,
  senderUid: 'bob',
});
await allow('bob reads his own envelope', 'GET', `roomKeys/${ROOM}/bob`, 'bob');
await deny('carol cannot read bob envelope', 'GET', `roomKeys/${ROOM}/bob`, 'carol');
await deny('envelope list is not readable', 'GET', `roomKeys/${ROOM}`, 'alice');

section('chat');
const message = {
  senderUid: 'bob',
  ciphertext: PUB,
  nonce: 'MTIzNDU2Nzg5MDEy',
  keyId: KEY_ID,
  ts: SV,
};
await allow('member posts ciphertext', 'POST', `chat/${ROOM}`, 'bob', message);
await deny('non member cannot post', 'POST', `chat/${ROOM}`, 'carol', { ...message, senderUid: 'carol' });
await deny('cannot post as another user', 'POST', `chat/${ROOM}`, 'bob', { ...message, senderUid: 'alice' });
await deny('plaintext fields are rejected', 'POST', `chat/${ROOM}`, 'bob', { ...message, text: 'hello' });
await allow('member reads the chat', 'GET', `chat/${ROOM}`, 'bob');
await deny('non member cannot read the chat', 'GET', `chat/${ROOM}`, 'carol');

section('moderation');
await allow('owner bans carol', 'PUT', `roomBans/${ROOM}/carol`, 'alice', { at: SV, by: 'alice' });
await deny('bans are never readable', 'GET', `roomBans/${ROOM}/carol`, 'alice');
await deny('members cannot ban', 'PUT', `roomBans/${ROOM}/bob`, 'bob', { at: SV, by: 'bob' });
await deny('a banned user cannot join', 'PUT', `roomMembers/${ROOM}/carol`, 'carol', {
  role: 'viewer',
  joinedAt: SV,
});
await allow('owner removes a member', 'DELETE', `roomMembers/${ROOM}/bob`, 'alice');
await allow('owner removes the key copy', 'DELETE', `roomKeys/${ROOM}/bob`, 'alice');

section('reports');
await allow('user files a report', 'POST', 'reports', 'bob', {
  reporterUid: 'bob',
  targetUid: 'alice',
  reason: 'spam',
  ts: SV,
});
await deny('reports cannot be read back', 'GET', 'reports', 'alice');
await deny('cannot report as someone else', 'POST', 'reports', 'bob', {
  reporterUid: 'carol',
  targetUid: 'alice',
  reason: 'spam',
  ts: SV,
});

section('headcount');
await allow('owner refreshes the viewer count', 'PUT', `listings/stream/${ROOM}/viewers`, 'alice', 4);
await deny('a viewer cannot inflate the count', 'PUT', `listings/stream/${ROOM}/viewers`, 'bob', 999);
await deny('the count must stay a number', 'PUT', `listings/stream/${ROOM}/viewers`, 'alice', 'many');

section('closing');
await deny('a member cannot end the session', 'PUT', `rooms/${ROOM}/state`, 'bob', 'ended');
// The client closes a session with one fan-out update at the root; every leaf
// of that update has to pass on its own.
await deny('a member cannot fan out a close', 'PATCH', '', 'bob', {
  [`rooms/${ROOM}/state`]: 'ended',
  [`rooms/${ROOM}/endedAt`]: SV,
});
await allow('owner closes with a single fan-out write', 'PATCH', '', 'alice', {
  [`rooms/${ROOM}/state`]: 'ended',
  [`rooms/${ROOM}/endedAt`]: SV,
  [`roomMembers/${ROOM}/alice`]: null,
});
await allow('owner removes the listing', 'DELETE', `listings/stream/${ROOM}`, 'alice');
await allow('owner releases the invite code', 'DELETE', `joinIndex/${CODE}`, 'alice');
await deny('nobody joins a finished session', 'PUT', `roomMembers/${ROOM}/dave`, 'dave', {
  role: 'viewer',
  joinedAt: SV,
});

// ---- profile fields, search, posts, lan -------------------------------------

const queryCheck = async (label, expectation, path, uid, qs) => {
  const response = await fetch(`${url(path, uid)}&${qs}`);
  const ok = response.ok;
  if (ok === (expectation === 'allow')) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label} -> ${response.status} ${(await response.text()).slice(0, 120)}`);
  }
};

const JPEG = 'QUJDRA=='; // tiny base64 payload, shape is what the rules check

section('profile extras');
await allow('alice stores the searchable name', 'PATCH', 'users/alice', 'alice', {
  displayName: 'Alice',
  nameLower: 'alice',
  avatarId: 1,
  updatedAt: SV,
});
await deny('nameLower must mirror displayName', 'PATCH', 'users/alice', 'alice', {
  displayName: 'Alice',
  nameLower: 'bob',
  updatedAt: SV,
});
await allow('alice sets an avatar photo', 'PATCH', 'users/alice', 'alice', {
  photo: JPEG,
  updatedAt: SV,
});
await deny('a photo cannot be arbitrary text', 'PATCH', 'users/alice', 'alice', {
  photo: 'not base64 !!',
  updatedAt: SV,
});
await deny('an oversized photo is refused', 'PATCH', 'users/alice', 'alice', {
  photo: 'A'.repeat(90004),
  updatedAt: SV,
});
await allow('mission progress is recorded', 'PUT', 'users/alice/missions/author', 'alice', 1);
await deny('mission progress stays a number', 'PUT', 'users/alice/missions/author', 'alice', 'done');
await deny('mission ids are constrained', 'PUT', 'users/alice/missions/DROP_TABLE', 'alice', 1);
await deny('bob cannot move alice forward', 'PUT', 'users/alice/missions/author', 'bob', 5);
await allow('xp may grow', 'PATCH', 'users/alice', 'alice', { xp: 120, updatedAt: SV });
await deny('xp cannot be rolled back', 'PATCH', 'users/alice', 'alice', { xp: 10, updatedAt: SV });
await deny('bob cannot grant himself xp on alice', 'PATCH', 'users/alice', 'bob', { xp: 9999, updatedAt: SV });

section('user search');
await queryCheck('prefix search is allowed', 'allow', 'users', 'bob', 'orderBy=%22nameLower%22&limitToFirst=20');
await queryCheck('a bulk dump is refused', 'deny', 'users', 'bob', '');
await queryCheck('a wide page is refused', 'deny', 'users', 'bob', 'orderBy=%22nameLower%22&limitToFirst=500');
await queryCheck('anonymous search is refused', 'deny', 'users', null, 'orderBy=%22nameLower%22&limitToFirst=20');

section('posts');
const POST = 'post_alice_1';
await allow('alice publishes a post', 'PUT', `posts/${POST}`, 'alice', {
  authorUid: 'alice',
  authorName: 'Alice',
  text: 'первый стрим сегодня',
  image: JPEG,
  createdAt: SV,
});
await deny('a post cannot be signed with another uid', 'PUT', 'posts/post_fake', 'bob', {
  authorUid: 'alice',
  authorName: 'Alice',
  text: 'не я',
  createdAt: SV,
});
await deny('a post body has a limit', 'PUT', 'posts/post_long', 'bob', {
  authorUid: 'bob',
  authorName: 'Bob',
  text: 'x'.repeat(501),
  createdAt: SV,
});
await deny('a post image has a limit', 'PUT', 'posts/post_big', 'bob', {
  authorUid: 'bob',
  authorName: 'Bob',
  text: 'большая картинка',
  image: 'A'.repeat(270004),
  createdAt: SV,
});
await deny('unknown fields are refused', 'PUT', 'posts/post_extra', 'bob', {
  authorUid: 'bob',
  authorName: 'Bob',
  text: 'привет',
  pinned: true,
  createdAt: SV,
});
await deny('timestamps cannot be faked', 'PUT', 'posts/post_past', 'bob', {
  authorUid: 'bob',
  authorName: 'Bob',
  text: 'назад в прошлое',
  createdAt: 1,
});
await deny('a post cannot be edited after the fact', 'PUT', `posts/${POST}/text`, 'alice', 'правка');
await deny('bob cannot delete alice post', 'DELETE', `posts/${POST}`, 'bob');
await allow('a signed-in reader opens a post', 'GET', `posts/${POST}`, 'bob');
await queryCheck('the feed page is allowed', 'allow', 'posts', 'bob', 'orderBy=%22createdAt%22&limitToLast=30');
await queryCheck('the author page is allowed', 'allow', 'posts', 'bob', 'orderBy=%22authorUid%22&limitToLast=50&equalTo=%22alice%22');
await queryCheck('dumping every post is refused', 'deny', 'posts', 'bob', '');
await allow('the author deletes the post', 'DELETE', `posts/${POST}`, 'alice');

section('lan address');
await allow('the host publishes its lan address', 'PUT', `rooms/${MC}/lan`, 'alice', '192.168.1.42:19132');
await deny('the lan address must look like an address', 'PUT', `rooms/${MC}/lan`, 'alice', 'https://evil.example/x');
await deny('another player cannot rewrite it', 'PUT', `rooms/${MC}/lan`, 'bob', '10.0.0.5:19132');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
