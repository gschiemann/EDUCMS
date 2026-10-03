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

    // ─── P1-4 (2026-10-03 review): health earns a fresh count ───────────

    private val minute = 60_000L

    /** Heartbeats every minute for [minutes], starting at [from]. Returns the time of the last one. */
    private fun RendererRecoveryPolicy.beat(from: Long, minutes: Int): Long {
        var t = from
        for (i in 0..minutes) {
            onHealthyHeartbeat(t)
            if (i < minutes) t += minute
        }
        return t
    }

    @Test fun `P1-4 five healthy minutes after a replacement make the next death cost 2 s`() {
        // The X80 shape: killed every ~15 min, healthy in between. Before
        // P1-4 the 6th death onwards cost 60 s every time, forever.
        val policy = RendererRecoveryPolicy()
        var t = 10_000_000L
        repeat(6) { policy.onFailure(t); t += 1_000L }
        assertEquals(6, policy.failures)
        t = policy.beat(t + 5_000L, minutes = 5)
        assertEquals("reset by five unbroken healthy minutes", 0, policy.failures)
        assertEquals(2_000L, policy.onFailure(t + 10 * minute))
    }

    @Test fun `P1-4 a gap in the heartbeats restarts the run`() {
        val policy = RendererRecoveryPolicy(3, 10_000_000L)
        val first = policy.beat(10_000_000L + 5_000L, minutes = 3)
        // Four silent minutes: the page was not proving anything.
        policy.beat(first + 4 * minute, minutes = 3)
        assertEquals("3 + 3 minutes around a gap is not 5 unbroken", 3, policy.failures)
    }

    @Test fun `P1-4 a death inside the window keeps backing off`() {
        val policy = RendererRecoveryPolicy(3, 10_000_000L)
        val t = policy.beat(10_000_000L + 5_000L, minutes = 3)
        assertEquals(16_000L, policy.onFailure(t + 30_000L))
        assertEquals(4, policy.failures)
        // …and the run starts over from that death.
        val after = policy.beat(t + 31_000L, minutes = 4)
        assertEquals(4, policy.failures)
        policy.onHealthyHeartbeat(after + minute)
        assertEquals(0, policy.failures)
    }

    @Test fun `P1-4 a backwards clock never certifies health`() {
        val policy = RendererRecoveryPolicy(2, 10_000_000L)
        policy.onHealthyHeartbeat(20_000_000L)
        assertFalse(policy.onHealthyHeartbeat(20_000_000L - 10 * minute))
        assertEquals(2, policy.failures)
    }

    @Test fun `P1-1 without an alert the crash-loop backoff stands`() {
        assertEquals(32_000L, RendererRecoveryPolicy.reloadDelayMs(32_000L, emergencyHeld = false))
        assertEquals(2_000L, RendererRecoveryPolicy.reloadDelayMs(2_000L, emergencyHeld = false))
        // …and stays inside the 60 s cap whatever it is handed.
        assertEquals(60_000L, RendererRecoveryPolicy.reloadDelayMs(Long.MAX_VALUE, emergencyHeld = false))
    }
}
