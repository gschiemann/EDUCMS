package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

/**
 * ONE COMPOSITING CONTRACT (1.1.41): a solo surface is composed above the
 * window — dynamically on R+, statically on 24–29 — or the session is not
 * native. There is no under-window mode left to fall into.
 */
class SoloVideoLayerTest {
    private fun dynamic() = SoloVideoLayer(SoloVideoLayer.Mode.DYNAMIC_ABOVE)

    @Test fun boundaryWaitAndDecoderPreparationDoNotTakeTheWindow() {
        val layer = dynamic()
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
        val layer = dynamic()
        layer.request(true, true)
        layer.retire()
        assertFalse(layer.promote(true, true, false, true))
        assertFalse(layer.request(true, true))
        assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
    }

    @Test fun emergencyOrOperatorUiOrDetachedOutputPreventDelayedPromotion() {
        for (guard in 0..3) {
            val layer = dynamic()
            layer.request(true, true)
            assertFalse(layer.promote(guard != 0, guard != 1, guard == 2, guard != 3))
            assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
            assertFalse(layer.request(true, true))
        }
    }

    @Test fun soloIsAboveTheWindowOnEveryClassOrNotNativeAtAll() {
        // Android R+: dynamic re-ordering, on either face of a double-sided unit.
        for (sdk in listOf(30, 31, 33, 34)) for (face in 0..1) {
            assertEquals("sdk $sdk face $face", SoloVideoLayer.Mode.DYNAMIC_ABOVE, SoloVideoLayer.mode(2, face, sdk))
        }
        // Android 7.0–10: the static parked start — on ANY hardware, not only Rockchip (.40's rule).
        for (sdk in 24..29) for (face in 0..1) {
            assertEquals("sdk $sdk face $face", SoloVideoLayer.Mode.STATIC_ABOVE, SoloVideoLayer.mode(2, face, sdk))
        }
        // A positioned slot (protocol 3) is the static shape on every class: above the window
        // from creation, parked beyond the display until `play`.
        for (sdk in listOf(24, 25, 28, 29, 30, 33, 34)) for (face in 0..1) {
            assertEquals("slot sdk $sdk face $face", SoloVideoLayer.Mode.STATIC_ABOVE, SoloVideoLayer.mode(3, face, sdk))
        }
        // Below minSdk, a face this box does not host, or any other protocol: never native.
        assertNull(SoloVideoLayer.mode(2, 0, 23))
        assertNull(SoloVideoLayer.mode(3, 0, 23))
        assertNull(SoloVideoLayer.mode(2, 2, 33))
        assertNull(SoloVideoLayer.mode(3, 2, 33))
        assertNull(SoloVideoLayer.mode(2, -1, 25))
        for (protocol in listOf(0, 1, 4)) for (sdk in listOf(25, 33)) assertNull(SoloVideoLayer.mode(protocol, 0, sdk))
        // UNDER_WINDOW is a PHASE (prepared, not yet shown), never a composition mode.
        assertEquals(setOf("DYNAMIC_ABOVE", "STATIC_ABOVE"), SoloVideoLayer.Mode.values().map { it.name }.toSet())
        assertEquals("composition-unavailable", SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE)
    }

    @Test fun aDelayedPreRequestRenderCannotHideTheWebHold() {
        val layer = dynamic()
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
        val layer = dynamic()
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
            val layer = dynamic()
            layer.request(true, true)
            layer.promote(true, true, false, true)
            layer.revealRequested(1000)
            assertFalse(layer.confirm(1001, guard != 0, guard != 1, guard == 2, guard != 3))
            assertEquals(SoloVideoLayer.Phase.RETIRED, layer.phase)
        }
    }

    @Test fun confirmedOwnershipDoesNotTimeOutOnTheRevealDeadline() {
        val layer = dynamic()
        layer.request(true, true)
        layer.promote(true, true, false, true)
        layer.revealRequested(1000)
        assertTrue(layer.confirm(1001, true, true, false, true))
        assertFalse(layer.revealTimedOut(1000 + SoloVideoLayer.REVEAL_TIMEOUT_NS))
    }

    @Test fun staticSoloPreservesSizeAndStaysOffscreenThroughPreparationAndQueuedRender() {
        val layer = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
        assertTrue(layer.staticAbove)
        assertArrayEquals(intArrayOf(1921, 0, 1080, 1920), layer.soloRect(1080, 1920, 1921))
        assertFalse(layer.request(false, true))
        assertTrue(layer.request(true, true))
        assertTrue(layer.parked)
        assertArrayEquals(intArrayOf(1080, 0, 1080, 1920), layer.soloRect(1080, 1920, 500))
        assertTrue(layer.promote(true, true, false, true))
        assertFalse(layer.parked)
        assertArrayEquals(intArrayOf(0, 0, 1080, 1920), layer.soloRect(1080, 1920, 1921))
        // The dynamic path never parks: it prepares beneath the window at its real rect.
        assertFalse(dynamic().parked)
        assertArrayEquals(intArrayOf(0, 0, 1080, 1920), dynamic().soloRect(1080, 1920, 1921))
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

    /**
     * A4 (1.1.41): an emergency hold during the STATIC path — at every phase a
     * surface can be in — retires the layer, and a retired static layer is
     * PARKED: its rect is beyond the display, so even before the UI pass that
     * removes the view, no frame of it can sit under the alert. A later render
     * callback, however fresh, cannot bring it back.
     */
    @Test fun emergencyHoldRetiresAStaticSurfaceAtEveryPhaseAndParksIt() {
        val held = true
        // Phase 1: prepared, parked (UNDER_WINDOW): a hold refuses promotion.
        run {
            val l = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
            l.request(true, true)
            assertFalse(l.promote(live = true, attached = true, emergencyHeld = held, uiClear = true))
            assertEquals(SoloVideoLayer.Phase.RETIRED, l.phase)
            assertTrue(l.parked)
            assertEquals(1921, l.soloRect(1080, 1920, 1921)[0])
        }
        // Phase 2: moving onto its rect, geometry not yet confirmed.
        run {
            val l = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
            l.request(true, true); l.promote(true, true, false, true); l.moveRequested(1000)
            assertFalse(l.confirm(1500, true, true, held, true))
            assertEquals(SoloVideoLayer.Phase.RETIRED, l.phase)
            assertTrue(l.parked)
        }
        // Phase 3: geometry confirmed, waiting for the post-geometry frame.
        run {
            val l = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
            l.request(true, true); l.promote(true, true, false, true); l.moveRequested(1000); l.revealRequested(1001)
            assertFalse(l.confirm(1002, true, true, held, true))
            assertEquals(SoloVideoLayer.Phase.RETIRED, l.phase)
            assertTrue(l.parked)
            assertFalse("a later fresh frame cannot revive it", l.confirm(5000, true, true, false, true))
        }
        // Phase 4: on the glass. The hold path retires it explicitly; the view pass removes it.
        run {
            val l = SoloVideoLayer(SoloVideoLayer.Mode.STATIC_ABOVE)
            l.request(true, true); l.promote(true, true, false, true); l.moveRequested(1000); l.revealRequested(1001)
            assertTrue(l.confirm(1002, true, true, false, true))
            assertEquals(SoloVideoLayer.Phase.ABOVE_WINDOW, l.phase)
            l.retire()
            assertEquals(SoloVideoLayer.Phase.RETIRED, l.phase)
            assertTrue(l.parked)
            assertFalse(l.request(true, true))
            assertFalse(l.confirm(9000, true, true, false, true))
        }
    }

    @Test fun geometryProofRejectsParkedOrResizedBoxAndWrongGlobalOrigin() {
        val target = intArrayOf(17, 23, 1080, 1920)
        assertTrue(SoloVideoLayer.geometryMatches(target, target.clone()))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(1098, 23, 1080, 1920)))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(0, 0, 1080, 1920)))
        assertFalse(SoloVideoLayer.geometryMatches(target, intArrayOf(17, 23, 1080, 1668)))
        assertFalse(SoloVideoLayer.geometryMatches(intArrayOf(0, 0, 0, 1920), intArrayOf(0, 0, 0, 1920)))
    }

    @Test fun parkingIncludesFittedOverhangAndPhysicalDisplayBeyondNarrowParent() {
        assertEquals(1161, SoloVideoLayer.parkingLeft(1080, 1080, 0, -80))
        assertEquals(1081, SoloVideoLayer.parkingLeft(1080, 1080, 0, 80))
        assertEquals(1161, SoloVideoLayer.parkingLeft(600, 1080, 0, -80))
        assertEquals(1061, SoloVideoLayer.parkingLeft(600, 1080, 100, -80))
        assertEquals(1261, SoloVideoLayer.parkingLeft(600, 1080, -100, -80))
        for (parentW in listOf(600, 1080)) for (parentX in listOf(-100, 0, 100)) for (fitLeft in listOf(-80, 0, 80)) {
            val parked = SoloVideoLayer.parkingLeft(parentW, 1080, parentX, fitLeft)
            assertTrue(parentX + parked > 1080) // box is off display
            assertTrue(parentX + parked + fitLeft > 1080) // surface is off display too
        }
    }
}
