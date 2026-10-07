'use strict';
/**
 * Room key distribution.
 *
 * A room key is 32 random bytes generated on a device, wrapped per member with
 * the pairwise X25519 key and stored as opaque blobs on the server. The server
 * can hand out the blobs; it cannot read them.
 *
 * Honest ceiling: when someone joins after the room already has a key, this
 * device rotates the key and re-wraps it for the current member list. The UI
 * says so rather than pretending the old key is still in use.
 */
(function () {
  var cache = {};

  function cacheKey(scope, scopeId) { return scope + ':' + scopeId; }

  async function members(scope, scopeId) {
    var data = await window.Api.get('/api/keys/members/' + scope + '/' + encodeURIComponent(scopeId));
    return (data && data.members) || [];
  }

  function usable(member) {
    return member && member.identityPublicKey;
  }

  /**
   * Get (or create) the media key for a scope.
   *
   * Distribution: a member writes one row per recipient, sealed with the
   * pairwise key between the writer and that recipient; a reader only ever
   * sees rows addressed to their own user id. So a late joiner's device makes
   * a new key and writes a copy for everyone already in the room, which is why
   * the UI announces a rekey instead of pretending nothing changed.
   *
   * @returns {Promise<{keyB64:string, keyIndex:number, created:boolean, rekeyed:boolean}>}
   */
  async function ensure(scope, scopeId, options) {
    var opts = options || {};
    var id = cacheKey(scope, scopeId);
    if (!opts.force && cache[id]) return cache[id];

    var me = window.Api.user();
    var identity = await window.E2EE.ensureIdentity();
    var peerList = await members(scope, scopeId);
    var mine = peerList.filter(function (member) { return member.userId === me.id; })[0];
    if (!mine || !usable(mine)) {
      throw new Error('Publish your encryption key first: Settings, then Encryption key');
    }

    var stored = await window.Api.get('/api/keys/wrapped/' + scope + '/' + encodeURIComponent(scopeId));
    var rows = (stored && stored.keys) || [];
    var latest = rows.length ? rows[rows.length - 1] : null;

    if (latest) {
      var frame = window.E2EE.unpackFrame(latest.wrapped);
      var others = peerList.filter(function (member) { return member.userId !== me.id && usable(member); });
      if (frame) {
        for (var i = 0; i < others.length; i += 1) {
          var opened = await window.E2EE.unwrapRoomKey(
            frame, identity.privateKey, others[i].identityPublicKey,
            scope, scopeId, me.id, others[i].userId, identity.curve,
          );
          if (opened) {
            cache[id] = { keyB64: opened, keyIndex: latest.keyIndex, created: false, rekeyed: false };
            return cache[id];
          }
        }
      }
    }

    // No key, or none addressed to us: make one and write a copy for everyone.
    var keyB64 = window.E2EE.newRoomKey();
    var keyIndex = latest ? latest.keyIndex + 1 : 0;
    var wrappedFor = 0;
    for (var j = 0; j < peerList.length; j += 1) {
      var member = peerList[j];
      if (!usable(member)) continue;
      var sealed = await window.E2EE.wrapRoomKey(
        keyB64, identity.privateKey, member.identityPublicKey,
        scope, scopeId, me.id, member.userId, identity.curve,
      );
      try {
        await window.Api.put('/api/keys/wrapped/' + scope + '/' + encodeURIComponent(scopeId), {
          keyIndex: keyIndex,
          wrapped: window.E2EE.packFrame(sealed),
          forUserId: member.userId,
        });
        if (member.userId !== me.id) wrappedFor += 1;
      } catch (err) {
        // One failed copy must not leave the room without a key.
      }
    }
    cache[id] = { keyB64: keyB64, keyIndex: keyIndex, created: true, rekeyed: !!latest, wrappedFor: wrappedFor };
    return cache[id];
  }

  /** Pairwise key for a DM: derived, never stored. */
  async function forDirect(peer) {
    var me = window.Api.user();
    var identity = await window.E2EE.ensureIdentity();
    if (!peer.identityPublicKey) {
      var fresh = await window.Api.get('/api/keys/user/' + peer.id);
      peer = Object.assign({}, peer, fresh);
    }
    if (!peer.identityPublicKey) return null;
    var scopeId = Math.min(me.id, peer.id) + ':' + Math.max(me.id, peer.id);
    var key = await window.E2EE.derivePairKey(identity.privateKey, peer.identityPublicKey, 'dm', scopeId, me.id, peer.id, identity.curve);
    return {
      key: key,
      scopeId: scopeId,
      fingerprint: peer.fingerprint,
      theirFingerprint: peer.fingerprint,
    };
  }

  function forget(scope, scopeId) {
    delete cache[cacheKey(scope, scopeId)];
  }

  function forgetAll() { cache = {}; }

  window.RoomKey = { ensure: ensure, forDirect: forDirect, forget: forget, forgetAll: forgetAll, members: members };
})();
