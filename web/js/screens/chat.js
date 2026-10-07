'use strict';
/**
 * Direct messages. Sealed and opened on this device; the server stores
 * ciphertext with an AAD bound to the two participants, so a rewritten blob
 * will not open.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  /* ------------------------------------------------------------------ chat - */

  var lastPeer = null;

  async function renderChat(view, params, query, api) {
    var peerId = Number(params.id);
    if (!peerId) { window.Router.go('#/friends'); return; }

    var peer = null;
    var channel = null;
    var items = [];
    var pair = null;
    var chatHost = el('div', { class: 'chat' });
    var input = el('input', { class: 'input', type: 'text', placeholder: 'Encrypted message', maxlength: 900, autocomplete: 'off' });
    var e2eeFlag = el('span', { class: 'e2ee-flag', 'data-state': 'off', html: icon('link-off', 13) + '<span>no key</span>' });

    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Direct message' }),
    ]);
    api.setActions([
      e2eeFlag,
      el('button', { class: 'icon-btn', 'aria-label': 'Call', onclick: function () { if (peer) window.App.call(peer); } }, [el('span', { html: icon('phone', 22) })]),
      el('button', { class: 'icon-btn', 'aria-label': 'Verify key', onclick: showFingerprint }, [el('span', { html: icon('shield', 22) })]),
    ]);
    api.setNavVisible(false);

    window.Dom.append(view, [
      el('div', { class: 'card hrow', id: 'peer-head' }),
      chatHost,
      el('div', { class: 'composer' }, [
        input,
        window.UI.button('Send', { variant: 'tonal', size: 'sm', icon: 'send', onclick: send }),
      ]),
    ]);

    async function load() {
      var profile = await window.Api.get('/api/users/' + peerId);
      peer = profile.user;
      var head = document.getElementById('peer-head');
      window.Dom.clear(head);
      window.Dom.append(head, [
        window.Dom.avatarNode(peer, 44),
        el('div', { class: 'row__main' }, [
          el('div', { class: 'title', text: peer.displayName }),
          el('div', { class: 'row__sub', text: '@' + peer.username + ' · ' + (peer.presence === 'online' ? 'online' : window.Dom.timeAgo(peer.lastSeenAt) + ' ago') }),
        ]),
      ]);

      try {
        var keys = await window.Api.get('/api/keys/user/' + peerId);
        if (keys.identityPublicKey) {
          pair = await window.RoomKey.forDirect(Object.assign({}, peer, keys));
          e2eeFlag.dataset.state = 'on';
          e2eeFlag.innerHTML = icon('lock', 13) + '<span>encrypted</span>';
        } else {
          pair = null;
          e2eeFlag.dataset.state = 'off';
          e2eeFlag.innerHTML = icon('link-off', 13) + '<span>' + peer.username + ' has no key</span>';
        }
      } catch (err) {
        pair = null;
      }

      try {
        var data = await window.Api.get('/api/chat/dm/' + peerId);
        channel = data.channel;
        items = data.messages || [];
      } catch (err) {
        window.Dom.clear(chatHost);
        window.Dom.append(chatHost, window.UI.banner('error', err.message));
        return;
      }
      await paint();
    }

    async function paint() {
      window.Dom.clear(chatHost);
      if (!items.length) {
        window.Dom.append(chatHost, window.UI.empty({
          icon: pair ? 'lock' : 'link-off',
          title: pair ? 'This conversation is end to end encrypted' : 'Encryption is not available yet',
          body: pair ? 'Only the two of you can read these messages. The server stores ciphertext it cannot open.' : peer.displayName + ' has not published an encryption key, so messages cannot be sealed. Ask them to open the app once.',
        }));
        return;
      }
      for (var i = 0; i < items.length; i += 1) window.Dom.append(chatHost, await messageNode(items[i]));
      var scrollRoot = window.Router.scrollRoot();
      if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
    }

    async function messageNode(message) {
      var mine = message.senderId === window.Api.user().id;
      var text = message.plain;
      if (text === undefined) {
        text = await decrypt(message);
        message.plain = text;
      }
      if (message.meta && message.meta.kind === 'system') {
        return el('div', { class: 'msg msg--system' }, [el('div', { class: 'msg__body', text: text })]);
      }
      return el('div', { class: 'msg' + (mine ? ' msg--mine' : '') }, [
        el('div', {}, [
          el('div', { class: 'msg__body', text: text }),
          el('div', { class: 'msg__meta' }, [
            el('span', { class: 'num', text: window.Dom.clockTime(message.createdAt) }),
            el('span', { html: icon(text.indexOf('Unreadable') === 0 ? 'link-off' : 'lock', 11) }),
          ]),
        ]),
      ]);
    }

    async function decrypt(message) {
      if (!pair) return 'Unreadable: no encryption key for this player';
      try {
        var opened = await window.E2EE.open(pair.key, { ciphertext: message.ciphertext, iv: message.iv, tag: message.tag }, 'chat:dm:' + pair.scopeId);
        return opened === null ? 'Unreadable: wrong key or tampered message' : opened;
      } catch (err) {
        return 'Unreadable: ' + err.message;
      }
    }

    async function send() {
      var text = input.value.trim();
      if (!text) return;
      if (!pair) { window.UI.toast('Encryption is not ready for this player', { icon: 'link-off' }); return; }
      input.value = '';
      try {
        var frame = await window.E2EE.seal(pair.key, text, 'chat:dm:' + pair.scopeId);
        var result = await window.Api.post('/api/chat/dm/' + peerId, { ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag, kind: 'text' });
        items.push(result.message);
        chatHost.appendChild(await messageNode(result.message));
        var scrollRoot = window.Router.scrollRoot();
        if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
      } catch (err) {
        input.value = text;
        window.UI.toast(err.message || 'That did not send', { icon: 'warning' });
      }
    }

    async function showFingerprint() {
      try {
        var data = await window.Api.get('/api/keys/fingerprint/' + peerId);
        window.UI.sheet({
          title: 'Verify encryption',
          body: el('div', { class: 'stack-lg' }, [
            el('p', { class: 'body muted', text: 'Compare these two codes with ' + (data.theirsUsername || 'them') + ' over a call or in person. If both match, nobody is reading this conversation in the middle.' }),
            el('div', { class: 'card stack' }, [
              el('div', { class: 'meta', text: 'YOUR KEY' }),
              el('div', { class: 'mono', text: data.mine || 'Not created yet' }),
            ]),
            el('div', { class: 'card stack' }, [
              el('div', { class: 'meta', text: (data.theirsUsername || 'THEIR').toUpperCase() + ' KEY' }),
              el('div', { class: 'mono', text: data.theirs || 'Not created yet' }),
            ]),
            el('div', { class: 'banner' }, [
              el('span', { html: icon('info', 18) }),
              el('div', { class: 'body', text: data.howToVerify }),
            ]),
          ]),
        });
      } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    }

    input.addEventListener('keydown', function (event) { if (event.key === 'Enter') send(); });

    var off = window.Socket.on('message', function (frame) {
      if (frame.scope !== 'dm') return;
      if (Number(frame.peerId) !== peerId && Number(frame.channelId) !== (channel && channel.id)) return;
      var message = frame.message || { ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag, senderId: frame.peerId, createdAt: Date.now() };
      items.push(message);
      messageNode(message).then(function (node) {
        chatHost.appendChild(node);
        var scrollRoot = window.Router.scrollRoot();
        if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
      });
    });

    try { await load(); } catch (err) {
      window.Dom.clear(view);
      window.Dom.append(view, window.UI.banner('error', err.message || 'That player is gone'));
      return function () {};
    }
    lastPeer = peerId;
    return function () { off(); };
  }


  window.Screens = window.Screens || {};
  window.Screens.chat = { routes: { ':id': { render: renderChat } } };
})();
