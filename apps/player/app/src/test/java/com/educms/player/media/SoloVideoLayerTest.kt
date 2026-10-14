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
        assertEquals(SoloVideoLayer.Phase.REVEALING, layer.phase)
        layer.revealRequested(1000)
        assertFalse(layer.confirm(1000, true, true, false, true))
        assertTrue(layer.confirm(1001, true, true, false, true))
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

    @Test fun android11SoloUsesWindowOwnershipInsteadOfWebViewTransparency() {
        assertTrue(SoloVideoLayer.eligible(2, 0, 30))
        assertTrue(SoloVideoLayer.eligible(2, 0, 33))
        assertFalse(SoloVideoLayer.eligible(2, 0, 29))
        assertFalse(SoloVideoLayer.eligible(2, 1, 33))
        assertFalse(SoloVideoLayer.eligible(3, 0, 33))
        assertFalse(SoloVideoLayer.eligible(1, 0, 33))
        assertFalse(SoloVideoLayer(false).request(true, true))
    }

    @Test fun aDelayedPreRequestRenderCannotHideTheWebHold() {
        val layer = SoloVideoLayer(true)
        layer.request(true, true)
        layer.promote(true, true, false, true)
        assertFalse(layer.confirm(2000, true, true, false, true))
        layer.revealRequested(2000)
        layer.revealRequested(3000) // repeated requests must not extend the deadline
        assertEquals(2000L, layer.revealRequestedNs)
        assertFalse(layer.confirm(1999, true, true, false, true))
        assertFalse(layer.confirm(2000, true, true, false, true))
        assertEquals(SoloVideoLayer.Phase.REVEALING, layer.phase)
        assertTrue(layer.confirm(2001, true, true, false, true))
        assertFalse(layer.confirm(2002, true, true, false, true))
    }

    @Test fun aRevealHasAnIndependentDeadlineEvenWithDecoderCallbacks() {
        val layer = SoloVideoLayer(true)
        layer.request(true, true)
        layer.promote(true, true, false, true)
        val requested = 1_000_000_000L
        layer.revealRequested(requested)
        repeat(10) { assertFalse(layer.confirm(requested, true, true, false, true)) }
        assertFalse(layer.revealTimedOut(requested + SoloVideoLayer.REVEAL_TIMEOUT_NS - 1))
        assertTrue(layer.revealTimedOut(requested + SoloVideoLayer.REVEAL_TIMEOUT_NS))
        layer.retire()
        assertFalse(layer.confirm(requested + SoloVideoLayer.REVEAL_TIMEOUT_NS + 1, true, true, false, true))
    }

    @Test fun emergencyUiOrDetachmentAfterZOrderRequestStillWins() {
        for (guard in 0..3) {
            val layer = SoloVideoLayer(true)
            layer.request(true, true)
            layer.promote(true, true, false, true)
            layer.revealRequested(1000)
            assertFalse(layer.confirm(1001, guard != 0, guard != 1, guard == 2, guard != 3))
            assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
        }
    }

    @Test fun confirmedOwnershipDoesNotTimeOutOnTheRevealDeadline() {
        val layer = SoloVideoLayer(true)
        layer.request(true, true)
        layer.promote(true, true, false, true)
        layer.revealRequested(1000)
        assertTrue(layer.confirm(1001, true, true, false, true))
        assertFalse(layer.revealTimedOut(1000 + SoloVideoLayer.REVEAL_TIMEOUT_NS))
    }
}
