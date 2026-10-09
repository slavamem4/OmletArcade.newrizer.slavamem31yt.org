// Email ownership check.
//
// Firebase proves who the account is; this proves the address behind it is
// real. The flow is two calls - ask for a code, send it back - and the result
// is a signed proof the app replays on every privileged request.

import { Router } from 'express';
import { asyncRoute, forbidden, parseBody } from '../lib/http.js';
import { sendVerificationCode } from '../lib/emailjs.js';
import { emailCodeSchema, emailConfirmSchema } from '../lib/schemas.js';
import {
  codeMinutes,
  issueChallenge,
  issueProof,
  newCode,
  proofSeconds,
  redeemChallenge,
} from '../lib/verification.js';

export const emailRouter = Router();

// Small in-process guard: a handful of mails per account per hour. The free
// EmailJS quota is the real limit, so this protects the quota, not the user.
const sent = new Map();
const SEND_WINDOW_MS = 60 * 60_000;
const SEND_MAX = 5;

const tooMany = (uid) => {
  const now = Date.now();
  const history = (sent.get(uid) ?? []).filter((at) => now - at < SEND_WINDOW_MS);
  if (history.length >= SEND_MAX) {
    sent.set(uid, history);
    return true;
  }
  history.push(now);
  sent.set(uid, history);
  if (sent.size > 5000) {
    for (const [key, value] of sent) {
      if (value.every((at) => now - at >= SEND_WINDOW_MS)) sent.delete(key);
    }
  }
  return false;
};

emailRouter.post(
  '/code',
  asyncRoute(async (req, res) => {
    const body = parseBody(emailCodeSchema, req.body);
    const email = body.email.trim().toLowerCase();

    if (tooMany(req.user.uid)) {
      throw forbidden('Too many codes requested, try again later');
    }

    const code = newCode();
    await sendVerificationCode({ to: email, code, minutes: codeMinutes });

    res.json({
      challenge: issueChallenge(req.user.uid, email, code),
      expiresInSeconds: codeMinutes * 60,
    });
  }),
);

emailRouter.post(
  '/confirm',
  asyncRoute(async (req, res) => {
    const body = parseBody(emailConfirmSchema, req.body);
    const identity = redeemChallenge(body.challenge, body.code, req.user.uid);

    res.json({
      proof: issueProof(identity.uid, identity.email),
      expiresInSeconds: proofSeconds,
    });
  }),
);
