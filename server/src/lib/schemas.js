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
