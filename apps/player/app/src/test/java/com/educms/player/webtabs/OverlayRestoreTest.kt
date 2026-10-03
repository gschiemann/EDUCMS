package com.educms.player.webtabs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * P2-6 (2026-10-03 review) — what a fresh url-overlay WebView loads after its
 * renderer died, and that MainActivity acts on the answer.
 */
class OverlayRestoreTest {

    /** The production rule's shape: https with a host only (HostAllowlist.isSafeWebUrl). */
    private val safe: (String) -> Boolean = { it.startsWith("https://") && it.length > "https://".length }

    @Test
    fun `restores what the site was showing when it can`() {
        assertEquals(
            "https://menu.example/today",
            OverlayRestore.target("https://menu.example/today", "https://menu.example/", safe),
        )
    }

    @Test
    fun `falls back to the URL the player asked for when the last page is unrestorable`() {
        // The three ordinary unrestorable cases from the review.
        listOf("http://menu.example/plain", "about:blank", "data:text/html,blocked").forEach { last ->
            assertEquals(last, "https://menu.example/", OverlayRestore.target(last, "https://menu.example/", safe))
        }
        // …and a death before the first page start after a hide.
        assertEquals("https://menu.example/", OverlayRestore.target(null, "https://menu.example/", safe))
    }

    @Test
    fun `nothing restorable means HIDE — never a visible empty overlay`() {
        assertNull(OverlayRestore.target("about:blank", null, safe))
        assertNull(OverlayRestore.target(null, null, safe))
        assertNull(OverlayRestore.target("  ", "", safe))
        assertNull(OverlayRestore.target("http://a.example", "http://b.example", safe))
    }

    @Test
    fun `MainActivity hides and clears on null, paints black, and restores focus`() {
        val main = source("src/main/java/com/educms/player/MainActivity.kt") ?: return
        val at = main.indexOf("override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail)")
        assertTrue(at >= 0)
        val overlay = main.substring(at, main.indexOf("override fun shouldOverrideUrlLoading", at))
        assertTrue(overlay.contains("OverlayRestore.target(previousUrl, urlOverlayCurrentUrl, restorable)"))
        assertTrue("the fresh overlay must not be a white sheet", overlay.contains("fresh.setBackgroundColor(android.graphics.Color.BLACK)"))
        assertTrue(overlay.contains("if (hadFocus) fresh.requestFocus()"))
        val hide = overlay.substring(overlay.indexOf("if (target == null)"))
        assertTrue("an unrestorable overlay must be HIDDEN", hide.contains("fresh.visibility = View.GONE"))
        assertTrue("…and the current URL CLEARED so the next show reloads", hide.contains("urlOverlayCurrentUrl = null"))
        // The primary's replacement keeps the remote too.
        val primary = main.substring(main.indexOf("onRendererGone = { failed, didCrash ->"))
        assertTrue(primary.substring(0, primary.indexOf("onMainFrameError =")).contains("if (hadFocus) fresh.requestFocus()"))
    }

    private fun source(relative: String): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val direct = File(dir, relative)
            if (direct.isFile) return direct.readText()
            val nested = File(dir, "app/$relative")
            if (nested.isFile) return nested.readText()
            dir = dir.parentFile
        }
        Assume.assumeTrue("source not on disk: $relative", false)
        return null
    }
}
