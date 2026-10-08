// Central configuration. Every secret is read from the process environment.
// Nothing here is ever serialised to a client response.
//
// There is no Firebase service account: identity is verified against Google's
// public signing keys, and privileged writes are enforced by database rules
// instead of an admin credential.

const required = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const optional = (name, fallback) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
};

const parseList = (raw) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const config = Object.freeze({
  env: optional('NODE_ENV', 'production'),
  port: Number.parseInt(optional('PORT', '10000'), 10),

  livekit: Object.freeze({
    url: required('LIVEKIT_URL'),
    apiKey: required('LIVEKIT_API_KEY'),
    apiSecret: required('LIVEKIT_API_SECRET'),
    // Access tokens stay short lived; the client refreshes through /v1/rtc/token.
    tokenTtlSeconds: Number.parseInt(optional('LIVEKIT_TOKEN_TTL_SECONDS', '900'), 10),
  }),

  firebase: Object.freeze({
    projectId: required('FIREBASE_PROJECT_ID'),
    databaseUrl: required('FIREBASE_DATABASE_URL').replace(/\/+$/, ''),
  }),

  security: Object.freeze({
    // Android clients send no Origin header; browsers must be allow-listed.
    allowedOrigins: parseList(optional('ALLOWED_ORIGINS', '')),
    // Optional hard gate for the public API, sent as X-App-Check.
    appCheckSecret: optional('APP_ATTEST_SECRET', ''),
    maxBodyBytes: Number.parseInt(optional('MAX_BODY_BYTES', '16384'), 10),
    trustProxyHops: Number.parseInt(optional('TRUST_PROXY_HOPS', '1'), 10),
  }),

  limits: Object.freeze({
    windowMs: Number.parseInt(optional('RATE_WINDOW_MS', '60000'), 10),
    globalMax: Number.parseInt(optional('RATE_GLOBAL_MAX', '240'), 10),
    tokenMax: Number.parseInt(optional('RATE_TOKEN_MAX', '30'), 10),
  }),
});

if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
  throw new Error('PORT must be a valid TCP port number');
}
if (!/^wss:\/\//i.test(config.livekit.url)) {
  throw new Error('LIVEKIT_URL must start with wss:// (plaintext signalling is refused)');
}
if (!/^https:\/\//i.test(config.firebase.databaseUrl)) {
  throw new Error('FIREBASE_DATABASE_URL must start with https://');
}
if (!/^[a-z0-9-]{4,40}$/.test(config.firebase.projectId)) {
  throw new Error('FIREBASE_PROJECT_ID looks malformed');
}
