package com.educms.player.logging

/**
 * WHEN THE DEVICE LOG IS SENT UP WITHOUT ANYONE ASKING (2026-10-11).
 *
 * THE GAP THIS CLOSES. The 2026-10-11 asleep-alert drill on the L55VEC left
 * 57 s unexplained in the server's HTTP log, and the one place that could
 * explain it — the device log, with its `PLAYER_NATIVE_ALERT_*` markers and
 * the `PLAYER_PROCESS_EXIT` / `UNCAUGHT` lines a crash leaves behind — was
 * never uploaded. Uploads only ever happened when the PAGE asked for one
 * (`uploadDiagnostics`), and a page that has just been woken, reloaded or
 * killed is the one that does not ask.
 *
 * So the native side now sends the log by itself after the events that are
 * worth reading about: a wake that landed (with its timeline), a wake that
 * did not, a process that started inside a wake's window, and a native
 * alert episode that settled. Bounded so a flapping panel can never turn
 * this into traffic:
 *  • [DEBOUNCE_MS] after the trigger, so the lines that explain it (the
 *    page's confirm, the follow-up checks) are in the tail that goes up;
 *  • no more than one upload per [MIN_GAP_MS] ([ALERT_MIN_GAP_MS] when the
 *    trigger is an alert — that one must not wait behind a routine wake);
 *  • no more than [MAX_PER_HOUR] per hour from these triggers; a page's own
 *    request is unaffected.
 *
 * Pure, so DiagnosticsUploadPolicyTest pins it.
 */
object DiagnosticsUploadPolicy {

    const val DEBOUNCE_MS = 30_000L
    const val MIN_GAP_MS = 5L * 60_000L
    const val ALERT_MIN_GAP_MS = 60_000L
    const val MAX_PER_HOUR = 6
    private const val HOUR_MS = 60L * 60_000L

    /** Triggers that may ask for an upload. */
    enum class Reason(val alert: Boolean) {
        WAKE_LANDED(false),
        WAKE_NOT_ON_GLASS(false),
        PROCESS_RESTART_AFTER_WAKE(false),
        ALERT_SETTLED(true),
    }

    data class State(
        /** `elapsedRealtime` of the uploads already made in this process, oldest first. */
        val uploadsMs: List<Long> = emptyList(),
        /** `elapsedRealtime` at which an upload is already scheduled; 0 = none. */
        val scheduledAtMs: Long = 0L,
    )

    /**
     * When to upload for [reason], as an `elapsedRealtime` instant — or null
     * when the hourly cap refuses. An upload already scheduled absorbs the
     * request (the earlier of the two instants wins, never before the
     * debounce).
     */
    fun scheduleAt(nowMs: Long, state: State, reason: Reason): Long? {
        val recent = state.uploadsMs.filter { it <= nowMs && nowMs - it < HOUR_MS }
        if (recent.size >= MAX_PER_HOUR) return null
        val gap = if (reason.alert) ALERT_MIN_GAP_MS else MIN_GAP_MS
        val last = recent.lastOrNull()
        val notBefore = if (last == null) nowMs + DEBOUNCE_MS else maxOf(nowMs + DEBOUNCE_MS, last + gap)
        val pending = state.scheduledAtMs
        return if (pending > nowMs) minOf(pending, notBefore) else notBefore
    }
}
