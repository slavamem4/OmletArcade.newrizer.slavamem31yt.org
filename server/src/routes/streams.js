// Live streams and voice rooms.

import { Router } from 'express';
import { rtdb } from '../lib/firebase.js';
import { asyncRoute, notFound, parseBody, parseQuery } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { assertUnderQuota, createRoom, endRoom, joinRoom } from '../lib/rooms.js';
import { listQuerySchema, streamCreateSchema, voiceRoomSchema } from '../lib/schemas.js';

export const streamsRouter = Router();
export const voiceRouter = Router();

const publicStream = (id, value) => ({
  id,
  title: value.title,
  game: value.game,
  ownerUid: value.ownerUid,
  ownerName: value.ownerName,
  viewers: value.viewers ?? 0,
  e2ee: value.e2ee === true,
  voiceEnabled: value.voiceEnabled === true,
  startedAt: value.createdAt,
});

streamsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parseBody(streamCreateSchema, req.body);
    await assertUnderQuota('streams', 'ownerUid', req.user.uid);

    const roomId = newId('stream');
    const record = {
      title: body.title,
      game: body.game,
      visibility: body.visibility,
      voiceEnabled: body.voiceEnabled,
      e2ee: body.e2ee,
      ownerUid: req.user.uid,
      ownerName: req.user.name ?? 'player',
      state: 'live',
      viewers: 0,
      maxParticipants: 50,
      createdAt: Date.now(),
    };
    await createRoom({ roomId, collection: 'streams', record, maxParticipants: 50 });
    res.status(201).json({ id: roomId, stream: publicStream(roomId, record) });
  }),
);

streamsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { limit } = parseQuery(listQuerySchema, req.query);
    const snapshot = await rtdb
      .ref('streams')
      .orderByChild('createdAt')
      .limitToLast(limit)
      .get();
    const items = snapshot.exists()
      ? Object.entries(snapshot.val())
          .filter(([, value]) => value.state === 'live' && value.visibility === 'public')
          .map(([id, value]) => publicStream(id, value))
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];
    res.json({ items });
  }),
);

streamsRouter.post(
  '/:id/join',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^stream_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown stream');
    const { record, role } = await joinRoom(id, req.user.uid, 'viewer');
    res.json({ id, role, stream: publicStream(id, record) });
  }),
);

streamsRouter.post(
  '/:id/end',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^stream_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown stream');
    await endRoom(id, req.user.uid);
    res.json({ id, state: 'ended' });
  }),
);

voiceRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parseBody(voiceRoomSchema, req.body);
    await assertUnderQuota('voiceRooms', 'ownerUid', req.user.uid);
    const roomId = newId('voice');
    const record = {
      title: body.title,
      ownerUid: req.user.uid,
      ownerName: req.user.name ?? 'player',
      state: 'live',
      e2ee: true,
      maxParticipants: body.maxParticipants,
      createdAt: Date.now(),
    };
    await createRoom({
      roomId,
      collection: 'voiceRooms',
      record,
      maxParticipants: body.maxParticipants,
    });
    res.status(201).json({ id: roomId, room: record });
  }),
);

voiceRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { limit } = parseQuery(listQuerySchema, req.query);
    const snapshot = await rtdb.ref('voiceRooms').orderByChild('createdAt').limitToLast(limit).get();
    const items = snapshot.exists()
      ? Object.entries(snapshot.val())
          .filter(([, value]) => value.state === 'live')
          .map(([id, value]) => ({
            id,
            title: value.title,
            ownerUid: value.ownerUid,
            ownerName: value.ownerName,
            maxParticipants: value.maxParticipants,
            startedAt: value.createdAt,
          }))
      : [];
    res.json({ items });
  }),
);

voiceRouter.post(
  '/:id/join',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^voice_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown room');
    const { role } = await joinRoom(id, req.user.uid, 'speaker');
    res.json({ id, role });
  }),
);

voiceRouter.post(
  '/:id/end',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (!/^voice_[a-z0-9]{20}$/.test(id)) throw notFound('Unknown room');
    await endRoom(id, req.user.uid);
    res.json({ id, state: 'ended' });
  }),
);
