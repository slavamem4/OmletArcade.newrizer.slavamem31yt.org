// Identifier and join-code helpers. All randomness comes from the CSPRNG.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike glyphs

const fromAlphabet = (alphabet, length) => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
};

export const newId = (prefix) => `${prefix}_${fromAlphabet(ID_ALPHABET, 20)}`;

export const newJoinCode = () => fromAlphabet(CODE_ALPHABET, 6);

export const hashJoinCode = (code, saltHex) =>
  createHash('sha256').update(`${saltHex}:${code.toUpperCase()}`).digest('hex');

export const newSalt = () => randomBytes(16).toString('hex');

export const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};
