package com.educms.player.media

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * 2026-11-23, the owner's demo on an L55VEC: a broadcast banner, then a
 * drill, then the drill's all-clear with the broadcast still up. The native
 * website never came back until the broadcast was killed, because the page's
 * request to go back to banner posture was refused twice — the geometry
 * ([BroadcastBanner.set]: held, no insets) and the hold ([BroadcastBanner.hold]:
 * held before, not a banner holder) — and the site view stayed masked.
 *
 * The rule those refusals implement stays ("a banner cannot downgrade a
 * takeover": BroadcastBannerTest pins it, unchanged). These tests pin its ONE
 * exit: a trusted `takeoverEnded` hold, which the page sends only from a LIVE
 * manifest, and which still keeps the takeover after a native-watch raise or
 * any posture refusal in the same hold episode.
 */
class BroadcastBannerTakeoverEndedTest {
    @Before fun start() { reset() }
    @After fun reset() { (0..8).forEach { BroadcastBanner.clear(it) }; BroadcastBanner.endHold() }

    private val face = 0
    private val held = setOf(face)

    /** The broadcast: geometry, then the banner-posture hold. */
    private fun banner() {
        assertTrue(BroadcastBanner.set(face, true, 0.1, emptySet()))
        BroadcastBanner.hold(face, true, true)
        assertTrue("the banner leaves playback running", BroadcastBanner.allowsPlayback(held))
    }

    /** A takeover over it (a drill, a lockdown, an SOS): inactive geometry, then the takeover hold. */
    private fun takeover() {
        assertTrue(BroadcastBanner.set(face, false, 0.0, held))
        BroadcastBanner.hold(face, true, false, heldBefore = true)
        assertFalse("the takeover holds playback", BroadcastBanner.allowsPlayback(held))
    }

    /** The page asks for banner posture again (geometry first, then the hold), as every path does. */
    private fun askBanner(takeoverEnded: Boolean, watchRaised: Boolean = false): BroadcastBanner.Downgrade? {
        BroadcastBanner.set(face, true, 0.1, held)
        return BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = takeoverEnded, watchRaised = watchRaised)
    }

    @Test fun theDemoSequenceTheLiveManifestEndsTheTakeoverAndTheBannerRemains() {
        banner()
        takeover()
        // The all-clear arrives on the push path first: geometry and hold, no takeover-ended. Refused, as before.
        assertFalse("geometry alone never downgrades", BroadcastBanner.set(face, true, 0.1, held))
        assertNull(BroadcastBanner.hold(face, true, true, heldBefore = true))
        assertFalse(BroadcastBanner.allowsPlayback(held))
        // The first live manifest: the takeover ended, only the banner remains.
        val d = BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = true)
        assertEquals(BroadcastBanner.Downgrade(true, BroadcastBanner.PROMOTED), d)
        assertTrue("playback resumes under the banner", BroadcastBanner.allowsPlayback(held))
        assertTrue(BroadcastBanner.active(face))
        assertEquals(0.1, BroadcastBanner.inset(face), 1e-9)
        assertNull(BroadcastBanner.takeoverKept(face))
        // Every later live manifest carries it too: idempotent.
        assertEquals(BroadcastBanner.Downgrade(true, BroadcastBanner.ALREADY_BANNER), askBanner(takeoverEnded = true))
        assertTrue(BroadcastBanner.allowsPlayback(held))
        // The broadcast ends: the banner goes, the hold is then released by the page.
        assertTrue(BroadcastBanner.set(face, false, 0.0, held))
        BroadcastBanner.hold(face, false, false, heldBefore = true)
        assertFalse(BroadcastBanner.active(face))
    }

    @Test fun withoutTheTrustedArgumentTheTakeoverStays() {
        banner()
        takeover()
        repeat(3) { assertNull(askBanner(takeoverEnded = false)) }
        assertFalse(BroadcastBanner.allowsPlayback(held))
        assertFalse(BroadcastBanner.active(face))
    }

    @Test fun aTakeoverTheNativeWatchRaisedIsNeverDowngraded() {
        banner()
        // The watch raised this episode (DisplayEmergency.raiseFromNativeWatch clears the banner first).
        BroadcastBanner.clear(face)
        BroadcastBanner.hold(face, true, false, heldBefore = true)
        val d = askBanner(takeoverEnded = true, watchRaised = true)
        assertEquals(BroadcastBanner.Downgrade(false, BroadcastBanner.KEPT_NATIVE_WATCH), d)
        assertFalse(BroadcastBanner.allowsPlayback(held))
        assertEquals("the page is told the app kept it", BroadcastBanner.KEPT_NATIVE_WATCH, BroadcastBanner.takeoverKept(face))
    }

    @Test fun aRotationRefusalEarlierInTheHoldSurvivesTheDrillsInactiveGeometry() {
        // The banner on a rotated display: refused, a full takeover for the broadcast.
        assertTrue(BroadcastBanner.set(face, true, 0.1, emptySet()))
        BroadcastBanner.refuse(face, BannerPosturePolicy.REASON_DISPLAY_ROTATED)
        BroadcastBanner.hold(face, true, true)
        assertFalse(BroadcastBanner.allowsPlayback(held))
        // The drill: its inactive geometry clears the per-banner refusal, as before…
        takeover()
        assertNull(BroadcastBanner.refusal(face))
        // …but not the episode's: the live manifest's takeover-ended is refused.
        val d = askBanner(takeoverEnded = true)
        assertEquals(BroadcastBanner.Downgrade(false, BannerPosturePolicy.REASON_DISPLAY_ROTATED), d)
        assertFalse(BroadcastBanner.allowsPlayback(held))
        assertEquals(BannerPosturePolicy.REASON_DISPLAY_ROTATED, BroadcastBanner.takeoverKept(face))
    }

    @Test fun aCurrentRefusalKeepsTheTakeover() {
        banner()
        BroadcastBanner.hold(face, true, false, heldBefore = true)
        BroadcastBanner.refuse(face, BannerPosturePolicy.REASON_ROTATION_UNKNOWN)
        val d = BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = true)
        assertEquals(BroadcastBanner.Downgrade(false, BannerPosturePolicy.REASON_ROTATION_UNKNOWN), d)
        assertFalse(BroadcastBanner.allowsPlayback(held))
    }

    @Test fun aDocumentRetireKeepsTheEpisodeRefusal() {
        banner()
        BroadcastBanner.refuse(face, BannerPosturePolicy.REASON_DISPLAY_ROTATED)
        takeover()
        // The page reloads (SharedVideoHost.invalidate → clear); the hold is persisted and stays.
        BroadcastBanner.clear(face)
        val d = askBanner(takeoverEnded = true)
        assertFalse(d!!.promoted)
        assertFalse(BroadcastBanner.allowsPlayback(held))
    }

    @Test fun noGeometryYetIsKeptQuietlyAndTheNextLiveManifestPromotes() {
        banner()
        takeover()
        val first = BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = true)
        assertEquals(BroadcastBanner.Downgrade(false, BroadcastBanner.KEPT_NO_GEOMETRY), first)
        assertFalse(BroadcastBanner.allowsPlayback(held))
        assertNull("a transient is not reported to the page", BroadcastBanner.takeoverKept(face))
        assertEquals(BroadcastBanner.PROMOTED, askBanner(takeoverEnded = true)!!.reason)
        assertTrue(BroadcastBanner.allowsPlayback(held))
    }

    @Test fun anSosOverTheBannerClearedOnThePushPathIsEndedByTheNextLiveManifest() {
        banner()
        takeover() // the SOS
        // The SOS is cleared (push path): geometry and the banner hold, no takeover-ended. Refused.
        assertNull(askBanner(takeoverEnded = false))
        assertFalse(BroadcastBanner.allowsPlayback(held))
        // The next live manifest sends no new geometry (no flip on the page); the kept geometry is used.
        val d = BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = true)
        assertEquals(BroadcastBanner.PROMOTED, d!!.reason)
        assertTrue(BroadcastBanner.allowsPlayback(held))
        assertEquals(0.1, BroadcastBanner.inset(face), 1e-9)
    }

    @Test fun aNewTakeoverDropsTheKeptGeometry() {
        banner()
        takeover()
        assertNull(askBanner(takeoverEnded = false)) // geometry kept while held
        BroadcastBanner.hold(face, true, false, heldBefore = true) // a new takeover
        assertEquals(BroadcastBanner.KEPT_NO_GEOMETRY, BroadcastBanner.hold(face, true, true, heldBefore = true, takeoverEnded = true)!!.reason)
        assertFalse(BroadcastBanner.allowsPlayback(held))
    }

    @Test fun takeoverEndedMeansNothingOnAReleaseATakeoverOrANewHold() {
        banner()
        takeover()
        BroadcastBanner.set(face, true, 0.1, held)
        assertNull("a takeover request", BroadcastBanner.hold(face, true, false, heldBefore = true, takeoverEnded = true))
        assertFalse(BroadcastBanner.allowsPlayback(held))
        BroadcastBanner.set(face, true, 0.1, held)
        assertNull("a release", BroadcastBanner.hold(face, false, true, heldBefore = true, takeoverEnded = true))
        BroadcastBanner.endHold()
        // A NEW hold (not held before) follows the ordinary rule: geometry first, then the hold.
        assertTrue(BroadcastBanner.set(face, true, 0.1, emptySet()))
        assertNull(BroadcastBanner.hold(face, true, true, heldBefore = false, takeoverEnded = true))
        assertTrue(BroadcastBanner.allowsPlayback(held))
    }

    @Test fun theEpisodeEndsWithTheHold() {
        banner()
        BroadcastBanner.refuse(face, BannerPosturePolicy.REASON_DISPLAY_ROTATED)
        takeover()
        assertFalse(askBanner(takeoverEnded = true)!!.promoted)
        BroadcastBanner.endHold(face)
        assertNull(BroadcastBanner.takeoverKept(face))
        // A later episode on a box whose rotation is now provable can downgrade again.
        assertEquals(BroadcastBanner.PROMOTED, askBanner(takeoverEnded = true)!!.reason)
    }

    @Test fun everyHoldingFaceMustBeABannerForPlaybackToResume() {
        banner()
        assertTrue(BroadcastBanner.set(1, true, 0.1, held))
        BroadcastBanner.hold(1, true, false) // face 1 takes over
        takeover()
        assertEquals(BroadcastBanner.PROMOTED, askBanner(takeoverEnded = true)!!.reason)
        assertFalse("the other face's takeover still holds playback", BroadcastBanner.allowsPlayback(setOf(0, 1)))
    }

    // ── wiring, as source facts (the Android halves cannot run on a plain JVM) ──

    private fun source(path: String): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            listOf(File(dir, "src/main/java/com/educms/player/$path"), File(dir, "app/src/main/java/com/educms/player/$path"))
                .firstOrNull { it.isFile }?.let { return it.readText() }
            dir = dir.parentFile
        }
        return null
    }

    @Test fun theTransitionReachesTheBannerOnlyFromThePageOverTheTrustedChannel() {
        val api = source("display/DisplayControlApi.kt"); Assume.assumeTrue(api != null)
        assertTrue("trusted only, and only with banner posture",
            api!!.contains("DisplayEmergency.setHold(app, faceIndex, active, bannerOnly && trusted, takeoverEnded && bannerOnly && trusted)"))
        val channel = source("security/NativeBridgeChannel.kt"); Assume.assumeTrue(channel != null)
        assertTrue("a literal true third argument, nothing else", channel!!.contains("if (args.opt(2) == true) {"))
        assertTrue(channel.contains("bridge.displayEmergencyHoldTakeoverEndedViaSecureChannel(boolAt(args, 0), args.opt(1) == true)"))
        assertFalse("no truthy coercion of the third argument", channel.contains("boolAt(args, 2)"))
        val bridge = source("WebAppBridge.kt"); Assume.assumeTrue(bridge != null)
        val entry = bridge!!.substring(bridge.indexOf("fun displayEmergencyHoldTakeoverEndedViaSecureChannel("))
        assertTrue("a release or a takeover is the plain hold, and an unwired host still raises",
            entry.contains("if (!active || !bannerOnly || impl == null) return displayEmergencyHoldViaSecureChannel(active, bannerOnly)"))
    }

    @Test fun displayEmergencyGuardsTheTransitionWithTheNativeWatchAndEndsTheEpisodeOnRelease() {
        val de = source("display/DisplayEmergency.kt"); Assume.assumeTrue(de != null)
        val setHold = de!!.substring(de.indexOf("private fun setHoldFrom("), de.indexOf("private fun afterTakeoverEnded("))
        assertTrue("the watch's raise marks the episode", setHold.contains("if (active && !fromPage) watchRaisedThisHold = true"))
        assertTrue("only the page can say the takeover ended", setHold.contains("takeoverEnded = fromPage && takeoverEnded,"))
        assertTrue(setHold.contains("watchRaised = watchRaisedThisHold,"))
        val watch = de.substring(de.indexOf("fun raiseFromNativeWatch("), de.indexOf("private fun setHoldFrom("))
        assertTrue("the watch never sends it", watch.contains("setHoldFrom(app, faceIndex, active = true, fromPage = false)"))
        val release = de.substring(de.indexOf("private fun release("), de.indexOf("private fun restoreBlankIfDue("))
        assertTrue(release.contains("watchRaisedThisHold = false"))
        assertTrue(release.contains("com.educms.player.media.BroadcastBanner.endHold()"))
        assertTrue("…before the not-held early return",
            release.indexOf("BroadcastBanner.endHold()") < release.indexOf("if (!wasHeld) return true"))
        val after = de.substring(de.indexOf("private fun afterTakeoverEnded("), de.indexOf("private fun narrowHold("))
        assertTrue("a promotion re-shows the masked site", after.contains("BroadcastContentViews.refresh()"))
        assertTrue(after.contains("PLAYER_TAKEOVER_ENDED") && after.contains("PLAYER_TAKEOVER_KEPT"))
    }

    @Test fun theAppTellsThePageWhenItKeptTheTakeoverAndARestoredSiteViewKeepsItsMask() {
        val host = source("media/SharedVideoHost.kt"); Assume.assumeTrue(host != null)
        assertTrue(host!!.contains("\"takeover-kept\""))
        val views = source("media/BroadcastContentViews.kt"); Assume.assumeTrue(views != null)
        assertTrue(views!!.contains("if (previous?.masked == true) entry.masked = true"))
    }
}
