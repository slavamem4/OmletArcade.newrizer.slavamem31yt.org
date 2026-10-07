'use strict';
/**
 * /api/security — the anti-DDoS handshake and the public bootstrap payload.
 *
 * `/bootstrap` is the one endpoint that tells a client how to reach things.
 * It returns the LiveKit URL, which is a public endpoint, and nothing else:
 * no API key, no secret, no signing material. `tools/audit-secrets.js` fails
 * the build if a secret ever appears in a served asset or a response.
 */
const express = require('express');
const { config } = require('../config');
const pow = require('../security/pow');
const validate = require('../lib/validate');
const errors = require('../errors');
const rateLimit = require('../security/rate-limit');
const auth = require('../middleware/auth');
const users = require('../services/users');
const keys = require('../routes/keys');

const router = express.Router();

router.get('/bootstrap', (req, res) => {
  res.json({
    app: { name: 'Omlet Arcade', version: '1.0.0', environment: config.env },
    api: { url: config.publicUrl, ws: '/ws' },
    voice: {
      url: config.livekit.url,
      // The SDK needs a room and a token; both come from /api/*/voice. The API
      // key is not public information and is never sent here.
      tokenEndpoint: 'POST /api/parties/:id/voice',
      e2ee: { required: config.e2ee.required, keySize: config.e2ee.keySize },
    },
    limits: {
      messageBytes: config.limits.wsMaxMessageBytes,
      bodyKb: config.limits.bodyJsonKb,
      messagesPerSecond: config.limits.wsMessagesPerSecond,
    },
    security: { powRequired: pow.required(req.clientIp) },
  });
});

router.get('/challenge', (req, res) => {
  res.json(pow.issueChallenge(req.clientIp));
});

router.post('/challenge', (req, res) => {
  const body = validate.parse(req.body, {
    challenge: ['blob', { maxBytes: 64, message: 'That challenge is not valid' }],
    nonce: ['text', { max: 128, message: 'That nonce is not valid' }],
    elapsedMs: ['int', { optional: true, min: 0, max: 600000 }],
  });
  const result = pow.solve(req.clientIp, body);
  pow.redeem(req.clientIp);
  res.json({ ...result, unblocked: !rateLimit.isBanned(`ip:${req.clientIp}`) });
});

router.get('/status', (req, res) => {
  res.json({
    banned: rateLimit.isBanned(`ip:${req.clientIp}`),
    powRequired: pow.required(req.clientIp),
    strikes: rateLimit.strikesFor(`ip:${req.clientIp}`),
    serverTime: Date.now(),
  });
});

router.get('/fingerprint', auth.required(), errors.wrap(async (req, res) => {
  const row = await require('../db').db().get(`SELECT identity_pub FROM users WHERE id = ?`, [req.user.id]);
  res.json({ fingerprint: keys.fingerprintOf(row && row.identity_pub), hasIdentityKey: !!(row && row.identity_pub) });
}));

router.get('/profile', auth.required(), errors.wrap(async (req, res) => {
  const fresh = await users.findById(req.user.id);
  res.json({ user: users.publicUser(fresh), settings: await users.getSettings(req.user.id) });
}));

module.exports = router;
