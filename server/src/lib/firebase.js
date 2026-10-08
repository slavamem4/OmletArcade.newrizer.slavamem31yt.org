// Firebase Admin bootstrap. The service account lives only in the Render
// environment; it is decoded in memory and never written to disk or logs.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { config } from '../config.js';

const decodeServiceAccount = () => {
  const raw = config.firebase.serviceAccountB64.trim();

  // Accept both forms: the base64 one-liner (recommended) and a pasted JSON
  // document. Render strips nothing, so a pasted JSON arrives intact and there
  // is no reason to reject it - but the error must say exactly what was wrong.
  let text;
  if (raw.startsWith('{')) {
    text = raw;
  } else {
    // Strip whitespace and newlines that survive a copy-paste, and accept the
    // URL-safe alphabet as well.
    const compact = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_B64 is neither JSON nor base64. ' +
          `It starts with "${raw.slice(0, 12)}" and is ${raw.length} characters long. ` +
          'Expected the whole service-account JSON file encoded with: base64 -w0 key.json',
      );
    }
    text = Buffer.from(compact, 'base64').toString('utf8');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_B64 decoded, but the result is not JSON. ' +
        `Decoded content starts with "${text.slice(0, 24).replace(/\s+/g, ' ')}". ` +
        'Most likely the variable holds the raw JSON encoded twice, a truncated ' +
        'copy, or only one field of the file. Re-run: base64 -w0 key.json',
    );
  }

  if (parsed.type !== 'service_account') {
    throw new Error('Service account JSON has no "type": "service_account" field');
  }
  for (const key of ['project_id', 'client_email', 'private_key']) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      throw new Error(`Service account JSON is missing "${key}"`);
    }
  }
  if (parsed.project_id !== config.firebase.projectId) {
    throw new Error(
      `Service account belongs to project "${parsed.project_id}" but ` +
        `FIREBASE_PROJECT_ID is "${config.firebase.projectId}"`,
    );
  }

  // Render stores the newlines escaped; restore them before use.
  const privateKey = parsed.private_key.replace(/\\n/g, '\n');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('Service account "private_key" is not a PEM block');
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey,
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
