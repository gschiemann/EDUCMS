package com.educms.player.wake

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE WAKE → GLASS RULES (2026-10-11). Every rule in [WakePolicy]'s header,
 * on a virtual clock. The sequence this pins is the one that replaces
 * "poke the panel and hope": the panel must be on, nothing of a person's
 * may be in front, and the existing Activity is brought forward at most
 * twice per wake.
 */
class WakePolicyTest {

    private fun facts(
        interactive: Boolean? = true,
        foreground: Boolean = false,
        standbyActive: Boolean = false,
        emergencyHeld: Boolean = false,
        installPromptOutstanding: Boolean = false,
        setupYield: Boolean = false,
        launchesThisWake: Int = 0,
        lastLaunchAtMs: Long = 0L,
        nowMs: Long = 100_000L,
        lastCheck: Boolean = false,
    ) = WakePolicy.Facts(
        interactive, foreground, standbyActive, emergencyHeld, installPromptOutstanding, setupYield,
        launchesThisWake, lastLaunchAtMs, nowMs, lastCheck,
    )

    @Test
    fun `a resumed MainActivity ends the sequence whatever else is true`() {
        assertEquals(
            WakePolicy.Step.DONE_ON_GLASS,
            WakePolicy.step(facts(foreground = true, interactive = false, standbyActive = true, launchesThisWake = 9)),
        )
    }

    @Test
    fun `the panel is on and the player is not in front — launch, at most twice, then report`() {
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(launchesThisWake = 0)))
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(launchesThisWake = 1)))
        assertEquals(WakePolicy.Step.WAIT, WakePolicy.step(facts(launchesThisWake = 2)))
        assertEquals(WakePolicy.Step.STOP_BUDGET, WakePolicy.step(facts(launchesThisWake = 2, lastCheck = true)))
        assertEquals(2, WakePolicy.MAX_LAUNCHES_PER_WAKE)
    }

    @Test
    fun `never a launch into a dark panel — wait for the screen-on, then give up quietly`() {
        assertEquals(WakePolicy.Step.WAIT, WakePolicy.step(facts(interactive = false)))
        assertEquals(WakePolicy.Step.WAIT, WakePolicy.step(facts(interactive = null)))
        assertEquals(WakePolicy.Step.STOP_PANEL_DARK, WakePolicy.step(facts(interactive = false, lastCheck = true)))
        assertEquals(WakePolicy.Step.STOP_PANEL_DARK, WakePolicy.step(facts(interactive = null, lastCheck = true)))
    }

    @Test
    fun `a person's standby stops it outright — unless an alert is held, which already ended the standby`() {
        assertEquals(WakePolicy.Step.STOP_STANDBY, WakePolicy.step(facts(standbyActive = true)))
        assertEquals(WakePolicy.Step.STOP_STANDBY, WakePolicy.step(facts(standbyActive = true, interactive = false)))
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(standbyActive = true, emergencyHeld = true)))
    }

    @Test
    fun `a person in front outranks the launch — an install confirmation or a setup Settings trip`() {
        assertEquals(WakePolicy.Step.STOP_INSTALL_PROMPT, WakePolicy.step(facts(installPromptOutstanding = true)))
        assertEquals(WakePolicy.Step.STOP_SETUP, WakePolicy.step(facts(setupYield = true)))
        // The install prompt is checked before the panel state: it is a
        // stronger fact than "dark".
        assertEquals(WakePolicy.Step.STOP_INSTALL_PROMPT, WakePolicy.step(facts(installPromptOutstanding = true, interactive = false)))
    }

    @Test
    fun `the rate window spans wakes — a second wake inside a minute of a launch does not launch again`() {
        val now = 100_000L
        assertEquals(WakePolicy.Step.WAIT, WakePolicy.step(facts(lastLaunchAtMs = now - 10_000L, nowMs = now)))
        assertEquals(WakePolicy.Step.STOP_BUDGET, WakePolicy.step(facts(lastLaunchAtMs = now - 10_000L, nowMs = now, lastCheck = true)))
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(lastLaunchAtMs = now - WakePolicy.LAUNCH_RATE_WINDOW_MS, nowMs = now)))
        // A backwards clock never blocks a launch.
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(lastLaunchAtMs = now + 5_000L, nowMs = now)))
        // The window gates only the FIRST launch of a wake; the per-wake
        // budget governs the second.
        assertEquals(WakePolicy.Step.LAUNCH, WakePolicy.step(facts(launchesThisWake = 1, lastLaunchAtMs = now - 2_000L, nowMs = now)))
    }

    @Test
    fun `a wake asked for while the player is already on the glass is a no-op — a command still reports, the alert's re-assert stays quiet`() {
        assertTrue(WakePolicy.alreadyOnGlass(interactive = true, foreground = true))
        assertFalse(WakePolicy.alreadyOnGlass(interactive = false, foreground = true))
        assertFalse(WakePolicy.alreadyOnGlass(interactive = null, foreground = true))
        assertFalse(WakePolicy.alreadyOnGlass(interactive = true, foreground = false))
        for (source in listOf("dead-man-revert", "command", "power-on", "schedule-on", "standby-end", "screen-on")) {
            assertTrue(source, WakePolicy.promptWhenAlreadyOnGlass(source))
        }
        assertFalse(WakePolicy.promptWhenAlreadyOnGlass("emergency"))
    }

    @Test
    fun `the checks are early and few`() {
        assertTrue(WakePolicy.CHECK_DELAYS_MS.contentEquals(longArrayOf(1_000L, 3_000L, 6_000L)))
        assertTrue(WakePolicy.CHECK_DELAYS_MS.last() < WakePolicy.SETTLE_WINDOW_MS)
    }

    @Test
    fun `a process that starts inside the last wake's window, with no resume, is that wake's casualty`() {
        val req = 1_791_688_798_500L
        assertTrue(WakePolicy.restartAttributableToWake(req, 0L, req + 57_600L))
        assertTrue(WakePolicy.restartAttributableToWake(req, req - 60_000L, req + 57_600L)) // an older resume
        assertFalse(WakePolicy.restartAttributableToWake(req, req + 1_200L, req + 57_600L)) // it landed
        assertFalse(WakePolicy.restartAttributableToWake(req, 0L, req + WakePolicy.RESTART_ATTRIBUTION_WINDOW_MS + 1))
        assertFalse(WakePolicy.restartAttributableToWake(req, 0L, req - 1)) // a clock that went backwards
        assertFalse(WakePolicy.restartAttributableToWake(0L, 0L, req)) // no wake on record
    }

    @Test
    fun `every outcome is a short server-validated token`() {
        val tokens = WakePolicy.Step.values().map { WakePolicy.outcomeOf(it) }.toSet()
        assertEquals(setOf("on-glass", "pending", "dark", "standby", "install-prompt", "setup", "not-on-glass"), tokens)
        tokens.forEach { assertTrue(it.length <= 16 && Regex("^[a-z-]+$").matches(it)) }
    }
}
