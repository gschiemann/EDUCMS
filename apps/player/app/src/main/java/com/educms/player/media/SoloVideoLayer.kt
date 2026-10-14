package com.educms.player.media

/** A delayed render callback cannot give a retired session the window again. */
internal class SoloVideoLayer(val eligible: Boolean) {
    enum class Phase { UNDER_WINDOW, QUEUED, REVEALING, ABOVE_WINDOW, RETIRED }
    var phase = Phase.UNDER_WINDOW
        private set
    var revealRequestedNs = 0L
        private set

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

    /** The z-order request is asynchronous; this is not compositor confirmation. */
    fun revealRequested(atNs: Long) {
        if (phase == Phase.REVEALING && revealRequestedNs == 0L && atNs > 0L) revealRequestedNs = atNs
    }

    /** Batched callbacks for frames rendered before the request cannot complete takeover. */
    fun confirm(stamp: Long, live: Boolean, attached: Boolean, emergencyHeld: Boolean, uiClear: Boolean): Boolean {
        if (phase != Phase.REVEALING) return false
        if (!live || !attached || emergencyHeld || !uiClear) {
            phase = Phase.RETIRED
            return false
        }
        if (revealRequestedNs == 0L || stamp <= revealRequestedNs) return false
        phase = Phase.ABOVE_WINDOW
        return true
    }

    // Decoder callbacks can continue while a reveal fails. Give ownership its
    // own deadline rather than extending it with those callbacks forever.
    fun revealTimedOut(nowNs: Long): Boolean = phase == Phase.REVEALING &&
        revealRequestedNs > 0L && nowNs - revealRequestedNs >= REVEAL_TIMEOUT_NS

    fun retire() { phase = Phase.RETIRED }

    companion object {
        const val REVEAL_TIMEOUT_NS = 3_500_000_000L
        // Android R supports dynamic surface z-order with our targetSdk 34.
        // Vision Core's Android 11 must not use the transparent WebView path
        // that hid the native surface. Positioned zones and older ROMs retain
        // their composition policy and require separate hardware qualification.
        fun eligible(protocol: Int, face: Int, sdk: Int): Boolean = protocol == 2 && face == 0 && sdk >= 30
    }
}
