'use strict';
/**
 * Friends, search, and direct chat.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  function friendRow(user, actions) {
    return el('div', { class: 'row' }, [
      window.Dom.avatarNode(user, 44),
      el('button', {
        class: 'row__main',
        style: 'background:none;border:0;text-align:left;padding:0;cursor:pointer',
        onclick: function () { window.Router.go('#/profile/' + user.id); },
      }, [
        el('div', { class: 'row__title', text: user.displayName }),
        el('div', { class: 'row__sub', text: '@' + user.username + ' · ' + (user.presence === 'online' ? 'online' : window.Dom.timeAgo(user.lastSeenAt) + ' ago') }),
      ]),
      el('div', { class: 'row__end' }, (actions || []).map(function (action) {
        return el('button', {
          class: 'icon-btn' + (action.danger ? ' icon-btn--danger' : ''),
          'aria-label': action.label,
          onclick: action.onclick,
        }, [el('span', { html: icon(action.icon, 20) })]);
      })),
    ]);
  }

  async function render(view, params, query, api) {
    api.setTitle([el('span', { html: icon('users', 20) }), el('span', { text: 'Friends' })]);
    api.setActions([
      el('button', { class: 'icon-btn', 'aria-label': 'Blocked players', onclick: openBlocked }, [el('span', { html: icon('ban-circle', 22) })]),
      el('button', { class: 'icon-btn', 'aria-label': 'Find players', onclick: function () { window.App.openSearch(); } }, [el('span', { html: icon('search', 22) })]),
    ]);

    var tab = query.tab || 'friends';
    var data = null;
    var host = el('div', { class: 'list' });

    function tabs() {
      return window.UI.segmented([
        { id: 'friends', label: 'Friends' },
        { id: 'requests', label: 'Requests' },
        { id: 'blocked', label: 'Blocked' },
      ], tab, function (next) { tab = next; window.Router.go('#/friends?tab=' + next, { replace: true }); paint(); });
    }

    async function load() {
      try {
        data = await window.Api.get('/api/friends');
      } catch (err) {
        window.Dom.clear(host);
        window.Dom.append(host, window.UI.banner('error', err.message));
      }
      paint();
    }

    function paint() {
      window.Dom.clear(host);
      if (!data) { window.Dom.append(host, window.UI.skeletonList(4)); return; }
      if (tab === 'friends') {
        var friends = data.friends || [];
        if (!friends.length) {
          window.Dom.append(host, window.UI.empty({
            icon: 'user-plus',
            title: 'No friends yet',
            body: 'Search a player name and send a request. Friends can call you and see when you are online.',
            action: { label: 'Find players', icon: 'search', onclick: function () { window.App.openSearch(); } },
          }));
          return;
        }
        friends.forEach(function (user) {
          host.appendChild(friendRow(user, [
            { label: 'Message', icon: 'chat', onclick: function () { window.Router.go('#/chat/' + user.id); } },
            { label: 'Call', icon: 'phone', onclick: function () { window.App.call(user); } },
            { label: 'More', icon: 'more-v', onclick: function () { openFriendSheet(user); } },
          ]));
        });
        return;
      }
      if (tab === 'requests') {
        var incoming = data.incoming || [];
        var outgoing = data.outgoing || [];
        if (!incoming.length && !outgoing.length) {
          window.Dom.append(host, window.UI.empty({ icon: 'bell', title: 'Nothing pending', body: 'Requests you send and receive land here.' }));
          return;
        }
        if (incoming.length) {
          host.appendChild(el('div', { class: 'section-head', style: 'padding:8px 12px 0' }, [el('h2', { class: 'meta', text: 'INCOMING' })]));
          incoming.forEach(function (user) {
            host.appendChild(friendRow(user, [
              {
                label: 'Accept',
                icon: 'check',
                onclick: async function () {
                  try { await window.Api.post('/api/friends/accept', { userId: user.id }); window.UI.toast(user.displayName + ' is now a friend', { icon: 'check' }); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
                },
              },
              {
                label: 'Decline',
                icon: 'close',
                danger: true,
                onclick: async function () {
                  try { await window.Api.del('/api/friends/' + user.id); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
                },
              },
            ]));
          });
        }
        if (outgoing.length) {
          host.appendChild(el('div', { class: 'section-head', style: 'padding:16px 12px 0' }, [el('h2', { class: 'meta', text: 'SENT' })]));
          outgoing.forEach(function (user) {
            host.appendChild(friendRow(user, [
              {
                label: 'Cancel',
                icon: 'close',
                danger: true,
                onclick: async function () {
                  try { await window.Api.del('/api/friends/' + user.id); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
                },
              },
            ]));
          });
        }
        return;
      }
      window.Dom.append(host, el('p', { class: 'meta', text: 'Loading' }));
      openBlockedInto(host);
    }

    function openFriendSheet(user) {
      window.UI.sheet({
        title: user.displayName,
        body: el('div', { class: 'list' }, [
          sheetAction('View profile', 'user', function () { window.Router.go('#/profile/' + user.id); }),
          sheetAction('Message', 'chat', function () { window.Router.go('#/chat/' + user.id); }),
          sheetAction('Voice call', 'phone', function () { window.App.call(user); }),
          sheetAction('Remove friend', 'trash', async function () {
            var ok = await window.UI.confirmDialog({ title: 'Remove ' + user.displayName + '?', body: 'You can send a new request later.', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            try { await window.Api.del('/api/friends/' + user.id); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          }, true),
          sheetAction('Block', 'ban-circle', async function () {
            var ok = await window.UI.confirmDialog({ title: 'Block ' + user.displayName + '?', body: 'They cannot message, call or join your rooms.', confirmLabel: 'Block', destructive: true });
            if (!ok) return;
            try { await window.Api.post('/api/friends/block', { userId: user.id }); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          }, true),
        ]),
      });
    }

    function sheetAction(label, iconName, handler, danger) {
      return el('button', {
        class: 'row',
        type: 'button',
        onclick: function () { window.UI.closeTopSheet(); handler(); },
      }, [
        el('span', { style: danger ? 'color:var(--err)' : 'color:var(--ink-3)', html: icon(iconName, 20) }),
        el('div', { class: 'row__main' }, [el('div', { class: 'row__title', style: danger ? 'color:var(--err)' : '', text: label })]),
      ]);
    }

    async function openBlockedInto(target) {
      window.Dom.clear(target);
      try {
        var blocked = await window.Api.get('/api/friends/blocked');
        var items = (blocked && blocked.blocked) || [];
        if (!items.length) {
          window.Dom.append(target, window.UI.empty({ icon: 'shield', title: 'Nobody is blocked', body: 'Blocked players cannot message, call, or join your rooms.' }));
          return;
        }
        items.forEach(function (user) {
          target.appendChild(friendRow(user, [
            {
              label: 'Unblock',
              icon: 'refresh',
              onclick: async function () {
                try { await window.Api.del('/api/friends/blocked/' + user.id); window.UI.toast(user.displayName + ' unblocked', { icon: 'check' }); paint(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
              },
            },
          ]));
        });
      } catch (err) {
        window.Dom.append(target, window.UI.banner('error', err.message));
      }
    }

    function openBlocked() {
      tab = 'blocked';
      paint();
    }

    window.Dom.append(view, [tabs(), host]);
    await load();

    var off = window.Socket.on('friend.request', function () { load(); });
    var off2 = window.Socket.on('friend.accepted', function () { load(); });
    var off3 = window.Socket.on('friend.removed', function () { load(); });
    return function () { off(); off2(); off3(); };
  }

  window.Screens = window.Screens || {};
  window.Screens.friends = { render: render };
})();
