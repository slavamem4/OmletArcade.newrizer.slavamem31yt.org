// The only business endpoint: short lived LiveKit grants.
//
// This is where the LiveKit API secret lives and nowhere else. Membership is
// not trusted from the request body - it is read back from the database with
// the caller's own credential, so a user cannot talk their way into a room the
// rules would not let them see.

import { Router } from 'express';
import { asyncRoute, forbidden, notFound, parseBody } from '../lib/http.js';
import { deleteRoom, ensureRoom, mintAccessToken } from '../lib/livekit.js';
import { readAs } from '../lib/rtdb.js';
import { roomIdSchema, roomTokenSchema } from '../lib/schemas.js';

export const rtcRouter = Router();

const ROOM_ID = /^(stream|voice|mc)_[a-z0-9]{20}$/;

const loadRoomAs = async (roomId, user) => {
  const record = await readAs(`rooms/${roomId}`, user.idToken);
  if (record === null || typeof record !== 'object') {
    throw notFound('Session does not exist, or you are not part of it');
  }
  return record;
};

rtcRouter.post(
  '/token',
  asyncRoute(async (req, res) => {
    const body = parseBody(roomTokenSchema, req.body);
    const room = await loadRoomAs(body.roomId, req.user);

    if (room.state !== 'live') throw forbidden('Session has ended');

    const isOwner = room.ownerUid === req.user.uid;
    const membership = await readAs(
      `roomMembers/${body.roomId}/${req.user.uid}`,
      req.user.idToken,
    );
    if (!isOwner && (membership === null || typeof membership !== 'object')) {
      throw forbidden('Join the session before requesting a token');
    }

    const role = isOwner ? 'owner' : String(membership.role ?? 'viewer');
    // Viewers of a stream never publish; speakers, players and owners may.
    const canPublish = isOwner || (body.publish === true && role !== 'viewer');

    const maxParticipants = Number.isInteger(room.maxParticipants)
      ? Math.min(Math.max(room.maxParticipants, 2), 100)
      : 50;

    // The owner's first token call materialises the room with its capacity,
    // which is what actually caps the session size.
    if (isOwner) {
      await ensureRoom(body.roomId, maxParticipants);
    }

    const grant = await mintAccessToken(
      { uid: req.user.uid, displayName: req.user.name },
      { room: body.roomId, canPublish, isOwner },
    );

    res.json({
      roomId: body.roomId,
      url: grant.url,
      token: grant.token,
      expiresInSeconds: grant.expiresInSeconds,
      canPublish,
      e2ee: room.e2ee === true,
    });
  }),
);

// Tears down the LiveKit room. Database cleanup is the client's write, guarded
// by the rules; this only releases the SFU side.
rtcRouter.post(
  '/close',
  asyncRoute(async (req, res) => {
    const body = parseBody(roomIdSchema, req.body);
    if (!ROOM_ID.test(body.roomId)) throw notFound('Unknown session');

    const room = await loadRoomAs(body.roomId, req.user);
    if (room.ownerUid !== req.user.uid) throw forbidden('Only the owner can close this session');

    await deleteRoom(body.roomId);
    res.json({ roomId: body.roomId, closed: true });
  }),
);
