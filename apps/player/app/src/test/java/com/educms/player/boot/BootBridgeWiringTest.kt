package com.educms.player.boot

import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE CALL-SITE GUARD for the boot + registration proof (2026-09-02, P0-2).
 *
 * A bridge method is a THREE-FILE ATOMIC CONTRACT (CLAUDE.md player rule
 * 9): the Kotlin `METHODS` allowlist, its dispatch arm, and the web's
 * method table. Missing one of the three fails ASYMMETRICALLY — it still
 * works over the legacy every-frame object and is silently dropped on the
 * origin-scoped channel, which is the hardest version of this bug to find
 * in the field. The web side's `nativeBridge.test.ts` guards the same
 * contract from the other direction; this is the half that runs in the APK
 * build, so a Kotlin-only edit cannot go green here and red only in CI.
 *
 * It also guards the two things that would make this whole feature inert:
 * a `WebAppBridge` method with no `MainActivity` lambda behind it (the
 * 2026-08-14 "112 green tests, no caller" shape), and a tracker that is
 * never re-armed by `loadPlayer`.
 *
 * Skipped (not failed) when the sources are not on disk.
 */
class BootBridgeWiringTest {

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

    private val methods = listOf("bootProof", "registerAttempt", "registerResult")

    @Test
    fun `all three methods are in the channel allowlist AND its dispatch`() {
        val src = require("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        val allowlist = Regex("private val METHODS = arrayOf\\(([\\s\\S]*?)\\n\\s*\\)")
            .find(src)?.groupValues?.get(1)
        Assume.assumeTrue("METHODS block not found", allowlist != null)
        methods.forEach {
            assertTrue("\"$it\" missing from NativeBridgeChannel.METHODS", allowlist!!.contains("\"$it\""))
            assertTrue("\"$it\" has no dispatch arm", src.contains("\"$it\" ->"))
        }
    }

    @Test
    fun `all three are exposed on the legacy surface too — Taurus has no channel`() {
        // Chromium-83/87 NovaStar panels cannot attach the origin-scoped
        // channel at all, so a channel-only method does not exist for them.
        val src = require("src/main/java/com/educms/player/WebAppBridge.kt")
        methods.forEach {
            assertTrue("no @JavascriptInterface fun $it", src.contains("fun $it("))
        }
        assertTrue(src.contains("@JavascriptInterface"))
    }

    @Test
    fun `the Activity actually wires all three lambdas — no inert feature`() {
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue("onBootProof not wired", src.contains("onBootProof ="))
        assertTrue("onRegisterAttempt not wired", src.contains("onRegisterAttempt ="))
        assertTrue("onRegisterResult not wired", src.contains("onRegisterResult ="))
    }

    @Test
    fun `loadPlayer re-arms the boot watchdog from the SAME navigation stamp`() {
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "loadPlayer must re-arm BootDiagnostics from lastLoadStartedAtMs",
            src.contains("BootDiagnostics.onLoadStarted(lastLoadStartedAtMs)"),
        )
        assertTrue("boot watchdog never started", src.contains("startBootWatchdog()"))
        assertTrue("boot watchdog never stopped", src.contains("stopBootWatchdog()"))
    }

    @Test
    fun `the diagnostic is attached with the ONE remote-focus treatment`() {
        // Player rule 15 — OEM signage ROMs strip the default focus
        // drawable, so a card decorated any other way is invisible to a
        // D-pad and the panel looks dead.
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(src.contains("decorate = ::applyRemoteFocus"))
    }

    @Test
    fun `the web half calls all three and is excluded from KNOWN_METHODS`() {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val web = File(root, "../../../web/src/app/player/nativeBridge.ts")
        val diag = File(root, "../../../web/src/app/player/bootDiagnostics.ts")
        Assume.assumeTrue("web sources not on disk", web.isFile && diag.isFile)
        val bridgeSrc = web.readText()
        methods.forEach {
            assertTrue("$it missing from the web method table", bridgeSrc.contains("'$it'"))
            // Rule 9: a method the fleet floor does not implement must not be
            // assumed present on a manifest-less channel, or the post is
            // dropped silently on an older APK.
            assertTrue(
                "$it must be excluded from KNOWN_METHODS until the fleet floor is 1.1.13",
                bridgeSrc.contains("m !== '$it'"),
            )
        }
        val diagSrc = diag.readText()
        assertTrue(diagSrc.contains("reportClientBooted"))
        assertTrue(diagSrc.contains("reportRegisterAttempt"))
        assertTrue(diagSrc.contains("reportRegisterFailure"))
    }
}
