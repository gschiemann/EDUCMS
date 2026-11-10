package com.educms.player.health

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * PROCESS HEALTH — the wiring and the "observe and report only" promise, as
 * source facts (2026-11-09). A future edit that makes the probe or the memory
 * handler reload, restart or kill turns this red.
 */
class ProcessHealthWiringTest {

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

    private fun src(rel: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not found", root != null)
        return File(root, "src/main/java/com/educms/player/$rel").readText()
    }

    @Test fun `nothing in health reloads, restarts, kills or touches the display`() {
        for (f in listOf("health/ProcessHealth.kt", "health/MemoryPressurePolicy.kt", "health/MainThreadStallPolicy.kt", "health/ExitEvidencePolicy.kt", "health/ProcessHealthReport.kt")) {
            val code = src(f).lines().filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }.joinToString("\n")
            for (banned in listOf("killProcess", "exitProcess", "System.exit", ".reload(", "loadUrl", "startActivity", "DisplayControl", "enforceNow", "setEmergencyHold")) {
                assertFalse("$f must not call $banned", code.contains(banned))
            }
        }
    }

    @Test fun `the free is the RAM cache only, never the disk cache`() {
        val main = src("MainActivity.kt")
        val block = main.substringAfter("private val freeRamCache").substringBefore("override fun onDestroy")
        assertTrue(block.contains("clearCache(false)"))
        assertFalse(block.contains("clearCache(true)"))
    }

    @Test fun `the free is gated on the emergency hold, read fail-closed`() {
        val code = src("health/ProcessHealth.kt")
        assertTrue(code.contains("runCatching { DisplayEmergency.isHeld(ctx) }.getOrNull()"))
    }

    @Test fun `the header and the trace upload ride only the signed heartbeat`() {
        val hb = src("heartbeat/HeartbeatService.kt")
        assertTrue(Regex("""if \(nativeAllowed\) runCatching \{\s*com\.educms\.player\.health\.ProcessHealth\.headerValue""").containsMatchIn(hb))
        assertTrue(Regex("""if \(nativeAllowed\) runCatching \{\s*com\.educms\.player\.health\.ProcessHealth\.uploadPendingTraces""").containsMatchIn(hb))
        assertTrue(hb.contains("ProcessHealth.acceptServerDirective"))
    }

    @Test fun `installed at process start, exits remembered at boot`() {
        assertTrue(src("PlayerApp.kt").contains("ProcessHealth.install(this)"))
        assertTrue(src("ProcessExitDiagnostics.kt").contains("ProcessHealth.rememberExits"))
    }
}
