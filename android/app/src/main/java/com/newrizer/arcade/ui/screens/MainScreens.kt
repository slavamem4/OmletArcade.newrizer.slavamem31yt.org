package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.data.McSession
import com.newrizer.arcade.data.McSessionCreate
import com.newrizer.arcade.data.Profile
import com.newrizer.arcade.data.Stream
import com.newrizer.arcade.data.VoiceRoom
import com.newrizer.arcade.ui.FeedState
import com.newrizer.arcade.ui.components.ArcadeButton
import com.newrizer.arcade.ui.components.ArcadeCard
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.ArcadeLoader
import com.newrizer.arcade.ui.components.ButtonTone
import com.newrizer.arcade.ui.components.EmptyState
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.components.Pill
import com.newrizer.arcade.ui.components.SectionHeader
import com.newrizer.arcade.ui.theme.ArcadeColors

@Composable
private fun ScreenScaffold(
    title: String,
    subtitle: String,
    error: String?,
    loading: Boolean,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp, vertical = 16.dp),
    ) {
        SectionHeader(title, subtitle)
        ErrorBanner(error, modifier = Modifier.padding(bottom = 12.dp))
        if (loading) {
            Box(modifier = Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) {
                ArcadeLoader()
            }
        } else {
            content()
        }
    }
}

@Composable
fun HomeScreen(
    feed: FeedState,
    onRefresh: () -> Unit,
    onWatch: (Stream) -> Unit,
    onGoLive: (String, String, String) -> Unit,
) {
    var composing by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var game by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("public") }

    ScreenScaffold("Live now", "Streams from players around you", feed.error, feed.loading) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ArcadeButton(
                    text = if (composing) "Cancel" else "Go live",
                    icon = if (composing) null else ArcadeIcons.Live,
                    onClick = { composing = !composing },
                    tone = if (composing) ButtonTone.Neutral else ButtonTone.Primary,
                )
                ArcadeButton(text = "Refresh", onClick = onRefresh, tone = ButtonTone.Neutral)
            }

            if (composing) {
                ArcadeCard(modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                    Column {
                        ArcadeField(title, { title = it }, "Stream title")
                        Spacer(Modifier.height(10.dp))
                        ArcadeField(game, { game = it }, "Game")
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("public", "followers", "private").forEach { option ->
                                ArcadeButton(
                                    text = option,
                                    onClick = { visibility = option },
                                    tone = if (visibility == option) ButtonTone.Primary else ButtonTone.Neutral,
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        ArcadeButton(
                            text = "Start broadcast",
                            icon = ArcadeIcons.Screen,
                            enabled = title.trim().length >= 3 && game.trim().length >= 2,
                            onClick = { onGoLive(title.trim(), game.trim(), visibility) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }

            if (feed.streams.isEmpty()) {
                EmptyState(
                    title = "No one is live",
                    message = "Be the first to broadcast. Your screen and voice stay encrypted end to end.",
                    icon = ArcadeIcons.Live,
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(feed.streams, key = { it.id }) { stream ->
                        StreamRow(stream) { onWatch(stream) }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreamRow(stream: Stream, onClick: () -> Unit) {
    ArcadeCard(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = ArcadeIcons.Live,
                    contentDescription = null,
                    tint = ArcadeColors.Live,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = stream.title,
                    color = ArcadeColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = "${stream.ownerName} - ${stream.game}",
                color = ArcadeColors.TextSecondary,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
            Row(
                modifier = Modifier.padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Pill("${stream.viewers} watching")
                if (stream.e2ee) Pill("E2EE", ArcadeColors.Good, ArcadeIcons.Lock)
                if (stream.voiceEnabled) Pill("Voice", ArcadeColors.Amber, ArcadeIcons.Mic)
            }
        }
    }
}

@Composable
fun VoiceScreen(
    feed: FeedState,
    onRefresh: () -> Unit,
    onJoin: (VoiceRoom) -> Unit,
    onCreate: (String, Int) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var seats by remember { mutableIntStateOf(8) }

    ScreenScaffold("Voice rooms", "Group calls carried by LiveKit", feed.error, feed.loading) {
        Column {
            ArcadeCard(modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                Column {
                    ArcadeField(title, { title = it }, "Room name")
                    Spacer(Modifier.height(10.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf(4, 8, 16, 30).forEach { option ->
                            ArcadeButton(
                                text = "$option",
                                onClick = { seats = option },
                                tone = if (seats == option) ButtonTone.Primary else ButtonTone.Neutral,
                            )
                        }
                        Text("seats", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                    ArcadeButton(
                        text = "Open room",
                        icon = ArcadeIcons.Waves,
                        enabled = title.trim().length >= 3,
                        onClick = { onCreate(title.trim(), seats) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            ArcadeButton(text = "Refresh", onClick = onRefresh, tone = ButtonTone.Neutral)
            Spacer(Modifier.height(12.dp))

            if (feed.voiceRooms.isEmpty()) {
                EmptyState("No open rooms", "Start one and invite your squad.", ArcadeIcons.Waves)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(feed.voiceRooms, key = { it.id }) { room ->
                        ArcadeCard(modifier = Modifier.fillMaxWidth(), onClick = { onJoin(room) }) {
                            Column {
                                Text(
                                    room.title,
                                    color = ArcadeColors.TextPrimary,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                )
                                Text(
                                    "Host ${room.ownerName}",
                                    color = ArcadeColors.TextSecondary,
                                    fontSize = 13.sp,
                                )
                                Row(
                                    modifier = Modifier.padding(top = 10.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Pill("${room.maxParticipants} seats")
                                    Pill("E2EE", ArcadeColors.Good, ArcadeIcons.Lock)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MinecraftScreen(
    feed: FeedState,
    onRefresh: () -> Unit,
    onHost: (McSessionCreate) -> Unit,
    onJoinCode: (String) -> Unit,
    onJoinSession: (McSession) -> Unit,
) {
    var worldName by remember { mutableStateOf("") }
    var version by remember { mutableStateOf("1.21.1") }
    var edition by remember { mutableStateOf("bedrock") }
    var mode by remember { mutableStateOf("survival") }
    var slots by remember { mutableIntStateOf(8) }
    var privateWorld by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }

    ScreenScaffold("Host a world", "Minecraft sessions with built-in voice", feed.error, feed.loading) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
            ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    ArcadeField(worldName, { worldName = it }, "World name")
                    Spacer(Modifier.height(10.dp))
                    ArcadeField(version, { version = it }, "Version")
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("bedrock", "java").forEach { option ->
                            ArcadeButton(
                                text = option,
                                onClick = { edition = option },
                                tone = if (edition == option) ButtonTone.Primary else ButtonTone.Neutral,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("survival", "creative", "adventure").forEach { option ->
                            ArcadeButton(
                                text = option.take(5),
                                onClick = { mode = option },
                                tone = if (mode == option) ButtonTone.Primary else ButtonTone.Neutral,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf(4, 8, 16, 30).forEach { option ->
                            ArcadeButton(
                                text = "$option",
                                onClick = { slots = option },
                                tone = if (slots == option) ButtonTone.Primary else ButtonTone.Neutral,
                            )
                        }
                        Text("players", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    ArcadeButton(
                        text = if (privateWorld) "Invite only" else "Listed publicly",
                        icon = if (privateWorld) ArcadeIcons.Lock else null,
                        onClick = { privateWorld = !privateWorld },
                        tone = ButtonTone.Neutral,
                    )
                    Spacer(Modifier.height(12.dp))
                    ArcadeButton(
                        text = "Start hosting",
                        icon = ArcadeIcons.Cube,
                        enabled = worldName.trim().length >= 3 &&
                            Regex("^\\d+\\.\\d+(\\.\\d+)?$").matches(version.trim()),
                        onClick = {
                            onHost(
                                McSessionCreate(
                                    name = worldName.trim(),
                                    version = version.trim(),
                                    edition = edition,
                                    maxPlayers = slots,
                                    gameMode = mode,
                                    isPrivate = privateWorld,
                                ),
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        "Join with a code",
                        color = ArcadeColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    ArcadeField(code, { code = it.uppercase().take(6) }, "6-character code", keyboardType = KeyboardType.Text)
                    Spacer(Modifier.height(10.dp))
                    ArcadeButton(
                        text = "Join world",
                        icon = ArcadeIcons.Key,
                        enabled = code.length == 6,
                        onClick = { onJoinCode(code) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            ArcadeButton(text = "Refresh", onClick = onRefresh, tone = ButtonTone.Neutral)
            Spacer(Modifier.height(12.dp))

            if (feed.mcSessions.isEmpty()) {
                EmptyState("No public worlds", "Host one, or join privately with a code.", ArcadeIcons.Cube)
            } else {
                feed.mcSessions.forEach { session ->
                    ArcadeCard(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                        onClick = { onJoinSession(session) },
                    ) {
                        Column {
                            Text(
                                session.name,
                                color = ArcadeColors.TextPrimary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                            )
                            Text(
                                "${session.hostName} - ${session.edition} ${session.version}",
                                color = ArcadeColors.TextSecondary,
                                fontSize = 13.sp,
                            )
                            Row(
                                modifier = Modifier.padding(top = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Pill("${session.players}/${session.maxPlayers}")
                                Pill(session.gameMode)
                                Pill("E2EE", ArcadeColors.Good, ArcadeIcons.Lock)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProfileScreen(
    profile: Profile?,
    uid: String?,
    keyFingerprint: String,
    onSave: (String, Int, String) -> Unit,
    onSignOut: () -> Unit,
) {
    var name by remember(profile) { mutableStateOf(profile?.displayName ?: "") }
    var bio by remember(profile) { mutableStateOf(profile?.bio ?: "") }
    var avatar by remember(profile) { mutableIntStateOf(profile?.avatarId ?: 0) }

    ScreenScaffold("Profile", uid ?: "", null, false) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ArcadeMark(size = 56.dp)
                Column(modifier = Modifier.padding(start = 14.dp)) {
                    Text(
                        profile?.displayName ?: "Player",
                        color = ArcadeColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                    )
                    Text(
                        profile?.bio?.takeIf { it.isNotBlank() } ?: "No bio yet",
                        color = ArcadeColors.TextSecondary,
                        fontSize = 13.sp,
                    )
                }
            }

            Spacer(Modifier.height(18.dp))
            ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    ArcadeField(name, { name = it }, "Display name")
                    Spacer(Modifier.height(10.dp))
                    ArcadeField(bio, { bio = it.take(140) }, "Bio", singleLine = false)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        (0..3).forEach { option ->
                            ArcadeButton(
                                text = "A${option + 1}",
                                onClick = { avatar = option },
                                tone = if (avatar == option) ButtonTone.Primary else ButtonTone.Neutral,
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    ArcadeButton(
                        text = "Save profile",
                        enabled = name.trim().length >= 2,
                        onClick = { onSave(name.trim(), avatar, bio.trim()) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = ArcadeIcons.Key,
                            contentDescription = null,
                            tint = ArcadeColors.Amber,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            "Device key",
                            color = ArcadeColors.TextPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                    Text(
                        keyFingerprint.chunked(4).joinToString(" "),
                        color = ArcadeColors.TextSecondary,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        "Compare this fingerprint with a friend to confirm nobody sits in the middle.",
                        color = ArcadeColors.TextSecondary,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            ArcadeButton(
                text = "Sign out",
                icon = ArcadeIcons.Exit,
                tone = ButtonTone.Danger,
                onClick = onSignOut,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}
