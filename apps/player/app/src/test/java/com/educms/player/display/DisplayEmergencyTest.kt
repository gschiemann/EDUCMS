package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️ THE LIFE-SAFETY INTERLOCK.
 *
 * VenueOS screens show lockdown / evacuation / weather alerts. The
 * blackout overlay the display layer uses is added ABOVE the WebView, so
 * a blanked screen renders an opaque black rectangle over the alert.
 * Before the 2026-08-13 fix nothing in `com.educms.player.display`
 * consulted emergency state at all, and a hallway screen blanked by its
 * 22:00 schedule stayed black through a 02:14 lockdown.
 *
 * These tests pin the refusal rules. They run on a plain JVM because
 * [DisplayEmergency.refusalReasonFor] is deliberately pure — a
 * safety rule whose test can be skipped for want of an emulator is not
 * a safety rule.
 *
 * The refusal is enforced at [DisplayControlRegistry.apply], the single
 * entry point the JS bridge, the on-device scheduler AND the dead-man
 * revert all funnel through, so these rules bind all three.
 */
class DisplayEmergencyTest {

    private fun refuse(action: DisplayAction, currentPercent: Int = 100) =
        DisplayEmergency.refusalReasonFor(held = true, currentPercent = currentPercent, action = action)

    private fun allow(action: DisplayAction, currentPercent: Int = 100) =
        DisplayEmergency.refusalReasonFor(held = false, currentPercent = currentPercent, action = action)

    // ─── nothing is refused when there is no emergency ───────────────

    @Test
    fun `with no hold every action passes untouched`() {
        listOf(
            DisplayAction.Blank,
            DisplayAction.Wake,
            DisplayAction.Reboot,
            DisplayAction.SetBrightness(0, allowBlack = true),
            DisplayAction.SetBrightness(5),
            DisplayAction.SetVolume(0),
        ).forEach { action ->
            assertNull("must not be refused without a hold: ${action.describe()}", allow(action))
        }
    }

    // ─── the refusals ────────────────────────────────────────────────

    @Test
    fun `BLANK is refused while an alert is active`() {
        // This is THE bug: a scheduled 22-00 blank, or a remote
        // {"action":"BLANK"}, covering a live lockdown alert.
        val why = refuse(DisplayAction.Blank)
        assertNotNull("BLANK must be refused during an emergency", why)
        assertTrue(why!!.contains("BLANK"))
    }

    @Test
    fun `REBOOT is refused while an alert is active`() {
        // A reboot takes the panel dark for the ~60 s it takes to come
        // back — through the alert.
        assertNotNull(refuse(DisplayAction.Reboot))
    }

    @Test
    fun `every brightness-LOWERING action is refused`() {
        // The hold drives the panel to 100 and mirrors it, so during a
        // hold anything below full is a lowering.
        listOf(0, 1, 5, 20, 50, 99).forEach { percent ->
            assertNotNull(
                "lowering to $percent%% must be refused",
                refuse(DisplayAction.SetBrightness(percent), currentPercent = 100),
            )
        }
    }

    @Test
    fun `allowBlack is refused even when it would not lower the value`() {
        // allowBlack is the flag that lets a request through the
        // MIN_SAFE floor. During an alert it has no legitimate use.
        assertNotNull(refuse(DisplayAction.SetBrightness(100, allowBlack = true), currentPercent = 100))
        assertNotNull(refuse(DisplayAction.SetBrightness(0, allowBlack = true), currentPercent = 0))
    }

    // ─── what must STILL be allowed (fail-open for recovery) ─────────

    @Test
    fun `WAKE is never refused`() {
        // Waking can only ever make the alert more visible. Refusing it
        // would be the worst possible outcome — a dark screen with no
        // way back.
        assertNull(refuse(DisplayAction.Wake))
    }

    @Test
    fun `raising or holding brightness is allowed`() {
        assertNull(refuse(DisplayAction.SetBrightness(100), currentPercent = 100))
        assertNull(refuse(DisplayAction.SetBrightness(100), currentPercent = 20))
        assertNull(refuse(DisplayAction.SetBrightness(60), currentPercent = 20))
    }

    @Test
    fun `the enforce path's own actions are not refused by its own gate`() {
        // enforceNow() persists the hold FIRST and then drives the panel,
        // so its own Wake + SetBrightness(100) run WITH the hold active
        // and must pass. If they did not, engaging a hold would be a
        // no-op and the alert would stay hidden.
        listOf(0, 5, 20, 80, 100).forEach { current ->
            assertNull(
                "enforce Wake must pass at current=$current",
                refuse(DisplayAction.Wake, currentPercent = current),
            )
            assertNull(
                "enforce SetBrightness(100) must pass at current=$current",
                refuse(DisplayAction.SetBrightness(100), currentPercent = current),
            )
        }
    }

    @Test
    fun `volume is never refused`() {
        // Audio can only make an alert MORE perceivable, and muting a
        // screen does not hide the alert on it.
        listOf(0, 50, 100).forEach { assertNull(refuse(DisplayAction.SetVolume(it))) }
    }

    // ─── the dead-man revert path is bound by the same rule ──────────

    @Test
    fun `a dead-man revert that would re-blank the screen is refused`() {
        // The guard restores whatever the screen was BEFORE an operator
        // test. If it was blanked, the restore is a Blank — which during
        // an alert must not land. The record goes through
        // DisplayControlRegistry.apply like everything else, so the same
        // predicate governs it.
        val record = PendingRevert(Capability.BLANK, 100, priorBlanked = true, dueAtEpochMs = 1L)
        val actions = record.revertActions()
        assertEquals(listOf(DisplayAction.Blank), actions)
        actions.forEach { assertNotNull("the revert's Blank must be refused", refuse(it)) }
    }

    @Test
    fun `a dead-man revert that restores a dim level is refused, its wake is not`() {
        val record = PendingRevert(
            Capability.BRIGHTNESS,
            priorPercent = 20,
            priorBlanked = false,
            dueAtEpochMs = 1L,
            ownsBlankState = true,
        )
        val actions = record.revertActions()
        assertEquals(
            listOf(DisplayAction.SetBrightness(20, allowBlack = true), DisplayAction.Wake),
            actions,
        )
        // The brightness restore carries allowBlack (it is restoring a
        // state the screen was already in) → refused during an alert.
        assertNotNull(refuse(actions[0]))
        // The wake is recovery-direction → allowed.
        assertNull(refuse(actions[1]))
    }

    // ─── the scheduler path ─────────────────────────────────────────

    @Test
    fun `a scheduled off-window is refused but a scheduled on-window is not`() {
        // DisplayScheduler.applyDesiredNow emits Wake for "on" and Blank
        // for "off". Only the off direction is suppressed, and the
        // release path re-runs armAndApply so the window is
        // re-evaluated rather than skipped until tomorrow.
        assertNotNull(refuse(DisplayAction.Blank))
        assertNull(refuse(DisplayAction.Wake))
    }

    // ─── the untrusted-transport allowlist (same shape, one rule) ────

    @Test
    fun `releasing the hold is a RECOVERY-direction action, so it must be reachable everywhere`() {
        // ⚠️ THE 2026-08-14 REVERSAL. `setHold(false)` used to be refused
        // on the legacy every-frame transport as a "risk-direction
        // mutation". On a Chromium 83-87 NovaStar Taurus — in the pilot
        // fleet, CLAUDE.md rule 10 — NativeBridgeChannel cannot attach at
        // all, so EVERY call including the all-clear arrives untrusted:
        // the first alert engaged a hold nothing could ever lift, and the
        // screen was pinned lit with all display control dead and no
        // operator recovery.
        //
        // The reason it is safe is asserted right here rather than in a
        // comment: on that same transport every DARKENING action is still
        // refused, so a hostile board that clears a hold unlocks nothing
        // it can then use. The pair of assertions below is the whole
        // argument — if a future change ever admits a darkening action on
        // the untrusted transport, THIS test is the one that must go red
        // before the release gate can be reconsidered.
        listOf(
            DisplayAction.Blank,
            DisplayAction.Reboot,
            DisplayAction.SetBrightness(0),
            DisplayAction.SetBrightness(49),
            DisplayAction.SetBrightness(100, allowBlack = true),
            DisplayAction.SetVolume(0),
        ).forEach { action ->
            assertFalse(
                "a hostile board must not reach ${action.describe()} — this is what makes " +
                    "admitting the hold RELEASE on the same transport safe",
                DisplayControlApi.isRecoveryAction(50, action),
            )
        }
    }

    @Test
    fun `the untrusted transport admits only recovery-direction actions`() {
        // The legacy addJavascriptInterface object is materialised in
        // EVERY frame the WebView loads, including operator-authored
        // board HTML. A hostile board must not be able to blank a
        // hallway screen — but it must also never be able to lock out
        // the recovery path.
        assertTrue(DisplayControlApi.isRecoveryAction(50, DisplayAction.Wake))
        assertTrue(DisplayControlApi.isRecoveryAction(50, DisplayAction.SetBrightness(50)))
        assertTrue(DisplayControlApi.isRecoveryAction(50, DisplayAction.SetBrightness(100)))

        assertFalse(DisplayControlApi.isRecoveryAction(50, DisplayAction.Blank))
        assertFalse(DisplayControlApi.isRecoveryAction(50, DisplayAction.Reboot))
        assertFalse(DisplayControlApi.isRecoveryAction(50, DisplayAction.SetBrightness(49)))
        assertFalse(DisplayControlApi.isRecoveryAction(50, DisplayAction.SetBrightness(0)))
        assertFalse(
            "allowBlack is never recovery-direction",
            DisplayControlApi.isRecoveryAction(50, DisplayAction.SetBrightness(100, allowBlack = true)),
        )
        assertFalse(DisplayControlApi.isRecoveryAction(50, DisplayAction.SetVolume(0)))
    }
}
