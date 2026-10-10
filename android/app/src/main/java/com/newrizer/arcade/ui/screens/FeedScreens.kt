package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.data.McSession
import com.newrizer.arcade.data.Post
import com.newrizer.arcade.data.Stream
import com.newrizer.arcade.data.UserCard
import com.newrizer.arcade.data.VoiceRoom
import com.newrizer.arcade.ui.FeedState
import com.newrizer.arcade.ui.SearchState
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.Avatar
import com.newrizer.arcade.ui.components.Card
import com.newrizer.arcade.ui.components.Chip
import com.newrizer.arcade.ui.components.EmptyState
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.components.GhostButton
import com.newrizer.arcade.ui.components.LiveBadge
import com.newrizer.arcade.ui.components.Loader
import com.newrizer.arcade.ui.components.SectionTitle
import com.newrizer.arcade.ui.components.decodeImage
import com.newrizer.arcade.ui.theme.ArcadeColors

// ---- home -------------------------------------------------------------------

@Composable
fun HomeScreen(
    feed: FeedState,
    search: SearchState,
    currentUid: String,
    onRefresh: () -> Unit,
    onWatch: (Stream) -> Unit,
    onOpenUser: (UserCard) -> Unit,
    onNewPost: () -> Unit,
    onDeletePost: (String) -> Unit,
) {
    if (search.query.trim().length >= 2) {
        SearchResults(search, onOpenUser)
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (feed.error != null) item { ErrorBanner(feed.error) }

        item {
            SectionTitle("Сейчас в эфире", action = "Обновить", onAction = onRefresh)
        }
        if (feed.streams.isEmpty()) {
            item {
                if (feed.loading) {
                    Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                        Loader()
                    }
                } else {
                    EmptyState(
                        title = "Пока никто не стримит",
                        message = "Нажми плюс внизу, чтобы запустить свой эфир первым.",
                        icon = ArcadeIcons.Broadcast,
                    )
                }
            }
        } else {
            item {
                LazyRow(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(feed.streams, key = { it.id }) { stream ->
                        StreamCard(stream) { onWatch(stream) }
                    }
                }
            }
        }

        item { SectionTitle("Лента", action = "Написать", onAction = onNewPost) }
        if (feed.posts.isEmpty()) {
            item {
                EmptyState(
                    title = "Постов ещё нет",
                    message = "Поделись скриншотом или расскажи, во что играешь.",
                    icon = ArcadeIcons.Post,
                )
            }
        } else {
            items(feed.posts, key = { it.id }) { post ->
                PostCard(post, canDelete = post.authorUid == currentUid) { onDeletePost(post.id) }
            }
        }
        item { Spacer(Modifier.height(90.dp)) }
    }
}

@Composable
private fun SearchResults(search: SearchState, onOpenUser: (UserCard) -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        SectionTitle("Пользователи")
        when {
            search.searching -> Box(
                Modifier.fillMaxWidth().padding(28.dp),
                contentAlignment = Alignment.Center,
            ) { Loader() }

            search.results.isEmpty() -> EmptyState(
                title = "Никого не нашли",
                message = "Проверь никнейм — поиск идёт по началу имени.",
                icon = ArcadeIcons.Friends,
            )

            else -> LazyColumn {
                items(search.results, key = { it.uid }) { user ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenUser(user) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(user.uid, user.displayName, 42, user.photo.takeIf { it.isNotEmpty() })
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                user.displayName,
                                color = ArcadeColors.TextPrimary,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text("Уровень ${user.level}", color = ArcadeColors.TextMuted, fontSize = 12.sp)
                        }
                        Icon(
                            ArcadeIcons.ChevronRight,
                            null,
                            tint = ArcadeColors.TextMuted,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}

// ---- streams ------------------------------------------------------------------

@Composable
fun StreamsScreen(feed: FeedState, onRefresh: () -> Unit, onWatch: (Stream) -> Unit, onGoLive: () -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionTitle("Трансляции", action = "Обновить", onAction = onRefresh) }
        item {
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                GhostButton("Начать эфир", icon = ArcadeIcons.Broadcast, onClick = onGoLive)
            }
        }
        if (feed.streams.isEmpty()) {
            item {
                EmptyState(
                    title = "Эфиров нет",
                    message = "Запусти трансляцию экрана или камеры — зрители увидят её здесь.",
                    icon = ArcadeIcons.Broadcast,
                )
            }
        } else {
            items(feed.streams, key = { it.id }) { stream ->
                WideStreamRow(stream) { onWatch(stream) }
            }
        }
        item { Spacer(Modifier.height(90.dp)) }
    }
}

// ---- games / minecraft ----------------------------------------------------------

@Composable
fun GamesScreen(
    feed: FeedState,
    onRefresh: () -> Unit,
    onHost: () -> Unit,
    onJoinCode: () -> Unit,
    onJoinSession: (McSession) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionTitle("Миры Minecraft", action = "Обновить", onAction = onRefresh) }
        item {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                GhostButton("Захостить мир", icon = ArcadeIcons.Cube, onClick = onHost)
                GhostButton("По коду", icon = ArcadeIcons.Key, onClick = onJoinCode)
            }
        }
        if (feed.mcSessions.isEmpty()) {
            item {
                EmptyState(
                    title = "Открытых миров нет",
                    message = "Захости свой мир: туннель Arcade пустит игроков из любой сети, а не только из твоего Wi-Fi.",
                    icon = ArcadeIcons.Cube,
                )
            }
        } else {
            items(feed.mcSessions, key = { it.id }) { session ->
                McCard(session) { onJoinSession(session) }
            }
        }
        item { Spacer(Modifier.height(90.dp)) }
    }
}

// ---- chat / voice ----------------------------------------------------------------

@Composable
fun ChatScreen(
    feed: FeedState,
    onRefresh: () -> Unit,
    onCreateVoice: () -> Unit,
    onJoinVoice: (VoiceRoom) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionTitle("Голосовые комнаты", action = "Обновить", onAction = onRefresh) }
        item {
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                GhostButton("Создать комнату", icon = ArcadeIcons.Mic, onClick = onCreateVoice)
            }
        }
        if (feed.voiceRooms.isEmpty()) {
            item {
                EmptyState(
                    title = "Нет активных комнат",
                    message = "Личные и групповые разговоры появятся здесь. Создай комнату, чтобы начать общение.",
                    icon = ArcadeIcons.Chat,
                )
            }
        } else {
            items(feed.voiceRooms, key = { it.id }) { room ->
                VoiceRow(room) { onJoinVoice(room) }
            }
        }
        item { Spacer(Modifier.height(90.dp)) }
    }
}

// ---- cards -------------------------------------------------------------------------

@Composable
private fun StreamCard(stream: Stream, onClick: () -> Unit) {
    Card(modifier = Modifier.width(236.dp), onClick = onClick) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(ArcadeColors.SurfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    ArcadeIcons.Broadcast,
                    null,
                    tint = ArcadeColors.Outline,
                    modifier = Modifier.size(40.dp),
                )
                Box(Modifier.align(Alignment.TopStart).padding(8.dp)) { LiveBadge() }
                Box(Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
                    Chip("${stream.viewers} смотрят")
                }
            }
            Column(Modifier.padding(12.dp)) {
                Text(
                    stream.title,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(5.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(stream.ownerUid, stream.ownerName, 20)
                    Spacer(Modifier.width(7.dp))
                    Text(
                        stream.ownerName.ifEmpty { "игрок" },
                        color = ArcadeColors.TextSecondary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (stream.game.isNotEmpty()) {
                    Spacer(Modifier.height(7.dp))
                    Chip(stream.game)
                }
            }
        }
    }
}

@Composable
private fun WideStreamRow(stream: Stream, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
        onClick = onClick,
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(78.dp, 46.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(ArcadeColors.SurfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Icon(ArcadeIcons.Broadcast, null, tint = ArcadeColors.Outline, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    stream.title,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${stream.ownerName.ifEmpty { "игрок" }} · ${stream.viewers} смотрят",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
            LiveBadge()
        }
    }
}

@Composable
private fun McCard(session: McSession, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
        onClick = onClick,
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFF5BA829)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(ArcadeIcons.Cube, null, tint = Color.White, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    session.name,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${session.edition} ${session.version} · ${session.gameMode} · ${session.players}/${session.maxPlayers}",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
            Chip("Зайти", accent = true)
        }
    }
}

@Composable
private fun VoiceRow(room: VoiceRoom, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
        onClick = onClick,
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(room.ownerUid, room.ownerName, 42)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    room.title,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${room.ownerName.ifEmpty { "игрок" }} · до ${room.maxParticipants} участников",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
            Icon(ArcadeIcons.Mic, null, tint = ArcadeColors.Coral, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
fun PostCard(post: Post, canDelete: Boolean, onDelete: () -> Unit) {
    val image = remember(post.image) { post.image.takeIf { it.isNotEmpty() }?.let(::decodeImage) }
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(post.authorUid, post.authorName, 34)
                Spacer(Modifier.width(10.dp))
                Text(
                    post.authorName.ifEmpty { "игрок" },
                    color = ArcadeColors.TextPrimary,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (canDelete) {
                    Icon(
                        ArcadeIcons.Trash,
                        "Удалить",
                        tint = ArcadeColors.TextMuted,
                        modifier = Modifier.size(18.dp).clickable(onClick = onDelete),
                    )
                }
            }
            if (post.text.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(post.text, color = ArcadeColors.TextPrimary, fontSize = 14.sp, lineHeight = 20.sp)
            }
            if (image != null) {
                Spacer(Modifier.height(10.dp))
                Image(
                    bitmap = image,
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp)),
                )
            }
        }
    }
}
