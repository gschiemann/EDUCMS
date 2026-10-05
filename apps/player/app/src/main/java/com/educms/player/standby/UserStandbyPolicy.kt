package com.educms.player.standby

import com.educms.player.display.ScheduleTransition

/**
 * USER STANDBY — the pure half (2026-10-03, player 1.1.21).
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE OWNER'S RULE: "respect the remote but a schedule overrides it when
 * it hits on or off trigger."
 * ═════════════════════════════════════════════════════════════════════
 *
 * Up to 1.1.20 a person who turned a screen off with the remote got it back
 * on within fifteen minutes: the Watchdog alarm started MainActivity, and an
 * Activity that carries `android:turnScreenOn` + FLAG_TURN_SCREEN_ON turns
 * the panel on when it is started while the panel is off. The player never
 * observed ACTION_SCREEN_OFF at all, so it could not tell "a person did
 * this" from "the OS timed out".
 *
 * Now, last command wins:
 *   • the panel going off by something that is NOT us, while the player is
 *     on the glass, is USER STANDBY — persisted, so it survives a process
 *     death, and void after a reboot (a boot is "on");
 *   • while it lasts no reliability path may wake the panel or bring the
 *     Activity forward with its wake flags armed. Recovery work still runs,
 *     dark;
 *   • it ends when the person presses power again (ACTION_SCREEN_ON), when
 *     the on/off schedule's ON trigger fires AFTER the person's off, on a
 *     WAKE command (the dashboard's "Turn on"), and on an emergency alert.
 *
 * ⚠️ LIFE SAFETY OUTRANKS THE REMOTE. Nothing here may ever sit between an
 * alert and the glass: the emergency path ends standby itself and wakes the
 * panel with a wake lock that needs no window (`ScreenWakeLock.pokeScreen`),
 * and a screen-off DURING an active alert is never standby at all.
 *
 * No android.*, no clock reads, no I/O — every fact is passed in, so every
 * rule here has a JVM test that cannot be skipped for want of a device.
 */

/** What the persisted record knows about the standby a person started. */
data class StandbyRecord(
    /** `System.currentTimeMillis()` when the panel went off — compared with schedule triggers (wall clock). */
    val sinceWallMs: Long,
    /** `SystemClock.elapsedRealtime()` at the same moment. A reboot resets this clock. */
    val sinceElapsedMs: Long,
    /** `Settings.Global.BOOT_COUNT` at entry, or -1 on a ROM that does not keep it. */
    val bootCount: Int,
    /**
     * 1.1.23 — this standby was PUT BACK by us after an alert's all-clear,
     * through our own best blank. Such a panel may still be lit for a while
     * (a screen-off timeout takes 15 s; the software floor is a black overlay
     * on a lit backlight), so being interactive does NOT end it. What ends it
     * is what ends any standby — the power key (SCREEN_ON), a WAKE command,
     * the schedule's ON trigger, an alert, a reboot — and ending it undoes
     * our blank. The person's original times are kept, so "last command
     * wins" is still measured from THEIR off.
     */
    val restoredByUs: Boolean = false,
)

/** A person's standby that an alert ended, kept so the all-clear can put it back (1.1.23). */
data class InterruptedStandby(
    /** The person's standby as it was when the alert arrived. */
    val record: StandbyRecord,
    /** `elapsedRealtime` when the alert ended it. */
    val interruptedAtElapsedMs: Long,
)

/** What the all-clear does about a standby the alert ended. */
enum class RestoreDecision {
    /** Put the panel back to sleep and re-enter user standby. */
    RESTORE,

    /** No person had the panel off when the alert came. */
    NOTHING_INTERRUPTED,

    /** Some face is still in an alert — nothing may darken. */
    STILL_HELD,

    /** The box restarted since — a boot is "on". */
    REBOOTED,

    /** A WAKE command (the dashboard's Turn on) came after the alert began — it spoke last. */
    WAKE_COMMAND_DURING_ALERT,

    /** The on/off schedule's ON trigger fired after the person's off — it spoke last. */
    SCHEDULE_ON_AFTER_OFF,
}

/** Who turned the panel off. */
enum class ScreenOffCause {
    /** A person (remote / power key) — or anything else that is not us — while the player was on the glass. */
    USER,

    /** One of our own blank mechanisms (device-admin lock, screen-off timeout, software floor, vendor recipe). */
    OURS,

    /**
     * The player was not on the glass. An OS screen-off timeout over another
     * app is indistinguishable from a key press, so this keeps the pre-1.1.21
     * behaviour: the relaunch paths may bring the player back.
     */
    NOT_ON_GLASS,

    /** An emergency alert is held. The alert outranks the remote; the panel is put back on. */
    EMERGENCY,
}

/** Everything [UserStandbyPolicy.classifyScreenOff] is allowed to use. */
data class ScreenOffFacts(
    val emergencyHeld: Boolean,
    /** `DisplayPrefs.blanked` — a blank of ours is in force (a scheduled or operator blank). */
    val ourBlankInForce: Boolean,
    /** Milliseconds since this process last STARTED one of our blanks; null = never. */
    val sinceOwnBlankMs: Long?,
    /** MainActivity was resumed, or was paused BY this sleep. */
    val playerOnGlass: Boolean,
)

/** What a relaunch path may do right now. */
enum class RelaunchMode {
    /** Not in standby — the pre-1.1.21 behaviour, unchanged. */
    NORMAL,

    /** In standby and the Activity is alive — nothing to recover; launching it could only wake the panel. */
    SKIP,

    /**
     * In standby and the Activity is gone (process death, OTA). Start it so the
     * page runs and can still receive an alert — its onCreate leaves the wake
     * flags disarmed, so the panel stays off.
     */
    DARK,
}

object UserStandbyPolicy {

    /**
     * How long after one of OUR blanks starts a screen-off still counts as
     * ours. The slowest mechanism is `ScreenTimeoutBlankProvider` (the OS
     * sleeps the panel 15 s after it lets go); two minutes covers it and a
     * slow vendor broadcast with margin. Belt only — the persisted
     * `DisplayPrefs.blanked` mirror is the main signal.
     */
    const val OWN_BLANK_GRACE_MS = 2L * 60L * 1000L

    /**
     * A screen-off broadcast can arrive just after the Activity was paused by
     * the very sleep it reports. A pause this recent, taken while the panel
     * was already non-interactive, still means "the player was on the glass".
     */
    const val PAUSED_BY_SLEEP_WINDOW_MS = 10_000L

    /**
     * The standby CPU lock's timeout. It is refreshed by every Watchdog tick
     * (~15 min), so in practice it is held for the whole standby; the timeout
     * only exists so a lost release can never pin the CPU forever.
     */
    const val CPU_LOCK_TIMEOUT_MS = 60L * 60L * 1000L

    /** Minimum gap between two emergency re-asserts caused by a screen-off during an alert. */
    const val EMERGENCY_REASSERT_MIN_GAP_MS = 30_000L

    /**
     * Who turned the panel off. Order is the whole point: an alert outranks
     * everything, our own blank outranks the remote, and only then does
     * "was the player on the glass" decide between a person and the OS.
     */
    fun classifyScreenOff(f: ScreenOffFacts): ScreenOffCause = when {
        f.emergencyHeld -> ScreenOffCause.EMERGENCY
        f.ourBlankInForce -> ScreenOffCause.OURS
        f.sinceOwnBlankMs != null && f.sinceOwnBlankMs in 0..OWN_BLANK_GRACE_MS -> ScreenOffCause.OURS
        !f.playerOnGlass -> ScreenOffCause.NOT_ON_GLASS
        else -> ScreenOffCause.USER
    }

    /** Was MainActivity on the glass when the panel went off? */
    fun playerOnGlass(inForeground: Boolean, sincePausedBySleepMs: Long?): Boolean =
        inForeground || (sincePausedBySleepMs != null && sincePausedBySleepMs in 0..PAUSED_BY_SLEEP_WINDOW_MS)

    /**
     * Is a persisted standby still in force?
     *
     * Standby means "the panel is off because a person turned it off", so:
     *   • a panel that is ON now ends it (we missed the ACTION_SCREEN_ON,
     *     e.g. the process was dead when the person pressed power);
     *   • a reboot ends it — a boot is "on". `elapsedRealtime` going
     *     backwards, or a different BOOT_COUNT, is a different boot.
     */
    fun recordStillValid(
        record: StandbyRecord,
        nowElapsedMs: Long,
        nowBootCount: Int,
        screenInteractive: Boolean,
    ): Boolean = when {
        // A standby WE put back after an alert may still be lit while our
        // blank takes hold (or for good, on the software floor). See
        // [StandbyRecord.restoredByUs].
        screenInteractive && !record.restoredByUs -> false
        nowElapsedMs < record.sinceElapsedMs -> false
        record.bootCount >= 0 && nowBootCount >= 0 && record.bootCount != nowBootCount -> false
        else -> true
    }

    /** What a relaunch path (Watchdog, post-install, OTA receiver) may do. */
    fun relaunchMode(standbyActive: Boolean, activityAlive: Boolean): RelaunchMode = when {
        !standbyActive -> RelaunchMode.NORMAL
        activityAlive -> RelaunchMode.SKIP
        else -> RelaunchMode.DARK
    }

    /**
     * "A schedule overrides it when it hits its on trigger." Last command
     * wins: the standby ends only when the latest real schedule transition is
     * an ON that came AFTER the person's off. An ON window already running
     * when the person pressed power does not.
     */
    fun scheduleEndsStandby(record: StandbyRecord, lastTransition: ScheduleTransition?): Boolean =
        lastTransition != null && lastTransition.on && lastTransition.atMs > record.sinceWallMs

    // ─── 1.1.23 — AFTER THE ALL-CLEAR, BACK TO HOW IT WAS ────────────────
    //
    // Owner, after the 1.1.22 drill on the X80: the alert woke a panel he had
    // turned off with the remote — correct — but after the all-clear it STAYED
    // ON. An alert used to END the standby for good. Now the standby the
    // alert interrupted is remembered and, when the hold is released, put
    // back — unless something that outranks the person's off spoke during the
    // alert. Last command wins, exactly as for the standby itself.
    //
    // ⚠️ Nothing here may darken during an alert: [STILL_HELD] is checked
    // first, and the caller runs only on the release path, after the hold is
    // committed released.

    /**
     * What the all-clear does about a standby an alert ended.
     *
     * Order matters: an alert still held outranks everything (never darken
     * during an alert); a reboot voids the person's standby as it always has;
     * then a WAKE command or the schedule's ON trigger that spoke after the
     * person's off wins.
     *
     * @param lastDeliberateWakeElapsedMs the last WAKE that was a COMMAND (the
     *        dashboard's Turn on, the schedule's ON) — never the alert's own
     *        wake. Null = none since the interruption.
     */
    fun restoreAfterAlert(
        interrupted: InterruptedStandby?,
        stillHeld: Boolean,
        nowElapsedMs: Long,
        nowBootCount: Int,
        lastDeliberateWakeElapsedMs: Long?,
        lastScheduleTransition: ScheduleTransition?,
    ): RestoreDecision = when {
        interrupted == null -> RestoreDecision.NOTHING_INTERRUPTED
        stillHeld -> RestoreDecision.STILL_HELD
        nowElapsedMs < interrupted.interruptedAtElapsedMs -> RestoreDecision.REBOOTED
        nowElapsedMs < interrupted.record.sinceElapsedMs -> RestoreDecision.REBOOTED
        interrupted.record.bootCount >= 0 && nowBootCount >= 0 &&
            interrupted.record.bootCount != nowBootCount -> RestoreDecision.REBOOTED
        lastDeliberateWakeElapsedMs != null &&
            lastDeliberateWakeElapsedMs >= interrupted.interruptedAtElapsedMs ->
            RestoreDecision.WAKE_COMMAND_DURING_ALERT
        scheduleEndsStandby(interrupted.record, lastScheduleTransition) -> RestoreDecision.SCHEDULE_ON_AFTER_OFF
        else -> RestoreDecision.RESTORE
    }
}
