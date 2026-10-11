package com.educms.player.wake

import org.json.JSONObject

/**
 * ONE WAKE, STEP BY STEP — the record (2026-10-11).
 *
 * What the native runtime report could not say on the 2026-10-11 trials:
 * when the wake was asked for and by whom, when the panel came on, when
 * MainActivity reached onResume, when the page next started a load — and
 * which PROCESS saw each step. All wall-clock milliseconds (the server
 * compares them with its own rows), plus the `elapsedRealtime` of the
 * request so the in-process checks can be scheduled against a clock that
 * NTP cannot step.
 *
 * Pure: no android.*, so [WakeReport] has a JVM test that pins the header
 * budget.
 */
data class WakeTimeline(
    /** Who asked: `dead-man-revert`, `command`, `schedule-on`, `emergency`, `power-on`, `standby-end`, `screen-on`, … */
    val source: String,
    val requestedAtWallMs: Long,
    val requestedAtElapsedMs: Long,
    /** First `ACTION_SCREEN_ON` / interactive read after the request; 0 = not yet. */
    val interactiveAtWallMs: Long = 0L,
    /** `MainActivity.onResume` after the request; 0 = not yet. */
    val resumedAtWallMs: Long = 0L,
    /** The page's next load START after the request (a reload or a cold start); 0 = none. */
    val pageLoadAtWallMs: Long = 0L,
    /** Launches of the existing Activity this wake spent. */
    val launches: Int = 0,
    /** [WakePolicy.outcomeOf]; `pending` until the sequence concludes. */
    val outcome: String = "pending",
) {
    /** `resAt - reqAt`, or null while there is no resume for this wake. */
    val resumeAfterMs: Long?
        get() = if (resumedAtWallMs >= requestedAtWallMs && resumedAtWallMs > 0L) resumedAtWallMs - requestedAtWallMs else null
}

/**
 * The `wake` and `proc` blocks of the native runtime report
 * (`NativePowerControl.report`). Short keys on purpose — the whole header
 * must stay under the server's 1 KiB parse limit.
 *
 *  • `wake` — {src, reqAt, onAt?, resAt?, loadAt?, n, out}: the last wake
 *    this device recorded, from whichever process recorded each step;
 *  • `proc` — {pid, at, boot}: THIS process — its id, when it started (wall
 *    ms) and the box's boot count. A report whose `pid` differs from the
 *    previous one is a process restart; one whose `boot` differs is a
 *    reboot. That is the fact the 2026-10-11 drill could not show.
 */
object WakeReport {

    /** Source names are our own identifiers; anything else is truncated so the header budget holds. */
    const val MAX_SOURCE_CHARS = 24

    fun json(
        timeline: WakeTimeline?,
        pid: Int,
        processStartedAtWallMs: Long,
        bootCount: Int,
    ): JSONObject {
        val out = JSONObject()
        if (timeline != null && timeline.requestedAtWallMs > 0L) {
            val wake = JSONObject()
                .put("src", timeline.source.take(MAX_SOURCE_CHARS))
                .put("reqAt", timeline.requestedAtWallMs)
            if (timeline.interactiveAtWallMs > 0L) wake.put("onAt", timeline.interactiveAtWallMs)
            if (timeline.resumedAtWallMs > 0L) wake.put("resAt", timeline.resumedAtWallMs)
            if (timeline.pageLoadAtWallMs > 0L) wake.put("loadAt", timeline.pageLoadAtWallMs)
            wake.put("n", timeline.launches.coerceIn(0, 9))
            wake.put("out", timeline.outcome.take(16))
            out.put("wake", wake)
        }
        val proc = JSONObject().put("pid", pid.coerceAtLeast(0)).put("at", processStartedAtWallMs.coerceAtLeast(0L))
        if (bootCount >= 0) proc.put("boot", bootCount)
        out.put("proc", proc)
        return out
    }
}
