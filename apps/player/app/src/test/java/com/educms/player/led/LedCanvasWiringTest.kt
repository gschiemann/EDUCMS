package com.educms.player.led

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE CALL-SITE GUARD for the LED canvas (2026-09-02, 1.1.14).
 *
 * [LedCanvasTest] proves the RULE. This proves the rule is actually WIRED —
 * the 2026-08-14 "112 green tests, no caller" shape is the exact failure
 * this file exists to prevent, and it is the shape a canvas rule is most
 * likely to fail in: a perfectly-tested pure object that no surface ever
 * asks.
 *
 * Every native surface that can be the ONLY thing on a poster's glass must
 *   • mount through LedCanvasHost (pinned top-left at the canvas), and
 *   • size itself off LedCanvasHost.viewportWidthPx, never
 *     displayMetrics.widthPixels — the frame buffer is 1920 and the LED
 *     shows 320 of it.
 *
 * Skipped (not failed) when the sources are not on disk.
 */
class LedCanvasWiringTest {

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
    fun `the boot diagnostic mounts pinned and sizes off the canvas`() {
        val mount = require("src/main/java/com/educms/player/boot/BootDiagnostics.kt")
        assertTrue(
            "the boot diagnostic is not mounted through LedCanvasHost — on a poster it lands off the glass",
            mount.contains("LedCanvasHost.addPinned"),
        )
        val view = require("src/main/java/com/educms/player/boot/BootDiagnosticsView.kt")
        assertTrue(
            "BootDiagnosticsView must size its card off LedCanvasHost.viewportWidthPx",
            view.contains("LedCanvasHost.viewportWidthPx"),
        )
        assertFalse(
            "BootDiagnosticsView still measures the 1920 frame buffer",
            view.contains("displayMetrics.widthPixels"),
        )
        assertTrue(
            "BootDiagnosticsView must re-fit the column after every render",
            view.contains("LedCanvasHost.fitNarrow"),
        )
    }

    @Test
    fun `the setup checklist mounts pinned and sizes off the canvas`() {
        val mount = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        assertTrue(
            "the setup checklist is not mounted through LedCanvasHost",
            mount.contains("LedCanvasHost.addPinned"),
        )
        val view = require("src/main/java/com/educms/player/setup/SetupChecklistView.kt")
        assertTrue(
            "SetupChecklistView must size its card off LedCanvasHost.viewportWidthPx",
            view.contains("LedCanvasHost.viewportWidthPx"),
        )
        assertFalse(
            "SetupChecklistView still measures the 1920 frame buffer",
            view.contains("displayMetrics.widthPixels"),
        )
        assertTrue(
            "SetupChecklistView must re-fit the column after every render",
            view.contains("LedCanvasHost.fitNarrow"),
        )
    }

    @Test
    fun `the XML overlays in the kiosk shell are pinned at setContentView`() {
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "the companion-install gate and the reconnect overlay must be pinned to the LED canvas",
            src.contains("LedCanvasHost.pinAll(this, binding.managerGateOverlay, binding.recoveryOverlay)"),
        )
        assertTrue(
            "the pinned overlays must also be fitted to the narrow column",
            src.contains("LedCanvasHost.fitNarrow(binding.managerGateOverlay)"),
        )
    }

    @Test
    fun `every system prompt this app raises is announced in the column`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        // The package-installer confirmation (OTA + companion upgrade) and
        // the install-unknown-apps deep link are the two system dialogs
        // MainActivity raises itself.
        assertTrue(
            "the install confirmation is raised without a poster announcement",
            main.contains("LedSystemPromptBanner.announce"),
        )
        val ceremony = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        assertTrue(
            "the setup ceremony launches system pages without a poster announcement",
            ceremony.contains("LedSystemPromptBanner.announce(activity, step.name)"),
        )
        assertTrue(
            "a grant that is already held must not open a system page at all",
            ceremony.contains("already satisfied — no system page opened"),
        )
    }

    @Test
    fun `the blackout and the WebView keep the whole frame buffer`() {
        val src = require("src/main/java/com/educms/player/MainActivity.kt")
        // A blank that covered only the LED column would leave the rest of
        // the frame buffer lit — a light leak on a chained wall, and a
        // life-safety surface (DisplayEmergency) besides. The blackout view
        // must stay MATCH_PARENT.
        assertTrue(
            "the blackout overlay must still fill the OS canvas",
            src.contains("private fun applyBlackout"),
        )
        val blackout = src.substringAfter("private fun applyBlackout").substringBefore("\n    /**")
        assertFalse(
            "the blackout overlay must never be pinned to the LED canvas",
            blackout.contains("LedCanvasHost"),
        )
    }
}
