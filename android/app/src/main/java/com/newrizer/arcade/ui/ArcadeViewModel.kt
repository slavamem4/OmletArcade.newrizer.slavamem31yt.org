package com.newrizer.arcade.ui

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.newrizer.arcade.crypto.E2EE
import com.newrizer.arcade.data.ApiException
import com.newrizer.arcade.data.ArcadeRepository
import com.newrizer.arcade.data.ChatMessage
import com.newrizer.arcade.data.KeyRecipient
import com.newrizer.arcade.data.McSession
import com.newrizer.arcade.data.McSessionCreate
import com.newrizer.arcade.data.Profile
import com.newrizer.arcade.data.ProfileUpdate
import com.newrizer.arcade.data.Stream
import com.newrizer.arcade.data.StreamCreate
import com.newrizer.arcade.data.VoiceRoom
import com.newrizer.arcade.data.VoiceRoomCreate
import com.newrizer.arcade.rtc.RtcEngine
import com.newrizer.arcade.service.BroadcastService
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class AuthState(
    val signedIn: Boolean = false,
    val uid: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

data class FeedState(
    val streams: List<Stream> = emptyList(),
    val voiceRooms: List<VoiceRoom> = emptyList(),
    val mcSessions: List<McSession> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

data class RoomState(
    val roomId: String? = null,
    val title: String = "",
    val isHost: Boolean = false,
    val connected: Boolean = false,
    val microphoneOn: Boolean = false,
    val screenShareOn: Boolean = false,
    val encrypted: Boolean = false,
    val joinCode: String? = null,
    val members: List<String> = emptyList(),
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
)

class ArcadeViewModel(application: Application) : AndroidViewModel(application) {

    private val rtc = RtcEngine(application)

    private val _auth = MutableStateFlow(AuthState(signedIn = FirebaseAuth.getInstance().currentUser != null))
    val auth: StateFlow<AuthState> = _auth.asStateFlow()

    private val _feed = MutableStateFlow(FeedState())
    val feed: StateFlow<FeedState> = _feed.asStateFlow()

    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()

    private val _room = MutableStateFlow(RoomState())
    val room: StateFlow<RoomState> = _room.asStateFlow()

    /** Lives only in memory, never persisted, wiped when the room closes. */
    private var roomKey: ByteArray? = null
    private var roomKeyId: String? = null
    private var memberJob: Job? = null
    private var chatJob: Job? = null

    init {
        viewModelScope.launch {
            rtc.state.collect { state ->
                _room.value = _room.value.copy(
                    connected = state.connected,
                    microphoneOn = state.microphoneOn,
                    screenShareOn = state.screenShareOn,
                    error = state.error ?: _room.value.error,
                )
            }
        }
    }

    // ---- auth -------------------------------------------------------------

    fun signIn(email: String, password: String) = runAuth {
        FirebaseAuth.getInstance().signInWithEmailAndPassword(email.trim(), password).await()
    }

    fun signUp(email: String, password: String, displayName: String) = runAuth {
        FirebaseAuth.getInstance().createUserWithEmailAndPassword(email.trim(), password).await()
        ArcadeRepository.saveProfile(ProfileUpdate(displayName.trim(), avatarId = 0))
    }

    private fun runAuth(block: suspend () -> Unit) {
        _auth.value = _auth.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess {
                    val uid = FirebaseAuth.getInstance().currentUser?.uid
                    _auth.value = AuthState(signedIn = uid != null, uid = uid)
                    runCatching { ArcadeRepository.publishPublicKey() }
                    refreshFeed()
                    loadProfile()
                }
                .onFailure { error ->
                    _auth.value = _auth.value.copy(busy = false, error = readable(error))
                }
        }
    }

    fun signOut() {
        leaveRoom()
        FirebaseAuth.getInstance().signOut()
        _auth.value = AuthState()
        _feed.value = FeedState()
        _profile.value = null
    }

    fun bootstrap() {
        if (FirebaseAuth.getInstance().currentUser == null) return
        _auth.value = _auth.value.copy(signedIn = true, uid = ArcadeRepository.uid)
        viewModelScope.launch {
            runCatching { ArcadeRepository.publishPublicKey() }
            loadProfile()
            refreshFeed()
        }
    }

    private fun loadProfile() {
        viewModelScope.launch {
            runCatching { ArcadeRepository.loadProfile() }
                .onSuccess { _profile.value = it.profile }
        }
    }

    fun saveProfile(displayName: String, avatarId: Int, bio: String) {
        viewModelScope.launch {
            runCatching { ArcadeRepository.saveProfile(ProfileUpdate(displayName, avatarId, bio)) }
                .onSuccess { _profile.value = it.profile }
                .onFailure { _feed.value = _feed.value.copy(error = readable(it)) }
        }
    }

    // ---- feed -------------------------------------------------------------

    fun refreshFeed() {
        _feed.value = _feed.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching {
                Triple(
                    ArcadeRepository.streams(),
                    ArcadeRepository.voiceRooms(),
                    ArcadeRepository.mcSessions(),
                )
            }
                .onSuccess { (streams, voice, mc) ->
                    _feed.value = FeedState(streams = streams, voiceRooms = voice, mcSessions = mc)
                }
                .onFailure { _feed.value = _feed.value.copy(loading = false, error = readable(it)) }
        }
    }

    // ---- sessions ---------------------------------------------------------

    fun startStream(title: String, game: String, visibility: String) = withRoomBusy {
        val created = ArcadeRepository.startStream(
            StreamCreate(title = title, game = game, visibility = visibility),
        )
        openRoom(created.id, created.stream.title, isHost = true, joinCode = null)
    }

    fun watchStream(stream: Stream) = withRoomBusy {
        ArcadeRepository.joinStream(stream.id)
        openRoom(stream.id, stream.title, isHost = false, joinCode = null)
    }

    fun createVoiceRoom(title: String, maxParticipants: Int) = withRoomBusy {
        val id = ArcadeRepository.createVoiceRoom(VoiceRoomCreate(title, maxParticipants))
        openRoom(id, title, isHost = true, joinCode = null)
    }

    fun joinVoiceRoom(room: VoiceRoom) = withRoomBusy {
        ArcadeRepository.joinVoiceRoom(room.id)
        openRoom(room.id, room.title, isHost = false, joinCode = null)
    }

    fun hostMinecraft(create: McSessionCreate) = withRoomBusy {
        val created = ArcadeRepository.hostMinecraft(create)
        openRoom(created.id, created.session.name, isHost = true, joinCode = created.joinCode)
    }

    fun joinPublicMinecraft(session: McSession) = withRoomBusy {
        val joined = ArcadeRepository.joinPublicMinecraft(session.id)
        openRoom(joined.id, joined.session.name, isHost = false, joinCode = null)
    }

    fun joinMinecraft(code: String) = withRoomBusy {
        val joined = ArcadeRepository.joinMinecraft(code)
        openRoom(joined.id, joined.session.name, isHost = false, joinCode = null)
    }

    private fun withRoomBusy(block: suspend () -> Unit) {
        _room.value = _room.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }
                .onFailure { _room.value = _room.value.copy(busy = false, error = readable(it)) }
        }
    }

    /**
     * Opens a session: the host mints a fresh room key and wraps it for every
     * member; a guest unwraps the envelope addressed to it. The key is then
     * handed to LiveKit so media frames are encrypted before leaving the phone.
     */
    private suspend fun openRoom(roomId: String, title: String, isHost: Boolean, joinCode: String?) {
        _room.value = RoomState(roomId = roomId, title = title, isHost = isHost, joinCode = joinCode, busy = true)

        val key: ByteArray
        val keyId: String
        if (isHost) {
            // Fresh key per session; it is wrapped for members in observeRoom.
            key = E2EE.newRoomKey()
            keyId = E2EE.publicKeyId()
        } else {
            // The host wraps the key once it sees the new member, so the first
            // read can legitimately arrive before the envelope exists.
            val envelope = awaitKeyEnvelope(roomId)
            key = E2EE.unwrapRoomKey(envelope.wrappedKey, roomId.toByteArray())
            keyId = envelope.keyId
        }
        roomKey = key
        roomKeyId = keyId

        val grant = ArcadeRepository.rtcToken(roomId, publish = isHost)
        rtc.connect(grant.url, grant.token, E2EE.encodeKey(key))

        _room.value = _room.value.copy(busy = false, encrypted = true)
        observeRoom(roomId)
    }

    private suspend fun awaitKeyEnvelope(roomId: String): com.newrizer.arcade.data.KeyEnvelope {
        var lastError: Throwable? = null
        repeat(KEY_WAIT_ATTEMPTS) { attempt ->
            val result = runCatching { ArcadeRepository.roomKeyEnvelope(roomId).envelope }
            result.getOrNull()?.let { return it }
            lastError = result.exceptionOrNull()
            kotlinx.coroutines.delay(KEY_WAIT_DELAY_MS)
            if (attempt == KEY_WAIT_ATTEMPTS - 1) {
                throw IllegalStateException(
                    "The host has not shared a key for this session yet",
                    lastError,
                )
            }
        }
        throw IllegalStateException("The host has not shared a key for this session yet", lastError)
    }

    private fun observeRoom(roomId: String) {
        memberJob?.cancel()
        chatJob?.cancel()
        memberJob = viewModelScope.launch {
            ArcadeRepository.members(roomId)
                .catch { _room.value = _room.value.copy(error = readable(it)) }
                .collect { members ->
                    _room.value = _room.value.copy(members = members)
                    // A new member needs its own wrapped copy of the key.
                    val key = roomKey
                    val keyId = roomKeyId
                    if (_room.value.isHost && key != null && keyId != null) {
                        val recipients = members.mapNotNull { uid ->
                            runCatching {
                                val record = ArcadeRepository.publicKeyOf(uid).key
                                KeyRecipient(uid, E2EE.wrapRoomKey(key, record.publicKey, roomId.toByteArray()))
                            }.getOrNull()
                        }
                        if (recipients.isNotEmpty()) {
                            runCatching { ArcadeRepository.shareRoomKey(roomId, keyId, recipients) }
                        }
                    }
                }
        }
        chatJob = viewModelScope.launch {
            ArcadeRepository.chat(roomId) { roomKey }
                .catch { _room.value = _room.value.copy(error = readable(it)) }
                .collect { messages -> _room.value = _room.value.copy(messages = messages) }
        }
    }

    fun sendMessage(text: String) {
        val roomId = _room.value.roomId ?: return
        val key = roomKey ?: return
        val keyId = roomKeyId ?: return
        runCatching { ArcadeRepository.sendChat(roomId, key, keyId, text) }
            .onFailure { _room.value = _room.value.copy(error = readable(it)) }
    }

    fun toggleMicrophone() {
        viewModelScope.launch { rtc.setMicrophone(!_room.value.microphoneOn) }
    }

    fun startScreenShare(projectionData: Intent) {
        BroadcastService.start(getApplication())
        viewModelScope.launch { rtc.setScreenShare(true, projectionData) }
    }

    fun stopScreenShare() {
        viewModelScope.launch { rtc.setScreenShare(false, null) }
        BroadcastService.stop(getApplication())
    }

    fun leaveRoom() {
        val state = _room.value
        memberJob?.cancel()
        chatJob?.cancel()
        rtc.disconnect()
        BroadcastService.stop(getApplication())
        E2EE.wipe(roomKey)
        roomKey = null
        roomKeyId = null
        val roomId = state.roomId
        if (state.isHost && roomId != null) {
            viewModelScope.launch {
                runCatching {
                    when {
                        roomId.startsWith("stream_") -> ArcadeRepository.endStream(roomId)
                        roomId.startsWith("voice_") -> ArcadeRepository.endVoiceRoom(roomId)
                        else -> ArcadeRepository.endMinecraft(roomId)
                    }
                }
                refreshFeed()
            }
        }
        _room.value = RoomState()
    }

    override fun onCleared() {
        super.onCleared()
        rtc.disconnect()
        E2EE.wipe(roomKey)
        roomKey = null
    }

    private companion object {
        const val KEY_WAIT_ATTEMPTS = 12
        const val KEY_WAIT_DELAY_MS = 1200L
    }

    private fun readable(error: Throwable): String = when (error) {
        is ApiException -> error.message
        else -> error.message ?: "Something went wrong"
    }
}
