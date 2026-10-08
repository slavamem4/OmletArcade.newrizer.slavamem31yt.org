// Arcade backend entry point.
//
// Scope on purpose: this service does exactly one privileged thing - it turns a
// verified Firebase identity into a short lived LiveKit grant. It holds no
// database credential, so a compromise of this host cannot read user data.
//
// Hardening summary:
//   - no secret is ever sent to a client; LiveKit grants expire in 15 minutes
//   - identity verified against Google's public keys, no service account
//   - database reads are performed with the caller's own token, rules apply
//   - every body is schema-validated and size-capped
//   - rate limits keyed by authenticated uid when present
//   - CORS default-deny, helmet security headers, no stack traces in responses

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { config } from './config.js';
import { appGate, requireUser } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { rtcRouter } from './routes/rtc.js';

const logger = pino({
  level: config.env === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-app-check"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
});

const app = express();

// Render terminates TLS one hop in front of the app.
app.set('trust proxy', config.security.trustProxyHops);
app.disable('x-powered-by');
app.disable('etag');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      // Native clients send no Origin; browsers must be on the allow list.
      if (!origin) return callback(null, true);
      if (config.security.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, 'forbidden', 'Origin not allowed'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-App-Check'],
    maxAge: 600,
  }),
);

app.use(compression());
app.use(express.json({ limit: config.security.maxBodyBytes, strict: true }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));

const keyGenerator = (req) => req.user?.uid ?? req.ip;
const limiter = (max) =>
  rateLimit({
    windowMs: config.limits.windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    message: { error: { code: 'rate_limited', message: 'Too many requests' } },
  });

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'arcade-api', time: new Date().toISOString() });
});

app.use('/v1', limiter(config.limits.globalMax), appGate);
app.use('/v1/rtc', requireUser, limiter(config.limits.tokenMax), rtcRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
});

// Central error funnel: clients get a code and a safe message, never internals.
app.use((error, req, res, _next) => {
  // body-parser failures are client mistakes, not server faults.
  if (error && !(error instanceof HttpError)) {
    if (error.type === 'entity.too.large') {
      error = new HttpError(413, 'payload_too_large', 'Request body is too large');
    } else if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      error = new HttpError(400, 'bad_request', 'Request body is not valid JSON');
    } else if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      error = new HttpError(415, 'unsupported_media_type', 'Unsupported body encoding');
    }
  }

  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) {
    req.log?.error({ err: error }, 'unhandled error');
  } else {
    req.log?.warn({ code: error.code, msg: error.message }, 'request rejected');
  }
  res.status(status).json({
    error: {
      code: error instanceof HttpError ? error.code : 'internal_error',
      message: error instanceof HttpError ? error.message : 'Unexpected server error',
      ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
    },
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.env }, 'arcade-api listening');
});

const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});
