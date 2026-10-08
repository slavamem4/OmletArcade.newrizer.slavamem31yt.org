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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.RoomState
import com.newrizer.arcade.ui.components.ArcadeButton
import com.newrizer.arcade.ui.components.ArcadeCard
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.ArcadeLoader
import com.newrizer.arcade.ui.components.ButtonTone
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.components.Pill
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
) {
    var draft by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = ArcadeIcons.Back,
                contentDescription = "Leave",
                tint = ArcadeColors.TextPrimary,
                modifier = Modifier
                    .size(22.dp)
                    .padding(end = 2.dp),
            )
            Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    state.title.ifBlank { "Session" },
                    color = ArcadeColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                Text(
                    if (state.connected) "Connected - ${state.members.size} in room" else "Connecting",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
            ArcadeButton(text = "Leave", tone = ButtonTone.Danger, onClick = onLeave)
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.encrypted) Pill("End-to-end encrypted", ArcadeColors.Good, ArcadeIcons.Lock)
            if (state.isHost) Pill("Host", ArcadeColors.Amber)
            if (state.screenShareOn) Pill("Screen live", ArcadeColors.Live, ArcadeIcons.Screen)
        }

        if (state.joinCode != null) {
            Spacer(Modifier.height(12.dp))
            ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text("Invite code", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
                    Text(
                        state.joinCode.chunked(3).joinToString(" "),
                        color = ArcadeColors.Amber,
                        fontWeight = FontWeight.Black,
                        fontSize = 26.sp,
                    )
                    Text(
                        "Share it only with players you trust. It is stored hashed on the server.",
                        color = ArcadeColors.TextSecondary,
                        fontSize = 11.sp,
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        ErrorBanner(state.error)

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ArcadeButton(
                text = if (state.microphoneOn) "Mute" else "Unmute",
                icon = if (state.microphoneOn) ArcadeIcons.Mic else ArcadeIcons.MicOff,
                onClick = onToggleMic,
                tone = if (state.microphoneOn) ButtonTone.Primary else ButtonTone.Neutral,
            )
            if (state.isHost) {
                ArcadeButton(
                    text = if (state.screenShareOn) "Stop screen" else "Share screen",
                    icon = ArcadeIcons.Screen,
                    onClick = if (state.screenShareOn) onStopScreenShare else onRequestScreenShare,
                    tone = if (state.screenShareOn) ButtonTone.Danger else ButtonTone.Neutral,
                )
            }
        }

        Spacer(Modifier.height(14.dp))
        if (state.busy) {
            Box(modifier = Modifier.fillMaxWidth().padding(top = 24.dp), contentAlignment = Alignment.Center) {
                ArcadeLoader()
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(state.messages, key = { it.id }) { message ->
                val mine = message.senderUid == selfUid
                ArcadeCard(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Text(
                            if (mine) "You" else message.senderUid.take(8),
                            color = if (mine) ArcadeColors.Amber else ArcadeColors.TextSecondary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            if (message.decrypted) message.text else "Encrypted for another key",
                            color = if (message.decrypted) ArcadeColors.TextPrimary else ArcadeColors.TextSecondary,
                            fontSize = 14.sp,
                        )
                    }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.weight(1f)) {
                ArcadeField(draft, { draft = it.take(500) }, "Message")
            }
            Spacer(Modifier.size(10.dp))
            ArcadeButton(
                text = "Send",
                icon = ArcadeIcons.Send,
                enabled = draft.isNotBlank() && state.encrypted,
                onClick = {
                    onSend(draft)
                    draft = ""
                },
            )
        }
    }
}
