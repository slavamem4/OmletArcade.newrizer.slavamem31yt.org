package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.RoomState
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.Avatar
import com.newrizer.arcade.ui.components.Chip
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.components.LiveBadge
import com.newrizer.arcade.ui.components.Loader
import com.newrizer.arcade.ui.theme.ArcadeColors

@Composable
fun RoomScreen(
    state: RoomState,
    selfUid: String?,
    onLeave: () -> Unit,
    onToggleMic: () -> Unit,
    onRequestScreenShare: () -> Unit,
    onStopScreenShare: () -> Unit,
    onSend: (String) -> Unit,
    onKick: (String) -> Unit,
) {
    var draft by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ArcadeColors.Background),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ArcadeColors.Surface)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ArcadeIcons.Back,
                "Выйти",
                tint = ArcadeColors.TextPrimary,
                modifier = Modifier.size(22.dp).clickable(onClick = onLeave),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    state.title.ifEmpty { "Комната" },
                    color = ArcadeColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    "${state.members.size} в комнате" + if (state.encrypted) " · шифрование" else "",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 11.5.sp,
                )
            }
            if (state.connected) LiveBadge(if (state.isHost) "ЭФИР" else "ОНЛАЙН")
        }

        if (state.error != null) ErrorBanner(state.error)

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            when {
                state.busy -> Loader()
                state.screenShareOn -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(ArcadeIcons.Screen, null, tint = ArcadeColors.Coral, modifier = Modifier.size(34.dp))
                    Spacer(Modifier.height(10.dp))
                    Text("Экран транслируется", color = ArcadeColors.TextSecondary, fontSize = 13.sp)
                }

                state.connected -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(ArcadeIcons.Live, null, tint = ArcadeColors.TextMuted, modifier = Modifier.size(34.dp))
                    Spacer(Modifier.height(10.dp))
                    Text(
                        if (state.isHost) "Включи экран или микрофон" else "Ждём поток хоста",
                        color = ArcadeColors.TextSecondary,
                        fontSize = 13.sp,
                    )
                }

                else -> Text("Подключение…", color = ArcadeColors.TextSecondary, fontSize = 13.sp)
            }
        }

        if (state.joinCode != null || state.tunnelNote != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(ArcadeColors.Surface)
                    .padding(12.dp),
            ) {
                if (state.joinCode != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(ArcadeIcons.Key, null, tint = ArcadeColors.Coral, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Код входа", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            state.joinCode,
                            color = ArcadeColors.TextPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                            letterSpacing = 2.sp,
                        )
                    }
                }
                if (state.tunnelNote != null) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.Top) {
                        Icon(ArcadeIcons.Cube, null, tint = ArcadeColors.Good, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            state.tunnelNote,
                            color = ArcadeColors.TextSecondary,
                            fontSize = 12.5.sp,
                            lineHeight = 18.sp,
                        )
                    }
                }
            }
        }

        if (state.members.isNotEmpty()) {
            LazyRow(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.padding(vertical = 6.dp),
            ) {
                items(state.members, key = { it }) { member ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            modifier = Modifier.clickable(enabled = state.isHost && member != selfUid) {
                                onKick(member)
                            },
                        ) {
                            Avatar(member, member.take(2), 38)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            if (member == selfUid) "ты" else member.take(5),
                            color = ArcadeColors.TextMuted,
                            fontSize = 10.sp,
                        )
                    }
                }
            }
        }

        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth(), reverseLayout = true) {
            items(state.messages.asReversed(), key = { it.id }) { message ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Avatar(message.senderUid, message.senderUid.take(2), 28)
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(
                            if (message.senderUid == selfUid) "ты" else message.senderUid.take(6),
                            color = ArcadeColors.Coral,
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(2.dp))
                        if (message.decrypted) {
                            Text(
                                message.text,
                                color = ArcadeColors.TextPrimary,
                                fontSize = 13.5.sp,
                                lineHeight = 19.sp,
                            )
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    ArcadeIcons.Lock,
                                    null,
                                    tint = ArcadeColors.TextMuted,
                                    modifier = Modifier.size(12.dp),
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    "сообщение не расшифровано",
                                    color = ArcadeColors.TextMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ArcadeColors.Surface)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                ArcadeField(draft, { draft = it }, "Сообщение", minHeight = 44)
            }
            Spacer(Modifier.width(10.dp))
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (draft.isBlank()) ArcadeColors.SurfaceHigh else ArcadeColors.Coral)
                    .clickable(enabled = draft.isNotBlank()) {
                        onSend(draft)
                        draft = ""
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(ArcadeIcons.Send, "Отправить", tint = Color.White, modifier = Modifier.size(19.dp))
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ArcadeColors.Surface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Control(
                icon = if (state.microphoneOn) ArcadeIcons.Mic else ArcadeIcons.MicOff,
                label = if (state.microphoneOn) "Микрофон" else "Выключен",
                active = state.microphoneOn,
                onClick = onToggleMic,
            )
            if (state.isHost) {
                Control(
                    icon = ArcadeIcons.Screen,
                    label = if (state.screenShareOn) "Остановить" else "Экран",
                    active = state.screenShareOn,
                    onClick = { if (state.screenShareOn) onStopScreenShare() else onRequestScreenShare() },
                )
            }
            Control(
                icon = ArcadeIcons.Exit,
                label = if (state.isHost) "Завершить" else "Выйти",
                active = false,
                danger = true,
                onClick = onLeave,
            )
        }
    }
}

@Composable
private fun Control(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(
                    when {
                        danger -> ArcadeColors.Live.copy(alpha = 0.16f)
                        active -> ArcadeColors.Coral
                        else -> ArcadeColors.SurfaceRaised
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                label,
                tint = when {
                    danger -> ArcadeColors.Live
                    active -> Color.White
                    else -> ArcadeColors.TextSecondary
                },
                modifier = Modifier.size(21.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = ArcadeColors.TextSecondary, fontSize = 11.sp)
    }
}

/** Shown while a stream/voice session is being prepared. */
@Composable
fun ConnectingOverlay() {
    Box(
        modifier = Modifier.fillMaxSize().background(ArcadeColors.Background.copy(alpha = 0.9f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Loader()
            Spacer(Modifier.height(14.dp))
            Text("Подключаемся…", color = ArcadeColors.TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Chip("ключи и токен")
        }
    }
}
