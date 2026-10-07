'use strict';
/**
 * Secret scanner. Fails the build if a configured secret ever appears in a
 * served asset (web/, mobile/) or in this repo's sources as a literal.
 *
 * Usage: LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… JWT_SECRET=… node tools/audit-secrets.js
 * Exits 1 on any hit.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const secrets = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'JWT_SECRET']
  .map((name) => ({ name, value: (process.env[name] || '').trim() }))
  .filter((entry) => entry.value.length >= 8);

if (!secrets.length) {
  console.error('audit-secrets: no secrets in env, nothing to scan for');
  process.exit(0);
}

const SCAN_DIRS = ['web', 'mobile'];
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', '.gradle']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.size < 5 * 1024 * 1024) out.push(full);
  }
  return out;
}

let hits = 0;
for (const dirName of SCAN_DIRS) {
  const base = path.join(ROOT, dirName);
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base, [])) {
    const content = fs.readFileSync(file, 'utf8');
    for (const secret of secrets) {
      if (content.includes(secret.value)) {
        hits += 1;
        console.error(`audit-secrets: ${secret.name} found in ${path.relative(ROOT, file)}`);
      }
    }
  }
}

if (hits) {
  console.error(`audit-secrets: ${hits} leak(s)`);
  process.exit(1);
}
console.log('audit-secrets: clean');
