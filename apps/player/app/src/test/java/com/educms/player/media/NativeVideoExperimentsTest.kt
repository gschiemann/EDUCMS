package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The three M43 experiments (plan §4E): manifest flags, default off, individually switchable, fault-latched. */
class NativeVideoExperimentsTest {
    @Test fun everyExperimentIsOffUnlessTheDescriptorSaysExactlyTrue() {
        assertEquals(NativeVideoExperiments.NONE, NativeVideoExperiments.parse(null))
        assertFalse(NativeVideoExperiments.parse(null).any)
        assertEquals(NativeVideoExperiments.NONE, NativeVideoExperiments.parse(JSONObject()))
        assertEquals(NativeVideoExperiments.NONE, NativeVideoExperiments.parse(JSONObject().put("webviewInvisible", "true").put("surfaceFrameRate", 1).put("decoderRotation", JSONObject.NULL)))
        val one = NativeVideoExperiments.parse(JSONObject().put("surfaceFrameRate", true).put("somethingNew", true))
        assertEquals(NativeVideoExperiments(surfaceFrameRate = true), one)
        assertTrue(one.any)
        assertFalse(one.webviewInvisible); assertFalse(one.decoderRotation)
        val all = NativeVideoExperiments.parse(JSONObject().put("webviewInvisible", true).put("surfaceFrameRate", true).put("decoderRotation", true))
        assertEquals(NativeVideoExperiments(true, true, true), all)
        val j = all.toJson()
        for (k in listOf("webviewInvisible", "surfaceFrameRate", "decoderRotation")) assertTrue(k, j.getBoolean(k))
    }

    @Test fun theDescriptorCarriesTheFlagsOutsideItsIdentity() {
        val screen = "11111111-1111-4111-8111-111111111111"; val tenant = "22222222-2222-4222-8222-222222222222"
        val asset = "33333333-3333-4333-8333-333333333333"
        fun descriptor(experiments: JSONObject?) = JSONObject()
            .put("version", 2).put("screenId", screen).put("tenantId", tenant).put("faceIndex", 0).put("revision", "rev-1")
            .put("asset", JSONObject().put("id", asset).put("url", "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/t/clip.mp4")
                .put("sha256", "a".repeat(64)).put("size", 1000).put("width", 1920).put("height", 1080).put("fps", 30))
            .put("transform", JSONObject().put("orientation", "LANDSCAPE").put("fit", "fill"))
            .also { if (experiments != null) it.put("experiments", experiments) }
        val plain = FaceVideoDescriptor.parse(descriptor(null))
        assertEquals(NativeVideoExperiments.NONE, plain.experiments)
        val flagged = FaceVideoDescriptor.parse(descriptor(JSONObject().put("webviewInvisible", true)))
        assertTrue(flagged.experiments.webviewInvisible)
        // Same identity: the page's request matches either, so a flag flip never changes what plays.
        val request = FaceVideoRequest.parse(JSONObject().put("version", 2).put("screenId", screen).put("revision", "rev-1").put("sha256", "a".repeat(64)).put("assetId", asset).toString())!!
        assertTrue(plain.matches(request)); assertTrue(flagged.matches(request))
        assertEquals(plain.revision, flagged.revision)
        // Garbage in the experiments object is OFF, never a refused descriptor.
        assertEquals(NativeVideoExperiments.NONE, FaceVideoDescriptor.parse(descriptor(JSONObject().put("webviewInvisible", "yes"))).experiments)
    }

    @Test fun theGuardTripsOnceOnAFaultTheHiddenPageCouldHaveCausedAndNeverOnAnOrdinaryEnd() {
        val g = NativeExperimentGuard()
        assertTrue(g.allows("webviewInvisible"))
        g.applied("webviewInvisible")
        for (ordinary in listOf("page-stopped", "content-changed", "emergency-held", "activity-paused", "document-retired", "host-detached")) {
            assertFalse(ordinary, g.ended("webviewInvisible", ordinary))
            assertTrue(ordinary, g.allows("webviewInvisible"))
        }
        assertTrue(g.ended("webviewInvisible", "page-lease-expired"))
        assertFalse(g.allows("webviewInvisible"))
        assertEquals("page-lease-expired", g.disabledReason("webviewInvisible"))
        // Tripped once; a second fault does not re-report, and other experiments are untouched.
        assertFalse(g.ended("webviewInvisible", "output-stalled"))
        assertTrue(g.allows("surfaceFrameRate"))
        assertNull(g.disabledReason("surfaceFrameRate"))
        val j = g.toJson()
        assertEquals("page-lease-expired", j.getJSONObject("disabled").getString("webviewInvisible"))
        assertEquals(1L, j.getJSONObject("applied").getLong("webviewInvisible"))
        for (fault in NativeExperimentGuard.FAULTS) assertTrue(fault, NativeExperimentGuard().ended("surfaceFrameRate", fault))
    }
}
