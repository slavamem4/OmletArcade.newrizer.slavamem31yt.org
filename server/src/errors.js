'use strict';
/**
 * Errors and the async wrapper.
 *
 * Clients get a code and a sentence they can act on. Stack traces, SQL text,
 * and internals stay in the log.
 */
const logger = require('./logger');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const bad = (message, details) => new AppError(400, 'bad_request', message, details);
const unauthorized = (message = 'Sign in to continue') => new AppError(401, 'unauthorized', message);
const forbidden = (message = 'You do not have access to this') => new AppError(403, 'forbidden', message);
const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
const conflict = (message) => new AppError(409, 'conflict', message);
const tooLarge = (message = 'That is too large') => new AppError(413, 'payload_too_large', message);
const unprocessable = (message, details) => new AppError(422, 'unprocessable', message, details);
const tooMany = (message = 'Slow down', retryAfter) => {
  const err = new AppError(429, 'rate_limited', message);
  err.retryAfter = retryAfter;
  return err;
};
const unavailable = (message = 'The server is busy, try again in a moment', retryAfter = 5) => {
  const err = new AppError(503, 'overloaded', message);
  err.retryAfter = retryAfter;
  return err;
};

/** Wrap an async handler so rejections reach the error middleware. */
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function serialize(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } }, retryAfter: err.retryAfter };
  }
  // express body-parser and friends attach a status; respect it, expose nothing else.
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const code = status === 413 ? 'payload_too_large'
    : status === 400 ? 'bad_request'
      : status === 401 ? 'unauthorized'
        : status === 429 ? 'rate_limited'
          : 'server_error';
  const message = status < 500 && err.expose !== false && err.message
    ? err.message
    : 'Something went wrong on our side';
  return { status, body: { error: { code, message } }, retryAfter: err.retryAfter };
}

function handler() {
  return (err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) { next(err); return; }
    const { status, body, retryAfter } = serialize(err);
    if (status >= 500) logger.error('request failed', { code: body.error.code, message: err.message, path: req.path, ip: req.ip });
    if (retryAfter) res.set('Retry-After', String(Math.max(1, Math.floor(retryAfter))));
    res.status(status).json(body);
  };
}

module.exports = {
  AppError, bad, unauthorized, forbidden, notFound, conflict, tooLarge, unprocessable, tooMany, unavailable, wrap, handler, serialize,
};
