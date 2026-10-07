'use strict';
/**
 * Profile (yours and other players') and settings.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  async function renderMine(view, params, query, api) {
    api.setTitle([el('span', { html: icon('user', 20) }), el('span', { text: 'You' })]);
    api.setActions([
      el('button', { class: 'icon-btn', 'aria-label': 'Notifications', onclick: function () { window.Router.go('#/notifications'); } }, [el('span', { html: icon('bell', 22) })]),
      el('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: function () { window.Router.go('#/settings'); } }, [el('span', { html: icon('settings', 22) })]),
    ]);

    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(3));

    async function load() {
      var data = await window.Api.get('/api/users/me');
      var user = data.user;
      window.Api.setUser(user);
      var stats = null;
      try { stats = await window.Api.get('/api/users/me/stats'); } catch (err) { stats = null; }
      paint(user, data.settings, stats);
    }

    function paint(user, settings, stats) {
      var xpInLevel = user.xp % 500;
      window.Dom.clear(host);

      var head = el('div', { class: 'profile-head' });
      head.appendChild(window.Dom.avatarNode(user, 96));
      head.appendChild(el('div', { class: 'stack', style: 'gap:2px;align-items:center' }, [
        el('div', { class: 'headline', text: user.displayName }),
        el('div', { class: 'meta', text: '@' + user.username + ' · level ' + user.level }),
      ]));
      head.appendChild(el('div', { class: 'progress', style: 'width:100%' }, [
        el('div', { class: 'progress__fill', style: 'width:' + Math.round((xpInLevel / 500) * 100) + '%' }),
      ]));
      head.appendChild(el('div', { class: 'meta num', text: xpInLevel + ' / 500 XP to level ' + (user.level + 1) }));
      head.appendChild(el('div', { class: 'hrow', style: 'gap:8px' }, [
        window.UI.button('Edit profile', { size: 'sm', variant: 'tonal', icon: 'edit', onclick: editSheet }),
        window.UI.button('Share', { size: 'sm', variant: 'text', icon: 'share', onclick: shareProfile }),
      ]));
      host.appendChild(head);

      host.appendChild(el('div', { class: 'profile-stats' }, [
        el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(stats ? stats.friends : 0) }), el('span', { class: 'stat__label', text: 'Friends' })]),
        el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(stats ? stats.parties : 0) }), el('span', { class: 'stat__label', text: 'Rooms' })]),
        el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(stats ? stats.servers : 0) }), el('span', { class: 'stat__label', text: 'Servers' })]),
      ]));

      host.appendChild(el('div', { class: 'card stack' }, [
        el('div', { class: 'section-head' }, [el('h2', { text: 'Encryption' })]),
        el('div', { class: 'hrow' }, [
          el('span', { style: 'color:' + (user.hasIdentityKey ? 'var(--ok)' : 'var(--warn)'), html: icon(user.hasIdentityKey ? 'shield' : 'key', 20) }),
          el('div', { class: 'row__main' }, [
            el('div', { class: 'row__title', text: user.hasIdentityKey ? 'End to end encryption is on' : 'No key on this device yet' }),
            el('div', { class: 'row__sub', text: user.hasIdentityKey ? 'X25519 agreement, AES-256-GCM. The server holds ciphertext only.' : 'Open any chat once to create it.' }),
          ]),
        ]),
        window.UI.button(user.hasIdentityKey ? 'View safety number' : 'Create my key', {
          size: 'sm',
          variant: 'tonal',
          icon: 'key',
          onclick: function () { window.App.showMyKey(); },
        }),
      ]));

      host.appendChild(el('div', { class: 'list' }, [
        window.UI.setting('Friends', String(stats ? stats.friends : 0), { icon: 'users', onclick: function () { window.Router.go('#/friends'); } }),
        window.UI.setting('Minecraft servers', String(stats ? stats.servers : 0), { icon: 'cube', onclick: function () { window.Router.go('#/minecraft'); } }),
        window.UI.setting('Blocked players', '', { icon: 'ban-circle', onclick: function () { window.Router.go('#/friends?tab=blocked'); } }),
        window.UI.setting('Signed-in devices', String(stats ? stats.sessions : 0), { icon: 'wifi', onclick: function () { window.Router.go('#/settings/sessions'); } }),
        window.UI.setting('Settings and privacy', '', { icon: 'settings', onclick: function () { window.Router.go('#/settings'); } }),
      ]));
    }

    function editSheet() {
      var user = window.Api.user();
      var displayName = el('input', { class: 'input', value: user.displayName, maxlength: 32 });
      var bio = el('textarea', { class: 'textarea', maxlength: 160, placeholder: 'What are you playing?' });
      bio.value = user.bio || '';
      window.UI.sheet({
        title: 'Edit profile',
        body: el('div', { class: 'stack-lg' }, [
          el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Display name' }), displayName]),
          el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'About you' }), bio, el('span', { class: 'field__hint', text: '160 characters. No emoji: the app uses drawn icons.' })]),
        ]),
        actions: [
          { label: 'Cancel', variant: 'text' },
          {
            label: 'Save',
            variant: 'primary',
            handler: async function () {
              try {
                var result = await window.Api.patch('/api/users/me', { displayName: displayName.value.trim(), bio: bio.value.trim() });
                window.Api.setUser(result.user);
                window.UI.closeTopSheet();
                window.UI.toast('Profile saved', { icon: 'check' });
                load();
              } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
            },
          },
        ],
      });
    }

    function shareProfile() {
      var user = window.Api.user();
      var text = user.displayName + ' on Omlet Arcade — @' + user.username;
      if (navigator.share) {
        navigator.share({ title: 'Omlet Arcade', text: text }).catch(function () { window.Dom.copy(text); });
      } else {
        window.Dom.copy(text).then(function () { window.UI.toast('Profile copied', { icon: 'copy' }); });
      }
    }

    try { await load(); } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
      return function () {};
    }
    return function () {};
  }

  async function renderOther(view, params, query, api) {
    var id = Number(params.id);
    if (!id) { window.Router.go('#/profile'); return; }
    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Player' }),
    ]);
    api.setNavVisible(false);

    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(2));

    try {
      var data = await window.Api.get('/api/users/' + id);
      var user = data.user;
      var relationship = data.relationship;
      window.Dom.clear(host);

      var head = el('div', { class: 'profile-head' });
      head.appendChild(window.Dom.avatarNode(user, 96));
      head.appendChild(el('div', { class: 'stack', style: 'gap:2px;align-items:center' }, [
        el('div', { class: 'headline', text: user.displayName }),
        el('div', { class: 'meta', text: '@' + user.username + ' · level ' + user.level + ' · ' + (user.presence === 'online' ? 'online' : window.Dom.timeAgo(user.lastSeenAt) + ' ago') }),
      ]));
      if (user.bio) head.appendChild(el('p', { class: 'body muted', style: 'max-width:36ch', text: user.bio }));
      host.appendChild(head);

      var actions = el('div', { class: 'hrow', style: 'gap:8px;flex-wrap:wrap' });
      if (relationship === 'accepted') {
        actions.appendChild(window.UI.button('Message', { variant: 'primary', icon: 'chat', onclick: function () { window.Router.go('#/chat/' + user.id); } }));
        actions.appendChild(window.UI.button('Call', { variant: 'tonal', icon: 'phone', onclick: function () { window.App.call(user); } }));
        actions.appendChild(window.UI.button('Remove', { variant: 'text', onclick: async function () {
          var ok = await window.UI.confirmDialog({ title: 'Remove ' + user.displayName + '?', confirmLabel: 'Remove', destructive: true });
          if (!ok) return;
          try { await window.Api.del('/api/friends/' + user.id); window.Router.go('#/friends'); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }));
      } else if (relationship === 'pending_outgoing') {
        actions.appendChild(window.UI.button('Request sent', { variant: 'tonal', disabled: true }));
      } else if (relationship === 'pending_incoming') {
        actions.appendChild(window.UI.button('Accept request', { variant: 'primary', icon: 'check', onclick: async function () {
          try { await window.Api.post('/api/friends/accept', { userId: user.id }); window.UI.toast('You are friends now', { icon: 'check' }); window.Router.go('#/profile/' + user.id, { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }));
      } else if (relationship === 'blocked') {
        actions.appendChild(window.UI.button('Unblock', { variant: 'tonal', onclick: async function () {
          try { await window.Api.del('/api/friends/blocked/' + user.id); window.Router.go('#/profile/' + user.id, { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }));
      } else {
        actions.appendChild(window.UI.button('Add friend', { variant: 'primary', icon: 'user-plus', onclick: async function () {
          try { await window.Api.post('/api/friends/request', { userId: user.id }); window.UI.toast('Request sent', { icon: 'check' }); window.Router.go('#/profile/' + user.id, { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }));
        actions.appendChild(window.UI.button('Block', { variant: 'text', onclick: async function () {
          var ok = await window.UI.confirmDialog({ title: 'Block ' + user.displayName + '?', body: 'They cannot message, call, or join your rooms.', confirmLabel: 'Block', destructive: true });
          if (!ok) return;
          try { await window.Api.post('/api/friends/block', { userId: user.id }); window.Router.go('#/profile/' + user.id, { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }));
      }
      host.appendChild(actions);

      if (data.inParty) {
        host.appendChild(el('div', { class: 'banner banner--ok' }, [
          el('span', { html: icon('users', 18) }),
          el('div', { class: 'body', text: user.displayName + ' is in ' + data.inParty.name }),
        ]));
      }

      host.appendChild(el('div', { class: 'list' }, [
        window.UI.setting('Verify encryption', user.e2eeEnabled ? 'key available' : 'no key', { icon: 'shield', onclick: async function () {
          try {
            var keys = await window.Api.get('/api/keys/fingerprint/' + user.id);
            window.App.showFingerprints(keys);
          } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        } }),
        window.UI.setting('Report player', '', { icon: 'flag', onclick: function () { window.App.report(user); } }),
      ]));

      try {
        var friendList = await window.Api.get('/api/users/' + user.id + '/friends');
        var friends = (friendList && friendList.friends) || [];
        if (friends.length) {
          host.appendChild(el('div', {}, [
            el('div', { class: 'section-head' }, [el('h2', { text: 'Friends' }), el('span', { class: 'meta num', text: String(friends.length) })]),
            el('div', { class: 'list' }, friends.slice(0, 10).map(function (friend) {
              return window.UI.row({
                title: friend.displayName,
                sub: '@' + friend.username,
                avatar: window.Dom.avatarNode(friend, 40),
                onclick: function () { window.Router.go('#/profile/' + friend.id); },
              });
            })),
          ]));
        }
      } catch (err) { /* private friend list */ }
    } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
    }
    return function () {};
  }

  window.Screens = window.Screens || {};
  window.Screens.profile = { render: renderMine, routes: { ':id': { render: renderOther } } };
})();
