// Stateless email verification.
//
// The service has no database credential, so nothing about a pending code is
// stored: the challenge itself carries the data, authenticated with HMAC. A
// challenge the server did not sign cannot be forged, and neither value is
// useful to anyone but the account it names.

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './http.js';

const CODE_TTL_MS = 10 * 60_000;
const PROOF_TTL_MS = 180 * 24 * 60 * 60_000;

const b64url = (value) => Buffer.from(value).toString('base64url');
const unb64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

const sign = (payload) =>
  createHmac('sha256', config.email.tokenSecret).update(payload).digest('base64url');

const equal = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

const pack = (claims) => {
  const payload = b64url(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
};

const unpack = (token, kind) => {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !equal(signature, sign(payload))) return null;

  let claims;
  try {
    claims = JSON.parse(unb64url(payload));
  } catch {
    return null;
  }
  if (claims.k !== kind) return null;
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
  return claims;
};

/** Six digits, uniformly drawn from a CSPRNG. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const codeMinutes = CODE_TTL_MS / 60_000;

/**
 * @returns {string} opaque challenge handed back to the client
 */
export const issueChallenge = (uid, email, code) =>
  pack({
    k: 'challenge',
    uid,
    email: email.toLowerCase(),
    // Only the hash travels, so a stolen challenge does not reveal the code.
    hash: createHmac('sha256', config.email.tokenSecret).update(`${uid}:${code}`).digest('base64url'),
    exp: Date.now() + CODE_TTL_MS,
  });

/**
 * @returns {{uid: string, email: string}} verified identity
 */
export const redeemChallenge = (challenge, code, uid) => {
  const claims = unpack(challenge, 'challenge');
  if (!claims) throw new HttpError(400, 'challenge_expired', 'Code has expired, request a new one');
  if (claims.uid !== uid) throw new HttpError(403, 'forbidden', 'Challenge belongs to another account');

  const expected = createHmac('sha256', config.email.tokenSecret)
    .update(`${uid}:${code}`)
    .digest('base64url');
  if (!equal(expected, claims.hash)) {
    throw new HttpError(400, 'bad_code', 'That code does not match');
  }
  return { uid: claims.uid, email: claims.email };
};

/** Long lived proof the client replays as X-Email-Verified. */
export const issueProof = (uid, email) =>
  pack({ k: 'proof', uid, email, exp: Date.now() + PROOF_TTL_MS });

export const proofSeconds = Math.floor(PROOF_TTL_MS / 1000);

/**
 * @returns {boolean} whether the proof belongs to this uid and is still valid
 */
export const proofMatches = (token, uid) => {
  const claims = unpack(token, 'proof');
  return claims !== null && claims.uid === uid;
};
