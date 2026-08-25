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

    // ─────────────────────────────────────────────────────────────────
    // v2 (2026-08-25) — the CHECKLIST model
    //
    // Operator, after walking a real panel through v1: *"the buttons to
    // allow permissions are all over the place, not even in a consistent
    // menu, and one menu wasnt even visible i had to guess where all
    // admin permissions was …. why cant we pop one menu where we quickly
    // check everything we want and then it auto configures everything"*.
    //
    // ⚠️ THE HONEST ANSWER, and it is a hard Android limit: WE CANNOT.
    // Without device-owner provisioning (a factory reset per screen —
    // off the table, every deployed box already carries the vendor's
    // owner) there is NO API that grants install-unknown-apps,
    // WRITE_SETTINGS, battery exemption, device-admin or the HOME
    // default from one dialog. Each one is a separate system Activity
    // the user must visit. Nothing below changes that, and no future
    // agent should be led to think it did.
    //
    // What v2 DOES fix is the part that was actually ours: the operator
    // was thrown at six vendor Settings pages with no thread between
    // them, so a hidden page (the invisible "all admin permissions"
    // menu) left them guessing with nothing to come back to. v2 keeps
    // ONE home-base screen up the whole time — every grant listed, live
    // status, progress, and the next one armed — so every Settings
    // round-trip lands back in the same consistent place.
    //
    // The functions below are the pure half of that screen: what each
    // row says and which button the operator gets. No Context, no View.
    // ─────────────────────────────────────────────────────────────────

    /** Copy shown on the checklist when there is still work to do. */
    const val HEADING_GRANTING = "Finish setting up this screen"

    /**
     * Copy shown when every step has been OFFERED but some were declined
     * or skipped. Deliberately not "complete" — saying "done" over a
     * half-granted panel is how a screen ships with no brightness
     * control and nobody knows until a site visit.
     */
    const val HEADING_PAUSED = "Setup paused"

    /** Copy shown when every applicable grant is actually held. */
    const val HEADING_COMPLETE = "Setup complete ✓"

    /** How one row reads. */
    enum class RowStatus { GRANTED, CURRENT, NEEDED }

    /**
     * What the screen as a whole is doing.
     *
     *  - [GRANTING] — at least one step is still un-offered, so there is
     *    a "next" to arm. This is the ONLY mode the checklist is ever
     *    shown from cold; see `SetupCeremony.resume`.
     *  - [PAUSED]   — everything has been offered, something is still
     *    missing. Reachable only while the screen is already up, or from
     *    the explicit re-open intent — never as a fresh nag.
     *  - [COMPLETE] — every applicable grant is held. Auto-dismisses.
     */
    enum class ChecklistMode { GRANTING, PAUSED, COMPLETE }

    /**
     * One step's live situation plus the copy that describes it.
     *
     * @param note transient per-row message from the last launch attempt
     *        — e.g. "this panel hides the direct page". Not persisted;
     *        it describes what just happened, not what is true.
     */
    data class ChecklistInput(
        val state: StepState,
        val name: String,
        val why: String,
        val hint: String,
        val note: String? = null,
    )

    data class ChecklistRow(
        val key: String,
        val name: String,
        val why: String,
        val status: RowStatus,
        val note: String?,
        /** The "can't find it?" path. Only carried on the armed row. */
        val hint: String?,
        /** May the operator tap this row to (re-)run its grant? */
        val actionable: Boolean,
    )

    data class ChecklistModel(
        val mode: ChecklistMode,
        val heading: String,
        val progress: String,
        val rows: List<ChecklistRow>,
        val primaryLabel: String?,
        val primaryKey: String?,
        val secondaryLabel: String?,
    )

    /**
     * Build the whole screen from live state + copy.
     *
     * Which row is ARMED is [nextKey] — unchanged from v1, so the
     * nag/stall invariant that file's tests pin still governs the
     * primary button. Rows that were offered and declined stay VISIBLE
     * and tappable; they just stop being what the big button points at.
     * That is the difference between a checklist and a nag: the operator
     * can retry any row whenever they like, and nothing re-asks on its
     * own.
     */
    fun buildModel(inputs: List<ChecklistInput>): ChecklistModel {
        val states = inputs.map { it.state }
        val armed = nextKey(states)
        val (done, total) = progress(states)

        val rows = inputs.filter { it.state.applies }.map { input ->
            val status = when {
                input.state.satisfied -> RowStatus.GRANTED
                input.state.key == armed -> RowStatus.CURRENT
                else -> RowStatus.NEEDED
            }
            ChecklistRow(
                key = input.state.key,
                name = input.name,
                why = input.why,
                status = status,
                note = input.note,
                // The hint is a paragraph of Settings-menu directions. On
                // the armed row it is help; on all six at once it is
                // wallpaper nobody reads.
                hint = if (status == RowStatus.CURRENT) input.hint else null,
                actionable = !input.state.satisfied,
            )
        }

        val mode = when {
            armed != null -> ChecklistMode.GRANTING
            done == total -> ChecklistMode.COMPLETE
            else -> ChecklistMode.PAUSED
        }

        return ChecklistModel(
            mode = mode,
            heading = when (mode) {
                ChecklistMode.GRANTING -> HEADING_GRANTING
                ChecklistMode.PAUSED -> HEADING_PAUSED
                ChecklistMode.COMPLETE -> HEADING_COMPLETE
            },
            progress = "$done of $total done",
            rows = rows,
            primaryLabel = when (mode) {
                ChecklistMode.GRANTING ->
                    "Grant next: " + (rows.firstOrNull { it.key == armed }?.name ?: "next step")
                ChecklistMode.PAUSED -> "Done"
                ChecklistMode.COMPLETE -> null
            },
            primaryKey = armed,
            secondaryLabel = if (mode == ChecklistMode.GRANTING) "Not now" else null,
        )
    }
}
