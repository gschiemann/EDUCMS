package com.educms.player.setup

/**
 * The pure half of [SetupCeremony] — which step comes next, and where the
 * operator is in the sequence.
 *
 * Split out for the same reason [com.educms.player.display.DeviceAdminEnrollmentMath]
 * and DisplayScheduleMath are: the rules that decide whether an operator
 * gets nagged, stalled, or silently skipped are worth a test that cannot be
 * skipped for want of an emulator. Everything here is a plain function over
 * plain data — no Context, no Activity, no dialog.
 */

/**
 * One step's situation at a moment in time.
 *
 * @param key       the SharedPreferences marker name, and the step's id.
 * @param applies   is this step meaningful on this box at all? (An SDK
 *                  floor, a companion app that is not installed, a device
 *                  owner that already pins HOME.)
 * @param satisfied is the grant already held? LIVE state — it always wins
 *                  over [offered], so a permission granted by hand, by adb,
 *                  or in an earlier install is never asked for again.
 * @param offered   have we already put this step's dialog on screen once
 *                  for this install?
 */
data class StepState(
    val key: String,
    val applies: Boolean,
    val satisfied: Boolean,
    val offered: Boolean,
)

object SetupCeremonyMath {

    /**
     * The next step to offer, or null when there is nothing outstanding.
     *
     * ⚠️ THE INVARIANT THAT KEEPS THIS FROM NAGGING **OR** STALLING:
     * a step is offered when it applies, is not already satisfied, and has
     * not been offered before. OFFERING — not granting — is what advances
     * the sequence. That is deliberate and load-bearing in both directions:
     *
     *  - If ADVANCING required a GRANT, an operator who taps "Later" (or
     *    who declines in the system dialog) would be re-asked the same
     *    question on every single resume, forever. That is the nag.
     *  - If a step were skipped for any reason OTHER than being satisfied
     *    or already offered, the sequence would stop dead at the first
     *    decline and the remaining steps would never be reached. That is
     *    the stall.
     *
     * Order is the caller's list order, which is a product decision (cheap
     * and safe first; HOME last, because it registers us as a launcher
     * candidate on a box where the vendor's CMS is the host).
     */
    fun nextKey(states: List<StepState>): String? =
        states.firstOrNull { it.applies && !it.satisfied && !it.offered }?.key

    /** Steps that are meaningful on this box, in order. */
    fun applicable(states: List<StepState>): List<StepState> = states.filter { it.applies }

    /**
     * `granted to applicable` — what the status line reports. Counts only
     * steps that apply, so a box that structurally cannot use a step is
     * never shown as incomplete because of it.
     */
    fun progress(states: List<StepState>): Pair<Int, Int> {
        val app = applicable(states)
        return app.count { it.satisfied } to app.size
    }

    /**
     * 1-based position of [key] among the APPLICABLE steps, or 0 when it
     * does not apply here.
     *
     * Position is computed over applicable steps only so the "step 3 of 5"
     * in a dialog title can never promise a step this device will not be
     * asked for — an operator who is told there are five and gets four has
     * been left wondering what they missed.
     */
    fun positionOf(states: List<StepState>, key: String): Int =
        applicable(states).indexOfFirst { it.key == key } + 1

    /** True when nothing applicable is still outstanding. */
    fun isComplete(states: List<StepState>): Boolean = nextKey(states) == null
}
