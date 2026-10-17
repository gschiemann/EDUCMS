package com.educms.player.media

import android.os.Build
import android.view.Surface
import androidx.annotation.RequiresApi

/**
 * Experiment 2 (plan 2026-10-17 §4E): ask the display for the clip's frame
 * rate, SEAMLESSLY OR NOT AT ALL. `Surface.setFrameRate` is API 30; the
 * three-argument form with an explicit strategy is API 31. On API 30 the
 * two-argument form is `CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS` by definition.
 * A display that would need a mode switch (a black flash) keeps its mode.
 *
 * Symbol-isolated like [com.educms.player.ota.Api31SilentInstall]: the
 * Android 7–10 ART verifier never resolves these methods.
 */
@RequiresApi(Build.VERSION_CODES.R)
internal object Api30SurfaceFrameRate {
    const val ONLY_IF_SEAMLESS = "only-if-seamless"
    const val REFUSED = "refused"

    /** Never throws; returns the strategy word that was requested, or [REFUSED]. */
    fun request(surface: Surface, fps: Float): String = try {
        if (!surface.isValid || !fps.isFinite() || fps <= 0f) {
            REFUSED
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            surface.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS)
            ONLY_IF_SEAMLESS
        } else {
            surface.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
            ONLY_IF_SEAMLESS
        }
    } catch (_: Exception) {
        REFUSED
    }
}
