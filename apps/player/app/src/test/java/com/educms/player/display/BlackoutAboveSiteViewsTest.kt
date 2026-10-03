package com.educms.player.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * A NATIVE BLANK COVERS A LIVE WEBSITE TOO (2026-10-03, player 1.1.21).
 *
 * The playlist's website item and Website Tabs show their site in a second
 * WebView (`urlOverlayView`) that each show path `bringToFront()`s. Before
 * 1.1.21 a blackout raised earlier was buried under the site the moment it
 * showed. The rule (pure) and its placement (source facts) are pinned here.
 */
class BlackoutAboveSiteViewsTest {

    @Test
    fun `a visible blackout is raised back above the site`() {
        assertTrue(DisplayEmergency.blackoutCoversSiteViews(blackoutVisible = true, held = false))
    }

    @Test
    fun `an alert still punches through — never raised over a hold`() {
        assertFalse(DisplayEmergency.blackoutCoversSiteViews(blackoutVisible = true, held = true))
    }

    @Test
    fun `a hidden blackout stays hidden`() {
        assertFalse(DisplayEmergency.blackoutCoversSiteViews(blackoutVisible = false, held = false))
        assertFalse(DisplayEmergency.blackoutCoversSiteViews(blackoutVisible = false, held = true))
    }

    @Test
    fun `every path that brings a site view to the front re-raises the blackout after it`() {
        val main = source("src/main/java/com/educms/player/MainActivity.kt") ?: return
        val sites = Regex("urlOverlayView\\.bringToFront\\(\\)").findAll(main).map { it.range.first }.toList()
        assertTrue("expected the two site show paths", sites.size >= 2)
        sites.forEach { at ->
            // The rest of the enclosing function: up to the next member declaration.
            val rest = main.substring(at)
            val end = Regex("\\n    (private |override |internal )?fun ").find(rest)?.range?.first ?: rest.length
            val fn = rest.substring(0, end)
            val reraise = fn.indexOf("keepBlackoutAboveSiteViews(")
            val gate = fn.indexOf("managerGateOverlay.bringToFront()")
            assertTrue("a site is brought to the front without re-raising the blackout", reraise >= 0)
            assertTrue("the blackout must be raised LAST (after the gate)", gate in 0 until reraise)
        }
        assertTrue(
            "the renderer-replacement path must keep the blackout above the fresh site view",
            main.contains("keepBlackoutAboveSiteViews(\"url-overlay renderer replaced\")"),
        )
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
