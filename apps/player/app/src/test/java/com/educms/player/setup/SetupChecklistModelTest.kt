package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.ChecklistInput
import com.educms.player.setup.SetupCeremonyMath.ChecklistMode
import com.educms.player.setup.SetupCeremonyMath.RowStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The v2 checklist shell (2026-08-25).
 *
 * `SetupCeremonyMathTest` pins the SEQUENCE (nag vs stall); this pins the
 * SCREEN built on top of it. The cases that matter in the field, and the
 * ones a future agent is most likely to break:
 *
 *   ADB-PROVISIONED — an installer that pre-granted everything must see
 *   NOTHING. The model has to come back COMPLETE with no primary button,
 *   because that is the state `SetupCeremony.render` reads to decide it
 *   may stay silent. Get this wrong and a healthy fleet grows a
 *   full-screen setup panel over its signage on every boot.
 *
 *   HALF-DONE IS NOT DONE — every step offered but some declined must
 *   read PAUSED, never "Setup complete ✓". Saying "done" over a panel
 *   with no brightness control is how a screen ships broken and nobody
 *   finds out until a site visit.
 *
 *   THE ARMED ROW carries the "can't find it?" directions and nothing
 *   else does — six Settings paths at once is wallpaper nobody reads.
 */
class SetupChecklistModelTest {

    /** The six real steps, in the real order, so the copy is exercised too. */
    private val keys = listOf(
        "installPromptShown",
        "managerInstallPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "deviceAdminPromptShown",
        "homeSetupPromptShown",
    )

    private fun input(
        key: String,
        applies: Boolean = true,
        satisfied: Boolean = false,
        offered: Boolean = false,
        note: String? = null,
    ) = ChecklistInput(
        state = StepState(key, applies, satisfied, offered),
        name = "name-$key",
        why = "why-$key",
        hint = "hint-$key",
        note = note,
    )

    private fun fleet(
        satisfied: Set<String> = emptySet(),
        offered: Set<String> = emptySet(),
        inapplicable: Set<String> = emptySet(),
        notes: Map<String, String> = emptyMap(),
    ) = keys.map {
        input(
            it,
            applies = it !in inapplicable,
            satisfied = it in satisfied,
            offered = it in offered,
            note = notes[it],
        )
    }

    @Test
    fun `a fresh panel arms the first step and counts nothing done`() {
        val model = SetupCeremonyMath.buildModel(fleet())

        assertEquals(ChecklistMode.GRANTING, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_GRANTING, model.heading)
        assertEquals("0 of 6 done", model.progress)
        assertEquals(6, model.rows.size)
        assertEquals(RowStatus.CURRENT, model.rows[0].status)
        assertTrue(model.rows.drop(1).all { it.status == RowStatus.NEEDED })
        assertEquals("installPromptShown", model.primaryKey)
        assertEquals("Grant next: name-installPromptShown", model.primaryLabel)
        assertEquals("Not now", model.secondaryLabel)
    }

    @Test
    fun `an adb-provisioned panel is COMPLETE with nothing armed`() {
        // THE zero-UI case. Every grant already held, no marker ever
        // written — a null `primaryKey` (i.e. `nextKey` found nothing) is
        // what `SetupCeremony.render` reads to decide it must put nothing
        // on screen at all.
        val model = SetupCeremonyMath.buildModel(fleet(satisfied = keys.toSet()))

        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_COMPLETE, model.heading)
        assertEquals("6 of 6 done", model.progress)
        assertTrue(model.rows.all { it.status == RowStatus.GRANTED })
        assertNull(model.primaryKey)
        assertNull(model.secondaryLabel)
        // ⚠️ v1.1.12 — but when this card IS on screen (the re-open path,
        // or a screen watching its last grant land) it carries a real
        // button. A card with no button gives focus nothing to park on, and
        // on a remote-only panel that is the difference between "operable"
        // and "sits there" — field report G65-B.
        assertEquals(SetupCeremonyMath.PRIMARY_DONE, model.primaryLabel)
        // Nothing on a fully granted screen invites a tap.
        assertTrue(model.rows.none { it.actionable })
    }

    @Test
    fun `a held grant is skipped even when it was never offered`() {
        // Live state beats the pref — the rule the whole ceremony rests
        // on, seen through the screen the operator actually reads.
        val model = SetupCeremonyMath.buildModel(
            fleet(satisfied = setOf("installPromptShown", "managerInstallPromptShown")),
        )

        assertEquals("writeSettingsPromptShown", model.primaryKey)
        assertEquals("2 of 6 done", model.progress)
        assertEquals(RowStatus.GRANTED, model.rows[0].status)
        assertEquals(RowStatus.CURRENT, model.rows[2].status)
    }

    @Test
    fun `everything offered but not everything granted reads PAUSED, never complete`() {
        // HALF-DONE IS NOT DONE.
        val model = SetupCeremonyMath.buildModel(
            fleet(
                satisfied = setOf("installPromptShown", "writeSettingsPromptShown"),
                offered = keys.toSet(),
            ),
        )

        assertEquals(ChecklistMode.PAUSED, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_PAUSED, model.heading)
        assertEquals("2 of 6 done", model.progress)
        // Nothing is armed, so the big button just closes the screen…
        assertNull(model.primaryKey)
        assertEquals("Done", model.primaryLabel)
        assertNull(model.secondaryLabel)
        // …but every missing grant is still one tap away. That is the
        // difference between a checklist and a nag: the operator can
        // finish any row whenever they like, and nothing re-asks.
        assertEquals(4, model.rows.count { it.actionable })
        assertTrue(model.rows.none { it.status == RowStatus.CURRENT })
    }

    @Test
    fun `a declined step stays visible and tappable without blocking the next one`() {
        val model = SetupCeremonyMath.buildModel(fleet(offered = setOf("installPromptShown")))

        assertEquals("managerInstallPromptShown", model.primaryKey)
        val declined = model.rows.first { it.key == "installPromptShown" }
        assertEquals(RowStatus.NEEDED, declined.status)
        assertTrue(declined.actionable)
    }

    @Test
    fun `only the armed row carries the can't-find-it directions`() {
        val model = SetupCeremonyMath.buildModel(fleet())

        assertEquals("hint-installPromptShown", model.rows[0].hint)
        assertTrue(model.rows.drop(1).all { it.hint == null })
        assertEquals(1, model.rows.count { it.hint != null })
    }

    @Test
    fun `a step that does not apply to this box is neither shown nor counted`() {
        // The real shape: no Manager companion installed, and a device
        // owner already pinning HOME.
        val model = SetupCeremonyMath.buildModel(
            fleet(
                satisfied = setOf("installPromptShown"),
                inapplicable = setOf("managerInstallPromptShown", "homeSetupPromptShown"),
            ),
        )

        assertEquals(4, model.rows.size)
        assertTrue(model.rows.none { it.key == "managerInstallPromptShown" })
        assertTrue(model.rows.none { it.key == "homeSetupPromptShown" })
        // "1 of 4" — never "1 of 6" for a box that will only ever see four.
        assertEquals("1 of 4 done", model.progress)
        assertEquals("writeSettingsPromptShown", model.primaryKey)
    }

    @Test
    fun `a box where every applicable step is held is COMPLETE even with steps that do not apply`() {
        val model = SetupCeremonyMath.buildModel(
            fleet(
                satisfied = keys.toSet() - "managerInstallPromptShown",
                inapplicable = setOf("managerInstallPromptShown"),
            ),
        )

        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals("5 of 5 done", model.progress)
    }

    @Test
    fun `the launch note rides its own row and nothing else`() {
        // The vendor-lost case: the direct page did not exist, we opened
        // the broader one, and the row has to say so — on that row only.
        val note = "This panel hides the direct page — opening Apps settings."
        val model = SetupCeremonyMath.buildModel(
            fleet(notes = mapOf("installPromptShown" to note)),
        )

        assertEquals(note, model.rows[0].note)
        assertTrue(model.rows.drop(1).all { it.note == null })
    }

    @Test
    fun `every row carries the why, and a granted row reports itself granted`() {
        val model = SetupCeremonyMath.buildModel(fleet(satisfied = setOf("installPromptShown")))

        assertTrue(model.rows.all { it.why == "why-${it.key}" })
        assertTrue(model.rows.all { it.name == "name-${it.key}" })
        assertFalse(model.rows.first { it.key == "installPromptShown" }.actionable)
    }

    @Test
    fun `walking the whole sequence lands on complete, one row at a time`() {
        // The field flow: arm a row, grant it, come back, arm the next.
        // Six passes, then the screen says it is done — and says it only
        // because every grant is actually held.
        val granted = mutableSetOf<String>()
        val offered = mutableSetOf<String>()
        val visited = mutableListOf<String>()

        repeat(20) {
            val model = SetupCeremonyMath.buildModel(fleet(granted, offered))
            val armed = model.primaryKey ?: return@repeat
            visited += armed
            offered += armed
            granted += armed // the operator grants it in Settings and returns
        }

        assertEquals(keys, visited)
        val done = SetupCeremonyMath.buildModel(fleet(granted, offered))
        assertEquals(ChecklistMode.COMPLETE, done.mode)
        assertEquals("6 of 6 done", done.progress)
    }

    @Test
    fun `an empty step list is complete, not a crash`() {
        val model = SetupCeremonyMath.buildModel(emptyList())

        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals("0 of 0 done", model.progress)
        assertTrue(model.rows.isEmpty())
        assertNull(model.primaryKey)
        // Even with no rows at all there is something to press — every mode
        // owes a remote a reachable control (v1.1.12).
        assertEquals(SetupCeremonyMath.PRIMARY_DONE, model.primaryLabel)
    }
}
