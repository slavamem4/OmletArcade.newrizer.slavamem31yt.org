// UDP-over-WebSocket relay for Minecraft worlds hosted on a phone.
//
// The host's phone runs the world (Bedrock LAN server on 127.0.0.1:19132) and
// the app forwards its datagrams through this relay. A remote player's app
// does the mirror image: it exposes 127.0.0.1:19132 locally and tunnels the
// game client's datagrams here. This service only moves opaque datagrams
// between the two sockets; it never parses the game protocol.
//
// Framing: host-bound frames carry a 4 byte big-endian client id before the
// payload, so one host socket pair per remote player survives the merge.
// A zero-length payload for a client id means "that player left".

import { WebSocketServer } from 'ws';
import { verifyIdToken } from '../lib/identity.js';

const ROOM = /^(stream|voice|mc)_[a-z0-9]{20}$/;
const MAX_PAYLOAD = 4096; // Bedrock datagrams stay far below this
const MAX_CLIENTS = 16;
const PING_EVERY_MS = 25_000;

/** room id -> { host, clients: Map<number, WebSocket>, nextId, timers } */
const tunnels = new Map();

const alive = (ws) => ws !== null && ws.readyState === ws.OPEN;

export function attachTunnel(server, logger) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const match = /^\/v1\/tunnel\/(host|join)$/.exec(url.pathname);
    if (!match) {
      // Not a tunnel path: nothing else upgrades on this service.
      socket.destroy();
      return;
    }
    open(req, socket, head, match[1], url, wss, logger).catch(() => socket.destroy());
  });

  const ping = setInterval(() => {
    for (const tunnel of tunnels.values()) {
      for (const ws of [tunnel.host, ...tunnel.clients.values()]) {
        if (alive(ws)) ws.ping();
      }
    }
  }, PING_EVERY_MS);
  ping.unref?.();

  server.on('close', () => {
    clearInterval(ping);
    for (const tunnel of tunnels.values()) {
      tunnel.host?.close(1001);
      for (const ws of tunnel.clients.values()) ws.close(1001);
    }
    tunnels.clear();
  });
}

async function open(req, socket, head, role, url, wss, logger) {
  const room = url.searchParams.get('room') ?? '';
  const token = url.searchParams.get('token') ?? '';
  if (!ROOM.test(room)) {
    socket.destroy();
    return;
  }
  let uid;
  try {
    uid = (await verifyIdToken(token)).uid;
  } catch {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (role === 'host') attachHost(ws, room, uid, logger);
    else attachClient(ws, room, uid, logger);
  });
}

function attachHost(ws, room, uid, logger) {
  const existing = tunnels.get(room);
  if (existing && alive(existing.host)) {
    ws.close(4409, 'host already connected');
    return;
  }
  const tunnel = existing && existing.clients.size > 0 ? existing : { host: null, clients: new Map(), nextId: 1 };
  tunnel.host = ws;
  tunnels.set(room, tunnel);
  logger.info({ room, uid, clients: tunnel.clients.size }, 'tunnel host online');

  ws.on('message', (data, isBinary) => {
    if (!isBinary || data.length < 4 || data.length > MAX_PAYLOAD) return;
    const id = data.readUInt32BE(0);
    const client = tunnel.clients.get(id);
    if (alive(client)) client.send(data.subarray(4), { binary: true });
  });

  ws.on('close', () => {
    logger.info({ room, uid }, 'tunnel host offline');
    for (const client of tunnel.clients.values()) client.close(4410, 'host left');
    tunnel.clients.clear();
    if (tunnels.get(room) === tunnel) tunnels.delete(room);
  });
  ws.on('error', () => ws.close(4410));
}

function attachClient(ws, room, uid, logger) {
  const tunnel = tunnels.get(room);
  if (!tunnel || !alive(tunnel.host)) {
    ws.close(4404, 'world is offline');
    return;
  }
  if (tunnel.clients.size >= MAX_CLIENTS) {
    ws.close(4413, 'world is full');
    return;
  }
  const id = tunnel.nextId++;
  tunnel.clients.set(id, ws);
  logger.info({ room, uid, id, clients: tunnel.clients.size }, 'tunnel player joined');

  const header = Buffer.alloc(4);
  header.writeUInt32BE(id);

  ws.on('message', (data, isBinary) => {
    if (!isBinary || data.length === 0 || data.length > MAX_PAYLOAD - 4) return;
    if (alive(tunnel.host)) tunnel.host.send(Buffer.concat([header, data]), { binary: true });
  });

  ws.on('close', () => {
    tunnel.clients.delete(id);
    // Zero-length payload tells the host to drop this player's socket pair.
    if (alive(tunnel.host)) tunnel.host.send(Buffer.concat([header, Buffer.alloc(0)]), { binary: true });
    logger.info({ room, id, clients: tunnel.clients.size }, 'tunnel player left');
  });
  ws.on('error', () => ws.close(4413));
}
