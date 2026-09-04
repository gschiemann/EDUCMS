package com.educms.player.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * SEC-002 — THE WIRING GUARD.
 *
 * [HostileFrameBridgeTest] proves the gate refuses. This proves the gate is
 * actually IN FRONT OF the every-frame surface, which is a different claim
 * and the one that failed before: the finding was never that the nonce was
 * wrong, it was that `addJavascriptInterface` was called unconditionally
 * with nothing in front of it at all. "112 green tests, no caller"
 * (2026-08-14) is the shape this file exists to catch.
 *
 * It also carries the SEC-002 half of the three-file bridge contract: the
 * gated-method list must be identical in Kotlin and in
 * `apps/web/src/app/player/nativeBridge.ts`. Drift there fails in the
 * dangerous direction — Android's legacy bridge dispatches by ARITY, so a
 * web side that passes a nonce to a method the APK did not overload throws
 * inside the WebView and the call is LOST.
 *
 * Skipped (not failed) when the sources are not on disk.
 */
class LegacyBridgeExposureTest {

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

    /** `apps/web/...` from `apps/player/app/...`. */
    private fun readWeb(relative: String): String {
        val root: File? = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val apps: File? = root?.parentFile?.parentFile
        Assume.assumeTrue("apps/ not on disk", apps != null)
        val f = File(apps, relative)
        Assume.assumeTrue("web source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private val mainActivity: String get() = read("src/main/java/com/educms/player/MainActivity.kt")
    private val webAppBridge: String get() = read("src/main/java/com/educms/player/WebAppBridge.kt")

    // ─────────────────────────────────────────────────────────────
    // 1. The every-frame surface is CONDITIONAL
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `addJavascriptInterface is called exactly once, and only inside the legacy branch`() {
        val src = mainActivity
        val calls = Regex("""\.addJavascriptInterface\(""").findAll(src).count()
        assertEquals(
            "addJavascriptInterface should be attached from exactly ONE place",
            1,
            calls,
        )

        val guard = src.indexOf("if (legacyBridgeInjected) {")
        assertTrue("the legacy-path guard is gone — the every-frame bridge is unconditional again", guard > 0)
        val call = src.indexOf(".addJavascriptInterface(")
        assertTrue("addJavascriptInterface is no longer inside the legacy-path guard", call > guard)
        // …and it is inside the SAME block: the guard's closing brace must
        // come after the call. Cheap structural check — the block is a
        // handful of lines and the brace is at a known indent.
        val blockEnd = src.indexOf("\n        }", guard)
        assertTrue("could not find the end of the legacy-path block", blockEnd > 0)
        assertTrue("addJavascriptInterface escaped the legacy-path block", call < blockEnd)
    }

    @Test
    fun `the legacy path is only taken when the compat shim could not be installed`() {
        val src = mainActivity
        assertTrue(
            "the shim decision is gone — every device would take the legacy path again",
            src.contains("NativeBridgeChannel.attachLegacyCompatShim(wv)"),
        )
        assertTrue(
            "legacyBridgeInjected must be the inverse of the shim result",
            src.contains("legacyBridgeInjected = !compatShim"),
        )
        assertTrue(
            "the channel must be attached BEFORE the shim decision",
            src.indexOf("nativeChannelActive = NativeBridgeChannel.attach(") <
                src.indexOf("attachLegacyCompatShim"),
        )
    }

    @Test
    fun `the nonce is delivered to the main frame only — never handed out over the bridge`() {
        val src = mainActivity
        assertTrue(
            "no document-start nonce delivery",
            src.contains("NativeBridgeChannel.injectBridgeNonceAtDocumentStart("),
        )
        assertTrue(
            "no top-frame fallback delivery for pre-document-start WebViews",
            src.contains("NativeBridgeChannel.injectBridgeNonceIntoTopFrame("),
        )
        // The one shortcut that would make the whole mechanism worthless:
        // a bridge method that returns the nonce. Every frame holds the
        // object, so every frame could ask.
        val bridgeSrc = webAppBridge
        val channelNonceIdx = bridgeSrc.indexOf("fun channelNonce()")
        assertTrue("channelNonce() is gone", channelNonceIdx > 0)
        val before = bridgeSrc.substring(maxOf(0, channelNonceIdx - 400), channelNonceIdx)
        assertFalse(
            "channelNonce() must NOT be a @JavascriptInterface — that would hand the nonce to every frame",
            before.substringAfterLast("*/").contains("@JavascriptInterface"),
        )
        assertTrue(
            "channelNonce() must stay internal",
            bridgeSrc.contains("internal fun channelNonce()"),
        )
    }

    /**
     * ⛔ THE SEC-002 RE-AUDIT FINDING, GUARDED AT THE SOURCE (2026-09-04).
     *
     * [BridgeNonceTest] asserts the BEHAVIOUR of default-deny. This asserts
     * the SHAPE, because the specific regression is a one-line
     * re-introduction — `if (!isArmed) return true` at the top of
     * [BridgeNonce.accepts] — that a future "stop refusing calls on old web
     * bundles" fix would reach for first, and that a behaviour test could
     * be edited to accommodate in the same commit.
     */
    @Test
    fun `accepts() has no unarmed-allow escape`() {
        val src = read("src/main/java/com/educms/player/security/BridgeNonce.kt")
        val body = src.substringAfter("fun accepts(candidate: String?)").substringBefore("\n    /**")
        assertTrue("accepts() not found — did the signature change?", body.isNotEmpty())
        assertFalse(
            "accepts() allows callers again while unarmed — this is the pre-arm " +
                "fail-open window the re-audit closed. See the class KDoc before touching it.",
            Regex("""if\s*\(\s*!\s*isArmed\s*\)\s*return\s+true""").containsMatchIn(body),
        )
        assertTrue(
            "accepts() no longer refuses a missing/empty nonce outright",
            body.contains("if (candidate.isNullOrEmpty()) return false"),
        )
        // The refusal must be constant-time. A `==` on the raw strings hands
        // a frame the value one character at a time.
        assertTrue(
            "accepts() must compare with MessageDigest.isEqual (constant time)",
            body.contains("MessageDigest.isEqual("),
        )
    }

    /**
     * Default-deny only holds if the value actually REACHES the main frame,
     * so the delivery path is now a bounded retry rather than a single shot
     * per callback. Without this, a Chromium-83 panel that drops the
     * pre-commit `evaluateJavascript` would wait for `onPageFinished` — tens
     * of seconds on a slow uplink — with its own control plane shut.
     */
    @Test
    fun `the top-frame nonce delivery retries until it arms`() {
        val src = mainActivity
        assertTrue(
            "the delivery pump is gone — a dropped injection now costs the main frame its bridge",
            src.contains("private fun pumpBridgeNonceDelivery("),
        )
        assertTrue(
            "the retry step is gone",
            src.contains("private fun deliverBridgeNonceOnce("),
        )
        assertTrue(
            "the retry is unbounded — a forever-timer on a panel that must not jank",
            src.contains("BRIDGE_NONCE_RETRY_MAX") && src.contains("bridgeNonceRetriesLeft -= 1"),
        )
        assertTrue(
            "the main-frame document callback no longer drives delivery",
            src.contains("onMainFrameDocument = { view, _ -> pumpBridgeNonceDelivery(view) }"),
        )
        // Three delivery points across a navigation, not two. onPageCommitVisible
        // is the first moment evaluateJavascript provably targets the NEW document.
        val client = read("src/main/java/com/educms/player/SafePlayerWebViewClient.kt")
        for (cb in listOf("onPageStarted", "onPageCommitVisible", "onPageFinished")) {
            val at = client.indexOf("override fun $cb(")
            assertTrue("$cb is not overridden", at > 0)
            val body = client.substring(at, minOf(client.length, at + 1400))
            assertTrue(
                "$cb does not deliver the bridge nonce",
                body.contains("notifyMainFrameDocument("),
            )
        }
    }

    /**
     * The classification is load-bearing: it is the whole reason default-deny
     * cannot brick a screen. If a lifeline method is ever added to the gated
     * list, a device that cannot arm loses content, recovery or — worst — its
     * emergency hold.
     */
    @Test
    fun `no lifeline method is ever gated`() {
        val lifeline = listOf(
            "reload",
            "hideUrlOverlay",
            "heartbeat",
            "heartbeatV2",
            "bootProof",
            "registerAttempt",
            "registerResult",
            "openSetupChecklist",
            // ⚠️ LIFE SAFETY. Gating this is how an alert fails to reach a panel.
            "displayEmergencyHold",
            "displayApply",
            "displaySetSchedule",
            "displayEnrollAdmin",
        )
        for (m in lifeline) {
            assertFalse(
                "\"$m\" is a LIFELINE method and must never require the nonce — a device " +
                    "that cannot arm would lose it. See BridgeNonce.GATED_METHODS class 2.",
                BridgeNonce.GATED_METHODS.contains(m),
            )
            assertFalse(
                "\"$m\" calls gate(\"$m\", …) in WebAppBridge — that is the same brick, " +
                    "one layer down",
                webAppBridge.contains("gate(\"$m\""),
            )
        }
    }

    /**
     * The compat shim is INLINE JAVASCRIPT shipped to a WebView, which is the
     * exact class of thing that broke every holiday board in Safari for two
     * months (CLAUDE.md cross-browser rule #2: no inline JS you have not
     * verified parses). It is hand-assembled in Kotlin, so a stray edit can
     * make it unparseable with no compiler anywhere to notice.
     *
     * This guard keeps it inside the ES5 subset and structurally balanced.
     * It is NOT a substitute for running it: the exact assembled string was
     * executed in a JS engine during this change (methods materialise, calls
     * post to the channel, an existing object is not clobbered, and a
     * missing channel is inert rather than throwing) — see the SEC-002
     * report, §5.3 item 3, which records that this is a one-off check and
     * not a standing test.
     */
    @Test
    fun `the legacy compat shim stays inside the ES5 subset and is balanced`() {
        val src = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        val body = src.substringAfter("fun attachLegacyCompatShim(").substringBefore("\n    }")
        val js = Regex("""append\("([^"]*)"\)""").findAll(body)
            .joinToString("") { it.groupValues[1] }
        assertTrue("no shim JS found — did the builder stop using append(\"…\")?", js.length > 200)
        for (banned in listOf("=>", "`", "const ", "let ", "class ")) {
            assertFalse(
                "the shim uses \"$banned\" — it must stay ES5 so an old WebView can parse it",
                js.contains(banned),
            )
        }
        assertEquals("unbalanced parens in the shim JS", js.count { it == '(' }, js.count { it == ')' })
        assertEquals("unbalanced braces in the shim JS", js.count { it == '{' }, js.count { it == '}' })
        assertEquals("unbalanced brackets in the shim JS", js.count { it == '[' }, js.count { it == ']' })
        // Its two load-bearing behaviours, asserted as source facts:
        assertTrue(
            "the shim must not clobber a real addJavascriptInterface object",
            js.contains("if(window.EduCmsNative)return;"),
        )
        assertTrue(
            "the shim must look the channel up at CALL time, not at injection time " +
                "(the two document-start injections have no guaranteed order)",
            js.contains("var ch=window.EduCmsNativeChannel;"),
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Every gated method actually has a gate AND an overload
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `every gated method checks the gate and offers a nonce-bearing overload`() {
        val src = webAppBridge
        for (m in BridgeNonce.GATED_METHODS) {
            assertTrue(
                "\"$m\" is in GATED_METHODS but never calls gate(\"$m\", …) in WebAppBridge",
                src.contains("gate(\"$m\""),
            )
            // Two declarations: the historic arity and the nonce-bearing one.
            val decls = Regex("""\n\s+fun $m\(""").findAll(src).count()
            assertEquals(
                "\"$m\" needs BOTH the historic arity and a nonce-bearing overload " +
                    "(Android's legacy bridge dispatches by argument COUNT — a web side that " +
                    "passes a nonce to a method with no matching overload loses the call silently)",
                2,
                decls,
            )
        }
    }

    @Test
    fun `the channel dispatches gated methods through their nonce-bearing overload`() {
        val src = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        // Only the methods the channel actually exposes; `setDeviceToken` &
        // friends are all in METHODS, but this stays honest about which.
        val onChannel = BridgeNonce.GATED_METHODS.filter { src.contains("\"$it\" ->") }
        assertTrue("no gated method is reachable over the channel — did METHODS change?", onChannel.isNotEmpty())
        for (m in onChannel) {
            val arm = Regex(""""$m" ->[^\n]*""").find(src)?.value ?: ""
            assertTrue(
                "channel dispatch for \"$m\" does not pass channelNonce() — the secure transport " +
                    "would be refused by its own gate: $arm",
                arm.contains("channelNonce()"),
            )
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. The three-file contract: Kotlin <-> nativeBridge.ts
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `the gated list matches nativeBridge_ts exactly`() {
        val ts = readWeb("web/src/app/player/nativeBridge.ts")
        val block = Regex(
            """const LEGACY_NONCE_GATED_METHODS: readonly string\[\] = \[([\s\S]*?)\n\];""",
        ).find(ts)?.groupValues?.get(1)
        Assume.assumeTrue("LEGACY_NONCE_GATED_METHODS block not found", block != null)
        val webMethods = Regex("""'([A-Za-z0-9_]+)'""").findAll(block!!).map { it.groupValues[1] }.toList()
        assertEquals(
            "Kotlin BridgeNonce.GATED_METHODS and the web LEGACY_NONCE_GATED_METHODS have drifted. " +
                "That fails ASYMMETRICALLY: the web passing a nonce the APK has no overload for " +
                "loses the call inside the WebView with no error anywhere.",
            BridgeNonce.GATED_METHODS.sorted(),
            webMethods.sorted(),
        )
    }

    @Test
    fun `the web only prefixes the nonce when the APK actually injected one`() {
        val ts = readWeb("web/src/app/player/nativeBridge.ts")
        assertTrue(
            "legacyArgs() is gone — the legacy transport would send the historic arity to a gated APK",
            ts.contains("function legacyArgs("),
        )
        assertTrue(
            "the nonce must be read from the injected global, not inferred from a UA version",
            ts.contains("__eduCmsBridgeNonce"),
        )
        // The CHANNEL branch must never prefix: its dispatch reads args
        // positionally and the APK supplies the nonce itself there.
        val channelPost = Regex("""ch\.postMessage\(JSON\.stringify\(\{[^)]*\}\)\)""")
            .findAll(ts).map { it.value }.toList()
        assertTrue("no channel postMessage found", channelPost.isNotEmpty())
        for (p in channelPost) {
            assertFalse("a channel post is prefixing the legacy nonce: $p", p.contains("legacyArgs"))
        }
        // …and every legacy invocation must go through it.
        val legacyCalls = Regex("""legacy\[method\]\(\.\.\.[A-Za-z]+""").findAll(ts).map { it.value }.toList()
        assertTrue("no legacy invocation found", legacyCalls.isNotEmpty())
        for (c in legacyCalls) {
            assertTrue("a legacy invocation bypasses legacyArgs(): $c", c.contains("legacyArgs"))
        }
    }

    @Test
    fun `the nonce gate adds NO new bridge method names — the fleet-floor rule is untouched`() {
        // An arity change is invisible to `nativeHas`, so KNOWN_METHODS /
        // METHOD_FLOORS need no entries and the drift-guard count must not
        // move. If a future change adds a NAME it must go through the full
        // three-file contract instead — this assertion is the tripwire.
        val channel = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        val block = Regex("""private val METHODS = arrayOf\(([\s\S]*?)\n\s*\)""")
            .find(channel)?.groupValues?.get(1)
        Assume.assumeTrue("METHODS block not found", block != null)
        val names = Regex(""""([A-Za-z0-9_]+)"""").findAll(block!!).map { it.groupValues[1] }.toList()
        assertEquals(
            "NativeBridgeChannel.METHODS changed size. SEC-002 must not add a method NAME — " +
                "if this is a deliberate new method, update the web tables and the canary " +
                "count in nativeBridge.test.ts in the SAME commit (CLAUDE.md player rule 9).",
            30,
            names.size,
        )
    }
}
