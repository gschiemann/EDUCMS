package com.educms.player.webcompat

import com.educms.player.webcompat.LegacyEnginePolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/** The version gate, the feature gate, the script substitution — and the wiring, as source facts. */
class LegacyEnginePolicyTest {

    // ─── the version gate ──────────────────────────────────────────────

    @Test
    fun `reads the major from a WebView versionName`() {
        assertEquals(95, LegacyEnginePolicy.majorOf("95.0.4638.74"))
        assertEquals(101, LegacyEnginePolicy.majorOf("101.0.4951.61"))
        assertEquals(120, LegacyEnginePolicy.majorOf("120.0.6099.230"))
        assertEquals(83, LegacyEnginePolicy.majorOf(" 83 "))
    }

    @Test
    fun `an unreadable version is unknown, never guessed`() {
        for (v in listOf(null, "", "unknown", "abc.1", ".95", "-95.0", "0.1", "99999.0")) {
            assertNull("versionName=$v", LegacyEnginePolicy.majorOf(v))
        }
    }

    @Test
    fun `installs only below the threshold, with document-start support`() {
        val t = LegacyEnginePolicy.MODERN_WEBVIEW_MAJOR
        assertEquals(120, t)
        assertEquals(Decision.INSTALL, LegacyEnginePolicy.decide(95, true))
        assertEquals(Decision.INSTALL, LegacyEnginePolicy.decide(t - 1, true))
        assertEquals(Decision.SKIP_MODERN, LegacyEnginePolicy.decide(t, true))
        assertEquals(Decision.SKIP_MODERN, LegacyEnginePolicy.decide(141, true))
        assertEquals(Decision.SKIP_MODERN, LegacyEnginePolicy.decide(141, false))
    }

    @Test
    fun `the feature gate - no DOCUMENT_START_SCRIPT means nothing on a view that has not opted in`() {
        assertEquals(Decision.SKIP_NO_DOCUMENT_START, LegacyEnginePolicy.decide(95, false))
        assertEquals(Decision.SKIP_NO_DOCUMENT_START, LegacyEnginePolicy.decide(83, false))
        assertEquals(Decision.SKIP_NO_DOCUMENT_START, LegacyEnginePolicy.decide(95, false, lateAllowed = false))
    }

    @Test
    fun `the late path - the GUQ's AOSP WebView 95 without document-start gets the late install on an opted-in view`() {
        assertEquals(Decision.INSTALL_LATE, LegacyEnginePolicy.decide(95, false, lateAllowed = true))
        assertEquals(Decision.INSTALL_LATE, LegacyEnginePolicy.decide(LegacyEnginePolicy.LATE_INJECTION_MIN_MAJOR, false, lateAllowed = true))
        assertEquals(Decision.INSTALL_LATE, LegacyEnginePolicy.decide(LegacyEnginePolicy.MODERN_WEBVIEW_MAJOR - 1, false, lateAllowed = true))
        // Document-start support always wins: the late path is only the fallback.
        assertEquals(Decision.INSTALL, LegacyEnginePolicy.decide(95, true, lateAllowed = true))
        // Taurus (Chromium 83/87) is untouched, and so is anything below the floor.
        assertEquals(90, LegacyEnginePolicy.LATE_INJECTION_MIN_MAJOR)
        for (m in listOf(83, 87, 89)) {
            assertEquals("major=$m", Decision.SKIP_NO_DOCUMENT_START, LegacyEnginePolicy.decide(m, false, lateAllowed = true))
        }
        assertEquals(Decision.SKIP_MODERN, LegacyEnginePolicy.decide(138, false, lateAllowed = true))
        assertEquals(Decision.SKIP_UNKNOWN_VERSION, LegacyEnginePolicy.decide(null, false, lateAllowed = true))
    }

    @Test
    fun `the late path only targets real web documents`() {
        for (u in listOf("https://bi.example.test/auth/login", "http://10.0.2.2:3000/", " HTTPS://X.TEST/ ")) {
            assertTrue(u, LegacyEnginePolicy.lateTargetUrl(u))
        }
        for (u in listOf(null, "", "about:blank", "data:text/html,x", "file:///sdcard/x.html", "javascript:alert(1)", "content://x")) {
            assertFalse("$u", LegacyEnginePolicy.lateTargetUrl(u))
        }
    }

    @Test
    fun `the late proof line extends the on-glass line`() {
        assertEquals(
            "PLAYER_LEGACY_POLYFILL installed webview=95 features=15 view=overlay mode=late",
            LegacyEnginePolicy.lateInstalledLine(95, 15, "overlay"),
        )
        assertTrue(LegacyEnginePolicy.LATE_PROBE_JS.contains("AbortSignal.prototype.throwIfAborted"))
    }

    @Test
    fun `an unknown version is not installed even with document-start support`() {
        assertEquals(Decision.SKIP_UNKNOWN_VERSION, LegacyEnginePolicy.decide(null, true))
        assertEquals(Decision.SKIP_UNKNOWN_VERSION, LegacyEnginePolicy.decide(null, false))
    }

    @Test
    fun `every origin, every frame`() {
        assertEquals(setOf("*"), LegacyEnginePolicy.ALLOWED_ORIGINS)
    }

    // ─── the script ────────────────────────────────────────────────────

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

    private val asset: String get() = read("src/main/assets/${LegacyEnginePolicy.ASSET_PATH}")

    @Test
    fun `the asset carries the placeholder and its feature groups are counted`() {
        val src = asset
        assertTrue(src.contains(LegacyEnginePolicy.SKIP_ORIGINS_PLACEHOLDER))
        val n = LegacyEnginePolicy.featureCount(src)
        assertTrue("expected at least 15 feature groups, got $n", n >= 15)
        assertEquals(0, LegacyEnginePolicy.featureCount("// feature('x'\n * feature('y'\nfunction feature(name) {}"))
    }

    @Test
    fun `the skip list is substituted as a JSON array, and a malformed asset is refused`() {
        val script = LegacyEnginePolicy.scriptFor(asset, listOf("https://player.example.test"))
        assertNotNull(script)
        assertTrue(script!!.contains("var SKIP_ORIGINS = [\"https:\\/\\/player.example.test\"];") ||
            script.contains("var SKIP_ORIGINS = [\"https://player.example.test\"];"))
        assertFalse(script.contains("VENUEOS_SKIP_ORIGINS"))
        assertTrue(LegacyEnginePolicy.scriptFor(asset, emptyList())!!.contains("var SKIP_ORIGINS = [];"))
        assertNull(LegacyEnginePolicy.scriptFor("(function(){})();", emptyList()))
    }

    @Test
    fun `the durable line is the one the on-glass check greps for`() {
        assertEquals(
            "PLAYER_LEGACY_POLYFILL installed webview=95 features=15 view=overlay",
            LegacyEnginePolicy.installedLine(95, 15, "overlay"),
        )
    }

    // ─── the wiring (source facts) ─────────────────────────────────────

    private fun code(src: String): String = src
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines().filterNot { it.trimStart().startsWith("//") }.joinToString("\n")

    private fun block(src: String, start: String, end: String): String {
        val a = src.indexOf(start)
        assertTrue("$start not found", a >= 0)
        val b = src.indexOf(end, a + start.length)
        assertTrue("could not bound $start", b > a)
        return src.substring(a, b)
    }

    @Test
    fun `every WebView that can show a third-party page installs the layer`() {
        val main = code(read("src/main/java/com/educms/player/MainActivity.kt"))
        val player = block(main, "private fun configureWebView(", "\n    private fun ")
        assertTrue(player.contains("LegacyEngineCompat.install(") && player.contains("\"player\""))
        assertTrue("the player origin must be skipped", player.contains("HostAllowlist.playerOrigin()"))
        val overlay = block(main, "private fun configureUrlOverlay(", "\n    private fun showUrlOverlay(")
        assertTrue(overlay.contains("LegacyEngineCompat.install(applicationContext, wv, \"overlay\", allowLate = true)"))
        // Only the overlay opts into the late path: the player and the faces carry
        // website zones in IFRAMES, which a top-frame evaluation cannot reach.
        assertFalse(player.contains("allowLate"))
        val face = code(read("src/main/java/com/educms/player/face/FacePlayerHost.kt"))
        val faceCfg = block(face, "private fun configureWebView(", "\n    private fun ")
        assertTrue(faceCfg.contains("LegacyEngineCompat.install(") && faceCfg.contains("HostAllowlist.playerOrigin()"))
        assertFalse(faceCfg.contains("allowLate"))
        // Only those three call sites — a renderer replacement re-runs the same configure.
        val all = Regex("""LegacyEngineCompat\.install\(""")
        assertEquals(2, all.findAll(main).count())
        assertEquals(1, all.findAll(face).count())
        // No other `WebView(` construction exists outside RendererRecovery's replacement.
        assertTrue(code(read("src/main/java/com/educms/player/RendererRecovery.kt")).contains("WebView(parent.context)"))
    }

    @Test
    fun `the installer reaches no native surface and scopes nothing but the polyfill`() {
        val src = code(read("src/main/java/com/educms/player/webcompat/LegacyEngineCompat.kt"))
        for (surface in listOf("addJavascriptInterface", "addWebMessageListener", "evaluateJavascript", "postWebMessage", "NativeBridgeChannel")) {
            assertFalse("LegacyEngineCompat must never touch $surface", src.contains(surface))
        }
        assertEquals(1, Regex("""addDocumentStartJavaScript\(""").findAll(src).count())
        assertTrue(src.contains("addDocumentStartJavaScript(webView, script, LegacyEnginePolicy.ALLOWED_ORIGINS)"))
        assertTrue("the layer needs a DOCUMENT_START_SCRIPT probe", src.contains("WebViewFeature.DOCUMENT_START_SCRIPT"))
        assertTrue("the install line must be durable", src.contains("PlayerLogger.durable("))
    }

    @Test
    fun `the late injector evaluates the layer and one probe, and reaches no native surface`() {
        val src = code(read("src/main/java/com/educms/player/webcompat/LegacyEngineLateInjector.kt"))
        for (surface in listOf("addJavascriptInterface", "addWebMessageListener", "addDocumentStartJavaScript", "postWebMessage", "NativeBridgeChannel")) {
            assertFalse("LegacyEngineLateInjector must never touch $surface", src.contains(surface))
        }
        assertEquals(2, Regex("""evaluateJavascript\(""").findAll(src).count())
        assertTrue(src.contains("evaluateJavascript(script, null)"))
        assertTrue(src.contains("evaluateJavascript(LegacyEnginePolicy.LATE_PROBE_JS)"))
        assertTrue("only real web documents", src.contains("LegacyEnginePolicy.lateTargetUrl(url)"))
        assertTrue("the proof line must be durable", src.contains("PlayerLogger.durable("))
    }

    @Test
    fun `the overlay client feeds every main-frame document to the late injector`() {
        val main = code(read("src/main/java/com/educms/player/MainActivity.kt"))
        val overlay = block(main, "private fun configureUrlOverlay(", "\n    private fun showUrlOverlay(")
        for (cb in listOf("override fun onPageStarted(", "override fun onPageCommitVisible(", "override fun onPageFinished(")) {
            val body = overlay.substringAfter(cb, "").substringBefore("override fun ")
            assertTrue("$cb missing in the overlay client", body.isNotEmpty())
            assertTrue("$cb must call legacyLate?.inject(view, url)", body.contains("legacyLate?.inject(view, url)"))
        }
        assertEquals(3, Regex("""legacyLate\?\.inject\(""").findAll(overlay).count())
    }
}
