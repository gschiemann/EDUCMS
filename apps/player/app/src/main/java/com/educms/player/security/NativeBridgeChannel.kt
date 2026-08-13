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
 * https rule. That is the intended outcome: **those boards get no native
 * bridge at all**, by either gate.
 *
 * ============================================================
 * ⚠️ THIS RELEASE EXPOSES *BOTH* SURFACES — ON PURPOSE
 * ============================================================
 *
 * The APK and the web bundle deploy INDEPENDENTLY (GitHub Releases +
 * OTA vs. Vercel). A kiosk can take the APK update days before the web
 * deploy, or the reverse. If the legacy `EduCmsNative` names were
 * removed in the same release the web side migrated, whichever half
 * updated first would talk to a bridge that isn't there — on a hallway
 * display whose only job is to show a lockdown alert.
 *
 * So `MainActivity.configureWebView` still calls
 * `addJavascriptInterface(...)` AND attaches this channel, and the web
 * side (`apps/web/src/app/player/nativeBridge.ts`) prefers this channel
 * with an automatic fallback to the legacy object.
 *
 * **REMOVAL CRITERIA for the legacy `addJavascriptInterface` surface**
 * (all four, verified before the commit that deletes it):
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
        "setOrientation",
        "setBootstrap",
        "showUrlOverlay",
        "hideUrlOverlay",
        "openSettingsForManager",
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
        "checkForUpdates",
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

        worker.execute {
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
            "exitToDeviceHome" -> { bridge.exitToDeviceHome(); null }
            "unpair" -> { bridge.unpair(); null }
            "reload" -> { bridge.reload(); null }
            "heartbeat" -> { bridge.heartbeat(); null }
            "setOrientation" -> { bridge.setOrientation(strAt(args, 0)); null }
            "setBootstrap" -> { bridge.setBootstrap(strAt(args, 0), strAt(args, 1)); null }
            "showUrlOverlay" -> { bridge.showUrlOverlay(strAt(args, 0)); null }
            "hideUrlOverlay" -> { bridge.hideUrlOverlay(); null }
            "openSettingsForManager" -> { bridge.openSettingsForManager(); null }
            "deviceInfo" -> bridge.deviceInfo()
            "probeDisplay" -> bridge.probeDisplay()
            "displayCapabilities" -> bridge.displayCapabilities()
            // Channel-only entry points — a message that reaches here has
            // already passed the exact-origin AND main-frame gates, which
            // is precisely what the `@JavascriptInterface` twins cannot
            // verify about their own caller.
            "displayApply" -> bridge.displayApplyViaSecureChannel(strAt(args, 0))
            "displaySetSchedule" -> bridge.displaySetScheduleViaSecureChannel(strAt(args, 0))
            "displayEmergencyHold" -> bridge.displayEmergencyHoldViaSecureChannel(boolAt(args, 0))
            "checkForUpdates" -> bridge.checkForUpdates()
            "getRecentLogs" -> bridge.getRecentLogs()
            "uploadDiagnostics" -> bridge.uploadDiagnostics()
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
