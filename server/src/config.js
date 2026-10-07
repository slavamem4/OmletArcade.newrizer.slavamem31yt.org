'use strict';
/**
 * Configuration and secrets.
 *
 * Rule enforced here and checked in tests: nothing in this module is ever
 * serialized into a response, a log line, or a static asset. The only value a
 * client may receive is a short-lived, room-scoped LiveKit access token.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..');

/**
 * Read a secret. Render can inject a secret as a file path or as a literal.
 * A path that exists wins; otherwise the raw value is used. Trailing newline
 * from a file is stripped because it breaks HMAC comparisons silently.
 */
function secret(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (raw.startsWith('/') && fs.existsSync(raw)) {
    return fs.readFileSync(raw, 'utf8').trim();
  }
  return raw.trim();
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`config: ${name} must be a number, got "${raw}"`);
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * A stable per-installation identity. Used only to namespace generated keys so
 * two deployments never share derived material. Not a secret, not a credential.
 */
function installationId() {
  const file = path.join(process.env.DATA_DIR || path.join(ROOT, 'var'), 'installation-id');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const id = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(file, id, { mode: 0o600 });
    return id;
  } catch {
    // Read-only filesystem (some PaaS layouts): derive from env instead.
    return crypto.createHash('sha256').update(String(process.env.RENDER_SERVICE_ID || 'local')).digest('hex').slice(0, 16);
  }
}

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const config = {
  env,
  isProd,
  projectRoot: PROJECT_ROOT,
  serverRoot: ROOT,

  port: num('PORT', 8080),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num('PORT', 8080)}`).replace(/\/+$/, ''),
  trustProxy: num('TRUST_PROXY_HOPS', 1),

  // --- secrets (never leave this process) ---
  jwtSecret: secret('JWT_SECRET'),
  livekit: {
    url: secret('LIVEKIT_URL'),
    apiKey: secret('LIVEKIT_API_KEY'),
    apiSecret: secret('LIVEKIT_API_SECRET'),
    tokenTtlSeconds: num('LIVEKIT_TOKEN_TTL_SECONDS', 7200),
  },
  installationId: installationId(),

  // --- storage ---
  db: {
    driver: (process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'pg' : 'sqlite')).toLowerCase(),
    url: secret('DATABASE_URL'),
    sqliteFile: process.env.SQLITE_FILE || path.join(process.env.DATA_DIR || path.join(ROOT, 'var'), 'app.db'),
    poolMax: num('PG_POOL_MAX', 10),
    statementTimeoutMs: num('PG_STATEMENT_TIMEOUT_MS', 8000),
  },

  // --- tokens ---
  auth: {
    accessTokenTtlSeconds: num('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
    maxSessionsPerUser: num('MAX_SESSIONS_PER_USER', 5),
    maxFailedLogins: num('MAX_FAILED_LOGINS', 8),
    loginLockSeconds: num('LOGIN_LOCK_SECONDS', 900),
  },

  // --- limits (anti-DDoS) ---
  limits: {
    bodyJsonKb: num('BODY_JSON_KB', 32),
    bodyTextKb: num('BODY_TEXT_KB', 16),
    headerSizeKb: num('HEADER_SIZE_KB', 16),
    ipPerMinute: num('RL_IP_PER_MINUTE', 300),
    ipBurst: num('RL_IP_BURST', 80),
    userPerMinute: num('RL_USER_PER_MINUTE', 600),
    userBurst: num('RL_USER_BURST', 120),
    ipBanSeconds: num('RL_IP_BAN_SECONDS', 900),
    ipBanThreshold: num('RL_IP_BAN_THRESHOLD', 10),
    globalMaxConcurrent: num('RL_GLOBAL_MAX_CONCURRENT', 900),
    shedInFlight: num('RL_SHED_IN_FLIGHT', 450),
    wsMaxConnectionsPerIp: num('WS_MAX_CONN_PER_IP', 4),
    wsMaxMessageBytes: num('WS_MAX_MESSAGE_BYTES', 16 * 1024),
    wsMessagesPerSecond: num('WS_MSG_PER_SECOND', 12),
    wsAuthTimeoutMs: num('WS_AUTH_TIMEOUT_MS', 8000),
    wsPingIntervalMs: num('WS_PING_INTERVAL_MS', 25000),
    wsPongTimeoutMs: num('WS_PONG_TIMEOUT_MS', 20000),
    powDifficultyBits: num('POW_DIFFICULTY_BITS', 16),
    powTtlSeconds: num('POW_TTL_SECONDS', 900),
    powMaxPerIp: num('POW_MAX_PER_IP', 20),
    authPerMinute: num('AUTH_PER_MINUTE', 20),
    authBurst: num('AUTH_BURST', 8),
  },

  // --- retention / memory hygiene ---
  retention: {
    cacheMaxEntries: num('CACHE_MAX_ENTRIES', 4096),
    cacheSweepIntervalMs: num('CACHE_SWEEP_INTERVAL_MS', 30000),
    messagesPerChannel: num('RETENTION_MESSAGES_PER_CHANNEL', 200),
    eventsPerParty: num('RETENTION_EVENTS_PER_PARTY', 100),
    feedItems: num('RETENTION_FEED_ITEMS', 500),
    auditRows: num('RETENTION_AUDIT_ROWS', 5000),
    presenceTtlMs: num('PRESENCE_TTL_MS', 90000),
    cleanupIntervalMs: num('CLEANUP_INTERVAL_MS', 900000),
  },

  // --- clients allowed to talk to this API ---
  allowedOrigins: list('ALLOWED_ORIGINS', [
    'https://localhost',
    'http://localhost',
    'https://omlet-arcade.onrender.com',
  ]),

  e2ee: {
    // Media + data-channel encryption is mandatory; the server has no key.
    required: bool('E2EE_REQUIRED', true),
    keySize: 256,
    ratchetSalt: 'omlet-arcade/e2ee/v1',
  },

  minecraft: {
    maxServersPerUser: num('MC_MAX_SERVERS_PER_USER', 3),
    maxSlots: num('MC_MAX_SLOTS', 40),
  },
};

/** Fail fast at boot instead of failing per-request at 3am. */
function validate() {
  const problems = [];
  if (!config.jwtSecret) {
    if (isProd) problems.push('JWT_SECRET is required in production');
    else {
      // Development convenience: a generated ephemeral secret. Sessions do not
      // survive a restart, which is the correct failure mode for a dev box.
      config.jwtSecret = crypto.randomBytes(32).toString('base64url');
      config.ephemeralJwtSecret = true;
    }
  } else if (config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  if (!config.livekit.url) problems.push('LIVEKIT_URL is required');
  if (!config.livekit.apiKey) problems.push('LIVEKIT_API_KEY is required');
  if (!config.livekit.apiSecret) problems.push('LIVEKIT_API_SECRET is required');
  else if (config.livekit.apiSecret.length < 16) problems.push('LIVEKIT_API_SECRET looks too short');
  if (config.db.driver === 'pg' && !config.db.url) problems.push('DATABASE_URL is required when DB_DRIVER=pg');
  if (config.db.driver !== 'pg' && config.db.driver !== 'sqlite') problems.push(`DB_DRIVER must be pg or sqlite, got ${config.db.driver}`);
  if (config.limits.bodyJsonKb > 256) problems.push('BODY_JSON_KB above 256 defeats the payload cap');
  return problems;
}

module.exports = { config, validate, secret };
