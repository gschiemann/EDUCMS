package com.educms.player.media

import java.util.Locale

/** A delayed render callback cannot give a retired session the window again. */
internal class SoloVideoLayer(val mode: Mode) {
    enum class Mode { UNDER_WINDOW, DYNAMIC_ABOVE, STATIC_ABOVE }
    constructor(eligible: Boolean) : this(if (eligible) Mode.DYNAMIC_ABOVE else Mode.UNDER_WINDOW)
    val eligible: Boolean get() = mode != Mode.UNDER_WINDOW
    val staticAbove: Boolean get() = mode == Mode.STATIC_ABOVE
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
        if (!eligible || !started || !validFrame || phase != Phase.UNDER_WINDOW) return false
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
        private val rockchipPrefix = Regex("^(?:rk[0-9]|rockchip)")
        private fun rockchip(value: String): Boolean = rockchipPrefix.containsMatchIn(value.trim().lowercase(Locale.ROOT))

        fun mode(protocol: Int, face: Int, sdk: Int, hardware: String = "", board: String = ""): Mode = when {
            protocol != 2 || face !in 0..1 -> Mode.UNDER_WINDOW
            face == 0 && sdk >= 30 -> Mode.DYNAMIC_ABOVE
            sdk in 24..29 && (rockchip(hardware) || rockchip(board)) -> Mode.STATIC_ABOVE
            else -> Mode.UNDER_WINDOW
        }

        fun eligible(protocol: Int, face: Int, sdk: Int): Boolean = mode(protocol, face, sdk) != Mode.UNDER_WINDOW

        /** Keep both the box and an overhanging fitted surface beyond the physical display. */
        fun parkingLeft(parentW: Int, displayW: Int, parentScreenX: Int, fittedLeft: Int): Int =
            maxOf(parentW, displayW - parentScreenX - minOf(0, fittedLeft) + 1)

        /** Positions are in the same window coordinate space; moving only a parent can leave local bounds unchanged. */
        fun geometryMatches(expected: IntArray, actual: IntArray): Boolean =
            expected.size == 4 && actual.size == 4 && expected[2] > 0 && expected[3] > 0 && expected.contentEquals(actual)
    }
}
