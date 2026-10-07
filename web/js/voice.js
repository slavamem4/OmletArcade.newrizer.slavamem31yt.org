'use strict';
/**
 * Voice and video over LiveKit.
 *
 * The token comes from this backend and is room-scoped and short lived; the
 * LiveKit API key never reaches the client. Media encryption is turned on with
 * the room key that the E2EE module holds, so the media server relays frames it
 * cannot decode.
 */
(function () {
  var LK = window.LivekitClient;
  var room = null;
  var localAudio = null;
  var localVideo = null;
  var screenTrack = null;
  var keyProvider = null;
  var e2eeWorker = null;
  var currentRoomKey = null;
  var state = { connected: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, e2ee: false };
  var listeners = {};
  var audioHost = null;

  function emit(type, payload) {
    (listeners[type] || []).forEach(function (handler) {
      try { handler(payload); } catch (err) { console.error('voice handler failed', type, err); }
    });
  }

  function on(type, handler) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(handler);
    return function () {
      listeners[type] = (listeners[type] || []).filter(function (item) { return item !== handler; });
    };
  }

  function ensureAudioHost() {
    if (audioHost && audioHost.parentNode) return audioHost;
    audioHost = window.Dom.el('div', { class: 'hidden', 'aria-hidden': 'true' });
    document.body.appendChild(audioHost);
    return audioHost;
  }

  function participantView(participant) {
    var meta = {};
    try { meta = participant.metadata ? JSON.parse(participant.metadata) : {}; } catch (err) { meta = {}; }
    var audioPub = null;
    var videoPub = null;
    participant.trackPublications.forEach(function (pub) {
      if (!pub) return;
      if (pub.kind === 'audio' || pub.source === 'microphone') audioPub = pub;
      if (pub.kind === 'video') videoPub = pub;
    });
    return {
      identity: participant.identity,
      userId: /^u\d+$/.test(participant.identity) ? Number(participant.identity.slice(1)) : null,
      name: participant.name || participant.identity,
      isLocal: !!participant.isLocal,
      micOn: !!(audioPub && !audioPub.isMuted),
      cameraOn: !!(videoPub && !videoPub.isMuted && videoPub.source !== 'screen_share'),
      screenOn: !!(videoPub && videoPub.source === 'screen_share'),
      quality: participant.connectionQuality || 'unknown',
      role: meta.role || 'member',
    };
  }

  function roster() {
    if (!room) return [];
    var out = [];
    if (room.localParticipant) out.push(participantView(room.localParticipant));
    room.remoteParticipants.forEach(function (participant) { out.push(participantView(participant)); });
    return out;
  }

  function attachRemote(track, participant) {
    if (!track) return;
    if (track.kind === 'audio') {
      var host = ensureAudioHost();
      var element = track.attach();
      element.dataset.identity = participant.identity;
      element.autoplay = true;
      element.playsInline = true;
      // Unlocking here is what makes remote audio audible on mobile WebViews
      // that gate autoplay behind a gesture; join is always a tap.
      var played = element.play();
      if (played && played.catch) played.catch(function () { unlockAudio(); });
      host.appendChild(element);
    }
  }

  function detachRemote(track) {
    if (!track) return;
    try {
      var elements = track.detach();
      (elements || []).forEach(function (element) {
        if (element && element.parentNode) element.parentNode.removeChild(element);
      });
    } catch (err) { /* already detached */ }
  }

  async function unlockAudio() {
    try {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!unlockAudio.ctx) unlockAudio.ctx = new AudioCtor();
      if (unlockAudio.ctx.state === 'suspended') await unlockAudio.ctx.resume();
    } catch (err) { /* autoplay policy will resolve on the next gesture */ }
  }

  function buildRoom(e2eeEnabled, roomKey) {
    var options = {
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        dtx: true,
        red: true,
        audioCodec: 'opus',
        simulcast: true,
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };

    if (e2eeEnabled && LK.ExternalE2EEKeyProvider && LK.E2EEManager) {
      try {
        keyProvider = new LK.ExternalE2EEKeyProvider({ keySize: 256, ratchetSalt: 'omlet-arcade/e2ee/v1', ratchetWindowSize: 16, keyringSize: 8, failureTolerance: 3 });
        e2eeWorker = new Worker('assets/vendor/livekit-client.e2ee.worker.js');
        options.e2ee = { keyProvider: keyProvider, worker: e2eeWorker };
        state.e2ee = true;
      } catch (err) {
        console.warn('e2ee unavailable, falling back to transport encryption only', err);
        keyProvider = null;
        e2eeWorker = null;
        state.e2ee = false;
      }
    }
    return new LK.Room(options);
  }

  async function connect(grant, options) {
    var opts = options || {};
    await disconnect();
    await unlockAudio();
    room = buildRoom(opts.e2ee !== false, opts.roomKey);

    room.on(LK.RoomEvent.ParticipantConnected, function () { emit('roster', roster()); });
    room.on(LK.RoomEvent.ParticipantDisconnected, function () { emit('roster', roster()); });
    room.on(LK.RoomEvent.TrackSubscribed, function (track, pub, participant) { attachRemote(track, participant); emit('roster', roster()); });
    room.on(LK.RoomEvent.TrackUnsubscribed, function (track) { detachRemote(track); emit('roster', roster()); });
    room.on(LK.RoomEvent.TrackMuted, function () { emit('roster', roster()); });
    room.on(LK.RoomEvent.TrackUnmuted, function () { emit('roster', roster()); });
    room.on(LK.RoomEvent.ActiveSpeakersChanged, function (speakers) {
      emit('speakers', (speakers || []).map(function (speaker) {
        return { identity: speaker.identity, userId: /^u\d+$/.test(speaker.identity) ? Number(speaker.identity.slice(1)) : null };
      }));
    });
    room.on(LK.RoomEvent.MediaDevicesChanged, function () { emit('devices', {}); });
    room.on(LK.RoomEvent.Disconnected, function () {
      state.connected = false;
      emit('disconnected', {});
    });
    room.on(LK.RoomEvent.ConnectionStateChanged, function (next) { emit('connection', next); });

    await room.connect(grant.url, grant.token, { autoSubscribe: true });
    state.connected = true;

    if (opts.roomKey && keyProvider && keyProvider.setKey) {
      try {
        await keyProvider.setKey(window.E2EE.roomKeyBytes(opts.roomKey));
        currentRoomKey = opts.roomKey;
      } catch (err) {
        console.warn('room key could not be applied', err);
        state.e2ee = false;
        emit('e2ee_failed', { message: 'Media encryption could not start' });
      }
    }

    if (opts.mic !== false) {
      try { await enableMic(); } catch (err) { emit('mic_error', { message: err.message || 'Microphone unavailable' }); }
    }
    if (opts.camera) {
      try { await enableCamera(); } catch (err) { /* camera is optional */ }
    }

    emit('connected', { room: grant.room, e2ee: state.e2ee });
    emit('roster', roster());
    return roster();
  }

  async function enableMic() {
    if (!room) throw new Error('not connected');
    if (!localAudio) {
      localAudio = await LK.createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    }
    await room.localParticipant.publishTrack(localAudio, { source: LK.Track.Source.Microphone });
    localAudio.setMuted(false);
    state.micEnabled = true;
    emit('mic', { enabled: true });
    emit('roster', roster());
    return true;
  }

  async function setMic(enabled) {
    if (enabled && !localAudio) return enableMic();
    if (!localAudio) return false;
    await localAudio.setMuted(!enabled);
    state.micEnabled = enabled;
    emit('mic', { enabled: enabled });
    emit('roster', roster());
    return enabled;
  }

  async function enableCamera() {
    if (!room) throw new Error('not connected');
    if (!localVideo) {
      localVideo = await LK.createLocalVideoTrack({ resolution: { width: 640, height: 480, frameRate: 24 }, facingMode: 'user' });
    }
    await room.localParticipant.publishTrack(localVideo, { source: LK.Track.Source.Camera });
    state.cameraEnabled = true;
    emit('camera', { enabled: true, track: localVideo });
    emit('roster', roster());
    return localVideo;
  }

  async function setCamera(enabled) {
    if (enabled) return enableCamera();
    if (localVideo) {
      await localVideo.setMuted(true);
      try { localVideo.stop(); } catch (err) { /* already stopped */ }
      localVideo = null;
    }
    state.cameraEnabled = false;
    emit('camera', { enabled: false });
    emit('roster', roster());
    return false;
  }

  async function toggleScreen() {
    if (!room) throw new Error('not connected');
    if (screenTrack) {
      try { screenTrack.stop(); } catch (err) { /* noop */ }
      screenTrack = null;
      state.screenEnabled = false;
      emit('screen', { enabled: false });
      emit('roster', roster());
      return false;
    }
    var tracks = await LK.createLocalScreenTracks({ audio: false });
    screenTrack = tracks[0] || null;
    if (!screenTrack) throw new Error('Screen capture was cancelled');
    await room.localParticipant.publishTrack(screenTrack, { source: LK.Track.Source.ScreenShare });
    state.screenEnabled = true;
    emit('screen', { enabled: true });
    emit('roster', roster());
    return true;
  }

  /** Rotate the room key after a member leaves: the classic post-compromise fix. */
  async function rotateKey() {
    if (!keyProvider || !keyProvider.setKey) return null;
    var next = window.E2EE.newRoomKey();
    await keyProvider.setKey(window.E2EE.roomKeyBytes(next));
    currentRoomKey = next;
    emit('key_rotated', {});
    return next;
  }

  async function setVolume(identity, volume) {
    if (!room) return;
    var participant = room.remoteParticipants.get(identity);
    if (!participant) return;
    participant.trackPublications.forEach(function (pub) {
      if (pub.kind === 'audio' && pub.audioTrack) {
        var elements = pub.audioTrack.attachedElements || [];
        elements.forEach(function (element) { element.volume = Math.max(0, Math.min(1, volume)); });
      }
    });
  }

  async function disconnect() {
    if (e2eeWorker) {
      try { e2eeWorker.terminate(); } catch (err) { /* noop */ }
      e2eeWorker = null;
    }
    keyProvider = null;
    currentRoomKey = null;
    if (localAudio) { try { localAudio.stop(); } catch (err) { /* noop */ } localAudio = null; }
    if (localVideo) { try { localVideo.stop(); } catch (err) { /* noop */ } localVideo = null; }
    if (screenTrack) { try { screenTrack.stop(); } catch (err) { /* noop */ } screenTrack = null; }
    if (room) {
      try { await room.disconnect(); } catch (err) { /* already gone */ }
      room = null;
    }
    if (audioHost) window.Dom.clear(audioHost);
    state = { connected: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, e2ee: false };
    emit('disconnected', {});
  }

  window.Voice = {
    connect: connect,
    disconnect: disconnect,
    setMic: setMic,
    setCamera: setCamera,
    toggleScreen: toggleScreen,
    rotateKey: rotateKey,
    setVolume: setVolume,
    roster: roster,
    on: on,
    unlockAudio: unlockAudio,
    state: function () { return Object.assign({}, state); },
    roomName: function () { return room ? room.name : null; },
    available: function () { return !!LK; },
    localVideoTrack: function () { return localVideo; },
  };
})();
