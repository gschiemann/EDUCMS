package com.educms.player.heartbeat

/**
 * WHEN A POWER EVENT MAY PULL THE NATIVE HEARTBEAT FORWARD (2026-10-11).
 *
 * THE LAG THIS CLOSES. The native runtime report (`interactive`,
 * `foreground`, the wake timeline) rides the heartbeat, and the heartbeat
 * ticks every 60 s while the panel is dark but drops to the 5-minute floor
 * the moment the panel is on and the page is reporting. So the one report
 * that says "the panel came on at T" was sent up to five minutes AFTER T —
 * on the M43 trial the server learned `interactive:true` at 18:39:39 for a
 * panel that had been playing since ~18:36:53.
 *
 * Now `ACTION_SCREEN_ON`, `ACTION_SCREEN_OFF`, a wake request and
 * `MainActivity.onResume` each ask for ONE prompt tick. Bounded, because
 * these are broadcasts a flapping panel can fire in a loop:
 *  • no prompt tick within [MIN_GAP_MS] of the previous one — the request
 *    is folded into the one already pending, or into the periodic tick;
 *  • no more than [MAX_PER_WINDOW] prompt ticks per [WINDOW_MS].
 * A refused request costs nothing: the periodic tick still runs.
 *
 * Pure, so HeartbeatCadenceTest / PromptTickPolicyTest pin it.
 */
object PromptTickPolicy {

    const val MIN_GAP_MS = 5_000L
    const val WINDOW_MS = 10L * 60_000L
    const val MAX_PER_WINDOW = 12

    /**
     * @param nowMs `elapsedRealtime`
     * @param recentPromptTicksMs `elapsedRealtime` of the prompt ticks this
     *        process has made, oldest first (the caller prunes with [prune]).
     */
    fun accept(nowMs: Long, recentPromptTicksMs: List<Long>): Boolean {
        val last = recentPromptTicksMs.lastOrNull()
        if (last != null && nowMs >= last && nowMs - last < MIN_GAP_MS) return false
        return prune(nowMs, recentPromptTicksMs).size < MAX_PER_WINDOW
    }

    /** The ticks still inside the window. A backwards clock keeps nothing. */
    fun prune(nowMs: Long, recentPromptTicksMs: List<Long>): List<Long> =
        recentPromptTicksMs.filter { it <= nowMs && nowMs - it < WINDOW_MS }
}
