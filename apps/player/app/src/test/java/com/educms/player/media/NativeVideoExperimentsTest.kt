package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * The engine's switches (plan §4E): the three M43 experiments are OFF unless
 * the descriptor says exactly `true`; since 1.1.43 the vsync snap is ON and
 * the 60 Hz request AUTOMATIC unless the descriptor says `false` — the lead's
 * kill switches — and a `true` for the 60 Hz request FORCES it. Fault-latched.
 */
class NativeVideoExperimentsTest {
    @Test fun theThreeExperimentsAreOffUnlessTheDescriptorSaysExactlyTrueAndTheDefaultsStandWithoutADescriptor() {
        assertEquals(NativeVideoExperiments.NONE, NativeVideoExperiments.parse(null))
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
        // 1.1.43: the defaults ride in `requested` as what is in effect — the snap on, the 60 Hz request not switched off.
        assertTrue(j.getBoolean("vsyncSnap")); assertTrue(j.getBoolean("prefer60hz"))
        // The APK's own defaults: the three experiments off, the snap on, the 60 Hz request automatic — and
        // therefore always "something in effect" (the session report always carries the block).
        assertFalse(NativeVideoExperiments.NONE.webviewInvisible); assertFalse(NativeVideoExperiments.NONE.surfaceFrameRate); assertFalse(NativeVideoExperiments.NONE.decoderRotation)
        assertTrue(NativeVideoExperiments.NONE.vsyncSnap); assertEquals(Prefer60Hz.AUTO, NativeVideoExperiments.NONE.prefer60hz)
        assertTrue(NativeVideoExperiments.NONE.any)
    }

    @Test fun theVsyncSnapIsOnByDefaultAndOnlyAnExplicitFalseSwitchesItOff() {
        // Absent = on. `true` (the 1.1.42 positive token, still accepted) = on, nothing changes.
        assertTrue(NativeVideoExperiments.parse(null).vsyncSnap)
        assertTrue(NativeVideoExperiments.parse(JSONObject()).vsyncSnap)
        assertTrue(NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", true)).vsyncSnap)
        assertEquals(NativeVideoExperiments.parse(JSONObject()), NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", true)))
        // The kill switch: exactly a JSON `false` (the API's `-vsync-snap:<uuid|all>`).
        val off = NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", false))
        assertFalse(off.vsyncSnap)
        assertEquals(NativeVideoExperiments(vsyncSnap = false), off)
        assertFalse(off.toJson().getBoolean("vsyncSnap"))
        // Garbage is the default, never off: a malformed descriptor cannot switch the pacing off by accident.
        for (junk in listOf("false", 0, JSONObject.NULL, "off", "", JSONObject())) {
            assertTrue("$junk", NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", junk)).vsyncSnap)
        }
        // Near-miss keys enable and disable nothing.
        for (unknown in listOf("vsync-snap", "vsync_snap", "VsyncSnap", "snap")) {
            assertEquals(unknown, NativeVideoExperiments.NONE, NativeVideoExperiments.parse(JSONObject().put(unknown, false)))
        }
        assertEquals(listOf("webviewInvisible", "surfaceFrameRate", "decoderRotation", "vsyncSnap", "prefer60hz"), NativeVideoExperiments.KNOWN)
        // The fault guard covers the snap like the other presenting-session experiments; its names are stable codes.
        val g = NativeExperimentGuard()
        g.applied(NativeVideoExperiments.VSYNC_SNAP)
        assertFalse(g.ended(NativeVideoExperiments.VSYNC_SNAP, "content-changed"))
        assertTrue(g.ended(NativeVideoExperiments.VSYNC_SNAP, "output-stalled"))
        assertFalse(g.allows(NativeVideoExperiments.VSYNC_SNAP))
        assertTrue(g.allows(NativeVideoExperiments.PREFER_60HZ))
        assertEquals("output-stalled", g.toJson().getJSONObject("disabled").getString("vsyncSnap"))
    }

    @Test fun theSixtyHertzRequestIsAutomaticByDefaultFalseSwitchesItOffAndTrueForcesIt() {
        assertEquals(Prefer60Hz.AUTO, NativeVideoExperiments.parse(null).prefer60hz)
        assertEquals(Prefer60Hz.AUTO, NativeVideoExperiments.parse(JSONObject()).prefer60hz)
        assertEquals(Prefer60Hz.OFF, NativeVideoExperiments.parse(JSONObject().put("prefer60hz", false)).prefer60hz)
        assertEquals(Prefer60Hz.FORCE, NativeVideoExperiments.parse(JSONObject().put("prefer60hz", true)).prefer60hz)
        // Garbage is AUTO, never OFF and never FORCE.
        for (junk in listOf("true", "false", 1, 0, JSONObject.NULL, "force", "auto")) {
            assertEquals("$junk", Prefer60Hz.AUTO, NativeVideoExperiments.parse(JSONObject().put("prefer60hz", junk)).prefer60hz)
        }
        for (unknown in listOf("prefer-60hz", "prefer60Hz", "prefer60", "sixtyHertz")) {
            assertEquals(unknown, NativeVideoExperiments.NONE, NativeVideoExperiments.parse(JSONObject().put(unknown, true)))
        }
        // On the wire `prefer60hz` is "not switched off"; the session overrides it with what its boundary decided.
        assertTrue(NativeVideoExperiments().toJson().getBoolean("prefer60hz"))
        assertTrue(NativeVideoExperiments(prefer60hz = Prefer60Hz.FORCE).toJson().getBoolean("prefer60hz"))
        assertFalse(NativeVideoExperiments(prefer60hz = Prefer60Hz.OFF).toJson().getBoolean("prefer60hz"))
        assertEquals(listOf("off", "auto", "force"), Prefer60Hz.values().map { it.wire })
        // Both switched off together is the one shape with nothing in effect but the three experiments.
        val bare = NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", false).put("prefer60hz", false))
        assertFalse(bare.any)
        val both = NativeVideoExperiments.parse(JSONObject().put("vsyncSnap", true).put("prefer60hz", true).put("decoderRotation", true))
        assertEquals(NativeVideoExperiments(decoderRotation = true, vsyncSnap = true, prefer60hz = Prefer60Hz.FORCE), both)
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
        assertTrue("a descriptor with no experiments key gets the 1.1.43 defaults", plain.experiments.vsyncSnap)
        assertEquals(Prefer60Hz.AUTO, plain.experiments.prefer60hz)
        val flagged = FaceVideoDescriptor.parse(descriptor(JSONObject().put("webviewInvisible", true)))
        assertTrue(flagged.experiments.webviewInvisible)
        val killed = FaceVideoDescriptor.parse(descriptor(JSONObject().put("vsyncSnap", false).put("prefer60hz", false)))
        assertFalse(killed.experiments.vsyncSnap); assertEquals(Prefer60Hz.OFF, killed.experiments.prefer60hz)
        // Same identity: the page's request matches either, so a flag flip never changes what plays.
        val request = FaceVideoRequest.parse(JSONObject().put("version", 2).put("screenId", screen).put("revision", "rev-1").put("sha256", "a".repeat(64)).put("assetId", asset).toString())!!
        assertTrue(plain.matches(request)); assertTrue(flagged.matches(request)); assertTrue(killed.matches(request))
        assertEquals(plain.revision, flagged.revision); assertEquals(plain.revision, killed.revision)
        // Garbage in the experiments object is the default, never a refused descriptor.
        assertEquals(NativeVideoExperiments.NONE, FaceVideoDescriptor.parse(descriptor(JSONObject().put("webviewInvisible", "yes").put("vsyncSnap", "no"))).experiments)
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
        // 1.1.43: a stall the safety net re-graded as the mode switch's failure is TRANSIENT and never trips the guard.
        assertFalse(NativeExperimentGuard().ended("vsyncSnap", FaceVideoBox.REASON_DISPLAY_MODE_REVERTED))
    }
}
