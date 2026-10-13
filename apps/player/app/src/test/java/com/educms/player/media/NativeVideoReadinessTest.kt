package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

class NativeVideoReadinessTest {
    @Test fun resumeAndUiCloseEachCreateOneOpportunity() {
        val gate = NativeVideoReadiness()
        assertFalse(gate.snapshot.ready)
        assertEquals(1L, gate.observe(true, true, true, true).epoch)
        repeat(10) { assertEquals(1L, gate.observe(true, true, true, true).epoch) }
        assertFalse(gate.observe(false, true, true, true).ready)
        assertEquals(2L, gate.observe(true, true, true, true).epoch)
        assertFalse(gate.observe(true, true, true, false).ready)
        assertEquals(3L, gate.observe(true, true, true, true).epoch)
    }
    @Test fun foregroundAloneCannotCoverUiOrAnAsleepPanel() {
        val gate = NativeVideoReadiness()
        assertFalse(gate.observe(true, false, true, true).ready)
        assertFalse(gate.observe(true, true, false, true).ready)
        assertFalse(gate.observe(true, true, true, false).ready)
        assertEquals(0L, gate.snapshot.epoch)
    }
    @Test fun secondaryPresentationDoesNotNeedInputFocusButMustHaveClearUi() {
        val gate = NativeVideoReadiness()
        assertTrue(gate.observe(true, true, false, true, false).ready)
        assertFalse(gate.observe(true, true, false, false, false).ready)
        assertFalse(gate.observe(false, true, false, true, false).ready)
    }
}
