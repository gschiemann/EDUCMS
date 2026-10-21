package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** 1.1.49 `doublePost` (dark): the token's parse, and the pure decision. */
class DoublePostTest {
    @Test fun theTokenIsOffUnlessTheDescriptorSaysExactlyTrue() {
        assertFalse(NativeVideoExperiments.parse(null).doublePost)
        assertFalse(NativeVideoExperiments.parse(JSONObject()).doublePost)
        assertFalse(NativeVideoExperiments.parse(JSONObject().put("doublePost", "true")).doublePost)
        assertFalse(NativeVideoExperiments.parse(JSONObject().put("doublePost", false)).doublePost)
        val on = NativeVideoExperiments.parse(JSONObject().put("doublePost", true))
        assertTrue(on.doublePost)
        assertTrue(on.toJson().getBoolean("doublePost"))
        // The other defaults stand: the snap on, the 60 Hz request automatic.
        assertTrue(on.vsyncSnap); assertEquals(Prefer60Hz.AUTO, on.prefer60hz)
        assertFalse(NativeVideoExperiments.NONE.toJson().getBoolean("doublePost"))
    }

    @Test fun a60HzGridUnderA30FpsClipAppliesAndEverythingElseIsANoOp() {
        assertEquals(DoublePost.APPLY, DoublePost.decide(true, 33, false, 60.0, 30.0))
        assertEquals(DoublePost.APPLY, DoublePost.decide(true, 31, false, 59.94, 29.97))
        assertEquals(DoublePost.APPLY, DoublePost.decide(true, 33, false, 60.2, 30.0))
        // 60 / 60, 30 / 30, 50 / 30: nothing to match.
        assertEquals(DoublePost.NOT_DOUBLE, DoublePost.decide(true, 33, false, 60.0, 60.0))
        assertEquals(DoublePost.NOT_DOUBLE, DoublePost.decide(true, 33, false, 30.0, 30.0))
        assertEquals(DoublePost.NOT_DOUBLE, DoublePost.decide(true, 33, false, 50.0, 30.0))
        // Off, too old, under a hold, or no rate: never.
        assertEquals(DoublePost.OFF, DoublePost.decide(false, 33, false, 60.0, 30.0))
        assertEquals(DoublePost.SDK, DoublePost.decide(true, 30, false, 60.0, 30.0))
        assertEquals(DoublePost.HELD, DoublePost.decide(true, 33, true, 60.0, 30.0))
        assertEquals(DoublePost.NO_RATE, DoublePost.decide(true, 33, false, 0.0, 30.0))
        assertEquals(DoublePost.NO_RATE, DoublePost.decide(true, 33, false, 60.0, Double.NaN))
    }

    @Test fun theGridIsTheMeasuredPeriodWhenTrustedElseTheNominalRate() {
        val e = VsyncEstimator(VsyncEstimator.periodNsFor(30f))
        // Not ready yet: the nominal rate the display reports.
        assertEquals(30.0, DoublePost.gridHz(e, 30f), 1e-6)
        assertEquals(30.0, DoublePost.gridHz(null, 30f), 1e-6)
        // Choreographer at 60 Hz while the mode says 30 (the M43): the measured grid wins.
        var t = 1_000_000_000L
        repeat(12) { e.observe(t); t += 16_666_667L }
        assertTrue(e.ready)
        assertEquals(60.0, DoublePost.gridHz(e, 30f), 0.1)
        assertEquals(DoublePost.APPLY, DoublePost.decide(true, 33, false, DoublePost.gridHz(e, 30f), 30.0))
    }
}
