package com.educms.player.display

/**
 * THE LAST POWER COMMAND WINS — ACROSS A RESTART (player 1.1.60).
 *
 * `DisplayPrefs.blanked` is what `DisplayControlApi.onWindowAttached`
 * re-applies at every process start. Until 1.1.60 it was written AFTER the
 * provider returned, with an asynchronous `apply()`. On the Goodview RK3576
 * box (EP6N class) the vendor's wake — `setDeviceShallowOnoff(true)` — brings
 * the box back by REBOOTING it (Goodview's own CMS wakes that box with
 * `PowerManager.reboot`). The process died inside the wake, `blanked=false`
 * never reached the disk, the new boot read `blanked=true` and re-applied the
 * OFF one second after start, and the heartbeat's next power-on attempt woke
 * (rebooted) it again: three reboots per Turn on, ending dark.
 *
 * So the INTENT is committed synchronously BEFORE the provider runs:
 *  - WAKE writes `blanked=false` first. Whatever happens to the process next
 *    (a reboot, a kill, a crash), a restart never restores the OFF a later ON
 *    replaced. A wake that then fails leaves the intent at ON — the chain's
 *    fall-through and the software floor still run, and the next command
 *    speaks; a restart must never undo an ON.
 *  - BLANK writes `blanked=true` first (after the emergency gate and the
 *    dead-man arm, which snapshot the prior state), so a box that dies inside
 *    a sleep comes back asleep. If nothing in the chain delivered, the prior
 *    intent is put back — a failed OFF is not a command that won.
 *
 * Pure Kotlin, JVM-tested ([com.educms.player.display.PowerIntentSequenceTest]).
 */
internal object PowerIntentPolicy {

    /** The `blanked` intent to COMMIT before the provider runs. */
    fun beforeApply(action: DisplayAction, current: Boolean): Boolean = when (action) {
        DisplayAction.Wake -> false
        DisplayAction.Blank -> true
        else -> current
    }

    /** The `blanked` intent after the apply returned ([prior] = before [beforeApply]). */
    fun afterApply(action: DisplayAction, ok: Boolean, prior: Boolean, current: Boolean): Boolean = when {
        action == DisplayAction.Blank && !ok -> prior
        action == DisplayAction.Wake -> false
        action == DisplayAction.Blank -> true
        else -> current
    }

    enum class Restore {
        /** An alert is held: a visible screen, never the persisted blank. */
        ENFORCE_EMERGENCY,
        /** The last command was OFF: re-apply it. */
        REBLANK,
        /** The last command was ON (or none): leave the panel on. */
        NOTHING,
    }

    /** What a process start re-applies. The emergency always comes first. */
    fun atWindowAttached(emergencyHeld: Boolean, blanked: Boolean): Restore = when {
        emergencyHeld -> Restore.ENFORCE_EMERGENCY
        blanked -> Restore.REBLANK
        else -> Restore.NOTHING
    }
}
