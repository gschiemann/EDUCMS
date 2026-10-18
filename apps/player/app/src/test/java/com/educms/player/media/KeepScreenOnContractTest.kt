package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * CAN FLAG_KEEP_SCREEN_ON BE OFF WHILE A NATIVE SESSION PRESENTS? (1.1.42)
 *
 * The rk3328 / Android 11 test box's panel went off at 2026-10-17 07:50:16Z
 * while native video was on the glass. These source facts answer the
 * question the lead asked: the window flag is set in `onCreate`, re-asserted
 * by every wake, and CLEARED in exactly one place — the `setKeepScreenOn`
 * window hook, which refuses under an emergency hold — and every caller of
 * that hook with `false` is a display BLANK provider. So the flag is off while
 * a native session presents ONLY as the first step of a deliberate blank
 * (the on/off schedule or a remote power-off), never by accident, and
 * nothing in the native video engine touches it. Holding it for the
 * session's lifetime would defeat exactly those blanks (owner rule
 * 2026-10-03: the player respects a remote power-off), so the engine only
 * READS it (FaceVideoBox.watch → `keepScreenOn` on the runtime report).
 *
 * Same shape as FaceVideoBoxContractTest: skipped, not failed, when the
 * sources are not on disk.
 */
class KeepScreenOnContractTest {
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

    private fun sources(sub: String): List<Pair<String, String>> {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val dir = File(root, "src/main/java/com/educms/player/$sub")
        Assume.assumeTrue("sources not on disk: $sub", dir.isDirectory)
        return dir.walkTopDown().filter { it.isFile && it.extension == "kt" }.map { it.relativeTo(root!!).path to it.readText() }.toList()
    }

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    @Test
    fun `the Activity clears the flag in exactly one place, the window hook, and that hook refuses under a hold`() {
        val a = code(read("src/main/java/com/educms/player/MainActivity.kt"))
        val clears = Regex("clearFlags\\(WindowManager\\.LayoutParams\\.FLAG_KEEP_SCREEN_ON\\)").findAll(a).toList()
        assertEquals("one clear, in the hook", 1, clears.size)
        val hook = a.indexOf("setKeepScreenOn = { on ->")
        assertTrue(hook >= 0)
        val hookEnd = a.indexOf("requestWake = {", hook)
        assertTrue(clears[0].range.first in hook..hookEnd)
        val body = a.substring(hook, hookEnd)
        assertTrue("the hook refuses to drop the flag under an emergency hold", body.contains("DisplayEmergency.blocksKeepScreenOff("))
        assertTrue(body.indexOf("blocksKeepScreenOff(") < body.indexOf("clearFlags("))
        // The view-level flag (activity_main.xml's keepScreenOn) is toggled with it, in the same hook.
        assertTrue(body.contains("binding.root.keepScreenOn = on"))
        // Set at creation and re-asserted by every wake, so a new window always holds it.
        assertTrue(a.contains("window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"))
        assertTrue(code(read("src/main/java/com/educms/player/MainActivity.kt")).substringAfter("private fun requestScreenWake()").contains("FLAG_KEEP_SCREEN_ON or"))
        assertTrue(DisplayEmergencyGuard.blocksKeepScreenOff(held = true, on = false))
        assertFalse(DisplayEmergencyGuard.blocksKeepScreenOff(held = false, on = false))
        assertFalse(DisplayEmergencyGuard.blocksKeepScreenOff(held = true, on = true))
    }

    @Test
    fun `every caller that drops the flag is a display blank provider, so it is off during a native session only for a deliberate blank`() {
        val root = moduleRoot
        Assume.assumeTrue(root != null)
        val all = File(root, "src/main/java/com/educms/player").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        Assume.assumeTrue(all.size > 50)
        val droppers = all.filter { f -> Regex("setKeepScreenOn\\(false\\)").containsMatchIn(code(f.readText())) }.map { it.relativeTo(root!!).path }
        assertTrue("someone drops it (the blank providers)", droppers.isNotEmpty())
        for (d in droppers) assertTrue("$d drops KEEP_SCREEN_ON but is not a display provider", d.contains("/display/"))
        // And each of those is a BLANK mechanism of the registry, not a bystander.
        for (d in droppers) {
            val src = code(File(root, d).readText())
            assertTrue("$d is a DisplayControlProvider or the lock/dim half of one",
                src.contains("DisplayControlProvider") || src.contains("Capability.BLANK") || src.contains("lockNow(") || src.contains("screenBrightness"))
        }
    }

    @Test
    fun `the native video engine never writes the flag, it only reads it into the runtime report`() {
        for ((name, src) in sources("media")) {
            val c = code(src)
            assertFalse("$name must not add/clear the window flag", Regex("(addFlags|clearFlags)\\([^)]*KEEP_SCREEN_ON").containsMatchIn(c))
            assertFalse("$name must not toggle view keepScreenOn", Regex("keepScreenOn\\s*=\\s*(true|false|on)\\b").containsMatchIn(c))
            assertFalse("$name must not call the window hook", c.contains("setKeepScreenOn("))
        }
        val box = code(read("src/main/java/com/educms/player/media/FaceVideoBox.kt"))
        val reader = box.substringAfter("private fun keepScreenOnOf(")
        assertTrue("the only KEEP_SCREEN_ON use in the engine is a read of the window's attributes",
            reader.contains("attributes?.flags") && reader.contains("and android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON"))
        assertEquals(1, Regex("FLAG_KEEP_SCREEN_ON").findAll(box).count())
        val watch = box.substringAfter("private fun watch(").substringBefore("private fun stopSession(")
        assertTrue("observed on the UI-thread watch tick", watch.contains("s.keepScreenOn = keepScreenOnOf(host)"))
        assertTrue("…and reported", box.contains(".put(\"keepScreenOn\", s.keepScreenOn ?: JSONObject.NULL)"))
    }

    /** The pure half of the hook's guard, mirrored here so the test reads as one fact without an Android dependency. */
    private object DisplayEmergencyGuard {
        fun blocksKeepScreenOff(held: Boolean, on: Boolean): Boolean = com.educms.player.display.DisplayEmergency.blocksKeepScreenOff(held, on)
    }
}
