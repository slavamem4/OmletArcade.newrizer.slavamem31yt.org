package com.newrizer.arcade.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.theme.ArcadeColors

enum class ComposeAction { GAMES, POST, GO_LIVE_CAMERA, GO_LIVE_SCREEN, VOICE, MINECRAFT }

/**
 * The sheet behind the centre button. Two rows, exactly like the reference:
 * quick actions on top, the four ways to go live underneath.
 */
@Composable
fun ComposeSheet(visible: Boolean, onDismiss: () -> Unit, onAction: (ComposeAction) -> Unit) {
    AnimatedVisibility(visible = visible, enter = fadeIn(), exit = fadeOut()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(onClick = onDismiss),
        )
    }
    AnimatedVisibility(
        visible = visible,
        enter = slideInVertically { it } + fadeIn(),
        exit = slideOutVertically { it } + fadeOut(),
    ) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Column(
                modifier = Modifier
                    .padding(horizontal = 12.dp)
                    .padding(bottom = 96.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(ArcadeColors.Surface)
                    .border(1.dp, ArcadeColors.Outline, RoundedCornerShape(22.dp))
                    .padding(vertical = 18.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    Quick(ArcadeIcons.Gamepad, "Игры") { onAction(ComposeAction.GAMES) }
                    Quick(ArcadeIcons.Editor, "Редактор", soon = true) {}
                    Quick(ArcadeIcons.Post, "Пост") { onAction(ComposeAction.POST) }
                    Quick(ArcadeIcons.Swords, "Турнир", soon = true) {}
                    Quick(ArcadeIcons.Target, "Мэтч", soon = true) {}
                }
                Spacer(Modifier.height(16.dp))
                Box(
                    Modifier
                        .padding(horizontal = 18.dp)
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(ArcadeColors.Outline),
                )
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    Tile(ArcadeIcons.Camera, "IRL\nстрим", Color(0xFF2E9BD6)) {
                        onAction(ComposeAction.GO_LIVE_CAMERA)
                    }
                    Tile(ArcadeIcons.Broadcast, "Стрим\nигр", ArcadeColors.Coral) {
                        onAction(ComposeAction.GO_LIVE_SCREEN)
                    }
                    Tile(ArcadeIcons.Mic, "Голосовая\nкомната", Color(0xFF8E54C9)) {
                        onAction(ComposeAction.VOICE)
                    }
                    Tile(ArcadeIcons.Cube, "Minecraft", Color(0xFF5BA829)) {
                        onAction(ComposeAction.MINECRAFT)
                    }
                }
            }
        }
    }
}

@Composable
private fun Quick(icon: ImageVector, label: String, soon: Boolean = false, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable(enabled = !soon, onClick = onClick)
            .padding(horizontal = 6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(ArcadeColors.SurfaceRaised),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                null,
                tint = if (soon) ArcadeColors.TextMuted else ArcadeColors.TextPrimary,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(
            text = label,
            color = if (soon) ArcadeColors.TextMuted else ArcadeColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun Tile(icon: ImageVector, label: String, tone: Color, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(62.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(tone),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = label,
            color = ArcadeColors.TextSecondary,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(74.dp),
        )
    }
}
