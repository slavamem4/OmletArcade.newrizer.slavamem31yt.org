// Bearer authentication against Firebase Auth.
// The client never holds a LiveKit credential: it proves identity with a
// Firebase ID token and the server mints the short lived LiveKit grant.

import { adminAuth } from './firebase.js';
import { forbidden, unauthorized } from './http.js';
import { config } from '../config.js';
import { timingSafeEqual } from 'node:crypto';

const BEARER = /^Bearer\s+([A-Za-z0-9._-]+)$/;

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

    // checkRevoked: a banned or signed-out account loses access immediately.
    const decoded = await adminAuth.verifyIdToken(match[1], true);
    if (decoded.disabled === true || decoded.banned === true) {
      throw forbidden('Account suspended');
    }
    req.user = Object.freeze({
      uid: decoded.uid,
      name: typeof decoded.name === 'string' ? decoded.name.slice(0, 48) : null,
      emailVerified: decoded.email_verified === true,
      provider: decoded.firebase?.sign_in_provider ?? 'unknown',
    });
    return next();
  } catch (error) {
    if (error && error.status) return next(error);
    return next(unauthorized('Invalid or expired credential'));
  }
};
