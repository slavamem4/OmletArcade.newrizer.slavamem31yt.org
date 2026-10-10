// Central configuration. Every secret is read from the process environment.
// Nothing here is ever serialised to a client response.
//
// There is no Firebase service account: identity is verified against Google's
// public signing keys, and privileged writes are enforced by database rules
// instead of an admin credential.

import { createHash } from 'node:crypto';

// Values pasted into a dashboard often carry stray quotes or whitespace, and a
// key that differs by one character fails in a way that looks like a wrong
// setting somewhere else. Clean them once, here.
const clean = (value) => {
  const trimmed = value.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return unquoted;
};

const required = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string' || clean(value) === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return clean(value);
};

const optional = (name, fallback) => {
  const value = process.env[name];
  return typeof value === 'string' && clean(value) !== '' ? clean(value) : fallback;
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

  email: Object.freeze((() => {
    const serviceId = optional('EMAILJS_SERVICE_ID', '');
    const templateId = optional('EMAILJS_TEMPLATE_ID', '');
    const publicKey = optional('EMAILJS_PUBLIC_KEY', '');
    const privateKey = optional('EMAILJS_PRIVATE_KEY', '');
    return {
      enabled: Boolean(serviceId && templateId && publicKey && privateKey),
      serviceId,
      templateId,
      publicKey,
      privateKey,
      // Signs verification challenges and proofs. Defaults to a key derived
      // from the LiveKit secret so a deployment is never left unsigned.
      tokenSecret: optional(
        'EMAIL_TOKEN_SECRET',
        createHash('sha256').update(`${required('LIVEKIT_API_SECRET')}:email`).digest('hex'),
      ),
      // When on, a verified address is required before going live.
      enforce: optional('EMAIL_VERIFICATION_REQUIRED', 'true') === 'true',
    };
  })()),

  limits: Object.freeze({
    windowMs: Number.parseInt(optional('RATE_WINDOW_MS', '60000'), 10),
    globalMax: Number.parseInt(optional('RATE_GLOBAL_MAX', '240'), 10),
    tokenMax: Number.parseInt(optional('RATE_TOKEN_MAX', '30'), 10),
    emailMax: Number.parseInt(optional('RATE_EMAIL_MAX', '10'), 10),
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
if (config.email.enforce && !config.email.enabled) {
  // Naming the exact variables turns a deploy failure into a one-line fix.
  const missing = [
    ['EMAILJS_SERVICE_ID', config.email.serviceId],
    ['EMAILJS_TEMPLATE_ID', config.email.templateId],
    ['EMAILJS_PUBLIC_KEY', config.email.publicKey],
    ['EMAILJS_PRIVATE_KEY', config.email.privateKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  throw new Error(
    `EMAIL_VERIFICATION_REQUIRED is on but these are not set: ${missing.join(', ')}. ` +
      'Set them on Render, or set EMAIL_VERIFICATION_REQUIRED=false to start without ' +
      'email verification.',
  );
}
