'use strict';
/**
 * Request guard: the first middleware to run, before body parsing.
 *
 * Order matters. Cheap rejections first (method, size, shape), then the ban
 * check, then the budget, then the load shed. An attacker should spend the
 * least possible server time per rejected request.
 */
const { config } = require('../config');
const rateLimit = require('./rate-limit');
const pow = require('./pow');
const logger = require('../logger');
const { serialize } = require('../errors');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

/**
 * Signatures that only ever appear in an attack against this API. The API is
 * JSON-only with parameterized SQL and no path-derived queries, so any of
 * these is a probe. Matching is case-insensitive and runs on the path and the
 * query string only (never on bodies, which are validated field by field).
 */
const WAF_PATTERNS = [
  /(\.\.\/|\.\.\\|%2e%2e)/i,
  /(\bunion\b\s+(all\s+)?\bselect\b)/i,
  /(\bselect\b.+\bfrom\b.+\binformation_schema\b)/i,
  /(\/etc\/passwd|win\.ini|boot\.ini)/i,
  /(<script[\s>]|javascript:|onerror\s*=|onload\s*=)/i,
  /(\$\{.*\}|__proto__|constructor\s*\[)/i,
  /(\bsleep\s*\(|\bbenchmark\s*\(|\bpg_sleep\b|xp_cmdshell)/i,
  /(\bdrop\s+table\b|\binsert\s+into\b.+\bvalues\b)/i,
  /(\/\.git|\/\.env|wp-login|phpmyadmin|\/actuator)/i,
];

let requestId = 0;

function clientIp(req) {
  // `trust proxy` is set from TRUST_PROXY_HOPS; req.ip is then the leftmost
  // untrusted address. Fall back to the socket when unset (local runs).
  return (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').toString().slice(0, 64);
}

function reject(res, err) {
  const { status, body, retryAfter } = serialize(err);
  if (retryAfter) res.set('Retry-After', String(Math.max(1, Math.floor(retryAfter))));
  res.status(status).json(body);
}

function guard() {
  return (req, res, next) => {
    const id = `r${++requestId}`;
    req.requestId = id;
    res.set('X-Request-Id', id);

    const ip = clientIp(req);
    req.clientIp = ip;

    if (!ALLOWED_METHODS.has(req.method)) {
      reject(res, Object.assign(new Error('Method not allowed'), { status: 405, expose: false }));
      return;
    }

    // Hard caps. Node enforces maxHeaderSize on the socket; these catch the
    // rest before any parsing work happens.
    if (req.originalUrl.length > 4096) {
      reject(res, Object.assign(new Error('URI too long'), { status: 414, expose: false }));
      return;
    }
    const headerCount = Object.keys(req.headers).length;
    if (headerCount > 60) {
      reject(res, Object.assign(new Error('Too many headers'), { status: 431, expose: false }));
      return;
    }

    const haystack = `${req.path}?${typeof req.query === 'string' ? req.query : new URLSearchParams(req.query || {}).toString()}`;
    if (haystack.length > 4096 || WAF_PATTERNS.some((pattern) => pattern.test(haystack))) {
      logger.warn('waf: suspicious request', { ip, path: req.path.slice(0, 200) });
      const banned = rateLimit.penalize(`ip:${ip}`, config.limits, { immediate: true });
      res.set('X-PoW-Required', pow.required(ip) ? '1' : '0');
      reject(res, Object.assign(new Error('Request blocked'), { status: 400, expose: false, retryAfter: banned }));
      return;
    }

    // Cross-origin writes must come from a known client. Same-origin (the
    // Capacitor WebView) sends no Origin and is allowed.
    const origin = req.get('origin');
    if (origin && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const allowed = config.allowedOrigins.some((entry) => entry === '*' || origin === entry || origin.startsWith(`${entry}:`));
      if (!allowed) {
        reject(res, Object.assign(new Error('Origin not allowed'), { status: 403, expose: false }));
        return;
      }
    }

    if (rateLimit.isBanned(`ip:${ip}`)) {
      const result = rateLimit.checkIp(ip, config.limits);
      res.set('Retry-After', String(result.retryAfter || 60));
      res.set('X-PoW-Required', pow.required(ip) ? '1' : '0');
      reject(res, Object.assign(new Error('Too many requests from this network'), { status: 429, expose: false, retryAfter: result.retryAfter || 60 }));
      return;
    }

    // Load shedding: protect the requests already in flight.
    const inFlight = rateLimit.enter(id);
    res.on('close', () => rateLimit.leave(id));
    if (inFlight > config.limits.globalMaxConcurrent) {
      reject(res, Object.assign(new Error('The server is at capacity'), { status: 503, expose: false, retryAfter: 5 }));
      return;
    }
    if (inFlight > config.limits.shedInFlight && !req.path.startsWith('/api/auth')) {
      reject(res, Object.assign(new Error('The server is busy, try again shortly'), { status: 503, expose: false, retryAfter: 5 }));
      return;
    }

    const result = rateLimit.checkIp(ip, config.limits);
    if (!result.allowed) {
      const bannedFor = rateLimit.penalize(`ip:${ip}`, config.limits);
      const retry = bannedFor || result.retryAfter;
      res.set('Retry-After', String(retry));
      res.set('X-PoW-Required', pow.required(ip) ? '1' : '0');
      if (bannedFor) logger.warn('rate limit: ip banned', { ip, seconds: bannedFor });
      reject(res, Object.assign(new Error('Too many requests, slow down'), { status: 429, expose: false, retryAfter: retry }));
      return;
    }

    next();
  };
}

/** Per-account budget, applied after auth has resolved req.user. */
function userBudget() {
  return (req, res, next) => {
    if (!req.user) { next(); return; }
    const result = rateLimit.checkUser(req.user.id, config.limits);
    if (!result.allowed) {
      reject(res, Object.assign(new Error('Your account is making too many requests'), { status: 429, expose: false, retryAfter: result.retryAfter }));
      return;
    }
    next();
  };
}

module.exports = { guard, userBudget, clientIp, WAF_PATTERNS };
