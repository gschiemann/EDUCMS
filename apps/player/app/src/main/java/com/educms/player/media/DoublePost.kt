package com.educms.player.media

import android.os.Build
import android.view.Surface
import androidx.annotation.RequiresApi
import kotlin.math.abs

/**
 * 1.1.49 experiment `doublePost` (dark, `double-post:<uuid|all>`): the M43
 * judder. The panel reports a 30 Hz mode (`Display.getMode()` 3840x2160@30)
 * while SurfaceFlinger composes at 60 Hz (the Choreographer grid measures
 * 16.67 ms). Our 30 fps frames sit on one phase of that 60 Hz grid (1.1.47
 * parity lock), but a panel that scans at 30 Hz from a 60 Hz composition
 * samples one of every two composed frames on a phase not tied to ours — so
 * some source frames can be seen twice and their neighbours not at all.
 *
 * A MediaCodec output buffer can be released only once, so "post every
 * frame on two consecutive vsyncs" is done the cheap way: the video surface
 * asks for the clip's rate with `CHANGE_FRAME_RATE_ALWAYS` (API 31+), so
 * SurfaceFlinger composes at 30 Hz — matching the panel's own 30 Hz scan —
 * and every source frame is on the glass for exactly one panel period
 * whichever 60 Hz phase it would have sampled. (A GL blit renderer that
 * re-presents each frame every vsync was the alternative; it is far bigger
 * and is kept for a later build only if this cannot work.)
 *
 * Applied only when the token is on, the API level allows it, no emergency
 * hold is in force, and the measured grid is ≈ 2 × the source rate (60 / 30
 * applies; 60 / 60 is a no-op). The vote lives on the session's own surface,
 * so it disappears with that surface — and an emergency hold removes the
 * surface first, as always.
 */
internal object DoublePost {
    const val APPLY = "apply"
    const val OFF = "off"
    const val SDK = "sdk-below-31"
    const val HELD = "emergency-held"
    const val NO_RATE = "no-rate"
    const val NOT_DOUBLE = "grid-not-2x-fps"
    /** What [Api31DoublePost.request] answers. */
    const val ALWAYS = "fixed-source-always"
    const val REFUSED = "refused"

    /** Relative tolerance on "grid ≈ 2 × fps" (60 vs 59.94, 29.97 …). */
    const val TOLERANCE = 0.04

    /** Pure: what this session does. [APPLY] or the reason it does not. */
    fun decide(enabled: Boolean, sdk: Int, held: Boolean, gridHz: Double, fps: Double): String = when {
        !enabled -> OFF
        sdk < Build.VERSION_CODES.S -> SDK
        held -> HELD
        !(gridHz.isFinite() && gridHz > 0.0 && fps.isFinite() && fps > 0.0) -> NO_RATE
        abs(gridHz - 2.0 * fps) > TOLERANCE * 2.0 * fps -> NOT_DOUBLE
        else -> APPLY
    }

    /** The composition grid in Hz: the measured Choreographer period when it is trusted, else the display's nominal rate. */
    fun gridHz(grid: VsyncGrid?, nominalHz: Float): Double =
        if (grid != null && grid.ready && grid.periodNs > 0L) 1_000_000_000.0 / grid.periodNs else nominalHz.toDouble()
}

/** Symbol-isolated like [Api30SurfaceFrameRate]: the older ART verifier never resolves these methods. */
@RequiresApi(Build.VERSION_CODES.S)
internal object Api31DoublePost {
    /** Never throws; returns [DoublePost.ALWAYS] when the vote was cast, or [DoublePost.REFUSED]. */
    fun request(surface: Surface, fps: Float): String = try {
        if (!surface.isValid || !fps.isFinite() || fps <= 0f) DoublePost.REFUSED
        else {
            surface.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ALWAYS)
            DoublePost.ALWAYS
        }
    } catch (_: Exception) {
        DoublePost.REFUSED
    }
}
