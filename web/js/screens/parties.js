'use strict';
/**
 * Parties: the list, the room, and the voice controls.
 *
 * The room screen is where the product's mechanism lives: the mic, the roster
 * with speaking state, the chat, and the Minecraft pin all on one screen.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;
  var chatState = {};

  /* ----------------------------------------------------------------- list - */

  function partyRow(party) {
    var label = { party: 'Party', call: 'Call', minecraft: 'Minecraft', broadcast: 'Stream' }[party.kind] || 'Room';
    return el('button', {
      class: 'row',
      type: 'button',
      onclick: function () {
        if (party.isMember) window.Router.go('#/party/' + party.id);
        else window.App.joinParty(party);
      },
    }, [
      el('span', { class: 'server-card__art', html: icon(party.kind === 'minecraft' ? 'cube' : party.kind === 'broadcast' ? 'radio' : 'users', 22) }),
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: party.name }),
        el('div', { class: 'row__sub', text: label + (party.game ? ' · ' + party.game : '') + ' · ' + party.memberCount + '/' + party.maxMembers }),
      ]),
      el('div', { class: 'row__end' }, [
        party.locked ? el('span', { class: 'meta', html: icon('lock', 14) }) : null,
        el('span', { class: 'meta num', text: party.isMember ? 'open' : 'join' }),
      ]),
    ]);
  }

  async function renderList(view, params, query, api) {
    api.setTitle([el('span', { html: icon('users', 20) }), el('span', { text: 'Parties' })]);
    api.setActions([
      el('button', { class: 'icon-btn', 'aria-label': 'Invites', onclick: function () { window.App.openInvites(); } }, [el('span', { html: icon('bell', 22) })]),
      window.UI.button('New', { variant: 'primary', size: 'sm', icon: 'plus', onclick: function () { window.App.createParty(); } }),
    ]);

    var filter = 'all';
    var all = [];

    var listHost = el('div', { class: 'list' });
    var emptyHost = el('div', {});
    var tabs = window.UI.segmented([
      { id: 'all', label: 'All' },
      { id: 'mine', label: 'Yours' },
      { id: 'party', label: 'Parties' },
      { id: 'minecraft', label: 'Minecraft' },
    ], 'all', function (next) { filter = next; paint(); });

    function paint() {
      window.Dom.clear(listHost);
      window.Dom.clear(emptyHost);
      var items = all.filter(function (party) {
        if (filter === 'all') return party.kind !== 'broadcast';
        if (filter === 'mine') return party.isMember;
        return party.kind === filter;
      });
      if (!items.length) {
        window.Dom.append(emptyHost, window.UI.empty({
          icon: 'users',
          title: filter === 'mine' ? 'You are not in a room' : 'Nothing here yet',
          body: 'Rooms you start or join show up in this list.',
          action: { label: 'Start a party', icon: 'plus', onclick: function () { window.App.createParty(); } },
        }));
        return;
      }
      window.Dom.append(listHost, items.map(partyRow));
    }

    window.Dom.append(view, [tabs, listHost, emptyHost]);
    window.Dom.append(listHost, window.UI.skeletonList(4));

    try {
      var data = await window.Api.get('/api/parties?limit=30');
      all = (data && data.parties) || [];
    } catch (err) {
      window.Dom.clear(view);
      window.Dom.append(view, window.UI.banner('error', err.message));
      return;
    }
    paint();

    var off = window.Socket.on('party.updated', function () { refresh(); });
    var offJoin = window.Socket.on('party.member_joined', function () { refresh(); });
    var offLeft = window.Socket.on('party.member_left', function () { refresh(); });
    var timer = setInterval(refresh, 20000);
    var refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        var data = await window.Api.get('/api/parties?limit=30');
        all = (data && data.parties) || [];
        paint();
      } catch (err) { /* keep the current list */ }
      refreshing = false;
    }
    return function () { off(); offJoin(); offLeft(); clearInterval(timer); };
  }

  /* ----------------------------------------------------------------- room - */

  function memberTile(member, speakingId) {
    var tile = el('div', { class: 'voice-tile', 'data-user-id': member.id });
    var avatar = window.Dom.avatarNode(member, 48, false);
    if (speakingId === member.id) avatar.classList.add('avatar--speaking');
    tile.appendChild(avatar);
    tile.appendChild(el('div', { class: 'voice-tile__name', text: member.displayName || member.username }));
    tile.appendChild(el('div', { class: 'voice-tile__state' }, [
      el('span', { class: member.micOn === false ? 'is-off' : '', html: icon(member.micOn === false ? 'mic-off' : 'mic', 14) }),
      member.role === 'owner' || member.role === 'host' ? el('span', { style: 'color:var(--warn)', html: icon('crown', 14) }) : null,
      member.mutedByMod ? el('span', { class: 'is-off', html: icon('ban-circle', 14) }) : null,
    ]));
    return tile;
  }

  async function renderRoom(view, params, query, api) {
    var partyId = Number(params.id);
    if (!partyId) { window.Router.go('#/parties'); return; }

    var party = null;
    var members = [];
    var speakers = {};
    var stage = el('div', { class: 'voice-stage' });
    var chatHost = el('div', { class: 'chat' });
    var composerInput = el('input', { class: 'input', type: 'text', placeholder: 'Encrypted message', maxlength: 900, autocomplete: 'off' });
    var micBtn = el('button', { class: 'mic-btn', 'aria-pressed': 'false', 'aria-label': 'Microphone' }, [el('span', { html: icon('mic', 26) })]);
    var camBtn = el('button', { class: 'mic-btn mic-btn--ghost', 'aria-pressed': 'false', 'aria-label': 'Camera' }, [el('span', { html: icon('video', 22) })]);
    var screenBtn = el('button', { class: 'mic-btn mic-btn--ghost', 'aria-pressed': 'false', 'aria-label': 'Share screen' }, [el('span', { html: icon('screen', 22) })]);
    var endBtn = el('button', { class: 'mic-btn mic-btn--end', 'aria-label': 'Leave room' }, [el('span', { html: icon('logout', 24) })]);
    var e2eeFlag = el('span', { class: 'e2ee-flag', 'data-state': 'off', html: icon('lock', 13) + '<span>connecting</span>' });
    var titleSub = el('span', { class: 'meta' });
    var mcPin = el('div', { class: 'hidden' });

    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', id: 'party-title', text: 'Room' }),
      titleSub,
    ]);
    api.setActions([e2eeFlag, el('button', { class: 'icon-btn', 'aria-label': 'Room options', onclick: openOptions }, [el('span', { html: icon('more-v', 22) })])]);
    api.setNavVisible(false);

    window.Dom.append(view, [
      mcPin,
      el('div', {}, [
        el('div', { class: 'section-head' }, [el('h2', { text: 'In the room' }), el('span', { class: 'meta num', id: 'member-count', text: '' })]),
        stage,
      ]),
      el('div', { class: 'mic-dock' }, [camBtn, micBtn, screenBtn, endBtn]),
      el('div', {}, [
        el('div', { class: 'section-head' }, [el('h2', { text: 'Chat' }), el('span', { class: 'e2ee-flag', html: icon('lock', 13) + '<span>encrypted</span>' })]),
        chatHost,
      ]),
      el('div', { class: 'composer' }, [
        composerInput,
        window.UI.button('Send', { variant: 'tonal', size: 'sm', icon: 'send', onclick: sendMessage }),
      ]),
    ]);

    async function load() {
      var data = await window.Api.get('/api/parties/' + partyId);
      party = data.party;
      var events = data.events || [];
      members = party.members || [];
      paintHead();
      paintStage();
      paintMcPin();
      if (!chatState[partyId]) await loadChat();
      return events;
    }

    function paintHead() {
      var titleNode = document.getElementById('party-title');
      if (titleNode) titleNode.textContent = party.name;
      titleSub.textContent = ' · ' + party.memberCount + '/' + party.maxMembers;
      var count = document.getElementById('member-count');
      if (count) count.textContent = String(party.memberCount);
    }

    function paintStage() {
      window.Dom.clear(stage);
      if (!members.length) {
        window.Dom.append(stage, el('div', { class: 'meta', text: 'Nobody is here yet' }));
        return;
      }
      members.forEach(function (member) {
        stage.appendChild(memberTile(member, speakers[member.id] ? member.id : null));
      });
    }

    function paintMcPin() {
      window.Dom.clear(mcPin);
      if (!party.mcServerId || !party.meta || !party.meta.address) { mcPin.classList.add('hidden'); return; }
      mcPin.classList.remove('hidden');
      var address = party.meta.address + ':' + (party.meta.port || 19132);
      window.Dom.append(mcPin, el('div', { class: 'card hrow' }, [
        el('span', { class: 'server-card__art', html: icon('cube', 22) }),
        el('div', { class: 'row__main' }, [
          el('div', { class: 'row__title', text: 'Minecraft server' }),
          el('div', { class: 'row__sub mono', text: address }),
        ]),
        window.UI.button('Copy', {
          size: 'sm',
          variant: 'tonal',
          icon: 'copy',
          onclick: function () { window.Dom.copy(address).then(function () { window.UI.toast('Address copied', { icon: 'check' }); }); },
        }),
      ]));
    }

    /* ------------------------------------------------------------- voice - */

    async function joinVoice() {
      try {
        var grant = await window.Api.post('/api/parties/' + partyId + '/voice', { publish: true });
        var roomKey = null;
        if (grant.e2ee) {
          var scope = party.kind === 'minecraft' ? 'server' : party.kind === 'broadcast' ? 'broadcast' : 'party';
          try {
            var scoped = await window.RoomKey.ensure(scope, String(party.kind === 'minecraft' && party.mcServerId ? party.mcServerId : partyId));
            roomKey = scoped.keyB64;
            if (scoped.rekeyed) window.UI.toast('New member joined, the media key rotated', { icon: 'key' });
          } catch (err) {
            window.UI.toast('Voice is on, but end-to-end media keys failed: ' + err.message, { icon: 'warning', duration: 6000 });
          }
        }
        await window.Voice.connect(grant, { e2ee: !!grant.e2ee, roomKey: roomKey, mic: true });
        window.Socket.send({ type: 'party.event', partyId: partyId, kind: 'mic_on' });
        setE2ee(!!window.Voice.state().e2ee);
        setMicUi(true);
      } catch (err) {
        window.UI.toast(err.message || 'Voice could not start', { icon: 'warning' });
      }
    }

    function setE2ee(on) {
      e2eeFlag.dataset.state = on ? 'on' : 'off';
      e2eeFlag.innerHTML = icon('lock', 13) + '<span>' + (on ? 'E2EE on' : 'E2EE off') + '</span>';
    }

    function setMicUi(on) {
      micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      micBtn.innerHTML = icon(on ? 'mic' : 'mic-off', 26);
    }

    micBtn.addEventListener('click', async function () {
      if (!window.Voice.state().connected) { await joinVoice(); return; }
      var next = !window.Voice.state().micEnabled;
      await window.Voice.setMic(next);
      setMicUi(next);
      window.Socket.send({ type: 'party.event', partyId: partyId, kind: next ? 'mic_on' : 'mic_off' });
    });

    camBtn.addEventListener('click', async function () {
      try {
        if (!window.Voice.state().connected) await joinVoice();
        var next = !window.Voice.state().cameraEnabled;
        await window.Voice.setCamera(next);
        camBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      } catch (err) { window.UI.toast(err.message || 'Camera unavailable', { icon: 'warning' }); }
    });

    screenBtn.addEventListener('click', async function () {
      try {
        if (!window.Voice.state().connected) await joinVoice();
        var next = await window.Voice.toggleScreen();
        screenBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      } catch (err) { window.UI.toast(err.message || 'Screen capture unavailable', { icon: 'warning' }); }
    });

    endBtn.addEventListener('click', async function () {
      await leave();
    });

    async function leave() {
      try {
        await window.Api.post('/api/parties/' + partyId + '/leave', {});
      } catch (err) { /* leaving anyway */ }
      await window.Voice.disconnect();
      window.Socket.send({ type: 'party.event', partyId: partyId, kind: 'mic_off' });
      window.Router.go('#/parties');
    }

    function openOptions() {
      var actions = [
        { label: 'Invite friends', variant: 'tonal', handler: function () { window.App.openInviteSheet(partyId); } },
        { label: 'Copy invite code', handler: function () { window.Dom.copy(party.code).then(function () { window.UI.toast('Code ' + party.code + ' copied', { icon: 'check' }); }); } },
      ];
      if (party.isOwner) {
        actions.push({ label: 'Rotate the media key', handler: rotateKey });
        actions.push({ label: party.locked ? 'Open to everyone' : 'Make it invite only', handler: toggleLock });
        actions.push({ label: 'Rename room', handler: rename });
        actions.push({ label: 'Close room', variant: 'danger', handler: closeRoom });
      } else {
        actions.push({ label: 'Leave room', variant: 'danger', handler: leave });
      }
      window.UI.sheet({
        title: party.name,
        body: el('div', { class: 'list' }, actions.map(function (action) {
          return el('button', {
            class: 'row',
            type: 'button',
            onclick: function () { window.UI.closeTopSheet(); action.handler(); },
          }, [el('div', { class: 'row__main' }, [el('div', { class: 'row__title', style: action.variant === 'danger' ? 'color:var(--err)' : '', text: action.label })])]);
        })),
      });
    }

    async function rotateKey() {
      var next = await window.Voice.rotateKey();
      if (!next) { window.UI.toast('Media encryption is not active', { icon: 'warning' }); return; }
      var scope = party.kind === 'minecraft' ? 'server' : party.kind === 'broadcast' ? 'broadcast' : 'party';
      window.RoomKey.forget(scope, String(party.mcServerId || partyId));
      var scoped = await window.RoomKey.ensure(scope, String(party.mcServerId || partyId), { force: true });
      window.UI.toast('Media key rotated for ' + (scoped.wrappedFor || 0) + ' members', { icon: 'key' });
    }

    async function toggleLock() {
      try {
        await window.Api.patch('/api/parties/' + partyId, { locked: !party.locked });
        window.UI.toast(party.locked ? 'Room is open to everyone' : 'Room is invite only', { icon: 'lock' });
        await load();
      } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    }

    async function rename() {
      var name = await window.UI.promptDialog({ title: 'Rename room', label: 'Room name', value: party.name, required: true, maxlength: 48 });
      if (!name) return;
      try { await window.Api.patch('/api/parties/' + partyId, { name: name }); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    }

    async function closeRoom() {
      var ok = await window.UI.confirmDialog({ title: 'Close the room?', body: 'Everyone is disconnected and the room disappears from the lobby.', confirmLabel: 'Close room', destructive: true });
      if (!ok) return;
      try {
        await window.Api.del('/api/parties/' + partyId);
        await window.Voice.disconnect();
        window.Router.go('#/parties');
      } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    }

    /* -------------------------------------------------------------- chat - */

    async function loadChat() {
      try {
        var data = await window.Api.get('/api/chat/party/' + partyId);
        chatState[partyId] = { channelId: data.channel.id, items: data.messages || [] };
        await paintChat();
      } catch (err) {
        chatState[partyId] = { channelId: null, items: [], error: err.message };
      }
    }

    async function paintChat() {
      var state = chatState[partyId] || { items: [] };
      window.Dom.clear(chatHost);
      if (state.error) {
        window.Dom.append(chatHost, window.UI.banner('error', state.error));
        return;
      }
      if (!state.items.length) {
        window.Dom.append(chatHost, el('p', { class: 'meta', text: 'No messages yet. Everything you send is sealed on this device.' }));
        return;
      }
      for (var i = 0; i < state.items.length; i += 1) {
        window.Dom.append(chatHost, await renderMessage(state.items[i]));
      }
      var scrollRoot = window.Router.scrollRoot();
      if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
    }

    async function renderMessage(message) {
      if (message.meta && message.meta.kind === 'system') {
        return el('div', { class: 'msg msg--system' }, [el('div', { class: 'msg__body', text: message.plain || 'System message' })]);
      }
      var mine = message.senderId === window.Api.user().id;
      var text = message.plain;
      if (text === undefined) {
        text = await decryptMessage(message);
        message.plain = text;
      }
      return el('div', { class: 'msg' + (mine ? ' msg--mine' : '') }, [
        mine ? null : window.Dom.avatarNode(message.sender || {}, 28, false),
        el('div', {}, [
          el('div', { class: 'msg__body', text: text }),
          el('div', { class: 'msg__meta' }, [
            mine ? null : el('span', { text: (message.sender && message.sender.displayName) || 'Unknown' }),
            el('span', { class: 'num', text: window.Dom.clockTime(message.createdAt) }),
            el('span', { html: icon(message.plain && message.plain.indexOf('Unreadable') === 0 ? 'link-off' : 'lock', 11) }),
          ]),
        ]),
      ]);
    }

    async function decryptMessage(message) {
      try {
        var scope = party.kind === 'minecraft' ? 'server' : party.kind === 'broadcast' ? 'broadcast' : 'party';
        var scoped = await window.RoomKey.ensure(scope, String(party.mcServerId || partyId));
        var key = await window.E2EE.aesKeyFromBytes(window.E2EE.b64ToBytes(scoped.keyB64));
        var opened = await window.E2EE.open(key, { ciphertext: message.ciphertext, iv: message.iv, tag: message.tag }, 'chat:party:' + partyId);
        if (opened === null) return 'Unreadable with the current key';
        return opened;
      } catch (err) {
        return 'Unreadable with the current key';
      }
    }

    async function sendMessage() {
      var text = composerInput.value.trim();
      if (!text) return;
      if (!chatState[partyId] || !chatState[partyId].channelId) await loadChat();
      var channelId = chatState[partyId] && chatState[partyId].channelId;
      if (!channelId) { window.UI.toast('Chat is not ready yet', { icon: 'warning' }); return; }
      composerInput.value = '';
      try {
        var scope = party.kind === 'minecraft' ? 'server' : party.kind === 'broadcast' ? 'broadcast' : 'party';
        var scoped = await window.RoomKey.ensure(scope, String(party.mcServerId || partyId));
        var key = await window.E2EE.aesKeyFromBytes(window.E2EE.b64ToBytes(scoped.keyB64));
        var frame = await window.E2EE.seal(key, text, 'chat:party:' + partyId);
        await window.Api.post('/api/chat/party/' + partyId, { ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag, kind: 'text' });
      } catch (err) {
        composerInput.value = text;
        window.UI.toast(err.message || 'That message did not send', { icon: 'warning' });
      }
    }

    composerInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') sendMessage(); });

    /* ------------------------------------------------------- socket wiring - */

    var offMessage = window.Socket.on('message', function (frame) {
      if (frame.scope !== 'party' && frame.scope !== 'lobby') return;
      var state = chatState[partyId];
      if (!state || (frame.channelId && state.channelId && frame.channelId !== state.channelId)) return;
      var message = frame.message || { ciphertext: frame.ciphertext, iv: frame.iv, tag: frame.tag, senderId: frame.from, createdAt: Date.now(), sender: { id: frame.from } };
      state.items.push(message);
      if (state.items.length > 200) state.items.shift();
      renderMessage(message).then(function (node) {
        chatHost.appendChild(node);
        var scrollRoot = window.Router.scrollRoot();
        if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
      });
    });

    var offSpeaking = window.Socket.on('voice.speaking', function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      if (frame.active) speakers[frame.userId] = Date.now();
      else delete speakers[frame.userId];
      paintStage();
    });

    var offRoster = window.Voice.on('roster', function (roster) {
      var byId = {};
      roster.forEach(function (entry) { if (entry.userId) byId[entry.userId] = entry; });
      members.forEach(function (member) {
        var live = byId[member.id];
        member.micOn = live ? live.micOn : false;
      });
      paintStage();
    });

    var offSpeakers = window.Voice.on('speakers', function (list) {
      speakers = {};
      list.forEach(function (entry) { if (entry.userId) speakers[entry.userId] = Date.now(); });
      paintStage();
    });

    var offClosed = window.Socket.on('party.closed', function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      window.Voice.disconnect();
      window.UI.toast('The room was closed', { icon: 'info' });
      window.Router.go('#/parties');
    });

    var offKicked = window.Socket.on('party.kicked', function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      window.Voice.disconnect();
      window.UI.toast('The host removed you from the room', { icon: 'warning' });
      window.Router.go('#/parties');
    });

    var offJoined = window.Socket.on('party.member_joined', async function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      await load();
    });
    var offLeft = window.Socket.on('party.member_left', async function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      await load();
    });
    var offMuted = window.Socket.on('voice.muted', async function (frame) {
      if (Number(frame.partyId) !== partyId) return;
      if (frame.muted) {
        await window.Voice.setMic(false);
        setMicUi(false);
        window.UI.toast('A moderator muted you', { icon: 'mic-off' });
      } else {
        window.UI.toast('You can speak again', { icon: 'mic' });
      }
    });

    try {
      await load();
    } catch (err) {
      window.Dom.clear(view);
      window.Dom.append(view, window.UI.banner('error', err.message || 'That room is gone'));
      return function () {};
    }

    if (!party.isMember) {
      try { await window.Api.post('/api/parties/' + partyId + '/join', {}); await load(); } catch (err) { /* the join sheet handles this */ }
    }

    if (party.kind === 'broadcast' && !party.isOwner) {
      // A viewer subscribes only; the grant from the server enforces it.
      try {
        await window.Api.post('/api/broadcasts/' + partyId + '/join', {});
        var viewerGrant = await window.Api.post('/api/broadcasts/' + partyId + '/token', {});
        await window.Voice.connect(viewerGrant, { e2ee: !!viewerGrant.e2ee, mic: false });
        setMicUi(false);
        micBtn.disabled = true;
        camBtn.disabled = true;
        screenBtn.disabled = true;
        setE2ee(!!window.Voice.state().e2ee);
      } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    } else {
      await joinVoice();
    }

    return function () {
      offMessage(); offSpeaking(); offRoster(); offSpeakers(); offClosed(); offKicked(); offJoined(); offLeft(); offMuted();
      window.Voice.disconnect();
      chatState = {};
    };
  }

  window.Screens = window.Screens || {};
  window.Screens.parties = { paramNames: [], render: renderList };
  window.Screens.party = { paramNames: ['id'], render: renderRoom };
})();
