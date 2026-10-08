// End-to-end encryption key distribution.
// The server stores and relays opaque ciphertext only. It never holds a room
// key in plaintext and therefore cannot decrypt audio, video or chat.

import { Router } from 'express';
import { rtdb } from '../lib/firebase.js';
import { asyncRoute, forbidden, notFound, parseBody } from '../lib/http.js';
import { keyShareSchema } from '../lib/schemas.js';

export const keysRouter = Router();

const roomOwnerPath = (roomId) => {
  if (roomId.startsWith('stream_')) return `streams/${roomId}/ownerUid`;
  if (roomId.startsWith('voice_')) return `voiceRooms/${roomId}/ownerUid`;
  return `mcSessions/${roomId}/hostUid`;
};

const assertMember = async (roomId, uid) => {
  const snapshot = await rtdb.ref(`roomMembers/${roomId}/${uid}`).get();
  if (!snapshot.exists()) throw forbidden('You are not a member of this room');
};

// Host uploads one wrapped copy of the room key per member.
keysRouter.post(
  '/share',
  asyncRoute(async (req, res) => {
    const body = parseBody(keyShareSchema, req.body);
    const ownerSnapshot = await rtdb.ref(roomOwnerPath(body.roomId)).get();
    if (!ownerSnapshot.exists()) throw notFound('Room does not exist');
    if (ownerSnapshot.val() !== req.user.uid) {
      throw forbidden('Only the room owner distributes keys');
    }

    const now = Date.now();
    const updates = {};
    for (const recipient of body.recipients) {
      updates[`roomKeys/${body.roomId}/${recipient.uid}`] = {
        keyId: body.keyId,
        wrappedKey: recipient.wrappedKey,
        senderUid: req.user.uid,
        createdAt: now,
      };
    }
    updates[`rooms/${body.roomId}/keyId`] = body.keyId;
    await rtdb.ref().update(updates);
    res.json({ roomId: body.roomId, keyId: body.keyId, delivered: body.recipients.length });
  }),
);

// A member fetches only the blob addressed to them.
keysRouter.get(
  '/:roomId',
  asyncRoute(async (req, res) => {
    const roomId = String(req.params.roomId);
    if (!/^(stream|voice|mc)_[a-z0-9]{20}$/.test(roomId)) throw notFound('Unknown room');
    await assertMember(roomId, req.user.uid);
    const snapshot = await rtdb.ref(`roomKeys/${roomId}/${req.user.uid}`).get();
    if (!snapshot.exists()) throw notFound('No key material for you yet');
    res.json({ roomId, envelope: snapshot.val() });
  }),
);
