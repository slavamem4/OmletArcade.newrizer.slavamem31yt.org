'use strict';
/**
 * Settings: account, privacy, voice, security, and the purge that actually
 * deletes things.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  function group(title, rows) {
    return el('div', {}, [
      el('div', { class: 'section-head' }, [el('h2', { class: 'meta', text: title.toUpperCase() })]),
      el('div', { class: 'card', style: 'padding:4px' }, [el('div', { class: 'list list--divided' }, rows)]),
    ]);
  }

  async function render(view, params, query, api) {
    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Settings' }),
    ]);
    api.setNavVisible(false);

    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(view, host);
    window.Dom.append(host, window.UI.skeletonList(4));

    var me = await window.Api.get('/api/users/me');
    var settings = me.settings || {};
    window.Api.setUser(me.user);

    async function saveSection(section, patch) {
      try {
        var body = {};
        body[section] = patch;
        await window.Api.patch('/api/users/me/settings', body);
      } catch (err) {
        window.UI.toast(err.message || 'That did not save', { icon: 'warning' });
      }
    }

    window.Dom.clear(host);

    window.Dom.append(host, group('Account', [
      window.UI.setting('Display name', me.user.displayName, {
        icon: 'user',
        onclick: async function () {
          var next = await window.UI.promptDialog({ title: 'Display name', label: 'Name', value: me.user.displayName, required: true, maxlength: 32 });
          if (!next) return;
          try {
            var result = await window.Api.patch('/api/users/me', { displayName: next });
            window.Api.setUser(result.user);
            window.UI.toast('Saved', { icon: 'check' });
            window.Router.go('#/settings', { force: true });
          } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        },
      }),
      window.UI.setting('Change password', '', {
        icon: 'lock',
        onclick: async function () {
          var current = await window.UI.promptDialog({ title: 'Change password', label: 'Current password', type: 'password', required: true });
          if (!current) return;
          var next = await window.UI.promptDialog({ title: 'New password', label: 'At least 8 characters', type: 'password', required: true, confirmLabel: 'Set password' });
          if (!next) return;
          try {
            var result = await window.Api.post('/api/auth/password', { currentPassword: current, newPassword: next });
            window.Api.setSession(result);
            window.UI.toast('Password changed. Other devices were signed out.', { icon: 'check', duration: 5000 });
          } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
        },
      }),
      window.UI.setting('Signed-in devices', '', { icon: 'wifi', onclick: function () { window.Router.go('#/settings/sessions'); } }),
      window.UI.setting('Blocked players', '', { icon: 'ban-circle', onclick: function () { window.Router.go('#/friends?tab=blocked'); } }),
    ]));

    window.Dom.append(host, group('Privacy', [
      window.UI.setting('Who can add you', labelFor(settings.privacy && settings.privacy.friendRequests, { everyone: 'Everyone', friends: 'Friends of friends', nobody: 'Nobody' }), {
        icon: 'user-plus',
        onclick: function () { pick('Who can send you friend requests', ['everyone', 'friends', 'nobody'], (settings.privacy || {}).friendRequests || 'everyone', function (next) { saveSection('privacy', { friendRequests: next }); window.Router.go('#/settings', { force: true }); }); },
      }),
      window.UI.setting('Who can call you', labelFor(settings.privacy && settings.privacy.calls, { everyone: 'Everyone', friends: 'Friends only', nobody: 'Nobody' }), {
        icon: 'phone',
        onclick: function () { pick('Who can call you', ['everyone', 'friends', 'nobody'], (settings.privacy || {}).calls || 'friends', function (next) { saveSection('privacy', { calls: next }); window.Router.go('#/settings', { force: true }); }); },
      }),
      window.UI.switchRow({
        icon: 'eye',
        label: 'Show when you are online',
        checked: settings.privacy ? settings.privacy.showPresence !== false : true,
        onChange: function (next) { saveSection('privacy', { showPresence: next }); },
      }),
      window.UI.switchRow({
        icon: 'search',
        label: 'Let people find you by name',
        checked: settings.privacy ? settings.privacy.discoverable !== false : true,
        onChange: function (next) { saveSection('privacy', { discoverable: next }); },
      }),
    ]));

    window.Dom.append(host, group('Voice', [
      window.UI.switchRow({
        icon: 'bolt',
        label: 'Noise suppression',
        checked: settings.voice ? settings.voice.noiseSuppression !== false : true,
        onChange: function (next) { saveSection('voice', { noiseSuppression: next }); },
      }),
      window.UI.switchRow({
        icon: 'headphones',
        label: 'Echo cancellation',
        checked: settings.voice ? settings.voice.echoCancellation !== false : true,
        onChange: function (next) { saveSection('voice', { echoCancellation: next }); },
      }),
      sliderRow('Microphone gain', (settings.voice || {}).inputGain === undefined ? 100 : settings.voice.inputGain, function (next) { saveSection('voice', { inputGain: next }); }),
      sliderRow('Output volume', (settings.voice || {}).outputVolume === undefined ? 100 : settings.voice.outputVolume, function (next) { saveSection('voice', { outputVolume: next }); }),
      window.UI.setting('Audio devices', '', { icon: 'headphones', onclick: function () { window.App.pickDevices(); } }),
    ]));

    window.Dom.append(host, group('Security', [
      window.UI.setting('Encryption key', me.user.hasIdentityKey ? 'active' : 'not created', { icon: 'key', onclick: function () { window.App.showMyKey(); } }),
      window.UI.switchRow({
        icon: 'shield',
        label: 'Require encryption for new rooms',
        sub: 'Rooms you host will refuse plaintext media',
        checked: settings.e2ee ? settings.e2ee.enforce !== false : true,
        onChange: function (next) { saveSection('e2ee', { enforce: next }); },
      }),
      window.UI.setting('Anti-DDoS status', '', { icon: 'wifi', onclick: async function () {
        try {
          var status = await window.Api.get('/api/security/status');
          window.UI.sheet({
            title: 'Protection status',
            body: el('div', { class: 'stack-lg' }, [
              el('p', { class: 'body muted', text: 'Your traffic is metered per network and per account. Repeated abuse escalates to a temporary ban that only a solved proof-of-work challenge lifts.' }),
              window.UI.setting('Network blocked', status.banned ? 'yes' : 'no', { icon: 'ban-circle', hideChevron: true }),
              window.UI.setting('Challenge required', status.powRequired ? 'yes' : 'no', { icon: 'key', hideChevron: true }),
              window.UI.setting('Strikes recorded', String(status.strikes), { icon: 'flag', hideChevron: true }),
            ]),
          });
        } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
      } }),
      window.UI.setting('Report a player', '', { icon: 'flag', onclick: function () { window.App.report(null); } }),
    ]));

    window.Dom.append(host, group('Appearance', [
      window.UI.switchRow({
        icon: 'clock',
        label: 'Reduce motion',
        sub: 'Cuts animations to instant state changes',
        checked: !!settings.appearance && !!settings.appearance.reduceMotion,
        onChange: function (next) {
          document.body.classList.toggle('reduce-motion', next);
          saveSection('appearance', { reduceMotion: next });
        },
      }),
    ]));

    window.Dom.append(host, group('Storage', [
      window.UI.setting('Clear space', '', { icon: 'trash', onclick: purgeSheet }),
    ]));

    window.Dom.append(host, el('div', { class: 'stack' }, [
      window.UI.button('Sign out', { variant: 'danger', block: true, icon: 'logout', onclick: function () { window.App.signOut(); } }),
      el('p', { class: 'meta', style: 'text-align:center', text: 'Omlet Arcade 1.0.0 · voice over LiveKit · end to end encrypted' }),
    ]));

    function labelFor(value, map) {
      return map[value] || map.everyone;
    }

    function pick(title, options, current, onPick) {
      window.UI.sheet({
        title: title,
        body: el('div', { class: 'list' }, options.map(function (option) {
          return el('button', {
            class: 'row',
            type: 'button',
            onclick: function () { window.UI.closeTopSheet(); onPick(option); },
          }, [
            el('div', { class: 'row__main' }, [el('div', { class: 'row__title', text: labelFor(option, { everyone: 'Everyone', friends: option === 'friends' && title.indexOf('call') >= 0 ? 'Friends only' : 'Friends of friends', nobody: 'Nobody' }) })]),
            option === current ? el('span', { style: 'color:var(--accent)', html: icon('check', 18) }) : null,
          ]);
        })),
      });
    }

    function sliderRow(label, value, onChange) {
      var output = el('span', { class: 'meta num', text: value + '%' });
      var input = el('input', {
        class: 'input',
        type: 'range',
        min: '0',
        max: '100',
        step: '5',
        value: String(value),
        style: 'padding:0 4px;background:transparent;border:0',
        oninput: function () { output.textContent = input.value + '%'; },
        onchange: function () { onChange(Number(input.value)); },
      });
      return el('div', { class: 'row', style: 'flex-wrap:wrap' }, [
        el('div', { class: 'row__main' }, [el('div', { class: 'row__title', text: label }), output]),
        input,
      ]);
    }

    async function purgeSheet() {
      var report = null;
      try { report = await window.Api.get('/api/system/purge/report'); } catch (err) { report = null; }
      var detail = el('div', { class: 'stack' });
      if (report) {
        var bytes = ((report.disk && report.disk.dataBytes) || 0) + ((report.disk && report.disk.tmpBytes) || 0);
        detail.appendChild(window.UI.setting('Server heap', report.heapUsedMb + ' MB', { icon: 'layers', hideChevron: true }));
        detail.appendChild(window.UI.setting('Cached entries', String((report.caches || []).reduce(function (sum, cache) { return sum + cache.entries; }, 0)), { icon: 'grid', hideChevron: true }));
        detail.appendChild(window.UI.setting('Log lines held', String(report.logRing || 0), { icon: 'info', hideChevron: true }));
        detail.appendChild(window.UI.setting('Data on disk', formatBytes(bytes), { icon: 'download', hideChevron: true }));
        detail.appendChild(window.UI.setting('Uptime', Math.round((report.uptimeSeconds || 0) / 60) + ' min', { icon: 'clock', hideChevron: true }));
      }
      var submit = window.UI.button('Clear everything', { variant: 'danger', block: true, icon: 'trash' });
      submit.addEventListener('click', async function () {
        window.UI.setLoading(submit, true);
        try {
          var result = await window.Api.post('/api/system/purge', {});
          await window.App.clearLocalCache();
          window.UI.closeTopSheet();
          var cleared = result.cleared || result.stats || {};
          window.UI.toast('Cleared ' + ((cleared.cacheEntries || 0) + (cleared.messages || 0) + (cleared.notifications || 0)) + ' items', { icon: 'check' });
        } catch (err) {
          window.UI.toast(err.message, { icon: 'warning' });
        } finally {
          window.UI.setLoading(submit, false);
        }
      });
      window.UI.sheet({
        title: 'Clear space',
        body: el('div', { class: 'stack-lg' }, [
          el('p', { class: 'body muted', text: 'Deletes caches, expired sessions, old notifications, trimmed message history and the log file on the server, plus this device\'s local cache. Your account, friends and keys stay.' }),
          el('div', { class: 'card', style: 'padding:4px' }, [el('div', { class: 'list list--divided' }, [detail])]),
          submit,
        ]),
      });
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    return function () {};
  }

  async function renderSessions(view, params, query, api) {
    api.setTitle([
      el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { window.Router.back(); } }, [el('span', { html: icon('arrow-left', 22) })]),
      el('span', { class: 'title', text: 'Devices' }),
    ]);
    api.setNavVisible(false);

    var host = el('div', { class: 'stack-lg' });
    window.Dom.append(view, host);
    var data = await window.Api.get('/api/auth/sessions');
    var sessions = (data && data.sessions) || [];
    window.Dom.append(host, el('p', { class: 'body muted', text: 'A device you do not recognize should be signed out here. Changing your password signs all of them out.' }));
    window.Dom.append(host, el('div', { class: 'card', style: 'padding:4px' }, [
      el('div', { class: 'list list--divided' }, sessions.map(function (session) {
        return window.UI.row({
          title: session.device || 'Unknown device',
          sub: (session.ip || 'unknown network') + ' · ' + window.Dom.timeAgo(session.createdAt) + ' ago',
          avatar: el('span', { class: 'server-card__art', html: icon('wifi', 20) }),
          end: session.current
            ? [el('span', { class: 'e2ee-flag', html: icon('check', 13) + '<span>this device</span>' })]
            : [window.UI.button('Sign out', {
              size: 'sm',
              variant: 'danger',
              onclick: async function () {
                try { await window.Api.del('/api/auth/sessions/' + session.id); window.UI.toast('Device signed out', { icon: 'check' }); window.Router.go('#/settings/sessions', { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
              },
            })],
        });
      })),
    ]));
    window.Dom.append(host, window.UI.button('Sign out everywhere else', {
      variant: 'danger',
      block: true,
      onclick: async function () {
        var ok = await window.UI.confirmDialog({ title: 'Sign out every other device?', body: 'You stay signed in here.', confirmLabel: 'Sign them out', destructive: true });
        if (!ok) return;
        try { await window.Api.post('/api/auth/sessions/revoke-others', {}); window.UI.toast('Other devices signed out', { icon: 'check' }); window.Router.go('#/settings/sessions', { force: true }); } catch (err) { window.UI.toast(err.message, { icon: 'warning' }); }
      },
    }));
    return function () {};
  }

  window.Screens = window.Screens || {};
  window.Screens.settings = { render: render, routes: { sessions: { render: renderSessions } } };
})();
