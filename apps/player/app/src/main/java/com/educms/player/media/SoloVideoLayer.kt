package com.educms.player.media

/** A delayed render callback cannot give a retired session the window again. */
internal class SoloVideoLayer(val eligible: Boolean) {
    enum class Phase { UNDER_WINDOW, QUEUED, ABOVE_WINDOW, RETIRED }
    var phase = Phase.UNDER_WINDOW
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
        phase = Phase.ABOVE_WINDOW
        return true
    }

    fun retire() { phase = Phase.RETIRED }

    companion object {
        // Private qualification starts with the two Android-13 primary panels.
        // Positioned zones, secondary windows and older ROMs keep their layer.
        fun eligible(protocol: Int, face: Int, sdk: Int): Boolean = protocol == 2 && face == 0 && sdk >= 33
    }
}
