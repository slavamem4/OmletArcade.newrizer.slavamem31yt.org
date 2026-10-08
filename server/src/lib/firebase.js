// Firebase Admin bootstrap. The service account lives only in the Render
// environment; it is decoded in memory and never written to disk or logs.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { config } from '../config.js';

const decodeServiceAccount = () => {
  let raw;
  try {
    raw = Buffer.from(config.firebase.serviceAccountB64, 'base64').toString('utf8');
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 is not valid base64');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 does not decode to JSON');
  }
  for (const key of ['project_id', 'client_email', 'private_key']) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      throw new Error(`Service account JSON is missing "${key}"`);
    }
  }
  if (parsed.project_id !== config.firebase.projectId) {
    throw new Error('Service account project_id does not match FIREBASE_PROJECT_ID');
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    // Render stores the newlines escaped; restore them before use.
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
};

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(decodeServiceAccount()),
      databaseURL: config.firebase.databaseUrl,
      projectId: config.firebase.projectId,
    });

export const adminAuth = getAuth(app);
export const rtdb = getDatabase(app);
