'use strict';
/**
 * Lobby: what is happening right now, and the shortest path into it.
 */
(function () {
  var el = window.Dom.el;
  var esc = window.Dom.esc;
  var icon = window.Icons.svg;

  function nowCard(party) {
    if (!party) {
      return el('div', { class: 'card stack' }, [
        el('div', { class: 'hrow' }, [
          el('span', { style: 'color:var(--accent)', html: icon('radio', 22) }),
          el('div', { class: 'row__main' }, [
            el('div', { class: 'title', text: 'You are not in a room' }),
            el('div', { class: 'row__sub', text: 'Join a party or start your own to open the mic' }),
          ]),
        ]),
        el('div', { class: 'hrow', style: 'gap:8px' }, [
          window.UI.button('Start a party', { variant: 'primary', onclick: function () { window.App.createParty(); } }),
          window.UI.button('Browse', { variant: 'tonal', onclick: function () { window.Router.go('#/parties'); } }),
        ]),
      ]);
    }
    var kindLabel = { party: 'Party', call: 'Call', minecraft: 'Minecraft', broadcast: 'Stream' }[party.kind] || 'Room';
    return el('div', { class: 'card stack' }, [
      el('div', { class: 'hrow' }, [
        el('span', { style: 'color:var(--live)', html: icon(party.kind === 'broadcast' ? 'radio' : party.kind === 'minecraft' ? 'cube' : 'users', 22) }),
        el('div', { class: 'row__main' }, [
          el('div', { class: 'title', text: party.name }),
          el('div', { class: 'row__sub', text: kindLabel + ' · ' + party.memberCount + ' in' + (party.game ? ' · ' + party.game : '') }),
        ]),
        el('span', { class: 'status-pill', 'data-state': 'running', text: 'LIVE' }),
      ]),
      el('div', { class: 'hrow', style: 'gap:8px' }, [
        window.UI.button('Open room', { variant: 'primary', onclick: function () { window.Router.go('#/party/' + party.id); } }),
        window.UI.button('Leave', {
          variant: 'text',
          onclick: async function () {
            try {
              await window.Api.post('/api/parties/' + party.id + '/leave', {});
              window.Voice.disconnect();
              window.UI.toast('Left ' + party.name, { icon: 'check' });
              window.App.refresh();
            } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          },
        }),
      ]),
    ]);
  }

  function partyCard(party) {
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
        party.e2ee ? el('span', { class: 'e2ee-flag', html: icon('lock', 13) + '<span>E2EE</span>' }) : null,
        el('span', { class: 'meta num', text: party.locked ? 'invite only' : 'join' }),
      ]),
    ]);
  }

  function streamCard(item) {
    return el('button', {
      class: 'stream-card',
      type: 'button',
      style: 'width:100%;text-align:left;border:1px solid var(--line-soft);cursor:pointer',
      onclick: function () { window.Router.go('#/party/' + item.id); },
    }, [
      el('div', { class: 'stream-card__thumb' }, [
        el('span', { class: 'stream-card__live', text: 'LIVE' }),
        el('span', { html: icon('radio', 32) }),
      ]),
      el('div', { class: 'stream-card__body' }, [
        window.Dom.avatarNode(item.streamer, 36),
        el('div', { class: 'row__main' }, [
          el('div', { class: 'row__title', text: item.title }),
          el('div', { class: 'row__sub', text: item.streamer.username + (item.game ? ' · ' + item.game : '') }),
        ]),
        el('span', { class: 'meta num', text: item.viewers + ' watching' }),
      ]),
    ]);
  }

  async function render(view, params, query, api) {
    api.setTitle([el('span', { style: 'color:var(--accent)', html: icon('gamepad', 22) }), el('span', { text: 'Lobby' })]);
    api.setActions([
      el('button', { class: 'icon-btn', 'aria-label': 'Search players', onclick: function () { window.App.openSearch(); } }, [el('span', { html: icon('search', 22) })]),
      el('button', { class: 'icon-btn', 'aria-label': 'Notifications', onclick: function () { window.Router.go('#/notifications'); } }, [el('span', { html: icon('bell', 22) })]),
    ]);

    var skeleton = window.UI.skeletonList(3);
    window.Dom.append(view, skeleton);

    var me = window.Api.user();
    var parties = [];
    var streams = [];
    var friends = [];
    var myParty = null;
    try {
      var results = await Promise.all([
        window.Api.get('/api/parties?limit=24'),
        window.Api.get('/api/broadcasts'),
        window.Api.get('/api/friends'),
      ]);
      parties = (results[0] && results[0].parties) || [];
      streams = (results[1] && results[1].broadcasts) || [];
      friends = (results[2] && results[2].friends) || [];
      myParty = parties.filter(function (party) { return party.isMember && party.kind !== 'broadcast'; })[0] || null;
    } catch (err) {
      window.Dom.clear(view);
      window.Dom.append(view, window.UI.banner('error', err.message || 'The lobby could not load'));
      return;
    }

    window.Dom.clear(view);

    var invites = [];
    try {
      var inviteData = await window.Api.get('/api/parties/invites');
      invites = (inviteData && inviteData.invites) || [];
    } catch (err) { invites = []; }

    window.Dom.append(view, nowCard(myParty));

    if (invites.length) {
      var inviteHost = el('div', { class: 'stack' });
      invites.slice(0, 4).forEach(function (invite) {
        inviteHost.appendChild(window.UI.row({
          title: invite.inviter.displayName + ' invited you',
          sub: invite.partyName + ' · ' + window.Dom.timeAgo(invite.createdAt) + ' ago',
          avatar: window.Dom.avatarNode(invite.inviter, 40),
          end: [
            window.UI.button('Join', {
              size: 'sm',
              variant: 'primary',
              onclick: function () { window.App.joinParty({ id: invite.partyId, name: invite.partyName, kind: invite.partyKind }, { inviteId: invite.id }); },
            }),
          ],
        }));
      });
      window.Dom.append(view, el('div', {}, [
        el('div', { class: 'section-head' }, [el('h2', { text: 'Invites' }), el('span', { class: 'meta num', text: String(invites.length) })]),
        inviteHost,
      ]));
    }

    var online = friends.filter(function (friend) { return friend.presence === 'online'; });
    if (online.length) {
      var strip = el('div', { class: 'hrow', style: 'gap:12px;overflow-x:auto;padding-bottom:4px' });
      online.slice(0, 12).forEach(function (friend) {
        strip.appendChild(el('button', {
          class: 'stack',
          style: 'align-items:center;gap:6px;background:none;border:0;cursor:pointer;min-width:64px',
          onclick: function () { window.Router.go('#/chat/' + friend.id); },
        }, [
          window.Dom.avatarNode(friend, 48),
          el('span', { class: 'meta', text: friend.displayName.slice(0, 10) }),
        ]));
      });
      window.Dom.append(view, el('div', {}, [
        el('div', { class: 'section-head' }, [
          el('h2', { text: 'Online now' }),
          el('a', { href: '#/friends', class: 'meta', style: 'color:var(--accent);text-decoration:none', text: 'All friends' }),
        ]),
        strip,
      ]));
    }

    var liveParties = parties.filter(function (party) { return party.kind === 'party' || party.kind === 'minecraft'; });
    window.Dom.append(view, el('div', {}, [
      el('div', { class: 'section-head' }, [
        el('h2', { text: 'Open rooms' }),
        el('button', { class: 'btn btn--text btn--sm', onclick: function () { window.Router.go('#/parties'); } }, [el('span', { text: 'See all' }), el('span', { html: icon('chevron-right', 16) })]),
      ]),
      liveParties.length
        ? el('div', { class: 'list' }, liveParties.slice(0, 6).map(partyCard))
        : window.UI.empty({ icon: 'users', title: 'No rooms are open', body: 'Start one and your friends will see it here.', action: { label: 'Start a party', icon: 'plus', onclick: function () { window.App.createParty(); } } }),
    ]));

    if (streams.length) {
      window.Dom.append(view, el('div', {}, [
        el('div', { class: 'section-head' }, [
          el('h2', { text: 'Live now' }),
          el('a', { href: '#/streams', class: 'meta', style: 'color:var(--accent);text-decoration:none', text: 'All streams' }),
        ]),
        el('div', { class: 'stack' }, streams.slice(0, 3).map(streamCard)),
      ]));
    }

    window.Dom.append(view, el('div', { class: 'stack', style: 'padding-top:8px' }, [
      el('button', {
        class: 'row',
        type: 'button',
        onclick: function () { window.Router.go('#/streams'); },
      }, [
        el('span', { style: 'color:var(--err)', html: icon('radio', 20) }),
        el('div', { class: 'row__main' }, [el('div', { class: 'row__title', text: 'Go live' }), el('div', { class: 'row__sub', text: 'Share your screen and mic with your friends' })]),
        el('span', { html: icon('chevron-right', 18) }),
      ]),
      el('button', {
        class: 'row',
        type: 'button',
        onclick: function () { window.Router.go('#/minecraft'); },
      }, [
        el('span', { style: 'color:var(--accent)', html: icon('cube', 20) }),
        el('div', { class: 'row__main' }, [el('div', { class: 'row__title', text: 'Minecraft hosting' }), el('div', { class: 'row__sub', text: 'Run a world for your crew with voice attached' })]),
        el('span', { html: icon('chevron-right', 18) }),
      ]),
    ]));
  }

  window.Screens = window.Screens || {};
  window.Screens.home = { paramNames: [], render: render };

  window.Screens.streams = {
    paramNames: [],
    render: async function (view, params, query, api) {
      api.setTitle([el('span', { html: icon('radio', 20) }), el('span', { text: 'Live streams' })]);
      api.setActions([
        window.UI.button('Go live', { variant: 'primary', size: 'sm', icon: 'radio', onclick: function () { window.App.startBroadcast(); } }),
      ]);
      window.Dom.append(view, window.UI.skeletonList(3));
      var data = await window.Api.get('/api/broadcasts');
      var items = (data && data.broadcasts) || [];
      window.Dom.clear(view);
      if (!items.length) {
        window.Dom.append(view, window.UI.empty({
          icon: 'radio',
          title: 'Nobody is streaming',
          body: 'Share your screen and mic, and your friends get a notification.',
          action: { label: 'Go live', icon: 'radio', onclick: function () { window.App.startBroadcast(); } },
        }));
        return;
      }
      window.Dom.append(view, el('div', { class: 'stack' }, items.map(streamCard)));
    },
  };
})();
