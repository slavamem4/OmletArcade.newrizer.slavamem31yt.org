package com.newrizer.arcade.ui.theme

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
 * Arcade palette, taken from the reference screens: a cool near-black canvas
 * with slate surfaces and a single warm coral accent. One accent only - it
 * marks the active tab, the compose button and anything live.
 */
object ArcadeColors {
    val Background = Color(0xFF15161C)
    val Surface = Color(0xFF1E202A)
    val SurfaceRaised = Color(0xFF262935)
    val SurfaceHigh = Color(0xFF2F3341)
    val Outline = Color(0xFF343847)
    val Coral = Color(0xFFF2593C)
    val CoralDim = Color(0xFF7A2B1D)
    val CoralSoft = Color(0x1AF2593C)
    val TextPrimary = Color(0xFFF3F4F7)
    val TextSecondary = Color(0xFF8B919F)
    val TextMuted = Color(0xFF636A79)
    val Live = Color(0xFFFF4133)
    val Good = Color(0xFF35C77B)
    val Gold = Color(0xFFF2B33C)
    val OnCoral = Color(0xFFFFFFFF)
}

private val scheme = darkColorScheme(
    primary = ArcadeColors.Coral,
    onPrimary = ArcadeColors.OnCoral,
    secondary = ArcadeColors.Gold,
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
        fontSize = 28.sp,
        letterSpacing = (-0.6).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        letterSpacing = (-0.2).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        letterSpacing = 0.2.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 0.4.sp,
    ),
)

@Composable
fun ArcadeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
