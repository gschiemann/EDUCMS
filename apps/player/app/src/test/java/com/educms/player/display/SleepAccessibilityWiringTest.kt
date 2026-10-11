package com.educms.player.display

import android.accessibilityservice.AccessibilityService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * "VenueOS sleep" — the accessibility lock-screen tier (2026-10-11).
 *
 * The X80s cannot make us a device admin and their screen-off timeout starts
 * a screensaver. The power key sleeps them; `GLOBAL_ACTION_LOCK_SCREEN` is the
 * same path. These pin that the tier is INERT until a person turns it on,
 * that it reads nothing, and that it is reached only through the gated
 * registry.
 */
class SleepAccessibilityWiringTest {

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
    fun `the action constant is the platform's lock-screen action`() {
        assertEquals(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN, SleepAccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
    }

    @Test
    fun `the service is bound only by the system and reads no screen content`() {
        val manifest = read("src/main/AndroidManifest.xml")
        val decl = Regex("<service\\s+android:name=\"\\.display\\.SleepAccessibilityService\"[\\s\\S]*?</service>")
            .find(manifest)?.value
        Assume.assumeTrue("service declaration not found", decl != null)
        assertTrue(decl!!.contains("android:permission=\"android.permission.BIND_ACCESSIBILITY_SERVICE\""))
        assertTrue(decl.contains("android.accessibilityservice.AccessibilityService"))
        val config = read("src/main/res/xml/sleep_accessibility_service.xml")
        assertTrue(config.contains("android:canRetrieveWindowContent=\"false\""))
        assertFalse(config.contains("canPerformGestures"))
        assertFalse(config.contains("flagRequestFilterKeyEvents"))
    }

    @Test
    fun `the tier declines until the service is bound, and on a secure keyguard`() {
        val src = read("src/main/java/com/educms/player/display/AccessibilityLockProvider.kt")
        val supports = Regex("override fun supports\\([\\s\\S]*?\\n    }").find(src)?.value
        Assume.assumeTrue("supports() not found", supports != null)
        assertTrue(supports!!.contains("!SleepAccessibilityService.isConnected() -> emptySet()"))
        assertTrue(supports.contains("DeviceAdminBlankProvider.secureKeyguardBlocks(ctx) -> emptySet()"))
        // Nothing in the player calls the lock directly — only the provider,
        // which only the gated registry reaches.
        val root = moduleRoot ?: return
        val callers = File(root, "src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("SleepAccessibilityService.lockScreen()") }
            .map { it.name }
            .toSet()
        assertEquals(setOf("AccessibilityLockProvider.kt"), callers)
    }

    @Test
    fun `the description a person reads says what it does and what it does not`() {
        val strings = read("src/main/res/values/strings.xml")
        assertTrue(strings.contains("name=\"sleep_accessibility_label\""))
        assertTrue(strings.contains("does not read anything on the screen"))
    }
}
