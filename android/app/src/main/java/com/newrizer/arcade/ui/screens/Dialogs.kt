package com.newrizer.arcade.ui.screens

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.newrizer.arcade.data.McSessionCreate
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.Chip
import com.newrizer.arcade.ui.components.GhostButton
import com.newrizer.arcade.ui.components.Hint
import com.newrizer.arcade.ui.components.PrimaryButton
import com.newrizer.arcade.ui.theme.ArcadeColors

@Composable
private fun Sheet(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(ArcadeColors.Surface)
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = ArcadeColors.TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    ArcadeIcons.Close,
                    "Закрыть",
                    tint = ArcadeColors.TextSecondary,
                    modifier = Modifier.size(20.dp).clickable(onClick = onDismiss),
                )
            }
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

@Composable
private fun Options(values: List<String>, selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        values.forEach { value ->
            Box(Modifier.clickable { onSelect(value) }) {
                Chip(value, accent = value == selected)
            }
        }
    }
}

@Composable
fun GoLiveDialog(camera: Boolean, onDismiss: () -> Unit, onStart: (String, String, String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var game by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("public") }

    Sheet(if (camera) "IRL эфир" else "Стрим игры", onDismiss) {
        ArcadeField(title, { title = it }, "Название эфира")
        Spacer(Modifier.height(10.dp))
        ArcadeField(game, { game = it }, if (camera) "Чем занят" else "Игра")
        Spacer(Modifier.height(14.dp))
        Text("Доступ", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.clickable { visibility = "public" }) {
                Chip("Публичный", accent = visibility == "public")
            }
            Box(Modifier.clickable { visibility = "private" }) {
                Chip("Приватный", accent = visibility == "private")
            }
        }
        Spacer(Modifier.height(10.dp))
        Hint(
            if (visibility == "public") {
                "Публичный эфир виден всем в ленте. Медиа идёт без сквозного шифрования, чат — зашифрован."
            } else {
                "Приватный эфир не попадает в ленту: только по приглашению, медиа шифруется сквозным ключом."
            },
        )
        Spacer(Modifier.height(18.dp))
        PrimaryButton("Начать", Modifier.fillMaxWidth(), enabled = title.trim().length >= 3) {
            onStart(title, game, visibility)
        }
    }
}

@Composable
fun VoiceRoomDialog(onDismiss: () -> Unit, onCreate: (String, Int) -> Unit) {
    var title by remember { mutableStateOf("") }
    var size by remember { mutableStateOf("10") }

    Sheet("Голосовая комната", onDismiss) {
        ArcadeField(title, { title = it }, "Название комнаты")
        Spacer(Modifier.height(14.dp))
        Text("Сколько человек", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Options(listOf("4", "10", "20", "50"), size) { size = it }
        Spacer(Modifier.height(10.dp))
        Hint("Голос шифруется сквозным ключом: сервер и Firebase слышат только шум.")
        Spacer(Modifier.height(18.dp))
        PrimaryButton("Создать", Modifier.fillMaxWidth(), enabled = title.trim().length >= 3) {
            onCreate(title, size.toIntOrNull() ?: 10)
        }
    }
}

@Composable
fun HostWorldDialog(lanAddress: String?, onDismiss: () -> Unit, onHost: (McSessionCreate) -> Unit, onOpenHotspot: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var version by remember { mutableStateOf("1.21") }
    var edition by remember { mutableStateOf("bedrock") }
    var mode by remember { mutableStateOf("survival") }
    var size by remember { mutableStateOf("8") }
    var private by remember { mutableStateOf(false) }

    Sheet("Захостить мир", onDismiss) {
        ArcadeField(name, { name = it }, "Название мира")
        Spacer(Modifier.height(12.dp))
        Text("Издание", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.clickable { edition = "bedrock" }) { Chip("Bedrock", accent = edition == "bedrock") }
            Box(Modifier.clickable { edition = "java" }) { Chip("Java", accent = edition == "java") }
        }
        Spacer(Modifier.height(12.dp))
        Text("Версия", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Options(listOf("1.20", "1.21", "1.21.4"), version) { version = it }
        Spacer(Modifier.height(12.dp))
        Text("Режим", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.clickable { mode = "survival" }) { Chip("Выживание", accent = mode == "survival") }
            Box(Modifier.clickable { mode = "creative" }) { Chip("Творческий", accent = mode == "creative") }
            Box(Modifier.clickable { mode = "adventure" }) { Chip("Приключение", accent = mode == "adventure") }
        }
        Spacer(Modifier.height(12.dp))
        Text("Игроков", color = ArcadeColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Options(listOf("4", "8", "16"), size) { size = it }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.clickable { private = !private }) {
                Chip(if (private) "Только по коду" else "Виден всем", accent = private)
            }
        }

        Spacer(Modifier.height(14.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(ArcadeColors.SurfaceRaised)
                .padding(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(ArcadeIcons.Wifi, null, tint = ArcadeColors.Coral, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    "Локальная сеть",
                    color = ArcadeColors.TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(6.dp))
            Hint(
                lanAddress?.let {
                    "Мир раздаёт твой телефон. Игроки в той же сети вводят в Minecraft адрес $it"
                } ?: "Сеть не найдена. Включи Wi-Fi или раздай точку доступа, чтобы друзья подключились.",
            )
            Spacer(Modifier.height(10.dp))
            GhostButton("Открыть точку доступа", icon = ArcadeIcons.Wifi, onClick = onOpenHotspot)
        }

        Spacer(Modifier.height(18.dp))
        PrimaryButton("Захостить", Modifier.fillMaxWidth(), enabled = name.trim().length >= 3) {
            onHost(
                McSessionCreate(
                    name = name,
                    version = version,
                    edition = edition,
                    maxPlayers = size.toIntOrNull() ?: 8,
                    gameMode = mode,
                    isPrivate = private,
                ),
            )
        }
    }
}

@Composable
fun JoinCodeDialog(onDismiss: () -> Unit, onJoin: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    Sheet("Вход по коду", onDismiss) {
        ArcadeField(code, { if (it.length <= 8) code = it.uppercase() }, "XXXXXXXX")
        Spacer(Modifier.height(10.dp))
        Hint("Код из восьми символов выдаёт хост мира. Он не хранится в открытых списках.")
        Spacer(Modifier.height(18.dp))
        PrimaryButton("Войти", Modifier.fillMaxWidth(), enabled = code.length == 8) { onJoin(code) }
    }
}

@Composable
fun NewPostDialog(
    image: Uri?,
    onPickImage: () -> Unit,
    onDismiss: () -> Unit,
    onPublish: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    Sheet("Новый пост", onDismiss) {
        ArcadeField(text, { if (it.length <= 500) text = it }, "Что нового?", singleLine = false, minHeight = 110)
        Spacer(Modifier.height(12.dp))
        GhostButton(
            text = if (image == null) "Добавить картинку" else "Картинка выбрана",
            icon = ArcadeIcons.Image,
            onClick = onPickImage,
        )
        Spacer(Modifier.height(10.dp))
        Hint("Картинка сжимается на телефоне и хранится в базе — облачного хранилища в проекте нет.")
        Spacer(Modifier.height(18.dp))
        PrimaryButton(
            "Опубликовать",
            Modifier.fillMaxWidth(),
            enabled = text.isNotBlank() || image != null,
        ) { onPublish(text) }
    }
}

@Composable
fun EditProfileDialog(
    initialName: String,
    initialBio: String,
    avatar: Uri?,
    onPickAvatar: () -> Unit,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var name by remember { mutableStateOf(initialName) }
    var bio by remember { mutableStateOf(initialBio) }

    Sheet("Профиль", onDismiss) {
        ArcadeField(name, { if (it.length <= 24) name = it }, "Никнейм")
        Spacer(Modifier.height(10.dp))
        ArcadeField(bio, { if (it.length <= 140) bio = it }, "О себе", singleLine = false, minHeight = 88)
        Spacer(Modifier.height(12.dp))
        GhostButton(
            text = if (avatar == null) "Сменить фото" else "Фото выбрано",
            icon = ArcadeIcons.Camera,
            onClick = onPickAvatar,
        )
        Spacer(Modifier.height(18.dp))
        PrimaryButton("Сохранить", Modifier.fillMaxWidth(), enabled = name.trim().length >= 2) {
            onSave(name, bio)
        }
    }
}
