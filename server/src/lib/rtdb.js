// Realtime Database reads performed *as the calling user*.
//
// The service holds no privileged database credential. It forwards the user's
// own ID token, so the database rules decide what it may see - the server can
// never read more than the user already can.

import { config } from '../config.js';
import { HttpError } from './http.js';

const SAFE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

/**
 * @param {string} path e.g. "rooms/stream_abc"
 * @param {string} idToken caller's Firebase ID token
 * @returns {Promise<unknown|null>} parsed value, or null when absent/denied
 */
export const readAs = async (path, idToken) => {
  if (!SAFE_PATH.test(path)) {
    throw new HttpError(400, 'bad_request', 'Malformed database path');
  }

  const url = `${config.firebase.databaseUrl}/${path}.json?auth=${encodeURIComponent(idToken)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  let response;
  try {
    response = await fetch(url, { method: 'GET', signal: controller.signal });
  } catch {
    throw new HttpError(502, 'upstream_unavailable', 'Database is not reachable');
  } finally {
    clearTimeout(timer);
  }

  // 401/403 means the rules refused the read: treat it as "no such data" so
  // the caller cannot distinguish a denied node from a missing one.
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new HttpError(502, 'upstream_error', 'Database returned an error');
  }

  const text = await response.text();
  if (text === '' || text === 'null') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'upstream_error', 'Database returned malformed data');
  }
};
