package com.newrizer.arcade.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.theme.ArcadeColors

/**
 * Loading indicator: three shell-coloured blocks rising and falling like an
 * arcade equaliser, with a yolk-amber block leading. Drawn with Canvas, so it
 * costs one draw call and needs no image asset.
 */
@Composable
fun ArcadeLoader(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 48.dp) {
    val transition = rememberInfiniteTransition(label = "loader")
    val phases = (0..2).map { index ->
        transition.animateFloat(
            initialValue = 0.25f,
            targetValue = 1f,
            animationSpec = InfiniteRepeatableSpec<Float>(
                animation = tween(durationMillis = 560, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
                initialStartOffset = androidx.compose.animation.core.StartOffset(index * 140),
            ),
            label = "bar$index",
        )
    }

    Canvas(modifier = modifier.size(size)) {
        val barWidth = this.size.width / 5f
        val gap = barWidth / 2f
        val totalWidth = barWidth * 3 + gap * 2
        val startX = (this.size.width - totalWidth) / 2f
        phases.forEachIndexed { index, phase ->
            val barHeight = this.size.height * phase.value
            drawRoundRect(
                color = if (index == 1) ArcadeColors.Amber else ArcadeColors.Shell,
                topLeft = Offset(startX + index * (barWidth + gap), (this.size.height - barHeight) / 2f),
                size = Size(barWidth, barHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(barWidth / 3f),
            )
        }
    }
}

@Composable
fun ArcadeButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    tone: ButtonTone = ButtonTone.Primary,
) {
    val background = when {
        !enabled -> ArcadeColors.SurfaceRaised
        tone == ButtonTone.Primary -> ArcadeColors.Amber
        tone == ButtonTone.Danger -> ArcadeColors.Live
        else -> ArcadeColors.SurfaceRaised
    }
    val content = when {
        !enabled -> ArcadeColors.TextSecondary
        tone == ButtonTone.Primary -> ArcadeColors.OnAmber
        tone == ButtonTone.Danger -> Color.White
        else -> ArcadeColors.TextPrimary
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(background)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, tint = content, modifier = Modifier.size(18.dp))
        }
        Text(
            text = text.uppercase(),
            color = content,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = if (icon != null) 10.dp else 0.dp),
        )
    }
}

enum class ButtonTone { Primary, Neutral, Danger }

@Composable
fun ArcadeField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    isPassword: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        visualTransformation = if (isPassword) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = ArcadeColors.Amber,
            unfocusedBorderColor = ArcadeColors.Outline,
            focusedLabelColor = ArcadeColors.Amber,
            unfocusedLabelColor = ArcadeColors.TextSecondary,
            focusedTextColor = ArcadeColors.TextPrimary,
            unfocusedTextColor = ArcadeColors.TextPrimary,
            cursorColor = ArcadeColors.Amber,
        ),
    )
}

@Composable
fun ArcadeCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(ArcadeColors.Surface)
            .border(BorderStroke(1.dp, ArcadeColors.Outline), RoundedCornerShape(18.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(16.dp),
    ) { content() }
}

@Composable
fun Pill(text: String, tone: Color = ArcadeColors.TextSecondary, icon: ImageVector? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(ArcadeColors.SurfaceRaised)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, tint = tone, modifier = Modifier.size(12.dp))
        }
        Text(
            text = text.uppercase(),
            color = tone,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = if (icon != null) 6.dp else 0.dp),
        )
    }
}

@Composable
fun SectionHeader(title: String, subtitle: String? = null) {
    Column(modifier = Modifier.padding(bottom = 12.dp)) {
        Text(
            text = title,
            color = ArcadeColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
        )
        if (subtitle != null) {
            Text(text = subtitle, color = ArcadeColors.TextSecondary, fontSize = 13.sp)
        }
    }
}

@Composable
fun EmptyState(title: String, message: String, icon: ImageVector) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = ArcadeColors.AmberDim,
            modifier = Modifier.size(40.dp),
        )
        Text(
            text = title,
            color = ArcadeColors.TextPrimary,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
            modifier = Modifier.padding(top = 14.dp),
        )
        Text(
            text = message,
            color = ArcadeColors.TextSecondary,
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 4.dp, start = 32.dp, end = 32.dp),
        )
    }
}

@Composable
fun ErrorBanner(message: String?, modifier: Modifier = Modifier) {
    if (message.isNullOrBlank()) return
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x33FF4D4D))
            .border(BorderStroke(1.dp, ArcadeColors.Live), RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Text(text = message, color = ArcadeColors.TextPrimary, fontSize = 13.sp)
    }
}

@Composable
fun Divider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(ArcadeColors.Outline),
    )
}
