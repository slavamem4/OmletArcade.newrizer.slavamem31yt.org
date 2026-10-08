// LiveKit grant minting. API key and secret stay in this process.

import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config.js';

const httpUrl = config.livekit.url.replace(/^wss:/i, 'https:');

export const roomService = new RoomServiceClient(
  httpUrl,
  config.livekit.apiKey,
  config.livekit.apiSecret,
);

/**
 * @param {{uid: string, displayName: string|null}} identity
 * @param {{room: string, canPublish: boolean, canPublishData?: boolean, isOwner?: boolean}} grant
 * @returns {Promise<{token: string, url: string, expiresInSeconds: number}>}
 */
export const mintAccessToken = async (identity, grant) => {
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: identity.uid,
    name: identity.displayName ?? undefined,
    ttl: config.livekit.tokenTtlSeconds,
  });

  token.addGrant({
    room: grant.room,
    roomJoin: true,
    roomCreate: false,
    roomAdmin: grant.isOwner === true,
    canPublish: grant.canPublish,
    canSubscribe: true,
    canPublishData: grant.canPublishData !== false,
    canUpdateOwnMetadata: false,
    // Media is end-to-end encrypted by the clients; SFU forwards opaque frames.
    hidden: false,
  });

  return {
    token: await token.toJwt(),
    url: config.livekit.url,
    expiresInSeconds: config.livekit.tokenTtlSeconds,
  };
};

export const ensureRoom = async (name, maxParticipants) => {
  await roomService.createRoom({
    name,
    emptyTimeout: 120,
    maxParticipants,
  });
};

export const deleteRoom = async (name) => {
  try {
    await roomService.deleteRoom(name);
  } catch {
    // Room may already be collected by LiveKit; deletion is idempotent for us.
  }
};
