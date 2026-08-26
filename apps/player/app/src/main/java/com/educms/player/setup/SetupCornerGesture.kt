package com.educms.player.setup

import android.view.MotionEvent
import kotlin.math.abs

/**
 * SetupCornerGesture — the CABLE-FREE way back into the setup checklist.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Operator, installing the first panel on v1.1.5: *"it popped up with the
 * config page but after you do the first 4 requirements it just launched so
 * i didnt get to even do the optional ones at all and **have no way to know
 * how to pull those up again**"*.
 *
 * `SetupCeremony.open()` already existed. Its only trigger was
 * `adb shell am start … -a com.educms.player.OPEN_SETUP`, which is worth
 * nothing to somebody standing at a wall-mounted panel with no laptop, no
 * USB cable and no way to reach the back of the screen.
 *
 * The PRIMARY fix is the dashboard route — an operator taps "Open setup on
 * this panel", walks to the screen, and the checklist is already up (see
 * `OPEN_SETUP` in packages/api-types/src/display-control.ts). This is the
 * BACKUP for the panel whose network is not up yet, which is exactly the
 * panel most likely to still need its grants.
 *
 * ── THE GESTURE ───────────────────────────────────────────────────────
 *
 * Press and hold the TOP-LEFT corner of the glass — inside a [CORNER_DP]
 * square — for [HOLD_MS], without moving more than [SLOP_DP] and without a
 * second finger touching down.
 *
 * ── WHY IT IS NOT FOUND BY ACCIDENT ───────────────────────────────────
 *
 * These are PUBLIC wall panels, several of them interactive, so "a passer-by
 * discovers it" is the design constraint, not a footnote. Four properties,
 * and it needs all four at once:
 *
 *  1. **Target.** A 64dp square in one extreme corner — roughly a
 *     fingertip's worth of a 55" panel, in the region content deliberately
 *     keeps clear because it is the bezel edge.
 *  2. **Duration.** Six seconds is far outside human interaction range. A
 *     tap is ~100 ms; a deliberate long-press is ~500 ms; an idle lean is
 *     not stationary. Nothing a curious person does to a screen holds one
 *     spot for six seconds.
 *  3. **Stillness.** More than 24dp of travel cancels it, so a swipe, a
 *     drag, a scroll or a wandering finger never reaches the end.
 *  4. **One finger.** A second pointer cancels it, so a two-handed lean or
 *     a pinch on a touch board cannot arrive there by accident.
 *
 * And the blast radius if somebody DOES find it is deliberately near-zero:
 * the checklist opens Android's own permission pages, every one of which
 * needs its own explicit approval on a system dialog; it refuses to appear
 * over an emergency hold or inside a locked task (`SetupCeremony.render`);
 * "Not now" / Back closes it; and it stands itself down after the existing
 * 10-minute idle timer. This is nuisance resistance, NOT a security
 * control, and it must never be described as one — anybody physically at
 * the panel can already reach the OEM Settings app the checklist links to.
 *
 * ── WHY IT CANNOT INTERFERE WITH TOUCH CONTENT ────────────────────────
 *
 * This object DECIDES; it never consumes. `MainActivity.dispatchTouchEvent`
 * feeds it a copy of each event and then hands the event to `super`
 * unchanged, so every touch reaches the WebView exactly as it does today.
 * An interactive board sees byte-identical input whether or not the gesture
 * is running.
 *
 * ── SHAPE ─────────────────────────────────────────────────────────────
 *
 * Pure decision logic over plain numbers — no Context, no View, no Handler
 * — for the same reason `SetupCeremonyMath` and `DisplayScheduleMath` are:
 * the rule that decides whether a public screen opens a setup panel is worth
 * a test that does not need an emulator. The TIMER lives in MainActivity,
 * because Android delivers no events while a finger is stationary and
 * "still down 6 seconds later" is therefore not something a touch stream
 * can tell you by itself.
 */
class SetupCornerGesture(
    /** Side of the hot square, in PIXELS (see [cornerPxFor]). */
    private val cornerPx: Float,
    /** Travel that cancels the hold, in PIXELS (see [slopPxFor]). */
    private val slopPx: Float,
) {

    companion object {
        /**
         * How long the corner must be held.
         *
         * ⚠️ Keep in lockstep with `SetupCeremonyMath.REENTRY_LINE`, which
         * tells the operator "6 seconds" in as many words. Copy that names a
         * duration the code does not honour is worse than no copy.
         */
        const val HOLD_MS = 6_000L

        /** Side of the hot square, in dp. */
        const val CORNER_DP = 64

        /** Travel, in dp, that cancels an armed hold. */
        const val SLOP_DP = 24

        fun cornerPxFor(density: Float): Float = CORNER_DP * density
        fun slopPxFor(density: Float): Float = SLOP_DP * density
    }

    /** What the caller should do with its hold timer. */
    enum class Decision {
        /** Nothing changed. */
        NONE,

        /** A qualifying press started — start the [HOLD_MS] timer. */
        ARM,

        /** The press no longer qualifies — cancel the timer. */
        DISARM,
    }

    private var armed = false
    private var downX = 0f
    private var downY = 0f

    /** Is a qualifying hold currently in progress? */
    val isArmed: Boolean get() = armed

    /**
     * Feed one touch event.
     *
     * @param action  `MotionEvent.getActionMasked()`.
     * @param x       window-relative X of the active pointer.
     * @param y       window-relative Y of the active pointer.
     * @param pointerCount `MotionEvent.getPointerCount()`.
     */
    fun onTouch(action: Int, x: Float, y: Float, pointerCount: Int = 1): Decision =
        when (action) {
            MotionEvent.ACTION_DOWN -> {
                val inCorner = pointerCount <= 1 && x >= 0f && y >= 0f &&
                    x <= cornerPx && y <= cornerPx
                if (inCorner) {
                    armed = true
                    downX = x
                    downY = y
                    Decision.ARM
                } else {
                    disarm()
                }
            }

            MotionEvent.ACTION_MOVE ->
                if (armed && (abs(x - downX) > slopPx || abs(y - downY) > slopPx)) {
                    disarm()
                } else {
                    Decision.NONE
                }

            // A second finger is a content interaction (a pinch, a two-handed
            // lean on a touch board), never this gesture.
            MotionEvent.ACTION_POINTER_DOWN -> disarm()

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> disarm()

            else -> Decision.NONE
        }

    /**
     * Drop any armed hold — used when the checklist is already open, so a
     * finger still resting on the corner cannot re-fire it.
     */
    fun reset(): Decision = disarm()

    private fun disarm(): Decision {
        if (!armed) return Decision.NONE
        armed = false
        return Decision.DISARM
    }
}
