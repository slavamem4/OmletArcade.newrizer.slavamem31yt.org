package com.newrizer.arcade.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Pictures live in the database as base64 JPEG.
 *
 * Cloud Storage is a paid add-on and the project does not use it, so every
 * image is downscaled and re-compressed here until it fits a budget that is
 * safe for Realtime Database and cheap to sync.
 */
object ImageCodec {

    /** Roughly 190 KB of binary once decoded. */
    const val MAX_BASE64 = 260_000

    private const val MAX_EDGE_POST = 1280
    private const val MAX_EDGE_AVATAR = 320

    fun encodePost(context: Context, uri: Uri): String? = encode(context, uri, MAX_EDGE_POST, MAX_BASE64)

    fun encodeAvatar(context: Context, uri: Uri): String? = encode(context, uri, MAX_EDGE_AVATAR, 60_000)

    private fun encode(context: Context, uri: Uri, maxEdge: Int, budget: Int): String? {
        val source = decodeScaled(context, uri, maxEdge) ?: return null
        try {
            var quality = 86
            while (quality >= 40) {
                val stream = ByteArrayOutputStream()
                source.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                val encoded = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                if (encoded.length <= budget) return encoded
                quality -= 12
            }
            return null
        } finally {
            source.recycle()
        }
    }

    private fun decodeScaled(context: Context, uri: Uri, maxEdge: Int): Bitmap? {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null

        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) return null

        var sample = 1
        while (longest / sample > maxEdge * 2) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: return null

        val edge = max(decoded.width, decoded.height)
        if (edge <= maxEdge) return decoded

        val ratio = maxEdge.toFloat() / edge
        val scaled = Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * ratio).toInt().coerceAtLeast(1),
            (decoded.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
        if (scaled != decoded) decoded.recycle()
        return scaled
    }
}
