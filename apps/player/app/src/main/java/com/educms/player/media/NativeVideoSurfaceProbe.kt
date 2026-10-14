package com.educms.player.media

import android.graphics.Bitmap
import android.os.Handler
import android.view.PixelCopy
import android.view.SurfaceView

/** Samples the decoder's surface buffer, never the final composed screen. Diagnostics only. */
internal object NativeVideoSurfaceProbe {
    data class Sample(val pixels: Int, val bright: Int, val dark: Int)

    fun sample(pixels: IntArray): Sample = Sample(pixels.size,
        pixels.count { c -> (c ushr 16 and 255) >= 247 && (c ushr 8 and 255) >= 247 && (c and 255) >= 247 },
        pixels.count { c -> (c ushr 16 and 255) <= 8 && (c ushr 8 and 255) <= 8 && (c and 255) <= 8 })

    fun capture(surface: SurfaceView, handler: Handler, current: () -> Boolean, report: (String) -> Unit) {
        if (!current()) return
        val bitmap = Bitmap.createBitmap(32, 18, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(surface, bitmap, { result ->
                try {
                    if (current()) {
                        if (result == PixelCopy.SUCCESS) {
                            val pixels = IntArray(bitmap.width * bitmap.height)
                            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                            val s = sample(pixels)
                            report("copy=$result pixels=${s.pixels} bright=${s.bright} dark=${s.dark}")
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
