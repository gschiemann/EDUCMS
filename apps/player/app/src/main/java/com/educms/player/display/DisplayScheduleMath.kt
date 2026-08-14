package com.educms.player.display

import java.util.Calendar
import java.util.TimeZone

/**
 * On-device schedule math for "blank at 22:00, wake at 07:00".
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY THIS IS ON THE DEVICE AND NOT ON THE SERVER
 * ─────────────────────────────────────────────────────────────────────
 * A screen that loses network MUST still blank at 22:00 and wake at
 * 07:00. Server push is for immediate/manual actions ONLY. The schedule
 * rows ride the manifest, are persisted natively, and are executed by
 * AlarmManager on the box itself (see [DisplayScheduler]).
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY java.util.Calendar AND NOT java.time
 * ─────────────────────────────────────────────────────────────────────
 * `java.time` IS available here — the app enables core-library
 * desugaring (`desugar_jdk_libs:2.0.4` in app/build.gradle.kts), which
 * back-ports it to minSdk 24 by rewriting to `j$.time`. We still use
 * `java.util.Calendar` because it needs no rewriting at all: this
 * package is boot-critical on Android-11 Taurus boards, and this repo
 * has twice been burned by ART class-load VerifyErrors from symbols the
 * runtime did not expect. `Calendar` + `TimeZone` are API 1 and DST-
 * correct as long as day arithmetic goes through `add(DAY_OF_MONTH, n)`
 * rather than adding 86_400_000 ms — which is exactly what this file
 * does.
 *
 * Everything here is PURE: no `android.*`, no I/O, no clock reads except
 * the `atMs` the caller passes in. That is what makes the timezone and
 * midnight-crossing cases testable on a plain JVM.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE MIDNIGHT-CROSSING RULE
 * ─────────────────────────────────────────────────────────────────────
 * A schedule's ON window runs from `onTime` to `offTime`. When
 * `offTime > onTime` the window is same-day: 07:00 → 22:00 is
 * `[07:00, 22:00)` on each selected day. When `offTime <= onTime` the
 * window CROSSES MIDNIGHT: 22:00 → 07:00 is `[22:00, 24:00)` on the
 * selected day PLUS `[00:00, 07:00)` on the following day. `daysOfWeek`
 * always names the day the window STARTS on — so a Friday-only
 * 22:00→07:00 schedule keeps the screen lit into Saturday morning, which
 * is what an operator means by "Friday night".
 *
 * `onTime == offTime` is REJECTED at parse time rather than guessed at.
 * Read as a zero-length window it blanks a wall-mounted screen forever;
 * read as 24 h it never blanks. Neither is safe to assume from a typo.
 */
data class DisplaySchedule(
    val id: String,
    /** 0 = Sunday … 6 = Saturday — the JavaScript `Date.getDay()` order the web layer already uses. */
    val daysOfWeek: Set<Int>,
    /** Minutes past local midnight, 0..1439. */
    val onMinuteOfDay: Int,
    /** Minutes past local midnight, 0..1439. */
    val offMinuteOfDay: Int,
    /** IANA zone id. THE SCREEN'S timezone, never the device default. */
    val timezone: String,
) {
    /** True when the ON window runs past local midnight into the next day. */
    val crossesMidnight: Boolean get() = offMinuteOfDay <= onMinuteOfDay
}

/** One boundary instant plus the state the screen should be in from then on. */
data class ScheduleTransition(val atMs: Long, val on: Boolean)

object DisplayScheduleMath {

    private const val MINUTES_PER_DAY = 24 * 60

    /**
     * Parse "HH:mm" (also tolerates "H:mm" and "HH:mm:ss") into minutes
     * past midnight. Returns null for anything malformed — the caller
     * DROPS that schedule rather than guessing.
     */
    fun parseHHmm(raw: String?): Int? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty() || s.length > 8) return null
        val parts = s.split(":")
        if (parts.size < 2 || parts.size > 3) return null
        val h = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        if (parts.size == 3) {
            val sec = parts[2].toIntOrNull() ?: return null
            if (sec < 0 || sec > 59) return null
        }
        if (h < 0 || h > 23 || m < 0 || m > 59) return null
        return h * 60 + m
    }

    /**
     * Day-of-week token → 0..6 (Sun..Sat). Accepts the three-letter
     * names the rest of this repo uses in `Schedule.daysOfWeek`
     * ("Mon,Tue,Wed"), full names, and plain integers.
     */
    fun parseDayToken(raw: String?): Int? {
        val s = raw?.trim()?.lowercase() ?: return null
        if (s.isEmpty()) return null
        s.toIntOrNull()?.let { return if (it in 0..6) it else null }
        val names = listOf("sun", "mon", "tue", "wed", "thu", "fri", "sat")
        val idx = names.indexOfFirst { s.startsWith(it) }
        return if (idx >= 0) idx else null
    }

    /**
     * What state should the screen be in at [atMs]?
     *
     *   true  — at least one schedule's ON window contains this instant
     *   false — schedules exist but none covers this instant
     *   null  — NO schedules at all, so the schedule layer has no
     *           opinion and must not touch the screen. This distinction
     *           matters: "no schedule configured" must never be read as
     *           "blank it".
     */
    fun desiredOnAt(schedules: List<DisplaySchedule>, atMs: Long): Boolean? {
        if (schedules.isEmpty()) return null
        return schedules.any { covers(it, atMs) }
    }

    /** True when [schedule]'s ON window contains [atMs]. */
    fun covers(schedule: DisplaySchedule, atMs: Long): Boolean {
        val zone = zoneOf(schedule.timezone)
        // A window that crosses midnight and started YESTERDAY can still
        // be running now, so we always look one day back.
        for (dayOffset in -1..0) {
            val start = instantOnDay(zone, atMs, dayOffset, schedule.onMinuteOfDay) ?: continue
            if (dowOf(zone, start) !in schedule.daysOfWeek) continue
            val end = windowEnd(zone, atMs, dayOffset, schedule)
            if (atMs >= start && atMs < end) return true
        }
        return false
    }

    /**
     * The next instant at or after [afterMs] where the desired state can
     * change. Enumerates every schedule's ON and OFF boundary across
     * [horizonDays] and returns the earliest strictly greater than
     * [afterMs].
     *
     * Boundaries are a SUPERSET of real state changes (two overlapping
     * schedules can produce a boundary that changes nothing). That is
     * fine and deliberate: re-applying the same state is idempotent, and
     * a superset can never MISS a transition — which is the only failure
     * mode that leaves a screen dark.
     */
    fun nextTransitionAfter(
        schedules: List<DisplaySchedule>,
        afterMs: Long,
        horizonDays: Int = 8,
    ): ScheduleTransition? {
        if (schedules.isEmpty()) return null
        var best: Long? = null
        schedules.forEach { schedule ->
            val zone = zoneOf(schedule.timezone)
            for (dayOffset in -1..horizonDays) {
                val start = instantOnDay(zone, afterMs, dayOffset, schedule.onMinuteOfDay) ?: continue
                if (dowOf(zone, start) !in schedule.daysOfWeek) continue
                val end = windowEnd(zone, afterMs, dayOffset, schedule)
                listOf(start, end).forEach { candidate ->
                    if (candidate > afterMs && (best == null || candidate < best!!)) best = candidate
                }
            }
        }
        val at = best ?: return null
        // Evaluate the state one millisecond into the new window so a
        // boundary that is simultaneously one schedule's OFF and
        // another's ON resolves to ON.
        val on = desiredOnAt(schedules, at) ?: return null
        return ScheduleTransition(at, on)
    }

    // ─── internals ──────────────────────────────────────────────────

    /**
     * Unknown zone ids fall back to UTC rather than to the DEVICE
     * default. A Goodview box in a warehouse is very often still on the
     * factory's timezone; silently using it would blank a California
     * school's hallway at the wrong hour and look like a bug in the
     * schedule rather than a bad zone id.
     */
    internal fun zoneOf(id: String): TimeZone {
        val trimmed = id.trim()
        if (trimmed.isEmpty()) return TimeZone.getTimeZone("UTC")
        val tz = TimeZone.getTimeZone(trimmed)
        // getTimeZone() returns GMT for anything it does not recognise.
        if (tz.id == "GMT" && !trimmed.equals("GMT", true) &&
            !trimmed.equals("UTC", true) && !trimmed.startsWith("GMT", true)
        ) {
            return TimeZone.getTimeZone("UTC")
        }
        return tz
    }

    /** 0 = Sunday … 6 = Saturday, in [zone], for the instant [ms]. */
    internal fun dowOf(zone: TimeZone, ms: Long): Int {
        val cal = Calendar.getInstance(zone)
        cal.timeInMillis = ms
        return cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY
    }

    /**
     * The instant of `minuteOfDay` on the local day that is [dayOffset]
     * days from the local day containing [baseMs].
     *
     * Day arithmetic goes through `add(DAY_OF_MONTH, …)` and the time is
     * set with field setters, so a spring-forward day (23 h long) lands
     * correctly instead of being 60 minutes off.
     */
    internal fun instantOnDay(zone: TimeZone, baseMs: Long, dayOffset: Int, minuteOfDay: Int): Long? {
        if (minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) return null
        val cal = Calendar.getInstance(zone)
        cal.timeInMillis = baseMs
        if (dayOffset != 0) cal.add(Calendar.DAY_OF_MONTH, dayOffset)
        cal.set(Calendar.HOUR_OF_DAY, minuteOfDay / 60)
        cal.set(Calendar.MINUTE, minuteOfDay % 60)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }

    /**
     * End of the ON window whose start day is [dayOffset] days from
     * [baseMs]'s local day. Rolls to the NEXT day when the window
     * crosses midnight.
     */
    private fun windowEnd(zone: TimeZone, baseMs: Long, dayOffset: Int, schedule: DisplaySchedule): Long {
        val extraDay = if (schedule.crossesMidnight) 1 else 0
        return instantOnDay(zone, baseMs, dayOffset + extraDay, schedule.offMinuteOfDay)
            ?: Long.MAX_VALUE
    }
}
