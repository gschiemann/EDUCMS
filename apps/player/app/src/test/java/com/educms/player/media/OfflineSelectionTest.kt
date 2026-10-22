package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * A NATIVE-FIRST FACE STARTS WITHOUT THE API (1.1.51, Astra P1): the persisted
 * last authenticated selection, emergency first; a refused credential never
 * plays from disk. One case per rule, plus the wiring into FaceVideoBox.
 */
class OfflineSelectionTest {
    private val screen = "11111111-1111-4111-8111-111111111111"
    private val other = "99999999-9999-4999-8999-999999999999"
    private val tenant = "22222222-2222-4222-8222-222222222222"
    private val asset = "33333333-3333-4333-8333-333333333333"
    private val sha = "a".repeat(64)
    private val url = "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/t/clip.mp4"

    private fun descriptor(face: Int = 0, revision: String = "rev-1") = JSONObject()
        .put("version", 2).put("screenId", screen).put("tenantId", tenant).put("faceIndex", face).put("revision", revision)
        .put("asset", JSONObject().put("id", asset).put("url", url).put("sha256", sha).put("size", 1000)
            .put("width", 1920).put("height", 1080).put("fps", 30))
        .put("transform", JSONObject().put("orientation", "LANDSCAPE").put("fit", "fill"))

    private fun request(revision: String = "rev-1") = FaceVideoRequest(screen, revision, sha, asset)
    private fun saved(face: Int = 0, screenId: String = screen, d: JSONObject = descriptor()) =
        OfflineSelection.decode(OfflineSelection.encode(face, screenId, d, 1_000L))

    @Test fun `the persisted selection round-trips and an unknown version is refused`() {
        val s = saved()!!
        assertEquals(0, s.face)
        assertEquals(screen, s.screenId)
        assertEquals(1_000L, s.savedAtMs)
        assertNull(OfflineSelection.decode(null))
        assertNull(OfflineSelection.decode("garbage"))
        assertNull(OfflineSelection.decode(JSONObject().put("v", 99).put("face", 0).put("screen", screen).put("nativeVideo", descriptor()).toString()))
    }

    @Test fun `the happy path - the credential still names the screen, the selection is what the page asked for`() {
        val out = OfflineSelection.accept(saved(), 0, screen, request(), held = false)
        assertEquals("ok", out.reason)
        assertNotNull(out.descriptor)
        assertEquals(sha, out.descriptor!!.sha256)
    }

    @Test fun `EMERGENCY FIRST - a persisted hold refuses before anything else is looked at`() {
        assertEquals("emergency-held", OfflineSelection.accept(saved(), 0, screen, request(), held = true).reason)
        assertEquals("emergency-held", OfflineSelection.accept(null, 0, null, request(), held = true).reason)
    }

    @Test fun `no credential, or a credential for another screen, never plays from disk`() {
        assertEquals("credential-missing", OfflineSelection.accept(saved(), 0, null, request(), held = false).reason)
        assertEquals("credential-identity", OfflineSelection.accept(saved(), 0, other, request(), held = false).reason)
    }

    @Test fun `the selection must be this face's, this screen's, and exactly what the page asked for`() {
        assertEquals("no-saved-selection", OfflineSelection.accept(null, 0, screen, request(), held = false).reason)
        assertEquals("selection-face", OfflineSelection.accept(saved(face = 1), 0, screen, request(), held = false).reason)
        assertEquals("selection-screen", OfflineSelection.accept(saved(screenId = other), 0, screen, request(), held = false).reason)
        assertEquals("selection-changed", OfflineSelection.accept(saved(d = descriptor(revision = "rev-2")), 0, screen, request(), held = false).reason)
        assertEquals("selection-changed", OfflineSelection.accept(saved(d = descriptor(face = 1)), 0, screen, request(), held = false).reason)
        assertEquals("descriptor-invalid", OfflineSelection.accept(saved(d = JSONObject().put("version", 1)), 0, screen, request(), held = false).reason)
    }

    @Test fun `only an UNREACHABLE API falls back - a refused credential, screen or descriptor never does`() {
        assertTrue(OfflineSelection.unreachable(IOException("Unable to resolve host")))
        assertTrue(OfflineSelection.unreachable(java.net.SocketTimeoutException("timeout")))
        assertTrue(OfflineSelection.unreachable(IllegalStateException("manifest-unreachable")))
        assertTrue(OfflineSelection.unreachable(IllegalArgumentException("manifest-http-503")))
        assertTrue(OfflineSelection.unreachable(IllegalArgumentException("manifest-http-429")))
        for (refused in listOf("manifest-http-401", "manifest-http-403", "manifest-http-404", "credential-missing", "credential-identity",
            "credential-changed", "api-root", "api-origin", "descriptor-version", "selection-changed", "manifest-too-large")) {
            assertFalse(refused, OfflineSelection.unreachable(IllegalArgumentException(refused)))
        }
        // An exception with a prose message that is not an IOException is not "unreachable" either.
        assertFalse(OfflineSelection.unreachable(IllegalStateException("Something odd happened")))
    }

    // ─── wiring (source facts; skipped, not failed, off-disk) ─────────────

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun source(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }
    }

    @Test fun `FaceVideoBox selects live first, persists every live selection, and falls back only through OfflineSelection`() {
        val box = source("src/main/java/com/educms/player/media/FaceVideoBox.kt")
        val at = box.indexOf("private fun select(host: SharedVideoHost, s: FaceVideoSession)")
        assertTrue(at >= 0)
        val select = box.substring(at, box.indexOf("private fun fetch(", at))
        assertTrue("live read first", select.indexOf("SharedVideoSource(host.ctx).manifest(host.face, s.screenId)") < select.indexOf("OfflineSelection.unreachable(e)"))
        assertTrue("a positioned slot never starts from disk", select.contains("if (s.zone != null || !OfflineSelection.unreachable(e)) throw e"))
        assertTrue("the hold is asked at the decision", select.contains("DisplayEmergency.isHeld(host.ctx)"))
        assertTrue("the credential is re-read, never the page's", select.contains("FaceTokenStore.read(host.ctx, host.face)"))
        assertTrue("every live selection is remembered", select.contains("OfflineSelection.encode(host.face, s.screenId, raw"))
        val fallback = select.substring(select.indexOf("catch (e: Exception)"), select.indexOf("val zone = s.zone"))
        assertFalse("a cached selection teaches the switch nothing", fallback.contains("learnSwitch("))
        assertTrue("the live failure's own code is what the page sees when nothing is usable", fallback.contains("throw e"))
    }
}
