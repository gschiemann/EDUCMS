package com.educms.player.display

/**
 * AFTER THE ALL-CLEAR, A SCREEN THAT WAS OFF GOES BACK TO OFF (player 1.1.51).
 *
 * The 1.1.23 restore ([com.educms.player.standby.UserStandbyPolicy.restoreAfterAlert])
 * covers a panel a PERSON turned off with the remote, and the hard on/off
 * schedule re-evaluates itself on release. What neither covered — the owner's
 * X80 drill, 2026-10-20 — is a screen WE blanked on a command: the dashboard's
 * Turn off / POWER_OFF, a remote hard BLANK. `DisplayEmergency.enforceNow`
 * drives the mirror to `blanked=false` for the alert and nothing wrote down that
 * it had been `true`, so the release path "left the screen alone" and it stayed
 * ON.
 *
 * The rule, as a pure decision: the hold snapshots `blanked` once per alert
 * (first engage, like the brightness), and the release re-applies a BLANK iff
 *  - the screen was blanked before the alert,
 *  - nothing else already darkened it on the release path (the standby
 *    restore, the hard schedule),
 *  - the hard schedule does not say ON right now (the scheduler would wake a
 *    blanked screen on its next re-evaluation anyway — last word wins),
 *  - no WAKE COMMAND spoke during the alert (the dashboard's Turn on, the
 *    schedule's ON trigger; the alert's own wake never counts — same rule as
 *    the standby restore), and
 *  - no face is still holding (never darken during an alert; the registry
 *    refuses every blank while one is held in any case).
 *
 * Pure Kotlin, JVM-tested.
 */
internal object RestoreBlankAfterAlertPolicy {
    enum class Decision {
        /** Re-apply the blank the alert lifted. */
        RESTORE_BLANK,
        /** The screen was on before the alert: nothing to put back. */
        WAS_ON,
        /** Already dark again (the standby restore or the schedule did it). */
        ALREADY_BLANKED,
        /** The hard schedule wants the screen on right now. */
        SCHEDULE_SAYS_ON,
        /** A WAKE command spoke during the alert — it outranks the earlier off. */
        WAKE_COMMAND_DURING_ALERT,
        /** A face is still in an alert — never darken. */
        STILL_HELD,
    }

    fun decide(
        preHoldBlanked: Boolean?,
        blankedNow: Boolean,
        hardScheduleDesiredOn: Boolean?,
        wakeCommandDuringAlert: Boolean,
        stillHeld: Boolean,
    ): Decision = when {
        stillHeld -> Decision.STILL_HELD
        preHoldBlanked != true -> Decision.WAS_ON
        blankedNow -> Decision.ALREADY_BLANKED
        wakeCommandDuringAlert -> Decision.WAKE_COMMAND_DURING_ALERT
        hardScheduleDesiredOn == true -> Decision.SCHEDULE_SAYS_ON
        else -> Decision.RESTORE_BLANK
    }
}
