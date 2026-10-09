package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.data.Profile
import com.newrizer.arcade.data.SettingsStore
import com.newrizer.arcade.ui.components.Avatar
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.Chip
import com.newrizer.arcade.ui.components.LevelBar
import com.newrizer.arcade.ui.theme.ArcadeColors

/**
 * The left panel, opened with the menu button or a swipe from the edge.
 * Everything that is not built yet says so instead of pretending to work.
 */
@Composable
fun DrawerPanel(
    profile: Profile?,
    uid: String?,
    onOpenProfile: () -> Unit,
    onOpenMissions: () -> Unit,
    onOpenStats: () -> Unit,
    onOpenRating: () -> Unit,
    onOpenGames: () -> Unit,
    onInvite: () -> Unit,
    onSignOut: () -> Unit,
) {
    var notifications by remember { mutableStateOf(SettingsStore.notifications) }
    var autoplay by remember { mutableStateOf(SettingsStore.autoplayWifiOnly) }
    var resetNote by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxHeight()
            .width(306.dp)
            .background(ArcadeColors.Surface)
            .verticalScroll(rememberScrollState()),
    ) {
        Header(profile, uid, onOpenProfile, onOpenMissions)

        Entry(ArcadeIcons.Stats, "Статистика стрима", onClick = onOpenStats)
        Entry(ArcadeIcons.Swords, "Турниры", soon = true)
        Entry(ArcadeIcons.Trophy, "События", soon = true)
        Entry(ArcadeIcons.Target, "Рейтинг стримеров", onClick = onOpenRating)
        Entry(ArcadeIcons.Gamepad, "Мои игры", onClick = onOpenGames)
        Entry(ArcadeIcons.Community, "Сообщества", soon = true)
        Entry(ArcadeIcons.Gift, "Пригласи друзей", onClick = onInvite)
        Entry(ArcadeIcons.Coupon, "Мои купоны", soon = true)

        Divider()

        SwitchRow(
            icon = ArcadeIcons.BellOff,
            title = "Оповещения",
            detail = "Уведомления о стримах и звонках",
            checked = notifications,
        ) {
            notifications = it
            SettingsStore.notifications = it
        }
        SwitchRow(
            icon = ArcadeIcons.Wifi,
            title = "Автовоспроизведение",
            detail = if (autoplay) "Только по Wi-Fi" else "Всегда",
            checked = autoplay,
        ) {
            autoplay = it
            SettingsStore.autoplayWifiOnly = it
        }
        Entry(ArcadeIcons.Language, "Язык контента", trailing = "русский")
        Entry(ArcadeIcons.Shield, "Приватность", detail = "Ключи, шифрование и доступ")
        Entry(
            icon = ArcadeIcons.Trash,
            title = "Сбросить настройки",
            detail = resetNote ?: "Локальные настройки приложения",
        ) {
            SettingsStore.reset()
            notifications = SettingsStore.notifications
            autoplay = SettingsStore.autoplayWifiOnly
            resetNote = "Сброшено"
        }
        Entry(ArcadeIcons.Help, "Справка", trailing = "")

        Divider()

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onSignOut)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(ArcadeIcons.Exit, null, tint = ArcadeColors.Coral, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(14.dp))
            Text("Выйти", color = ArcadeColors.Coral, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }

        Text(
            text = "Arcade 1.1.0",
            color = ArcadeColors.TextMuted,
            fontSize = 11.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 26.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun Header(
    profile: Profile?,
    uid: String?,
    onOpenProfile: () -> Unit,
    onOpenMissions: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ArcadeColors.Background)
            .padding(18.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.clickable(onClick = onOpenMissions)) {
                Chip("Миссии", accent = true, icon = ArcadeIcons.Missions)
            }
            Spacer(Modifier.width(8.dp))
            Chip("Токены скоро", icon = ArcadeIcons.Token)
        }
        Spacer(Modifier.height(18.dp))
        Row(
            modifier = Modifier.clickable(onClick = onOpenProfile),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(
                uid = uid.orEmpty(),
                name = profile?.displayName.orEmpty(),
                size = 62,
                photo = profile?.photo?.takeIf { it.isNotEmpty() },
            )
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    text = profile?.displayName ?: "Профиль",
                    color = ArcadeColors.TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Black,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = "Открыть профиль",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        LevelBar(
            level = profile?.level ?: 1,
            progress = profile?.levelProgress ?: 0f,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Entry(
    icon: ImageVector,
    title: String,
    detail: String? = null,
    trailing: String? = null,
    soon: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null && !soon) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 18.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            null,
            tint = if (soon) ArcadeColors.TextMuted else ArcadeColors.TextSecondary,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = if (soon) ArcadeColors.TextMuted else ArcadeColors.TextPrimary,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (detail != null) {
                Spacer(Modifier.height(2.dp))
                Text(detail, color = ArcadeColors.TextMuted, fontSize = 11.5.sp)
            }
        }
        when {
            soon -> Chip("скоро")
            !trailing.isNullOrEmpty() -> Text(trailing, color = ArcadeColors.TextSecondary, fontSize = 12.sp)
            onClick != null -> Icon(
                ArcadeIcons.ChevronRight,
                null,
                tint = ArcadeColors.TextMuted,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun SwitchRow(
    icon: ImageVector,
    title: String,
    detail: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = ArcadeColors.TextSecondary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = ArcadeColors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(2.dp))
            Text(detail, color = ArcadeColors.TextMuted, fontSize = 11.5.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = androidx.compose.ui.graphics.Color.White,
                checkedTrackColor = ArcadeColors.Coral,
                uncheckedThumbColor = ArcadeColors.TextSecondary,
                uncheckedTrackColor = ArcadeColors.SurfaceHigh,
                uncheckedBorderColor = ArcadeColors.Outline,
            ),
        )
    }
}

@Composable
private fun Divider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 8.dp)
            .height(1.dp)
            .clip(RoundedCornerShape(1.dp))
            .background(ArcadeColors.Outline),
    )
}
