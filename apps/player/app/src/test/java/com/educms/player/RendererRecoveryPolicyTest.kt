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
}
