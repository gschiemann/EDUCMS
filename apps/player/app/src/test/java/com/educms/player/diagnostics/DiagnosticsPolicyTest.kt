package com.educms.player.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.util.TimeZone
import java.util.concurrent.Executors

/** SCREEN DIAGNOSTICS (2026-11-08): parse, run-once by value, masking, timeouts, the storage header, the wiring. */
class DiagnosticsPolicyTest {

    private val id = "3f2b8c1e-9a4d-4e7b-8f10-2a3b4c5d6e7f"

    @Test
    fun `parses the request and clamps minutes, anything else is silence`() {
        assertEquals(DiagnosticsPolicy.Request(id, DiagnosticsPolicy.Kind.SELF_TEST, 0), DiagnosticsPolicy.parse(id, "SELF_TEST", null))
        assertEquals(60, DiagnosticsPolicy.parse(id, "LOGS", 500)!!.minutes)
        assertEquals(5, DiagnosticsPolicy.parse(id, "LOGS", 1)!!.minutes)
        assertEquals(15, DiagnosticsPolicy.parse(id, "LOGS", null)!!.minutes)
        assertNull(DiagnosticsPolicy.parse("not-an-id", "SELF_TEST", null))
        assertNull(DiagnosticsPolicy.parse(id, "REBOOT", null))
        assertNull(DiagnosticsPolicy.parse(null, "LOGS", null))
    }

    @Test
    fun `an id runs once — acknowledged by value, never by clock`() {
        val r = DiagnosticsPolicy.parse(id, "SELF_TEST", null)!!
        assertTrue(DiagnosticsPolicy.shouldRun(r, doneId = null, startedId = null, startedCount = 0))
        assertFalse(DiagnosticsPolicy.shouldRun(r, doneId = id, startedId = null, startedCount = 0))
        // A run killed mid-way (process death) is retried once, then given up.
        assertTrue(DiagnosticsPolicy.shouldRun(r, doneId = null, startedId = id, startedCount = 1))
        assertFalse(DiagnosticsPolicy.shouldRun(r, doneId = null, startedId = id, startedCount = 2))
        // A different (newer) id always runs.
        val other = DiagnosticsPolicy.parse("00000000-0000-4000-8000-000000000001", "SELF_TEST", null)!!
        assertTrue(DiagnosticsPolicy.shouldRun(other, doneId = id, startedId = id, startedCount = 2))
    }

    @Test
    fun `addresses are masked and classified, never sent whole`() {
        assertEquals("192.168.x.x", DiagnosticsPolicy.maskIpv4("192.168.1.44"))
        assertEquals("10.20.x.x", DiagnosticsPolicy.maskIpv4("10.20.30.40"))
        assertEquals("8.x.x.x", DiagnosticsPolicy.maskIpv4("8.8.8.8"))
        assertNull(DiagnosticsPolicy.maskIpv4("fe80::1"))
        assertNull(DiagnosticsPolicy.maskIpv4("999.1.1.1"))
        assertEquals(DiagnosticsPolicy.IpKind.PRIVATE, DiagnosticsPolicy.ipv4Kind("172.16.0.9"))
        assertEquals(DiagnosticsPolicy.IpKind.CGNAT, DiagnosticsPolicy.ipv4Kind("100.70.1.1"))
        assertEquals(DiagnosticsPolicy.IpKind.LINK_LOCAL, DiagnosticsPolicy.ipv4Kind("169.254.3.3"))
        assertEquals(DiagnosticsPolicy.IpKind.PUBLIC, DiagnosticsPolicy.ipv4Kind("203.0.113.5"))
        assertEquals(DiagnosticsPolicy.IpKind.NONE, DiagnosticsPolicy.ipv4Kind(null))
    }

    @Test
    fun `a probe that hangs is abandoned at its timeout and reported as such`() {
        val pool = Executors.newSingleThreadExecutor()
        try {
            var err = ""
            val t0 = System.nanoTime()
            val out = DiagnosticsPolicy.bounded(pool, 150L, { err = it }) { Thread.sleep(5_000); "never" }
            val ms = (System.nanoTime() - t0) / 1_000_000
            assertNull(out)
            assertEquals("timeout", err)
            assertTrue("returned after ${ms}ms", ms < 2_000)
            var err2 = ""
            assertNull(DiagnosticsPolicy.bounded(pool, 1_000L, { err2 = it }) { throw java.net.UnknownHostException("api.example.com") })
            // The CODE, never the message (which can carry a host or URL).
            assertEquals("UnknownHostException", err2)
            assertEquals("ok", DiagnosticsPolicy.bounded(pool, 1_000L) { "ok" })
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `the storage report is due every 30 minutes and survives a clock step back`() {
        assertTrue(DiagnosticsPolicy.storageReportDue(1_000L, 0L))
        assertFalse(DiagnosticsPolicy.storageReportDue(1_000_000L, 1_000_000L - 60_000L))
        assertTrue(DiagnosticsPolicy.storageReportDue(1_000_000L + DiagnosticsPolicy.STORAGE_REPORT_EVERY_MS, 1_000_000L))
        assertTrue(DiagnosticsPolicy.storageReportDue(5_000L, 10_000L))
        assertEquals(
            "{\"schema\":1,\"freeBytes\":10,\"totalBytes\":20,\"writeOk\":true,\"writeMs\":3}",
            DiagnosticsPolicy.storageHeader(10, 20, true, 3),
        )
        assertEquals("{\"schema\":1,\"freeBytes\":10,\"totalBytes\":20}", DiagnosticsPolicy.storageHeader(10, 20, null, null))
    }

    @Test
    fun `logcat since is the device's local wall time minus the window`() {
        val utc = TimeZone.getTimeZone("UTC")
        // 2026-11-08T12:30:00Z minus 15 min
        assertEquals("11-08 12:15:00.000", DiagnosticsPolicy.logcatSince(1_794_141_000_000L, 15, utc))
        assertEquals(120, DiagnosticsPolicy.webViewMajor("120.0.6099.230"))
        assertNull(DiagnosticsPolicy.webViewMajor("unknown"))
    }

    // ─── wiring: additive, never on the emergency path ────────────────────

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

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `the heartbeat carries the storage header and hands the reply to diagnostics, each isolated`() {
        val hb = read("src/main/java/com/educms/player/heartbeat/HeartbeatService.kt")
        assertTrue(hb.contains("ScreenDiagnostics.storageHeaderIfDue(applicationContext, prefs)"))
        assertTrue(hb.contains("ScreenDiagnostics.accept(applicationContext, prefs, JSONObject(body))"))
    }

    @Test
    fun `the diagnostics package never touches emergency, the content store or the WebView`() {
        val dir = "src/main/java/com/educms/player/diagnostics/"
        for (f in listOf("ScreenDiagnostics.kt", "DiagnosticsProbes.kt", "LogCollector.kt", "DiagnosticsPolicy.kt", "LogRedaction.kt")) {
            // Code only — the comments are allowed to SAY they never touch it.
            val src = read(dir + f).lines().filterNot { val t = it.trim(); t.startsWith("*") || t.startsWith("//") || t.startsWith("/**") }.joinToString("\n")
            for (banned in listOf("DisplayEmergency", "mergency","NativeAlertWatch.", "store.", "evaluateJavascript", "loadUrl(", "putString(\"device_token\"")) {
                assertFalse("$f must not reference $banned", src.contains(banned))
            }
        }
    }
}
