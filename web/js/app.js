'use strict';
/**
 * App controller: session lifecycle, cross-screen actions, the incoming call
 * overlay, and the socket wiring that is not owned by one screen.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;
  var callOverlay = null;
  var ringAudio = null;

  /* -------------------------------------------------------------- session - */

  async function boot() {
    window.Api.init({ onUnauthorized: onSignedOut });
    try {
      var data = await window.Api.get('/api/security/bootstrap');
      window.Api.setBootstrap(data);
    } catch (err) {
      // Offline or wrong base: keep going, the screens will surface the error.
    }
    if (!window.Api.signedIn()) {
      window.Api.clearSession();
      window.Router.boot();
      window.Router.go('#/auth', { replace: true });
      return;
    }
    if (window.Api.accessToken()) {
      try {
        var me = await window.Api.get('/api/users/me');
        window.Api.setUser(me.user);
      } catch (err) {
        window.Api.clearSession();
        window.Router.boot();
        window.Router.go('#/auth', { replace: true });
        return;
      }
    }
    startRealtime();
    window.Router.boot();
    if (!location.hash || location.hash === '#' || location.hash === '#/') location.replace('#/home');
    window.Screens.auth.recoverKeys().catch(function () { /* optional */ });
    refreshBadges();
  }

  function startRealtime() {
    window.Socket.connect();
    window.Socket.on('socket.ready', function () { refreshBadges(); });
    window.Socket.on('friend.request', function (frame) {
      window.UI.toast((frame.user.displayName || 'Someone') + ' sent a friend request', {
        icon: 'user-plus',
        action: { label: 'View', handler: function () { window.Router.go('#/friends?tab=requests'); } },
      });
      refreshBadges();
    });
    window.Socket.on('friend.accepted', function (frame) {
      window.UI.toast('You and ' + (frame.user.displayName || 'a player') + ' are friends', { icon: 'check' });
    });
    window.Socket.on('party.invite', function (frame) {
      window.UI.toast((frame.inviter.displayName || 'A player') + ' invited you to a room', {
        icon: 'users',
        action: { label: 'Join', handler: function () { window.Router.go('#/party/' + frame.partyId); } },
      });
      refreshBadges();
    });
    window.Socket.on('broadcast.started', function (frame) {
      window.UI.toast('A friend went live: ' + frame.title, {
        icon: 'radio',
        action: { label: 'Watch', handler: function () { window.Router.go('#/party/' + frame.partyId); } },
      });
    });
    window.Socket.on('call.incoming', onIncomingCall);
    window.Socket.on('call.accepted', function (frame) {
      stopRing();
      window.Router.go('#/party/' + frame.callId);
    });
    window.Socket.on('call.declined', function () {
      stopRing();
      closeCallOverlay();
      window.UI.toast('Call declined', { icon: 'phone-off' });
    });
    window.Socket.on('call.ended', function () {
      stopRing();
      closeCallOverlay();
      var route = window.Router.current();
      if (route && route.name === 'party') window.Router.go('#/home');
    });
    window.Socket.on('account.banned', function (frame) {
      window.UI.toast('This account was suspended' + (frame.reason ? ': ' + frame.reason : ''), { icon: 'ban-circle', duration: 8000 });
      signOut();
    });
  }

  /**
   * Called right after a successful sign in. The password is used once, on this
   * device, to seal the E2EE identity key for recovery. It is never stored.
   */
  async function afterSignIn(password) {
    try {
      await window.E2EE.ensureIdentity(password);
    } catch (err) {
      // A key can be created later from settings; do not block the sign in.
    }
    startRealtime();
    window.Router.boot();
    window.Router.go('#/home', { replace: true });
    refreshBadges();
  }

  function onSignedOut() {
    window.Voice.disconnect();
    window.Socket.disconnect();
    window.UI.toast('Your session ended, sign in again', { icon: 'lock' });
    window.Router.go('#/auth', { replace: true });
  }

  async function signOut() {
    try {
      await window.Api.post('/api/auth/logout', {});
    } catch (err) { /* the local clear below is what matters */ }
    window.Voice.disconnect();
    window.Socket.disconnect();
    window.Api.clearSession();
    window.Router.go('#/auth', { replace: true });
  }

  /* ---------------------------------------------------------------- badges - */

  async function refreshBadges() {
    if (!window.Api.signedIn()) return;
    try {
      var data = await window.Api.get('/api/parties/invites');
      window.Router.setBadge('parties', (data.invites || []).length);
    } catch (err) { /* ignore */ }
    try {
      var friends = await window.Api.get('/api/friends');
      window.Router.setBadge('profile', (friends.incoming || []).length);
    } catch (err) { /* ignore */ }
  }

  function refresh() {
    refreshBadges();
    var route = window.Router.current();
    if (route) window.Router.go(route.hash, { force: true, replace: true });
  }

  /* ------------------------------------------------------- party shortcuts - */

  function createParty() {
    var name = el('input', { class: 'input', placeholder: 'Squad alpha', maxlength: 48 });
    var game = el('input', { class: 'input', placeholder: 'What are you playing?', maxlength: 48 });
    var locked = false;
    var maxMembers = 8;
    var submit = window.UI.button('Create room', { variant: 'primary', block: true });

    submit.addEventListener('click', async function () {
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); return; }
      window.UI.setLoading(submit, true);
      try {
        var result = await window.Api.post('/api/parties', {
          name: name.value.trim(),
          game: game.value.trim(),
          kind: 'party',
          locked: locked,
          maxMembers: maxMembers,
        });
        window.UI.closeTopSheet();
        window.Router.go('#/party/' + result.party.id);
      } catch (err) {
        window.UI.toast(err.message || 'That did not work', { icon: 'warning' });
      } finally {
        window.UI.setLoading(submit, false);
      }
    });

    window.UI.sheet({
      title: 'Start a party',
      body: el('div', { class: 'stack-lg' }, [
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Room name' }), name]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Game' }), game]),
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Seats' }),
          window.UI.segmented([{ id: 4, label: '4' }, { id: 8, label: '8' }, { id: 16, label: '16' }, { id: 32, label: '32' }], 8, function (next) { maxMembers = Number(next); }),
        ]),
        window.UI.switchRow({ icon: 'lock', label: 'Invite only', sub: 'Nobody can join without an invite', checked: false, onChange: function (next) { locked = next; } }),
        submit,
      ]),
    });
  }

  async function joinParty(party, options) {
    try {
      await window.Api.post('/api/parties/' + party.id + '/join', options || {});
      window.Router.go('#/party/' + party.id);
    } catch (err) {
      window.UI.toast(err.message || 'Could not join', { icon: 'warning' });
    }
  }

  async function openInviteSheet(partyId) {
    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(host, window.UI.skeletonList(4));
    var instance = window.UI.sheet({ title: 'Invite friends', body: host });
    try {
      var data = await window.Api.get('/api/friends');
      var friends = (data && data.friends) || [];
      window.Dom.clear(host);
      if (!friends.length) {
        window.Dom.append(host, window.UI.empty({ icon: 'user-plus', title: 'No friends to invite', body: 'Add a few players first.', action: { label: 'Find players', icon: 'search', onclick: function () { instance.close(); openSearch(); } } }));
        return;
      }
      friends.forEach(function (friend) {
        var state = el('span', { class: 'meta', text: 'invite' });
        var row = window.UI.row({
          title: friend.displayName,
          sub: '@' + friend.username + ' · ' + (friend.presence === 'online' ? 'online' : 'offline'),
          avatar: window.Dom.avatarNode(friend, 40),
          end: [state],
          onclick: async function () {
            state.textContent = 'sending';
            try {
              await window.Api.post('/api/parties/' + partyId + '/invite', { userId: friend.id });
              state.textContent = 'invited';
              state.style.color = 'var(--ok)';
            } catch (err) {
              state.textContent = err.message || 'failed';
              state.style.color = 'var(--err)';
            }
          },
        });
        window.Dom.append(host, row);
      });
    } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
    }
  }

  function openInvites() {
    var host = el('div', { class: 'stack' });
    window.Dom.append(host, window.UI.skeletonList(3));
    var instance = window.UI.sheet({ title: 'Invites', body: host });
    window.Api.get('/api/parties/invites').then(function (data) {
      var invites = (data && data.invites) || [];
      window.Dom.clear(host);
      if (!invites.length) {
        window.Dom.append(host, window.UI.empty({ icon: 'users', title: 'No invites', body: 'When a friend invites you, it lands here.' }));
        return;
      }
      invites.forEach(function (invite) {
        window.Dom.append(host, window.UI.row({
          title: invite.partyName,
          sub: 'from ' + invite.inviter.displayName + ' · ' + window.Dom.timeAgo(invite.createdAt) + ' ago',
          avatar: window.Dom.avatarNode(invite.inviter, 40),
          end: [window.UI.button('Join', {
            size: 'sm',
            variant: 'primary',
            onclick: function () { instance.close(); joinParty({ id: invite.partyId, name: invite.partyName, kind: invite.partyKind }, { inviteId: invite.id }); },
          })],
        }));
      });
    }).catch(function (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
    });
  }

  /* ----------------------------------------------------------------- calls - */

  function onIncomingCall(frame) {
    closeCallOverlay();
    startRing();
    var from = frame.from || {};
    callOverlay = el('div', {
      class: 'sheet',
      style: 'top:0;bottom:auto;border-radius:0 0 20px 20px;animation:sheet-in 250ms cubic-bezier(0.2,0,0,1) both',
      role: 'alertdialog',
      'aria-label': 'Incoming call',
    }, [
      el('div', { class: 'sheet__body', style: 'align-items:center;text-align:center;padding:32px 16px' }, [
        window.Dom.avatarNode(from, 72),
        el('div', { class: 'headline', text: from.displayName || 'Unknown' }),
        el('div', { class: 'meta', text: (frame.video ? 'Video call' : 'Voice call') + ' · code ' + frame.code }),
        el('div', { class: 'hrow', style: 'gap:24px;margin-top:16px' }, [
          el('button', {
            class: 'mic-btn mic-btn--end',
            'aria-label': 'Decline',
            onclick: async function () {
              stopRing();
              closeCallOverlay();
              try { await window.Api.post('/api/calls/' + frame.callId + '/decline', {}); } catch (err) { /* already ended */ }
            },
          }, [el('span', { html: icon('phone-off', 24) })]),
          el('button', {
            class: 'mic-btn',
            'aria-label': 'Answer',
            onclick: async function () {
              stopRing();
              closeCallOverlay();
              try {
                await window.Api.post('/api/calls/' + frame.callId + '/accept', {});
                window.Router.go('#/party/' + frame.callId);
              } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
            },
          }, [el('span', { html: icon('phone', 24) })]),
        ]),
      ]),
    ]);
    document.body.appendChild(callOverlay);
  }

  function closeCallOverlay() {
    if (callOverlay && callOverlay.parentNode) callOverlay.parentNode.removeChild(callOverlay);
    callOverlay = null;
  }

  function startRing() {
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ringAudio = new Ctor();
      var osc = ringAudio.createOscillator();
      var gain = ringAudio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.value = 0.04;
      osc.connect(gain).connect(ringAudio.destination);
      osc.start();
      ringAudio.__osc = osc;
    } catch (err) { /* vibration-only devices */ }
    if (navigator.vibrate) navigator.vibrate([200, 120, 200]);
  }

  function stopRing() {
    if (ringAudio) {
      try { if (ringAudio.__osc) ringAudio.__osc.stop(); ringAudio.close(); } catch (err) { /* already closed */ }
      ringAudio = null;
    }
  }

  async function call(user) {
    var closeToast = window.UI.toast('Calling ' + user.displayName + '…', { icon: 'phone', duration: 30000 });
    try {
      var result = await window.Api.post('/api/calls', { userId: user.id, video: false });
      closeToast();
      window.Router.go('#/party/' + result.callId);
    } catch (err) {
      closeToast();
      window.UI.toast(err.message || 'The call did not connect', { icon: 'warning' });
    }
  }

  /* -------------------------------------------------------------- broadcast */

  async function startBroadcast() {
    var title = el('input', { class: 'input', placeholder: 'Ranked grind, come hang', maxlength: 60 });
    var game = el('input', { class: 'input', placeholder: 'Game', maxlength: 40 });
    var submit = window.UI.button('Go live', { variant: 'primary', block: true, icon: 'radio' });
    submit.addEventListener('click', async function () {
      if (!title.value.trim()) { title.setAttribute('aria-invalid', 'true'); return; }
      window.UI.setLoading(submit, true);
      try {
        var result = await window.Api.post('/api/broadcasts', { title: title.value.trim(), game: game.value.trim(), withCamera: false });
        window.UI.closeTopSheet();
        window.Router.go('#/party/' + result.broadcast.party.id);
      } catch (err) {
        window.UI.toast(err.message || 'Could not start the stream', { icon: 'warning' });
      } finally {
        window.UI.setLoading(submit, false);
      }
    });
    window.UI.sheet({
      title: 'Go live',
      body: el('div', { class: 'stack-lg' }, [
        el('div', { class: 'banner' }, [
          el('span', { html: icon('screen', 18) }),
          el('div', { class: 'body', text: 'Your screen and microphone are published to your friends. On Android you will be asked to allow screen capture.' }),
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Title' }), title]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Game' }), game]),
        submit,
      ]),
    });
  }

  /* --------------------------------------------------------------- search - */

  function openSearch() {
    var input = el('input', { class: 'input', type: 'search', placeholder: 'Search a player name', autocapitalize: 'none', spellcheck: 'false', maxlength: 32 });
    var results = el('div', { class: 'list' });
    var instance = window.UI.sheet({
      title: 'Find players',
      body: el('div', { class: 'stack-lg' }, [input, results]),
    });
    window.Dom.append(results, el('p', { class: 'meta', text: 'Type at least two characters.' }));

    var run = window.Dom.debounce(async function () {
      var term = input.value.trim();
      window.Dom.clear(results);
      if (term.length < 2) {
        window.Dom.append(results, el('p', { class: 'meta', text: 'Type at least two characters.' }));
        return;
      }
      try {
        var data = await window.Api.get('/api/users/search?q=' + encodeURIComponent(term));
        var users = (data && data.users) || [];
        if (!users.length) {
          window.Dom.append(results, window.UI.empty({ icon: 'search', title: 'Nobody matches', body: 'Check the spelling, or they have not joined yet.' }));
          return;
        }
        users.forEach(function (user) {
          window.Dom.append(results, window.UI.row({
            title: user.displayName,
            sub: '@' + user.username + ' · level ' + user.level,
            avatar: window.Dom.avatarNode(user, 40),
            onclick: function () { instance.close(); window.Router.go('#/profile/' + user.id); },
          }));
        });
      } catch (err) {
        window.Dom.append(results, window.UI.banner('error', err.message));
      }
    }, 260);

    input.addEventListener('input', run);
    setTimeout(function () { input.focus(); }, 90);
  }

  /* ------------------------------------------------------------ encryption - */

  async function showMyKey() {
    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(host, window.UI.spinner(24));
    var instance = window.UI.sheet({ title: 'Your encryption key', body: host });
    try {
      var data = await window.Api.get('/api/keys/me');
      window.Dom.clear(host);
      if (!data.identityPublicKey) {
        var create = window.UI.button('Create my key', { variant: 'primary', block: true });
        create.addEventListener('click', async function () {
          var password = await window.UI.promptDialog({ title: 'Confirm your password', label: 'Password', type: 'password', required: true, confirmLabel: 'Create key' });
          if (!password) return;
          try {
            var identity = await window.E2EE.ensureIdentity(password);
            window.Dom.clear(host);
            window.Dom.append(host, [
              el('p', { class: 'body muted', text: 'Created. Keep your password safe: it is what opens this key on a new device.' }),
              el('div', { class: 'card stack' }, [el('div', { class: 'meta', text: 'SAFETY NUMBER' }), el('div', { class: 'mono', text: identity.fingerprint || '' })]),
            ]);
          } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        });
        window.Dom.append(host, [
          el('p', { class: 'body muted', text: 'This device has no key yet. Creating one takes a password confirmation and takes about a second.' }),
          create,
        ]);
        return;
      }
      window.Dom.append(host, [
        el('p', { class: 'body muted', text: 'This is your safety number. Read it out loud with a friend to confirm nobody is reading your messages in the middle.' }),
        el('div', { class: 'card stack' }, [el('div', { class: 'meta', text: 'SAFETY NUMBER' }), el('div', { class: 'mono title', text: data.fingerprint })]),
        el('div', { class: 'card stack' }, [
          el('div', { class: 'meta', text: 'HOW IT WORKS' }),
          el('p', { class: 'body', text: 'Agreement: ' + data.algorithm.agreement + '. Key derivation: ' + data.algorithm.kdf + '. Cipher: ' + data.algorithm.cipher + '. Media: ' + data.algorithm.media + '.' }),
        ]),
        window.UI.button('Reset the key on this device', {
          variant: 'danger',
          block: true,
          onclick: async function () {
            var ok = await window.UI.confirmDialog({ title: 'Reset your key?', body: 'Messages sealed with the old key stay unreadable. Your friends will see the new safety number.', confirmLabel: 'Reset', destructive: true });
            if (!ok) return;
            var password = await window.UI.promptDialog({ title: 'Confirm your password', label: 'Password', type: 'password', required: true });
            if (!password) return;
            try {
              window.E2EE.forgetIdentity();
              var identity = await window.E2EE.ensureIdentity(password);
              window.Dom.clear(host);
              window.Dom.append(host, el('div', { class: 'card stack' }, [el('div', { class: 'meta', text: 'NEW SAFETY NUMBER' }), el('div', { class: 'mono title', text: identity.fingerprint || '' })]));
            } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          },
        }),
      ]);
    } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
    }
  }

  function showFingerprints(keys) {
    window.UI.sheet({
      title: 'Verify encryption',
      body: el('div', { class: 'stack-lg' }, [
        el('p', { class: 'body muted', text: keys.howToVerify }),
        el('div', { class: 'card stack' }, [el('div', { class: 'meta', text: 'YOUR KEY' }), el('div', { class: 'mono title', text: keys.mine || 'Not created yet' })]),
        el('div', { class: 'card stack' }, [el('div', { class: 'meta', text: (keys.theirsUsername || 'THEIR').toUpperCase() + ' KEY' }), el('div', { class: 'mono title', text: keys.theirs || 'Not created yet' })]),
      ]),
    });
  }

  /** Restore the identity key from the recovery blob using the password. */
  async function recoverIdentity(password, meta) {
    var me = window.Api.user();
    var result = await window.Api.post('/api/keys/identity/verify', { password: password });
    if (!result || !result.privateKey) return null;
    var identity = { privateKey: result.privateKey, userId: me.id, restoredAt: Date.now(), fingerprint: result.fingerprint };
    // The public half is the account's; fetch it so the cache is complete.
    var stored = meta || await window.Api.get('/api/keys/me');
    identity.publicKey = stored.identityPublicKey;
    window.E2EE.cacheIdentity(identity);
    return identity;
  }

  /* -------------------------------------------------------------- reporting */

  function report(user) {
    var reason = 'abuse';
    var detail = el('textarea', { class: 'textarea', maxlength: 500, placeholder: 'What happened?' });
    window.UI.sheet({
      title: user ? 'Report ' + user.displayName : 'Report a problem',
      body: el('div', { class: 'stack-lg' }, [
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Reason' }),
          window.UI.segmented([
            { id: 'abuse', label: 'Abuse' },
            { id: 'spam', label: 'Spam' },
            { id: 'cheating', label: 'Cheating' },
            { id: 'other', label: 'Other' },
          ], 'abuse', function (next) { reason = next; }),
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Details' }), detail]),
      ]),
      actions: [
        { label: 'Cancel', variant: 'text' },
        {
          label: 'Send report',
          variant: 'primary',
          handler: async function () {
            try {
              await window.Api.post('/api/reports', { targetId: user ? user.id : null, targetKind: user ? 'user' : 'general', reason: reason, detail: detail.value.trim() });
              window.UI.toast('Report sent. A moderator will look at it.', { icon: 'check' });
            } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          },
        },
      ],
    });
  }

  /* --------------------------------------------------------------- devices */

  async function pickDevices() {
    var host = el('div', { class: 'stack' });
    window.Dom.append(host, window.UI.spinner(24));
    window.UI.sheet({ title: 'Audio devices', body: host });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) throw new Error('This WebView cannot list audio devices');
      var devices = await navigator.mediaDevices.enumerateDevices();
      var inputs = devices.filter(function (device) { return device.kind === 'audioinput'; });
      var outputs = devices.filter(function (device) { return device.kind === 'audiooutput'; });
      window.Dom.clear(host);
      window.Dom.append(host, [
        el('div', { class: 'section-head' }, [el('h2', { class: 'meta', text: 'MICROPHONE' })]),
        inputs.length
          ? el('div', { class: 'card', style: 'padding:4px' }, [el('div', { class: 'list list--divided' }, inputs.map(function (device, index) {
            return window.UI.row({ title: device.label || 'Microphone ' + (index + 1), sub: device.deviceId.slice(0, 12), avatar: el('span', { class: 'server-card__art', html: icon('mic', 20) }) });
          }))])
          : el('p', { class: 'meta', text: 'No microphone found. Allow the permission and try again.' }),
        el('div', { class: 'section-head', style: 'margin-top:16px' }, [el('h2', { class: 'meta', text: 'OUTPUT' })]),
        outputs.length
          ? el('div', { class: 'card', style: 'padding:4px' }, [el('div', { class: 'list list--divided' }, outputs.map(function (device, index) {
            return window.UI.row({ title: device.label || 'Output ' + (index + 1), sub: device.deviceId.slice(0, 12), avatar: el('span', { class: 'server-card__art', html: icon('headphones', 20) }) });
          }))])
          : el('p', { class: 'meta', text: 'No output devices reported.' }),
      ]);
    } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
    }
  }

  /* ---------------------------------------------------------- local hygiene */

  /**
   * Delete this device's cache. Identities and sessions are kept: those are
   * credentials, not cache.
   */
  async function clearLocalCache() {
    var removed = [];
    try {
      Object.keys(localStorage).forEach(function (key) {
        if (/^oa\.(cache|messages|party|feed|lobby)/.test(key)) {
          localStorage.removeItem(key);
          removed.push(key);
        }
      });
    } catch (err) { /* storage unavailable */ }
    if (window.caches && window.caches.keys) {
      try {
        var keys = await window.caches.keys();
        for (var i = 0; i < keys.length; i += 1) { await window.caches.delete(keys[i]); removed.push(keys[i]); }
      } catch (err) { /* cache API unavailable */ }
    }
    window.RoomKey.forgetAll();
    return removed;
  }

  window.App = {
    boot: boot,
    afterSignIn: afterSignIn,
    signOut: signOut,
    refresh: refresh,
    refreshBadges: refreshBadges,
    createParty: createParty,
    joinParty: joinParty,
    openInviteSheet: openInviteSheet,
    openInvites: openInvites,
    openSearch: openSearch,
    call: call,
    startBroadcast: startBroadcast,
    showMyKey: showMyKey,
    showFingerprints: showFingerprints,
    recoverIdentity: recoverIdentity,
    report: report,
    pickDevices: pickDevices,
    clearLocalCache: clearLocalCache,
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  window.App.boot().catch(function (err) {
    console.error('boot failed', err);
    var host = document.getElementById('app');
    if (host) {
      host.innerHTML = '<div class="screen"><div class="banner banner--error"><span>' +
        window.Icons.svg('warning', 18) + '</span><div class="body">The app could not start: ' +
        window.Dom.esc(err.message || 'unknown error') + '</div></div></div>';
    }
  });
});
