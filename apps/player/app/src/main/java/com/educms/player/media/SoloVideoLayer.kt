package com.educms.player.media

/**
 * ONE COMPOSITING CONTRACT (player 1.1.41, plan 2026-10-17 §4A).
 *
 * Native solo video is ABOVE the window, or it is not native. Every white or
 * hazy screen in the field (DH43, Mobile A-Frame, SAR55, VisionCore .33, G43
 * .36) was a solo surface drawn UNDER a WebView forced transparent — every
 * one of those stop lines reads `layer=under_window`; no above-window session
 * has ever gone white. So "under the window" is no longer a mode here: a
 * session that cannot be composed above the window is refused with the
 * stable reason `composition-unavailable` (see [DeviceClassPolicy]) and the
 * page keeps the web engine. The WebView stays opaque black throughout.
 *
 * Two above-window mechanisms remain, chosen by Android version only:
 *  • [Mode.DYNAMIC_ABOVE] (SDK 30+): the surface prepares beneath the window
 *    and is re-ordered above it with `setZOrderOnTop(true)` after its first
 *    valid frame — Android R applies the layer change on a render frame.
 *  • [Mode.STATIC_ABOVE] (SDK 24–29, any hardware): legacy z-order is fixed
 *    when the SurfaceView's child window is created, so the surface starts
 *    above the window, PARKED entirely beyond the physical display, and is
 *    moved onto its rect only after `promote` — then confirmed by a render
 *    callback newer than the geometry pre-draw (.40's sequence, unchanged).
 *
 * A delayed render callback cannot give a retired session the window again.
 */
internal class SoloVideoLayer(val mode: Mode) {
    enum class Mode { DYNAMIC_ABOVE, STATIC_ABOVE }
    val staticAbove: Boolean get() = mode == Mode.STATIC_ABOVE
    /**
     * [Phase.UNDER_WINDOW] is the prepared-but-not-shown phase: beneath the
     * window on the dynamic path, parked beyond the display on the static one.
     * The wire name is kept so the dashboard's `layerMode` reads as before.
     */
    enum class Phase { UNDER_WINDOW, QUEUED, REVEALING, ABOVE_WINDOW, RETIRED }
    var phase = Phase.UNDER_WINDOW
        private set
    var revealRequestedNs = 0L
        private set
    var moveRequestedNs = 0L
        private set
    /** Static surfaces already sit above the window, but remain off display until promotion. */
    val parked: Boolean get() = staticAbove && phase != Phase.REVEALING && phase != Phase.ABOVE_WINDOW

    fun request(started: Boolean, validFrame: Boolean): Boolean {
        if (!started || !validFrame || phase != Phase.UNDER_WINDOW) return false
        phase = Phase.QUEUED
        return true
    }

    fun promote(live: Boolean, attached: Boolean, emergencyHeld: Boolean, uiClear: Boolean): Boolean {
        if (phase != Phase.QUEUED) return false
        if (!live || !attached || emergencyHeld || !uiClear) {
            phase = Phase.RETIRED
            return false
        }
        phase = Phase.REVEALING
        return true
    }

    /** Begin a separate deadline BEFORE waiting for a position-only layout to complete. */
    fun moveRequested(atNs: Long) {
        if (staticAbove && phase == Phase.REVEALING && moveRequestedNs == 0L && atNs > 0L) moveRequestedNs = atNs
    }

    /** For static output, arm only after observing the final geometry at pre-draw. */
    fun revealRequested(atNs: Long) {
        if (phase != Phase.REVEALING || revealRequestedNs != 0L || atNs <= 0L) return
        if (staticAbove && (moveRequestedNs == 0L || atNs < moveRequestedNs || revealTimedOut(atNs))) return
        revealRequestedNs = atNs
    }

    /** Batched callbacks for frames rendered before the request cannot complete takeover. */
    fun confirm(stamp: Long, live: Boolean, attached: Boolean, emergencyHeld: Boolean, uiClear: Boolean): Boolean {
        if (phase != Phase.REVEALING) return false
        if (!live || !attached || emergencyHeld || !uiClear) {
            phase = Phase.RETIRED
            return false
        }
        if (revealRequestedNs == 0L || stamp <= revealRequestedNs || revealTimedOut(stamp)) return false
        phase = Phase.ABOVE_WINDOW
        return true
    }

    // Decoder callbacks cannot extend either the geometry wait or the reveal deadline.
    fun revealTimedOut(nowNs: Long): Boolean {
        val start = if (moveRequestedNs > 0L) moveRequestedNs else revealRequestedNs
        return phase == Phase.REVEALING && start > 0L && nowNs - start >= REVEAL_TIMEOUT_NS
    }

    fun retire() { phase = Phase.RETIRED }

    fun soloRect(parentW: Int, parentH: Int, parkLeft: Int): IntArray =
        intArrayOf(if (parked) maxOf(parentW, parkLeft) else 0, 0, parentW, parentH)

    companion object {
        const val REVEAL_TIMEOUT_NS = 3_500_000_000L
        /** The stable end code of a session this box cannot compose above the window. */
        const val REASON_COMPOSITION_UNAVAILABLE = "composition-unavailable"
        /** The stable end code of a positioned-slot (protocol 3) request while that engine is off. */
        const val REASON_PROTOCOL3_DISABLED = "protocol3-disabled"

        /**
         * How a solo (protocol 2) session on [face] is composed on an Android
         * [sdk] box, or null when it may not be native at all: dynamic
         * re-ordering on R+, the static parked start on 24–29 — on ANY
         * hardware (the .40 rule limited the static path to Rockchip and
         * left every other legacy box under the window). Protocol 3 and a
         * face this box does not host are never native here.
         */
        fun mode(protocol: Int, face: Int, sdk: Int): Mode? = when {
            protocol != 2 || face !in 0..1 -> null
            sdk >= 30 -> Mode.DYNAMIC_ABOVE
            sdk in 24..29 -> Mode.STATIC_ABOVE
            else -> null
        }

        /** Keep both the box and an overhanging fitted surface beyond the physical display. */
        fun parkingLeft(parentW: Int, displayW: Int, parentScreenX: Int, fittedLeft: Int): Int =
            maxOf(parentW, displayW - parentScreenX - minOf(0, fittedLeft) + 1)

        /** Positions are in the same window coordinate space; moving only a parent can leave local bounds unchanged. */
        fun geometryMatches(expected: IntArray, actual: IntArray): Boolean =
            expected.size == 4 && actual.size == 4 && expected[2] > 0 && expected[3] > 0 && expected.contentEquals(actual)
    }
}
