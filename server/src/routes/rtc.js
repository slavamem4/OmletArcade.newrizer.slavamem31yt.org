// Short lived LiveKit grants. This is the only place a LiveKit credential is
// produced, and the API secret never leaves the server process.

import { Router } from 'express';
import { rtdb } from '../lib/firebase.js';
import { asyncRoute, forbidden, parseBody } from '../lib/http.js';
import { mintAccessToken } from '../lib/livekit.js';
import { loadRoom } from '../lib/rooms.js';
import { roomTokenSchema } from '../lib/schemas.js';

export const rtcRouter = Router();

rtcRouter.post(
  '/token',
  asyncRoute(async (req, res) => {
    const body = parseBody(roomTokenSchema, req.body);
    const { record, ownerUid } = await loadRoom(body.roomId);
    if (record.state !== 'live') throw forbidden('Session has ended');

    const membership = await rtdb.ref(`roomMembers/${body.roomId}/${req.user.uid}`).get();
    if (!membership.exists()) throw forbidden('Join the session before requesting a token');

    const isOwner = ownerUid === req.user.uid;
    const role = membership.val().role;
    // Viewers of a stream never get publish rights; speakers and players do.
    const canPublish = isOwner || (body.publish === true && role !== 'viewer');

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
      e2ee: record.e2ee === true,
    });
  }),
);
