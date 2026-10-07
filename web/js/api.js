'use strict';
/**
 * API client.
 *
 * Holds the session tokens in localStorage (the WebView's own encrypted store
 * on Android) and never sees a server secret: the only credential it sends is
 * a short-lived access token minted by this backend.
 *
 * On a 401 it refreshes once, serializing concurrent refreshes so ten parallel
 * requests do not burn ten refresh tokens (rotation makes that a logout).
 */
(function () {
  var ACCESS_KEY = 'oa.accessToken';
  var REFRESH_KEY = 'oa.refreshToken';
  var USER_KEY = 'oa.user';
  var BASE_KEY = 'oa.apiBase';

  var base = '';
  var bootstrap = null;
  var refreshing = null;
  var onUnauthorized = null;

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* storage disabled: session lives in memory only */ }
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function detectBase() {
    // In the packaged app the WebView origin is the bundle, not the API, so the
    // deployed URL is injected at build time. In the browser it is same-origin.
    var injected = window.OMLET_CONFIG && window.OMLET_CONFIG.apiBase;
    if (injected) return String(injected).replace(/\/+$/, '');
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    return '';
  }

  function accessToken() { return read(ACCESS_KEY); }
  function user() {
    var raw = read(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function setSession(data) {
    if (!data) return;
    if (data.accessToken) store(ACCESS_KEY, data.accessToken);
    if (data.refreshToken) store(REFRESH_KEY, data.refreshToken);
    if (data.user) store(USER_KEY, JSON.stringify(data.user));
  }

  function clearSession() {
    store(ACCESS_KEY, null);
    store(REFRESH_KEY, null);
    store(USER_KEY, null);
  }

  function setBootstrap(data) {
    bootstrap = data;
    if (data && data.api && data.api.url && !window.OMLET_CONFIG) {
      // Trust the bootstrap only when it comes from the same origin we called.
      try {
        var url = new URL(data.api.url);
        if (url.origin === location.origin) base = url.origin;
      } catch (e) { /* keep the detected base */ }
    }
  }

  function url(path) {
    if (/^https?:\/\//.test(path)) return path;
    return base + path;
  }

  function headers(extra) {
    var out = { accept: 'application/json' };
    var token = accessToken();
    if (token) out.authorization = 'Bearer ' + token;
    if (extra) Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    return out;
  }

  function ApiError(status, code, message, retryAfter) {
    var err = new Error(message || 'Request failed');
    err.status = status;
    err.code = code;
    err.retryAfter = retryAfter;
    return err;
  }

  async function parseError(response) {
    var retryAfter = Number(response.headers.get('retry-after')) || 0;
    var powRequired = response.headers.get('x-pow-required') === '1';
    var code = 'http_' + response.status;
    var message = response.statusText || 'Request failed';
    try {
      var body = await response.json();
      if (body && body.error) {
        code = body.error.code || code;
        message = body.error.message || message;
        if (body.error.details && body.error.details.fields) message = body.error.details.fields.join('. ');
      }
    } catch (e) { /* not JSON: keep the status text */ }
    var err = ApiError(response.status, code, message, retryAfter);
    err.powRequired = powRequired;
    return err;
  }

  async function request(method, path, body, options) {
    var opts = options || {};
    var init = { method: method, headers: headers(opts.headers), cache: 'no-store' };
    if (body !== undefined && body !== null) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var response = await fetch(url(path), init);
    if (response.ok) {
      if (response.status === 204) return null;
      var type = response.headers.get('content-type') || '';
      if (type.indexOf('application/json') === -1) return response.text();
      return response.json();
    }
    throw await parseError(response);
  }

  async function refresh() {
    var refreshToken = read(REFRESH_KEY);
    if (!refreshToken) return false;
    var response;
    try {
      response = await fetch(url('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken }),
        cache: 'no-store',
      });
    } catch (e) {
      return false;
    }
    if (!response.ok) return false;
    var data = await response.json();
    setSession(data);
    return true;
  }

  /** Single-flight refresh so parallel 401s rotate exactly one token. */
  function refreshOnce() {
    if (!refreshing) {
      refreshing = refresh().then(function (ok) { refreshing = null; return ok; });
    }
    return refreshing;
  }

  async function call(method, path, body, options) {
    try {
      return await request(method, path, body, options);
    } catch (err) {
      if (err.status !== 401 || (options && options.noRetry)) throw err;
      if (!read(REFRESH_KEY)) {
        clearSession();
        if (onUnauthorized) onUnauthorized(err);
        throw err;
      }
      var ok = await refreshOnce();
      if (!ok) {
        clearSession();
        if (onUnauthorized) onUnauthorized(err);
        throw err;
      }
      try {
        return await request(method, path, body, options);
      } catch (second) {
        if (second.status === 401) {
          clearSession();
          if (onUnauthorized) onUnauthorized(second);
        }
        throw second;
      }
    }
  }

  var Api = {
    init: function (hooks) {
      base = detectBase();
      if (hooks && hooks.onUnauthorized) onUnauthorized = hooks.onUnauthorized;
      return base;
    },
    base: function () { return base; },
    bootstrap: function () { return bootstrap; },
    setBootstrap: setBootstrap,
    accessToken: accessToken,
    user: user,
    setUser: function (u) { store(USER_KEY, JSON.stringify(u)); },
    setSession: setSession,
    clearSession: clearSession,
    signedIn: function () { return !!accessToken(); },
    get: function (path) { return call('GET', path); },
    post: function (path, body) { return call('POST', path, body || {}); },
    patch: function (path, body) { return call('PATCH', path, body || {}); },
    put: function (path, body) { return call('PUT', path, body || {}); },
    del: function (path, body) { return call('DELETE', path, body || {}); },
    /** Binary download (the host pack). Auth header, blob out. */
    download: async function (path, filename) {
      var response = await fetch(url(path), { headers: headers(), cache: 'no-store' });
      if (!response.ok) throw await parseError(response);
      var blob = await response.blob();
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
      return blob.size;
    },
    refreshNow: refresh,
    ApiError: ApiError,
  };

  window.Api = Api;
})();
