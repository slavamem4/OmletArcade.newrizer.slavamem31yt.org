'use strict';
/**
 * DOM helpers. Small on purpose: no framework, no build step, nothing to leak.
 */
(function () {
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      // A string here would be walked character by character and produce
      // nonsense attributes, so refuse it loudly instead.
      if (typeof attrs !== 'object') {
        throw new TypeError('Dom.el: attrs must be an object, got ' + typeof attrs);
      }
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      children.forEach(function (child) { append(node, child); });
      return node;
    }
    if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  /** Escape anything that goes into innerHTML. Used for every server string. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Deterministic avatar art from a seed. Drawn on a canvas so the app ships
   * no image assets and no network fonts; the same seed always draws the same
   * plate, so a face is recognizable across screens.
   */
  function avatar(seed, size) {
    var px = size || 44;
    var canvas = el('canvas', { width: px * 2, height: px * 2, class: 'avatar__art' });
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    canvas.style.borderRadius = '50%';
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    var hash = 0;
    var text = String(seed || 'guest');
    for (var i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    // Hue stays inside the product band (195-258) so no avatar goes off-palette.
    var hue = 195 + (hash % 64);
    var light = 0.30 + ((hash >> 8) % 12) / 100;
    ctx.scale(2, 2);
    var grad = ctx.createLinearGradient(0, 0, px, px);
    grad.addColorStop(0, 'oklch(' + (light + 0.10).toFixed(3) + ' 0.09 ' + hue + ')');
    grad.addColorStop(1, 'oklch(' + light.toFixed(3) + ' 0.11 ' + (hue + 22) + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, px, px);

    // Symmetric block pattern, 5x5 mirrored: reads as a face from a distance.
    ctx.fillStyle = 'oklch(0.95 0.02 ' + hue + ' / 0.32)';
    var cell = px / 5;
    for (var y = 0; y < 5; y += 1) {
      for (var x = 0; x < 3; x += 1) {
        var bit = (hash >> (y * 3 + x)) & 1;
        if (!bit) continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
        ctx.fillRect((4 - x) * cell, y * cell, cell, cell);
      }
    }
    return canvas;
  }

  function avatarNode(user, size, presence) {
    var px = size || 44;
    var cls = 'avatar' + (px <= 32 ? ' avatar--sm' : px >= 72 ? (px >= 96 ? ' avatar--xl' : ' avatar--lg') : '');
    var node = el('div', { class: cls, 'data-user-id': user ? user.id : '' });
    node.style.width = px + 'px';
    node.style.height = px + 'px';
    node.appendChild(avatar(user ? (user.avatarSeed || user.username) : 'guest', px));
    if (presence !== false) {
      node.appendChild(el('span', { class: 'avatar__presence', 'data-state': (user && user.presence) || 'offline' }));
    }
    return node;
  }

  function initials(name) {
    var text = String(name || '?').trim();
    return (text.slice(0, 2)).toUpperCase();
  }

  function timeAgo(ms) {
    if (!ms) return '';
    var seconds = Math.max(0, Math.floor((Date.now() - Number(ms)) / 1000));
    if (seconds < 60) return 'now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd';
    return new Date(Number(ms)).toLocaleDateString();
  }

  function clockTime(ms) {
    return new Date(Number(ms)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // WebView fallback without the clipboard permission.
    var area = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }

  function onSwipeBack(node, handler) {
    var startX = 0;
    var startY = 0;
    node.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    node.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      var dy = Math.abs(e.changedTouches[0].clientY - startY);
      if (dx > 72 && dy < 48 && startX < 40) handler();
    }, { passive: true });
  }

  window.Dom = {
    el: el, append: append, clear: clear, qs: qs, qsa: qsa, esc: esc,
    avatar: avatar, avatarNode: avatarNode, initials: initials,
    timeAgo: timeAgo, clockTime: clockTime, copy: copy, debounce: debounce, onSwipeBack: onSwipeBack,
  };
})();
