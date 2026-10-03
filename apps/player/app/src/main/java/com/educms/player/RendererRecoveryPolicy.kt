package com.educms.player

/** Renderer failures are independent of network failures and page-load success. */
class RendererRecoveryPolicy(previousFailures: Int = 0, previousFailureAt: Long = 0) {
    var failures = previousFailures.coerceIn(0, 6)
        private set
    var lastFailureAt = previousFailureAt
        private set

    /** P1-4 — when the current unbroken run of healthy web heartbeats began; 0 = none. */
    private var healthySinceAt = 0L

    /** P1-4 — the last healthy web heartbeat. */
    private var lastHealthyAt = 0L

    fun onFailure(now: Long): Long {
        // A process restart must not reset the crash-loop backoff. A quiet
        // half hour does; onPageFinished alone is not proof of recovery.
        if (now < lastFailureAt || now - lastFailureAt >= QUIET_RESET_MS) failures = 0
        failures = (failures + 1).coerceAtMost(6)
        lastFailureAt = now
        // P1-4 — a death ends any healthy run; the new page has to earn it.
        healthySinceAt = 0L
        lastHealthyAt = 0L
        return (2_000L shl (failures - 1)).coerceAtMost(60_000L)
    }

    /**
     * P1-4 (2026-10-03 review) — the page in this slot sent a web heartbeat.
     *
     * The count used to reset only after 30 minutes with NO failure, so it
     * could not tell "died right after the reload" from "played for fifteen
     * minutes, then died". On the X80, whose renderer is killed every 10–25
     * minutes under download memory pressure and plays normally in between,
     * every death from the 6th on cost a full 60 s of blank glass, forever.
     *
     * Heartbeats are the one signal a page cannot forge without its JS
     * running (player rule 5), so after [HEALTHY_DECAY_MS] of them with no gap
     * longer than [HEALTHY_MAX_GAP_MS] the strike count is reset: the next
     * death backs off from 2 s again. A gap restarts the run. The
     * conservative-playback window ([recentlyFailed]) is unchanged — it keys
     * off the last failure TIME, not the count.
     *
     * @return true when this heartbeat reset the count (the caller persists it).
     */
    fun onHealthyHeartbeat(now: Long): Boolean {
        if (failures == 0) {
            healthySinceAt = 0L
            lastHealthyAt = now
            return false
        }
        val broken = healthySinceAt == 0L || now < lastHealthyAt || now - lastHealthyAt > HEALTHY_MAX_GAP_MS
        if (broken) healthySinceAt = now
        lastHealthyAt = now
        if (now - healthySinceAt >= HEALTHY_DECAY_MS) {
            failures = 0
            healthySinceAt = 0L
            return true
        }
        return false
    }

    fun recentlyFailed(now: Long): Boolean =
        lastFailureAt > 0 && now >= lastFailureAt && now - lastFailureAt < SAFE_MODE_MS

    companion object {
        const val QUIET_RESET_MS = 30L * 60 * 1000
        const val SAFE_MODE_MS = 6L * 60 * 60 * 1000

        /** P1-1 — how soon a replaced renderer is reloaded while an alert is held. */
        const val EMERGENCY_RELOAD_MS = 1_000L

        /** P1-4 — unbroken healthy heartbeats that earn a fresh strike count. */
        const val HEALTHY_DECAY_MS = 5L * 60 * 1000

        /**
         * P1-4 — the longest gap that still counts as "unbroken". The page
         * heartbeats about once a minute; three minutes tolerates a dropped
         * beat or two (and a hidden page's throttled timers) without letting a
         * dead page's silence count as health.
         */
        const val HEALTHY_MAX_GAP_MS = 3L * 60 * 1000

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
