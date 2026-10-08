// Room lifecycle shared by streams, voice rooms and Minecraft sessions.

import { rtdb } from './firebase.js';
import { conflict, forbidden, notFound } from './http.js';
import { deleteRoom, ensureRoom } from './livekit.js';

export const MAX_ACTIVE_PER_USER = 3;

const collectionOf = (roomId) => {
  if (roomId.startsWith('stream_')) return 'streams';
  if (roomId.startsWith('voice_')) return 'voiceRooms';
  if (roomId.startsWith('mc_')) return 'mcSessions';
  throw notFound('Unknown room');
};

export const assertUnderQuota = async (collection, ownerField, uid) => {
  const snapshot = await rtdb
    .ref(collection)
    .orderByChild(ownerField)
    .equalTo(uid)
    .get();
  if (!snapshot.exists()) return;
  const active = Object.values(snapshot.val()).filter((item) => item.state === 'live').length;
  if (active >= MAX_ACTIVE_PER_USER) {
    throw conflict(`You already have ${MAX_ACTIVE_PER_USER} active sessions`);
  }
};

export const createRoom = async ({ roomId, collection, record, maxParticipants }) => {
  await ensureRoom(roomId, maxParticipants);
  const updates = {
    [`${collection}/${roomId}`]: record,
    [`roomMembers/${roomId}/${record.ownerUid ?? record.hostUid}`]: {
      role: 'owner',
      joinedAt: record.createdAt,
    },
    [`rooms/${roomId}`]: {
      collection,
      createdAt: record.createdAt,
      maxParticipants,
      e2ee: record.e2ee === true,
    },
  };
  await rtdb.ref().update(updates);
};

export const loadRoom = async (roomId) => {
  const collection = collectionOf(roomId);
  const snapshot = await rtdb.ref(`${collection}/${roomId}`).get();
  if (!snapshot.exists()) throw notFound('Room does not exist');
  const value = snapshot.val();
  return { collection, roomId, record: value, ownerUid: value.ownerUid ?? value.hostUid };
};

export const joinRoom = async (roomId, uid, role) => {
  const { record } = await loadRoom(roomId);
  if (record.state !== 'live') throw conflict('Session has ended');
  const membersSnapshot = await rtdb.ref(`roomMembers/${roomId}`).get();
  const memberCount = membersSnapshot.exists() ? Object.keys(membersSnapshot.val()).length : 0;
  const alreadyMember = membersSnapshot.exists() && membersSnapshot.val()[uid] !== undefined;
  if (!alreadyMember && memberCount >= (record.maxParticipants ?? 50)) {
    throw conflict('Session is full');
  }
  const bannedSnapshot = await rtdb.ref(`roomBans/${roomId}/${uid}`).get();
  if (bannedSnapshot.exists()) throw forbidden('You are banned from this session');

  if (!alreadyMember) {
    await rtdb.ref(`roomMembers/${roomId}/${uid}`).set({ role, joinedAt: Date.now() });
  }
  return { record, role: alreadyMember ? membersSnapshot.val()[uid].role : role };
};

export const endRoom = async (roomId, uid) => {
  const { collection, ownerUid } = await loadRoom(roomId);
  if (ownerUid !== uid) throw forbidden('Only the owner can end this session');
  await rtdb.ref().update({
    [`${collection}/${roomId}/state`]: 'ended',
    [`${collection}/${roomId}/endedAt`]: Date.now(),
    [`roomKeys/${roomId}`]: null,
    [`roomMembers/${roomId}`]: null,
  });
  await deleteRoom(roomId);
};
