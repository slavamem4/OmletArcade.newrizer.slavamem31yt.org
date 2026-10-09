// Every request body is validated here. `.strict()` rejects unknown keys.

import { z } from 'zod';

const roomId = z.string().regex(/^(stream|voice|mc)_[a-z0-9]{20}$/, 'malformed room id');

export const roomTokenSchema = z
  .object({
    roomId,
    publish: z.boolean(),
  })
  .strict();

export const roomIdSchema = z
  .object({
    roomId,
  })
  .strict();

export const emailCodeSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(5)
      .max(254)
      // Deliberately strict: one @, a dotted domain, no spaces or quoting.
      .regex(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'malformed email'),
  })
  .strict();

export const emailConfirmSchema = z
  .object({
    challenge: z.string().min(16).max(2048),
    code: z.string().regex(/^[0-9]{6}$/, 'the code is six digits'),
  })
  .strict();
