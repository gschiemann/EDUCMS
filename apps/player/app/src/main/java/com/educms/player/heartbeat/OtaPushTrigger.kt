package com.educms.player.heartbeat

/**
 * OtaPushTrigger — the native heartbeat turns an operator's update push into
 * an update check ON ITS OWN, whatever the web page or WorkManager do (1.1.46).
 *
 * ── THE FIELD FAILURE (Android 9 "Commercial" units, sdk 28, WebView 66) ──
 *
 * After dashboard pushes those units never called `update-check` at all (no
 * offer, no OTA audit row; `lastOtaState` a stale UP_TO_DATE), while other
 * classes on the same build were offered the update within a minute. Their
 * heartbeat DID see `forceUpdatePending` — it reaches the API every few
 * minutes — but the only thing it did with it was enqueue a WorkManager
 * one-shot with a CONNECTED constraint. On API 26–28 JobScheduler reads
 * CONNECTED as a VALIDATED network, and a signage box whose ROM cannot reach
 * the captive-portal probe never has one, so the job never starts; the
 * page's CHECK_FOR_UPDATES relay lands on the same queue.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 *  1. A push identity is acted on once ([isNewPush], the logic that already
 *     lived in HeartbeatService, now testable).
 *  2. The one-shot is enqueued WITHOUT a network constraint: the heartbeat
 *     that saw the push just proved the network.
 *  3. If no check has STARTED, by any route, within [INLINE_AFTER_MS] of the
 *     push, the heartbeat runs the check itself, in-process — once per push.
 */
object OtaPushTrigger {

    /** How long WorkManager gets to start the one-shot before the heartbeat runs it. */
    const val INLINE_AFTER_MS = 90_000L

    /** Same-key-less pushes are rate-limited to this (the legacy server shape). */
    const val LEGACY_MIN_INTERVAL_MS = 60_000L

    /** Rule 1 — is this `forceUpdatePending` answer a push we have not acted on? */
    fun isNewPush(pendingAt: String, lastKey: String?, lastAtMs: Long, nowMs: Long): Boolean =
        if (pendingAt.isNotBlank()) pendingAt != lastKey
        else nowMs - lastAtMs >= LEGACY_MIN_INTERVAL_MS || nowMs < lastAtMs

    /** The key a push is remembered by. */
    fun keyOf(pendingAt: String, nowMs: Long): String = pendingAt.ifBlank { "legacy-$nowMs" }

    /**
     * Rule 3 — run the check in-process now?
     *
     * @param enqueuedAtMs     wall time the push's one-shot was enqueued.
     * @param checkStartedAtMs wall time ANY check last started (0 = never).
     * @param busy             a check is running right now.
     */
    fun shouldRunInline(enqueuedAtMs: Long, checkStartedAtMs: Long, busy: Boolean, nowMs: Long): Boolean {
        if (busy || enqueuedAtMs <= 0L) return false
        if (checkStartedAtMs >= enqueuedAtMs) return false // WorkManager (or the page relay) ran it
        // A wall clock stepped backwards reads as "long enough": run it.
        if (nowMs < enqueuedAtMs) return true
        return nowMs - enqueuedAtMs >= INLINE_AFTER_MS
    }
}
