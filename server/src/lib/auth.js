// Bearer authentication.
// The client proves identity with a Firebase ID token; the server verifies it
// against Google's public keys and mints the short lived LiveKit grant.

import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { forbidden, unauthorized } from './http.js';
import { verifyIdToken } from './identity.js';
import { readAs } from './rtdb.js';

const BEARER = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/;

const constantTimeEquals = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

// Optional second gate so a leaked ID token alone cannot drive the public API
// from an unknown client build.
export const appGate = (req, _res, next) => {
  const expected = config.security.appCheckSecret;
  if (!expected) return next();
  const provided = req.get('x-app-check');
  if (!provided || !constantTimeEquals(provided, expected)) {
    return next(forbidden('Client attestation failed'));
  }
  return next();
};

export const requireUser = async (req, _res, next) => {
  try {
    const header = req.get('authorization') || '';
    const match = BEARER.exec(header);
    if (!match) throw unauthorized('Missing bearer token');

    const token = match[1];
    const identity = await verifyIdToken(token);

    // Replaces the Admin SDK revocation check: a moderator writes
    // users/{uid}/disabled = true and the account loses access on the next call.
    const disabled = await readAs(`users/${identity.uid}/disabled`, token);
    if (disabled === true) throw forbidden('Account suspended');

    req.user = Object.freeze({ ...identity, idToken: token });
    return next();
  } catch (error) {
    if (error && error.status) return next(error);
    return next(unauthorized('Invalid or expired credential'));
  }
};
