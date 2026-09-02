package com.educms.player.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE PER-HARDWARE-CLASS SETUP RULE (2026-09-02, player 1.1.15).
 *
 * Two claims are pinned here and they are equally load-bearing:
 *
 *  1. A NOVASTAR POSTER ASKS FOR NOTHING. Every step is not-applicable, so
 *     the checklist is complete on first launch and no Android system page
 *     is ever raised — on a controller that draws those pages centred in a
 *     1920 px frame buffer while the LED shows a 320 px column, an
 *     unanswerable dialog is the whole defect.
 *  2. EVERY OTHER BOX IS BYTE-FOR-BYTE UNCHANGED. The generic cases below
 *     are deliberately the same shapes `SetupCeremonyMathTest` already
 *     covers, re-asserted through the new code path: if the hardware rule
 *     ever leaks into a Goodview / TCL / Pi / LCD panel, this goes red
 *     before a fleet does.
 *
 * The source-parse tests at the end are the call-site guard — the
 * "112 green tests, no caller" shape. A rule nothing consults is worth
 * nothing, and this one has three separate consumers.
 */
class SetupHardwarePolicyTest {

    /** The real step keys, in ceremony order. */
    private val realKeys = listOf(
        SetupCeremonyMath.STEP_INSTALL_UNKNOWN,
        SetupCeremonyMath.STEP_MANAGER_INSTALL,
        SetupCeremonyMath.STEP_WRITE_SETTINGS,
        SetupCeremonyMath.STEP_BATTERY_EXEMPT,
        SetupCeremonyMath.STEP_DEVICE_ADMIN,
        SetupCeremonyMath.STEP_OVERLAY,
        SetupCeremonyMath.STEP_HOME,
    )

    /** Which of those are ADVANCED (never armed, never counted). */
    private val optionalKeys = setOf(
        SetupCeremonyMath.STEP_MANAGER_INSTALL,
        SetupCeremonyMath.STEP_DEVICE_ADMIN,
    )

    /**
     * The ceremony's own `inputs()` shape, reproduced over the pure rule:
     * a step applies when the hardware class has no objection AND the
     * device-level `appliesTo` says yes. Here every `appliesTo` is true,
     * which is the state of a modern box with the companion installed.
     */
    private fun statesFor(hardware: SetupCeremonyMath.HardwareClass): List<StepState> =
        realKeys.map { key ->
            val reason = SetupCeremonyMath.notApplicableReason(hardware, key)
            StepState(
                key = key,
                applies = reason == null,
                satisfied = false,
                offered = false,
                optional = key in optionalKeys,
                notApplicableReason = reason,
            )
        }

    // ── 1. the poster asks for nothing ───────────────────────────────────

    @Test
    fun `a NovaStar poster has ZERO applicable steps`() {
        val states = statesFor(SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER)
        assertTrue(
            "a poster must not have a single applicable grant",
            SetupCeremonyMath.applicable(states).isEmpty(),
        )
        assertNull(
            "nothing may be armed on a poster — an armed step is a system page nobody can see",
            SetupCeremonyMath.nextKey(states),
        )
        assertTrue(SetupCeremonyMath.isComplete(states))
        assertEquals(0 to 0, SetupCeremonyMath.progress(states))
    }

    @Test
    fun `the poster checklist is COMPLETE with nothing outstanding, so nothing is put on glass`() {
        // This is the state `SetupCeremony.render` reads: `nextKey == null`
        // with nothing already up and no forced open returns immediately —
        // zero UI. The model is asserted too, because the completion CARD
        // (were it ever forced open by the re-entry gesture) must not claim
        // outstanding optional work that does not exist here.
        val model = SetupCeremonyMath.buildModel(
            statesFor(SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER).map {
                SetupCeremonyMath.ChecklistInput(it, name = it.key, why = "", hint = "")
            },
        )
        assertEquals(SetupCeremonyMath.ChecklistMode.COMPLETE, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_COMPLETE, model.heading)
        assertTrue(model.rows.isEmpty())
        assertTrue(model.optionalRows.isEmpty())
        assertEquals(0, model.optionalOutstanding)
        assertEquals(
            SetupCeremonyMath.COMPLETE_LINGER_MS as Long?,
            SetupCeremonyMath.autoDismissMs(model),
        )
    }

    @Test
    fun `every real step carries an EXPLICIT poster reason, not the backstop`() {
        // The default exists so a step added tomorrow cannot raise a dialog
        // on an LED column. It must never be the SHIPPED answer, because a
        // reason a person cannot check is not a reason.
        for (key in realKeys) {
            val reason = SetupCeremonyMath.notApplicableReason(
                SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER,
                key,
            )
            assertNotNull("no poster reason for $key", reason)
            assertTrue(
                "$key falls back to the generic reason — give it an explicit row",
                reason != SetupCeremonyMath.NOVASTAR_POSTER_DEFAULT_REASON,
            )
            assertTrue(
                "a poster reason must name the hardware class: $reason",
                reason!!.startsWith("novastar-taurus:"),
            )
        }
    }

    @Test
    fun `an unknown step defaults to NOT ASKED on a poster`() {
        assertEquals(
            SetupCeremonyMath.NOVASTAR_POSTER_DEFAULT_REASON,
            SetupCeremonyMath.notApplicableReason(
                SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER,
                "somethingAddedNextYear",
            ),
        )
    }

    @Test
    fun `the two reasons the brief names are stated verbatim`() {
        // Quoted in the 1.1.15 brief and read by an operator in
        // `screen_device_inventory`. Reworded copy is fine; SILENTLY
        // reworded copy is how a fleet report stops matching the doc.
        assertEquals(
            "novastar-taurus: brightness/power are NovaStar-layer",
            SetupCeremonyMath.notApplicableReason(
                SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER,
                SetupCeremonyMath.STEP_WRITE_SETTINGS,
            ),
        )
        assertEquals(
            "novastar-taurus: launcher is NovaStar's",
            SetupCeremonyMath.notApplicableReason(
                SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER,
                SetupCeremonyMath.STEP_HOME,
            ),
        )
    }

    // ── 2. every other box is unchanged ──────────────────────────────────

    @Test
    fun `a NovaStar poster never bootstraps the Manager companion — the gate 1_1_15 missed`() {
        val why = SetupCeremonyMath.companionBootstrapRefusal(SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER)
        assertNotNull("LED Poster 3 sat behind the companion gate with a mouse and nothing on the LED to click", why)
        assertTrue(why!!.startsWith("novastar-taurus: "))
        assertTrue(why.contains("ViPlex"))
    }

    @Test
    fun `GENERIC hardware bootstraps the companion exactly as before`() {
        assertNull(SetupCeremonyMath.companionBootstrapRefusal(SetupCeremonyMath.HardwareClass.GENERIC))
    }

    @Test
    fun `GENERIC hardware objects to nothing`() {
        for (key in realKeys + listOf("anythingAtAll")) {
            assertNull(
                "the hardware rule leaked onto a generic box at $key",
                SetupCeremonyMath.notApplicableReason(
                    SetupCeremonyMath.HardwareClass.GENERIC,
                    key,
                ),
            )
        }
    }

    @Test
    fun `a generic box still arms the first step and counts five core grants`() {
        val states = statesFor(SetupCeremonyMath.HardwareClass.GENERIC)
        assertEquals(7, SetupCeremonyMath.applicable(states).size)
        assertEquals(SetupCeremonyMath.STEP_INSTALL_UNKNOWN, SetupCeremonyMath.nextKey(states))
        // 5 core + 2 advanced — the v1.1.5 shape, unchanged.
        assertEquals(0 to 5, SetupCeremonyMath.progress(states))
        assertEquals(2, SetupCeremonyMath.optional(states).size)
        assertFalse(SetupCeremonyMath.isComplete(states))
    }

    // ── 3. the HOME role is refused, not merely unasked ──────────────────

    @Test
    fun `the HOME role is refused on a poster and allowed everywhere else`() {
        assertNull(SetupCeremonyMath.homeRoleRefusal(SetupCeremonyMath.HardwareClass.GENERIC))
        val why = SetupCeremonyMath.homeRoleRefusal(
            SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER,
        )
        assertNotNull("a poster must refuse the HOME role outright", why)
        assertTrue(why!!.contains("NovaStar"))
    }

    // ── 4. the post-upgrade relaunch offer respects applicability ────────

    @Test
    fun `the relaunch-grant offer is never made for a step that does not apply`() {
        val base = SetupCeremonyMath.RelaunchGrantFacts(
            lastHandledVc = 10_114L,
            currentVc = 10_115L,
            previouslyProvisioned = true,
            overlayGranted = false,
            isHomeApp = false,
            declinedVc = 0L,
        )
        // Default is `true`, so an existing caller decides exactly what it
        // decided before this field existed.
        assertTrue(SetupCeremonyMath.shouldOfferRelaunchGrant(base))
        assertFalse(
            "a poster (or a ROM with no overlay page) must not be asked",
            SetupCeremonyMath.shouldOfferRelaunchGrant(base.copy(overlayStepApplies = false)),
        )
    }

    // ── 5. the call-site guard ───────────────────────────────────────────

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun require(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `the ceremony consults the hardware rule when it builds its steps`() {
        val src = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        assertTrue(
            "SetupCeremony.inputs() no longer applies the hardware rule — a poster would be " +
                "walked through Android system pages it cannot display",
            src.contains("SetupCeremonyMath.notApplicableReason("),
        )
        assertTrue(
            "the capability report must carry WHY a step does not apply",
            src.contains("\"reason\""),
        )
    }

    @Test
    fun `both KioskHomeAlias callers refuse the HOME role by hardware class`() {
        // TWO callers, and the guard has to be on both: SetupCeremony's HOME
        // step enables the alias before opening the chooser, and PlayerApp
        // enables it on EVERY process start whenever the Manager companion
        // is device owner — a guard in the ceremony alone would not hold.
        assertTrue(
            "SetupCeremony.enableKioskHomeAlias does not check homeRoleRefusal",
            require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
                .contains("homeRoleRefusal("),
        )
        assertTrue(
            "PlayerApp.maybeEnableKioskHomeAlias does not check homeRoleRefusal",
            require("src/main/java/com/educms/player/PlayerApp.kt")
                .contains("homeRoleRefusal("),
        )
    }

    @Test
    fun `every step key in the ceremony has a row in the poster table`() {
        // Parses the REAL prefKeys out of SetupCeremony's STEPS list, so a
        // step added without a poster row fails here instead of silently
        // raising an invisible dialog on an LED column.
        val src = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        val keys = Regex("prefKey\\s*=\\s*\"([^\"]+)\"")
            .findAll(src)
            .map { it.groupValues[1] }
            .toList()
        assertTrue("no prefKeys parsed — the STEPS list moved", keys.size >= 7)
        assertEquals(
            "SetupCeremony's step keys have drifted from this test's list",
            realKeys.toSet(),
            keys.toSet(),
        )
    }
}
