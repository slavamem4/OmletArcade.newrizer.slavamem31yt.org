package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.data.Mission
import com.newrizer.arcade.ui.ProfileState
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.Avatar
import com.newrizer.arcade.ui.components.Card
import com.newrizer.arcade.ui.components.Chip
import com.newrizer.arcade.ui.components.EmptyState
import com.newrizer.arcade.ui.components.GhostButton
import com.newrizer.arcade.ui.components.LevelBar
import com.newrizer.arcade.ui.components.SectionTitle
import com.newrizer.arcade.ui.theme.ArcadeColors

@Composable
fun ProfileScreen(
    state: ProfileState,
    uid: String?,
    keyFingerprint: String,
    onEdit: () -> Unit,
    onNewPost: () -> Unit,
    onDeletePost: (String) -> Unit,
) {
    val profile = state.profile

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ArcadeColors.Surface)
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(
                        uid = uid.orEmpty(),
                        name = profile?.displayName.orEmpty(),
                        size = 72,
                        photo = profile?.photo?.takeIf { it.isNotEmpty() },
                    )
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            profile?.displayName ?: "Без имени",
                            color = ArcadeColors.TextPrimary,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Spacer(Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Chip("Уровень ${profile?.level ?: 1}", accent = true, icon = ArcadeIcons.Level)
                            Chip("${profile?.xp ?: 0} XP")
                        }
                    }
                }
                if (!profile?.bio.isNullOrEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    Text(
                        profile.bio,
                        color = ArcadeColors.TextSecondary,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    )
                }
                Spacer(Modifier.height(16.dp))
                LevelBar(profile?.level ?: 1, profile?.levelProgress ?: 0f, Modifier.fillMaxWidth())
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GhostButton("Редактировать", icon = ArcadeIcons.Avatar, onClick = onEdit)
                    GhostButton("Новый пост", icon = ArcadeIcons.Post, onClick = onNewPost)
                }
                if (state.notice != null) {
                    Spacer(Modifier.height(12.dp))
                    Text(state.notice, color = ArcadeColors.Good, fontSize = 12.sp)
                }
            }
        }

        item { SectionTitle("Миссии") }
        items(state.missions, key = { it.id }) { mission -> MissionRow(mission) }

        item { SectionTitle("Мои посты") }
        if (state.posts.isEmpty()) {
            item {
                EmptyState(
                    title = "Постов нет",
                    message = "Выложи скриншот или короткую заметку — они появятся в ленте.",
                    icon = ArcadeIcons.Post,
                )
            }
        } else {
            items(state.posts, key = { it.id }) { post ->
                PostCard(post, canDelete = true) { onDeletePost(post.id) }
            }
        }

        item {
            Column(Modifier.padding(16.dp)) {
                Text("Отпечаток ключа устройства", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
                Spacer(Modifier.height(6.dp))
                Text(
                    text = keyFingerprint.chunked(4).joinToString(" "),
                    color = ArcadeColors.TextMuted,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(90.dp))
            }
        }
    }
}

@Composable
private fun MissionRow(mission: Mission) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(if (mission.done) ArcadeColors.Good.copy(alpha = 0.18f) else ArcadeColors.SurfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (mission.done) ArcadeIcons.Check else ArcadeIcons.Missions,
                    null,
                    tint = if (mission.done) ArcadeColors.Good else ArcadeColors.TextSecondary,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    mission.title,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(3.dp))
                Text(mission.detail, color = ArcadeColors.TextMuted, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(ArcadeColors.SurfaceHigh),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth((mission.progress.toFloat() / mission.goal).coerceIn(0f, 1f))
                            .height(5.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(if (mission.done) ArcadeColors.Good else ArcadeColors.Coral),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    "+${mission.reward}",
                    color = ArcadeColors.Gold,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                )
                Text("${mission.progress}/${mission.goal}", color = ArcadeColors.TextMuted, fontSize = 11.sp)
            }
        }
    }
}
