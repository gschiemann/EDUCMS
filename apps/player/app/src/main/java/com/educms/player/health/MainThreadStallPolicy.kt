package com.educms.player.health

import com.educms.player.diagnostics.LogRedaction

/**
 * MAIN-THREAD LIVENESS — "is the thread that draws the glass answering?"
 * (2026-11-09, player stability gap 4). Pure, so `MainThreadStallPolicyTest`
 * pins every rule.
 *
 * WHY. Both liveness signals the fleet relies on run OFF the main thread: the
 * native server heartbeat is a coroutine on `Dispatchers.IO`
 * (`HeartbeatService.runLoop`) and the Manager heartbeat owns its own
 * `HandlerThread` (`ManagerHeartbeatPublisher`, C-P2-15). So a frozen main
 * thread — frozen WebView, frozen glass, frozen emergency page — went on
 * reporting ONLINE to the server and "alive" to the Manager. An ANR was only
 * seen after the process died (`ProcessExitDiagnostics`).
 *
 * HOW. A background thread posts a no-op to the main looper every
 * [PROBE_INTERVAL_MS] and measures when it runs; this policy turns those
 * observations into a verdict. All times are `SystemClock.uptimeMillis`,
 * which STOPS in deep sleep, so a panel whose CPU suspended (t982 deep
 * standby) never reads as a stall.
 *
 * RULES:
 *  1. One ping outstanding at a time. A ping answered within [STALL_MS] is
 *     healthy. [STALL_MS] is 10 s — generous: a WebView creation or a page
 *     boot on an rk3288 blocks the main thread for several seconds.
 *  2. A ping still unanswered at [STALL_MS] OPENS a stall: counted once, the
 *     main thread's stack captured once (rule 5), a `PLAYER_MAIN_STALL start`
 *     line written.
 *  3. A stall still open at [PROMPT_MS] asks for one prompt native heartbeat,
 *     once per stall, so the server hears about it while it is happening (the
 *     heartbeat thread is not the one that is frozen).
 *  4. The answer CLOSES the stall with its duration (`PLAYER_MAIN_STALL end`).
 *     A slow answer first seen after the fact (≥ [STALL_MS]) is a stall too.
 *  5. The stack is the top [STACK_FRAMES] frames, redacted with
 *     `LogRedaction` and capped at [STACK_CAP] characters.
 *  6. If the PROBE itself did not run for [STARVED_GAP_MS] (the whole process
 *     was frozen or starved, not just the main thread), an open measurement
 *     that has not yet become a stall is thrown away and counted as `starved`
 *     — never as a main-thread stall.
 *  7. OBSERVE AND REPORT ONLY. Nothing here restarts, reloads or kills: the
 *     existing recovery (the Manager's relaunch) is a `startActivity`, which
 *     cannot unfreeze a hung main thread, and a self-kill without hardware
 *     proof that the Activity comes back on every class would trade a frozen
 *     frame for an OEM launcher. That rung is an open decision for the owner.
 */
object MainThreadStallPolicy {

    const val PROBE_INTERVAL_MS = 5_000L
    const val STALL_MS = 10_000L
    const val PROMPT_MS = 30_000L
    const val STARVED_GAP_MS = 3 * PROBE_INTERVAL_MS
    const val STACK_FRAMES = 12
    const val STACK_CAP = 600

    data class State(
        val postedAtMs: Long? = null,
        val stallOpen: Boolean = false,
        val prompted: Boolean = false,
        val lastTickAtMs: Long? = null,
        val stalls: Int = 0,
        val maxStallMs: Long = 0,
        val lastStallMs: Long = 0,
        val lastStallEndAtMs: Long? = null,
        val starved: Int = 0,
        val stack: String? = null,
    ) {
        /** The open stall's age now, 0 when none is open. */
        fun openStallMs(nowMs: Long): Long =
            if (stallOpen && postedAtMs != null) (nowMs - postedAtMs).coerceAtLeast(0) else 0
    }

    data class Actions(
        val post: Boolean = false,
        val captureStack: Boolean = false,
        val prompt: Boolean = false,
        /** Non-null: a stall opened at this pending age. */
        val startedMs: Long? = null,
        /** Non-null: a stall closed with this duration. */
        val endedMs: Long? = null,
    )

    /**
     * One probe tick at [nowMs]; [answeredAtMs] is the main thread's latest
     * answer time (null when it has never answered).
     */
    fun onTick(state: State, nowMs: Long, answeredAtMs: Long?): Pair<State, Actions> {
        var s = state
        val gap = s.lastTickAtMs?.let { nowMs - it }
        s = s.copy(lastTickAtMs = nowMs)
        val posted = s.postedAtMs

        // Rule 6 — the probe itself was frozen: not the main thread's fault.
        if (gap != null && gap >= STARVED_GAP_MS && posted != null && !s.stallOpen) {
            s = s.copy(postedAtMs = nowMs, starved = s.starved + 1)
            return s to Actions(post = true)
        }

        if (posted == null) {
            return s.copy(postedAtMs = nowMs) to Actions(post = true)
        }

        // Rule 4 — answered.
        if (answeredAtMs != null && answeredAtMs >= posted) {
            val dur = answeredAtMs - posted
            if (dur >= STALL_MS) {
                val counted = if (s.stallOpen) s.stalls else s.stalls + 1
                s = s.copy(
                    stalls = counted,
                    maxStallMs = maxOf(s.maxStallMs, dur),
                    lastStallMs = dur,
                    lastStallEndAtMs = answeredAtMs,
                )
                s = s.copy(postedAtMs = nowMs, stallOpen = false, prompted = false)
                return s to Actions(post = true, endedMs = dur)
            }
            return s.copy(postedAtMs = nowMs, stallOpen = false, prompted = false) to Actions(post = true)
        }

        // Still pending.
        val pending = nowMs - posted
        var actions = Actions()
        if (pending >= STALL_MS && !s.stallOpen) {
            s = s.copy(stallOpen = true, stalls = s.stalls + 1)
            actions = actions.copy(captureStack = true, startedMs = pending)
        }
        if (s.stallOpen) s = s.copy(maxStallMs = maxOf(s.maxStallMs, pending))
        if (pending >= PROMPT_MS && s.stallOpen && !s.prompted) {
            s = s.copy(prompted = true)
            actions = actions.copy(prompt = true)
        }
        return s to actions
    }

    /** Rule 5 — the frames, one token each, redacted and capped. */
    fun formatStack(frames: List<StackTraceElement>): String {
        val text = frames.take(STACK_FRAMES).joinToString(";") { f ->
            val cls = f.className.substringAfterLast('.')
            val line = if (f.lineNumber > 0) ":${f.lineNumber}" else ""
            "$cls.${f.methodName}$line"
        }
        return LogRedaction.line(text).replace(Regex("[^\\x20-\\x7E]"), " ").take(STACK_CAP)
    }

    fun startLine(pendingMs: Long, stalls: Int, stack: String?): String =
        "PLAYER_MAIN_STALL start pendingMs=$pendingMs n=$stalls" + (stack?.let { " stack=\"$it\"" } ?: "")

    fun endLine(durationMs: Long, maxMs: Long): String =
        "PLAYER_MAIN_STALL end durationMs=$durationMs maxMs=$maxMs"
}
