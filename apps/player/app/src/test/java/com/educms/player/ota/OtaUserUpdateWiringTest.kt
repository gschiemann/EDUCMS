package com.educms.player.ota

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ⚠️ THE CALL-SITE GUARD FOR THE PANEL'S OWN UPDATE BUTTON.
 *
 * THE FAILURE THIS EXISTS TO PREVENT — it already happened once, in the
 * other direction. On 2026-08-14 the display-control layer shipped with
 * 112 passing tests and NO CALLER: everything compiled, everything was
 * covered, and no screen could execute any of it. The server half of the
 * panel-update feature (`6f367a9b`) then sat live in production for a
 * fortnight with the same shape — a `source:"user"` branch that nothing on
 * earth ever sent.
 *
 * The player half is exactly the kind of change that can be "finished"
 * while remaining inert, because BOTH of its halves are invisible to a
 * unit test on a plain JVM:
 *
 *   1. THE FLAG. `source:"user"` must ride the HUMAN path only. If it
 *      leaks onto the periodic worker, every background tick fleet-wide
 *      inherits a rollout-hold bypass — the opposite of the pacing the
 *      canary exists for. There are API specs pinning the server side of
 *      that split (apps/api/src/player-ota/update-check-authz.spec.ts).
 *   2. THE TOKEN. The server honours `source:"user"` ONLY for a request
 *      that proves it is this screen. Send the flag with no
 *      `Authorization` header and it is dropped on the floor with no error
 *      anywhere — the tap on the glass silently stays gated, which is the
 *      precise silent-failure class this release exists to end. A flag
 *      without a token is WORSE than no feature, because it looks done.
 *
 * So this suite asserts the WIRING, reading the source tree the same way
 * `DeviceAdminWiringTest` and the web side's `nativeBridge.test.ts` drift
 * guard do. Skipped (not failed) when the sources are not on disk, so a
 * jar-only checkout still runs green.
 */
class OtaUserUpdateWiringTest {

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

    private fun worker() = require("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt")
    private fun playerApp() = require("src/main/java/com/educms/player/PlayerApp.kt")
    private fun bridge() = require("src/main/java/com/educms/player/WebAppBridge.kt")
    private fun channel() = require("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
    private fun mainActivity() = require("src/main/java/com/educms/player/MainActivity.kt")

    // ─── 1. the flag rides the human path, and only that ────────────

    @Test
    fun `the worker sends source=user only when its input data says so`() {
        val src = worker()
        assertTrue(
            "the worker must read the source off WorkManager inputData — that is the ONLY " +
                "channel that distinguishes the one-shot human request from the periodic tick",
            src.contains("inputData.getString(KEY_SOURCE)"),
        )
        assertTrue(
            "the payload's `source` must be conditional on that read; an unconditional put " +
                "hands every background poll an operator-authorization bypass",
            Regex("""if\s*\(userInitiated\)\s*put\("source",\s*SOURCE_USER\)""").containsMatchIn(src),
        )
        assertTrue("SOURCE_USER must be the literal the server matches", src.contains("\"user\""))
    }

    @Test
    fun `the periodic worker request carries no input data at all`() {
        val src = playerApp()
        val periodic = src.substringAfter("PeriodicWorkRequestBuilder<OtaUpdateWorker>")
            .substringBefore("enqueueUniquePeriodicWork")
        assertFalse(
            "the 6-hourly tick must stay UNSTAMPED — a source on it would bypass the rollout " +
                "hold fleet-wide, every six hours, unattended",
            periodic.contains("setInputData"),
        )
    }

    @Test
    fun `fireOtaCheckNow stamps the source only for a user-initiated call`() {
        val src = playerApp()
        assertTrue(
            "the one-shot must default to the GATED path so every existing relay caller " +
                "(WS push, manifest poll, boot catch-up) keeps the behaviour it shipped with",
            Regex("""fun fireOtaCheckNow\(ctx: Context, userInitiated: Boolean = false\)""")
                .containsMatchIn(src),
        )
        assertTrue(
            "the input data must be gated on the flag",
            Regex("""if\s*\(userInitiated\)\s*\{[\s\S]{0,400}?setInputData""").containsMatchIn(src),
        )
        assertTrue(
            "it must stamp the worker's own constants, not a re-typed string",
            src.contains("OtaUpdateWorker.KEY_SOURCE") && src.contains("OtaUpdateWorker.SOURCE_USER"),
        )
    }

    @Test
    fun `the bridge exposes two distinct methods and only one of them is authorized`() {
        val src = bridge()
        assertTrue(
            "the relay method must keep passing false " +
                "(SEC-002 inserted a nonce gate ahead of the call; the FLAG must not move)",
            Regex("""fun checkForUpdates\(\): String \{[\s\S]{0,200}?onCheckForUpdates\(false\)""")
                .containsMatchIn(src),
        )
        assertTrue(
            "the human method must exist — `nativeHas` on its name is also the web side's " +
                "v1.1.5-or-newer probe",
            src.contains("fun checkForUpdatesUserInitiated(): String"),
        )
        // SEC-002 — the nonce-bearing overloads must preserve the SAME
        // split. Collapsing them (or letting the relay overload pass true)
        // would hand every automated caller a rollout-hold bypass through
        // the back door.
        assertTrue(
            "the nonce-bearing relay overload must also pass false",
            Regex("""fun checkForUpdates\(nonce: String\): String \{[\s\S]{0,200}?onCheckForUpdates\(false\)""")
                .containsMatchIn(src),
        )
        assertTrue(
            "the nonce-bearing human overload must exist and pass true",
            Regex(
                """fun checkForUpdatesUserInitiated\(nonce: String\): String \{[\s\S]{0,300}?onCheckForUpdates\(true\)""",
            ).containsMatchIn(src),
        )
        assertTrue(
            "…and it is the ONLY entry point allowed to pass true",
            src.contains("onCheckForUpdates(true)"),
        )
    }

    @Test
    fun `both new bridge methods are reachable over the secure channel`() {
        val src = channel()
        listOf("checkForUpdatesUserInitiated", "setDeviceToken").forEach { method ->
            assertTrue(
                "\"$method\" is missing from NativeBridgeChannel.METHODS — the channel " +
                    "replies \"unknown method\" and the arm is unreachable on every " +
                    "channel-transport box (the 2026-08-13 probeDisplay bug, exactly)",
                Regex(""""$method",""").containsMatchIn(src),
            )
            assertTrue(
                "\"$method\" has no dispatch arm",
                src.contains(""""$method" -> """),
            )
        }
    }

    // ─── 2. the token, without which the flag is a no-op ────────────

    @Test
    fun `the worker attaches the device token to update-check`() {
        val src = worker()
        assertTrue(
            "without an Authorization header the server cannot prove this is the screen it " +
                "claims to be, so `source:\"user\"` is IGNORED and the panel button silently " +
                "stays gated — a feature that looks shipped and does nothing",
            src.contains("""setRequestProperty("Authorization", "Bearer ${'$'}it")"""),
        )
        assertTrue(
            "the token is read at the point of USE from prefs, never captured — it rotates, " +
                "and this worker outlives the page that wrote it",
            src.contains("""getString("device_token", null)"""),
        )
    }

    @Test
    fun `MainActivity persists a device token only after a syntax check`() {
        val src = mainActivity()
        assertTrue(
            "the bridge is reachable from every frame, and this value is concatenated into " +
                "an Authorization header — a shape check is what stops a hostile board " +
                "smuggling a CR/LF and a second header into a request to an allowlisted host",
            src.contains("DEVICE_TOKEN_RE.matches"),
        )
        assertTrue(
            "an empty push is the unpair signal and must CLEAR the stored token rather than " +
                "leaving one for a screen this box is no longer paired to",
            src.contains("""remove("device_token")"""),
        )
        assertTrue(
            src.contains("""putString("device_token", clean)"""),
        )
    }

    @Test
    fun `no bridge surface can read a stored device token back out`() {
        // WRITE-ONLY is the whole security argument for putting the setter
        // on the legacy every-frame transport (which the Chromium-83
        // Taurus boxes are stuck on). A getter would hand any board iframe
        // this screen's credentials.
        listOf(bridge(), channel()).forEach { src ->
            assertFalse(
                "a device-token GETTER on a bridge surface would expose this screen's " +
                    "credentials to every frame the WebView loads, including operator-authored " +
                    "board HTML",
                Regex("""fun getDeviceToken|"getDeviceToken"""").containsMatchIn(src),
            )
        }
    }
}
