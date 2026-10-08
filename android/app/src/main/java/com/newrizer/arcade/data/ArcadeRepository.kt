package com.newrizer.arcade.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.Query
import com.google.firebase.database.ValueEventListener
import com.newrizer.arcade.crypto.E2EE
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** All network and database access used by the UI layer. */
object ArcadeRepository {

    private val auth get() = FirebaseAuth.getInstance()
    private val db get() = FirebaseDatabase.getInstance()

    val uid: String? get() = auth.currentUser?.uid

    // ---- profile and keys -------------------------------------------------

    suspend fun loadProfile(): ProfileEnvelope =
        ApiClient.get("/v1/me", ProfileEnvelope.serializer())

    suspend fun saveProfile(update: ProfileUpdate): ProfileEnvelope =
        ApiClient.put("/v1/me", update, ProfileUpdate.serializer(), ProfileEnvelope.serializer())

    /** Publishes this device's public key so hosts can wrap room keys for it. */
    suspend fun publishPublicKey(): PublicKeyEnvelope {
        val upload = PublicKeyUpload(keyId = E2EE.publicKeyId(), publicKey = E2EE.publicKeyBase64())
        return ApiClient.put("/v1/me/key", upload, PublicKeyUpload.serializer(), PublicKeyEnvelope.serializer())
    }

    suspend fun publicKeyOf(uid: String): PublicKeyEnvelope =
        ApiClient.get("/v1/me/key/$uid", PublicKeyEnvelope.serializer())

    // ---- streams ----------------------------------------------------------

    suspend fun streams(): List<Stream> =
        ApiClient.get("/v1/streams?limit=30", StreamList.serializer()).items

    suspend fun startStream(create: StreamCreate): StreamCreated =
        ApiClient.post("/v1/streams", create, StreamCreate.serializer(), StreamCreated.serializer())

    suspend fun joinStream(id: String): JoinResponse =
        ApiClient.postEmpty("/v1/streams/$id/join", JoinResponse.serializer())

    suspend fun endStream(id: String): SimpleState =
        ApiClient.postEmpty("/v1/streams/$id/end", SimpleState.serializer())

    // ---- voice rooms ------------------------------------------------------

    suspend fun voiceRooms(): List<VoiceRoom> =
        ApiClient.get("/v1/voice?limit=30", VoiceRoomList.serializer()).items

    suspend fun createVoiceRoom(create: VoiceRoomCreate): String =
        ApiClient.post("/v1/voice", create, VoiceRoomCreate.serializer(), JoinResponse.serializer()).id

    suspend fun joinVoiceRoom(id: String): JoinResponse =
        ApiClient.postEmpty("/v1/voice/$id/join", JoinResponse.serializer())

    suspend fun endVoiceRoom(id: String): SimpleState =
        ApiClient.postEmpty("/v1/voice/$id/end", SimpleState.serializer())

    // ---- minecraft hosting ------------------------------------------------

    suspend fun mcSessions(): List<McSession> =
        ApiClient.get("/v1/minecraft?limit=30", McSessionList.serializer()).items

    suspend fun hostMinecraft(create: McSessionCreate): McSessionCreated =
        ApiClient.post("/v1/minecraft", create, McSessionCreate.serializer(), McSessionCreated.serializer())

    suspend fun joinMinecraft(code: String): McJoinResult =
        ApiClient.post(
            "/v1/minecraft/join",
            McJoinRequest(code.uppercase()),
            McJoinRequest.serializer(),
            McJoinResult.serializer(),
        )

    suspend fun joinPublicMinecraft(id: String): McJoinResult =
        ApiClient.postEmpty("/v1/minecraft/$id/join", McJoinResult.serializer())

    suspend fun endMinecraft(id: String): SimpleState =
        ApiClient.postEmpty("/v1/minecraft/$id/end", SimpleState.serializer())

    // ---- realtime ---------------------------------------------------------

    suspend fun rtcToken(roomId: String, publish: Boolean): RtcToken =
        ApiClient.post(
            "/v1/rtc/token",
            RtcTokenRequest(roomId, publish),
            RtcTokenRequest.serializer(),
            RtcToken.serializer(),
        )

    suspend fun shareRoomKey(roomId: String, keyId: String, recipients: List<KeyRecipient>) =
        ApiClient.post(
            "/v1/keys/share",
            KeyShareRequest(roomId, keyId, recipients),
            KeyShareRequest.serializer(),
            KeyShareAck.serializer(),
        )

    suspend fun roomKeyEnvelope(roomId: String): KeyEnvelopeResponse =
        ApiClient.get("/v1/keys/$roomId", KeyEnvelopeResponse.serializer())

    /** Live member list for a room, used to decide who needs a wrapped key. */
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
                val plain = if (key == null) {
                    null
                } else {
                    runCatching {
                        String(E2EE.open(key, ciphertext, nonce, roomId.toByteArray()), Charsets.UTF_8)
                    }.getOrNull()
                }
                ChatMessage(
                    id = id,
                    senderUid = sender,
                    text = plain ?: "",
                    timestamp = ts,
                    decrypted = plain != null,
                )
            }
        }

    /** Sends a chat line. Only ciphertext ever reaches the database. */
    fun sendChat(roomId: String, roomKey: ByteArray, keyId: String, text: String) {
        val trimmed = text.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 500) { "message length out of range" }
        val (ciphertext, nonce) = E2EE.seal(roomKey, trimmed.toByteArray(Charsets.UTF_8), roomId.toByteArray())
        val reference = db.getReference("chat/$roomId").push()
        reference.setValue(
            mapOf(
                "senderUid" to (uid ?: return),
                "ciphertext" to ciphertext,
                "nonce" to nonce,
                "keyId" to keyId,
                "ts" to com.google.firebase.database.ServerValue.TIMESTAMP,
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

@kotlinx.serialization.Serializable
data class KeyShareAck(val roomId: String, val keyId: String, val delivered: Int)
