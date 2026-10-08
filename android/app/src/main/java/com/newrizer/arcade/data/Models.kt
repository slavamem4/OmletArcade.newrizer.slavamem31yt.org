package com.newrizer.arcade.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Profile(
    val displayName: String,
    val avatarId: Int = 0,
    val bio: String = "",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class ProfileEnvelope(val uid: String, val profile: Profile)

@Serializable
data class ProfileUpdate(val displayName: String, val avatarId: Int, val bio: String = "")

@Serializable
data class PublicKeyUpload(
    val keyId: String,
    val publicKey: String,
    val algorithm: String = "HPKE_X25519_HKDF_SHA256_AES256GCM",
)

@Serializable
data class PublicKeyRecord(val keyId: String, val publicKey: String, val algorithm: String)

@Serializable
data class PublicKeyEnvelope(val uid: String, val key: PublicKeyRecord)

@Serializable
data class Stream(
    val id: String,
    val title: String,
    val game: String,
    val ownerUid: String,
    val ownerName: String = "",
    val viewers: Int = 0,
    val e2ee: Boolean = true,
    val voiceEnabled: Boolean = true,
    val startedAt: Long = 0,
)

@Serializable
data class StreamList(val items: List<Stream> = emptyList())

@Serializable
data class StreamCreate(
    val title: String,
    val game: String,
    val visibility: String = "public",
    val voiceEnabled: Boolean = true,
    val e2ee: Boolean = true,
)

@Serializable
data class StreamCreated(val id: String, val stream: Stream)

@Serializable
data class VoiceRoom(
    val id: String,
    val title: String,
    val ownerUid: String,
    val ownerName: String = "",
    val maxParticipants: Int = 10,
    val startedAt: Long = 0,
)

@Serializable
data class VoiceRoomList(val items: List<VoiceRoom> = emptyList())

@Serializable
data class VoiceRoomCreate(val title: String, val maxParticipants: Int)

@Serializable
data class McSession(
    val id: String,
    val name: String,
    val version: String,
    val edition: String,
    val gameMode: String,
    val hostUid: String,
    val hostName: String = "",
    val players: Int = 1,
    val maxPlayers: Int = 8,
    @SerialName("private") val isPrivate: Boolean = false,
    val startedAt: Long = 0,
)

@Serializable
data class McSessionList(val items: List<McSession> = emptyList())

@Serializable
data class McSessionCreate(
    val name: String,
    val version: String,
    val edition: String,
    val maxPlayers: Int,
    val gameMode: String,
    @SerialName("private") val isPrivate: Boolean,
)

@Serializable
data class McSessionCreated(val id: String, val joinCode: String, val session: McSession)

@Serializable
data class McJoinRequest(val joinCode: String)

@Serializable
data class McJoinResult(val id: String, val role: String, val session: McSession)

@Serializable
data class RtcTokenRequest(val roomId: String, val publish: Boolean)

@Serializable
data class RtcToken(
    val roomId: String,
    val url: String,
    val token: String,
    val expiresInSeconds: Int,
    val canPublish: Boolean,
    val e2ee: Boolean,
)

@Serializable
data class KeyRecipient(val uid: String, val wrappedKey: String)

@Serializable
data class KeyShareRequest(val roomId: String, val keyId: String, val recipients: List<KeyRecipient>)

@Serializable
data class KeyEnvelope(val keyId: String, val wrappedKey: String, val senderUid: String, val createdAt: Long = 0)

@Serializable
data class KeyEnvelopeResponse(val roomId: String, val envelope: KeyEnvelope)

@Serializable
data class JoinResponse(val id: String, val role: String = "viewer")

@Serializable
data class SimpleState(val id: String, val state: String)

/** Plain-text chat message after local decryption. */
data class ChatMessage(
    val id: String,
    val senderUid: String,
    val text: String,
    val timestamp: Long,
    val decrypted: Boolean,
)
