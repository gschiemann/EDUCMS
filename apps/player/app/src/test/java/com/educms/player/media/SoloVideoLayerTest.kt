package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

class SoloVideoLayerTest {
    @Test fun boundaryWaitAndDecoderPreparationDoNotTakeTheWindow() {
        val layer = SoloVideoLayer(true)
        assertFalse(layer.request(started = false, validFrame = true))
        assertFalse(layer.request(started = true, validFrame = false))
        assertEquals(SoloVideoLayer.Phase.UNDER_WINDOW, layer.phase)
        assertTrue(layer.request(started = true, validFrame = true))
        assertFalse(layer.request(started = true, validFrame = true))
        assertTrue(layer.promote(live = true, attached = true, emergencyHeld = false, uiClear = true))
        assertEquals(SoloVideoLayer.Phase.ABOVE_WINDOW, layer.phase)
    }

    @Test fun retirementWinsOverAQueuedFirstFrame() {
        val layer = SoloVideoLayer(true)
        layer.request(true, true)
        layer.retire()
        assertFalse(layer.promote(true, true, false, true))
        assertFalse(layer.request(true, true))
        assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
    }

    @Test fun emergencyOrOperatorUiOrDetachedOutputPreventDelayedPromotion() {
        for (guard in 0..3) {
            val layer = SoloVideoLayer(true)
            layer.request(true, true)
            assertFalse(layer.promote(guard != 0, guard != 1, guard == 2, guard != 3))
            assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
            assertFalse(layer.request(true, true))
        }
    }

    @Test fun fieldCorrectionDoesNotChangeZonesSecondaryWindowsOrOlderHardware() {
        assertTrue(SoloVideoLayer.eligible(2, 0, 33))
        assertFalse(SoloVideoLayer.eligible(2, 0, 30))
        assertFalse(SoloVideoLayer.eligible(2, 1, 33))
        assertFalse(SoloVideoLayer.eligible(3, 0, 33))
        assertFalse(SoloVideoLayer.eligible(1, 0, 33))
        assertFalse(SoloVideoLayer(false).request(true, true))
    }
}
