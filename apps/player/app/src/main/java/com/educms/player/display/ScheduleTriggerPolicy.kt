package com.educms.player.display

/**
 * A MANUAL TURN ON / TURN OFF HOLDS UNTIL THE SCHEDULE'S NEXT TRIGGER (player 1.1.61).
 *
 * Owner rule: the player respects a remote power command; the on/off schedule
 * overrides it at each of its triggers — and only there.
 *
 * Until 1.1.61 [DisplayScheduler.applyDesiredNow] was LEVEL-triggered: every
 * re-evaluation (a process start, the manifest's `display` block changing, the
 * all-clear) asked "what should the panel be right now?" and drove it there.
 * Field case (M43, Amlogic t982, 1.1.60): the owner pressed Turn on at 20:23
 * inside the 18:00–07:00 off window; four seconds later the vendor backlight
 * service answered its probe, the panel's blank mechanism became
 * `vendor-backlight` (a proven mechanism), the server re-routed the same window
 * from the soft array to the hard one, the page installed the new `display`
 * block, and `applyDesiredNow` read "off window, panel on" and BLANKED it — 37 s
 * after the Turn on, with no new command anywhere.
 *
 * Now a manual power command records the wall-clock moment it was accepted
 * ([DisplayPrefs.manualPowerAtMs]). The schedule re-levels the panel only when
 * its own latest transition is NEWER than that command — i.e. the schedule has
 * spoken since the person did. Comparing instants (not "the alarm fired") keeps
 * the answer right for a late alarm, a missed alarm and a process that died
 * across the trigger, exactly like [com.educms.player.standby.UserStandbyPolicy].
 *
 * Pure Kotlin, JVM-tested ([ScheduleTriggerPolicyTest]).
 */
internal object ScheduleTriggerPolicy {

    /**
     * May the schedule drive the panel to its desired level now?
     *
     * @param lastTransitionAtMs the schedule's latest real ON/OFF transition at
     *        or before now, or null when there is none inside the lookback.
     * @param manualAtMs when the latest manual Turn on / Turn off was accepted
     *        (0 = never).
     */
    fun scheduleMayLevel(lastTransitionAtMs: Long?, manualAtMs: Long): Boolean = when {
        manualAtMs <= 0L -> true
        lastTransitionAtMs == null -> false
        else -> lastTransitionAtMs > manualAtMs
    }
}
