package com.newrizer.arcade.data

import kotlinx.serialization.Serializable

// ---- profile and directory (stored in Realtime Database) -------------------

data class Profile(
    val uid: String = "",
    val displayName: String,
    val avatarId: Int = 0,
    val bio: String = "",
    /** Base64 JPEG, compressed on device. Storage is not used anywhere. */
    val photo: String = "",
    val xp: Int = 0,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
) {
    val level: Int get() = Levels.levelFor(xp)
    val levelProgress: Float get() = Levels.progress(xp)
}

/** Level curve: each level costs a little more than the previous one. */
object Levels {
    private const val BASE = 120

    fun xpForLevel(level: Int): Int = BASE * (level - 1) * level / 2

    fun levelFor(xp: Int): Int {
        var level = 1
        while (xp >= xpForLevel(level + 1) && level < 99) level += 1
        return level
    }

    fun progress(xp: Int): Float {
        val level = levelFor(xp)
        val floor = xpForLevel(level)
        val ceiling = xpForLevel(level + 1)
        if (ceiling <= floor) return 1f
        return ((xp - floor).toFloat() / (ceiling - floor)).coerceIn(0f, 1f)
    }
}

data class Mission(
    val id: String,
    val title: String,
    val detail: String,
    val goal: Int,
    val reward: Int,
    val progress: Int = 0,
) {
    val done: Boolean get() = progress >= goal
}

/** The missions ship with the app; only progress lives in the database. */
object Missions {
    val all = listOf(
        Mission("first_stream", "Первый эфир", "Запусти трансляцию", 1, 120),
        Mission("talker", "Разговорчивый", "Отправь 20 сообщений в чате", 20, 80),
        Mission("host", "Свой мир", "Захости мир Minecraft", 1, 150),
        Mission("voice", "Голос", "Проведи 3 голосовые комнаты", 3, 100),
        Mission("author", "Автор", "Опубликуй 5 постов", 5, 90),
        Mission("viewer", "Зритель", "Посмотри 10 трансляций", 10, 70),
    )

    fun merge(progress: Map<String, Int>): List<Mission> =
        all.map { it.copy(progress = progress[it.id] ?: 0) }
}

data class UserCard(
    val uid: String,
    val displayName: String,
    val photo: String = "",
    val level: Int = 1,
)

data class PublicKeyRecord(val keyId: String, val publicKey: String, val algorithm: String)

data class Post(
    val id: String,
    val authorUid: String,
    val authorName: String,
    val text: String,
    val image: String = "",
    val createdAt: Long = 0,
)

// ---- listings --------------------------------------------------------------

data class Stream(
    val id: String,
    val title: String,
    val game: String,
    val ownerUid: String,
    val ownerName: String = "",
    val viewers: Int = 0,
    val e2ee: Boolean = false,
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
    /**
     * Public streams are watched by strangers, so their media is not end to end
     * encrypted - the chat still is. Private sessions keep media encrypted.
     */
    val e2ee: Boolean = false,
)

/** What a client gets back after creating or joining a session. */
data class RoomHandle(
    val roomId: String,
    val title: String,
    val isOwner: Boolean,
    val encrypted: Boolean,
    val joinCode: String? = null,
    /** True when the room appears in public listings, so heartbeats mirror there. */
    val listed: Boolean = false,
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

// ---- server payloads --------------------------------------------------------

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

@Serializable
data class EmailCodeRequest(val email: String)

@Serializable
data class EmailChallenge(val challenge: String, val expiresInSeconds: Int)

@Serializable
data class EmailConfirmRequest(val challenge: String, val code: String)

@Serializable
data class EmailProof(val proof: String, val expiresInSeconds: Int)
