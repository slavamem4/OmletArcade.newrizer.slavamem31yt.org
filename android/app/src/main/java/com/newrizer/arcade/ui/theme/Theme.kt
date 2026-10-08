package com.newrizer.arcade.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Night-first arcade palette: near-black canvas, one warm amber accent taken
 * from the shell-and-yolk mark, and a single cool signal colour for live state.
 * No gradient-purple defaults, no second accent competing with the first.
 */
object ArcadeColors {
    val Background = Color(0xFF0B0D10)
    val Surface = Color(0xFF14171C)
    val SurfaceRaised = Color(0xFF1B1F26)
    val Outline = Color(0xFF262B33)
    val Amber = Color(0xFFFFC53D)
    val AmberDim = Color(0xFF8A6A1F)
    val Shell = Color(0xFFF6F1E7)
    val TextPrimary = Color(0xFFF2F4F7)
    val TextSecondary = Color(0xFF9AA3AF)
    val Live = Color(0xFFFF4D4D)
    val Good = Color(0xFF32D583)
    val OnAmber = Color(0xFF14110A)
}

private val scheme = darkColorScheme(
    primary = ArcadeColors.Amber,
    onPrimary = ArcadeColors.OnAmber,
    secondary = ArcadeColors.Shell,
    onSecondary = ArcadeColors.Background,
    background = ArcadeColors.Background,
    onBackground = ArcadeColors.TextPrimary,
    surface = ArcadeColors.Surface,
    onSurface = ArcadeColors.TextPrimary,
    surfaceVariant = ArcadeColors.SurfaceRaised,
    onSurfaceVariant = ArcadeColors.TextSecondary,
    outline = ArcadeColors.Outline,
    error = ArcadeColors.Live,
)

private val typography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 30.sp,
        letterSpacing = (-0.6).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 21.sp,
        letterSpacing = (-0.3).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        letterSpacing = 0.6.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.8.sp,
    ),
)

@Composable
fun ArcadeTheme(content: @Composable () -> Unit) {
    // The product is night-only on purpose; a light scheme would wash out the
    // live indicators that carry meaning here.
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
