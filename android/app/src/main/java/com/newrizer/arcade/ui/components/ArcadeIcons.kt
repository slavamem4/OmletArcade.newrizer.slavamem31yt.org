package com.newrizer.arcade.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Hand-built icon set. Nothing here comes from a third-party pack and no
 * emoji is used anywhere in the product: every glyph is a vector path drawn
 * on the same 24 unit grid with the same 2 unit stroke rhythm.
 */
object ArcadeIcons {

    private fun icon(name: String, pathData: ImageVectorScope.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply { ImageVectorScope(this).pathData() }.build()

    class ImageVectorScope(private val builder: ImageVector.Builder) {
        fun shape(data: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) {
            builder.path(fill = SolidColor(Color.White), pathBuilder = data)
        }
    }

    /** Shell-and-yolk home mark. */
    val Home: ImageVector = icon("Home") {
        shape {
            moveTo(12f, 2.6f)
            curveTo(16f, 2.6f, 19.4f, 7.6f, 19.4f, 13f)
            curveTo(19.4f, 17.6f, 16.1f, 21.4f, 12f, 21.4f)
            curveTo(7.9f, 21.4f, 4.6f, 17.6f, 4.6f, 13f)
            curveTo(4.6f, 7.6f, 8f, 2.6f, 12f, 2.6f)
            close()
        }
    }

    /** Stacked cube for the Minecraft hosting tab. */
    val Cube: ImageVector = icon("Cube") {
        shape {
            moveTo(12f, 2.2f)
            lineTo(21f, 7.1f)
            lineTo(21f, 16.9f)
            lineTo(12f, 21.8f)
            lineTo(3f, 16.9f)
            lineTo(3f, 7.1f)
            close()
            moveTo(12f, 4.9f)
            lineTo(5.6f, 8.4f)
            lineTo(12f, 11.9f)
            lineTo(18.4f, 8.4f)
            close()
        }
    }

    /** Voice rooms: three vertical levels. */
    val Waves: ImageVector = icon("Waves") {
        shape {
            moveTo(4f, 10f)
            lineTo(6.4f, 10f)
            lineTo(6.4f, 14f)
            lineTo(4f, 14f)
            close()
            moveTo(10.8f, 5.5f)
            lineTo(13.2f, 5.5f)
            lineTo(13.2f, 18.5f)
            lineTo(10.8f, 18.5f)
            close()
            moveTo(17.6f, 8.2f)
            lineTo(20f, 8.2f)
            lineTo(20f, 15.8f)
            lineTo(17.6f, 15.8f)
            close()
        }
    }

    val Profile: ImageVector = icon("Profile") {
        shape {
            moveTo(12f, 3.4f)
            curveTo(14.3f, 3.4f, 16.1f, 5.2f, 16.1f, 7.5f)
            curveTo(16.1f, 9.8f, 14.3f, 11.6f, 12f, 11.6f)
            curveTo(9.7f, 11.6f, 7.9f, 9.8f, 7.9f, 7.5f)
            curveTo(7.9f, 5.2f, 9.7f, 3.4f, 12f, 3.4f)
            close()
            moveTo(12f, 13.4f)
            curveTo(16.1f, 13.4f, 19.4f, 16f, 19.4f, 19.2f)
            lineTo(19.4f, 20.6f)
            lineTo(4.6f, 20.6f)
            lineTo(4.6f, 19.2f)
            curveTo(4.6f, 16f, 7.9f, 13.4f, 12f, 13.4f)
            close()
        }
    }

    val Mic: ImageVector = icon("Mic") {
        shape {
            moveTo(12f, 2.6f)
            curveTo(13.7f, 2.6f, 15f, 3.9f, 15f, 5.6f)
            lineTo(15f, 11.4f)
            curveTo(15f, 13.1f, 13.7f, 14.4f, 12f, 14.4f)
            curveTo(10.3f, 14.4f, 9f, 13.1f, 9f, 11.4f)
            lineTo(9f, 5.6f)
            curveTo(9f, 3.9f, 10.3f, 2.6f, 12f, 2.6f)
            close()
            moveTo(5.4f, 11f)
            lineTo(7.2f, 11f)
            curveTo(7.2f, 13.9f, 9.3f, 16f, 12f, 16f)
            curveTo(14.7f, 16f, 16.8f, 13.9f, 16.8f, 11f)
            lineTo(18.6f, 11f)
            curveTo(18.6f, 14.5f, 16.1f, 17.3f, 12.9f, 17.7f)
            lineTo(12.9f, 21.4f)
            lineTo(11.1f, 21.4f)
            lineTo(11.1f, 17.7f)
            curveTo(7.9f, 17.3f, 5.4f, 14.5f, 5.4f, 11f)
            close()
        }
    }

    val MicOff: ImageVector = icon("MicOff") {
        shape {
            moveTo(4.6f, 3.3f)
            lineTo(20.7f, 19.4f)
            lineTo(19.4f, 20.7f)
            lineTo(3.3f, 4.6f)
            close()
            moveTo(12f, 2.6f)
            curveTo(13.7f, 2.6f, 15f, 3.9f, 15f, 5.6f)
            lineTo(15f, 11.4f)
            curveTo(15f, 11.8f, 14.9f, 12.2f, 14.8f, 12.5f)
            lineTo(9.2f, 6.9f)
            lineTo(9f, 6.9f)
            lineTo(9f, 5.6f)
            curveTo(9f, 3.9f, 10.3f, 2.6f, 12f, 2.6f)
            close()
            moveTo(5.4f, 11f)
            lineTo(7.2f, 11f)
            curveTo(7.2f, 13.9f, 9.3f, 16f, 12f, 16f)
            curveTo(12.6f, 16f, 13.1f, 15.9f, 13.6f, 15.7f)
            lineTo(15f, 17.1f)
            curveTo(14.4f, 17.4f, 13.7f, 17.6f, 12.9f, 17.7f)
            lineTo(12.9f, 21.4f)
            lineTo(11.1f, 21.4f)
            lineTo(11.1f, 17.7f)
            curveTo(7.9f, 17.3f, 5.4f, 14.5f, 5.4f, 11f)
            close()
        }
    }

    /** Solid dot inside a ring: the live marker. */
    val Live: ImageVector = icon("Live") {
        shape {
            moveTo(12f, 7.6f)
            curveTo(14.4f, 7.6f, 16.4f, 9.6f, 16.4f, 12f)
            curveTo(16.4f, 14.4f, 14.4f, 16.4f, 12f, 16.4f)
            curveTo(9.6f, 16.4f, 7.6f, 14.4f, 7.6f, 12f)
            curveTo(7.6f, 9.6f, 9.6f, 7.6f, 12f, 7.6f)
            close()
            moveTo(12f, 2.6f)
            curveTo(17.2f, 2.6f, 21.4f, 6.8f, 21.4f, 12f)
            curveTo(21.4f, 14.6f, 20.4f, 17f, 18.6f, 18.7f)
            lineTo(17.3f, 17.4f)
            curveTo(18.8f, 16f, 19.6f, 14.1f, 19.6f, 12f)
            curveTo(19.6f, 7.8f, 16.2f, 4.4f, 12f, 4.4f)
            curveTo(7.8f, 4.4f, 4.4f, 7.8f, 4.4f, 12f)
            curveTo(4.4f, 14.1f, 5.2f, 16f, 6.7f, 17.4f)
            lineTo(5.4f, 18.7f)
            curveTo(3.6f, 17f, 2.6f, 14.6f, 2.6f, 12f)
            curveTo(2.6f, 6.8f, 6.8f, 2.6f, 12f, 2.6f)
            close()
        }
    }

    /** Closed padlock: end-to-end encryption indicator. */
    val Lock: ImageVector = icon("Lock") {
        shape {
            moveTo(12f, 2.4f)
            curveTo(14.9f, 2.4f, 17.2f, 4.7f, 17.2f, 7.6f)
            lineTo(17.2f, 9.6f)
            lineTo(19f, 9.6f)
            lineTo(19f, 21f)
            lineTo(5f, 21f)
            lineTo(5f, 9.6f)
            lineTo(6.8f, 9.6f)
            lineTo(6.8f, 7.6f)
            curveTo(6.8f, 4.7f, 9.1f, 2.4f, 12f, 2.4f)
            close()
            moveTo(12f, 4.2f)
            curveTo(10.1f, 4.2f, 8.6f, 5.7f, 8.6f, 7.6f)
            lineTo(8.6f, 9.6f)
            lineTo(15.4f, 9.6f)
            lineTo(15.4f, 7.6f)
            curveTo(15.4f, 5.7f, 13.9f, 4.2f, 12f, 4.2f)
            close()
        }
    }

    val Plus: ImageVector = icon("Plus") {
        shape {
            moveTo(11f, 4f)
            lineTo(13f, 4f)
            lineTo(13f, 11f)
            lineTo(20f, 11f)
            lineTo(20f, 13f)
            lineTo(13f, 13f)
            lineTo(13f, 20f)
            lineTo(11f, 20f)
            lineTo(11f, 13f)
            lineTo(4f, 13f)
            lineTo(4f, 11f)
            lineTo(11f, 11f)
            close()
        }
    }

    val Back: ImageVector = icon("Back") {
        shape {
            moveTo(13.6f, 4.4f)
            lineTo(15f, 5.8f)
            lineTo(8.8f, 12f)
            lineTo(15f, 18.2f)
            lineTo(13.6f, 19.6f)
            lineTo(6f, 12f)
            close()
        }
    }

    val Send: ImageVector = icon("Send") {
        shape {
            moveTo(3.2f, 20.4f)
            lineTo(21.4f, 12f)
            lineTo(3.2f, 3.6f)
            lineTo(3.2f, 10.2f)
            lineTo(15f, 12f)
            lineTo(3.2f, 13.8f)
            close()
        }
    }

    /** Phone screen with a share arrow: screen broadcast. */
    val Screen: ImageVector = icon("Screen") {
        shape {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 16.4f)
            lineTo(3f, 16.4f)
            close()
            moveTo(4.8f, 5.8f)
            lineTo(4.8f, 14.6f)
            lineTo(19.2f, 14.6f)
            lineTo(19.2f, 5.8f)
            close()
            moveTo(8f, 18.4f)
            lineTo(16f, 18.4f)
            lineTo(16f, 20.2f)
            lineTo(8f, 20.2f)
            close()
        }
    }

    val Exit: ImageVector = icon("Exit") {
        shape {
            moveTo(4f, 3.4f)
            lineTo(13f, 3.4f)
            lineTo(13f, 5.2f)
            lineTo(5.8f, 5.2f)
            lineTo(5.8f, 18.8f)
            lineTo(13f, 18.8f)
            lineTo(13f, 20.6f)
            lineTo(4f, 20.6f)
            close()
            moveTo(16.2f, 7.2f)
            lineTo(21f, 12f)
            lineTo(16.2f, 16.8f)
            lineTo(14.9f, 15.5f)
            lineTo(17.4f, 12.9f)
            lineTo(9.4f, 12.9f)
            lineTo(9.4f, 11.1f)
            lineTo(17.4f, 11.1f)
            lineTo(14.9f, 8.5f)
            close()
        }
    }

    val Key: ImageVector = icon("Key") {
        shape {
            moveTo(15.4f, 3f)
            curveTo(18.5f, 3f, 21f, 5.5f, 21f, 8.6f)
            curveTo(21f, 11.7f, 18.5f, 14.2f, 15.4f, 14.2f)
            curveTo(14.8f, 14.2f, 14.2f, 14.1f, 13.7f, 13.9f)
            lineTo(12f, 15.6f)
            lineTo(9.9f, 15.6f)
            lineTo(9.9f, 17.7f)
            lineTo(7.8f, 17.7f)
            lineTo(7.8f, 19.8f)
            lineTo(3f, 19.8f)
            lineTo(3f, 15.9f)
            lineTo(10.1f, 8.8f)
            curveTo(9.9f, 8.2f, 9.8f, 7.6f, 9.8f, 7f)
            curveTo(9.8f, 4.8f, 11.9f, 3f, 15.4f, 3f)
            close()
            moveTo(16.3f, 6f)
            curveTo(15.5f, 6f, 14.9f, 6.6f, 14.9f, 7.4f)
            curveTo(14.9f, 8.2f, 15.5f, 8.8f, 16.3f, 8.8f)
            curveTo(17.1f, 8.8f, 17.7f, 8.2f, 17.7f, 7.4f)
            curveTo(17.7f, 6.6f, 17.1f, 6f, 16.3f, 6f)
            close()
        }
    }
}
