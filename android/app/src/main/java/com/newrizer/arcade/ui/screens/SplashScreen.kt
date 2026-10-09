package com.newrizer.arcade.ui.screens

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import androidx.compose.animation.core.Animatable
import com.newrizer.arcade.ui.components.Loader
import com.newrizer.arcade.ui.theme.ArcadeColors
import kotlinx.coroutines.delay

/**
 * Launch animation: the controller mark draws itself on the flat red field,
 * its long shadow sweeps in, then the app hands over to the first screen.
 * It is vector drawn on the fly - no bundled video, no decoding cost.
 */
@Composable
fun SplashScreen(onDone: () -> Unit) {
    val appear = remember { Animatable(0.82f) }
    var shadow by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(Unit) {
        appear.animateTo(1f, tween(620, easing = FastOutSlowInEasing))
        shadow = 1f
        delay(900)
        onDone()
    }

    val pulse = rememberInfiniteTransition(label = "pulse")
    val glow by pulse.animateFloat(
        initialValue = 0.85f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Reverse),
        label = "glow",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ArcadeColors.Background),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(modifier = Modifier.size(148.dp)) {
                scale(appear.value) { drawMark(shadow, glow) }
            }
            Spacer(Modifier.height(26.dp))
            Text(
                text = "ARCADE",
                color = ArcadeColors.TextPrimary,
                fontSize = 26.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 8.sp,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "стримы  ·  голос  ·  миры",
                color = ArcadeColors.TextMuted,
                fontSize = 12.sp,
                letterSpacing = 1.sp,
            )
            Spacer(Modifier.height(34.dp))
            Loader()
        }
    }
}

/** The controller silhouette, drawn to the same proportions as the app icon. */
private fun DrawScope.drawMark(shadowProgress: Float, glow: Float) {
    val unit = size.minDimension / 108f
    fun x(value: Float) = value * unit
    fun y(value: Float) = value * unit

    val field = Path().apply {
        addRoundRect(
            androidx.compose.ui.geometry.RoundRect(
                left = 0f,
                top = 0f,
                right = size.width,
                bottom = size.height,
                radiusX = x(26f),
                radiusY = y(26f),
            ),
        )
    }
    drawPath(field, ArcadeColors.Coral.copy(alpha = glow))

    if (shadowProgress > 0f) {
        val shade = Path().apply {
            moveTo(x(26f), y(62f))
            lineTo(x(82f), y(62f))
            lineTo(x(82f + 46f * shadowProgress), y(62f + 46f * shadowProgress))
            lineTo(x(26f + 46f * shadowProgress), y(62f + 46f * shadowProgress))
            close()
        }
        clipAndDraw(field) { drawPath(shade, Color.Black.copy(alpha = 0.16f)) }
    }

    val body = Path().apply {
        moveTo(x(30f), y(44f))
        cubicTo(x(23f), y(52f), x(21f), y(62f), x(26f), y(68f))
        cubicTo(x(30f), y(74f), x(38f), y(73f), x(44f), y(69f))
        cubicTo(x(50f), y(65f), x(58f), y(65f), x(64f), y(69f))
        cubicTo(x(70f), y(73f), x(78f), y(74f), x(82f), y(68f))
        cubicTo(x(87f), y(62f), x(85f), y(52f), x(78f), y(44f))
        cubicTo(x(74f), y(39f), x(68f), y(38f), x(62f), y(40f))
        cubicTo(x(57f), y(42f), x(51f), y(42f), x(46f), y(40f))
        cubicTo(x(40f), y(38f), x(34f), y(39f), x(30f), y(44f))
        close()
    }
    drawPath(body, Color(0xFFBE2016))

    val cross = Path().apply {
        moveTo(x(39f), y(48f))
        lineTo(x(43f), y(48f))
        lineTo(x(43f), y(52f))
        lineTo(x(47f), y(52f))
        lineTo(x(47f), y(56f))
        lineTo(x(43f), y(56f))
        lineTo(x(43f), y(60f))
        lineTo(x(39f), y(60f))
        lineTo(x(39f), y(56f))
        lineTo(x(35f), y(56f))
        lineTo(x(35f), y(52f))
        lineTo(x(39f), y(52f))
        close()
    }
    drawPath(cross, Color(0xFF8E140C))

    drawCircle(
        color = Color(0xFF8E140C),
        radius = x(7.4f),
        center = Offset(x(67f), y(54f)),
        style = Fill,
    )
}

private fun DrawScope.clipAndDraw(clip: Path, block: DrawScope.() -> Unit) {
    clipPath(clip) { block() }
}

private fun DrawScope.clipPath(path: Path, block: DrawScope.() -> Unit) {
    drawContext.canvas.save()
    drawContext.canvas.clipPath(path)
    block()
    drawContext.canvas.restore()
}
