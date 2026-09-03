package com.educms.player.heartbeat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * Native heartbeat cadence + web-telemetry suppression
 * (2026-09-02, efficiency program P0-1).
 *
 * ── WHAT THIS PROTECTS ──────────────────────────────────────────────────
 * This service and the web player were BOTH writing `Screen.lastPingAt` on
 * their own timers — 2,880 requests per screen per day from here alone. The
 * page now sends one unified telemetry POST per minute and says so via
 * `heartbeatV2`'s `telemetryOk` key, and this service drops to a 5-minute
 * liveness floor while that is true.
 *
 * The failure mode this guards is the one that would be invisible until a
 * screen went dark in the field: making "the web says it is fine" a
 * SUBSTITUTE for this process reporting at all. It is not. The page can be
 * killed, its WebView torn down, or its renderer wedged while this process
 * is healthy, and the reverse — player rule 5, never equate signals. So the
 * floor is absolute, the suppression is driven by FRESHNESS (silence is the
 * only message a dead page can still send), and a backwards clock must
 * never be able to wedge the loop shut.
 */
class HeartbeatCadenceTest {

    private val now = 1_700_000_000_000L

    // ── The pure decision ────────────────────────────────────────────────

    @Test
    fun `with no web telemetry ever reported, every iteration ticks`() {
        assertTrue(HeartbeatService.decideTick(now, lastTickAtMs = now - 60_000, webTelemetryAtMs = 0L))
    }

    @Test
    fun `while the page is reporting, we skip inside the floor`() {
        assertFalse(
            HeartbeatService.decideTick(
                nowMs = now,
                lastTickAtMs = now - 60_000,      // ticked a minute ago
                webTelemetryAtMs = now - 30_000,  // page reported 30 s ago
            ),
        )
    }

    @Test
    fun `THE FLOOR IS ABSOLUTE — past 5 minutes we tick no matter what the page claims`() {
        // The independent proof that the ANDROID PROCESS is alive. If this
        // ever became "skip while the web is happy", a page that kept
        // reporting while this process was dying would leave the fleet with
        // no evidence of the difference.
        assertTrue(
            HeartbeatService.decideTick(
                nowMs = now,
                lastTickAtMs = now - HeartbeatService.WEB_REPORTING_FLOOR_MS,
                webTelemetryAtMs = now - 1_000, // page reported one second ago
            ),
        )
    }

    @Test
    fun `a page that STOPS reporting puts us back on full cadence with no signalling`() {
        // Freshness, not a flag: a killed / wedged / auth-dead page simply
        // stops refreshing the stamp. Nothing has to tell us.
        assertTrue(
            HeartbeatService.decideTick(
                nowMs = now,
                lastTickAtMs = now - 60_000,
                webTelemetryAtMs = now - HeartbeatService.WEB_TELEMETRY_FRESH_MS,
            ),
        )
    }

    @Test
    fun `a BACKWARDS clock never wedges the loop shut`() {
        // Signage boxes step their clock on NTP sync, routinely by minutes.
        // A negative age must resolve to "tick", never to "wait forever" —
        // the latter is a screen that silently stops reporting until reboot.
        assertTrue(
            HeartbeatService.decideTick(
                nowMs = now,
                lastTickAtMs = now + 10 * 60_000, // last tick is in the future
                webTelemetryAtMs = now - 1_000,
            ),
        )
        // …and a web stamp from the future is not treated as fresh either.
        assertTrue(
            HeartbeatService.decideTick(
                nowMs = now,
                lastTickAtMs = now - 60_000,
                webTelemetryAtMs = now + 10 * 60_000,
            ),
        )
    }

    @Test
    fun `the windows keep their intended relationship`() {
        // Base cadence is the server's telemetry cadence, so a screen with
        // no web reporter still refreshes lastPingAt inside the server's
        // 100 s ONLINE grace (see apps/api/src/telemetry/online-grace.ts).
        assertEquals(60_000L, HeartbeatService.BASE_INTERVAL_MS)
        // Freshness must be a MULTIPLE of the page's 60 s cadence: two
        // dropped page reports are a blip, three is a page that stopped.
        assertTrue(HeartbeatService.WEB_TELEMETRY_FRESH_MS >= 3 * HeartbeatService.BASE_INTERVAL_MS)
        // And the floor must outlast the freshness window, or the reduced
        // cadence would never actually engage.
        assertTrue(HeartbeatService.WEB_REPORTING_FLOOR_MS > HeartbeatService.WEB_TELEMETRY_FRESH_MS)
    }

    // ── The wiring (the "112 green tests, no caller" guard) ──────────────

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

    private fun require(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `heartbeatV2 parses telemetryOk and hands it to a real callback`() {
        val src = require("src/main/java/com/educms/player/WebAppBridge.kt")
        assertTrue("heartbeatV2 no longer reads telemetryOk", src.contains("\"telemetryOk\""))
        assertTrue(
            "onWebTelemetryReported is declared but never fired",
            src.contains("onWebTelemetryReported(telemetryOk)"),
        )
    }

    @Test
    fun `MainActivity actually wires the callback to this service`() {
        // The 2026-08-14 shape: a bridge method with no lambda behind it
        // passes every unit test and does nothing on the glass.
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "onWebTelemetryReported has no MainActivity wiring",
            src.contains("onWebTelemetryReported ="),
        )
        assertTrue(
            "the wiring does not reach HeartbeatService.noteWebTelemetry",
            src.contains("HeartbeatService.noteWebTelemetry("),
        )
    }

    @Test
    fun `the run loop actually consults the tick decision`() {
        // decideTick is pure and well-tested above; that is worth nothing if
        // runLoop stops calling it.
        val src = require("src/main/java/com/educms/player/heartbeat/HeartbeatService.kt")
        assertTrue("runLoop no longer gates on shouldTickNow", src.contains("shouldTickNow(prefs)"))
        assertTrue(
            "the attempt stamp is not written, so the floor can never engage",
            src.contains("KEY_LAST_TICK_AT"),
        )
    }

    @Test
    fun `NO new bridge method was added — the three-file contract is untouched`() {
        // `telemetryOk` rides the EXISTING heartbeatV2 payload precisely so
        // this wave needs no METHODS entry, no dispatch arm, no
        // NATIVE_VOID_METHODS entry, no KNOWN_METHODS exclusion and no
        // METHOD_FLOORS gate. An APK older than this one ignores the key and
        // keeps its current cadence — correct on an old APK, not a
        // degradation. If someone later turns this into a real method, the
        // web-side canary count in nativeBridge.test.ts must move with it.
        val src = require("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        val allowlist = Regex("private val METHODS = arrayOf\\(([\\s\\S]*?)\\n\\s*\\)")
            .find(src)?.groupValues?.get(1)
        Assume.assumeTrue("METHODS block not found", allowlist != null)
        assertFalse(
            "a telemetry bridge method appeared without the three-file contract",
            allowlist!!.contains("telemetry"),
        )
    }
}
