package com.newrizer.arcade.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Hand-built icon set. Nothing here comes from a third-party pack and no emoji
 * is used anywhere in the product: every glyph is a vector path drawn on the
 * same 24 unit grid, outlined shapes at a 1.8 unit stroke, solid shapes filled.
 */
object ArcadeIcons {

    private fun icon(name: String, body: Scope.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply { Scope(this).body() }.build()

    class Scope(private val builder: ImageVector.Builder) {

        /** Filled silhouette. */
        fun fill(data: PathBuilder.() -> Unit) {
            builder.path(fill = SolidColor(Color.White), pathBuilder = data)
        }

        /** Outlined stroke, the default language of the navigation icons. */
        fun line(width: Float = 1.8f, data: PathBuilder.() -> Unit) {
            builder.path(
                stroke = SolidColor(Color.White),
                strokeLineWidth = width,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = data,
            )
        }

        fun circle(cx: Float, cy: Float, r: Float, filled: Boolean = true, width: Float = 1.8f) {
            val draw: PathBuilder.() -> Unit = {
                moveTo(cx - r, cy)
                arcToRelative(r, r, 0f, true, true, 2 * r, 0f)
                arcToRelative(r, r, 0f, true, true, -2 * r, 0f)
                close()
            }
            if (filled) fill(draw) else line(width, draw)
        }

        fun roundRect(
            left: Float,
            top: Float,
            right: Float,
            bottom: Float,
            radius: Float,
            filled: Boolean = false,
            width: Float = 1.8f,
        ) {
            val draw: PathBuilder.() -> Unit = {
                moveTo(left + radius, top)
                lineTo(right - radius, top)
                arcToRelative(radius, radius, 0f, false, true, radius, radius)
                lineTo(right, bottom - radius)
                arcToRelative(radius, radius, 0f, false, true, -radius, radius)
                lineTo(left + radius, bottom)
                arcToRelative(radius, radius, 0f, false, true, -radius, -radius)
                lineTo(left, top + radius)
                arcToRelative(radius, radius, 0f, false, true, radius, -radius)
                close()
            }
            if (filled) fill(draw) else line(width, draw)
        }
    }

    // ---- bottom navigation --------------------------------------------------

    val Home: ImageVector = icon("Home") {
        line {
            moveTo(3.6f, 10.4f)
            lineTo(12f, 3.4f)
            lineTo(20.4f, 10.4f)
            lineTo(20.4f, 19.2f)
            curveTo(20.4f, 19.9f, 19.9f, 20.4f, 19.2f, 20.4f)
            lineTo(4.8f, 20.4f)
            curveTo(4.1f, 20.4f, 3.6f, 19.9f, 3.6f, 19.2f)
            close()
        }
        line { moveTo(9.4f, 20.4f); lineTo(9.4f, 14.2f); lineTo(14.6f, 14.2f); lineTo(14.6f, 20.4f) }
    }

    /** Concentric broadcast arcs for the streaming tab. */
    val Broadcast: ImageVector = icon("Broadcast") {
        circle(12f, 12f, 2.4f)
        line { moveTo(7.8f, 7.8f); arcToRelative(5.9f, 5.9f, 0f, false, false, 0f, 8.4f) }
        line { moveTo(16.2f, 16.2f); arcToRelative(5.9f, 5.9f, 0f, false, false, 0f, -8.4f) }
        line { moveTo(4.9f, 4.9f); arcToRelative(10f, 10f, 0f, false, false, 0f, 14.2f) }
        line { moveTo(19.1f, 19.1f); arcToRelative(10f, 10f, 0f, false, false, 0f, -14.2f) }
    }

    val Gamepad: ImageVector = icon("Gamepad") {
        line {
            moveTo(7.6f, 7.4f)
            lineTo(16.4f, 7.4f)
            curveTo(19f, 7.4f, 21f, 9.8f, 21f, 12.8f)
            curveTo(21f, 15.1f, 19.8f, 16.6f, 18.2f, 16.6f)
            curveTo(16.4f, 16.6f, 15.6f, 15f, 14.2f, 15f)
            lineTo(9.8f, 15f)
            curveTo(8.4f, 15f, 7.6f, 16.6f, 5.8f, 16.6f)
            curveTo(4.2f, 16.6f, 3f, 15.1f, 3f, 12.8f)
            curveTo(3f, 9.8f, 5f, 7.4f, 7.6f, 7.4f)
            close()
        }
        line { moveTo(7.6f, 10.4f); lineTo(7.6f, 13.4f) }
        line { moveTo(6.1f, 11.9f); lineTo(9.1f, 11.9f) }
        circle(16.2f, 11.9f, 1.5f)
    }

    val Chat: ImageVector = icon("Chat") {
        line {
            moveTo(4f, 6.2f)
            curveTo(4f, 5.3f, 4.7f, 4.6f, 5.6f, 4.6f)
            lineTo(15.4f, 4.6f)
            curveTo(16.3f, 4.6f, 17f, 5.3f, 17f, 6.2f)
            lineTo(17f, 12.4f)
            curveTo(17f, 13.3f, 16.3f, 14f, 15.4f, 14f)
            lineTo(9.2f, 14f)
            lineTo(5.6f, 17f)
            lineTo(5.6f, 14f)
            curveTo(4.7f, 14f, 4f, 13.3f, 4f, 12.4f)
            close()
        }
        line {
            moveTo(19.4f, 8.6f)
            curveTo(20.3f, 8.6f, 21f, 9.3f, 21f, 10.2f)
            lineTo(21f, 16.4f)
            curveTo(21f, 17.3f, 20.3f, 18f, 19.4f, 18f)
            lineTo(19.4f, 21f)
            lineTo(15.8f, 18f)
            lineTo(11.6f, 18f)
        }
    }

    val Plus: ImageVector = icon("Plus") {
        line(2.4f) { moveTo(12f, 5.6f); lineTo(12f, 18.4f) }
        line(2.4f) { moveTo(5.6f, 12f); lineTo(18.4f, 12f) }
    }

    val Close: ImageVector = icon("Close") {
        line(2.4f) { moveTo(6.6f, 6.6f); lineTo(17.4f, 17.4f) }
        line(2.4f) { moveTo(17.4f, 6.6f); lineTo(6.6f, 17.4f) }
    }

    // ---- top bar ------------------------------------------------------------

    val Menu: ImageVector = icon("Menu") {
        line(2f) { moveTo(4f, 7f); lineTo(20f, 7f) }
        line(2f) { moveTo(4f, 12f); lineTo(20f, 12f) }
        line(2f) { moveTo(4f, 17f); lineTo(14f, 17f) }
    }

    val Search: ImageVector = icon("Search") {
        circle(11f, 11f, 6.4f, filled = false)
        line(2f) { moveTo(15.8f, 15.8f); lineTo(20.4f, 20.4f) }
    }

    val Store: ImageVector = icon("Store") {
        line { moveTo(4f, 9.4f); lineTo(20f, 9.4f); lineTo(20f, 19f); lineTo(4f, 19f); close() }
        line { moveTo(4f, 9.4f); lineTo(6f, 5.2f); lineTo(18f, 5.2f); lineTo(20f, 9.4f) }
        line { moveTo(9.6f, 13f); lineTo(14.4f, 13f) }
    }

    val Bell: ImageVector = icon("Bell") {
        line {
            moveTo(6.4f, 16.6f)
            lineTo(6.4f, 11.2f)
            curveTo(6.4f, 8.1f, 8.9f, 5.6f, 12f, 5.6f)
            curveTo(15.1f, 5.6f, 17.6f, 8.1f, 17.6f, 11.2f)
            lineTo(17.6f, 16.6f)
            lineTo(19.2f, 18.4f)
            lineTo(4.8f, 18.4f)
            close()
        }
        line { moveTo(10.2f, 18.4f); curveTo(10.2f, 19.8f, 10.9f, 20.6f, 12f, 20.6f); curveTo(13.1f, 20.6f, 13.8f, 19.8f, 13.8f, 18.4f) }
    }

    val Friends: ImageVector = icon("Friends") {
        circle(9.4f, 9f, 3.4f, filled = false)
        line { moveTo(3.4f, 19.4f); curveTo(3.4f, 16f, 6.1f, 14.2f, 9.4f, 14.2f); curveTo(12.7f, 14.2f, 15.4f, 16f, 15.4f, 19.4f) }
        line { moveTo(16.2f, 6.2f); curveTo(18.1f, 6.6f, 19.4f, 8f, 19.4f, 9.8f); curveTo(19.4f, 11.3f, 18.5f, 12.5f, 17.1f, 13.1f) }
        line { moveTo(17.8f, 14.8f); curveTo(19.9f, 15.6f, 21f, 17.2f, 21f, 19.4f) }
    }

    // ---- drawer -------------------------------------------------------------

    val Stats: ImageVector = icon("Stats") {
        line { moveTo(4f, 19.4f); lineTo(20f, 19.4f) }
        line { moveTo(7f, 19.4f); lineTo(7f, 12f) }
        line { moveTo(12f, 19.4f); lineTo(12f, 7.4f) }
        line { moveTo(17f, 19.4f); lineTo(17f, 14.6f) }
    }

    val Trophy: ImageVector = icon("Trophy") {
        line {
            moveTo(7.6f, 4.6f)
            lineTo(16.4f, 4.6f)
            lineTo(16.4f, 9.6f)
            curveTo(16.4f, 12f, 14.4f, 14f, 12f, 14f)
            curveTo(9.6f, 14f, 7.6f, 12f, 7.6f, 9.6f)
            close()
        }
        line { moveTo(7.6f, 6.4f); lineTo(4.6f, 6.4f); curveTo(4.6f, 9.4f, 5.8f, 10.6f, 7.8f, 10.9f) }
        line { moveTo(16.4f, 6.4f); lineTo(19.4f, 6.4f); curveTo(19.4f, 9.4f, 18.2f, 10.6f, 16.2f, 10.9f) }
        line { moveTo(12f, 14f); lineTo(12f, 17f) }
        line { moveTo(8.4f, 19.4f); lineTo(15.6f, 19.4f); lineTo(14.6f, 17f); lineTo(9.4f, 17f); close() }
    }

    val Swords: ImageVector = icon("Swords") {
        line { moveTo(4.6f, 4.6f); lineTo(8f, 4.6f); lineTo(18f, 14.6f); lineTo(16f, 16.6f); lineTo(6f, 6.6f); close() }
        line { moveTo(19.4f, 4.6f); lineTo(16f, 4.6f); lineTo(6f, 14.6f); lineTo(8f, 16.6f); lineTo(18f, 6.6f); close() }
        line { moveTo(15.4f, 17.4f); lineTo(19.4f, 21.4f) }
        line { moveTo(8.6f, 17.4f); lineTo(4.6f, 21.4f) }
    }

    val Target: ImageVector = icon("Target") {
        circle(12f, 12f, 8f, filled = false)
        circle(12f, 12f, 4.2f, filled = false)
        circle(12f, 12f, 1.3f)
    }

    val Community: ImageVector = icon("Community") {
        circle(7.4f, 9.4f, 2.8f, filled = false)
        circle(16.6f, 9.4f, 2.8f, filled = false)
        line { moveTo(2.8f, 18.6f); curveTo(2.8f, 15.6f, 4.8f, 14f, 7.4f, 14f); curveTo(10f, 14f, 12f, 15.6f, 12f, 18.6f) }
        line { moveTo(12f, 18.6f); curveTo(12f, 15.6f, 14f, 14f, 16.6f, 14f); curveTo(19.2f, 14f, 21.2f, 15.6f, 21.2f, 18.6f) }
    }

    val Gift: ImageVector = icon("Gift") {
        line { moveTo(4.4f, 10.6f); lineTo(19.6f, 10.6f); lineTo(19.6f, 19.4f); lineTo(4.4f, 19.4f); close() }
        line { moveTo(3.4f, 7f); lineTo(20.6f, 7f); lineTo(20.6f, 10.6f); lineTo(3.4f, 10.6f); close() }
        line { moveTo(12f, 7f); lineTo(12f, 19.4f) }
        line { moveTo(12f, 7f); curveTo(10.6f, 4f, 7.2f, 3.6f, 7.2f, 5.6f); curveTo(7.2f, 6.6f, 9f, 7f, 12f, 7f) }
        line { moveTo(12f, 7f); curveTo(13.4f, 4f, 16.8f, 3.6f, 16.8f, 5.6f); curveTo(16.8f, 6.6f, 15f, 7f, 12f, 7f) }
    }

    val Coupon: ImageVector = icon("Coupon") {
        line {
            moveTo(3.4f, 8f)
            lineTo(20.6f, 8f)
            lineTo(20.6f, 10.6f)
            curveTo(19.4f, 10.6f, 18.6f, 11.3f, 18.6f, 12.4f)
            curveTo(18.6f, 13.5f, 19.4f, 14.2f, 20.6f, 14.2f)
            lineTo(20.6f, 16.8f)
            lineTo(3.4f, 16.8f)
            lineTo(3.4f, 14.2f)
            curveTo(4.6f, 14.2f, 5.4f, 13.5f, 5.4f, 12.4f)
            curveTo(5.4f, 11.3f, 4.6f, 10.6f, 3.4f, 10.6f)
            close()
        }
        line { moveTo(12f, 9.6f); lineTo(12f, 11.2f) }
        line { moveTo(12f, 13.6f); lineTo(12f, 15.2f) }
    }

    val Missions: ImageVector = icon("Missions") {
        line { moveTo(5.4f, 5.6f); lineTo(18.6f, 5.6f); lineTo(18.6f, 20.4f); lineTo(5.4f, 20.4f); close() }
        line { moveTo(9f, 5.6f); lineTo(9f, 3.6f); lineTo(15f, 3.6f); lineTo(15f, 5.6f) }
        line { moveTo(8.6f, 11f); lineTo(10.4f, 12.8f); lineTo(14.4f, 8.8f) }
        line { moveTo(8.6f, 16.6f); lineTo(15.4f, 16.6f) }
    }

    val Token: ImageVector = icon("Token") {
        circle(12f, 12f, 8f, filled = false)
        line { moveTo(12f, 7.6f); lineTo(12f, 16.4f) }
        line { moveTo(14.4f, 9.6f); curveTo(13.6f, 8.8f, 10f, 8.4f, 10f, 10.8f); curveTo(10f, 13.2f, 14f, 12.4f, 14f, 14.4f); curveTo(14f, 16.2f, 10.6f, 15.8f, 9.6f, 14.8f) }
    }

    val Settings: ImageVector = icon("Settings") {
        circle(12f, 12f, 2.8f, filled = false)
        line {
            moveTo(12f, 3.4f)
            lineTo(13.6f, 5.4f)
            lineTo(16.2f, 4.9f)
            lineTo(16.9f, 7.4f)
            lineTo(19.4f, 8.2f)
            lineTo(18.8f, 10.8f)
            lineTo(20.6f, 12.6f)
            lineTo(18.8f, 14.4f)
            lineTo(19.2f, 17f)
            lineTo(16.6f, 17.6f)
            lineTo(15.6f, 20f)
            lineTo(13.1f, 19.2f)
            lineTo(11f, 20.6f)
            lineTo(9.3f, 18.6f)
            lineTo(6.7f, 18.8f)
            lineTo(6.2f, 16.2f)
            lineTo(3.9f, 15f)
            lineTo(4.9f, 12.6f)
            lineTo(4.1f, 10.1f)
            lineTo(6.4f, 8.9f)
            lineTo(7f, 6.3f)
            lineTo(9.6f, 6.6f)
            close()
        }
    }

    val BellOff: ImageVector = icon("BellOff") {
        line {
            moveTo(6.4f, 16.6f)
            lineTo(6.4f, 11.2f)
            curveTo(6.4f, 8.1f, 8.9f, 5.6f, 12f, 5.6f)
            curveTo(15.1f, 5.6f, 17.6f, 8.1f, 17.6f, 11.2f)
            lineTo(17.6f, 16.6f)
            lineTo(19.2f, 18.4f)
            lineTo(4.8f, 18.4f)
            close()
        }
        line(2f) { moveTo(4.4f, 4.4f); lineTo(19.6f, 19.6f) }
    }

    val Language: ImageVector = icon("Language") {
        circle(12f, 12f, 8f, filled = false)
        line { moveTo(4f, 12f); lineTo(20f, 12f) }
        line { moveTo(12f, 4f); curveTo(15f, 7.4f, 15f, 16.6f, 12f, 20f); curveTo(9f, 16.6f, 9f, 7.4f, 12f, 4f) }
    }

    val Shield: ImageVector = icon("Shield") {
        line {
            moveTo(12f, 3.6f)
            lineTo(19.4f, 6.4f)
            lineTo(19.4f, 12f)
            curveTo(19.4f, 16.4f, 16.4f, 19.4f, 12f, 20.8f)
            curveTo(7.6f, 19.4f, 4.6f, 16.4f, 4.6f, 12f)
            lineTo(4.6f, 6.4f)
            close()
        }
        line { moveTo(9.2f, 12.2f); lineTo(11.2f, 14.2f); lineTo(15f, 10.4f) }
    }

    val Trash: ImageVector = icon("Trash") {
        line { moveTo(5.4f, 7.4f); lineTo(18.6f, 7.4f) }
        line { moveTo(9.4f, 7.4f); lineTo(9.4f, 5.4f); lineTo(14.6f, 5.4f); lineTo(14.6f, 7.4f) }
        line { moveTo(7f, 7.4f); lineTo(7.8f, 19.4f); lineTo(16.2f, 19.4f); lineTo(17f, 7.4f) }
        line { moveTo(10.6f, 10.6f); lineTo(10.6f, 16.2f) }
        line { moveTo(13.4f, 10.6f); lineTo(13.4f, 16.2f) }
    }

    val Help: ImageVector = icon("Help") {
        circle(12f, 12f, 8f, filled = false)
        line { moveTo(9.6f, 9.8f); curveTo(9.6f, 8.2f, 10.8f, 7.4f, 12.2f, 7.4f); curveTo(13.8f, 7.4f, 14.8f, 8.4f, 14.8f, 9.8f); curveTo(14.8f, 11.8f, 12f, 11.8f, 12f, 14f) }
        circle(12f, 17f, 1.1f)
    }

    val Exit: ImageVector = icon("Exit") {
        line { moveTo(14f, 5.4f); lineTo(6.4f, 5.4f); lineTo(6.4f, 18.6f); lineTo(14f, 18.6f) }
        line { moveTo(11.6f, 12f); lineTo(20f, 12f) }
        line { moveTo(16.8f, 8.6f); lineTo(20.2f, 12f); lineTo(16.8f, 15.4f) }
    }

    val ChevronRight: ImageVector = icon("ChevronRight") {
        line(2f) { moveTo(10f, 6.4f); lineTo(15.6f, 12f); lineTo(10f, 17.6f) }
    }

    val ChevronDown: ImageVector = icon("ChevronDown") {
        line(2f) { moveTo(6.4f, 10f); lineTo(12f, 15.6f); lineTo(17.6f, 10f) }
    }

    val Back: ImageVector = icon("Back") {
        line(2f) { moveTo(14.4f, 6.4f); lineTo(8.8f, 12f); lineTo(14.4f, 17.6f) }
    }

    // ---- compose sheet ------------------------------------------------------

    val Editor: ImageVector = icon("Editor") {
        line { moveTo(3.6f, 7.4f); lineTo(20.4f, 7.4f); lineTo(20.4f, 16.6f); lineTo(3.6f, 16.6f); close() }
        line { moveTo(8.2f, 7.4f); lineTo(8.2f, 16.6f) }
        line { moveTo(15.8f, 7.4f); lineTo(15.8f, 16.6f) }
        line { moveTo(12f, 4.4f); lineTo(12f, 19.6f) }
    }

    val Post: ImageVector = icon("Post") {
        line { moveTo(3.6f, 5.6f); lineTo(20.4f, 5.6f); lineTo(20.4f, 18.4f); lineTo(3.6f, 18.4f); close() }
        line { moveTo(6.6f, 8.8f); lineTo(11.4f, 8.8f); lineTo(11.4f, 13.2f); lineTo(6.6f, 13.2f); close() }
        line { moveTo(14f, 9f); lineTo(17.6f, 9f) }
        line { moveTo(14f, 12f); lineTo(17.6f, 12f) }
        line { moveTo(6.6f, 15.6f); lineTo(17.6f, 15.6f) }
    }

    val Camera: ImageVector = icon("Camera") {
        line {
            moveTo(3.6f, 8.6f)
            lineTo(7.4f, 8.6f)
            lineTo(9f, 6.2f)
            lineTo(15f, 6.2f)
            lineTo(16.6f, 8.6f)
            lineTo(20.4f, 8.6f)
            lineTo(20.4f, 18.4f)
            lineTo(3.6f, 18.4f)
            close()
        }
        circle(12f, 13.2f, 3.4f, filled = false)
    }

    val Avatar: ImageVector = icon("Avatar") {
        circle(12f, 8.6f, 4f, filled = false)
        line { moveTo(4.6f, 20.4f); curveTo(4.6f, 16.2f, 8f, 14.2f, 12f, 14.2f); curveTo(16f, 14.2f, 19.4f, 16.2f, 19.4f, 20.4f) }
    }

    val Cube: ImageVector = icon("Cube") {
        line { moveTo(12f, 3.6f); lineTo(20.4f, 8f); lineTo(20.4f, 16f); lineTo(12f, 20.4f); lineTo(3.6f, 16f); lineTo(3.6f, 8f); close() }
        line { moveTo(3.6f, 8f); lineTo(12f, 12.4f); lineTo(20.4f, 8f) }
        line { moveTo(12f, 12.4f); lineTo(12f, 20.4f) }
    }

    val Image: ImageVector = icon("Image") {
        line { moveTo(3.6f, 5.6f); lineTo(20.4f, 5.6f); lineTo(20.4f, 18.4f); lineTo(3.6f, 18.4f); close() }
        circle(8.6f, 10f, 1.6f, filled = false)
        line { moveTo(4.6f, 16.4f); lineTo(10f, 11.8f); lineTo(14f, 15.2f); lineTo(16.6f, 12.8f); lineTo(19.6f, 15.6f) }
    }

    val Wifi: ImageVector = icon("Wifi") {
        line { moveTo(3.2f, 9.2f); curveTo(8.2f, 4.8f, 15.8f, 4.8f, 20.8f, 9.2f) }
        line { moveTo(6.4f, 12.8f); curveTo(9.6f, 10f, 14.4f, 10f, 17.6f, 12.8f) }
        line { moveTo(9.4f, 16.2f); curveTo(10.9f, 14.8f, 13.1f, 14.8f, 14.6f, 16.2f) }
        circle(12f, 19.2f, 1.2f)
    }

    val Level: ImageVector = icon("Level") {
        line {
            moveTo(12f, 3.6f)
            lineTo(14.6f, 9.1f)
            lineTo(20.4f, 9.9f)
            lineTo(16.2f, 14f)
            lineTo(17.2f, 19.9f)
            lineTo(12f, 17.1f)
            lineTo(6.8f, 19.9f)
            lineTo(7.8f, 14f)
            lineTo(3.6f, 9.9f)
            lineTo(9.4f, 9.1f)
            close()
        }
    }

    val Check: ImageVector = icon("Check") {
        line(2.2f) { moveTo(5.4f, 12.6f); lineTo(10f, 17.2f); lineTo(18.6f, 7.2f) }
    }

    val Mail: ImageVector = icon("Mail") {
        line { moveTo(3.6f, 6.2f); lineTo(20.4f, 6.2f); lineTo(20.4f, 17.8f); lineTo(3.6f, 17.8f); close() }
        line { moveTo(3.6f, 7.2f); lineTo(12f, 13.2f); lineTo(20.4f, 7.2f) }
    }

    // ---- live room ----------------------------------------------------------

    val Mic: ImageVector = icon("Mic") {
        line { moveTo(12f, 3.6f); curveTo(13.6f, 3.6f, 14.8f, 4.8f, 14.8f, 6.4f); lineTo(14.8f, 11.6f); curveTo(14.8f, 13.2f, 13.6f, 14.4f, 12f, 14.4f); curveTo(10.4f, 14.4f, 9.2f, 13.2f, 9.2f, 11.6f); lineTo(9.2f, 6.4f); curveTo(9.2f, 4.8f, 10.4f, 3.6f, 12f, 3.6f); close() }
        line { moveTo(6f, 11.2f); curveTo(6f, 14.8f, 8.6f, 17.4f, 12f, 17.4f); curveTo(15.4f, 17.4f, 18f, 14.8f, 18f, 11.2f) }
        line { moveTo(12f, 17.4f); lineTo(12f, 20.4f) }
    }

    val MicOff: ImageVector = icon("MicOff") {
        line { moveTo(9.2f, 7.2f); lineTo(9.2f, 6.4f); curveTo(9.2f, 4.8f, 10.4f, 3.6f, 12f, 3.6f); curveTo(13.6f, 3.6f, 14.8f, 4.8f, 14.8f, 6.4f); lineTo(14.8f, 11.6f) }
        line { moveTo(6f, 11.2f); curveTo(6f, 14.8f, 8.6f, 17.4f, 12f, 17.4f); curveTo(13f, 17.4f, 13.9f, 17.2f, 14.7f, 16.8f) }
        line { moveTo(12f, 17.4f); lineTo(12f, 20.4f) }
        line(2f) { moveTo(4.4f, 4.4f); lineTo(19.6f, 19.6f) }
    }

    val Screen: ImageVector = icon("Screen") {
        line { moveTo(3.6f, 5.6f); lineTo(20.4f, 5.6f); lineTo(20.4f, 16.2f); lineTo(3.6f, 16.2f); close() }
        line { moveTo(8.4f, 19.4f); lineTo(15.6f, 19.4f) }
        line { moveTo(12f, 8.2f); lineTo(12f, 13.4f) }
        line { moveTo(9.4f, 10.8f); lineTo(12f, 8.2f); lineTo(14.6f, 10.8f) }
    }

    val Send: ImageVector = icon("Send") {
        line { moveTo(4f, 12f); lineTo(20.4f, 4.6f); lineTo(14.4f, 20.4f); lineTo(11.4f, 13.4f); close() }
        line { moveTo(11.4f, 13.4f); lineTo(4f, 12f) }
    }

    val Lock: ImageVector = icon("Lock") {
        line { moveTo(5.8f, 10.6f); lineTo(18.2f, 10.6f); lineTo(18.2f, 19.4f); lineTo(5.8f, 19.4f); close() }
        line { moveTo(8.6f, 10.6f); lineTo(8.6f, 7.8f); curveTo(8.6f, 5.9f, 10.1f, 4.4f, 12f, 4.4f); curveTo(13.9f, 4.4f, 15.4f, 5.9f, 15.4f, 7.8f); lineTo(15.4f, 10.6f) }
        circle(12f, 15f, 1.3f)
    }

    val Key: ImageVector = icon("Key") {
        circle(8f, 12f, 3.6f, filled = false)
        line { moveTo(11.6f, 12f); lineTo(20.4f, 12f) }
        line { moveTo(17.4f, 12f); lineTo(17.4f, 15.2f) }
        line { moveTo(20f, 12f); lineTo(20f, 14.4f) }
    }

    val Live: ImageVector = icon("Live") {
        circle(12f, 12f, 3.2f)
        line { moveTo(7.4f, 7.4f); arcToRelative(6.5f, 6.5f, 0f, false, false, 0f, 9.2f) }
        line { moveTo(16.6f, 16.6f); arcToRelative(6.5f, 6.5f, 0f, false, false, 0f, -9.2f) }
    }
}
