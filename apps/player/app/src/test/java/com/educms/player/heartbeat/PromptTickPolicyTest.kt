package com.educms.player.heartbeat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE PROMPT TICK (2026-10-11): a power event may pull the native heartbeat
 * forward, bounded so a flapping panel cannot turn it into a loop.
 */
class PromptTickPolicyTest {

    @Test
    fun `the first request is accepted and the decision honours it`() {
        assertTrue(PromptTickPolicy.accept(nowMs = 10_000L, recentPromptTicksMs = emptyList()))
        assertTrue(
            HeartbeatService.decideTick(
                nowMs = 1_700_000_000_000L,
                lastTickAtMs = 1_700_000_000_000L - 10_000L,   // ticked 10 s ago
                webTelemetryAtMs = 1_700_000_000_000L - 5_000L, // the page is reporting
                nativeUrgent = false,
                promptRequested = true,
            ),
        )
        // Without the request the same facts skip (the 5-minute floor).
        assertFalse(
            HeartbeatService.decideTick(
                nowMs = 1_700_000_000_000L,
                lastTickAtMs = 1_700_000_000_000L - 10_000L,
                webTelemetryAtMs = 1_700_000_000_000L - 5_000L,
            ),
        )
    }

    @Test
    fun `no prompt tick within the minimum gap of the last one`() {
        val last = 10_000L
        assertFalse(PromptTickPolicy.accept(last + PromptTickPolicy.MIN_GAP_MS - 1, listOf(last)))
        assertTrue(PromptTickPolicy.accept(last + PromptTickPolicy.MIN_GAP_MS, listOf(last)))
    }

    @Test
    fun `no more than the window's share, and the window slides`() {
        val ticks = (0 until PromptTickPolicy.MAX_PER_WINDOW).map { it * 20_000L }
        val now = ticks.last() + 20_000L
        assertFalse(PromptTickPolicy.accept(now, ticks))
        // Once the oldest leaves the window there is room again.
        val later = ticks.first() + PromptTickPolicy.WINDOW_MS
        assertEquals(PromptTickPolicy.MAX_PER_WINDOW - 1, PromptTickPolicy.prune(later, ticks).size)
        assertTrue(PromptTickPolicy.accept(later, ticks))
    }

    @Test
    fun `a backwards clock keeps nothing and blocks nothing`() {
        val ticks = listOf(50_000L, 60_000L)
        assertEquals(emptyList<Long>(), PromptTickPolicy.prune(nowMs = 40_000L, recentPromptTicksMs = ticks))
        assertTrue(PromptTickPolicy.accept(nowMs = 40_000L, recentPromptTicksMs = ticks))
    }
}
