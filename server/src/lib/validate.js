'use strict';
/**
 * Input validation at the trust boundary.
 *
 * Everything that reaches the database or another user passes through here.
 * The stance is deny-by-default: unknown keys are dropped, types are coerced
 * once, and length caps are enforced before anything is stored.
 */
const { bad } = require('../errors');

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,180}\.[^\s@]{2,24}$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Emoji and pictographs: the UI ships drawn icons only, so these are rejected
// rather than rendered as a fallback glyph.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u;
const B64_RE = /^[A-Za-z0-9+/=_-]+$/;

function isUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value) && !/__{2,}/.test(value);
}

function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL_RE, '').trim();
  if (text.length === 0 || text.length > max) return null;
  return text;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === '') return '';
  const text = cleanText(value, max);
  return text === null ? null : text;
}

function hasEmoji(value) {
  return typeof value === 'string' && EMOJI_RE.test(value);
}

/** Base64 / base64url blob with a hard byte cap. */
function isBlob(value, maxBytes) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > Math.ceil((maxBytes * 4) / 3) + 8) return false;
  if (!B64_RE.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').length <= maxBytes;
  } catch {
    return false;
  }
}

function int(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function oneOf(value, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    return null;
  }
  return allowed.includes(value) ? value : null;
}

/**
 * A Minecraft address: hostname, IPv4, or IPv6 in brackets. Validated by
 * structure, then resolved by the client — the server never dials it.
 */
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

function isAddress(value) {
  if (typeof value !== 'string' || value.length > 253) return false;
  const text = value.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1);
    return /^[0-9a-f:]{2,45}$/.test(inner) && inner.includes(':');
  }
  if (IPV4_RE.test(text)) return true;
  return HOST_RE.test(text) && !text.includes('..');
}

/**
 * Run a spec over a payload. Spec shape: { field: [kind, opts] }.
 * Throws AppError(400) listing every problem at once, so a form can show them
 * together instead of one round trip per field.
 */
function parse(payload, spec) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  const problems = [];
  for (const [field, [kind, opts = {}]] of Object.entries(spec)) {
    const value = source[field];
    let result;
    switch (kind) {
      case 'username':
        result = isUsername(value) ? value.toLowerCase() : undefined;
        break;
      case 'email':
        result = isEmail(value) ? value.toLowerCase() : undefined;
        break;
      case 'password':
        result = typeof value === 'string' && value.length >= (opts.min || 8) && value.length <= 512 ? value : undefined;
        break;
      case 'text':
        result = opts.optional ? optionalText(value, opts.max || 64) : cleanText(value, opts.max || 64);
        if (result === null) result = undefined;
        if (result && opts.noEmoji !== false && hasEmoji(result)) result = undefined;
        break;
      case 'blob':
        result = isBlob(value, opts.maxBytes || 4096) ? value : undefined;
        break;
      case 'int':
        result = int(value, opts);
        break;
      case 'bool':
        result = bool(value, opts.fallback);
        break;
      case 'enum':
        result = oneOf(value, opts.values, opts.fallback);
        break;
      case 'address':
        result = isAddress(value) ? value.trim().toLowerCase() : undefined;
        break;
      case 'id': {
        const n = Number(value);
        result = Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) { result = undefined; break; }
        if (value.length > (opts.maxItems || 50)) { result = undefined; break; }
        const items = [];
        let ok = true;
        for (const item of value) {
          if (opts.of === 'id') {
            const n = Number(item);
            if (!Number.isInteger(n) || n <= 0) { ok = false; break; }
            items.push(n);
          } else {
            const text = cleanText(item, opts.max || 64);
            if (text === null) { ok = false; break; }
            items.push(text);
          }
        }
        result = ok ? items : undefined;
        break;
      }
      case 'any':
        result = value;
        break;
      default:
        throw new Error(`validate: unknown kind ${kind}`);
    }
    if (result === undefined) {
      if (!opts.optional && opts.fallback === undefined) {
        problems.push(opts.message || `${field} is not valid`);
        continue;
      }
      if (opts.fallback !== undefined) { out[field] = opts.fallback; continue; }
      if (opts.optional) { out[field] = value === undefined || value === null || value === '' ? (opts.default !== undefined ? opts.default : null) : result; continue; }
    }
    out[field] = result;
  }
  if (problems.length) throw bad(problems.join('. '), { fields: problems });
  return out;
}

module.exports = {
  parse, isUsername, isEmail, cleanText, optionalText, hasEmoji, isBlob, int, bool, oneOf, isAddress,
  USERNAME_RE, EMOJI_RE,
};
