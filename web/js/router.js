'use strict';
/**
 * Router + app controller.
 *
 * Hash routing so the packaged WebView and the browser build behave the same,
 * and so the Android system Back gesture maps to a real navigation step.
 */
(function () {
  var el = window.Dom.el;
  var current = null;
  var disposers = [];
  var root = null;
  var bar = null;
  var scroll = null;
  var nav = null;
  var history = [];

  var TABS = [
    { id: 'home', label: 'Lobby', icon: 'home', route: '#/home' },
    { id: 'parties', label: 'Parties', icon: 'users', route: '#/parties' },
    { id: 'minecraft', label: 'Servers', icon: 'cube', route: '#/minecraft' },
    { id: 'feed', label: 'Feed', icon: 'radio', route: '#/feed' },
    { id: 'profile', label: 'You', icon: 'user', route: '#/profile' },
  ];

  /**
   * Resolve a hash to a screen. A screen can declare sub-routes with ':param'
   * segments: '#/minecraft/12' matches Screens.minecraft.routes[':id'].
   */
  function resolve(name, parts) {
    var base = (window.Screens || {})[name];
    if (!base) return null;
    // A screen that only declares sub-routes has nothing to render on its own.
    if (!parts.length) return base.render ? base : null;
    if (!base.routes) return base;
    // Sub-routes are declared as ':id' style patterns. Match on segment count
    // and shape instead of rebuilding the pattern from the URL.
    var pattern = null;
    var keys = Object.keys(base.routes);
    for (var k = 0; k < keys.length; k += 1) {
      var candidate = keys[k].split('/');
      if (candidate.length !== parts.length) continue;
      var fits = candidate.every(function (segment, index) {
        return segment.charAt(0) === ':' || segment === parts[index];
      });
      if (!fits) continue;
      pattern = keys[k];
      break;
    }
    if (!pattern) return base;
    var segments = pattern.split('/');
    var params = {};
    parts.forEach(function (part, index) {
      var decoded = decodeURIComponent(part);
      params['p' + index] = decoded;
      if (segments[index].charAt(0) === ':') params[segments[index].slice(1)] = decoded;
    });
    var match = base.routes[pattern];
    return { render: match.render, params: params, pattern: pattern };
  }

  function parseHash() {
    var hash = location.hash || '#/home';
    var parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    var name = parts.shift() || 'home';
    var resolved = resolve(name, parts);
    var params = (resolved && resolved.params) || {};
    var query = {};
    var queryIndex = hash.indexOf('?');
    if (queryIndex >= 0) {
      hash.slice(queryIndex + 1).split('&').forEach(function (pair) {
        var split = pair.split('=');
        if (split[0]) query[decodeURIComponent(split[0])] = decodeURIComponent(split[1] || '');
      });
    }
    return { name: name, params: params, query: query, hash: hash, screen: resolved };
  }

  function dispose() {
    disposers.forEach(function (fn) {
      try { fn(); } catch (err) { /* already torn down */ }
    });
    disposers = [];
  }

  function setTitle(node) {
    window.Dom.clear(bar.querySelector('.app-bar__title'));
    window.Dom.append(bar.querySelector('.app-bar__title'), node);
  }

  function setActions(nodes) {
    var host = bar.querySelector('.app-bar__actions');
    window.Dom.clear(host);
    window.Dom.append(host, nodes || []);
  }

  function setNavVisible(visible) {
    if (nav) nav.classList.toggle('hidden', !visible);
    if (scroll) scroll.style.paddingBottom = visible ? '' : '24px';
  }

  function activeTab(name) {
    var match = TABS.filter(function (tab) { return tab.id === name; })[0];
    if (match) return match.id;
    var alias = { party: 'parties', call: 'parties', chat: 'parties', streams: 'home', settings: 'profile' };
    return alias[name] || null;
  }

  async function render(route, direction) {
    var screen = route.screen || (window.Screens || {})[route.name];
    if (!screen) { location.hash = '#/home'; return; }
    dispose();
    window.Dom.clear(scroll);

    var api = {
      setTitle: setTitle,
      setActions: setActions,
      setNavVisible: setNavVisible,
      route: route,
      onDispose: function (fn) { disposers.push(fn); },
      go: go,
      back: back,
    };

    setNavVisible(!!activeTab(route.name));
    var tab = activeTab(route.name);
    window.Dom.qsa('.nav-item').forEach(function (item) {
      if (item.dataset.tab === tab) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    var view = el('div', { class: 'screen' + (direction === 'back' ? ' screen--back' : '') });
    window.Dom.append(scroll, view);
    scroll.scrollTop = 0;

    try {
      var teardown = await screen.render(view, route.params, route.query, api);
      if (typeof teardown === 'function') disposers.push(teardown);
    } catch (err) {
      console.error('screen failed', route.name, err);
      window.Dom.append(view, window.UI.banner('error', 'That screen could not load: ' + (err.message || 'unknown error')));
    }
    current = route;
  }

  function go(hash, options) {
    var opts = options || {};
    if (location.hash === hash && !opts.force) return;
    if (!opts.replace) history.push(location.hash || '#/home');
    if (history.length > 40) history.shift();
    if (opts.replace) location.replace(hash);
    else location.hash = hash;
  }

  function back() {
    if (window.UI.closeTopSheet()) return;
    var previous = history.pop();
    if (previous && previous !== location.hash) {
      location.hash = previous;
      return;
    }
    location.hash = '#/home';
  }

  function handleHash() {
    var route = parseHash();
    var direction = history.length && history[history.length - 1] === location.hash ? 'back' : 'forward';
    render(route, direction);
  }

  function buildNav() {
    nav = el('nav', { class: 'nav-bar', 'aria-label': 'Main' });
    TABS.forEach(function (tab) {
      var item = el('button', {
        class: 'nav-item',
        type: 'button',
        'data-tab': tab.id,
        'aria-label': tab.label,
        onclick: function () { go(tab.route); },
      }, [
        el('span', { class: 'nav-item__icon', html: window.Icons.svg(tab.icon, 22) }),
        el('span', { class: 'nav-item__label', text: tab.label }),
      ]);
      nav.appendChild(item);
    });
    document.body.appendChild(nav);
  }

  function setBadge(tabId, count) {
    if (!nav) return;
    var item = nav.querySelector('[data-tab="' + tabId + '"] .nav-item__icon');
    if (!item) return;
    var existing = item.querySelector('.badge-dot');
    if (!count) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = el('span', { class: 'badge-dot' });
      item.appendChild(existing);
    }
    existing.textContent = count > 99 ? '99+' : String(count);
  }

  function boot() {
    root = document.getElementById('app');
    window.Dom.clear(root);
    bar = el('header', { class: 'app-bar' }, [
      el('div', { class: 'app-bar__title' }),
      el('div', { class: 'app-bar__actions' }),
    ]);
    scroll = el('main', { class: 'screen-scroll', id: 'screen-scroll' });
    root.appendChild(bar);
    root.appendChild(scroll);
    buildNav();
    window.addEventListener('hashchange', handleHash);
    // Android system Back: the WebView history entry is ours to consume.
    document.addEventListener('backbutton', function (event) { event.preventDefault(); back(); });
    window.Dom.onSwipeBack(scroll, back);
    if (!location.hash) location.replace('#/home');
    handleHash();
  }

  window.Router = {
    boot: boot,
    go: go,
    back: back,
    parseHash: parseHash,
    setTitle: setTitle,
    setActions: setActions,
    setNavVisible: setNavVisible,
    setBadge: setBadge,
    current: function () { return current; },
    scrollRoot: function () { return scroll; },
    TABS: TABS,
  };
})();
