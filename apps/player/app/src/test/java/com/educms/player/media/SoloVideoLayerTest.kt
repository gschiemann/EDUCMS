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
    @Test fun legacyRockchipSoloIsStaticOnBothFacesOnlyWithinEligibleApiRange() {
        for (sdk in 24..29) for (face in 0..1) {
            for ((hardware, board) in listOf("rk3288" to "", "" to "rk3399", " ROCKCHIP " to "", "" to "RK3566")) {
                assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, SoloVideoLayer.mode(2, face, sdk, hardware, board))
            }
        }
        for (sdk in listOf(23, 30, 33)) {
            assertEquals(SoloVideoLayer.Mode.UNDER_WINDOW, SoloVideoLayer.mode(2, 1, sdk, "rk3288"))
        }
        for (name in listOf("", "amlogic", "mediatek", "spark3288", "rkboard", "vendor-rockchip")) {
            assertEquals(SoloVideoLayer.Mode.UNDER_WINDOW, SoloVideoLayer.mode(2, 0, 25, name, name))
        }
        for (protocol in listOf(1, 3)) for (face in 0..1) {
            assertEquals(SoloVideoLayer.Mode.UNDER_WINDOW, SoloVideoLayer.mode(protocol, face, 25, "rk3288"))
        }
        assertEquals(SoloVideoLayer.Mode.UNDER_WINDOW, SoloVideoLayer.mode(2, 2, 25, "rk3288"))
        assertEquals(SoloVideoLayer.Mode.DYNAMIC_ABOVE, SoloVideoLayer.mode(2, 0, 30, "rk3288"))
    }

    @Test fun staticSoloPreservesSizeAndStaysOffscreenThroughPreparationAndQueuedRender() {
        val layer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
        assertTrue(layer.eligible)
        assertArrayEquals(intArrayOf(1921, 0, 1080, 1920), layer.soloRect(1080, 1920, 1921))
        assertFalse(layer.request(false, true))
        assertTrue(layer.request(true, true))
        assertTrue(layer.parked)
        assertArrayEquals(intArrayOf(1080, 0, 1080, 1920), layer.soloRect(1080, 1920, 500))
        assertTrue(layer.promote(true, true, false, true))
        assertFalse(layer.parked)
        assertArrayEquals(intArrayOf(0, 0, 1080, 1920), layer.soloRect(1080, 1920, 1921))
        assertArrayEquals(intArrayOf(0, 0, 1080, 1920), SoloVideoLayer(false).soloRect(1080, 1920, 1921))
    }

    @Test fun staticMoveWaitCannotBeExtendedByFramesOrLateGeometry() {
        val layer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
        layer.request(true, true)
        layer.promote(true, true, false, true)
        val start = 1_000_000_000L
        layer.revealRequested(start)
        assertEquals(0L, layer.revealRequestedNs)
        layer.moveRequested(start)
        repeat(5) { assertFalse(layer.confirm(start + it + 1, true, true, false, true)) }
        layer.moveRequested(start + 1_000_000_000L)
        assertEquals(start, layer.moveRequestedNs)
        assertFalse(layer.revealTimedOut(start + SoloVideoLayer.REVEAL_TIMEOUT_NS - 1))
        assertTrue(layer.revealTimedOut(start + SoloVideoLayer.REVEAL_TIMEOUT_NS))
        layer.revealRequested(start + SoloVideoLayer.REVEAL_TIMEOUT_NS)
        assertEquals(0L, layer.revealRequestedNs)
        assertFalse(layer.confirm(start + SoloVideoLayer.REVEAL_TIMEOUT_NS + 1, true, true, false, true))
    }

    @Test fun staticRevealRequiresPostGeometryFrameAndCannotCompleteAfterDeadline() {
        val start = 1_000_000_000L
        fun revealing(): SoloVideoLayer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE).apply {
            request(true, true); promote(true, true, false, true); moveRequested(start)
            revealRequested(start - 1)
            assertEquals(0L, revealRequestedNs)
            revealRequested(start + 100)
        }
        val layer = revealing()
        assertFalse(layer.confirm(start + 100, true, true, false, true))
        assertTrue(layer.confirm(start + 101, true, true, false, true))
        assertFalse(layer.revealTimedOut(start + SoloVideoLayer.REVEAL_TIMEOUT_NS))
        assertFalse(revealing().confirm(start + SoloVideoLayer.REVEAL_TIMEOUT_NS, true, true, false, true))
    }

    @Test fun staticEmergencyUiDetachmentAndRetirementWinBeforeAndAfterMove() {
        for (afterMove in listOf(false, true)) for (guard in 0..3) {
            val layer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
            layer.request(true, true)
            if (afterMove) {
                layer.promote(true, true, false, true)
                layer.moveRequested(1000)
                layer.revealRequested(1001)
                assertFalse(layer.confirm(1002, guard != 0, guard != 1, guard == 2, guard != 3))
            } else {
                assertFalse(layer.promote(guard != 0, guard != 1, guard == 2, guard != 3))
            }
            assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
            layer.moveRequested(2000); layer.revealRequested(2001)
            assertFalse(layer.confirm(2002, true, true, false, true))
            assertTrue(layer.parked)
        }
        val layer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
        layer.request(true, true); layer.retire()
        assertFalse(layer.promote(true, true, false, true))
    }

    @Test fun geometryProofRejectsParkedOrResizedBoxAndWrongGlobalOrigin() {
        val target = intArrayOf(17, 23, 1080, 1920)
        assertTrue(SoloVideoLayer.geometryMatches(target, target.clone()))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(1098, 23, 1080, 1920)))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(0, 0, 1080, 1920)))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(17, 23, 1080, 1668)))
        assertFalse(SoloVideoLayer.geometryMatches(intArrayOf(0, 0, 0, 1920), intArrayOf(0, 0, 0, 1920)))
    }

}
