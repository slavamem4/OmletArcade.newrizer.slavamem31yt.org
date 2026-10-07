'use strict';
/**
 * Minecraft hosting.
 *
 * The app owns the registry and the voice room; the game server runs on the
 * host's own machine using the hardened pack this screen hands out.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  function serverCard(server) {
    var address = server.address + ':' + server.port;
    var mine = server.ownerId === window.Api.user().id;
    return el('div', { class: 'server-card' }, [
      el('span', { class: 'server-card__art', html: icon('cube', 24) }),
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: server.name }),
        el('div', { class: 'row__sub', text: (server.edition === 'java' ? 'Java' : 'Bedrock') + ' · ' + server.maxPlayers + ' slots · ' + server.inWorld + ' in world' }),
        el('div', { class: 'row__sub mono', text: address }),
      ]),
      el('div', { class: 'stack', style: 'gap:6px;align-items:flex-end' }, [
        el('span', { class: 'status-pill', 'data-state': server.status, text: server.status.toUpperCase() }),
        window.UI.button(mine ? 'Manage' : 'Join', {
          size: 'sm',
          variant: mine ? 'tonal' : 'primary',
          onclick: function () { window.Router.go('#/minecraft/' + server.id); },
        }),
      ]),
    ]);
  }

  async function renderList(view, params, query, api) {
    api.setTitle([el('span', { html: icon('cube', 20) }), el('span', { text: 'Minecraft' })]);
    api.setActions([
      window.UI.button('Host', { variant: 'primary', size: 'sm', icon: 'plus', onclick: createSheet }),
    ]);

    var host = el('div', { class: 'stack' });
    window.Dom.append(view, [
      el('div', { class: 'banner' }, [
        el('span', { html: icon('info', 18) }),
        el('div', { class: 'body', text: 'The world runs on your own machine. The app adds the voice room, the player list and the hardened host pack.' }),
      ]),
      host,
    ]);
    window.Dom.append(host, window.UI.skeletonList(2));

    async function load() {
      try {
        var data = await window.Api.get('/api/minecraft');
        var servers = (data && data.servers) || [];
        window.Dom.clear(host);
        if (!servers.length) {
          window.Dom.append(host, window.UI.empty({
            icon: 'cube',
            title: 'No servers yet',
            body: 'Register your world, download the host pack, and your crew gets voice plus the address without asking in chat.',
            action: { label: 'Register a server', icon: 'plus', onclick: createSheet },
          }));
          return;
        }
        window.Dom.append(host, servers.map(serverCard));
      } catch (err) {
        window.Dom.clear(host);
        window.Dom.append(host, window.UI.banner('error', err.message));
      }
    }
    await load();
    var timer = setInterval(load, 25000);
    return function () { clearInterval(timer); };
  }

  function createSheet() {
    var name = el('input', { class: 'input', placeholder: 'Weekend survival', maxlength: 40 });
    var address = el('input', { class: 'input', placeholder: 'play.example.net or 1.2.3.4', autocapitalize: 'none', spellcheck: 'false', maxlength: 253 });
    var port = el('input', { class: 'input', type: 'number', value: '19132', min: '1', max: '65535' });
    var edition = 'bedrock';
    var maxPlayers = el('input', { class: 'input', type: 'number', value: '10', min: '2', max: '40' });
    var motd = el('input', { class: 'input', placeholder: 'What shows in the server list', maxlength: 80 });
    var visibility = 'friends';
    var submit = window.UI.button('Register server', { variant: 'primary', block: true });

    var body = el('div', { class: 'stack-lg' }, [
      el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Server name' }), name]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Address' }), address,
        el('span', { class: 'field__hint', text: 'A name, an IPv4 address or [IPv6]. The app never connects to it.' }),
      ]),
      el('div', { class: 'hrow', style: 'gap:12px' }, [
        el('div', { class: 'field', style: 'flex:1' }, [el('span', { class: 'field__label', text: 'Port' }), port]),
        el('div', { class: 'field', style: 'flex:1' }, [el('span', { class: 'field__label', text: 'Max players' }), maxPlayers]),
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Edition' }),
        window.UI.segmented([{ id: 'bedrock', label: 'Bedrock' }, { id: 'java', label: 'Java' }], 'bedrock', function (next) {
          edition = next;
          port.value = next === 'java' ? '25565' : '19132';
        }),
      ]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Message of the day' }), motd]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Who can see it' }),
        window.UI.segmented([{ id: 'private', label: 'Only me' }, { id: 'friends', label: 'Friends' }, { id: 'public', label: 'Everyone' }], 'friends', function (next) { visibility = next; }),
      ]),
      submit,
    ]);

    submit.addEventListener('click', async function () {
      window.UI.setLoading(submit, true);
      try {
        var result = await window.Api.post('/api/minecraft', {
          name: name.value.trim(),
          address: address.value.trim(),
          port: Number(port.value),
          edition: edition,
          maxPlayers: Number(maxPlayers.value),
          motd: motd.value.trim(),
          visibility: visibility,
        });
        window.UI.closeTopSheet();
        window.UI.toast('Server registered', { icon: 'check' });
        window.Router.go('#/minecraft/' + result.server.id);
      } catch (err) {
        window.UI.toast(err.message || 'That did not save', { icon: 'warning', duration: 5000 });
      } finally {
        window.UI.setLoading(submit, false);
      }
    });

    window.UI.sheet({ title: 'Register a server', body: body });
  }

  async function renderDetail(view, params, query, api) {
    var id = Number(params.id);
    if (!id) { window.Router.go('#/minecraft'); return; }

    var data = null;
    var host = el('div', { class: 'stack-lg' });
    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Server' }),
    ]);
    api.setNavVisible(false);
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(3));

    async function load() {
      data = await window.Api.get('/api/minecraft/' + id);
      paint();
    }

    function paint() {
      var server = data.server;
      var mine = server.ownerId === window.Api.user().id;
      var address = server.address + ':' + server.port;
      window.Dom.clear(host);

      window.Dom.append(host, el('div', { class: 'card stack-lg' }, [
        el('div', { class: 'hrow' }, [
          el('span', { class: 'server-card__art', html: icon('cube', 24) }),
          el('div', { class: 'row__main' }, [
            el('div', { class: 'headline', text: server.name }),
            el('div', { class: 'row__sub', text: (server.edition === 'java' ? 'Java Edition' : 'Bedrock Edition') + (server.version ? ' · ' + server.version : '') }),
          ]),
          el('span', { class: 'status-pill', 'data-state': server.status, text: server.status.toUpperCase() }),
        ]),
        el('div', { class: 'hrow' }, [
          el('div', { class: 'row__main' }, [
            el('div', { class: 'meta', text: 'ADDRESS' }),
            el('div', { class: 'mono title', text: address }),
          ]),
          window.UI.button('Copy', { size: 'sm', variant: 'tonal', icon: 'copy', onclick: function () { window.Dom.copy(address).then(function () { window.UI.toast('Address copied', { icon: 'check' }); }); } }),
        ]),
        server.motd ? el('p', { class: 'body muted', text: server.motd }) : null,
        el('div', { class: 'profile-stats' }, [
          el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(data.players.length) }), el('span', { class: 'stat__label', text: 'In world' })]),
          el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(server.maxPlayers) }), el('span', { class: 'stat__label', text: 'Slots' })]),
          el('div', { class: 'stat' }, [el('span', { class: 'stat__value num', text: String(server.party ? server.party.memberCount : 0) }), el('span', { class: 'stat__label', text: 'In voice' })]),
        ]),
      ]));

      window.Dom.append(host, el('div', { class: 'hrow', style: 'gap:8px;flex-wrap:wrap' }, [
        window.UI.button(data.party && data.party.isMember ? 'Open voice room' : 'Join world and voice', {
          variant: 'primary',
          icon: 'headphones',
          onclick: async function () {
            try {
              await window.Api.post('/api/minecraft/' + id + '/join', {});
              window.Router.go('#/party/' + data.party.id);
            } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          },
        }),
        data.party && data.party.isMember
          ? window.UI.button('Leave world', {
            variant: 'text',
            onclick: async function () {
              try { await window.Api.post('/api/minecraft/' + id + '/leave', {}); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
            },
          })
          : null,
        mine ? window.UI.button('Host pack', { variant: 'tonal', icon: 'download', onclick: downloadPack }) : null,
        mine ? window.UI.button('Edit', { variant: 'text', icon: 'edit', onclick: editSheet }) : null,
      ]));

      window.Dom.append(host, el('div', {}, [
        el('div', { class: 'section-head' }, [el('h2', { text: 'In the world' })]),
        data.players.length
          ? el('div', { class: 'list' }, data.players.map(function (player) {
            return window.UI.row({
              title: player.player || player.displayName,
              sub: '@' + player.username + ' · joined ' + window.Dom.timeAgo(player.joinedAt) + ' ago',
              avatar: window.Dom.avatarNode(player, 40),
            });
          }))
          : window.UI.empty({ icon: 'cube', title: 'Nobody is playing', body: 'Join and your friends see you here.' }),
      ]));

      if (data.party) {
        window.Dom.append(host, el('div', {}, [
          el('div', { class: 'section-head' }, [el('h2', { text: 'Voice crew' }), el('span', { class: 'meta num', text: data.party.memberCount + '/' + data.party.maxMembers })]),
          el('div', { class: 'voice-stage' }, (data.party.members || []).map(function (member) {
            return el('div', { class: 'voice-tile' }, [
              window.Dom.avatarNode(member, 48, false),
              el('div', { class: 'voice-tile__name', text: member.displayName || member.username }),
            ]);
          })),
        ]));
      }

      if (mine) {
        window.Dom.append(host, el('div', { class: 'card stack' }, [
          el('div', { class: 'hrow' }, [
            el('span', { style: 'color:var(--warn)', html: icon('shield', 20) }),
            el('div', { class: 'row__main' }, [
              el('div', { class: 'title', text: 'Host hardening' }),
              el('div', { class: 'row__sub', text: 'Connection rate limits, watchdog, allow-list' }),
            ]),
          ]),
          el('p', { class: 'body muted', text: 'The pack ships iptables rules that cap new connections per source, a fail2ban jail, and a crash watchdog that gives up instead of spinning. Run it on the machine that hosts the world.' }),
          window.UI.button('Download host pack', { variant: 'tonal', icon: 'download', onclick: downloadPack }),
        ]));
      }
    }

    async function downloadPack() {
      var server = data.server;
      try {
        var query = '?name=' + encodeURIComponent(server.name) +
          '&motd=' + encodeURIComponent(server.motd || 'Hosted with Omlet Arcade') +
          '&maxPlayers=' + server.maxPlayers +
          '&port=' + server.port +
          '&edition=' + server.edition;
        var size = await window.Api.download('/api/minecraft/pack/host.zip' + query, 'omlet-host-pack.zip');
        window.UI.toast('Pack downloaded (' + Math.round(size / 1024) + ' KB)', { icon: 'check' });
      } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
    }

    function editSheet() {
      var server = data.server;
      var status = server.status;
      window.UI.sheet({
        title: 'Server status',
        body: el('div', { class: 'stack-lg' }, [
          el('p', { class: 'body muted', text: 'Set this to Running once the world is up on your machine. Friends see the status in the list.' }),
          window.UI.segmented([
            { id: 'stopped', label: 'Stopped' },
            { id: 'starting', label: 'Starting' },
            { id: 'running', label: 'Running' },
          ], status, async function (next) {
            try { await window.Api.patch('/api/minecraft/' + id, { status: next }); window.UI.closeTopSheet(); await load(); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
          }),
        ]),
        actions: [
          {
            label: 'Delete server',
            variant: 'danger',
            handler: async function () {
              var ok = await window.UI.confirmDialog({ title: 'Delete this server?', body: 'The registry entry, its voice room and player history go with it.', confirmLabel: 'Delete', destructive: true });
              if (!ok) return;
              try { await window.Api.del('/api/minecraft/' + id); window.Router.go('#/minecraft'); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
            },
          },
        ],
      });
    }

    try { await load(); } catch (err) {
      window.Dom.clear(host);
      window.Dom.append(host, window.UI.banner('error', err.message));
      return function () {};
    }
    var off = window.Socket.on('mc.updated', function () { load(); });
    var offJoin = window.Socket.on('mc.player_joined', function () { load(); });
    var offLeft = window.Socket.on('mc.player_left', function () { load(); });
    var timer = setInterval(load, 25000);
    return function () { off(); offJoin(); offLeft(); clearInterval(timer); };
  }

  window.Screens = window.Screens || {};
  window.Screens.minecraft = { render: renderList, routes: { ':id': { render: renderDetail } } };
})();
