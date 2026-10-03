package com.educms.player

/** Renderer failures are independent of network failures and page-load success. */
class RendererRecoveryPolicy(previousFailures: Int = 0, previousFailureAt: Long = 0) {
    var failures = previousFailures.coerceIn(0, 6)
        private set
    var lastFailureAt = previousFailureAt
        private set

    fun onFailure(now: Long): Long {
        // A process restart must not reset the crash-loop backoff. A quiet
        // half hour does; onPageFinished alone is not proof of recovery.
        if (now < lastFailureAt || now - lastFailureAt >= QUIET_RESET_MS) failures = 0
        failures = (failures + 1).coerceAtMost(6)
        lastFailureAt = now
        return (2_000L shl (failures - 1)).coerceAtMost(60_000L)
    }

    fun recentlyFailed(now: Long): Boolean =
        lastFailureAt > 0 && now >= lastFailureAt && now - lastFailureAt < SAFE_MODE_MS

    companion object {
        const val QUIET_RESET_MS = 30L * 60 * 1000
        const val SAFE_MODE_MS = 6L * 60 * 60 * 1000

        /** P1-1 — how soon a replaced renderer is reloaded while an alert is held. */
        const val EMERGENCY_RELOAD_MS = 1_000L

        /**
         * How long to wait before reloading a REPLACED renderer
         * (review P1-1, 2026-10-03).
         *
         * Normally the crash-loop backoff [onFailure] returned (2 s doubling
         * to 60 s). But while an emergency hold is active the alert is OFF
         * the glass for the whole wait — the native hold keeps the panel lit
         * and draws nothing — so the backoff is skipped and the page reloads
         * in about a second. The death is still a strike ([onFailure] has
         * already counted it), so a renderer that dies in a loop during an
         * alert still shows up in the failure count and the conservative
         * playback window; it just never costs the alert a minute.
         *
         * Never health-gated either way — see
         * NetworkRecoveryController.onRendererGone (P1-2).
         */
        fun reloadDelayMs(backoffMs: Long, emergencyHeld: Boolean): Long =
            if (emergencyHeld) EMERGENCY_RELOAD_MS else backoffMs.coerceIn(0L, 60_000L)
    }
}
