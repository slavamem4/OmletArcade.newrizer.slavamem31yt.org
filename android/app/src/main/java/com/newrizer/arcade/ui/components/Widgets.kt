package com.newrizer.arcade.ui.components

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.theme.ArcadeColors

// ---- text -------------------------------------------------------------------

@Composable
fun SectionTitle(text: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = text,
            color = ArcadeColors.TextPrimary,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
        )
        if (action != null && onAction != null) {
            Text(
                text = action,
                color = ArcadeColors.Coral,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = ArcadeColors.TextSecondary,
        fontSize = 12.sp,
        lineHeight = 17.sp,
        modifier = modifier,
    )
}

// ---- buttons ----------------------------------------------------------------

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(if (enabled) ArcadeColors.Coral else ArcadeColors.SurfaceHigh)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (enabled) ArcadeColors.OnCoral else ArcadeColors.TextMuted,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

@Composable
fun GhostButton(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(ArcadeColors.SurfaceRaised)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = ArcadeColors.TextPrimary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = ArcadeColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun IconBubble(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    tint: Color = ArcadeColors.TextPrimary,
    badge: Boolean = false,
    onClick: () -> Unit,
) {
    Box(modifier = modifier.size(40.dp).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, description, tint = tint, modifier = Modifier.size(23.dp))
        if (badge) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 6.dp, end = 6.dp)
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(ArcadeColors.Live),
            )
        }
    }
}

// ---- inputs -----------------------------------------------------------------

@Composable
fun ArcadeField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    numeric: Boolean = false,
    singleLine: Boolean = true,
    minHeight: Int = 50,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(minHeight.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(ArcadeColors.SurfaceRaised)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (value.isEmpty()) {
            Text(placeholder, color = ArcadeColors.TextMuted, fontSize = 14.sp)
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            textStyle = androidx.compose.ui.text.TextStyle(
                color = ArcadeColors.TextPrimary,
                fontSize = 14.sp,
            ),
            cursorBrush = SolidColor(ArcadeColors.Coral),
            visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = when {
                    password -> KeyboardType.Password
                    numeric -> KeyboardType.Number
                    else -> KeyboardType.Text
                },
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The underlined search field from the top bar. */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                ArcadeIcons.Search,
                "Поиск",
                tint = ArcadeColors.TextSecondary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text("Поиск", color = ArcadeColors.TextSecondary, fontSize = 15.sp)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(
                        color = ArcadeColors.TextPrimary,
                        fontSize = 15.sp,
                    ),
                    cursorBrush = SolidColor(ArcadeColors.Coral),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(ArcadeColors.Outline),
        )
    }
}

// ---- surfaces ---------------------------------------------------------------

@Composable
fun Card(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ArcadeColors.Surface)
            .border(1.dp, ArcadeColors.Outline, RoundedCornerShape(14.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) { content() }
}

@Composable
fun Chip(text: String, accent: Boolean = false, icon: ImageVector? = null) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (accent) ArcadeColors.CoralSoft else ArcadeColors.SurfaceHigh)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(
                icon,
                null,
                tint = if (accent) ArcadeColors.Coral else ArcadeColors.TextSecondary,
                modifier = Modifier.size(13.dp),
            )
            Spacer(Modifier.width(5.dp))
        }
        Text(
            text = text,
            color = if (accent) ArcadeColors.Coral else ArcadeColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
fun LiveBadge(label: String = "LIVE") {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(ArcadeColors.Live)
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(5.dp).clip(CircleShape).background(Color.White))
        Spacer(Modifier.width(5.dp))
        Text(label, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Black)
    }
}

/**
 * Deterministic avatar: the same account always gets the same colour and
 * initials, so people recognise each other without any uploaded picture.
 */
@Composable
fun Avatar(uid: String, name: String, size: Int = 44, photo: String? = null) {
    val bitmap = remember(photo) { photo?.let(::decodeImage) }
    val palette = listOf(
        Color(0xFFF2593C), Color(0xFF3C8CF2), Color(0xFF35C77B),
        Color(0xFFF2B33C), Color(0xFFB45CF2), Color(0xFF19B9C4),
    )
    val tone = palette[(uid.hashCode().toUInt() % palette.size.toUInt()).toInt()]
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (bitmap == null) tone.copy(alpha = 0.22f) else Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            androidx.compose.foundation.Image(
                bitmap = bitmap,
                contentDescription = name,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                text = name.trim().take(1).uppercase().ifEmpty { "A" },
                color = tone,
                fontSize = (size * 0.42f).sp,
                fontWeight = FontWeight.Black,
            )
        }
    }
}

fun decodeImage(base64: String): ImageBitmap? = runCatching {
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

// ---- feedback ---------------------------------------------------------------

@Composable
fun EmptyState(title: String, message: String, icon: ImageVector) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 40.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = ArcadeColors.TextMuted, modifier = Modifier.size(34.dp))
        Spacer(Modifier.height(16.dp))
        Text(
            title,
            color = ArcadeColors.TextSecondary,
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            color = ArcadeColors.TextMuted,
            fontSize = 13.sp,
            lineHeight = 19.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
fun ErrorBanner(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(ArcadeColors.Live.copy(alpha = 0.14f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(ArcadeColors.Live))
        Spacer(Modifier.width(10.dp))
        Text(
            message,
            color = ArcadeColors.TextPrimary,
            fontSize = 13.sp,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Three-dot pulse used while the network is busy. */
@Composable
fun Loader(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "loader")
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = 0.25f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(560, delayMillis = index * 160),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "dot$index",
            )
            Box(
                Modifier
                    .padding(horizontal = 3.dp)
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(ArcadeColors.Coral.copy(alpha = alpha)),
            )
        }
    }
}

/** Experience bar under the profile name. */
@Composable
fun LevelBar(level: Int, progress: Float, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "Уровень $level",
                color = ArcadeColors.TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "${(progress * 100).toInt()}%",
                color = ArcadeColors.TextSecondary,
                fontSize = 12.sp,
            )
        }
        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(ArcadeColors.SurfaceHigh),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(ArcadeColors.Coral),
            )
        }
    }
}
