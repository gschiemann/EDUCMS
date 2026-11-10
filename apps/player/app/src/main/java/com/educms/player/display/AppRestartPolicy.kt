package com.educms.player.display

/**
 * AppRestartPolicy — the pure rules of the remote "restart the app" command
 * (2026-11-09, player-stability gap 2 + 9). No Context, no Android.
 *
 * WHAT AN APP RESTART IS. The player ends its own process and an exact alarm
 * it armed a moment earlier starts it again. No device owner, no root: a
 * process may always kill itself, and a pending alarm is held by Android,
 * not by the process. The only Android limit is the LAUNCH of the Activity
 * from the background (Android 10+), which is legal only for an app that is
 * the Home default or holds "Display over other apps" (device owner is ruled
 * out for good). That is the same fact set the post-OTA relaunch ladder
 * ([com.educms.player.ota.RelaunchEscalation]) trusts, and the relaunch
 * itself goes through that ladder — there is no second relaunch path.
 *
 * THE GAP, written down because life safety depends on it:
 *   • the old process lives [KILL_DELAY_MS] after it accepted (so its answer
 *     reaches the page and the server), re-checks the emergency hold, then
 *     dies. From that moment until the new process starts, NOTHING of the
 *     player runs: no page, no heartbeat, no native alert watch.
 *   • the relaunch alarm fires [RELAUNCH_ALARM_DELAY_MS] after the accept,
 *     so the expected dark gap is about 3 s of no process plus the cold
 *     start; the native alert watch is back as soon as HeartbeatService's
 *     onCreate runs (about 1–2 s into the new process) and the page paints
 *     about 5–15 s after that. Expected: alert watch down ≈ 3–6 s, glass not
 *     showing content ≈ 8–20 s. An alert raised during the gap is not lost:
 *     the alert watch and the page each read the manifest's `emergency`
 *     field when they start (the polling backstop).
 *   • FAILURE DIRECTION: if the relaunch alarm is lost, Android restarts the
 *     START_STICKY HeartbeatService (which starts the alert watch) and the
 *     15-minute Watchdog tick relaunches the Activity — so the worst case is
 *     about 15 minutes of dark glass with the alert watch already running
 *     again. If the Activity launch is refused, the ladder posts its
 *     tap-to-return notification and this policy latches the device out of
 *     app restarts for [FAILED_LATCH_MS] ([landingOutcome] → NOT_LANDED), so
 *     the server stops being offered the action (honest capability).
 *
 * Kill switch: on the server (`SCHEDULED_REBOOTS_DISABLED` for the schedule;
 * an operator simply never presses the button). On the device: the
 * capability is withdrawn by the latch, and a refused command changes nothing.
 */
object AppRestartPolicy {

    /** The old process waits this long after accepting before it ends itself. */
    const val KILL_DELAY_MS = 2_500L

    /** The relaunch alarm, from the accept. Always after the kill. */
    const val RELAUNCH_ALARM_DELAY_MS = 5_000L

    /** The new process judges whether the relaunch landed this long after the alarm. */
    const val LANDING_CHECK_MS = 20_000L

    /** At most one app restart per this long (a command storm or a bad schedule cannot loop). */
    const val MIN_INTERVAL_MS = 30L * 60_000L

    /** And at most this many in any rolling 24 hours. */
    const val MAX_PER_DAY = 3
    const val DAY_MS = 24L * 60L * 60_000L

    /** A process younger than this refuses (a restart that comes back into another restart). */
    const val MIN_PROCESS_AGE_MS = 5L * 60_000L

    /** A relaunch that did not land withdraws the capability for this long. */
    const val FAILED_LATCH_MS = 7L * DAY_MS

    /** Android 10 (Q) is where background activity starts became restricted. */
    const val BAL_RESTRICTED_FROM_SDK = 29

    const val MECHANISM = "relaunch"
    const val NONE = "none"

    /** What the capability probe reports, and why (the reason is logged, never shown). */
    data class CapabilityFacts(
        val sdkInt: Int,
        val canDrawOverlays: Boolean,
        val isHomeApp: Boolean,
        /** The page can reach the APK over the trusted channel (WEB_MESSAGE_LISTENER). */
        val trustedBridge: Boolean,
        /** Wall ms of the last relaunch that did not land, or 0. */
        val lastFailedLandingWallMs: Long,
        val nowWallMs: Long,
    )

    fun capability(f: CapabilityFacts): Pair<String, String> {
        if (!f.trustedBridge) return NONE to "no-trusted-bridge"
        if (f.sdkInt >= BAL_RESTRICTED_FROM_SDK && !f.canDrawOverlays && !f.isHomeApp) {
            return NONE to "no-background-launch-grant"
        }
        if (f.lastFailedLandingWallMs > 0) {
            val age = f.nowWallMs - f.lastFailedLandingWallMs
            // A failure stamped in the future (a clock step) still counts: fail closed.
            if (age < FAILED_LATCH_MS) return NONE to "relaunch-did-not-land"
        }
        return MECHANISM to "ok"
    }

    /** Everything a request is judged on. */
    data class RequestFacts(
        val actionId: String?,
        val trusted: Boolean,
        val capable: Boolean,
        val emergencyHeld: Boolean,
        val otaInFlight: Boolean,
        val pairing: Boolean,
        val setupInProgress: Boolean,
        val userStandby: Boolean,
        val processAgeMs: Long,
        /** Wall ms of earlier ACCEPTED restarts (persisted). */
        val history: List<Long>,
        /** The action id this device last answered, if any (a replay is refused). */
        val lastActionId: String?,
        val nowWallMs: Long,
    )

    /** Refusal reasons, stable strings — they ride the ack as `r`. */
    object Reason {
        const val BAD_ID = "bad-id"
        const val DUPLICATE = "duplicate"
        const val UNTRUSTED = "untrusted"
        const val NOT_CAPABLE = "not-capable"
        const val EMERGENCY = "emergency"
        const val OTA = "ota-in-flight"
        const val PAIRING = "pairing"
        const val SETUP = "setup"
        const val STANDBY = "user-standby"
        const val TOO_SOON_AFTER_START = "process-too-young"
        const val RATE_INTERVAL = "rate-interval"
        const val RATE_DAY = "rate-day"
    }

    /** null = accept; otherwise the reason it is refused. Order: safety first. */
    fun refusal(f: RequestFacts): String? {
        val id = f.actionId?.trim().orEmpty()
        if (id.isEmpty() || id.length > 64) return Reason.BAD_ID
        if (id == f.lastActionId) return Reason.DUPLICATE
        if (f.emergencyHeld) return Reason.EMERGENCY
        if (!f.trusted) return Reason.UNTRUSTED
        if (!f.capable) return Reason.NOT_CAPABLE
        if (f.otaInFlight) return Reason.OTA
        if (f.pairing) return Reason.PAIRING
        if (f.setupInProgress) return Reason.SETUP
        // The owner's rule: a remote power-off is respected; a restart would
        // start the Activity and could light a panel a person turned off.
        if (f.userStandby) return Reason.STANDBY
        if (f.processAgeMs in 0 until MIN_PROCESS_AGE_MS) return Reason.TOO_SOON_AFTER_START
        // A stamp from the future (clock stepped back) counts as "just now":
        // the limit can only get stricter from a bad clock, never looser.
        val ages = f.history.map { (f.nowWallMs - it).coerceAtLeast(0L) }
        if (ages.any { it < MIN_INTERVAL_MS }) return Reason.RATE_INTERVAL
        if (ages.count { it < DAY_MS } >= MAX_PER_DAY) return Reason.RATE_DAY
        return null
    }

    /** History kept after an accept: the last day only, bounded. */
    fun historyAfterAccept(history: List<Long>, nowWallMs: Long): List<Long> =
        (history.filter { (nowWallMs - it) < DAY_MS } + nowWallMs).takeLast(MAX_PER_DAY + 1)

    /** Ack outcomes, stable strings (the API's APP_RESTART_OUTCOMES). */
    object Outcome {
        const val REFUSED = "refused"
        const val RESTARTING = "restarting"
        const val STARTED = "started"
        const val LANDED = "landed"
        const val NOT_LANDED = "not-landed"
    }

    /**
     * The new process's verdict on its own relaunch, [LANDING_CHECK_MS] after
     * the alarm. Only a lit, interactive panel without the Activity in front
     * is a failure we can see; a dark panel or one of our own install
     * dialogs on top proves only that the process came back (STARTED).
     */
    fun landingOutcome(foreground: Boolean, interactive: Boolean?, installPromptOutstanding: Boolean): String = when {
        foreground -> Outcome.LANDED
        installPromptOutstanding -> Outcome.STARTED
        interactive != true -> Outcome.STARTED
        else -> Outcome.NOT_LANDED
    }

    /**
     * What the report says when the record still reads RESTARTING: if this
     * process is not the one that accepted, the restart happened (STARTED)
     * even before the landing check ran or if its alarm was lost.
     */
    fun reportedOutcome(recordOutcome: String, recordPid: Int, myPid: Int): String =
        if (recordOutcome == Outcome.RESTARTING && recordPid > 0 && myPid > 0 && recordPid != myPid) {
            Outcome.STARTED
        } else {
            recordOutcome
        }
}
