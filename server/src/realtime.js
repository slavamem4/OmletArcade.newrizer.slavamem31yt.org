'use strict';
/**
 * Realtime hub.
 *
 * One WebSocket per device. The socket carries presence, party events, call
 * signalling and encrypted chat frames. It never carries plaintext message
 * bodies: a chat frame is forwarded exactly as the client sealed it.
 *
 * Abuse control lives in the connection path, not in the handlers: per-IP
 * connection cap, a mandatory auth frame within a timeout, a per-second
 * message budget, and a payload cap. A socket that breaks any of them is
 * closed with a distinct code so the client can explain it.
 */
const { WebSocketServer } = require('ws');
const { config } = require('./config');
const rateLimit = require('./security/rate-limit');
const logger = require('./logger');
const cache = require('./lib/cache');

const AUTH_TIMEOUT_CODE = 4001;
const RATE_CODE = 4008;
const BAN_CODE = 4003;
const SHED_CODE = 4013;
const PROTOCOL_CODE = 4002;

const MAX_TOTAL_CONNECTIONS = Number(process.env.WS_MAX_TOTAL || 2000);
const MAX_BUFFERED_BYTES = 256 * 1024;
const PRESENCE_FLUSH_MS = 60000;

const socketsByUser = new Map();     // userId -> Set<socket>
const socketsByChannel = new Map();  // channelId -> Set<socket>
const partyOfSocket = new Map();     // socket -> partyId
const ipCounts = cache.create({ name: 'ws:ips', max: 100000, ttlMs: 24 * 60 * 60 * 1000 });
const muted = cache.create({ name: 'ws:muted', max: 20000, ttlMs: 6 * 60 * 60 * 1000 });
const speaking = new Map();          // socket -> expiry

let wss = null;
let connections = 0;

const ALLOWED_TYPES = new Set([
  'ping', 'presence', 'typing', 'speaking',
  'message', 'party.event', 'call.signal',
]);

function send(socket, payload) {
  if (socket.readyState !== 1) return false;
  // A stalled consumer must not be able to grow the heap: drop instead.
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    logger.warn('ws: dropping frame for a stalled socket', { user: socket.userId });
    return false;
  }
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    logger.warn('ws: send failed', { message: err.message });
    return false;
  }
}

function userSockets(userId) {
  return socketsByUser.get(Number(userId));
}

function isOnline(userId) {
  const set = userSockets(userId);
  return !!set && set.size > 0;
}

function sendToUser(userId, payload) {
  const set = userSockets(userId);
  if (!set) return 0;
  let delivered = 0;
  for (const socket of set) if (send(socket, payload)) delivered += 1;
  return delivered;
}

/** Everyone but one device of the same account (used for DM echo). */
function sendToUserExcept(userId, sessionId, payload) {
  const set = userSockets(userId);
  if (!set) return 0;
  let delivered = 0;
  for (const socket of set) {
    if (socket.sessionId === sessionId) continue;
    if (send(socket, payload)) delivered += 1;
  }
  return delivered;
}

function broadcastToParty(partyId, payload) {
  const id = Number(partyId);
  let delivered = 0;
  for (const [socket, room] of partyOfSocket) {
    if (room === id && send(socket, payload)) delivered += 1;
  }
  return delivered;
}

function broadcastToChannel(channelId, payload) {
  const set = socketsByChannel.get(Number(channelId));
  if (!set) return 0;
  let delivered = 0;
  for (const socket of set) if (send(socket, payload)) delivered += 1;
  return delivered;
}

function subscribe(userId, sessionId, channelId) {
  const set = userSockets(userId);
  if (!set) return false;
  for (const socket of set) {
    if (sessionId && socket.sessionId !== Number(sessionId)) continue;
    let channels = socketsByChannel.get(Number(channelId));
    if (!channels) {
      channels = new Set();
      socketsByChannel.set(Number(channelId), channels);
    }
    channels.add(socket);
    socket.channels.add(Number(channelId));
  }
  return true;
}

function notifyFriends(userId, payload) {
  const db = require('./db').db;
  db().query(`SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'`, [Number(userId)])
    .then((rows) => {
      for (const row of rows) sendToUser(Number(row.friend_id), payload);
    })
    .catch((err) => logger.warn('ws: friend notify failed', { message: err.message }));
}

function isMuted(partyId, userId) {
  return muted.has(`${Number(partyId)}:${Number(userId)}`);
}

function setMuted(partyId, userId, value) {
  const key = `${Number(partyId)}:${Number(userId)}`;
  if (value) muted.set(key, Date.now());
  else muted.delete(key);
  return value;
}

function presenceSnapshot() {
  const out = [];
  for (const [userId, set] of socketsByUser) out.push({ userId: Number(userId), devices: set.size });
  return out;
}

function stats() {
  return {
    connections,
    users: socketsByUser.size,
    channels: socketsByChannel.size,
    inParties: partyOfSocket.size,
    speaking: speaking.size,
    muted: muted.size,
  };
}

/** Drop every connection (purge endpoint / shutdown). */
function closeAll(code = 1001, reason = 'server restart') {
  for (const socket of wss ? wss.clients : []) {
    try { socket.close(code, reason); } catch { /* already gone */ }
  }
  return connections;
}

function detach(socket) {
  connections = Math.max(0, connections - 1);
  if (socket.userId) {
    const set = socketsByUser.get(socket.userId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) {
        socketsByUser.delete(socket.userId);
        const users = require('./services/users');
        users.setPresence(socket.userId, 'offline').catch(() => {});
        notifyFriends(socket.userId, { type: 'presence.offline', userId: socket.userId });
      }
    }
  }
  for (const channelId of socket.channels) {
    const set = socketsByChannel.get(channelId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) socketsByChannel.delete(channelId);
    }
  }
  const room = partyOfSocket.get(socket);
  if (room !== undefined) {
    // Unmap first: the socket that is leaving must not receive its own event.
    partyOfSocket.delete(socket);
    if (socket.userId) broadcastToParty(room, { type: 'voice.left', partyId: room, userId: socket.userId });
  }
  speaking.delete(socket);
  if (socket.ip) ipCounts.set(socket.ip, Math.max(0, (ipCounts.get(socket.ip) || 1) - 1));
}

async function authenticate(socket, frame) {
  const auth = require('./security/auth');
  const token = frame && typeof frame.token === 'string' ? frame.token : '';
  const payload = auth.verifyAccessToken(token);
  if (!payload) throw Object.assign(new Error('bad token'), { code: AUTH_TIMEOUT_CODE });
  if (!await auth.sessionActive(payload.sid)) throw Object.assign(new Error('dead session'), { code: AUTH_TIMEOUT_CODE });
  const users = require('./services/users');
  const user = await users.findById(payload.sub);
  if (user.status === 'banned') throw Object.assign(new Error('banned'), { code: BAN_CODE });
  socket.userId = Number(user.id);
  socket.sessionId = Number(payload.sid);
  socket.username = user.username;
  socket.authenticated = true;

  let set = socketsByUser.get(socket.userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(socket.userId, set);
  }
  set.add(socket);

  await users.setPresence(socket.userId, 'online');
  send(socket, {
    type: 'welcome',
    userId: socket.userId,
    username: user.username,
    serverTime: Date.now(),
    e2ee: { required: config.e2ee.required, keySize: config.e2ee.keySize },
    limits: { messageBytes: config.limits.wsMaxMessageBytes, messagesPerSecond: config.limits.wsMessagesPerSecond },
  });
  notifyFriends(socket.userId, { type: 'presence.online', userId: socket.userId, username: user.username });
}

function makeBucket() {
  return { tokens: config.limits.wsMessagesPerSecond, ts: Date.now() };
}

function takeMessage(bucket) {
  const now = Date.now();
  const elapsed = (now - bucket.ts) / 1000;
  bucket.ts = now;
  bucket.tokens = Math.min(config.limits.wsMessagesPerSecond, bucket.tokens + elapsed * config.limits.wsMessagesPerSecond);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

async function handleMessage(socket, raw) {
  if (!takeMessage(socket.bucket)) {
    socket.violations += 1;
    if (socket.violations > 20) {
      rateLimit.penalize(`ip:${socket.ip}`, config.limits);
      socket.close(RATE_CODE, 'too many messages');
      return;
    }
    send(socket, { type: 'error', code: 'rate_limited', message: 'Slow down' });
    return;
  }

  let frame;
  try {
    frame = JSON.parse(raw.toString('utf8'));
  } catch {
    socket.close(PROTOCOL_CODE, 'invalid frame');
    return;
  }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    socket.close(PROTOCOL_CODE, 'invalid frame');
    return;
  }
  if (!ALLOWED_TYPES.has(frame.type)) {
    send(socket, { type: 'error', code: 'unknown_type', message: 'That message type is not accepted' });
    return;
  }

  const db = require('./db').db;
  const parties = require('./services/parties');

  switch (frame.type) {
    case 'ping':
      send(socket, { type: 'pong', t: Date.now(), echo: typeof frame.t === 'number' ? frame.t : null });
      break;

    case 'presence': {
      const status = frame.status === 'away' || frame.status === 'dnd' ? frame.status : 'online';
      await require('./services/users').setPresence(socket.userId, status);
      notifyFriends(socket.userId, { type: 'presence.update', userId: socket.userId, status });
      break;
    }

    case 'speaking': {
      const room = partyOfSocket.get(socket);
      if (room === undefined) return;
      const active = frame.active === true;
      if (active) speaking.set(socket, Date.now() + 3000);
      else speaking.delete(socket);
      broadcastToParty(room, { type: 'voice.speaking', partyId: room, userId: socket.userId, active });
      break;
    }

    case 'typing': {
      const channelId = Number(frame.channelId);
      if (!Number.isInteger(channelId) || channelId <= 0) return;
      broadcastToChannel(channelId, { type: 'typing', channelId, userId: socket.userId, active: frame.active !== false });
      break;
    }

    case 'party.event': {
      const partyId = Number(frame.partyId);
      if (!Number.isInteger(partyId) || partyId <= 0) return;
      if (!await parties.isMember(partyId, socket.userId)) return;
      const kind = String(frame.kind || '').slice(0, 32);
      if (!['mic_on', 'mic_off', 'camera_on', 'camera_off', 'hand', 'screen_on', 'screen_off'].includes(kind)) return;
      await parties.addEvent(partyId, socket.userId, kind, {});
      broadcastToParty(partyId, { type: 'party.event', partyId, userId: socket.userId, kind });
      break;
    }

    case 'call.signal': {
      // Ring / accept / decline / end relayed to the other side. The party row
      // is the authorization: both ends must be members of the call.
      const callId = Number(frame.callId);
      const to = Number(frame.to);
      if (!Number.isInteger(callId) || !Number.isInteger(to) || to <= 0) return;
      const party = await db().get(`SELECT * FROM parties WHERE id = ? AND kind = 'call'`, [callId]);
      if (!party) return;
      if (!await parties.isMember(callId, socket.userId)) return;
      const action = String(frame.action || '').slice(0, 16);
      if (!['ringing', 'accepted', 'declined', 'ended', 'busy'].includes(action)) return;
      sendToUser(to, { type: 'call.signal', callId, action, from: socket.userId });
      break;
    }

    case 'message': {
      // Relay of a sealed frame. The server forwards it to the channel it was
      // sealed for and cannot read it. Size is capped by the ws frame limit.
      const channelId = Number(frame.channelId);
      if (!Number.isInteger(channelId) || channelId <= 0) return;
      if (typeof frame.ciphertext !== 'string' || typeof frame.iv !== 'string') return;
      if (frame.ciphertext.length > 12000) return;
      const channel = await db().get(`SELECT * FROM channels WHERE id = ?`, [channelId]);
      if (!channel) return;
      if (channel.kind === 'dm') {
        const [a, b] = String(channel.member_key).slice(3).split(':').map(Number);
        if (socket.userId !== a && socket.userId !== b) return;
        const peer = socket.userId === a ? b : a;
        sendToUser(peer, { type: 'message', scope: 'dm', channelId, peerId: socket.userId, ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag || '', meta: frame.meta || {} });
        sendToUserExcept(socket.userId, socket.sessionId, { type: 'message', scope: 'dm', channelId, peerId: peer, ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag || '', meta: frame.meta || {} });
      } else {
        if (!socket.channels.has(channelId)) return;
        broadcastToChannel(channelId, { type: 'message', scope: channel.kind, channelId, from: socket.userId, ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag || '', meta: frame.meta || {} });
      }
      break;
    }

    default:
      break;
  }
}

function attach(httpServer) {
  wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.limits.wsMaxMessageBytes,
    perMessageDeflate: false, // compression bombs are not worth the CPU here
    clientTracking: true,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || 'unknown';
    const url = new URL(req.url || '/', 'http://localhost');
    // Same probe filter as the HTTP guard: the upgrade path bypasses it.
    const { WAF_PATTERNS } = require('./security/guard');
    if (url.pathname !== '/ws' || WAF_PATTERNS.some((pattern) => pattern.test(`${url.pathname}?${url.search}`))) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (connections >= MAX_TOTAL_CONNECTIONS) {
      socket.write(`HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const perIp = ipCounts.get(ip) || 0;
    if (perIp >= config.limits.wsMaxConnectionsPerIp) {
      socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    if (rateLimit.isBanned(`ip:${ip}`)) {
      socket.write(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.some((entry) => entry === '*' || origin === entry || origin.startsWith(`${entry}:`))) {
      socket.write(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    ipCounts.set(ip, perIp + 1);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.ip = ip.slice(0, 64);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    connections += 1;
    ws.authenticated = false;
    ws.channels = new Set();
    ws.bucket = makeBucket();
    ws.violations = 0;
    ws.alive = true;

    const authTimer = setTimeout(() => {
      if (!ws.authenticated) {
        try { ws.close(AUTH_TIMEOUT_CODE, 'authentication required'); } catch { /* closed already */ }
      }
    }, config.limits.wsAuthTimeoutMs);
    authTimer.unref();

    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (data, isBinary) => {
      if (!ws.authenticated) {
        // The first frame must be the auth frame; anything else is a probe.
        let frame = null;
        try { frame = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)); } catch { frame = null; }
        if (!frame || frame.type !== 'auth' || typeof frame.token !== 'string') {
          ws.violations += 1;
          if (ws.violations > 3) {
            rateLimit.penalize(`ip:${ws.ip}`, config.limits);
            try { ws.close(PROTOCOL_CODE, 'auth required'); } catch { /* noop */ }
            return;
          }
          send(ws, { type: 'error', code: 'auth_required', message: 'Send an auth frame first' });
          return;
        }
        clearTimeout(authTimer);
        authenticate(ws, frame).catch((err) => {
          logger.warn('ws: auth failed', { ip: ws.ip, message: err.message });
          if (err.code === BAN_CODE) {
            try { ws.close(BAN_CODE, 'account suspended'); } catch { /* noop */ }
            return;
          }
          try { ws.close(AUTH_TIMEOUT_CODE, 'authentication failed'); } catch { /* noop */ }
        });
        return;
      }
      if (isBinary) {
        ws.violations += 1;
        if (ws.violations > 10) try { ws.close(PROTOCOL_CODE, 'binary frames are not accepted'); } catch { /* noop */ }
        return;
      }
      handleMessage(ws, data).catch((err) => {
        logger.error('ws: handler failed', { user: ws.userId, message: err.message });
        send(ws, { type: 'error', code: 'server_error', message: 'That could not be processed' });
      });
    });

    ws.on('error', (err) => {
      logger.warn('ws: socket error', { message: err.message, user: ws.userId });
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      detach(ws);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        try { ws.terminate(); } catch { /* noop */ }
        continue;
      }
      ws.alive = false;
      try { ws.ping(); } catch { /* noop */ }
    }
  }, config.limits.wsPingIntervalMs);
  heartbeat.unref();

  // Speaking flags expire so a client that dies mid-word stops showing as live.
  const speakingSweep = setInterval(() => {
    const now = Date.now();
    for (const [socket, expiry] of speaking) {
      if (expiry <= now) {
        speaking.delete(socket);
        const room = partyOfSocket.get(socket);
        if (room !== undefined) broadcastToParty(room, { type: 'voice.speaking', partyId: room, userId: socket.userId, active: false });
      }
    }
  }, 1500);
  speakingSweep.unref();

  // Presence is written back on a timer instead of on every frame.
  const presenceFlush = setInterval(() => {
    const users = require('./services/users');
    for (const userId of socketsByUser.keys()) users.touch(userId).catch(() => {});
  }, PRESENCE_FLUSH_MS);
  presenceFlush.unref();

  return wss;
}

/** Join a socket to a party room for voice/party events. */
function joinParty(userId, partyId) {
  const set = userSockets(userId);
  if (!set) return false;
  const left = new Set();
  for (const socket of set) {
    const previous = partyOfSocket.get(socket);
    if (previous !== undefined && previous !== Number(partyId)) {
      partyOfSocket.delete(socket);
      left.add(previous);
    }
    partyOfSocket.set(socket, Number(partyId));
  }
  for (const room of left) broadcastToParty(room, { type: 'voice.left', partyId: room, userId });
  broadcastToParty(Number(partyId), { type: 'voice.joined', partyId: Number(partyId), userId });
  return true;
}

function leaveParty(userId) {
  const set = userSockets(userId);
  if (!set) return false;
  const rooms = new Set();
  for (const socket of set) {
    const previous = partyOfSocket.get(socket);
    if (previous !== undefined) {
      partyOfSocket.delete(socket);
      rooms.add(previous);
    }
  }
  for (const room of rooms) broadcastToParty(room, { type: 'voice.left', partyId: room, userId });
  return true;
}

module.exports = {
  attach, send, sendToUser, sendToUserExcept, broadcastToParty, broadcastToChannel,
  subscribe, notifyFriends, isOnline, isMuted, setMuted, joinParty, leaveParty,
  stats, presenceSnapshot, closeAll,
  AUTH_TIMEOUT_CODE, RATE_CODE, BAN_CODE, SHED_CODE, PROTOCOL_CODE,
};
