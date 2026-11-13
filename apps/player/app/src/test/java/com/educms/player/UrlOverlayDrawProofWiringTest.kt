package com.educms.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * Source facts about the website view's draw proof (2026-11-13). The rules are
 * in [UrlOverlayDrawProofPolicy] and tested there; this pins how the Activity
 * uses them — above all that the third-party view is still given no bridge and
 * exactly one constant script.
 */
class UrlOverlayDrawProofWiringTest {
    private fun moduleRoot(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "src/main/AndroidManifest.xml").isFile) dir = dir.parentFile
        Assume.assumeTrue("player module root not on disk", dir != null)
        return dir!!
    }

    private fun read(rel: String): String = File(moduleRoot(), rel).readText()

    private fun codeOnly(src: String): String = src
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .filterNot { it.trimStart().startsWith("//") }
        .joinToString("\n")

    private val main: String by lazy { codeOnly(read("src/main/java/com/educms/player/MainActivity.kt")) }

    private fun fn(name: String): String =
        main.substringAfter("private fun $name(", "").substringBefore("\n    private fun ").also {
            assertTrue("$name not found", it.isNotEmpty())
        }

    @Test fun `the site view is still configured with no bridge and no injected script`() {
        val config = main.substringAfter("private fun configureUrlOverlay(").substringBefore("\n    private fun showUrlOverlay(")
        for (surface in listOf("addJavascriptInterface", "addWebMessageListener", "addDocumentStartJavaScript", "evaluateJavascript(")) {
            assertFalse("configureUrlOverlay..showUrlOverlay must not contain $surface", config.contains(surface))
        }
        assertEquals(1, Regex("""\.addJavascriptInterface\(""").findAll(main).count())
        assertFalse(main.contains("addWebMessageListener(urlOverlayView"))
    }

    @Test fun `exactly one script is evaluated in the site for the proof, and it is the constant probe`() {
        val probe = fn("runUrlOverlayProbe")
        assertEquals(1, Regex("""evaluateJavascript\(""").findAll(probe).count())
        assertTrue(probe.contains("view.evaluateJavascript(UrlOverlayDrawProofPolicy.PROBE_JS)"))
        assertTrue("the probed view must be the overlay", probe.contains("val view = urlOverlayView"))
        // Every script the Activity evaluates in the overlay, by receiver: the
        // IME scroll reset, the Website Tabs storage wipe, and this probe.
        assertEquals(2, Regex("""urlOverlayView\.evaluateJavascript\(""").findAll(main).count())
        assertEquals(1, Regex("""\bview\.evaluateJavascript\(""").findAll(main).count())
        // The probe is a compile-time constant: nothing from the page, the URL
        // or the server is ever spliced into it.
        val policy = read("src/main/java/com/educms/player/UrlOverlayDrawProofPolicy.kt")
        assertTrue(policy.contains("const val PROBE_JS: String ="))
    }

    @Test fun `the state is told to the player page, never to the site`() {
        val emit = fn("emitUrlOverlayState")
        assertTrue(emit.contains("webView.evaluateJavascript(UrlOverlayDrawProofPolicy.stateEventJs(url, state, attempts), null)"))
        assertFalse(emit.contains("urlOverlayView"))
        assertTrue("Website Tabs is never reported as a URL asset", fn("reportUrlOverlayState").contains("if (webTabsActive) return"))
    }

    @Test fun `a probe never runs and a blank page is never reloaded under an emergency hold`() {
        val probe = fn("runUrlOverlayProbe")
        val hold = "runCatching { DisplayEmergency.isHeld(applicationContext) }.getOrDefault(true)"
        assertTrue("an unreadable hold must count as held", probe.contains(hold))
        assertTrue(probe.indexOf(hold) < probe.indexOf("evaluateJavascript("))
        assertTrue(probe.contains("webTabsActive"))
        val reload = fn("scheduleUrlOverlayBlankReload")
        assertTrue(reload.contains(hold))
        assertTrue(reload.indexOf(hold) < reload.indexOf("urlOverlayView.loadUrl(target)"))
        assertTrue(reload.contains("UrlOverlayDrawProofPolicy.shouldReloadBlank("))
        assertTrue(reload.contains("HostAllowlist.isSafeWebUrl(target)"))
        assertTrue("only the saved target is ever reloaded", reload.contains("urlOverlayCurrentUrl != target"))
        assertEquals(1, Regex("""\.loadUrl\(""").findAll(reload).count())
        assertTrue("a reload that never finishes must fall to the failed-load path", reload.contains("URL_OVERLAY_LOAD_TIMEOUT_MS"))
    }

    @Test fun `only the verdict reloads, and the reload count is spent before the load`() {
        val result = fn("onUrlOverlayProbeResult")
        val blank = result.substringAfter("UrlOverlayDrawProofPolicy.Verdict.BLANK ->").substringBefore("UrlOverlayDrawProofPolicy.Verdict.UNKNOWN ->")
        val unknown = result.substringAfter("UrlOverlayDrawProofPolicy.Verdict.UNKNOWN ->")
        val drawn = result.substringAfter("UrlOverlayDrawProofPolicy.Verdict.DRAWN ->").substringBefore("UrlOverlayDrawProofPolicy.Verdict.BLANK ->")
        assertTrue(blank.contains("scheduleUrlOverlayBlankReload(target)"))
        assertFalse("UNKNOWN must never reload", unknown.contains("scheduleUrlOverlayBlankReload") || unknown.contains("loadUrl("))
        assertFalse(drawn.contains("loadUrl("))
        assertTrue("a drawn page clears the reload count", drawn.contains("urlOverlayBlankReloads = 0"))
        assertEquals("only the blank branch may schedule a reload", 1, Regex("""scheduleUrlOverlayBlankReload\(target\)""").findAll(main).count())
        val reload = fn("scheduleUrlOverlayBlankReload")
        assertTrue(reload.indexOf("urlOverlayBlankReloads += 1") in 1 until reload.indexOf("urlOverlayView.loadUrl(target)"))
    }

    @Test fun `the proof starts only from a finished web main frame of the plain URL asset`() {
        val finished = main.substringAfter("private fun configureUrlOverlay(")
            .substringAfter("override fun onPageFinished(view: WebView?, url: String?)")
            .substringBefore("SpatialNavigation.inject(it)")
        val start = finished.substringBefore("startUrlOverlayProof()")
        assertTrue(finished.contains("startUrlOverlayProof()"))
        val condition = start.substringBeforeLast("if (urlOverlayProofArmed)").substringAfterLast("if (")
        for (guard in listOf(
            "view === urlOverlayView", "!webTabsActive", "urlOverlayCurrentUrl != null", "!urlOverlayRecoveryFailed",
            "url == overlayLastStartedUrl", "UrlOverlayDrawProofPolicy.isProbeableUrl(url)",
        )) {
            assertTrue("missing guard $guard", condition.contains(guard))
        }
        assertTrue("an un-armed view must not be probed", finished.contains("if (urlOverlayProofArmed) startUrlOverlayProof()"))
    }

    @Test fun `nothing runs until the player page asks, and off stands it down`() {
        // The two places a proof can start: a finished main frame of an armed
        // view, and the page asking after the main frame already finished.
        val calls = Regex("""startUrlOverlayProof\(\)""").findAll(main.replace("private fun startUrlOverlayProof()", "")).count()
        assertEquals(2, calls)
        val answer = fn("answerUrlOverlayReport")
        assertEquals("only the page's question arms the proof", 1, Regex("""urlOverlayProofArmed = true""").findAll(main).count())
        assertTrue(answer.contains("urlOverlayProofArmed = true"))
        assertTrue("armed only for the URL on glass", answer.substringBefore("urlOverlayProofArmed = true").contains("asked == current"))
        val standDown = answer.substringAfter("UrlOverlayDrawProofPolicy.STAND_DOWN").substringBefore("val current")
        assertTrue(standDown.contains("urlOverlayProofArmed = false"))
        assertTrue(standDown.contains("cancelUrlOverlayProof(forget = false)"))
        assertEquals("off", UrlOverlayDrawProofPolicy.STAND_DOWN)
        assertFalse(UrlOverlayDrawProofPolicy.isProbeableUrl(UrlOverlayDrawProofPolicy.STAND_DOWN))
        // Un-armed: no probe, no reload, no event, and the TLS path stays as the platform left it.
        assertTrue(fn("runUrlOverlayProbe").substringBefore("evaluateJavascript(").contains("!urlOverlayProofArmed"))
        assertTrue(fn("scheduleUrlOverlayBlankReload").substringBefore("urlOverlayView.loadUrl(target)").contains("!urlOverlayProofArmed"))
        assertTrue(fn("reportUrlOverlayState").contains("if (urlOverlayProofArmed) emitUrlOverlayState("))
        assertTrue(fn("showUrlOverlay").substringBefore("cancelUrlOverlayRecovery()").contains("if (urlOverlayProofArmed) {"))
        val ssl = main.substringAfter("override fun onReceivedSslError(").substringBefore("override fun onPageStarted(")
        assertTrue(ssl.substringBefore("failUrlOverlayLoad(").substringAfterLast("if (").contains("urlOverlayProofArmed"))
        // Leaving the glass disarms it.
        assertTrue(fn("cancelUrlOverlayProof").substringAfter("if (forget)").contains("urlOverlayProofArmed = false"))
    }

    @Test fun `the proof is dropped when the URL leaves the glass or Website Tabs takes the view`() {
        val forget = "cancelUrlOverlayProof(forget = true)"
        assertTrue(fn("hideUrlOverlay").contains(forget))
        assertTrue(fn("showWebTabs").contains(forget))
        val show = fn("showUrlOverlay")
        assertTrue(show.contains(forget))
        assertTrue(show.indexOf(forget) < show.indexOf("urlOverlayView.loadUrl(cleanUrl)"))
        assertTrue(show.contains("reportUrlOverlayState(UrlOverlayDrawProofPolicy.STATE_LOADING)"))
        // A failed load keeps the count (the URL is still assigned) and says so.
        val fail = fn("failUrlOverlayLoad")
        assertTrue(fail.contains("cancelUrlOverlayProof(forget = false)"))
        assertTrue(fail.contains("reportUrlOverlayState(UrlOverlayDrawProofPolicy.STATE_FAILED)"))
        val cancel = fn("cancelUrlOverlayProof")
        assertTrue(cancel.contains("urlOverlayProofGeneration += 1"))
        assertTrue(cancel.contains("removeCallbacks"))
    }

    @Test fun `a face, which never owns the website view, answers failed to its own page`() {
        val face = codeOnly(read("src/main/java/com/educms/player/face/FacePlayerHost.kt"))
        val arm = face.substringAfter("onUrlOverlayReport = { url ->", "").substringBefore("onOpenSettingsForManager")
        assertTrue("the face bridge does not answer urlOverlayReport", arm.isNotEmpty())
        assertTrue(arm.contains("UrlOverlayDrawProofPolicy.STATE_FAILED"))
        assertTrue("a retired face document must not be told", arm.contains("nonce !== faceNonce"))
        assertTrue(arm.contains("UrlOverlayDrawProofPolicy.STAND_DOWN"))
        assertFalse(arm.contains("urlOverlayView"))
    }

    @Test fun `a refused certificate is cancelled, never proceeded`() {
        val ssl = main.substringAfter("override fun onReceivedSslError(").substringBefore("override fun onPageStarted(")
        assertTrue(ssl.contains("handler.cancel()"))
        assertFalse(main.contains(".proceed()"))
    }

    @Test fun `the bridge method is on both surfaces, ungated, and wired`() {
        val bridge = codeOnly(read("src/main/java/com/educms/player/WebAppBridge.kt"))
        assertTrue(Regex("""@JavascriptInterface\s+fun urlOverlayReport\(url: String\)""").containsMatchIn(bridge))
        assertFalse(bridge.contains("gate(\"urlOverlayReport\""))
        assertFalse(com.educms.player.security.BridgeNonce.GATED_METHODS.contains("urlOverlayReport"))
        val channel = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        assertTrue(channel.contains("\"urlOverlayReport\" -> { bridge.urlOverlayReport(strAt(args, 0)); null }"))
        assertTrue(main.contains("onUrlOverlayReport = { url ->"))
        assertTrue(main.contains("runOnUiThread { answerUrlOverlayReport(url) }"))
        // The web half: advertised, kept out of KNOWN_METHODS (rule 9), never nonce-prefixed.
        val ts = File(moduleRoot(), "../../web/src/app/player/nativeBridge.ts")
        Assume.assumeTrue("web sources not on disk", ts.isFile)
        val web = ts.readText()
        assertTrue(web.contains("'urlOverlayReport',"))
        assertTrue(web.contains("m !== 'urlOverlayReport'"))
        val gated = Regex("""const LEGACY_NONCE_GATED_METHODS: readonly string\[\] = \[([\s\S]*?)\n\];""").find(web)?.groupValues?.get(1)
        Assume.assumeTrue(gated != null)
        assertFalse(gated!!.contains("urlOverlayReport"))
    }
}
