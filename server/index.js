'use strict';
/**
 * Omlet Arcade clone — server entry point.
 *
 * Boot order matters: config validation, storage, HTTP surface, realtime,
 * schedulers. A missing secret fails the boot instead of failing requests.
 */
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');

const { config, validate } = require('./src/config');
const logger = require('./src/logger');
const db = require('./src/db');
const cache = require('./src/lib/cache');
const realtime = require('./src/realtime');
const purge = require('./src/services/purge');
const errors = require('./src/errors');
const { guard, userBudget } = require('./src/security/guard');

const problems = validate();
if (problems.length) {
  for (const problem of problems) logger.error(`config: ${problem}`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('etag', false);
app.set('json spaces', 0);

/* ------------------------------------------------------------- CSP + heads */

function contentSecurityPolicy() {
  const livekitHosts = [];
  if (config.livekit.url) {
    try {
      const url = new URL(config.livekit.url);
      livekitHosts.push(`${url.protocol}//${url.host}`, url.protocol.replace('ws', 'http') + '//' + url.host);
      // LiveKit Cloud fronts its edge with a wildcard host; the token is what
      // authorizes, so the connect target stays scoped to this project only.
      livekitHosts.push(`wss://*.${url.host.replace(/^[^.]+\./, '')}`, `https://*.${url.host.replace(/^[^.]+\./, '')}`);
    } catch { /* an unparsable LIVEKIT_URL is caught by config validation */ }
  }
  return {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'media-src': ["'self'", 'blob:', 'mediastream:'],
      'connect-src': ["'self'", 'https:', 'wss:', ...livekitHosts],
      'worker-src': ["'self'", 'blob:'],
      'child-src': ["'self'", 'blob:'],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'object-src': ["'none'"],
      'manifest-src': ["'self'"],
    },
  };
}

app.use(helmet({
  contentSecurityPolicy: contentSecurityPolicy(),
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

// Compression is skipped for the webhook: the signature covers the exact bytes
// and a re-encoded body would not verify.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/system/webhooks')) { next(); return; }
  compression()(req, res, next);
});

/* ------------------------------------------------------------- body limits */

const JSON_LIMIT = `${config.limits.bodyJsonKb}kb`;
const TEXT_LIMIT = `${config.limits.bodyTextKb}kb`;
app.use('/api/system/webhooks/livekit', express.raw({ type: () => true, limit: '64kb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.json({ limit: JSON_LIMIT, strict: true }));
app.use(express.text({ limit: TEXT_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: TEXT_LIMIT }));

/* ------------------------------------------------------------------ guard */

app.use(guard());

/* --------------------------------------------------------------- api routes */

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', userBudget(), require('./src/routes/social').usersRouter);
app.use('/api/friends', userBudget(), require('./src/routes/social').friendsRouter);
app.use('/api/calls', userBudget(), require('./src/routes/social').callsRouter);
app.use('/api/parties', userBudget(), require('./src/routes/parties'));
app.use('/api/minecraft', userBudget(), require('./src/routes/minecraft'));
app.use('/api/broadcasts', require('./src/routes/broadcasts'));
app.use('/api/chat', userBudget(), require('./src/routes/chat'));
app.use('/api/keys', userBudget(), require('./src/routes/keys'));
app.use('/api/security', require('./src/routes/security'));
app.use('/api/admin', userBudget(), require('./src/routes/admin'));
app.use('/api/system', require('./src/routes/system'));
// Mounted last: this router owns three ungrouped paths (/feed, /notifications,
// /reports) and its auth middleware must not sit in front of the other routers.
app.use('/api', userBudget(), require('./src/routes/feed'));

/* ---------------------------------------------------------------- frontend */

const WEB_DIR = path.join(config.projectRoot, 'web');
app.use(express.static(WEB_DIR, {
  index: false,
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.set('Cache-Control', 'no-store');
      return;
    }
    // Fingerprinted-by-content assets are not used here; keep them short so a
    // redeploy is never stuck behind a stale cache.
    res.set('Cache-Control', 'public, max-age=300');
  },
}));

app.get('/', (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist' } });
});

app.use((req, res) => {
  if (req.accepts('html')) { res.sendFile(path.join(WEB_DIR, 'index.html')); return; }
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
});

app.use(errors.handler());

/* ------------------------------------------------------------------- boot */

async function start() {
  await db.init();
  logger.info('storage ready', { driver: db.db().name });

  const server = http.createServer(app);
  server.maxHeaderSize = config.limits.headerSizeKb * 1024;
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 15000;
  realtime.attach(server);

  cache.startSweeper();
  purge.startScheduler();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  logger.info('server listening', { port: config.port, env: config.env, publicUrl: config.publicUrl });
  if (config.ephemeralJwtSecret) {
    logger.warn('JWT_SECRET is not set: using an ephemeral secret, sessions will not survive a restart');
  }

  const shutdown = async (signal) => {
    logger.info('shutting down', { signal });
    realtime.closeAll(1001, 'server restarting');
    cache.stopSweeper();
    server.close(() => {});
    try { await db.db().close(); } catch { /* already closed */ }
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { message: reason && reason.message ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { message: err.message });
    // Keep serving: a single stray throw should not take the room down.
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('boot failed', { message: err.message });
    process.exit(1);
  });
}

module.exports = { app, start, contentSecurityPolicy };
