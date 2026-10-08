// Firebase ID token verification without any service account.
//
// Firebase signs ID tokens with Google's rotating keys, published at a public
// JWKS endpoint. Verifying the signature, issuer, audience and expiry locally
// gives exactly the same identity guarantee the Admin SDK does - the admin
// credential only adds the optional revocation check, which this service
// replaces with a per-user "disabled" flag read from the database.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { unauthorized } from './http.js';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
  {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 5_000,
  },
);

const ISSUER = `https://securetoken.google.com/${config.firebase.projectId}`;

/**
 * @param {string} token raw JWT from the Authorization header
 * @returns {Promise<{uid: string, name: string|null, provider: string}>}
 */
export const verifyIdToken = async (token) => {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: config.firebase.projectId,
      algorithms: ['RS256'],
      clockTolerance: 10,
    }));
  } catch {
    throw unauthorized('Invalid or expired credential');
  }

  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
    throw unauthorized('Credential has no usable subject');
  }
  // auth_time in the future means a forged or clock-skewed token.
  if (typeof payload.auth_time === 'number' && payload.auth_time > Date.now() / 1000 + 60) {
    throw unauthorized('Credential has an invalid authentication time');
  }

  return {
    uid,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 48) : null,
    provider:
      typeof payload.firebase === 'object' && payload.firebase !== null
        ? String(payload.firebase.sign_in_provider ?? 'unknown')
        : 'unknown',
  };
};
