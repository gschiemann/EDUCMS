package com.educms.player.watchdog

/**
 * "The web runtime is alive" is not the same as "the screen is showing
 * content." (2026-08-30 player reliability program, W2-4.)
 *
 * WHY THIS FILE EXISTS. `WebAppBridge.heartbeat()` is a bare liveness
 * tick: the page's JS event loop calls it every ~60 s and MainActivity
 * refreshes `lastSuccessfulLoadAtMs`, which satisfies the 10-minute
 * staleness watchdog. That was the right fix for its own bug (healthy
 * players were being force-reloaded every 10 minutes), but it means a
 * player stuck unauthenticated — event loop fine, manifest sync failing,
 * nothing on the glass — heartbeats forever and the watchdog never fires.
 * The screen is dark and every native signal says healthy.
 *
 * `heartbeatV2` carries the missing bit (`syncOk`), and this policy is
 * what turns it into a decision. Kept pure — no clock, no Android, no
 * WebView — so the timing rules are testable directly.
 *
 * RULES:
 *  1. DORMANT until the first V2 heartbeat ever. An APK running an older
 *     web bundle (which only knows `heartbeat()`) therefore keeps exactly
 *     today's behaviour — this cannot regress a fleet mid-rollout.
 *  2. The reference point is the last tick that reported `syncOk == true`,
 *     or — if none ever has — the first V2 tick we saw.
 *  3. A `null` syncOk (field missing, or malformed JSON) refreshes
 *     nothing, but does not disarm the policy either. Unknown is not OK.
 *  4. Fire when the reference is older than [STALE_MS], subject to a
 *     [COOLDOWN_MS] gate so a screen that reloads into the same broken
 *     state doesn't reload-loop.
 */
class ContentWatchdogPolicy {

    /** When we first heard a V2 heartbeat. Null = dormant, never armed. */
    private var firstV2AtMs: Long? = null

    /** Last tick that reported syncOk == true. Null = never since boot. */
    private var lastSyncOkAtMs: Long? = null

    /** Last time the CALLER acted on our advice. Null = never. */
    private var lastFiredAtMs: Long? = null

    /**
     * Record a V2 heartbeat.
     *
     * @param syncOk null when the web bundle omitted the field or sent
     *        something we could not parse — see rule 3.
     */
    fun onV2Heartbeat(nowMs: Long, syncOk: Boolean?) {
        if (firstV2AtMs == null) firstV2AtMs = nowMs
        if (syncOk == true) lastSyncOkAtMs = nowMs
    }

    /**
     * Should the caller force a reload right now? Does NOT mutate — the
     * caller confirms by calling [markFired], so a caller that decides not
     * to act (emergency hold on screen, say) doesn't burn the cooldown.
     */
    fun shouldForceReload(nowMs: Long): Boolean {
        val armedAt = firstV2AtMs ?: return false          // rule 1
        val reference = lastSyncOkAtMs ?: armedAt          // rule 2
        if (nowMs - reference <= STALE_MS) return false
        val fired = lastFiredAtMs ?: return true           // never fired → go
        return nowMs - fired > COOLDOWN_MS                 // rule 4
    }

    /** The caller acted. Starts the cooldown. */
    fun markFired(nowMs: Long) {
        lastFiredAtMs = nowMs
    }

    companion object {
        /** How long sync may be not-OK before the screen is presumed dark. */
        const val STALE_MS = 30L * 60L * 1000L

        /** Minimum gap between two content-watchdog reloads. */
        const val COOLDOWN_MS = 30L * 60L * 1000L
    }
}
