'use strict';
/**
 * Child process for the load-shedding test: boots a second app under a tiny
 * per-IP budget, hammers it, and exits non-zero unless the limiter answers 429
 * with a Retry-After. It runs in its own process because rate limit buckets
 * live in module scope and cannot be reset from outside.
 */
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'probe-secret-'.padEnd(48, 'x');
process.env.LOG_LEVEL = 'error';

const { start } = require(path.join(__dirname, '..', 'index'));

async function main() {
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  let limited = 0;
  let retryAfter = 0;
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${base}/api/system/health`);
    if (response.status === 429) {
      limited += 1;
      if (response.headers.get('retry-after')) retryAfter += 1;
    }
  }
  assert.ok(limited > 0, 'the limiter never answered 429');
  assert.equal(retryAfter, limited, 'every 429 must carry Retry-After');
  process.stdout.write(`RATE_LIMIT_OK limited=${limited} retryAfter=${retryAfter}\n`);
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(`RATE_LIMIT_FAIL ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
