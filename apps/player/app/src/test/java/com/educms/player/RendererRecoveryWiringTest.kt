package com.educms.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * RENDERER RECOVERY — THE WIRING, as source facts (2026-10-03 review,
 * `docs/research/2026-10-03-codex-review/02-android-player-review.md`).
 *
 * The 1.1.20 instrumented test drove a debug-only activity that reimplemented
 * the wiring (review P2-9), so nothing pinned what MainActivity and
 * FacePlayerHost actually do after a renderer death. These do. Each was red
 * against the 1.1.20 sources.
 */
class RendererRecoveryWiringTest {

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

    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    /** From [signature] to the closing brace at member indent. */
    private fun member(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val end = src.indexOf("\n    }\n", at)
        return src.substring(at, if (end < 0) src.length else end)
    }

    private val main get() = code(read("src/main/java/com/educms/player/MainActivity.kt"))
    private val recovery get() = code(read("src/main/java/com/educms/player/NetworkRecoveryController.kt"))

    /** The primary's onRendererGone lambda, from the client construction to onMainFrameError. */
    private fun primaryRendererLambda(): String {
        val src = main
        val at = src.indexOf("onRendererGone = { failed, didCrash ->")
        assertTrue("primary onRendererGone lambda not found", at >= 0)
        return src.substring(at, src.indexOf("onMainFrameError =", at))
    }

    // ─── P1-2: a renderer death is not a network failure ────────────

    @Test
    fun `P1-2 the primary reloads a replaced renderer without the health gate`() {
        val lambda = primaryRendererLambda()
        assertTrue(lambda.contains("recovery.onRendererGone("))
        assertFalse(
            "a renderer death must not go through onError — that loop waits for /health status:ok",
            lambda.contains("recovery.onError("),
        )
    }

    @Test
    fun `P1-2 the renderer path reloads on its own clock and never probes health`() {
        val fn = member(recovery, "fun onRendererGone(")
        assertTrue(fn.contains("onReloadRequested()"))
        assertTrue(fn.contains("delay("))
        assertFalse("the renderer path must not be health-gated", fn.contains("probeHealth("))
        // …and a network-up kick cannot turn the renderer wait into a probe loop.
        assertTrue(member(recovery, "private fun triggerImmediateProbeOnMain(").contains("if (rendererWait) return"))
    }

    @Test
    fun `P1-2 main-frame LOAD errors keep the health gate`() {
        val loop = member(recovery, "private fun startLoop(")
        assertTrue(loop.contains("probeHealth()"))
        assertTrue(loop.contains("if (health.ok)"))
    }

    @Test
    fun `P1-2 the staleness watchdog does not race a pending renderer reload`() {
        val src = main
        assertTrue(src.contains("recovery.isRendererReloadPending()"))
        assertTrue(src.contains("if (stale && (loadInFlight || rendererReloadPending))"))
    }
}
