package com.educms.player.media

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * 2026-11-02, the portrait-by-rotation RK3576 (Android 14, 2160×3840, solo
 * native video): an INFO scroll banner drew correctly, the video showed as a
 * near-square box in the upper ~55 % of the panel and the rest was black.
 *
 * These tests pin three things:
 *  1. the banner box is computed from the WebView PARENT's portrait size, never
 *     the display's natural (landscape) size — the View math is right;
 *  2. where a live native surface cannot be proven correct (display rotated from
 *     its natural orientation, or an unreadable rotation) the posture is REFUSED: a
 *     full takeover; a natively oriented panel keeps banner posture;
 *  3. the paint receipt needs a native frame rendered after the banner layout.
 */
class BroadcastBannerRotatedTest {
    @After fun reset() { (0..8).forEach { BroadcastBanner.clear(it) } }

    // ── 1. geometry on a portrait parent of a display rotated from landscape ──

    @Test fun portraitParentOfARotatedDisplayGetsAPortraitBoxAnchoredUnderTheBanner() {
        // The measured scroll banner: inset ≈ 0.025 (≈96 px of 3840).
        assertArrayEquals(intArrayOf(27, 96, 2106, 3744), BroadcastBanner.rect(2160, 3840, 0.025))
        // The page's reserved first inset.
        assertArrayEquals(intArrayOf(108, 384, 1944, 3456), BroadcastBanner.rect(2160, 3840, 0.1))
        for (inset in listOf(0.0, 0.025, 0.1, 0.4)) {
            val r = BroadcastBanner.rect(2160, 3840, inset)
            assertTrue("inside the parent at $inset", r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 2160 && r[1] + r[3] <= 3840)
            assertTrue("portrait-shaped at $inset", r[3] > r[2])
            assertEquals("aspect kept at $inset", 2160.0 / 3840.0, r[2].toDouble() / r[3], 0.002)
            assertEquals("anchored to the bottom (banner on top) at $inset", 3840, r[1] + r[3])
        }
    }

    @Test fun theGlassSymptomIsNotOurArithmetic() {
        // What the photo showed: ~2100 wide × ~2060 tall from y≈96 — i.e. the
        // correct box CUT at y = 2160, the panel's NATURAL (landscape) height.
        val right = BroadcastBanner.rect(2160, 3840, 0.025)
        val naturalHeight = 2160
        val clippedHeight = minOf(right[1] + right[3], naturalHeight) - right[1]
        assertEquals(2064, clippedHeight)
        // A box derived from LANDSCAPE dimensions would be landscape-shaped,
        // not near-square and not anchored at the top — so neither of ours.
        val landscape = BroadcastBanner.rect(3840, 2160, 0.025)
        assertTrue(landscape[2] > landscape[3])
        assertFalse(right.contentEquals(landscape))
    }

    // ── 2. refused posture ──

    @Test fun postureIsRefusedOnlyOnADisplayRotatedFromItsNaturalOrientation() {
        // Surface.ROTATION_90 / ROTATION_270: a landscape-natural box turned to portrait.
        assertEquals(BannerPosturePolicy.REASON_DISPLAY_ROTATED, BannerPosturePolicy.refusal(true, 1))
        assertEquals(BannerPosturePolicy.REASON_DISPLAY_ROTATED, BannerPosturePolicy.refusal(true, 2))
        assertEquals(BannerPosturePolicy.REASON_DISPLAY_ROTATED, BannerPosturePolicy.refusal(true, 3))
        assertEquals(BannerPosturePolicy.REASON_ROTATION_UNKNOWN, BannerPosturePolicy.refusal(true, null))
        // Nothing native to move: the banner overlays web content as before, rotated or not.
        assertNull(BannerPosturePolicy.refusal(false, 1))
        assertNull(BannerPosturePolicy.refusal(false, null))
    }

    @Test fun aNativelyPortraitPanelKeepsBannerPostureWithItsVideoPlaying() {
        // On-glass 2026-11-02: natively portrait Amlogic t982 panels (rotation 0)
        // showed the banner over a correctly placed, still-playing native video.
        assertNull(BannerPosturePolicy.refusal(true, 0))
        assertTrue(BroadcastBanner.set(0, true, 0.025, emptySet()))
        BroadcastBanner.hold(0, true, true)
        assertNull(BroadcastBanner.refusal(0))
        assertTrue("playback continues under the banner", BroadcastBanner.allowsPlayback(setOf(0)))
        // …and its box is the same portrait box under the banner.
        assertArrayEquals(intArrayOf(27, 96, 2106, 3744), BroadcastBanner.rect(2160, 3840, BroadcastBanner.inset(0)))
        // A natively landscape panel keeps it too.
        assertNull(BannerPosturePolicy.refusal(true, 0))
    }

    @Test fun aRefusedFaceIsAFullTakeoverWhateverOrderTheHoldArrivesIn() {
        // Geometry, refusal, then the hold: never a banner holder.
        assertTrue(BroadcastBanner.set(0, true, 0.1, emptySet()))
        BroadcastBanner.refuse(0, BannerPosturePolicy.REASON_DISPLAY_ROTATED)
        BroadcastBanner.hold(0, true, true)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        assertEquals(BannerPosturePolicy.REASON_DISPLAY_ROTATED, BroadcastBanner.refusal(0))
        // An inset update and a banner re-assert cannot re-open it.
        assertTrue(BroadcastBanner.set(0, true, 0.025, setOf(0)))
        BroadcastBanner.hold(0, true, true, heldBefore = true)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        // The banner ending clears the refusal with it.
        assertTrue(BroadcastBanner.set(0, false, 0.0, setOf(0)))
        assertNull(BroadcastBanner.refusal(0))
    }

    @Test fun aRefusalAfterTheHoldWasGrantedWithdrawsPlayback() {
        BroadcastBanner.set(0, true, 0.1, emptySet())
        BroadcastBanner.hold(0, true, true)
        assertTrue(BroadcastBanner.allowsPlayback(setOf(0)))
        BroadcastBanner.refuse(0, BannerPosturePolicy.REASON_ROTATION_UNKNOWN)
        assertFalse(BroadcastBanner.allowsPlayback(setOf(0)))
        BroadcastBanner.clear(0)
        assertNull(BroadcastBanner.refusal(0))
    }

    // ── 3. receipt ──

    @Test fun theReceiptNeedsANativeFrameRenderedAfterTheBannerLayout() {
        assertFalse("not laid out yet", BannerPaintReceipt.frameAfterLayout(0L, 5_000L))
        assertFalse("last frame predates the layout", BannerPaintReceipt.frameAfterLayout(5_000L, 4_999L))
        assertFalse("same instant is not after", BannerPaintReceipt.frameAfterLayout(5_000L, 5_000L))
        assertTrue(BannerPaintReceipt.frameAfterLayout(5_000L, 5_001L))
    }

    // ── wiring, as source facts ──

    private fun source(name: String): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            listOf(File(dir, "src/main/java/com/educms/player/media/$name"), File(dir, "app/src/main/java/com/educms/player/media/$name"))
                .firstOrNull { it.isFile }?.let { return it.readText() }
            dir = dir.parentFile
        }
        return null
    }

    @Test fun theLiveRelayoutIsSkippedForARefusedFaceAndTheReceiptChecksTheFrame() {
        val box = source("FaceVideoBox.kt"); Assume.assumeTrue(box != null)
        val banner = box!!.substring(box.indexOf("fun banner("), box.indexOf("private fun refuseBannerIfUnprovable("))
        val refusalCheck = banner.indexOf("BroadcastBanner.refusal(host.face) != null")
        assertTrue("relayout must check the refusal", refusalCheck >= 0)
        assertTrue("…before moving the surface", refusalCheck < banner.indexOf("BroadcastVideoLayout.apply("))
        assertTrue("posture decided before the move", banner.indexOf("refuseBannerIfUnprovable(") < banner.indexOf("main.post"))
        assertTrue("each relayout writes its durable line", banner.contains("afterBannerLayout(host, session, parent, rect)"))
        val clear = box.substring(box.indexOf("fun emergencyOutputClear("), box.indexOf("fun yieldToUi("))
        assertTrue(clear.contains("BannerPaintReceipt.frameAfterLayout(session.bannerLaidOutNs, session.lastStamp)"))
        assertTrue(box.contains("phase=banner"))
        val host = source("SharedVideoHost.kt"); Assume.assumeTrue(host != null)
        assertTrue(host!!.contains("\"broadcastBannerPosture\""))
    }
}
