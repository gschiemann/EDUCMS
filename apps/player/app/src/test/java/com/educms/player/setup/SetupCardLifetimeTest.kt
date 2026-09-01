package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.ChecklistInput
import com.educms.player.setup.SetupCeremonyMath.ChecklistMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * ── HOW LONG THE SETUP CARD STAYS ON GLASS (2026-09-01, v1.1.12) ────────
 *
 * WHY THIS SUITE EXISTS. Operator, panel G65, remote control only, no
 * touch: *"the splash screen that allows me to set all the permissions
 * goes away before I can set the optional permissions."*
 *
 * The card he lost was in [ChecklistMode.COMPLETE] — which is entered the
 * moment the CORE grants are held, because `nextKey` skips optional rows
 * and `progress` counts core rows only. Both of those are deliberate (a
 * demoted grant must never nag, and `managerInstallPromptShown` can never
 * report satisfied, so counting it pinned every provisioned panel at
 * "5 of 6" forever). The bug was never the count — it was that "COMPLETE"
 * also armed a self-destruct over a panel with untouched optional rows.
 *
 * WHAT IS PINNED HERE, in both directions:
 *
 *   1. A card with outstanding optional work NEVER closes itself. Its
 *      backstop is the ceremony's idle stand-down (10 minutes, reset by
 *      every interaction), not a fuse measured in seconds.
 *   2. A genuinely finished card STILL clears itself in four seconds. An
 *      adb-provisioned panel has nothing to read and nothing to do;
 *      parking a card over its signage would be the opposite defect.
 */
class SetupCardLifetimeTest {

    private val core = listOf(
        "installPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "homeSetupPromptShown",
    )
    private val advanced = listOf("managerInstallPromptShown", "deviceAdminPromptShown")

    private fun input(
        key: String,
        satisfied: Boolean = false,
        offered: Boolean = false,
        applies: Boolean = true,
        optional: Boolean = key in advanced,
    ) = ChecklistInput(
        state = StepState(key, applies, satisfied, offered, optional),
        name = "name-$key",
        why = "why-$key",
        hint = "hint-$key",
    )

    /** The real six, in the real order, with the real optional flags. */
    private fun fleet(
        satisfied: Set<String> = emptySet(),
        offered: Set<String> = emptySet(),
        inapplicable: Set<String> = emptySet(),
    ) = listOf(
        "installPromptShown",
        "managerInstallPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "deviceAdminPromptShown",
        "homeSetupPromptShown",
    ).map {
        input(
            it,
            satisfied = it in satisfied,
            offered = it in offered,
            applies = it !in inapplicable,
        )
    }

    // ─── 1. an unfinished card must not close itself ────────────────

    @Test
    fun `the card G65 lost does not close itself any more`() {
        // THE FIELD REPORT, exactly: every required grant held, both
        // advanced rows untouched. Before v1.1.12 this armed a 12-second
        // fuse; on a D-pad that is not long enough to read the card, arrow
        // down past four granted rows and press OK.
        val model = SetupCeremonyMath.buildModel(fleet(satisfied = core.toSet()))

        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(2, model.optionalOutstanding)
        assertNull(
            "a card with optional work still on it must never self-destruct — the idle " +
                "stand-down (10 min, reset by every interaction) is what bounds it now",
            SetupCeremonyMath.autoDismissMs(model),
        )
    }

    @Test
    fun `one outstanding optional row is enough to hold the card open`() {
        val model = SetupCeremonyMath.buildModel(
            fleet(satisfied = core.toSet() + "deviceAdminPromptShown"),
        )
        assertEquals(1, model.optionalOutstanding)
        assertNull(SetupCeremonyMath.autoDismissMs(model))
    }

    // ─── 2. a genuinely finished card still clears itself ───────────

    @Test
    fun `nothing outstanding at all still clears in four seconds`() {
        // THE ADB-PROVISIONED PANEL. Nothing to read, nothing to do — a card
        // that camped here would be a full-screen panel over a customer's
        // board on every boot of a healthy fleet.
        val model = SetupCeremonyMath.buildModel(
            fleet(satisfied = (core + advanced).toSet()),
        )
        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(0, model.optionalOutstanding)
        assertEquals(
            SetupCeremonyMath.COMPLETE_LINGER_MS,
            SetupCeremonyMath.autoDismissMs(model),
        )
    }

    @Test
    fun `a box with no advanced rows at all keeps the old four-second card`() {
        // The no-regression half: a panel where the optional steps do not
        // apply behaves byte-for-byte as it did before v1.1.12.
        val model = SetupCeremonyMath.buildModel(
            fleet(satisfied = core.toSet(), inapplicable = advanced.toSet()),
        )
        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(0, model.optionalOutstanding)
        assertEquals(
            SetupCeremonyMath.COMPLETE_LINGER_MS,
            SetupCeremonyMath.autoDismissMs(model),
        )
    }

    // ─── 3. every other card is unchanged ───────────────────────────

    @Test
    fun `a card with work still armed has never had a fuse and still has none`() {
        val granting = SetupCeremonyMath.buildModel(fleet())
        assertEquals(ChecklistMode.GRANTING, granting.mode)
        assertNull(SetupCeremonyMath.autoDismissMs(granting))
    }

    @Test
    fun `a paused card has no fuse either`() {
        val paused = SetupCeremonyMath.buildModel(
            fleet(satisfied = setOf("installPromptShown"), offered = core.toSet()),
        )
        assertEquals(ChecklistMode.PAUSED, paused.mode)
        assertNull(SetupCeremonyMath.autoDismissMs(paused))
    }

    @Test
    fun `the post-upgrade offer card is not governed by this fuse`() {
        // The 30-second offer owns its own countdown (SetupCeremony's
        // offerTick) and renders as GRANTING. If it ever started getting a
        // fuse from here it would have two, and the shorter one would win
        // invisibly.
        val offer = SetupCeremonyMath.buildModel(
            listOf(input("overlayPromptShown", optional = false)),
            headingOverride = SetupCeremonyMath.HEADING_AFTER_UPDATE,
            footnoteOverride = SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE,
            countdown = SetupCeremonyMath.countdownLine(30),
        )
        assertEquals(ChecklistMode.GRANTING, offer.mode)
        assertNull(SetupCeremonyMath.autoDismissMs(offer))
    }

    // ─── 4. the answer is a function of STATE, never of how often we ask ──

    @Test
    fun `asking repeatedly never changes the answer`() {
        // The guard tick and every resume re-evaluate this. A latch that
        // fired "once" would make a card's lifetime depend on how many times
        // the operator walked back from Settings — the class of bug that
        // keys on call counts instead of state.
        val open = SetupCeremonyMath.buildModel(fleet(satisfied = core.toSet()))
        val done = SetupCeremonyMath.buildModel(fleet(satisfied = (core + advanced).toSet()))
        repeat(10) {
            assertNull(SetupCeremonyMath.autoDismissMs(open))
            assertEquals(
                SetupCeremonyMath.COMPLETE_LINGER_MS,
                SetupCeremonyMath.autoDismissMs(done),
            )
        }
    }

    @Test
    fun `an empty checklist is finished, and clears itself`() {
        val model = SetupCeremonyMath.buildModel(emptyList())
        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(
            SetupCeremonyMath.COMPLETE_LINGER_MS,
            SetupCeremonyMath.autoDismissMs(model),
        )
    }
}
