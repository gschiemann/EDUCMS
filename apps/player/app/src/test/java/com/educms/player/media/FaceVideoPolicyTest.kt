package com.educms.player.media

import android.media.MediaCodec
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Protocol 2 — independent per-face native video (FaceVideoPolicy.kt). */
class FaceVideoPolicyTest {
    private val screen = "11111111-1111-4111-8111-111111111111"
    private val tenant = "22222222-2222-4222-8222-222222222222"
    private val asset = "33333333-3333-4333-8333-333333333333"
    private val sha = "a".repeat(64)
    private val url = "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/t/clip.mp4"

    private fun descriptor(face: Int = 0, fit: String = "cover", mutate: (JSONObject) -> Unit = {}) = JSONObject()
        .put("version", 2).put("screenId", screen).put("tenantId", tenant).put("faceIndex", face).put("revision", "rev-1")
        .put("asset", JSONObject().put("id", asset).put("url", url).put("sha256", sha).put("size", 1000)
            .put("width", 1920).put("height", 1080).put("fps", 30))
        .put("transform", JSONObject().put("orientation", "LANDSCAPE").put("fit", fit)).also(mutate)

    private fun request(version: Int = 2, s: String = screen, r: String = "rev-1", h: String = sha, a: String = asset) =
        JSONObject().put("version", version).put("screenId", s).put("revision", r).put("sha256", h).put("assetId", a).toString()

    @Test fun pageRequestCarriesIdentityOnlyAndOnlyVersion2SelectsThisEngine() {
        assertNotNull(FaceVideoRequest.parse(request()))
        // Protocol 1 (the pair engine) must keep flowing to SharedVideoBox untouched.
        assertNull(FaceVideoRequest.parse(request(version = 1)))
        assertNull(FaceVideoRequest.parse(request(s = "not-a-uuid")))
        assertNull(FaceVideoRequest.parse(request(h = "xyz")))
        assertNull(FaceVideoRequest.parse("{" + " ".repeat(2000) + "}"))
        assertNull(FaceVideoRequest.parse("garbage"))
    }

    @Test fun nativePlaysOnlyWhatThisFacesOwnManifestSelected() {
        val d = FaceVideoDescriptor.parse(descriptor())
        assertTrue(d.matches(FaceVideoRequest.parse(request())!!))
        assertFalse(d.matches(FaceVideoRequest.parse(request(r = "rev-2"))!!))
        assertFalse(d.matches(FaceVideoRequest.parse(request(h = "b".repeat(64)))!!))
        assertFalse(d.matches(FaceVideoRequest.parse(request(a = "44444444-4444-4444-8444-444444444444"))!!))
    }

    @Test fun descriptorRefusesEverythingOutsideTheContract() {
        for ((name, mutate) in listOf<Pair<String, (JSONObject) -> Unit>>(
            "v1" to { it.put("version", 1) },
            "face" to { it.put("faceIndex", 2) },
            "fps" to { it.getJSONObject("asset").put("fps", 60) },
            "size" to { it.getJSONObject("asset").put("size", 0) },
            "width" to { it.getJSONObject("asset").put("width", 8192) },
            "origin" to { it.getJSONObject("asset").put("url", "https://evil.example/storage/v1/object/public/assets/x.mp4") },
            "fit" to { it.getJSONObject("transform").put("fit", "zoom") },
            "orientation" to { it.getJSONObject("transform").put("orientation", "UPSIDE") },
        )) assertTrue(name, runCatching { FaceVideoDescriptor.parse(descriptor(mutate = mutate)) }.isFailure)
        for (fit in listOf("cover", "contain", "fill")) assertEquals(fit, FaceVideoDescriptor.parse(descriptor(fit = fit)).fit)
        assertEquals(1, FaceVideoDescriptor.parse(descriptor(face = 1)).faceIndex)
    }

    @Test fun coverCropsOnTheCompositorAndNeverStretches() {
        assertEquals(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING, FaceVideoPolicy.scalingMode("cover"))
        assertEquals(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT, FaceVideoPolicy.scalingMode("contain"))
        assertEquals(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT, FaceVideoPolicy.scalingMode("fill"))
        // cover/fill always occupy the whole face.
        assertArrayEquals(intArrayOf(0, 0, 1920, 1080), FaceVideoPolicy.frame("cover", 1080, 1920, 0, 1920, 1080))
        assertArrayEquals(intArrayOf(0, 0, 1920, 1080), FaceVideoPolicy.frame("fill", 1080, 1920, 0, 1920, 1080))
    }

    @Test fun containLetterboxesProportionTrueIncludingRotatedPortraitFaces() {
        // Portrait clip on a landscape face, no rotation: pillarbox.
        assertArrayEquals(intArrayOf(656, 0, 608, 1080), FaceVideoPolicy.frame("contain", 1080, 1920, 0, 1920, 1080))
        // Same face rotated 90 for a PORTRAIT screen: the clip now fills it exactly.
        assertArrayEquals(intArrayOf(0, 0, 1920, 1080), FaceVideoPolicy.frame("contain", 1080, 1920, 90, 1920, 1080))
        // Landscape 4:3 clip on a 16:9 face: pillarbox.
        assertArrayEquals(intArrayOf(240, 0, 1440, 1080), FaceVideoPolicy.frame("contain", 1440, 1080, 0, 1920, 1080))
        // Ultra-wide on 16:9: letterbox.
        assertArrayEquals(intArrayOf(0, 135, 1920, 810), FaceVideoPolicy.frame("contain", 2560, 1080, 0, 1920, 1080))
    }

    @Test fun twoFacesTwoDecodersAndTheCodecsOwnLimitCanOnlyLowerIt() {
        assertTrue(FaceVideoPolicy.decoderAllowed(0, 16))
        assertTrue(FaceVideoPolicy.decoderAllowed(1, 16))
        assertFalse(FaceVideoPolicy.decoderAllowed(2, 16))
        assertFalse(FaceVideoPolicy.decoderAllowed(1, 1))
        // Unknown limit: one decoder, never an optimistic guess.
        assertTrue(FaceVideoPolicy.decoderAllowed(0, 0))
        assertFalse(FaceVideoPolicy.decoderAllowed(1, 0))
    }

    @Test fun twoFacesPlayingDifferentFilesNeverEvictEachOther() {
        val files = listOf("a" to 1L, "b" to 2L, "c" to 3L, "d" to 4L)
        assertEquals(setOf("a", "b"), FaceVideoPolicy.prune(files, pinned = setOf("x"), keepExtra = 2))
        assertEquals(setOf("a"), FaceVideoPolicy.prune(files, pinned = setOf("c", "b"), keepExtra = 1))
        assertEquals(emptySet<String>(), FaceVideoPolicy.prune(files, pinned = setOf("a", "b", "c", "d")))
    }

    @Test fun transientEndsRetryButAFaultyFileDoesNot() {
        for (r in listOf("emergency-held", "activity-paused", "page-lease-expired", "content-changed"))
            assertTrue(r, FaceVideoPolicy.transient(r))
        for (r in listOf("codec-failed", "codec-stalled", "hardware-codec-unavailable", "output-stalled", "media-digest"))
            assertFalse(r, FaceVideoPolicy.transient(r))
    }

    @Test fun seamlessLoopContinuesTheTimelineOneFrameAfterTheLastPicture() {
        val t = LoopTimeline(33_333)
        // Lap 0 (decode order with a B-frame): 0, 66666, 33333, 99999.
        assertEquals(0L, t.queue(0)); assertEquals(66_666L, t.queue(66_666))
        assertEquals(33_333L, t.queue(33_333)); assertEquals(99_999L, t.queue(99_999))
        assertTrue(t.wrap())
        // Lap 1 starts one frame after lap 0's LAST picture, keeping the reorder.
        assertEquals(133_332L, t.queue(0)); assertEquals(199_998L, t.queue(66_666))
        assertEquals(166_665L, t.queue(33_333)); assertEquals(233_331L, t.queue(99_999))
        assertTrue(t.wrap())
        assertEquals(266_664L, t.queue(0))
        assertEquals(2L, t.laps)
    }

    @Test fun aFileThatStartsLateStillLoopsWithoutAGap() {
        val t = LoopTimeline(40_000)
        assertEquals(80_000L, t.queue(80_000)); assertEquals(120_000L, t.queue(120_000))
        assertTrue(t.wrap())
        assertEquals(160_000L, t.queue(80_000))
    }

    @Test fun anEmptyLapIsAFaultNotASpin() {
        val t = LoopTimeline(33_333)
        assertFalse(t.wrap())
        t.queue(0); assertTrue(t.wrap()); assertFalse(t.wrap())
    }
}
