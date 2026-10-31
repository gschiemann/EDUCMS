package com.educms.player.media

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class BroadcastBannerTest {
    @After fun reset() { (0..8).forEach { BroadcastBanner.clear(it) } }

    @Test fun bannerPreservesTheDisplayHoldAndAllowsOnlyKnownHolders() {
        assertTrue(BroadcastBanner.set(0, true, 0.1, emptySet()))
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        BroadcastBanner.hold(0, true, true)
        assertTrue(BroadcastBanner.allowsPlayback(setOf(0)))
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0, 1)))
        assertFalse(BroadcastBanner.allowsPlayback(emptySet()))
        assertTrue(BroadcastBanner.set(1, true, 0.2, setOf(0)))
        BroadcastBanner.hold(1, true, true)
        assertTrue(BroadcastBanner.allowsPlayback(setOf(0, 1)))
    }

    @Test fun bannerCannotDowngradeAnExistingTakeover() {
        assertFalse(BroadcastBanner.set(0, true, 0.1, setOf(0)))
        assertFalse(BroadcastBanner.active(0))
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
    }

    @Test fun changingBannerHeightOrRemovingItsVisualDoesNotReleaseTheHold() {
        BroadcastBanner.set(0, true, 0.1, emptySet())
        BroadcastBanner.hold(0, true, true)
        assertTrue(BroadcastBanner.set(0, true, 0.2, setOf(0)))
        assertEquals(0.2, BroadcastBanner.inset(0), 0.0001)
        assertTrue(BroadcastBanner.set(0, true, 0.0, setOf(0)))
        assertTrue(BroadcastBanner.allowsPlayback(setOf(0)))
    }

    @Test fun takeoverOrNewDocumentRestoresPlaybackSuppression() {
        BroadcastBanner.set(0, true, 0.1, emptySet())
        BroadcastBanner.hold(0, true, true)
        BroadcastBanner.hold(0, true, false)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        // Even an old geometry update cannot undo the atomic takeover.
        BroadcastBanner.set(0, true, 0.1, setOf(0))
        BroadcastBanner.hold(0, true, true, heldBefore = true)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        BroadcastBanner.clear(0)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
    }

    @Test fun geometryKeepsTheWholePictureAndItsAspectRatio() {
        assertArrayEquals(intArrayOf(96, 108, 1728, 972), BroadcastBanner.rect(1920, 1080, 0.1))
        assertArrayEquals(intArrayOf(0, 0, 1080, 1920), BroadcastBanner.rect(1080, 1920, 0.0))
        assertArrayEquals(intArrayOf(108, 384, 864, 1536), BroadcastBanner.rect(1080, 1920, 0.2))
        // A portrait page rotated on a landscape Presentation puts its top
        // banner on the physical right; the same picture fits to its left.
        assertArrayEquals(intArrayOf(0, 27, 864, 486), BroadcastBanner.rect(960, 540, 0.1, 90))
    }

    @Test fun geometryMessagesAreBoundedAndDoNotAcceptUrlsOrCredentials() {
        assertNotNull(BroadcastBanner.parse("""{"version":4,"op":"banner","active":true,"inset":0.1}"""))
        listOf(
            """{"version":4,"op":"banner","active":true,"inset":0.9}""",
            """{"version":4,"op":"banner","active":"true","inset":0.1}""",
            """{"version":4,"op":"banner","active":true,"inset":0.1,"url":"https://example.test"}""",
        ).forEach { assertNull(BroadcastBanner.parse(it)) }
        assertFalse(BroadcastBanner.set(0, true, Double.NaN, emptySet()))
    }
}
