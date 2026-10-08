package com.newrizer.arcade.data

import kotlinx.serialization.Serializable

// ---- profile and directory (stored in Realtime Database) -------------------

data class Profile(
    val displayName: String,
    val avatarId: Int = 0,
    val bio: String = "",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

data class PublicKeyRecord(val keyId: String, val publicKey: String, val algorithm: String)

// ---- listings --------------------------------------------------------------

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

data class VoiceRoom(
    val id: String,
    val title: String,
    val ownerUid: String,
    val ownerName: String = "",
    val maxParticipants: Int = 10,
    val startedAt: Long = 0,
)

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
    val startedAt: Long = 0,
)

data class McSessionCreate(
    val name: String,
    val version: String,
    val edition: String,
    val maxPlayers: Int,
    val gameMode: String,
    val isPrivate: Boolean,
)

data class StreamCreate(
    val title: String,
    val game: String,
    val visibility: String = "public",
    val voiceEnabled: Boolean = true,
    val e2ee: Boolean = true,
)

/** What a client gets back after creating or joining a session. */
data class RoomHandle(
    val roomId: String,
    val title: String,
    val isOwner: Boolean,
    val joinCode: String? = null,
)

data class KeyEnvelope(val keyId: String, val wrappedKey: String, val senderUid: String)

/** Plain-text chat message after local decryption. */
data class ChatMessage(
    val id: String,
    val senderUid: String,
    val text: String,
    val timestamp: Long,
    val decrypted: Boolean,
)

// ---- the only server payloads ---------------------------------------------

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
data class RoomIdRequest(val roomId: String)

@Serializable
data class CloseResponse(val roomId: String, val closed: Boolean)
