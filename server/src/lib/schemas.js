// Every request body is validated here. `.strict()` rejects unknown keys so a
// client can never smuggle extra fields into a database write.

import { z } from 'zod';

const base64 = (max) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be standard base64');

export const displayName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}](?:[\p{L}\p{N} ._-]{0,22}[\p{L}\p{N}])?$/u, 'invalid display name');

export const profileSchema = z
  .object({
    displayName,
    avatarId: z.number().int().min(0).max(23),
    bio: z.string().trim().max(140).optional(),
  })
  .strict();

export const publicKeySchema = z
  .object({
    keyId: z.string().regex(/^[a-f0-9]{32}$/),
    publicKey: base64(512),
    algorithm: z.literal('HPKE_X25519_HKDF_SHA256_AES256GCM'),
  })
  .strict();

export const streamCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(60),
    game: z.string().trim().min(2).max(40),
    visibility: z.enum(['public', 'followers', 'private']),
    voiceEnabled: z.boolean(),
    e2ee: z.boolean(),
  })
  .strict();

export const roomTokenSchema = z
  .object({
    roomId: z.string().regex(/^(stream|voice|mc)_[a-z0-9]{20}$/),
    publish: z.boolean(),
  })
  .strict();

export const voiceRoomSchema = z
  .object({
    title: z.string().trim().min(3).max(60),
    maxParticipants: z.number().int().min(2).max(50),
  })
  .strict();

export const mcSessionSchema = z
  .object({
    name: z.string().trim().min(3).max(40),
    version: z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'use a version like 1.21.1'),
    edition: z.enum(['bedrock', 'java']),
    maxPlayers: z.number().int().min(2).max(30),
    gameMode: z.enum(['survival', 'creative', 'adventure']),
    private: z.boolean(),
  })
  .strict();

export const mcJoinSchema = z
  .object({
    joinCode: z.string().trim().length(6).regex(/^[A-Za-z0-9]{6}$/),
  })
  .strict();

export const keyShareSchema = z
  .object({
    roomId: z.string().regex(/^(stream|voice|mc)_[a-z0-9]{20}$/),
    keyId: z.string().regex(/^[a-f0-9]{32}$/),
    // One opaque blob per recipient. The server cannot open any of them.
    recipients: z
      .array(
        z
          .object({
            uid: z.string().min(6).max(128).regex(/^[A-Za-z0-9_-]+$/),
            wrappedKey: base64(2048),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
