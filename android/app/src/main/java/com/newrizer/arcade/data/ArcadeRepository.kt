package com.newrizer.arcade.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.Query
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import com.newrizer.arcade.crypto.E2EE
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.security.SecureRandom

/**
 * All data access.
 *
 * There is no admin backend: the app reads and writes Realtime Database
 * directly and the database rules are the authority on what is allowed. The
 * Render service is contacted for two things only - a LiveKit grant, and the
 * email confirmation code - because both need secrets the phone must not hold.
 */
object ArcadeRepository {

    private const val ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
    private const val CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private val random = SecureRandom()

    private val auth get() = FirebaseAuth.getInstance()
    private val db get() = FirebaseDatabase.getInstance()

    val uid: String? get() = auth.currentUser?.uid
    val email: String? get() = auth.currentUser?.email

    private fun requireUid(): String = uid ?: error("Войдите в аккаунт")

    private fun randomString(alphabet: String, length: Int): String =
        buildString(length) { repeat(length) { append(alphabet[random.nextInt(alphabet.length)]) } }

    private fun newRoomId(kind: String) = "${kind}_${randomString(ID_ALPHABET, 20)}"

    /** 8 characters from a 32 glyph alphabet: 2^40 combinations, no look-alikes. */
    private fun newJoinCode() = randomString(CODE_ALPHABET, 8)

    // ---- profile ------------------------------------------------------------

    private fun profileOf(snapshot: DataSnapshot): Profile? {
        val name = snapshot.child("displayName").getValue(String::class.java) ?: return null
        return Profile(
            uid = snapshot.key.orEmpty(),
            displayName = name,
            avatarId = (snapshot.child("avatarId").getValue(Long::class.java) ?: 0L).toInt(),
            bio = snapshot.child("bio").getValue(String::class.java) ?: "",
            photo = snapshot.child("photo").getValue(String::class.java) ?: "",
            xp = (snapshot.child("xp").getValue(Long::class.java) ?: 0L).toInt(),
            createdAt = snapshot.child("createdAt").getValue(Long::class.java) ?: 0L,
            updatedAt = snapshot.child("updatedAt").getValue(Long::class.java) ?: 0L,
        )
    }

    suspend fun loadProfile(ofUid: String = requireUid()): Profile? =
        profileOf(db.getReference("users/$ofUid").get().await())

    suspend fun saveProfile(
        displayName: String,
        avatarId: Int,
        bio: String,
        photo: String? = null,
    ): Profile {
        val name = displayName.trim()
        require(name.length in 2..24) { "Имя от 2 до 24 символов" }
        require(bio.length <= 140) { "О себе — не больше 140 символов" }

        val reference = db.getReference("users/${requireUid()}")
        val existing = reference.get().await()
        val createdAt = existing.child("createdAt").getValue(Long::class.java)
        val keptPhoto = photo ?: existing.child("photo").getValue(String::class.java) ?: ""
        val xp = existing.child("xp").getValue(Long::class.java) ?: 0L

        val record = mutableMapOf<String, Any>(
            "displayName" to name,
            "nameLower" to name.lowercase(),
            "avatarId" to avatarId,
            "bio" to bio,
            "xp" to xp,
            "createdAt" to (createdAt ?: ServerValue.TIMESTAMP),
            "updatedAt" to ServerValue.TIMESTAMP,
        )
        if (keptPhoto.isNotEmpty()) record["photo"] = keptPhoto
        reference.updateChildren(record).await()

        return Profile(
            uid = requireUid(),
            displayName = name,
            avatarId = avatarId,
            bio = bio,
            photo = keptPhoto,
            xp = xp.toInt(),
            createdAt = createdAt ?: System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
        )
    }

    /** Case-insensitive prefix search over display names. */
    suspend fun searchUsers(query: String): List<UserCard> {
        val needle = query.trim().lowercase()
        if (needle.length < 2) return emptyList()
        val snapshot = db.getReference("users")
            .orderByChild("nameLower")
            .startAt(needle)
            .endAt(needle + "\uf8ff")
            .limitToFirst(20)
            .get()
            .await()
        return snapshot.children.mapNotNull { child ->
            val profile = profileOf(child) ?: return@mapNotNull null
            UserCard(child.key.orEmpty(), profile.displayName, profile.photo, profile.level)
        }
    }

    // ---- missions and levels -------------------------------------------------

    suspend fun missions(): List<Mission> {
        val snapshot = db.getReference("users/${requireUid()}/missions").get().await()
        val progress = snapshot.children.associate { child ->
            child.key.orEmpty() to (child.getValue(Long::class.java) ?: 0L).toInt()
        }
        return Missions.merge(progress)
    }

    /**
     * Records progress and pays the reward exactly once, when the goal is first
     * reached. Nothing here is money, so the write stays on the client.
     */
    suspend fun advanceMission(id: String, step: Int = 1) {
        val mission = Missions.all.firstOrNull { it.id == id } ?: return
        val root = db.getReference("users/${requireUid()}")
        val before = (root.child("missions/$id").get().await().getValue(Long::class.java) ?: 0L).toInt()
        if (before >= mission.goal) return

        val after = (before + step).coerceAtMost(mission.goal)
        val updates = mutableMapOf<String, Any>("missions/$id" to after, "updatedAt" to ServerValue.TIMESTAMP)
        if (after >= mission.goal) {
            val xp = (root.child("xp").get().await().getValue(Long::class.java) ?: 0L).toInt()
            updates["xp"] = xp + mission.reward
        }
        runCatching { root.updateChildren(updates).await() }
    }

    // ---- posts ---------------------------------------------------------------

    private fun postOf(child: DataSnapshot): Post? {
        val id = child.key ?: return null
        return Post(
            id = id,
            authorUid = child.child("authorUid").getValue(String::class.java) ?: return null,
            authorName = child.child("authorName").getValue(String::class.java) ?: "",
            text = child.child("text").getValue(String::class.java) ?: "",
            image = child.child("image").getValue(String::class.java) ?: "",
            createdAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
        )
    }

    suspend fun publishPost(text: String, imageBase64: String?): Post {
        val body = text.trim()
        require(body.isNotEmpty() || !imageBase64.isNullOrEmpty()) { "Пост пустой" }
        require(body.length <= 500) { "Текст поста — не больше 500 символов" }
        require((imageBase64?.length ?: 0) <= ImageCodec.MAX_BASE64) { "Картинка слишком большая" }

        val author = requireUid()
        val name = loadProfile()?.displayName ?: displayNameOrFallback()
        val reference = db.getReference("posts").push()
        val record = mutableMapOf<String, Any>(
            "authorUid" to author,
            "authorName" to name,
            "text" to body,
            "createdAt" to ServerValue.TIMESTAMP,
        )
        if (!imageBase64.isNullOrEmpty()) record["image"] = imageBase64
        reference.setValue(record).await()
        advanceMission("author")
        return Post(reference.key.orEmpty(), author, name, body, imageBase64 ?: "", System.currentTimeMillis())
    }

    suspend fun feedPosts(limit: Int = 30): List<Post> =
        db.getReference("posts").orderByChild("createdAt").limitToLast(limit).get().await()
            .children.mapNotNull(::postOf).sortedByDescending { it.createdAt }

    suspend fun postsOf(author: String): List<Post> =
        db.getReference("posts").orderByChild("authorUid").equalTo(author).limitToLast(50).get().await()
            .children.mapNotNull(::postOf).sortedByDescending { it.createdAt }

    suspend fun deletePost(postId: String) {
        db.getReference("posts/$postId").removeValue().await()
    }

    // ---- device keys ----------------------------------------------------------

    /** Publishes this device's public key so hosts can wrap room keys for it. */
    suspend fun publishPublicKey() {
        db.getReference("userKeys/${requireUid()}").setValue(
            mapOf(
                "keyId" to E2EE.publicKeyId(),
                "publicKey" to E2EE.publicKeyBase64(),
                "algorithm" to "HPKE_X25519_HKDF_SHA256_AES256GCM",
                "updatedAt" to ServerValue.TIMESTAMP,
            ),
        ).await()
    }

    private suspend fun publicKeyOf(memberUid: String): PublicKeyRecord? {
        val snapshot = db.getReference("userKeys/$memberUid").get().await()
        if (!snapshot.exists()) return null
        val publicKey = snapshot.child("publicKey").getValue(String::class.java) ?: return null
        return PublicKeyRecord(
            keyId = snapshot.child("keyId").getValue(String::class.java) ?: return null,
            publicKey = publicKey,
            algorithm = snapshot.child("algorithm").getValue(String::class.java) ?: "",
        )
    }

    // ---- creating sessions -----------------------------------------------------

    /**
     * Writes happen in two steps on purpose: database rules evaluate `root` as
     * it was *before* the write, so the room record has to land before the
     * membership and the listing that reference it.
     */
    private suspend fun createRoom(
        roomId: String,
        kind: String,
        title: String,
        maxParticipants: Int,
        encrypted: Boolean,
    ) {
        val owner = requireUid()
        require(title.trim().length in 3..60) { "Название от 3 до 60 символов" }
        require(maxParticipants in 2..50) { "Участников от 2 до 50" }

        db.getReference("rooms/$roomId").setValue(
            mapOf(
                "kind" to kind,
                "ownerUid" to owner,
                "ownerName" to displayNameOrFallback(),
                "title" to title.trim(),
                "state" to "live",
                "maxParticipants" to maxParticipants,
                "e2ee" to encrypted,
                "createdAt" to ServerValue.TIMESTAMP,
            ),
        ).await()

        db.getReference("roomMembers/$roomId/$owner").setValue(
            mapOf("role" to "owner", "joinedAt" to ServerValue.TIMESTAMP),
        ).await()
    }

    private fun displayNameOrFallback(): String =
        auth.currentUser?.displayName?.take(24)?.takeIf { it.isNotBlank() } ?: "игрок"

    suspend fun startStream(create: StreamCreate): RoomHandle {
        val roomId = newRoomId("stream")
        val public = create.visibility == "public"
        // A public broadcast is meant to be watchable by anyone, so its media
        // is not end to end encrypted; the chat key still is.
        createRoom(roomId, "stream", create.title, maxParticipants = 50, encrypted = !public)

        if (public) {
            db.getReference("listings/stream/$roomId").setValue(
                mapOf(
                    "ownerUid" to requireUid(),
                    "ownerName" to displayNameOrFallback(),
                    "title" to create.title.trim(),
                    "game" to create.game.take(40),
                    "viewers" to 0,
                    "e2ee" to false,
                    "voiceEnabled" to create.voiceEnabled,
                    "createdAt" to ServerValue.TIMESTAMP,
                ),
            ).await()
        }
        advanceMission("first_stream")
        return RoomHandle(roomId, create.title.trim(), isOwner = true, encrypted = !public)
    }

    suspend fun createVoiceRoom(title: String, maxParticipants: Int): RoomHandle {
        val roomId = newRoomId("voice")
        createRoom(roomId, "voice", title, maxParticipants, encrypted = true)
        db.getReference("listings/voice/$roomId").setValue(
            mapOf(
                "ownerUid" to requireUid(),
                "ownerName" to displayNameOrFallback(),
                "title" to title.trim(),
                "maxParticipants" to maxParticipants,
                "createdAt" to ServerValue.TIMESTAMP,
            ),
        ).await()
        advanceMission("voice")
        return RoomHandle(roomId, title.trim(), isOwner = true, encrypted = true)
    }

    suspend fun hostMinecraft(create: McSessionCreate, lanAddress: String?): RoomHandle {
        val roomId = newRoomId("mc")
        createRoom(roomId, "mc", create.name, create.maxPlayers, encrypted = true)

        val code = newJoinCode()
        db.getReference("joinIndex/$code").setValue(roomId).await()

        if (!create.isPrivate) {
            db.getReference("listings/mc/$roomId").setValue(
                mapOf(
                    "ownerUid" to requireUid(),
                    "ownerName" to displayNameOrFallback(),
                    "title" to create.name.trim(),
                    "version" to create.version,
                    "edition" to create.edition,
                    "gameMode" to create.gameMode,
                    "players" to 1,
                    "maxPlayers" to create.maxPlayers,
                    "createdAt" to ServerValue.TIMESTAMP,
                ),
            ).await()
        }
        if (lanAddress != null) {
            runCatching { db.getReference("rooms/$roomId/lan").setValue(lanAddress).await() }
        }
        advanceMission("host")
        return RoomHandle(
            roomId = roomId,
            title = create.name.trim(),
            isOwner = true,
            encrypted = true,
            joinCode = code,
            lanAddress = lanAddress,
        )
    }

    // ---- joining ---------------------------------------------------------------

    private suspend fun join(roomId: String, role: String, fallbackTitle: String): RoomHandle {
        db.getReference("roomMembers/$roomId/${requireUid()}").setValue(
            mapOf("role" to role, "joinedAt" to ServerValue.TIMESTAMP),
        ).await()

        // Membership exists now, so the room record is readable.
        val room = db.getReference("rooms/$roomId").get().await()
        return RoomHandle(
            roomId = roomId,
            title = room.child("title").getValue(String::class.java) ?: fallbackTitle,
            isOwner = room.child("ownerUid").getValue(String::class.java) == uid,
            encrypted = room.child("e2ee").getValue(Boolean::class.java) ?: false,
            lanAddress = room.child("lan").getValue(String::class.java),
        )
    }

    suspend fun joinStream(stream: Stream): RoomHandle {
        advanceMission("viewer")
        return join(stream.id, "viewer", stream.title)
    }

    suspend fun joinVoiceRoom(room: VoiceRoom): RoomHandle = join(room.id, "speaker", room.title)

    suspend fun joinMinecraft(session: McSession): RoomHandle = join(session.id, "player", session.name)

    /** Invite codes are a secret path: you can read one only by knowing it. */
    suspend fun joinByCode(code: String): RoomHandle {
        val normalised = code.trim().uppercase()
        require(normalised.matches(Regex("^[A-Z2-9]{8}$"))) { "Код приглашения — 8 символов" }

        val roomId = db.getReference("joinIndex/$normalised").get().await()
            .getValue(String::class.java)
            ?: throw NoSuchElementException("По этому коду ничего не найдено")

        return join(roomId, "player", "")
    }

    // ---- listings ----------------------------------------------------------

    suspend fun streams(): List<Stream> =
        db.getReference("listings/stream").orderByChild("createdAt").limitToLast(30).get().await()
            .children.mapNotNull { child ->
                val id = child.key ?: return@mapNotNull null
                Stream(
                    id = id,
                    title = child.child("title").getValue(String::class.java) ?: return@mapNotNull null,
                    game = child.child("game").getValue(String::class.java) ?: "",
                    ownerUid = child.child("ownerUid").getValue(String::class.java) ?: "",
                    ownerName = child.child("ownerName").getValue(String::class.java) ?: "",
                    viewers = (child.child("viewers").getValue(Long::class.java) ?: 0L).toInt(),
                    e2ee = child.child("e2ee").getValue(Boolean::class.java) ?: false,
                    voiceEnabled = child.child("voiceEnabled").getValue(Boolean::class.java) ?: true,
                    startedAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
                )
            }.sortedByDescending { it.startedAt }

    suspend fun voiceRooms(): List<VoiceRoom> =
        db.getReference("listings/voice").orderByChild("createdAt").limitToLast(30).get().await()
            .children.mapNotNull { child ->
                val id = child.key ?: return@mapNotNull null
                VoiceRoom(
                    id = id,
                    title = child.child("title").getValue(String::class.java) ?: return@mapNotNull null,
                    ownerUid = child.child("ownerUid").getValue(String::class.java) ?: "",
                    ownerName = child.child("ownerName").getValue(String::class.java) ?: "",
                    maxParticipants = (child.child("maxParticipants").getValue(Long::class.java) ?: 10L).toInt(),
                    startedAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
                )
            }.sortedByDescending { it.startedAt }

    suspend fun mcSessions(): List<McSession> =
        db.getReference("listings/mc").orderByChild("createdAt").limitToLast(30).get().await()
            .children.mapNotNull { child ->
                val id = child.key ?: return@mapNotNull null
                McSession(
                    id = id,
                    name = child.child("title").getValue(String::class.java) ?: return@mapNotNull null,
                    version = child.child("version").getValue(String::class.java) ?: "",
                    edition = child.child("edition").getValue(String::class.java) ?: "bedrock",
                    gameMode = child.child("gameMode").getValue(String::class.java) ?: "survival",
                    hostUid = child.child("ownerUid").getValue(String::class.java) ?: "",
                    hostName = child.child("ownerName").getValue(String::class.java) ?: "",
                    players = (child.child("players").getValue(Long::class.java) ?: 1L).toInt(),
                    maxPlayers = (child.child("maxPlayers").getValue(Long::class.java) ?: 8L).toInt(),
                    startedAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
                )
            }.sortedByDescending { it.startedAt }

    // ---- ending a session --------------------------------------------------

    /** Owner only: marks the room ended, wipes key material, releases LiveKit. */
    suspend fun closeRoom(roomId: String, joinCode: String? = null) {
        val kind = roomId.substringBefore('_')
        val members = db.getReference("roomMembers/$roomId").get().await()
            .children.mapNotNull { it.key }

        val updates = mutableMapOf<String, Any?>(
            "rooms/$roomId/state" to "ended",
            "rooms/$roomId/endedAt" to ServerValue.TIMESTAMP,
        )
        // Deleting a node that was never written is refused by the rules, so
        // the optional parts are only cleared when they actually exist.
        if (db.getReference("listings/$kind/$roomId").get().await().exists()) {
            updates["listings/$kind/$roomId"] = null
        }
        if (joinCode != null && joinCode.matches(Regex("^[A-Z2-9]{8}$"))) {
            updates["joinIndex/$joinCode"] = null
        }
        for (member in members) {
            updates["roomKeys/$roomId/$member"] = null
            updates["roomMembers/$roomId/$member"] = null
        }
        db.reference.updateChildren(updates).await()

        runCatching {
            ApiClient.post(
                "/v1/rtc/close",
                RoomIdRequest(roomId),
                RoomIdRequest.serializer(),
                CloseResponse.serializer(),
            )
        }
    }

    /** Owner only: removes a member, revokes their key copy and bans them. */
    suspend fun kick(roomId: String, memberUid: String) {
        db.reference.updateChildren(
            mapOf(
                "roomMembers/$roomId/$memberUid" to null,
                "roomKeys/$roomId/$memberUid" to null,
                "roomBans/$roomId/$memberUid" to mapOf(
                    "at" to ServerValue.TIMESTAMP,
                    "by" to requireUid(),
                ),
            ),
        ).await()
    }

    /** Owner only: keeps the public card's headcount honest. */
    suspend fun publishHeadcount(roomId: String, memberCount: Int) {
        val kind = roomId.substringBefore('_')
        val field = when (kind) {
            "stream" -> "viewers"
            "mc" -> "players"
            else -> return
        }
        val reference = db.getReference("listings/$kind/$roomId")
        if (!reference.get().await().exists()) return
        val value = if (field == "viewers") (memberCount - 1).coerceAtLeast(0) else memberCount
        reference.child(field).setValue(value).await()
    }

    // ---- end-to-end key distribution ---------------------------------------

    /** Wraps the room key for every member that published a public key. */
    suspend fun shareRoomKey(roomId: String, roomKey: ByteArray, keyId: String, members: List<String>) {
        val updates = mutableMapOf<String, Any?>()
        for (member in members) {
            val record = publicKeyOf(member) ?: continue
            updates["roomKeys/$roomId/$member"] = mapOf(
                "keyId" to keyId,
                "wrappedKey" to E2EE.wrapRoomKey(roomKey, record.publicKey, roomId.toByteArray()),
                "senderUid" to requireUid(),
                "createdAt" to ServerValue.TIMESTAMP,
            )
        }
        if (updates.isNotEmpty()) db.reference.updateChildren(updates).await()
    }

    suspend fun roomKeyEnvelope(roomId: String): KeyEnvelope? {
        val snapshot = db.getReference("roomKeys/$roomId/${requireUid()}").get().await()
        if (!snapshot.exists()) return null
        return KeyEnvelope(
            keyId = snapshot.child("keyId").getValue(String::class.java) ?: return null,
            wrappedKey = snapshot.child("wrappedKey").getValue(String::class.java) ?: return null,
            senderUid = snapshot.child("senderUid").getValue(String::class.java) ?: "",
        )
    }

    // ---- server calls --------------------------------------------------------

    suspend fun rtcToken(roomId: String, publish: Boolean): RtcToken =
        ApiClient.post(
            "/v1/rtc/token",
            RtcTokenRequest(roomId, publish),
            RtcTokenRequest.serializer(),
            RtcToken.serializer(),
        )

    suspend fun sendEmailCode(address: String): EmailChallenge =
        ApiClient.post(
            "/v1/email/code",
            EmailCodeRequest(address.trim()),
            EmailCodeRequest.serializer(),
            EmailChallenge.serializer(),
        )

    /** On success the signed proof is stored and attached to later requests. */
    suspend fun confirmEmailCode(challenge: String, code: String) {
        val proof = ApiClient.post(
            "/v1/email/confirm",
            EmailConfirmRequest(challenge, code.trim()),
            EmailConfirmRequest.serializer(),
            EmailProof.serializer(),
        )
        EmailProofStore.save(requireUid(), proof.proof)
    }

    fun emailVerified(): Boolean = EmailProofStore.proofFor(uid) != null

    // ---- realtime ------------------------------------------------------------

    fun members(roomId: String): Flow<List<String>> =
        snapshots(db.getReference("roomMembers/$roomId")) { snapshot ->
            snapshot.children.mapNotNull { it.key }
        }

    /** Encrypted chat stream. Decryption happens only on the device. */
    fun chat(roomId: String, roomKey: () -> ByteArray?): Flow<List<ChatMessage>> =
        snapshots(db.getReference("chat/$roomId").orderByChild("ts").limitToLast(200)) { snapshot ->
            val key = roomKey()
            snapshot.children.mapNotNull { child ->
                val id = child.key ?: return@mapNotNull null
                val sender = child.child("senderUid").getValue(String::class.java) ?: return@mapNotNull null
                val ciphertext = child.child("ciphertext").getValue(String::class.java) ?: return@mapNotNull null
                val nonce = child.child("nonce").getValue(String::class.java) ?: return@mapNotNull null
                val ts = child.child("ts").getValue(Long::class.java) ?: 0L
                val plain = key?.let {
                    runCatching {
                        String(E2EE.open(it, ciphertext, nonce, roomId.toByteArray()), Charsets.UTF_8)
                    }.getOrNull()
                }
                ChatMessage(id, sender, plain ?: "", ts, plain != null)
            }
        }

    /** Sends a chat line. Only ciphertext ever reaches the database. */
    fun sendChat(roomId: String, roomKey: ByteArray, keyId: String, text: String) {
        val trimmed = text.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 500) { "Сообщение пустое или слишком длинное" }
        val (ciphertext, nonce) = E2EE.seal(roomKey, trimmed.toByteArray(Charsets.UTF_8), roomId.toByteArray())
        db.getReference("chat/$roomId").push().setValue(
            mapOf(
                "senderUid" to (uid ?: return),
                "ciphertext" to ciphertext,
                "nonce" to nonce,
                "keyId" to keyId,
                "ts" to ServerValue.TIMESTAMP,
            ),
        )
    }

    private fun <T> snapshots(query: Query, map: (DataSnapshot) -> T): Flow<T> = callbackFlow {
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                trySend(map(snapshot))
            }

            override fun onCancelled(error: DatabaseError) {
                close(IllegalStateException(error.message))
            }
        }
        query.addValueEventListener(listener)
        awaitClose { query.removeEventListener(listener) }
    }
}
