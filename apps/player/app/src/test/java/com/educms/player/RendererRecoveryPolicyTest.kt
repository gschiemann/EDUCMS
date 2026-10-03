package com.educms.player

import org.junit.Assert.*
import org.junit.Test

class RendererRecoveryPolicyTest {
    @Test fun `repeated deaths back off and survive process restarts`() {
        var policy = RendererRecoveryPolicy()
        val delays = listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L)
        delays.forEachIndexed { i, delay ->
            assertEquals(delay, policy.onFailure(1_000_000L + i))
            policy = RendererRecoveryPolicy(policy.failures, policy.lastFailureAt)
        }
    }
    @Test fun `quiet interval resets backoff but keeps conservative playback`() {
        val policy = RendererRecoveryPolicy(6, 1_000_000L)
        val now = 1_000_000L + RendererRecoveryPolicy.QUIET_RESET_MS
        assertTrue(policy.recentlyFailed(now))
        assertEquals(2_000L, policy.onFailure(now))
        assertFalse(policy.recentlyFailed(now + RendererRecoveryPolicy.SAFE_MODE_MS))
    }
    @Test fun `bad persisted counts and wall clock changes remain bounded`() {
        val policy = RendererRecoveryPolicy(Int.MAX_VALUE, 2_000_000L)
        assertFalse(policy.recentlyFailed(1_000_000L))
        assertEquals(2_000L, policy.onFailure(1_000_000L))
    }

    // ─── P1-1 (2026-10-03 review): an alert never waits out the backoff ──

    @Test fun `P1-1 during an alert the backoff is skipped but the death is still a strike`() {
        // A lockdown is on the glass and the renderer keeps dying: the 6th
        // death would normally cost 60 s of blank glass.
        val policy = RendererRecoveryPolicy(5, 1_000_000L)
        val backoff = policy.onFailure(1_000_000L + 60_000L)
        assertEquals(60_000L, backoff)
        assertEquals("the death is still counted", 6, policy.failures)
        assertEquals(
            RendererRecoveryPolicy.EMERGENCY_RELOAD_MS,
            RendererRecoveryPolicy.reloadDelayMs(backoff, emergencyHeld = true),
        )
        assertEquals(1_000L, RendererRecoveryPolicy.EMERGENCY_RELOAD_MS)
    }

    @Test fun `P1-1 without an alert the crash-loop backoff stands`() {
        assertEquals(32_000L, RendererRecoveryPolicy.reloadDelayMs(32_000L, emergencyHeld = false))
        assertEquals(2_000L, RendererRecoveryPolicy.reloadDelayMs(2_000L, emergencyHeld = false))
        // …and stays inside the 60 s cap whatever it is handed.
        assertEquals(60_000L, RendererRecoveryPolicy.reloadDelayMs(Long.MAX_VALUE, emergencyHeld = false))
    }
}
