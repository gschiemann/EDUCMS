package com.educms.player.webtabs

import com.educms.player.security.BridgeNonce
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * Website Tabs — THE WIRING + THE BOUNDARY, as source facts (2026-09-28).
 *
 * Same shape as `BootBridgeWiringTest` / `LegacyBridgeExposureTest`: a green
 * policy test proves the rules, not that they are in front of anything. This
 * proves, off disk:
 *   1. the three-file bridge contract for `webTabsShow` / `webTabsHide`
 *      (channel allowlist + dispatch arm + legacy `@JavascriptInterface`,
 *      the web method table, the KNOWN_METHODS exclusion — CLAUDE.md player
 *      rule 9);
 *   2. `webTabsShow` is nonce-gated with both arities and `webTabsHide` is
 *      not (class 1 vs class 2 in BridgeNonce);
 *   3. MainActivity actually wires both lambdas and parses through
 *      WebTabsPolicy — no inert feature;
 *   4. ⚠️ THE BOUNDARY: the overlay WebView — the one that shows third-party
 *      sites — is configured with NO `addJavascriptInterface`, NO
 *      `addWebMessageListener` and NO document-start script, refuses
 *      downloads, and its navigation policy consults WebTabsPolicy;
 *   5. the sign-out never calls `WebStorage.deleteAllData()`, which would
 *      erase the player's own localStorage credential.
 *
 * Skipped (not failed) when the sources are not on disk.
 */
class WebTabsWiringTest {

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

    private val mainActivity: String get() = read("src/main/java/com/educms/player/MainActivity.kt")
    private val webAppBridge: String get() = read("src/main/java/com/educms/player/WebAppBridge.kt")
    private val channel: String get() = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")

    private val methods = listOf("webTabsShow", "webTabsHide")

    // ─── 1. the three-file contract ─────────────────────────────────────

    @Test
    fun `both methods are in the channel allowlist AND its dispatch`() {
        val src = channel
        val allowlist = Regex("private val METHODS = arrayOf\\(([\\s\\S]*?)\\n\\s*\\)")
            .find(src)?.groupValues?.get(1)
        Assume.assumeTrue("METHODS block not found", allowlist != null)
        methods.forEach {
            assertTrue("\"$it\" missing from NativeBridgeChannel.METHODS", allowlist!!.contains("\"$it\""))
            assertTrue("\"$it\" has no dispatch arm", src.contains("\"$it\" ->"))
        }
        // The gated one is dispatched through its nonce-bearing overload.
        val arm = Regex(""""webTabsShow" ->[^\n]*""").find(src)?.value ?: ""
        assertTrue("webTabsShow's channel arm must pass channelNonce(): $arm", arm.contains("channelNonce()"))
    }

    @Test
    fun `both are on the legacy surface too — Taurus has no channel`() {
        val src = webAppBridge
        methods.forEach { assertTrue("no @JavascriptInterface fun $it", src.contains("fun $it(")) }
    }

    @Test
    fun `the web half advertises both, excludes both from KNOWN_METHODS, and gates only show`() {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val web = File(root, "../../../web/src/app/player/nativeBridge.ts")
        Assume.assumeTrue("web source not on disk", web.isFile)
        val ts = web.readText()
        methods.forEach {
            assertTrue("$it missing from the web method table", ts.contains("'$it'"))
            assertTrue(
                "$it must be excluded from KNOWN_METHODS until the fleet floor includes this APK (rule 9)",
                ts.contains("m !== '$it'"),
            )
            assertTrue("$it has no METHOD_FLOORS entry", Regex("""$it:\s*\[1,\s*1,\s*\d+\]""").containsMatchIn(ts))
        }
        val gatedBlock = Regex("""const LEGACY_NONCE_GATED_METHODS: readonly string\[\] = \[([\s\S]*?)\n\];""")
            .find(ts)?.groupValues?.get(1) ?: ""
        assertTrue("webTabsShow must be nonce-gated on the web side", gatedBlock.contains("'webTabsShow'"))
        assertFalse("webTabsHide must NOT be nonce-gated (recovery direction)", gatedBlock.contains("'webTabsHide'"))
    }

    // ─── 2. the gate classification ─────────────────────────────────────

    @Test
    fun `webTabsShow is class 1 (gated, two arities); webTabsHide is class 2 (never gated)`() {
        assertTrue(BridgeNonce.GATED_METHODS.contains("webTabsShow"))
        assertFalse(BridgeNonce.GATED_METHODS.contains("webTabsHide"))
        val src = webAppBridge
        assertTrue(src.contains("gate(\"webTabsShow\""))
        assertEquals(2, Regex("""\n\s+fun webTabsShow\(""").findAll(src).count())
        assertFalse("webTabsHide must not call the gate — a pinned overlay with no way down is the worse failure", src.contains("gate(\"webTabsHide\""))
    }

    // ─── 3. actually wired ──────────────────────────────────────────────

    @Test
    fun `MainActivity wires both lambdas and parses through WebTabsPolicy`() {
        val src = mainActivity
        assertTrue("onWebTabsShow not wired", src.contains("onWebTabsShow ="))
        assertTrue("onWebTabsHide not wired", src.contains("onWebTabsHide ="))
        assertTrue(src.contains("WebTabsPolicy.parseShowRequest("))
        assertTrue(src.contains("WebTabsPolicy.parseHideRequest("))
        assertTrue("showWebTabs must re-check the start URL against its own allowlist", src.contains("WebTabsPolicy.isAllowedNavigation(req.url, req.allowHosts)"))
        // The URL-asset hide must yield while Website Tabs owns the view — the
        // player page fires it on every template apply.
        val hide = src.substringAfter("private fun hideUrlOverlay()").substringBefore("\n    }")
        assertTrue("hideUrlOverlay must ignore the call while webTabsActive", hide.contains("if (webTabsActive)"))
    }

    // ─── 4. ⚠️ THE BOUNDARY: the third-party WebView reaches no native surface ──

    private fun overlayConfigBlock(): String {
        val src = mainActivity
        val start = src.indexOf("private fun configureUrlOverlay(")
        assertTrue("configureUrlOverlay not found", start > 0)
        val end = src.indexOf("\n    private fun showUrlOverlay(", start)
        assertTrue("could not bound configureUrlOverlay", end > start)
        return src.substring(start, end)
    }

    @Test
    fun `the overlay WebView gets no JavaScript bridge of any kind`() {
        val block = overlayConfigBlock()
        for (surface in listOf("addJavascriptInterface", "addWebMessageListener", "addDocumentStartJavaScript", "NativeBridgeChannel.attach", "attachLegacyCompatShim")) {
            assertFalse("the third-party overlay WebView must never get $surface", block.contains(surface))
        }
        // …and the only script we evaluate into it is our own remote-control shim.
        val evals = Regex("""evaluateJavascript\(""").findAll(block).count()
        assertEquals("unexpected script injection into the overlay WebView", 0, evals)
        assertTrue(block.contains("SpatialNavigation.inject("))
        // The whole Activity calls addJavascriptInterface exactly once — on the
        // player WebView's legacy path — and never on urlOverlayView.
        val src = mainActivity
        assertEquals(1, Regex("""\.addJavascriptInterface\(""").findAll(src).count())
        assertFalse(src.contains("urlOverlayView.addJavascriptInterface"))
    }

    @Test
    fun `the overlay refuses downloads, non-web schemes, and consults the allowlist for main-frame navigations`() {
        val block = overlayConfigBlock()
        assertTrue("no download listener — a site could pull a file onto the kiosk", block.contains("setDownloadListener"))
        assertTrue(block.contains("WebTabsPolicy.isNavigableScheme(url)"))
        assertTrue(block.contains("request.isForMainFrame"))
        assertTrue(block.contains("WebTabsPolicy.isAllowedNavigation(url, allow)"))
        assertTrue("a blocked navigation must show the blocked page, not a blank", block.contains("WebTabsPolicy.blockedPageHtml("))
        assertTrue("file access must stay off", block.contains("allowFileAccess = false"))
        assertTrue("content access must stay off", block.contains("allowContentAccess = false"))
        assertTrue("popups must open in the same view", block.contains("setSupportMultipleWindows(false)"))
        // The touch relay is observed from the Activity's dispatchTouchEvent
        // (never consumed), not a View.OnTouchListener on the WebView.
        assertFalse("no OnTouchListener on the overlay (ClickableViewAccessibility)", block.contains("setOnTouchListener"))
        val src = mainActivity
        assertTrue(
            "the site view's touches must reach the idle clock",
            src.contains("if (webTabsActive && event.actionMasked == MotionEvent.ACTION_DOWN) relayWebTabsActivity()"),
        )
    }

    @Test
    fun `a Website Tabs session runs with mixed content refused`() {
        val src = mainActivity
        val show = src.substringAfter("private fun showWebTabs(").substringBefore("\n    }")
        assertTrue(show.contains("MIXED_CONTENT_NEVER_ALLOW"))
    }

    // ─── 5. the sign-out never touches the player's own storage ─────────

    @Test
    fun `the wipe clears cookies and per-origin storage but never deleteAllData`() {
        val src = mainActivity
        val wipe = src.substringAfter("private fun wipeWebTabsSession()").substringBefore("\n    }")
        assertTrue(wipe.contains("removeAllCookies"))
        assertTrue(wipe.contains("deleteOrigin("))
        assertTrue(wipe.contains("WebTabsPolicy.WIPE_PAGE_STORAGE_JS"))
        assertFalse(
            "WebStorage.deleteAllData() erases EVERY origin's localStorage — the player's device credential included (player rule 3)",
            src.contains("deleteAllData("),
        )
    }
}
