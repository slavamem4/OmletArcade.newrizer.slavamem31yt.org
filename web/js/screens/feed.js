'use strict';
/**
 * Feed and notifications.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  var KINDS = {
    joined: { icon: 'sparkle', verb: 'joined Omlet Arcade' },
    party_created: { icon: 'users', verb: 'started a party' },
    mc_hosting: { icon: 'cube', verb: 'is hosting a Minecraft world' },
    went_live: { icon: 'radio', verb: 'went live' },
  };

  function feedItem(item, user) {
    var kind = KINDS[item.kind] || { icon: 'sparkle', verb: item.kind };
    var payload = item.payload || {};
    var target = payload.name || payload.title || '';
    return el('div', { class: 'row' }, [
      window.Dom.avatarNode(user, 44),
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: (user.displayName || user.username) + ' ' + kind.verb + (target ? ': ' + target : '') }),
        el('div', { class: 'row__sub', text: window.Dom.timeAgo(item.createdAt) + ' ago' }),
      ]),
      el('span', { style: 'color:var(--ink-3)', html: icon(kind.icon, 18) }),
    ]);
  }

  async function renderFeed(view, params, query, api) {
    api.setTitle([el('span', { html: icon('radio', 20) }), el('span', { text: 'Feed' })]);
    api.setActions([
      el('button', { class: 'icon-btn', 'aria-label': 'Notifications', onclick: function () { window.Router.go('#/notifications'); } }, [el('span', { html: icon('bell', 22) })]),
    ]);

    var host = el('div', { class: 'list' });
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(4));

    async function load() {
      try {
        var results = await Promise.all([
          window.Api.get('/api/feed?limit=30'),
          window.Api.get('/api/friends'),
        ]);
        var items = (results[0] && results[0].items) || [];
        var friends = {};
        ((results[1] && results[1].friends) || []).forEach(function (friend) { friends[friend.id] = friend; });
        var me = window.Api.user();
        friends[me.id] = me;
        window.Dom.clear(host);
        if (!items.length) {
          window.Dom.append(host, window.UI.empty({
            icon: 'radio',
            title: 'Nothing from your friends yet',
            body: 'When a friend starts a party, hosts a world or goes live, it shows up here.',
            action: { label: 'Find friends', icon: 'user-plus', onclick: function () { window.App.openSearch(); } },
          }));
          return;
        }
        items.forEach(function (item) {
          var user = friends[item.userId] || { id: item.userId, username: 'player', displayName: 'A player' };
          host.appendChild(feedItem(item, user));
        });
      } catch (err) {
        window.Dom.clear(host);
        window.Dom.append(host, window.UI.banner('error', err.message));
      }
    }
    await load();
    var timer = setInterval(load, 30000);
    return function () { clearInterval(timer); };
  }

  async function renderNotifications(view, params, query, api) {
    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Notifications' }),
    ]);
    api.setActions([
      window.UI.button('Mark read', { size: 'sm', variant: 'text', onclick: async function () {
        try { await window.Api.post('/api/notifications/read', {}); await load(); window.App.refreshBadges(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
      } }),
    ]);

    var host = el('div', { class: 'list' });
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(4));

    async function load() {
      try {
        var data = await window.Api.get('/api/notifications');
        var items = (data && data.notifications) || [];
        window.Dom.clear(host);
        if (!items.length) {
          window.Dom.append(host, window.UI.empty({ icon: 'bell', title: 'No notifications', body: 'Invites, calls and stream alerts land here.' }));
          return;
        }
        items.forEach(function (item) {
          var label = {
            friend_request: 'Friend request',
            party_invite: 'Party invite',
            call: 'Missed call',
            broadcast: 'A friend went live',
          }[item.kind] || item.kind;
          host.appendChild(el('button', {
            class: 'row',
            type: 'button',
            onclick: function () { open(item); },
          }, [
            el('span', { style: item.readAt ? 'color:var(--ink-3)' : 'color:var(--accent)', html: icon(iconFor(item.kind), 20) }),
            el('div', { class: 'row__main' }, [
              el('div', { class: 'row__title', text: label }),
              el('div', { class: 'row__sub', text: window.Dom.timeAgo(item.createdAt) + ' ago' }),
            ]),
            item.readAt ? null : el('span', { style: 'width:8px;height:8px;border-radius:999px;background:var(--accent)' }),
          ]));
        });
      } catch (err) {
        window.Dom.clear(host);
        window.Dom.append(host, window.UI.banner('error', err.message));
      }
    }

    function iconFor(kind) {
      return { friend_request: 'user-plus', party_invite: 'users', call: 'phone', broadcast: 'radio' }[kind] || 'bell';
    }

    function open(item) {
      var payload = item.payload || {};
      if (item.kind === 'party_invite' && payload.partyId) window.Router.go('#/party/' + payload.partyId);
      else if (item.kind === 'friend_request' && payload.from) window.Router.go('#/profile/' + payload.from);
      else if (item.kind === 'broadcast' && payload.broadcastId) window.Router.go('#/party/' + payload.broadcastId);
      else window.Router.go('#/friends?tab=requests');
    }

    await load();
    return function () {};
  }

  window.Screens = window.Screens || {};
  window.Screens.feed = { render: renderFeed };
  window.Screens.notifications = { render: renderNotifications };
})();
