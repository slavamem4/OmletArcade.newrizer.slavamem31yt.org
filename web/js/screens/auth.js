'use strict';
/**
 * Auth screen: sign in, sign up, and the encryption key handoff.
 *
 * Copy names the problem and the recovery. Errors come from the server as
 * sentences a person can act on.
 */
(function () {
  var el = window.Dom.el;
  var icon = window.Icons.svg;

  function brand() {
    return el('div', { class: 'auth__brand' }, [
      el('div', { class: 'auth__mark' }, [
        el('span', { style: 'color:var(--accent)', html: icon('gamepad', 34) }),
        el('span', { class: 'display', text: 'Omlet Arcade' }),
      ]),
      el('p', { class: 'body-lg muted', text: 'Voice parties, calls, Minecraft crews and live streams, end to end encrypted.' }),
    ]);
  }

  function field(label, input, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: label }),
      input,
      hint ? el('span', { class: 'field__hint', text: hint }) : null,
    ]);
  }

  function errorBox() {
    return el('div', { class: 'banner banner--error hidden', role: 'alert' });
  }

  function showError(box, message) {
    window.Dom.clear(box);
    window.Dom.append(box, [el('span', { html: icon('warning', 18) }), el('div', { class: 'body', text: message })]);
    box.classList.remove('hidden');
  }

  function signIn(view, api) {
    var error = errorBox();
    var username = el('input', { class: 'input', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Your name or email', maxlength: 64 });
    var password = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password', maxlength: 512 });
    var submit = window.UI.button('Sign in', { variant: 'primary', block: true });

    async function attempt() {
      window.UI.setLoading(submit, true);
      error.classList.add('hidden');
      try {
        var result = await window.Api.post('/api/auth/login', { username: username.value.trim(), password: password.value });
        window.Api.setSession(result);
        await window.App.afterSignIn(password.value);
      } catch (err) {
        var message = err.message || 'Sign in failed';
        if (err.retryAfter) message += ' Try again in ' + Math.max(1, Math.round(err.retryAfter)) + 's.';
        showError(error, message);
      } finally {
        window.UI.setLoading(submit, false);
      }
    }

    submit.addEventListener('click', attempt);
    [username, password].forEach(function (input) {
      input.addEventListener('keydown', function (event) { if (event.key === 'Enter') attempt(); });
    });

    window.Dom.append(view, el('div', { class: 'auth' }, [
      brand(),
      el('form', { class: 'auth__form', onsubmit: function (event) { event.preventDefault(); attempt(); } }, [
        error,
        field('Name or email', username),
        field('Password', password),
        submit,
      ]),
      el('p', { class: 'auth__alt' }, [
        'New here? ',
        el('a', { href: '#/auth/signup', style: 'color:var(--accent);font-weight:650;text-decoration:none', text: 'Create an account' }),
      ]),
    ]));
    api.setNavVisible(false);
    setTimeout(function () { username.focus(); }, 120);
  }

  function signUp(view, api) {
    var error = errorBox();
    var username = el('input', { class: 'input', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'player_one', maxlength: 20 });
    var displayName = el('input', { class: 'input', type: 'text', autocomplete: 'nickname', placeholder: 'Shown to your friends', maxlength: 32 });
    var password = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters', maxlength: 512 });
    var confirm = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat it', maxlength: 512 });
    var submit = window.UI.button('Create account', { variant: 'primary', block: true });

    var notice = el('div', { class: 'banner' }, [
      el('span', { html: icon('key', 18) }),
      el('div', { class: 'body', text: 'Your password also seals the encryption key for this device. Forget it and old messages stay unreadable, even for us.' }),
    ]);

    async function attempt() {
      if (password.value !== confirm.value) {
        showError(error, 'The two passwords do not match');
        return;
      }
      window.UI.setLoading(submit, true);
      error.classList.add('hidden');
      try {
        var result = await window.Api.post('/api/auth/register', {
          username: username.value.trim(),
          displayName: displayName.value.trim() || undefined,
          password: password.value,
        });
        window.Api.setSession(result);
        await window.App.afterSignIn(password.value);
      } catch (err) {
        showError(error, err.message || 'That did not work');
      } finally {
        window.UI.setLoading(submit, false);
      }
    }

    submit.addEventListener('click', attempt);
    confirm.addEventListener('keydown', function (event) { if (event.key === 'Enter') attempt(); });

    window.Dom.append(view, el('div', { class: 'auth' }, [
      brand(),
      el('form', { class: 'auth__form', onsubmit: function (event) { event.preventDefault(); attempt(); } }, [
        error,
        notice,
        field('Player name', username, '3-20 characters, letters, numbers and underscores'),
        field('Display name', displayName, 'Optional. This is what friends see.'),
        field('Password', password),
        field('Repeat password', confirm),
        submit,
      ]),
      el('p', { class: 'auth__alt' }, [
        'Already have an account? ',
        el('a', { href: '#/auth', style: 'color:var(--accent);font-weight:650;text-decoration:none', text: 'Sign in' }),
      ]),
    ]));
    api.setNavVisible(false);
    setTimeout(function () { username.focus(); }, 120);
  }

  /**
   * Shown when this device has no identity key but the account has a recovery
   * blob: ask for the password, open the blob locally, publish nothing.
   */
  async function recoverKeys() {
    var me = window.Api.user();
    var stored = await window.Api.get('/api/keys/me');
    var cached = window.E2EE.cachedIdentity();
    if (cached && me && cached.userId === me.id && cached.publicKey) {
      if (stored.identityPublicKey && stored.identityPublicKey !== cached.publicKey) {
        // The account's key belongs to another device. Offer a reset instead of
        // silently overwriting it.
        var replace = await window.UI.confirmDialog({
          title: 'This device needs a new key',
          body: 'Your account already has an encryption key from another device. Messages sealed with it stay on that device.',
          confirmLabel: 'Create a new key here',
          cancelLabel: 'Not now',
        });
        if (replace) {
          var password = await window.UI.promptDialog({ title: 'Confirm your password', label: 'Password', type: 'password', required: true, confirmLabel: 'Create key' });
          if (password) await window.E2EE.ensureIdentity(password);
        }
      }
      return;
    }
    if (stored.identityPublicKey && stored.hasRecoveryBlob) {
      var password = await window.UI.promptDialog({
        title: 'Unlock your messages',
        body: 'Enter your password to open the encryption key stored on this account. It is decrypted on this device only.',
        label: 'Password',
        type: 'password',
        required: true,
        confirmLabel: 'Unlock',
        cancelLabel: 'Skip',
      });
      if (!password) return;
      try {
        var meta = await window.Api.get('/api/keys/me');
        var privateKey = await window.App.recoverIdentity(password, meta);
        if (!privateKey) {
          window.UI.toast('That password did not open the key', { icon: 'warning' });
          return;
        }
        window.UI.toast('Encryption key restored', { icon: 'shield' });
      } catch (err) {
        window.UI.toast(err.message || 'Could not restore the key', { icon: 'warning' });
      }
    }
  }

  window.Screens = window.Screens || {};
  window.Screens.auth = {
    paramNames: [],
    render: function (view, params, query, api) {
      api.setTitle([el('span', { html: icon('lock', 20) }), el('span', { text: 'Sign in' })]);
      signIn(view, api);
    },
  };
  window.Screens['auth/signup'] = {
    paramNames: [],
    render: function (view, params, query, api) {
      api.setTitle([el('span', { html: icon('user-plus', 20) }), el('span', { text: 'Create account' })]);
      signUp(view, api);
    },
  };
  window.Screens.auth.recoverKeys = recoverKeys;
})();
