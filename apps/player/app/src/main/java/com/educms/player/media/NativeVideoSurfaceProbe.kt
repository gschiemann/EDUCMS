package com.educms.player.media

import android.graphics.Bitmap
import android.os.Handler
import android.view.PixelCopy
import android.view.SurfaceView

/** Samples the decoder's surface buffer, never the final composed screen. Diagnostics only. */
internal object NativeVideoSurfaceProbe {
    data class Sample(val pixels: Int, val bright: Int, val dark: Int)
    data class Band(val red: Int, val green: Int, val blue: Int, val alphaMin: Int)

    /** Spatial buffer evidence; never a diagnosis of the final physical panel. */
    fun bands(pixels: IntArray, width: Int, height: Int): List<Band> {
        require(width > 0 && height >= 3 && pixels.size == width * height)
        return (0..2).map { band ->
            val start = (height * band / 3) * width
            val end = (height * (band + 1) / 3) * width
            var red = 0L; var green = 0L; var blue = 0L; var alphaMin = 255
            for (i in start until end) {
                val c = pixels[i]
                red += c ushr 16 and 255; green += c ushr 8 and 255; blue += c and 255
                alphaMin = minOf(alphaMin, c ushr 24 and 255)
            }
            val count = end - start
            Band((red / count).toInt(), (green / count).toInt(), (blue / count).toInt(), alphaMin)
        }
    }

    fun sample(pixels: IntArray): Sample = Sample(pixels.size,
        pixels.count { c -> (c ushr 16 and 255) >= 247 && (c ushr 8 and 255) >= 247 && (c and 255) >= 247 },
        pixels.count { c -> (c ushr 16 and 255) <= 8 && (c ushr 8 and 255) <= 8 && (c and 255) <= 8 })

    fun capture(surface: SurfaceView, handler: Handler, current: () -> Boolean, report: (String) -> Unit) {
        if (!current()) return
        val bitmap = Bitmap.createBitmap(18, 32, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(surface, bitmap, { result ->
                try {
                    if (current()) {
                        if (result == PixelCopy.SUCCESS) {
                            val pixels = IntArray(bitmap.width * bitmap.height)
                            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                            val s = sample(pixels)
                            val spatial = bands(pixels, bitmap.width, bitmap.height)
                                .mapIndexed { i, b -> "${listOf("top", "middle", "bottom")[i]}=${b.red}/${b.green}/${b.blue}/${b.alphaMin}" }
                                .joinToString(" ")
                            report("copy=$result pixels=${s.pixels} bright=${s.bright} dark=${s.dark} rgbAlphaMin $spatial")
                        } else report("copy=$result")
                    }
                } finally { bitmap.recycle() }
            }, handler)
        } catch (_: Exception) {
            bitmap.recycle()
            if (current()) report("copy=unavailable")
        }
    }
}
