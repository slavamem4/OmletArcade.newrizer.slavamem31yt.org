#!/usr/bin/env node
// Converts a service-account JSON file into the one-line value for
// FIREBASE_SERVICE_ACCOUNT_B64, validating it before printing.
//
//   node scripts/encode-service-account.mjs ~/Downloads/key.json
//
// Nothing is logged except the final string; pipe it straight into the
// Render dashboard and delete the JSON file afterwards.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/encode-service-account.mjs <service-account.json>');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`Cannot read JSON from ${path}: ${error.message}`);
  process.exit(1);
}

const missing = ['type', 'project_id', 'client_email', 'private_key'].filter(
  (key) => typeof parsed[key] !== 'string' || parsed[key].length === 0,
);
if (missing.length > 0) {
  console.error(`That file is not a service-account key, missing: ${missing.join(', ')}`);
  process.exit(1);
}
if (parsed.type !== 'service_account') {
  console.error(`Expected "type": "service_account", found "${parsed.type}"`);
  process.exit(1);
}

const encoded = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');

// Round-trip check so a broken value can never reach Render.
const roundTrip = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
if (roundTrip.private_key !== parsed.private_key) {
  console.error('Round-trip check failed, refusing to print a broken value');
  process.exit(1);
}

console.error(`project: ${parsed.project_id}`);
console.error(`client : ${parsed.client_email}`);
console.error(`length : ${encoded.length} characters, starts with ${encoded.slice(0, 12)}`);
console.error('--- copy the single line below into FIREBASE_SERVICE_ACCOUNT_B64 ---');
console.log(encoded);
