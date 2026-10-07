'use strict';
/**
 * Realtime client.
 *
 * One socket, authenticated with the access token, reconnected with jittered
 * backoff. Every inbound frame is type-checked before it reaches a handler: a
 * malformed frame is dropped, never evaluated.
 */
(function () {
  var socket = null;
  var listeners = {};
  var manualClose = false;
  var attempt = 0;
  var pingTimer = null;
  var connected = false;
  var lastLatency = null;

  function emit(type, payload) {
    var handlers = listeners[type] || [];
    handlers.forEach(function (handler) {
      try { handler(payload); } catch (err) { console.error('socket handler failed', type, err); }
    });
    var any = listeners['*'] || [];
    any.forEach(function (handler) {
      try { handler({ type: type, payload: payload }); } catch (err) { /* ignore */ }
    });
  }

  function wsUrl() {
    var base = window.Api.base();
    if (!base) {
      var config = window.OMLET_CONFIG || {};
      base = config.apiBase || location.origin;
    }
    return base.replace(/^http/, 'ws') + '/ws';
  }

  function scheduleReconnect() {
    if (manualClose) return;
    attempt += 1;
    // Jittered exponential backoff, capped: a fleet of clients must not
    // reconnect in lockstep after a server restart.
    var delay = Math.min(30000, 500 * Math.pow(1.7, Math.min(attempt, 8)));
    delay = delay / 2 + Math.random() * (delay / 2);
    setTimeout(connect, delay);
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (socket && socket.readyState === WebSocket.OPEN) {
        send({ type: 'ping', t: Date.now() });
      }
    }, 20000);
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function send(frame) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (err) {
      return false;
    }
  }

  function handleFrame(raw) {
    var frame;
    try { frame = JSON.parse(raw); } catch (err) { return; }
    if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return;
    if (frame.type === 'pong') {
      if (typeof frame.echo === 'number') lastLatency = Date.now() - frame.echo;
      return;
    }
    emit(frame.type, frame);
  }

  function connect() {
    if (!window.Api.signedIn()) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    manualClose = false;

    var url = wsUrl();
    try {
      socket = new WebSocket(url);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      send({ type: 'auth', token: window.Api.accessToken() });
    };

    socket.onmessage = function (event) {
      if (typeof event.data !== 'string') return; // binary frames are not part of the protocol
      handleFrame(event.data);
    };

    socket.onerror = function () {
      // onclose follows; nothing useful to do here.
    };

    socket.onclose = function (event) {
      var wasConnected = connected;
      connected = false;
      stopPing();
      emit('socket.closed', { code: event.code, reason: event.reason, wasConnected: wasConnected });
      if (event.code === 4001 || event.code === 4003) {
        // Auth rejected or account suspended: do not hammer the server.
        attempt = 8;
      }
      if (event.code === 4008) {
        window.UI.toast('Sending too fast, slow down', { icon: 'warning' });
      }
      scheduleReconnect();
    };
  }

  function on(type, handler) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(handler);
    return function off() {
      listeners[type] = (listeners[type] || []).filter(function (item) { return item !== handler; });
    };
  }

  on('welcome', function () {
    connected = true;
    attempt = 0;
    startPing();
    emit('socket.ready', {});
  });

  on('error', function (frame) {
    if (frame && frame.code === 'auth_required') {
      send({ type: 'auth', token: window.Api.accessToken() });
    }
  });

  function disconnect() {
    manualClose = true;
    stopPing();
    if (socket) {
      try { socket.close(1000, 'client closing'); } catch (err) { /* already closed */ }
    }
    socket = null;
    connected = false;
    listeners = {};
  }

  window.Socket = {
    connect: connect,
    disconnect: disconnect,
    send: send,
    on: on,
    isConnected: function () { return connected; },
    latency: function () { return lastLatency; },
    state: function () { return socket ? socket.readyState : WebSocket.CLOSED; },
  };
})();
