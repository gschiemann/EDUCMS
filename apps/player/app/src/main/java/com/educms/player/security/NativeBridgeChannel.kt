package com.educms.player.security

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.educms.player.WebAppBridge
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Origin-scoped replacement for the `addJavascriptInterface` bridge
 * (AND-002, 2026-08-01 security remediation).
 *
 * ============================================================
 * THE PROBLEM THIS FIXES
 * ============================================================
 *
 * `WebView.addJavascriptInterface(WebAppBridge(...), "EduCmsNative")`
 * injects `window.EduCmsNative` into **every frame the WebView loads** —
 * not just our player page. `removeJavascriptInterface` is never called
 * and no bridge method inspects its caller. So all 17 native methods —
 * including `unpair()`, `exitToDeviceHome()`, `setBootstrap()` (the OTA
 * trust anchor) and `uploadDiagnostics()` (ships the device log off-box)
 * — were reachable from operator-authored HTML and third-party iframes.
 *
 * `WebViewCompat.addWebMessageListener` is the supported fix: the WebView
 * itself only materialises the JS object in frames whose origin matches
 * `allowedOriginRules`, and every message arrives tagged with its real
 * `sourceOrigin` plus an `isMainFrame` flag that JavaScript cannot forge.
 *
 * ============================================================
 * TWO INDEPENDENT GATES (both must pass)
 * ============================================================
 *
 *  1. **Origin.** `allowedOriginRules` is the single compile-time player
 *     origin from `HostAllowlist.playerOrigin()` — the same constant
 *     `MainActivity.loadPlayer()` navigates to. Re-verified per message
 *     against `sourceOrigin` so a future rules change can't silently
 *     widen the surface.
 *  2. **Main frame.** Sub-frame messages are dropped outright.
 *
 * The EXTERNAL_HTML signage boards mount in `allow-scripts`-only
 * sandboxed iframes, so their origin is opaque (`null`) and matches no
 * https rule. Both gates therefore refuse them: **those boards reach no
 * method over THIS CHANNEL.**
 *
 * ============================================================
 * SEC-002 (2026-09-04) — THE LEGACY SURFACE IS NOW DEVICE-CLASS SPLIT
 * ============================================================
 *
 * Until 2026-09-04 `MainActivity.configureWebView` called
 * `addJavascriptInterface(webAppBridge, "EduCmsNative")` UNCONDITIONALLY,
 * beside this channel. Android's legacy bridge has no origin scoping
 * whatsoever — it is materialised in EVERY frame the WebView loads,
 * sandbox flags and opaque origins included — so a sandboxed board, or any
 * third-party page a WEBPAGE widget iframes through `/api/v1/proxy/web`,
 * held `window.EduCmsNative` and could call `unpair()`,
 * `showUrlOverlay()`, `exitToDeviceHome()` and the rest.
 *
 * `configureWebView` now picks ONE of two paths per device:
 *
 *  A. **Channel + compat shim (no `addJavascriptInterface` at all).**
 *     Taken when this channel attached AND `DOCUMENT_START_SCRIPT` is
 *     supported. `window.EduCmsNative` is provided by
 *     [attachLegacyCompatShim] — an origin-scoped document-start script
 *     that forwards to this channel — so untrusted frames get NO native
 *     object of any kind. This is a real boundary, enforced by the WebView,
 *     and it is what closes SEC-002 on every device that can take it.
 *
 *  B. **Legacy object + per-boot nonce.** Taken when the channel cannot
 *     attach, or can but has no document-start injection (the
 *     Chromium-83/87 NovaStar Taurus posters). The every-frame object still
 *     exists because it is the only transport those panels have, and the
 *     control-plane methods on it require [com.educms.player.security
 *     .BridgeNonce] — see that class for the mitigation-not-a-boundary
 *     argument, and
 *     `docs/research/2026-09-02-efficiency-audit/1F-bridge-nonce-design.md`
 *     for the original design.
 *
 * `MainActivity.deviceInfoJson()` reports which path a screen took
 * (`legacyBridge`), so "how much of the fleet is still on path B" is a
 * dashboard question rather than a per-device log grep.
 *
 * ============================================================
 * ⚠️ WHY THE NAME `EduCmsNative` STILL EXISTS ON PATH A
 * ============================================================
 *
 * The APK and the web bundle deploy INDEPENDENTLY (GitHub Releases +
 * OTA vs. Vercel), and the player's service worker can serve a cached
 * bundle. A kiosk can take the APK update days before the web deploy, or
 * the reverse. If the `EduCmsNative` NAME simply vanished, whichever half
 * updated first would talk to a bridge that isn't there — on a hallway
 * display whose only job is to show a lockdown alert. The compat shim
 * keeps the name answering while removing the every-frame exposure, which
 * is the part that was dangerous.
 *
 * **REMOVAL CRITERIA for the legacy `addJavascriptInterface` surface**
 * (all four, verified before the commit that deletes path B — path A no
 * longer calls it at all):
 *
 *   1. A Player release carrying BOTH surfaces has been the minimum
 *      fleet version for ≥ 30 days — i.e. the dashboard's screen list
 *      shows no `appVersion` older than that release across all tenants.
 *   2. The web bundle that prefers this channel has been live in
 *      production for ≥ 30 days with no rollback, so no cached/offline
 *      web build in the field still calls only `window.EduCmsNative`.
 *      (The service worker can serve a stale bundle — this is the
 *      constraint that actually binds.)
 *   3. Fleet telemetry shows zero legacy-path use: the web module stamps
 *      `bridgeTransport: 'legacy' | 'channel' | 'none'` into the
 *      render-proof/heartbeat payload; the count of `legacy` must be 0
 *      for 14 consecutive days.  ← NOT YET WIRED, see the note in
 *      `nativeBridge.ts`; wiring it is a prerequisite for removal.
 *   4. `WEB_MESSAGE_LISTENER` is supported on every device in the fleet
 *      (grep the boot log line below). Any device that logs DEGRADED is
 *      still on the legacy bridge and would be bricked by the removal.
 *
 * Until all four hold, deleting the legacy surface is a fleet-wide
 * outage, not a cleanup.
 */
object NativeBridgeChannel {

    private const val TAG = "NativeBridgeChannel"

    /** Name of the injected JS object. Must match `nativeBridge.ts`. */
    const val JS_OBJECT_NAME = "EduCmsNativeChannel"

    /**
     * Every method reachable over the channel. Injected into the page at
     * document start as `window.__eduCmsNativeChannelMethods` so the web
     * side can do SYNCHRONOUS capability checks (several call sites test
     * `typeof bridge.checkForUpdates === 'function'` to decide whether to
     * render an "Install update" button). Without this the web side would
     * have to await a round trip before it could render.
     */
    private val METHODS = arrayOf(
        // fire-and-forget
        "exitToDeviceHome",
        "unpair",
        "reload",
        "heartbeat",
        // 2026-08-30 (W2-4, v1.1.7) — heartbeat + syncOk verdict for the
        // content watchdog. THREE-FILE ATOMIC CHANGE: this array, the web's
        // NATIVE_VOID_METHODS, and the dispatch arm below. The web side
        // feature-detects and falls back to plain heartbeat() on older APKs.
        "heartbeatV2",
        "setOrientation",
        "setBootstrap",
        // 2026-08-25 (v1.1.5) — hands the OTA worker this screen's device
        // JWT. Fire-and-forget and WRITE-ONLY; there is deliberately no
        // getter on either surface. See WebAppBridge.onSetDeviceToken.
        "setDeviceToken",
        "showUrlOverlay",
        "hideUrlOverlay",
        "openSettingsForManager",
        // 2026-08-25 (v1.1.6) — raises the setup checklist on this panel,
        // driven from the dashboard via a signed OPEN_SETUP frame. Touches
        // no hardware and grants nothing; see WebAppBridge.openSetupChecklist
        // for why it is not routed through `displayApply` and not
        // trust-gated. THREE-FILE ATOMIC CHANGE: this array, the web's
        // NATIVE_VOID_METHODS, and the drift-guard canary count.
        "openSetupChecklist",
        // ── BOOT + REGISTRATION PROOF (2026-09-02, P0-2, v1.1.13) ────────
        // The three facts the native side cannot observe for itself. An
        // HTTP 200 plus `onPageFinished` is satisfied perfectly by a
        // server-rendered shell whose client JS never ran — which is
        // exactly how Android-9 Goodview panels sat on "Connecting to your
        // CMS…" for days with a healthy-looking APK. Fed to
        // com.educms.player.boot.BootProgressTracker; see BootDiagnostics.
        //
        // THREE-FILE ATOMIC CHANGE: this array, the web's
        // NATIVE_VOID_METHODS, and the drift-guard canary count. The web
        // side feature-detects and skips the call on an older APK.
        "bootProof",
        "registerAttempt",
        "registerResult",
        // value-returning (Promise-based on the web side)
        "deviceInfo",
        // 2026-08-13 — `probeDisplay` had a dispatch arm but was MISSING
        // from this array, so `onMessage`'s METHODS gate replied
        // "unknown method" and the arm was unreachable: the capability
        // probe only ever worked over the legacy `window.EduCmsNative`
        // object. Adding it here is what makes it reachable on every
        // channel-transport device.
        "probeDisplay",
        // Display CONTROL (see com.educms.player.display). The MUTATORS
        // are dispatched to channel-only entry points on WebAppBridge,
        // because their `@JavascriptInterface` twins UNCONDITIONALLY
        // mark the caller untrusted and are restricted to the
        // recovery-direction subset (wake / raise brightness).
        "displayCapabilities",
        "displayApply",
        "displaySetSchedule",
        // ⚠️ LIFE SAFETY — the emergency interlock. The web player calls
        // this on WS OVERRIDE / ALL_CLEAR and on every manifest poll
        // carrying an `emergency` field, so a screen on the HTTP polling
        // backstop is covered too. See DisplayEmergency.
        "displayEmergencyHold",
        // One-tap device-admin enrolment. Registering it here (and in
        // nativeBridge.ts, and bumping the drift-guard canary) is the
        // THREE-FILE ATOMIC CHANGE the enrolment wave could not make on its
        // own: the guard asserts sorted equality between this array and the
        // web's, so a Kotlin-only or web-only addition turns the blocking
        // web-jest job red. See PlayerAdminReceiver / DeviceAdminEnrollment.
        "displayEnrollAdmin",
        "checkForUpdates",
        // 2026-08-25 (v1.1.5) — the PANEL BUTTON's own update path. Its
        // presence in this list is also the web side's version probe:
        // `nativeHas('checkForUpdatesUserInitiated')` false → pre-1.1.5 APK
        // → fall back to plain `checkForUpdates`. See WebAppBridge.
        "checkForUpdatesUserInitiated",
        "getRecentLogs",
        "uploadDiagnostics",
        "ctsSerialEnabled",
        "ctsSerialConnect",
        "ctsSerialDisconnect",
        "ctsSerialStatus",
    )

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Single worker thread. `addJavascriptInterface` methods run on
     * WebView's own "JavaBridge" thread — NOT the UI thread — and several
     * handlers rely on that (`getRecentLogs` reads a file, `ctsSerial*`
     * opens a tty). `WebMessageListener.onPostMessage`, by contrast, is
     * delivered on the UI thread. Hopping to a single background thread
     * here preserves the legacy threading semantics exactly (including
     * call ordering) instead of moving blocking I/O onto the UI thread of
     * a kiosk that must never jank.
     */
    private val worker = Executors.newSingleThreadExecutor { r ->
        val t = Thread(r, "educms-bridge")
        t.isDaemon = true
        t
    }

    /**
     * ⚠️ THE LIFELINE LANE (2026-09-16, double-sided displays).
     *
     * [worker] is ONE thread shared by every attached WebView. With a
     * second face that is a head-of-line block on the emergency path: a
     * face's blocking `getRecentLogs` (reads a log file) or
     * `ctsSerialConnect` (opens a tty) would serialise AHEAD of the OTHER
     * face's `displayEmergencyHold`. Contract §3 is explicit that a wedged
     * side B must not be able to delay, suppress or queue side A's
     * lockdown.
     *
     * This changes NO gate: the four ordered checks in [onMessage]
     * (main-frame, exact-origin re-verify, JSON parse, METHODS membership)
     * all run before an executor is chosen, and the nonce/trust semantics
     * of every method are untouched. It only stops slow work from queueing
     * in front of an alert.
     *
     * Still SINGLE-threaded, so ordering WITHIN the lifeline lane is
     * preserved — two holds from the same face cannot land out of order.
     */
    private val lifelineWorker = Executors.newSingleThreadExecutor { r ->
        val t = Thread(r, "educms-bridge-lifeline")
        t.isDaemon = true
        t
    }

    /**
     * Methods that ride [lifelineWorker]. Deliberately the smallest set
     * that keeps an alert moving — widening it would re-create the
     * head-of-line block inside the lane that exists to avoid it.
     */
    /** True while FaceHostController is hosting at least one secondary face. */
    @Volatile
    private var multiFace: Boolean = false

    fun setMultiFace(hosting: Boolean) {
        multiFace = hosting
    }

    private val LIFELINE_LANE = setOf(
        // ⚠️ THE HOLD, AND ONLY THE HOLD (2026-09-19, verifier finding 4).
        // This executor is ONE thread for the whole process, so every method
        // in it is a queue the alert can wait behind. `displayApply` and
        // `displaySetSchedule` used to ride here; both block on
        // DisplayControlRegistry.resolve's `synchronized(this)` and on a sysfs
        // provider's own monitor, which put side B's display work in front of
        // side A's lockdown — the very head-of-line block this lane exists to
        // remove. A face's bridge has no display-control lambdas at all (box
        // power and brightness belong to the primary), so the only thing two
        // faces can now contend for here is another hold.
        "displayEmergencyHold",
    )

    /** True when this WebView implementation supports the secure channel. */
    fun isSupported(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "feature probe failed: ${t.message}")
        false
    }

    /**
     * Attach the origin-scoped channel to [webView], dispatching to the
     * SAME [bridge] instance the legacy interface uses — one set of
     * handlers, so the two surfaces can never drift apart.
     *
     * Returns true when the channel is live. False means this device is
     * DEGRADED and running on the legacy bridge only; the reason is
     * logged.
     */
    fun attach(webView: WebView, bridge: WebAppBridge): Boolean {
        if (!isSupported()) {
            PlayerLogger.w(
                TAG,
                "DEGRADED — this WebView has no WEB_MESSAGE_LISTENER support (pre-M77). " +
                    "Staying on the legacy addJavascriptInterface bridge, which is reachable " +
                    "from every frame including sandboxed board iframes.",
            )
            return false
        }
        val origin = HostAllowlist.playerOrigin()
        if (origin == null) {
            PlayerLogger.e(
                TAG,
                "REFUSING to attach — cannot derive a player origin from BuildConfig.PLAYER_BASE_URL",
            )
            return false
        }
        return try {
            WebViewCompat.addWebMessageListener(
                webView,
                JS_OBJECT_NAME,
                setOf(origin),
                WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, replyProxy ->
                    onMessage(bridge, message, sourceOrigin, isMainFrame, replyProxy)
                },
            )
            injectMethodManifest(webView, origin)
            PlayerLogger.i(
                TAG,
                "secure bridge channel attached as window.$JS_OBJECT_NAME (origin=$origin, ${METHODS.size} methods)",
            )
            true
        } catch (t: Throwable) {
            PlayerLogger.e(TAG, "addWebMessageListener failed — staying on the legacy bridge", t)
            false
        }
    }

    /**
     * True when this WebView can run a script before any frame script AND
     * scope it to a single origin. Required for both the method manifest
     * and the legacy compatibility shim below.
     */
    fun supportsDocumentStartScript(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "document-start feature probe failed: ${t.message}")
        false
    }

    /**
     * SEC-002 — `window.EduCmsNative` WITHOUT `addJavascriptInterface`.
     *
     * ============================================================
     * WHAT THIS REPLACES AND WHY IT IS A REAL BOUNDARY
     * ============================================================
     *
     * The legacy `addJavascriptInterface` object is materialised by the
     * WebView in EVERY frame — sandbox flags and opaque origins included —
     * which is the whole of SEC-002. This shim defines the SAME global
     * name in JavaScript instead, delivered by
     * `addDocumentStartJavaScript` with the same single-origin rule the
     * channel uses. The WebView will not run it in a frame whose origin is
     * not exactly [HostAllowlist.playerOrigin]:
     *
     *   • an EXTERNAL_HTML board (`sandbox="allow-scripts"`, no
     *     `allow-same-origin`) has an opaque origin → no match, no object;
     *   • a WEBPAGE widget's proxied page (same sandbox, served from our
     *     own host) is opaque for the same reason → no match, no object;
     *   • a streaming embed (`allow-same-origin`, foreign host) carries the
     *     FOREIGN origin → no match, no object.
     *
     * And a first-party SUB-frame, which would match the origin rule, gets
     * an object whose messages [onMessage] drops on `isMainFrame`. So the
     * shim's reachable capability is exactly the channel's, by
     * construction, with no second code path to keep in step.
     *
     * ============================================================
     * WHAT IT IS FOR — AND ITS ONE HONEST DEGRADATION
     * ============================================================
     *
     * Today's web bundle prefers the channel and never touches this object.
     * The shim exists for a bundle that does NOT know about the channel:
     * the player's service worker can serve a cached build, and removal
     * criterion 2 below is exactly the risk that a stale bundle finds no
     * bridge at all. Rather than gambling on that criterion, we absorb it.
     *
     * ⚠️ THE VALUE-RETURNING METHODS RETURN `undefined` HERE. The legacy
     * `@JavascriptInterface` methods returned synchronously; the channel is
     * message-passing, so a JS shim physically cannot. Fire-and-forget
     * methods are fully equivalent. For a pre-channel cached bundle that
     * means: the device-info and diagnostics panels read empty, and
     * `ctsSerialEnabled()` reads falsy so a CTS scoreboard falls back to
     * Web Serial. All three are visible degradations of DIAGNOSTIC surfaces
     * on a bundle that is already a month stale; none of them touches
     * content, emergency state, pairing or recovery. The alternative —
     * keeping the every-frame object so those three keep working — is what
     * SEC-002 says must stop.
     *
     * Returns true when the shim was installed.
     */
    fun attachLegacyCompatShim(webView: WebView): Boolean {
        if (!supportsDocumentStartScript()) return false
        val origin = HostAllowlist.playerOrigin() ?: return false
        val list = METHODS.joinToString(",") { "\"$it\"" }
        // Kotlin string templates are OFF for this literal on purpose: it is
        // JavaScript, and a stray `$` interpolation would be a syntax error
        // shipped to a kiosk. Nothing here is interpolated except `list`.
        val script = buildString {
            append("(function(){try{")
            append("if(window.EduCmsNative)return;")
            append("var M=[").append(list).append("];")
            append("var api={};")
            append("var mk=function(m){return function(){")
            append("var ch=window.EduCmsNativeChannel;")
            append("if(!ch||typeof ch.postMessage!=='function')return undefined;")
            append("var a=Array.prototype.slice.call(arguments);")
            append("try{ch.postMessage(JSON.stringify({method:m,args:a}));}catch(e){}")
            append("return undefined;};};")
            append("for(var i=0;i<M.length;i++){api[M[i]]=mk(M[i]);}")
            append("window.EduCmsNative=api;")
            append("}catch(e){}})();")
        }
        return try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(origin))
            PlayerLogger.i(
                TAG,
                "legacy compat shim installed for $origin — addJavascriptInterface is NOT attached on this device",
            )
            true
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "legacy compat shim injection failed: ${t.message}")
            false
        }
    }

    /**
     * SEC-002 — deliver the per-boot [BridgeNonce] to the MAIN FRAME ONLY,
     * origin-scoped, at document start.
     *
     * Used on the devices that DO get `addJavascriptInterface` because they
     * cannot take the channel. `onDelivered` runs only when the injection
     * was accepted; the caller arms enforcement there and nowhere else.
     *
     * ⚠️ Never expose the nonce as a bridge method. Every frame holds the
     * legacy object, so a `getBridgeNonce()` would hand the value to the
     * exact callers it exists to exclude.
     */
    fun injectBridgeNonceAtDocumentStart(webView: WebView, nonce: String, onDelivered: () -> Unit): Boolean {
        if (!supportsDocumentStartScript()) return false
        val origin = HostAllowlist.playerOrigin() ?: return false
        if (!NONCE_PATTERN.matches(nonce)) {
            PlayerLogger.e(TAG, "refusing to inject a malformed bridge nonce")
            return false
        }
        val script = "(function(){try{window.${BridgeNonce.JS_GLOBAL}='$nonce';}catch(e){}})();"
        return try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(origin))
            onDelivered()
            true
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "bridge nonce document-start injection failed: ${t.message}")
            false
        }
    }

    /**
     * The Chromium-83/87 fallback for the same delivery.
     *
     * `evaluateJavascript` targets the WebView's TOP frame by construction,
     * so a sub-frame cannot observe the value — which is the property that
     * matters. Call it from the main-frame document callbacks; the reply
     * callback is the proof of delivery that arms the gate.
     */
    fun injectBridgeNonceIntoTopFrame(webView: WebView, nonce: String, onDelivered: () -> Unit) {
        if (!NONCE_PATTERN.matches(nonce)) {
            PlayerLogger.e(TAG, "refusing to inject a malformed bridge nonce")
            return
        }
        val script = "(function(){try{window.${BridgeNonce.JS_GLOBAL}='$nonce';return '1';}catch(e){return '0';}})();"
        try {
            webView.evaluateJavascript(script) { result ->
                if (result != null && result.contains("1")) onDelivered()
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "bridge nonce evaluateJavascript failed: ${t.message}")
        }
    }

    /**
     * Hex only. The nonce is interpolated into a JS string literal above, so
     * this is the guard that makes that interpolation provably safe rather
     * than trusting [BridgeNonce]'s generator to never change shape.
     */
    private val NONCE_PATTERN = Regex("^[0-9a-f]{32,128}$")

    /** Symmetric teardown. Safe to call when nothing was ever attached. */
    fun detach(webView: WebView) {
        if (!isSupported()) return
        try {
            WebViewCompat.removeWebMessageListener(webView, JS_OBJECT_NAME)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "removeWebMessageListener failed: ${t.message}")
        }
    }

    // ─── internals ──────────────────────────────────────────────

    /**
     * Publish the method list at document start, same origin scope as the
     * channel. Optional: on a WebView without DOCUMENT_START_SCRIPT the
     * web side falls back to probing the legacy object (this release) or
     * to assuming the full set (after legacy removal).
     */
    private fun injectMethodManifest(webView: WebView, origin: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            PlayerLogger.w(TAG, "DOCUMENT_START_SCRIPT unsupported — no synchronous method manifest")
            return
        }
        val list = METHODS.joinToString(",") { "\"$it\"" }
        val script = "(function(){try{window.__eduCmsNativeChannelMethods=[$list];}catch(e){}})();"
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(origin))
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "addDocumentStartJavaScript failed: ${t.message}")
        }
    }

    private fun onMessage(
        bridge: WebAppBridge,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        // ── Gate 2: main frame only. Independent of the origin rules —
        //    a same-origin iframe would pass gate 1 but must still not
        //    reach native code.
        if (!isMainFrame) {
            PlayerLogger.w(TAG, "DROPPED bridge message from a sub-frame (origin=${safeOrigin(sourceOrigin)})")
            return
        }
        // ── Gate 1 (re-verified): exact origin match.
        val expected = HostAllowlist.playerOrigin()
        val actual = originOf(sourceOrigin)
        if (expected == null || actual == null || !actual.equals(expected, ignoreCase = true)) {
            PlayerLogger.w(TAG, "DROPPED bridge message — origin ${safeOrigin(sourceOrigin)} is not $expected")
            return
        }

        val raw = try {
            message.data
        } catch (t: Throwable) {
            // Non-string payload (ArrayBuffer). Never valid for us.
            PlayerLogger.w(TAG, "DROPPED bridge message — unreadable payload: ${t.message}")
            null
        }
        if (raw == null || raw.isEmpty()) return

        val obj = try {
            JSONObject(raw)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "DROPPED bridge message — not JSON (${raw.length} chars)")
            return
        }

        val idRaw = obj.optString("id", "")
        val id: String? = if (idRaw.isEmpty()) null else idRaw
        val method = obj.optString("method", "")
        if (method.isEmpty()) {
            replyError(replyProxy, id, "missing method")
            return
        }
        if (!METHODS.contains(method)) {
            PlayerLogger.w(TAG, "DROPPED bridge message — unknown method \"$method\"")
            replyError(replyProxy, id, "unknown method")
            return
        }
        val args = obj.optJSONArray("args") ?: JSONArray()

        // ⚠️ Chosen AFTER all four gates, so this is a scheduling decision
        // and never a trust one. See [lifelineWorker].
        // Only when a second face is actually hosted. A single-sided screen —
        // every unit in the fleet today — has nothing to contend with, and
        // splitting its calls across two threads would let a display command
        // sent right after an all-clear overtake the release and be refused by
        // a hold that was about to lift. One worker, master's exact ordering.
        val executor = if (multiFace && LIFELINE_LANE.contains(method)) lifelineWorker else worker
        executor.execute {
            try {
                val result = dispatch(bridge, method, args)
                replyOk(replyProxy, id, result)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "bridge method \"$method\" threw: ${t.message}")
                replyError(replyProxy, id, "handler error")
            }
        }
    }

    /**
     * Dispatch by name to the SAME [WebAppBridge] instance the legacy
     * `@JavascriptInterface` surface exposes. Keeping one implementation
     * is the point: a future change to (say) `showUrlOverlay`'s scheme
     * check lands on both surfaces at once.
     */
    private fun dispatch(bridge: WebAppBridge, method: String, args: JSONArray): Any? {
        return when (method) {
            // ── SEC-002: the nonce-bearing overloads ─────────────────
            // A message that reaches here has already passed the exact-origin
            // AND main-frame gates, which is strictly MORE than the nonce
            // proves — so the channel is handed the value directly
            // (`channelNonce()` is not a `@JavascriptInterface` method and is
            // unreachable from any frame). Using the nonce-bearing overload
            // rather than the bare one keeps ONE gate in the code: there is no
            // second, un-gated path into these handlers to forget about.
            "exitToDeviceHome" -> { bridge.exitToDeviceHome(bridge.channelNonce()); null }
            "unpair" -> { bridge.unpair(bridge.channelNonce()); null }
            "reload" -> { bridge.reload(); null }
            "heartbeat" -> { bridge.heartbeat(); null }
            // 2026-08-30 (W2-4) — a malformed/empty payload degrades inside
            // heartbeatV2 itself (liveness ticks first, syncOk reads null).
            "heartbeatV2" -> { bridge.heartbeatV2(strAt(args, 0)); null }
            "setOrientation" -> { bridge.setOrientation(bridge.channelNonce(), strAt(args, 0)); null }
            "setBootstrap" -> { bridge.setBootstrap(bridge.channelNonce(), strAt(args, 0), strAt(args, 1)); null }
            "setDeviceToken" -> { bridge.setDeviceToken(bridge.channelNonce(), strAt(args, 0)); null }
            "showUrlOverlay" -> { bridge.showUrlOverlay(bridge.channelNonce(), strAt(args, 0)); null }
            "hideUrlOverlay" -> { bridge.hideUrlOverlay(); null }
            "openSettingsForManager" -> { bridge.openSettingsForManager(bridge.channelNonce()); null }
            "openSetupChecklist" -> { bridge.openSetupChecklist(); null }
            // 2026-09-02 (P0-2). No arguments to validate on the first two —
            // their whole content is "this happened, now". The third carries
            // a JSON verdict that degrades inside the handler (an
            // unparseable payload becomes an UNKNOWN-class failure, never a
            // throw and never a silent success).
            "bootProof" -> { bridge.bootProof(); null }
            "registerAttempt" -> { bridge.registerAttempt(); null }
            "registerResult" -> { bridge.registerResult(strAt(args, 0)); null }
            "deviceInfo" -> bridge.deviceInfo()
            "probeDisplay" -> bridge.probeDisplay()
            "displayCapabilities" -> bridge.displayCapabilities()
            "displayEnrollAdmin" -> bridge.displayEnrollAdmin()
            // Channel-only entry points — a message that reaches here has
            // already passed the exact-origin AND main-frame gates, which
            // is precisely what the `@JavascriptInterface` twins cannot
            // verify about their own caller.
            "displayApply" -> bridge.displayApplyViaSecureChannel(strAt(args, 0))
            "displaySetSchedule" -> bridge.displaySetScheduleViaSecureChannel(strAt(args, 0))
            // ⚠️ LIFE SAFETY. ONE argument, on purpose (2026-09-19): the face a
            // hold belongs to is decided by the native host that built this
            // bridge, never by the page. See DisplayEmergency.creditedFace.
            "displayEmergencyHold" -> bridge.displayEmergencyHoldViaSecureChannel(boolAt(args, 0))
            "checkForUpdates" -> bridge.checkForUpdates(bridge.channelNonce())
            "checkForUpdatesUserInitiated" -> bridge.checkForUpdatesUserInitiated(bridge.channelNonce())
            "getRecentLogs" -> bridge.getRecentLogs(bridge.channelNonce())
            "uploadDiagnostics" -> bridge.uploadDiagnostics(bridge.channelNonce())
            "ctsSerialEnabled" -> bridge.ctsSerialEnabled()
            "ctsSerialConnect" -> bridge.ctsSerialConnect(
                strAt(args, 0),
                intAt(args, 1, 9600),
                intAt(args, 2, 8),
                intAt(args, 3, 1),
                strAt(args, 4),
            )
            "ctsSerialDisconnect" -> bridge.ctsSerialDisconnect()
            "ctsSerialStatus" -> bridge.ctsSerialStatus()
            // Unreachable — onMessage already checked METHODS.
            else -> throw IllegalArgumentException("unknown method")
        }
    }

    private fun strAt(args: JSONArray, index: Int): String {
        val v = args.opt(index) ?: return ""
        if (v === JSONObject.NULL) return ""
        return v.toString()
    }

    private fun intAt(args: JSONArray, index: Int, fallback: Int): Int = try {
        args.optInt(index, fallback)
    } catch (t: Throwable) {
        fallback
    }

    /**
     * ⚠️ Defaults TRUE, and that direction is deliberate. Its only caller
     * is `displayEmergencyHold`, where the two outcomes are not
     * symmetric: a spurious hold keeps a screen lit (a power bill), a
     * missed hold lets an alert be blanked. So an argument we cannot
     * read is treated as "there IS an emergency". `optBoolean` also
     * accepts the strings "true"/"false", which is what a JS `true`
     * serialised through `JSONArray` can arrive as.
     */
    private fun boolAt(args: JSONArray, index: Int): Boolean = try {
        args.optBoolean(index, true)
    } catch (t: Throwable) {
        true
    }

    private fun replyOk(replyProxy: JavaScriptReplyProxy, id: String?, result: Any?) {
        if (id == null) return // fire-and-forget; the web side isn't waiting
        val o = JSONObject()
        try {
            o.put("id", id)
            o.put("ok", true)
            if (result != null) o.put("result", result)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not build reply: ${t.message}")
            return
        }
        post(replyProxy, o.toString())
    }

    private fun replyError(replyProxy: JavaScriptReplyProxy, id: String?, error: String) {
        if (id == null) return
        val o = JSONObject()
        try {
            o.put("id", id)
            o.put("ok", false)
            o.put("error", error)
        } catch (t: Throwable) {
            return
        }
        post(replyProxy, o.toString())
    }

    /** `JavaScriptReplyProxy` is WebView-owned — reply on the UI thread. */
    private fun post(replyProxy: JavaScriptReplyProxy, payload: String) {
        mainHandler.post {
            try {
                replyProxy.postMessage(payload)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "reply postMessage failed: ${t.message}")
            }
        }
    }

    private fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val rawHost = uri.host ?: return null
        val host = rawHost.lowercase()
        if (host.isEmpty()) return null
        val port = uri.port
        return if (port >= 0) "$scheme://$host:$port" else "$scheme://$host"
    }

    /** Log-safe: never echo a full URI from an untrusted frame. */
    private fun safeOrigin(uri: Uri): String = originOf(uri) ?: "(opaque)"
}
