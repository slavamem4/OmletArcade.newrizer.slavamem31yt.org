// Minecraft hosting sessions.
// The host device runs the world; this service is the discovery, invite and
// voice layer around it. Join codes are stored salted and hashed only.

import { Router } from 'express';
import { rtdb } from '../lib/firebase.js';
import { asyncRoute, forbidden, notFound, parseBody, parseQuery } from '../lib/http.js';
import { hashJoinCode, newId, newJoinCode, newSalt, safeEqualHex } from '../lib/ids.js';
import { assertUnderQuota, createRoom, endRoom, joinRoom } from '../lib/rooms.js';
import { listQuerySchema, mcJoinSchema, mcSessionSchema } from '../lib/schemas.js';

export const minecraftRouter = Router();

const publicSession = (id, value) => ({
  id,
  name: value.name,
  version: value.version,
  edition: value.edition,
  gameMode: value.gameMode,
  hostUid: value.hostUid,
  hostName: value.hostName,
  players: value.players ?? 1,
  maxPlayers: value.maxPlayers,
  private: value.private === true,
  startedAt: value.createdAt,
});

minecraftRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parseBody(mcSessionSchema, req.body);
    await assertUnderQuota('mcSessions', 'hostUid', req.user.uid);

    const roomId = newId('mc');
    const joinCode = newJoinCode();
    const salt = newSalt();
    const record = {
      name: body.name,
      version: body.version,
      edition: body.edition,
      gameMode: body.gameMode,
      maxPlayers: body.maxPlayers,
      private: body.private,
      hostUid: req.user.uid,
      hostName: req.user.name ?? 'host',
      state: 'live',
      players: 1,
      e2ee: true,
      maxParticipants: body.maxPlayers,
      joinCodeSalt: salt,
      joinCodeHash: hashJoinCode(joinCode, salt),
      createdAt: Date.now(),
    };
    await createRoom({
      roomId,
      collection: 'mcSessions',
      record,
      maxParticipants: body.maxPlayers,
    });
    // The plaintext code is returned once, to the host only.
    res.status(201).json({ id: roomId, joinCode, session: publicSession(roomId, record) });
  }),
);

minecraftRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { limit } = parseQuery(listQuerySchema, req.query);
    const snapshot = await rtdb
      .ref('mcSessions')
      .orderByChild('createdAt')
      .limitToLast(limit)
      .get();
    const items = snapshot.exists()
      ? Object.entries(snapshot.val())
          .filter(([, value]) => value.state === 'live' && value.private !== true)
          .map(([id, value]) => publicSession(id, value))
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];
    res.json({ items });
  }),
);

minecraftRouter.post(
  '/join',
  asyncRoute(async (req, res) => {
    const body = parseBody(mcJoinSchema, req.body);
    const snapshot = await rtdb.ref('mcSessions').orderByChild('state').equalTo('live').get();
    if (!snapshot.exists()) throw notFound('No session matches that code');

    let matchId = null;
    let matchValue = null;
    for (const [id, value] of Object.entries(snapshot.val())) {
      const candidate = hashJoinCode(body.joinCode, value.joinCodeSalt ?? '');
      if (safeEqualHex(candidate, value.joinCodeHash ?? '')) {
        matchId = id;
        matchValue = value;
        break;
      }
    }
    if (!matchId) throw notFound('No session matches that code');

    const { role } = await joinRoom(matchId, req.user.uid, 'player');
    await rtdb.ref(`mcSessions/${matchId}/players`).transaction((current) =>
      Math.min((current ?? 1) + 1, matchValue.maxPlayers),
    );
    res.json({ id: matchId, role, session: publicSession(matchId, matchValue) });
  }),
);

// Publicly listed worlds can be joined without a code; private ones cannot.
minecraftRouter.post(
  '/:id/join',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^mc_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown session');
    const snapshot = await rtdb.ref(`mcSessions/${id}`).get();
    if (!snapshot.exists()) throw notFound('Unknown session');
    const value = snapshot.val();
    if (value.private === true) throw forbidden('This world needs an invite code');

    const { role } = await joinRoom(id, req.user.uid, 'player');
    await rtdb
      .ref(`mcSessions/${id}/players`)
      .transaction((current) => Math.min((current ?? 1) + 1, value.maxPlayers));
    res.json({ id, role, session: publicSession(id, value) });
  }),
);

minecraftRouter.post(
  '/:id/kick',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^mc_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown session');
    const target = String(req.body?.uid ?? '');
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(target)) throw notFound('Unknown player');

    const hostSnapshot = await rtdb.ref(`mcSessions/${id}/hostUid`).get();
    if (!hostSnapshot.exists()) throw notFound('Unknown session');
    if (hostSnapshot.val() !== req.user.uid) throw forbidden('Only the host can kick');
    if (target === req.user.uid) throw forbidden('The host cannot kick themselves');

    await rtdb.ref().update({
      [`roomMembers/${id}/${target}`]: null,
      [`roomKeys/${id}/${target}`]: null,
      [`roomBans/${id}/${target}`]: { at: Date.now(), by: req.user.uid },
    });
    // Remaining members must rotate the room key; the host does that client side.
    res.json({ id, kicked: target, rotateKey: true });
  }),
);

minecraftRouter.post(
  '/:id/end',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^mc_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown session');
    await endRoom(id, req.user.uid);
    res.json({ id, state: 'ended' });
  }),
);
