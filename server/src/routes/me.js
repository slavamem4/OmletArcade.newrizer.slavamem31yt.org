// Profile and public-key directory.

import { Router } from 'express';
import { rtdb } from '../lib/firebase.js';
import { asyncRoute, notFound, parseBody } from '../lib/http.js';
import { profileSchema, publicKeySchema } from '../lib/schemas.js';

export const meRouter = Router();

meRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const snapshot = await rtdb.ref(`users/${req.user.uid}`).get();
    if (!snapshot.exists()) throw notFound('Profile not created yet');
    res.json({ uid: req.user.uid, profile: snapshot.val() });
  }),
);

meRouter.put(
  '/',
  asyncRoute(async (req, res) => {
    const body = parseBody(profileSchema, req.body);
    const now = Date.now();
    const ref = rtdb.ref(`users/${req.user.uid}`);
    const existing = await ref.get();
    const profile = {
      displayName: body.displayName,
      avatarId: body.avatarId,
      bio: body.bio ?? '',
      createdAt: existing.exists() ? existing.val().createdAt : now,
      updatedAt: now,
    };
    await ref.set(profile);
    res.json({ uid: req.user.uid, profile });
  }),
);

// Publishes the long-term HPKE public key used to wrap room keys.
meRouter.put(
  '/key',
  asyncRoute(async (req, res) => {
    const body = parseBody(publicKeySchema, req.body);
    const record = {
      keyId: body.keyId,
      publicKey: body.publicKey,
      algorithm: body.algorithm,
      updatedAt: Date.now(),
    };
    await rtdb.ref(`userKeys/${req.user.uid}`).set(record);
    res.json({ uid: req.user.uid, key: record });
  }),
);

meRouter.get(
  '/key/:uid',
  asyncRoute(async (req, res) => {
    const uid = String(req.params.uid);
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw notFound('Unknown user');
    const snapshot = await rtdb.ref(`userKeys/${uid}`).get();
    if (!snapshot.exists()) throw notFound('User has no published key');
    res.json({ uid, key: snapshot.val() });
  }),
);
