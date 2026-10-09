package com.newrizer.arcade.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.newrizer.arcade.crypto.E2EE
import com.newrizer.arcade.data.ApiException
import com.newrizer.arcade.data.ArcadeRepository
import com.newrizer.arcade.data.ChatMessage
import com.newrizer.arcade.data.EmailProofStore
import com.newrizer.arcade.data.ImageCodec
import com.newrizer.arcade.data.KeyEnvelope
import com.newrizer.arcade.data.Lan
import com.newrizer.arcade.data.McSession
import com.newrizer.arcade.data.McSessionCreate
import com.newrizer.arcade.data.Mission
import com.newrizer.arcade.data.Post
import com.newrizer.arcade.data.Profile
import com.newrizer.arcade.data.RoomHandle
import com.newrizer.arcade.data.Stream
import com.newrizer.arcade.data.StreamCreate
import com.newrizer.arcade.data.UserCard
import com.newrizer.arcade.data.VoiceRoom
import com.newrizer.arcade.rtc.RtcEngine
import com.newrizer.arcade.service.BroadcastService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

enum class AuthStage { CREDENTIALS, VERIFY_EMAIL, READY }

data class AuthState(
    val stage: AuthStage = AuthStage.CREDENTIALS,
    val signedIn: Boolean = false,
    val uid: String? = null,
    val email: String = "",
    val busy: Boolean = false,
    val codeSent: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

data class FeedState(
    val streams: List<Stream> = emptyList(),
    val voiceRooms: List<VoiceRoom> = emptyList(),
    val mcSessions: List<McSession> = emptyList(),
    val posts: List<Post> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

data class SearchState(
    val query: String = "",
    val results: List<UserCard> = emptyList(),
    val searching: Boolean = false,
)

data class ProfileState(
    val profile: Profile? = null,
    val missions: List<Mission> = emptyList(),
    val posts: List<Post> = emptyList(),
    val busy: Boolean = false,
    val notice: String? = null,
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
    val lanAddress: String? = null,
    val members: List<String> = emptyList(),
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
)

class ArcadeViewModel(application: Application) : AndroidViewModel(application) {

    private val rtc = RtcEngine(application)

    private val _auth = MutableStateFlow(AuthState())
    val auth: StateFlow<AuthState> = _auth.asStateFlow()

    private val _feed = MutableStateFlow(FeedState())
    val feed: StateFlow<FeedState> = _feed.asStateFlow()

    private val _search = MutableStateFlow(SearchState())
    val search: StateFlow<SearchState> = _search.asStateFlow()

    private val _profile = MutableStateFlow(ProfileState())
    val profile: StateFlow<ProfileState> = _profile.asStateFlow()

    private val _room = MutableStateFlow(RoomState())
    val room: StateFlow<RoomState> = _room.asStateFlow()

    /** Lives only in memory, never persisted, wiped when the room closes. */
    private var roomKey: ByteArray? = null
    private var roomKeyId: String? = null
    private var challenge: String? = null
    private var memberJob: Job? = null
    private var chatJob: Job? = null
    private var searchJob: Job? = null

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

    // ---- auth ---------------------------------------------------------------

    fun signIn(email: String, password: String) = runAuth(email) {
        FirebaseAuth.getInstance().signInWithEmailAndPassword(email.trim(), password).await()
    }

    fun signUp(email: String, password: String, displayName: String) = runAuth(email) {
        require(displayName.trim().length >= 2) { "Имя от 2 символов" }
        require(password.length >= 8) { "Пароль от 8 символов" }
        FirebaseAuth.getInstance().createUserWithEmailAndPassword(email.trim(), password).await()
        ArcadeRepository.saveProfile(displayName.trim(), avatarId = 0, bio = "")
    }

    private fun runAuth(email: String, block: suspend () -> Unit) {
        _auth.value = _auth.value.copy(busy = true, error = null, notice = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess {
                    val uid = FirebaseAuth.getInstance().currentUser?.uid
                    runCatching { ArcadeRepository.publishPublicKey() }
                    if (ArcadeRepository.emailVerified()) {
                        _auth.value = AuthState(AuthStage.READY, signedIn = true, uid = uid, email = email.trim())
                        afterSignIn()
                    } else {
                        _auth.value = AuthState(
                            stage = AuthStage.VERIFY_EMAIL,
                            signedIn = true,
                            uid = uid,
                            email = email.trim(),
                        )
                        requestEmailCode()
                    }
                }
                .onFailure { error ->
                    _auth.value = _auth.value.copy(busy = false, error = readable(error))
                }
        }
    }

    /** Asks the backend to mail a six digit code to the account address. */
    fun requestEmailCode() {
        val address = _auth.value.email.ifEmpty { ArcadeRepository.email.orEmpty() }
        if (address.isEmpty()) {
            _auth.value = _auth.value.copy(error = "Нет адреса почты у аккаунта")
            return
        }
        _auth.value = _auth.value.copy(busy = true, error = null, notice = null)
        viewModelScope.launch {
            runCatching { ArcadeRepository.sendEmailCode(address) }
                .onSuccess {
                    challenge = it.challenge
                    _auth.value = _auth.value.copy(
                        busy = false,
                        codeSent = true,
                        notice = "Код отправлен на $address",
                    )
                }
                .onFailure {
                    _auth.value = _auth.value.copy(busy = false, error = readable(it))
                }
        }
    }

    fun confirmEmailCode(code: String) {
        val pending = challenge
        if (pending == null) {
            requestEmailCode()
            return
        }
        _auth.value = _auth.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { ArcadeRepository.confirmEmailCode(pending, code) }
                .onSuccess {
                    challenge = null
                    _auth.value = _auth.value.copy(stage = AuthStage.READY, busy = false, notice = null)
                    afterSignIn()
                }
                .onFailure { _auth.value = _auth.value.copy(busy = false, error = readable(it)) }
        }
    }

    fun signOut() {
        leaveRoom()
        EmailProofStore.clear()
        FirebaseAuth.getInstance().signOut()
        _auth.value = AuthState()
        _feed.value = FeedState()
        _profile.value = ProfileState()
        _search.value = SearchState()
    }

    fun bootstrap() {
        val user = FirebaseAuth.getInstance().currentUser ?: return
        val verified = ArcadeRepository.emailVerified()
        _auth.value = AuthState(
            stage = if (verified) AuthStage.READY else AuthStage.VERIFY_EMAIL,
            signedIn = true,
            uid = user.uid,
            email = user.email.orEmpty(),
        )
        if (verified) {
            viewModelScope.launch { runCatching { ArcadeRepository.publishPublicKey() } }
            afterSignIn()
        }
    }

    private fun afterSignIn() {
        loadProfile()
        refreshFeed()
    }

    // ---- profile -------------------------------------------------------------

    private fun loadProfile() {
        viewModelScope.launch {
            runCatching {
                Triple(
                    ArcadeRepository.loadProfile(),
                    ArcadeRepository.missions(),
                    ArcadeRepository.postsOf(ArcadeRepository.uid.orEmpty()),
                )
            }.onSuccess { (profile, missions, posts) ->
                _profile.value = _profile.value.copy(
                    profile = profile,
                    missions = missions,
                    posts = posts,
                    busy = false,
                )
            }
        }
    }

    fun saveProfile(displayName: String, bio: String, avatar: Uri?) {
        _profile.value = _profile.value.copy(busy = true, notice = null)
        viewModelScope.launch {
            runCatching {
                val photo = avatar?.let { ImageCodec.encodeAvatar(getApplication(), it) }
                ArcadeRepository.saveProfile(displayName, avatarId = 0, bio = bio, photo = photo)
            }
                .onSuccess {
                    _profile.value = _profile.value.copy(profile = it, busy = false, notice = "Сохранено")
                }
                .onFailure {
                    _profile.value = _profile.value.copy(busy = false, notice = readable(it))
                }
        }
    }

    fun publishPost(text: String, image: Uri?) {
        _profile.value = _profile.value.copy(busy = true, notice = null)
        viewModelScope.launch {
            runCatching {
                val encoded = image?.let { ImageCodec.encodePost(getApplication(), it) }
                if (image != null && encoded == null) error("Не удалось сжать картинку")
                ArcadeRepository.publishPost(text, encoded)
            }
                .onSuccess {
                    _profile.value = _profile.value.copy(busy = false, notice = "Пост опубликован")
                    loadProfile()
                    refreshFeed()
                }
                .onFailure { _profile.value = _profile.value.copy(busy = false, notice = readable(it)) }
        }
    }

    fun deletePost(postId: String) {
        viewModelScope.launch {
            runCatching { ArcadeRepository.deletePost(postId) }
                .onSuccess { loadProfile(); refreshFeed() }
        }
    }

    // ---- feed and search -----------------------------------------------------

    fun refreshFeed() {
        _feed.value = _feed.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching {
                FeedState(
                    streams = ArcadeRepository.streams(),
                    voiceRooms = ArcadeRepository.voiceRooms(),
                    mcSessions = ArcadeRepository.mcSessions(),
                    posts = ArcadeRepository.feedPosts(),
                )
            }
                .onSuccess { _feed.value = it }
                .onFailure { _feed.value = _feed.value.copy(loading = false, error = readable(it)) }
        }
    }

    fun onSearchChange(query: String) {
        _search.value = _search.value.copy(query = query, searching = query.trim().length >= 2)
        searchJob?.cancel()
        if (query.trim().length < 2) {
            _search.value = _search.value.copy(results = emptyList(), searching = false)
            return
        }
        searchJob = viewModelScope.launch {
            delay(300)
            runCatching { ArcadeRepository.searchUsers(query) }
                .onSuccess { _search.value = _search.value.copy(results = it, searching = false) }
                .onFailure { _search.value = _search.value.copy(results = emptyList(), searching = false) }
        }
    }

    fun clearSearch() {
        searchJob?.cancel()
        _search.value = SearchState()
    }

    // ---- sessions ------------------------------------------------------------

    fun startStream(title: String, game: String, visibility: String) = withRoomBusy {
        openRoom(ArcadeRepository.startStream(StreamCreate(title, game, visibility)))
    }

    fun watchStream(stream: Stream) = withRoomBusy {
        openRoom(ArcadeRepository.joinStream(stream))
    }

    fun createVoiceRoom(title: String, maxParticipants: Int) = withRoomBusy {
        openRoom(ArcadeRepository.createVoiceRoom(title, maxParticipants))
    }

    fun joinVoiceRoom(room: VoiceRoom) = withRoomBusy {
        openRoom(ArcadeRepository.joinVoiceRoom(room))
    }

    fun hostMinecraft(create: McSessionCreate) = withRoomBusy {
        openRoom(ArcadeRepository.hostMinecraft(create, Lan.address()))
    }

    fun joinPublicMinecraft(session: McSession) = withRoomBusy {
        openRoom(ArcadeRepository.joinMinecraft(session))
    }

    fun joinByCode(code: String) = withRoomBusy {
        openRoom(ArcadeRepository.joinByCode(code))
    }

    private fun withRoomBusy(block: suspend () -> Unit) {
        _room.value = _room.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }.onFailure { _room.value = RoomState(error = readable(it)) }
        }
    }

    /**
     * Opens a session. Encrypted rooms mint or unwrap a key before connecting;
     * a public broadcast connects straight away, because a stream everyone may
     * watch gains nothing from end to end encryption and the wait for a key
     * was the thing that kept viewers out.
     */
    private suspend fun openRoom(handle: RoomHandle) {
        _room.value = RoomState(
            roomId = handle.roomId,
            title = handle.title,
            isHost = handle.isOwner,
            joinCode = handle.joinCode,
            lanAddress = handle.lanAddress,
            encrypted = handle.encrypted,
            busy = true,
        )

        var key: ByteArray? = null
        var keyId: String? = null
        if (handle.isOwner) {
            key = E2EE.newRoomKey()
            keyId = E2EE.publicKeyId()
        } else {
            val envelope = awaitKeyEnvelope(handle.roomId, required = handle.encrypted)
            if (envelope != null) {
                key = E2EE.unwrapRoomKey(envelope.wrappedKey, handle.roomId.toByteArray())
                keyId = envelope.keyId
            }
        }
        roomKey = key
        roomKeyId = keyId

        val grant = ArcadeRepository.rtcToken(handle.roomId, publish = handle.isOwner)
        rtc.connect(
            url = grant.url,
            token = grant.token,
            roomKeyBase64 = if (handle.encrypted && key != null) E2EE.encodeKey(key) else null,
        )

        _room.value = _room.value.copy(busy = false)
        observeRoom(handle.roomId)
    }

    /** The host wraps a key only after it sees the member, so this polls. */
    private suspend fun awaitKeyEnvelope(roomId: String, required: Boolean): KeyEnvelope? {
        repeat(KEY_WAIT_ATTEMPTS) {
            val envelope = runCatching { ArcadeRepository.roomKeyEnvelope(roomId) }.getOrNull()
            if (envelope != null) return envelope
            delay(KEY_WAIT_DELAY_MS)
        }
        if (required) error("Хост ещё не раздал ключ этой сессии")
        return null
    }

    private fun observeRoom(roomId: String) {
        memberJob?.cancel()
        chatJob?.cancel()
        memberJob = viewModelScope.launch {
            ArcadeRepository.members(roomId)
                .catch { _room.value = _room.value.copy(error = readable(it)) }
                .collect { members ->
                    _room.value = _room.value.copy(members = members)
                    val key = roomKey
                    val keyId = roomKeyId
                    if (_room.value.isHost && key != null && keyId != null) {
                        runCatching { ArcadeRepository.shareRoomKey(roomId, key, keyId, members) }
                        runCatching { ArcadeRepository.publishHeadcount(roomId, members.size) }
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
            .onSuccess { viewModelScope.launch { ArcadeRepository.advanceMission("talker") } }
            .onFailure { _room.value = _room.value.copy(error = readable(it)) }
    }

    fun kick(memberUid: String) {
        val roomId = _room.value.roomId ?: return
        if (!_room.value.isHost) return
        viewModelScope.launch {
            runCatching { ArcadeRepository.kick(roomId, memberUid) }
                .onFailure { _room.value = _room.value.copy(error = readable(it)) }
        }
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
        if (roomId != null) {
            viewModelScope.launch {
                if (state.isHost) {
                    runCatching { ArcadeRepository.closeRoom(roomId, state.joinCode) }
                }
                refreshFeed()
                loadProfile()
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

    private fun readable(error: Throwable): String = when (error) {
        is ApiException -> error.message
        else -> error.message ?: "Что-то пошло не так"
    }

    private companion object {
        const val KEY_WAIT_ATTEMPTS = 10
        const val KEY_WAIT_DELAY_MS = 900L
    }
}
