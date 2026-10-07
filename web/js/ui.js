'use strict';
/**
 * UI kit: the component vocabulary every screen draws from. One shape per
 * component so "save" looks the same on every surface.
 */
(function () {
  var el = window.Dom.el;
  var esc = window.Dom.esc;
  var icon = window.Icons.svg;

  /* ------------------------------------------------------------- snackbar - */

  var snackHost = null;
  function toast(message, options) {
    if (!snackHost) {
      snackHost = el('div', { class: 'snackbar-host', 'aria-live': 'polite' });
      document.body.appendChild(snackHost);
    }
    var opts = options || {};
    var node = el('div', { class: 'snackbar', role: 'status' });
    if (opts.icon) node.appendChild(el('span', { html: icon(opts.icon, 18) }));
    node.appendChild(el('span', { text: message }));
    if (opts.action) {
      var button = el('button', {
        class: 'btn btn--text btn--sm snackbar__action',
        onclick: function () { close(); opts.action.handler(); },
      }, opts.action.label);
      node.appendChild(button);
    }
    snackHost.appendChild(node);
    var timer = setTimeout(close, opts.duration || 3600);
    function close() {
      clearTimeout(timer);
      if (!node.parentNode) return;
      node.classList.add('snackbar--out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
    }
    return close;
  }

  /* ---------------------------------------------------------------- sheet - */

  var openSheets = [];

  function sheet(options) {
    var opts = options || {};
    var backdrop = el('div', { class: 'sheet-backdrop' });
    var panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' });
    panel.appendChild(el('div', { class: 'sheet__grip' }));

    var head = el('div', { class: 'sheet__head' });
    if (opts.leadingIcon) head.appendChild(el('span', { class: 'dim', html: icon(opts.leadingIcon, 20) }));
    head.appendChild(el('h2', { text: opts.title || '' }));
    var closeBtn = el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, [el('span', { html: icon('close', 20) })]);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    var body = el('div', { class: 'sheet__body' });
    if (opts.body) Dom.append(body, opts.body);
    panel.appendChild(body);

    if (opts.actions && opts.actions.length) {
      var foot = el('div', { class: 'sheet__foot' });
      opts.actions.forEach(function (action) {
        foot.appendChild(el('button', {
          class: 'btn ' + (action.variant ? 'btn--' + action.variant : 'btn--text'),
          onclick: function () { if (!action.keepOpen) close(); if (action.handler) action.handler(body); },
        }, action.label));
      });
      panel.appendChild(foot);
    }

    function close(result) {
      if (!panel.parentNode) return;
      panel.classList.add('sheet--closing');
      backdrop.style.opacity = '0';
      backdrop.style.transition = 'opacity 200ms cubic-bezier(0.4,0,1,1)';
      setTimeout(function () {
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        openSheets = openSheets.filter(function (item) { return item !== close; });
        document.body.style.overflow = '';
      }, 200);
      if (opts.onClose) opts.onClose(result);
    }

    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    openSheets.push(close);

    var focusable = panel.querySelector('input, textarea, button');
    if (focusable && opts.autofocus !== false) setTimeout(function () { focusable.focus(); }, 60);

    return { close: close, body: body, panel: panel };
  }

  function closeTopSheet() {
    if (openSheets.length) { openSheets[openSheets.length - 1](); return true; }
    return false;
  }

  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var answered = false;
      var instance = sheet({
        title: options.title,
        body: el('div', { class: 'stack' }, [
          options.body ? el('p', { class: 'body muted', text: options.body }) : null,
          options.warning ? el('div', { class: 'banner banner--warn' }, [
            el('span', { html: icon('warning', 18) }),
            el('span', { text: options.warning }),
          ]) : null,
        ]),
        actions: [
          { label: options.cancelLabel || 'Cancel', variant: 'text', handler: function () { answered = true; resolve(false); } },
          { label: options.confirmLabel || 'Confirm', variant: options.destructive ? 'danger' : 'primary', handler: function () { answered = true; resolve(true); } },
        ],
        onClose: function () { if (!answered) resolve(false); },
      });
      return instance;
    });
  }

  function promptDialog(options) {
    return new Promise(function (resolve) {
      var answered = false;
      var input = el('input', {
        class: 'input',
        type: options.type || 'text',
        value: options.value || '',
        placeholder: options.placeholder || '',
        maxlength: options.maxlength || 200,
      });
      if (options.type === 'password') input.autocomplete = 'current-password';
      var errorNode = el('div', { class: 'field__error hidden' });
      sheet({
        title: options.title,
        body: el('div', { class: 'stack' }, [
          options.body ? el('p', { class: 'body muted', text: options.body }) : null,
          el('div', { class: 'field' }, [
            options.label ? el('label', { class: 'field__label', text: options.label }) : null,
            input,
            options.hint ? el('div', { class: 'field__hint', text: options.hint }) : null,
            errorNode,
          ]),
        ]),
        actions: [
          { label: options.cancelLabel || 'Cancel', variant: 'text', handler: function () { answered = true; resolve(null); } },
          {
            label: options.confirmLabel || 'Save',
            variant: 'primary',
            keepOpen: true,
            handler: function () {
              var value = input.value.trim();
              if (options.required && !value) {
                errorNode.textContent = options.requiredMessage || 'This cannot be empty';
                errorNode.classList.remove('hidden');
                input.setAttribute('aria-invalid', 'true');
                return;
              }
              answered = true;
              window.UI.closeTopSheet();
              resolve(value);
            },
          },
        ],
        onClose: function () { if (!answered) resolve(null); },
      });
      setTimeout(function () { input.focus(); }, 80);
    });
  }

  /* ----------------------------------------------------------- components - */

  function button(label, options) {
    var opts = options || {};
    var node = el('button', {
      class: 'btn' + (opts.variant ? ' btn--' + opts.variant : '') + (opts.block ? ' btn--block' : '') + (opts.size === 'sm' ? ' btn--sm' : ''),
      type: opts.type || 'button',
      onclick: opts.onclick,
      disabled: opts.disabled,
    }, [
      opts.icon ? el('span', { html: icon(opts.icon, 18) }) : null,
      el('span', { text: label }),
    ]);
    return node;
  }

  function setLoading(node, loading, label) {
    if (!node) return;
    if (loading) {
      node.dataset.label = node.textContent;
      node.classList.add('is-loading');
      node.setAttribute('aria-busy', 'true');
      node.disabled = true;
    } else {
      node.classList.remove('is-loading');
      node.removeAttribute('aria-busy');
      node.disabled = false;
      if (label !== undefined) node.textContent = label;
      else if (node.dataset.label) node.textContent = node.dataset.label;
    }
  }

  function empty(options) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icon(options.icon || 'compass', 28) }),
      el('div', { class: 'empty__title', text: options.title }),
      options.body ? el('p', { class: 'empty__body', text: options.body }) : null,
      options.action ? button(options.action.label, { variant: 'tonal', onclick: options.action.onclick, icon: options.action.icon }) : null,
    ]);
  }

  function skeletonList(count) {
    var host = el('div', { class: 'stack' });
    for (var i = 0; i < (count || 4); i += 1) {
      host.appendChild(el('div', { class: 'skeleton-row' }, [
        el('div', { class: 'skeleton avatar' }),
        el('div', { class: 'stack', style: 'flex:1;gap:6px' }, [
          el('div', { class: 'skeleton', style: 'height:12px;width:52%' }),
          el('div', { class: 'skeleton', style: 'height:10px;width:76%' }),
        ]),
      ]));
    }
    return host;
  }

  function banner(kind, message) {
    return el('div', { class: 'banner banner--' + kind, role: kind === 'error' ? 'alert' : 'status' }, [
      el('span', { html: icon(kind === 'error' ? 'warning' : kind === 'ok' ? 'check' : 'info', 18) }),
      el('div', { class: 'body', text: message }),
    ]);
  }

  function row(options) {
    var node = el(options.onclick ? 'button' : 'div', {
      class: 'row',
      onclick: options.onclick,
      type: options.onclick ? 'button' : null,
    }, [
      options.avatar || null,
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: options.title || '' }),
        options.sub ? el('div', { class: 'row__sub', text: options.sub }) : null,
      ]),
      options.end ? el('div', { class: 'row__end' }, options.end) : null,
    ]);
    return node;
  }

  function switchRow(options) {
    var toggle = el('button', {
      class: 'switch',
      role: 'switch',
      'aria-checked': options.checked ? 'true' : 'false',
      'aria-label': options.label,
      onclick: function () {
        var next = toggle.getAttribute('aria-checked') !== 'true';
        toggle.setAttribute('aria-checked', next ? 'true' : 'false');
        if (options.onChange) options.onChange(next);
      },
    });
    return el('div', { class: 'row' }, [
      options.icon ? el('span', { class: 'dim', html: icon(options.icon, 20) }) : null,
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: options.label }),
        options.sub ? el('div', { class: 'row__sub', text: options.sub }) : null,
      ]),
      toggle,
    ]);
  }

  function setting(label, value, options) {
    var opts = options || {};
    return el('button', { class: 'row', type: 'button', onclick: opts.onclick }, [
      opts.icon ? el('span', { class: 'dim', html: icon(opts.icon, 20) }) : null,
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: label }),
        opts.sub ? el('div', { class: 'row__sub', text: opts.sub }) : null,
      ]),
      el('div', { class: 'row__end' }, [
        value ? el('span', { class: 'meta', text: value }) : null,
        opts.hideChevron ? null : el('span', { html: icon('chevron-right', 18) }),
      ]),
    ]);
  }

  function segmented(items, selected, onSelect) {
    var host = el('div', { class: 'segmented', role: 'tablist' });
    items.forEach(function (item) {
      var node = el('button', {
        class: 'segmented__item',
        role: 'tab',
        'aria-selected': item.id === selected ? 'true' : 'false',
        onclick: function () {
          window.Dom.qsa('.segmented__item', host).forEach(function (other) { other.setAttribute('aria-selected', 'false'); });
          node.setAttribute('aria-selected', 'true');
          onSelect(item.id);
        },
      }, item.label);
      host.appendChild(node);
    });
    return host;
  }

  function avatarWithState(user, size, state) {
    var node = window.Dom.avatarNode(user, size, true);
    if (state === 'speaking') node.classList.add('avatar--speaking');
    return node;
  }

  function spinner(size) {
    var node = el('div', { class: 'spinner' });
    if (size) { node.style.width = size + 'px'; node.style.height = size + 'px'; }
    return node;
  }

  window.UI = {
    toast: toast, sheet: sheet, closeTopSheet: closeTopSheet,
    confirmDialog: confirmDialog, promptDialog: promptDialog,
    button: button, setLoading: setLoading, empty: empty, skeletonList: skeletonList,
    banner: banner, row: row, switchRow: switchRow, setting: setting, segmented: segmented,
    avatarWithState: avatarWithState, spinner: spinner, esc: esc, icon: icon,
  };
})();
