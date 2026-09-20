package com.educms.player.face

import android.app.Activity
import android.graphics.Point
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import com.educms.player.BuildConfig
import com.educms.player.SafePlayerWebViewClient
import com.educms.player.WebAppBridge
import com.educms.player.display.DisplayControlApi
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.BridgeNonce
import com.educms.player.security.NativeBridgeChannel

/**
 * ONE FACE = ONE COMPLETE PLAYER (2026-09-16, double-sided displays).
 *
 * Contract §2/§3 of
 * `docs/research/2026-09-16-double-sided-build/01-NATIVE-PRESENTATION-CONTRACT.md`.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY THIS CLASS EXISTS, AND WHY IT DOES NOT TOUCH FACE 0
 * ═════════════════════════════════════════════════════════════════════
 * `MainActivity` keeps every per-WebView fact in an ACTIVITY field —
 * `lastSuccessfulLoadAtMs`, `watchdogConsecutiveFailures`,
 * `webHeartbeatEverReceived`, one `SafePlayerWebViewClient` (so one
 * `LoadOutcomeTracker` and one `abortedByUs`), one `BridgeNonce`, one
 * `ContentWatchdogPolicy`. A second WebView writing those SAME fields is the
 * sharpest reliability bug available here: face B's healthy heartbeat would
 * refresh `lastSuccessfulLoadAtMs` and certify a WEDGED face A as fresh, so
 * the 10-minute staleness watchdog could never rescue it. That is exactly the
 * "never equate signals" failure (player rule 5) the 1.1.6 program was built
 * to end.
 *
 * So a face owns a COMPLETE, PRIVATE copy of every one of those, and the
 * primary's code path is left byte-for-byte untouched. That is deliberately
 * NOT the full extraction (face 0 wrapped in a host too): extracting 4,232
 * lines of `MainActivity` blind, with no way to compile, would put the whole
 * fleet's reliability program at risk to serve one double-sided unit. The
 * isolation property this file needs — a face can never write a primary
 * field — is achieved by the face owning its own state, whichever side the
 * primary's copy lives on.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ WHAT A FACE DELIBERATELY DOES **NOT** DO
 * ═════════════════════════════════════════════════════════════════════
 *  • It never calls `setBootstrap`. `device_fingerprint` and `api_root` key
 *    the per-BOX `HeartbeatService`, `OtaUpdateWorker` and the diagnostics
 *    upload; a face repointing them would repoint the whole unit's telemetry
 *    at one pane. The refusal is structural — the lambda below rejects — and
 *    it is also why `MainActivity.FINGERPRINT_RE` does NOT need widening to
 *    admit the `::faceN` colon. (`FaceBridgeIsolationTest` asserts both.)
 *  • It never writes the primary's token slot. See [FaceTokenStore].
 *  • It never feeds `BootDiagnostics`. That object holds ONE
 *    `BootProgressTracker` and one card; a face's successful
 *    `registerResult` would set `satisfied = true` and dismiss the "player
 *    never started" card for a PRIMARY that never booted — healthy on
 *    evidence that proves nothing, which is the precise failure that
 *    subsystem exists to kill. A face's boot state is its own, reported
 *    through [FaceHostRegistry] and through its own `Screen` row.
 *  • It never arms lock task, never shows the URL overlay, and never
 *    registers `DisplayWindowBridge` hooks. Those are BOX concepts with one
 *    slot each; a second registrant silently evicts the first.
 *  • It never calls `setRequestedOrientation`. A `Presentation` is a Dialog
 *    on a display and HAS no requested orientation — see [FacePresentation].
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ WHAT IT DOES SHARE, ON PURPOSE: THE EMERGENCY HOLD
 * ═════════════════════════════════════════════════════════════════════
 * Contract §4 — an alert on EITHER face takes BOTH faces; life-safety beats
 * "different content". The face's `displayEmergencyHold` goes to the same
 * [DisplayControlApi] the primary's does, carrying ITS OWN face index, and
 * the native hold is a refcount over faces ([com.educms.player.display
 * .DisplayEmergency.setHold]). So either face raising protects the whole
 * unit, and neither face's routine all-clear can release the other's live
 * lockdown.
 *
 * ⚠️ UNVERIFIABLE WITHOUT THE DH43 IN HAND. Nothing below has run on the
 * rk3288 / Android 7.1.2 board. Specifically unproven: that a Chromium-83-era
 * WebView renders inside a `Presentation` on that ROM at all; that TWO
 * simultaneous WebViews fit in its RAM without the renderer being killed; and
 * — the one that would be worst — that the LEGACY `addJavascriptInterface`
 * path (which this board will take) attaches PER WEBVIEW with no cross-talk
 * between the two bridge objects. If it cross-talks, the two faces share a
 * control plane. See `apps/player/HARDWARE-QUALIFICATION.md`.
 */
class FacePlayerHost(
    private val activity: Activity,
    /** 1-based. Face 0 is the Activity's own WebView and is not hosted here. */
    val faceIndex: Int,
    /** The panel this face lives on. Its size, never the Activity's. */
    private val display: Display,
    /** BOX-level fact, shared on purpose — one ConnectivityManager registration. */
    private val isNetworkUp: () -> Boolean,
    /**
     * The page loaded but did not prove per-face storage isolation. The
     * controller unbinds this face and reports the shortfall; see
     * [FaceHostPlan.REASON_NOT_ISOLATED].
     */
    private val onIsolationFailed: (String) -> Unit = {},
) {

    private companion object {
        const val TAG = "FacePlayerHost"

        /**
         * Same ladder as the primary's staleness watchdog, and the same
         * numbers on purpose: a face is a screen and gets a screen's
         * recovery. Deliberately a PRIVATE copy — a shared counter is the
         * cross-certification bug this whole class exists to prevent.
         */
        const val WATCHDOG_TICK_MS = 2L * 60L * 1000L
        const val WATCHDOG_TIMEOUT_MS = 10L * 60L * 1000L

        /**
         * C-P0-2. A navigation in flight is not a stale one. Without this
         * the watchdog aborts and restarts a slow cold bundle every tick,
         * forever — the bug that reload-looped a whole fleet.
         */
        const val LOAD_GRACE_MS = 3L * 60L * 1000L
    }

    // ─── PER-FACE state. Every field here is a field MainActivity holds
    //     exactly one of. That is the point.

    private var webView: WebView? = null
    private var client: SafePlayerWebViewClient? = null
    private var bridge: WebAppBridge? = null
    private var nonce: BridgeNonce? = null

    private var lastSuccessfulLoadAtMs: Long = 0L
    private var lastLoadStartedAtMs: Long = 0L
    private var watchdogConsecutiveFailures: Int = 0
    private var webHeartbeatEverReceived: Boolean = false
    private var destroyed: Boolean = false

    /** This face's own view of the alert, so the refcount gets honest input. */
    private var holdReported: Boolean = false

    private val watchdogHandler = Handler(Looper.getMainLooper())
    private val watchdogTicker = object : Runnable {
        override fun run() {
            if (destroyed) return
            runCatching { tickWatchdog() }
                .onFailure { PlayerLogger.w(TAG, "face $faceIndex watchdog tick failed: ${it.message}") }
            watchdogHandler.postDelayed(this, WATCHDOG_TICK_MS)
        }
    }

    /** Raised by THIS face only. Never the primary's overlay. */
    private var recoveryOverlay: View? = null

    // ─── wiring ──────────────────────────────────────────────────────

    /**
     * Bind this host to an inflated [face_presentation] root and start it.
     *
     * Everything is wrapped: a throw inside a face must never propagate into
     * the Activity or reach the other face (contract §3).
     */
    fun configure(root: ViewGroup) {
        runCatching {
            val wv = root.findViewById<WebView>(com.educms.player.R.id.faceWebview)
            recoveryOverlay = root.findViewById(com.educms.player.R.id.faceRecoveryOverlay)
            webView = wv
            configureWebView(wv)
            watchdogHandler.removeCallbacks(watchdogTicker)
            watchdogHandler.postDelayed(watchdogTicker, WATCHDOG_TICK_MS)
        }.onFailure {
            PlayerLogger.e(TAG, "face $faceIndex configure FAILED — this face stays dark", it)
        }
    }

    // `databaseEnabled` is deprecated on modern API levels and still the
    // correct call on the Android 7.1 board this exists for. Suppressed at the
    // function, not the statement: a Kotlin annotation cannot sit on an
    // assignment inside an `apply` block.
    @Suppress("DEPRECATION")
    private fun configureWebView(wv: WebView) {
        // Deliberately the same settings the primary uses. A face is a
        // screen; it renders the same bundle and must not quietly differ.
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString EduCmsPlayer/${BuildConfig.VERSION_NAME} " +
                "(Android ${android.os.Build.VERSION.RELEASE})"
        }

        val faceNonce = BridgeNonce()
        nonce = faceNonce
        val faceBridge = buildBridge(faceNonce)
        bridge = faceBridge

        // ⚠️ PER-WEBVIEW ATTACH. `attach` and `attachLegacyCompatShim` both
        // take the WebView, and `WebAppBridge` is constructed per WebView, so
        // the two faces get separate control planes for free — PROVIDED the
        // OEM WebView honours that, which is a hardware fact this cannot
        // prove (see the class header).
        val channelActive = runCatching { NativeBridgeChannel.attach(wv, faceBridge) }.getOrDefault(false)
        val compatShim = channelActive &&
            runCatching { NativeBridgeChannel.attachLegacyCompatShim(wv) }.getOrDefault(false)
        if (!compatShim) {
            // PATH B — the every-frame object, for a WebView that can take
            // neither the channel nor a document-start script (the Chromium
            // 83/87 class this board belongs to). Its control-plane methods
            // are nonce-gated exactly as the primary's are; the lifeline set,
            // including the emergency hold, deliberately is not.
            runCatching { wv.addJavascriptInterface(faceBridge, "EduCmsNative") }
            runCatching {
                NativeBridgeChannel.injectBridgeNonceAtDocumentStart(wv, faceNonce.value()) {
                    faceNonce.arm()
                }
            }
        }
        PlayerLogger.i(
            TAG,
            "face $faceIndex bridge attached (channel=$channelActive, legacy=${!compatShim})",
        )

        val faceClient = SafePlayerWebViewClient(
            onRendererGone = {
                // A face's renderer dying must not touch the primary. The
                // face recovers itself, on its own cooldown.
                PlayerLogger.w(TAG, "face $faceIndex renderer crashed — reloading this face only")
                reload("renderer crashed")
            },
            onMainFrameError = { label ->
                PlayerLogger.w(TAG, "face $faceIndex main-frame error: $label")
                setRecoveryVisible(true)
            },
            onPageFinishedOk = {
                lastSuccessfulLoadAtMs = SystemClock.elapsedRealtime()
                watchdogConsecutiveFailures = 0
                setRecoveryVisible(false)
                verifyStorageIsolation()
                // ⚠️ NO lock task here. Lock task pins the ACTIVITY, which is
                // the primary's window; a face arming it would pin the front
                // on the strength of the back having painted.
            },
            onMainFrameDocument = { view, _ ->
                // Legacy transport only: re-deliver THIS face's nonce into
                // THIS face's top frame. The primary's nonce is a different
                // object and is never touched.
                val n = nonce ?: return@SafePlayerWebViewClient
                runCatching {
                    view.evaluateJavascript(
                        "window.__eduCmsBridgeNonce=${org.json.JSONObject.quote(n.value())};",
                    ) { n.arm() }
                }
            },
        )
        client = faceClient
        wv.webViewClient = faceClient
    }

    /**
     * ⚠️ THE NATIVE HALF OF "FAILS CLOSED" (2026-09-19).
     *
     * Both panes are WebViews on one origin in one process, so they share one
     * localStorage, and Android 7.1 gives a WebView no data directory of its
     * own. The isolation is an inline script in the web player
     * (faceStorageShim.ts) that must run before anything reads a key. This is
     * what stops the ORDERING being got wrong: a face whose page cannot prove
     * it is isolated — an old cached shell, a build that predates the script,
     * a platform that refused the redefinition — is blanked at once and
     * reported, instead of running as a second writer into the front's device
     * token and cached emergency. The first cut's "gate" was a comment.
     */
    private var isolationFailureReported = false

    private fun verifyStorageIsolation() {
        val wv = webView ?: return
        runCatching {
            wv.evaluateJavascript(FaceHostPlan.ISOLATION_PROBE_JS) { result ->
                if (destroyed || FaceHostPlan.isolationProven(result, faceIndex)) return@evaluateJavascript
                PlayerLogger.e(
                    TAG,
                    "face $faceIndex page did NOT prove storage isolation (marker=$result) — blanking it; " +
                        "hosting it would let the back overwrite the front's credential",
                )
                // Once. The about:blank below finishes "ok" too and lands back
                // in this probe; it has no marker either, and must not report twice.
                if (isolationFailureReported) return@evaluateJavascript
                isolationFailureReported = true
                runCatching {
                    // C-P1-3 — a caller-issued stop reports as a CLEAN finish, so
                    // it is marked first or it self-certifies as a good load.
                    client?.markNextFinishAborted()
                    wv.stopLoading()
                    wv.loadUrl("about:blank")
                }
                onIsolationFailed("marker=$result")
            }
        }.onFailure {
            PlayerLogger.e(TAG, "face $faceIndex isolation probe threw: ${it.message}")
            onIsolationFailed("probe-threw")
        }
    }

    /**
     * This face's bridge.
     *
     * Read the REFUSALS as carefully as the wiring: each one is a box-level
     * concern a face must not be able to drive.
     */
    private fun buildBridge(faceNonce: BridgeNonce): WebAppBridge = WebAppBridge(
        // A face may not unpair the BOX. Unpairing a single side is an
        // operator action from the dashboard against that side's Screen row.
        onUnpair = {
            PlayerLogger.w(TAG, "face $faceIndex called unpair() — refused; a face may not unpair the box")
        },
        onReload = { reload("bridge") },
        getDeviceInfo = { deviceInfoJson() },
        // OTA is a per-BOX worker. A face triggering it is harmless but
        // pointless; it is refused so there is exactly one requester.
        onCheckForUpdates = { _ ->
            PlayerLogger.i(TAG, "face $faceIndex update-check ignored — OTA is a per-box concern")
        },
        getRecentLogsImpl = { "(refused: logs are read from the primary pane)" },
        uploadDiagnosticsImpl = { "error: diagnostics upload runs on the primary pane" },
        onExitToDeviceHome = {
            PlayerLogger.w(TAG, "face $faceIndex called exitToDeviceHome() — refused")
        },
        // ⚠️ STRUCTURAL REFUSAL. See the class header: `device_fingerprint`
        // and `api_root` are per-BOX keys. This is also why FINGERPRINT_RE
        // never has to learn about the `::faceN` colon.
        onSetBootstrap = { _, _ ->
            PlayerLogger.w(
                TAG,
                "face $faceIndex called setBootstrap() — refused; api_root and device_fingerprint " +
                    "are per-box values and a face must not repoint the unit's telemetry",
            )
        },
        // ⚠️ ONE TOKEN STORE PER SIDE (player rule 3). This writes THIS
        // face's slot and is structurally unable to name the primary's.
        onSetDeviceToken = { token ->
            if (token.isBlank()) {
                FaceTokenStore.clearFace(activity.applicationContext, faceIndex)
            } else {
                FaceTokenStore.write(activity.applicationContext, faceIndex, token)
            }
        },
        // The URL overlay is a single view on the PRIMARY's window. Drawing a
        // face's overlay there would cover the other side's glass.
        onShowUrlOverlay = {
            PlayerLogger.w(TAG, "face $faceIndex showUrlOverlay() — refused; the overlay is face-0 only")
        },
        onHideUrlOverlay = { /* nothing of this face's is showing */ },
        onOpenSettingsForManager = {
            PlayerLogger.w(TAG, "face $faceIndex openSettingsForManager() — refused; a box ceremony")
        },
        onWebHeartbeat = {
            // ⚠️ THIS FACE'S counter, never the Activity's. A face refreshing
            // `MainActivity.lastSuccessfulLoadAtMs` would certify a wedged
            // primary as fresh — the bug this class exists to prevent.
            lastSuccessfulLoadAtMs = SystemClock.elapsedRealtime()
            if (!webHeartbeatEverReceived) {
                webHeartbeatEverReceived = true
                PlayerLogger.i(TAG, "face $faceIndex: JS proven live")
            }
        },
        // Recorded, not acted on: the syncOk-driven content watchdog stays a
        // face-0 concern in 1.1.18 (it is one shared ContentWatchdogPolicy
        // object). A face relies on its own staleness ladder below plus its
        // own render proof on its own Screen row.
        onWebHeartbeatV2 = { /* see above */ },
        // ⚠️ ORIENTATION IS WEB-SIDE ONLY ON A FACE. A Presentation is a
        // Dialog on a display and has no requestedOrientation at all, and the
        // primary's orientation must never be propagated onto a face
        // (contract §5 — the panels genuinely differ, 1080x1920 vs 1920x1080).
        onSetOrientation = { requested ->
            PlayerLogger.i(
                TAG,
                "face $faceIndex orientation '$requested' is applied by the page (CSS), not natively — " +
                    "a Presentation has no requestedOrientation",
            )
        },
        // ⚠️⚠️ LIFE SAFETY — THE ONE THING A FACE DRIVES BOX-WIDE.
        // Contract §4: an alert on either face takes both faces. This carries
        // THIS face's index into the refcount, which is what stops the other
        // pane's routine all-clear from releasing a live lockdown.
        displayEmergencyHoldImpl = { active, trusted ->
            // THIS host's index, supplied by native. The page has no way to
            // name a face at all — the bridge carries no face argument — so a
            // face's document cannot release a hold belonging to another pane
            // by mislabelling itself, and cannot invent one nothing can lift.
            holdReported = active
            DisplayControlApi.emergencyHoldJson(
                activity.applicationContext,
                active,
                trusted,
                faceIndex,
            )
        },
        bridgeNonce = faceNonce,
    )

    // ─── navigation ──────────────────────────────────────────────────

    /**
     * This face's URL.
     *
     * Two differences from the primary's, and nothing else:
     *   • `&face=N`, which is how the page derives its storage namespace
     *     (`apps/web/src/app/player/faceStorage.ts`);
     *   • `fp=<primary>::faceN`, the same string the server's
     *     `faceDeviceFingerprint()` derives. ⚠️ Knowing it grants NOTHING
     *     (DEVAUTH-01) — the face registers and earns its own credential
     *     exactly like any other screen.
     *
     * `w`/`h` come from THIS face's Display. Reading
     * `resources.displayMetrics` here would report the built-in 1080x1920
     * panel for a 1920x1080 HDMI face and render the whole board at the
     * wrong size.
     */
    fun buildUrl(token: String): String {
        val base = BuildConfig.PLAYER_BASE_URL.trimEnd('/')
        val density = activity.resources.displayMetrics.density
        val androidId = try {
            android.provider.Settings.Secure.getString(
                activity.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Throwable) {
            ""
        }
        val builder = Uri.parse(base).buildUpon()
            .appendQueryParameter("client", "android")
            .appendQueryParameter("v", BuildConfig.VERSION_NAME)
            .appendQueryParameter("vc", BuildConfig.VERSION_CODE.toString())
            // ⚠️ NO `w` / `h` ON A FACE (2026-09-19, verifier 08-G7). The primary
            // passes its panel size and the web pin script turns that into
            // `--led-w`, which the page reads as "an LED canvas is pinned — never
            // infer orientation from the window". That is right for the primary,
            // whose rotation is done natively by setRequestedOrientation. A face
            // lives in a Presentation, which HAS no requestedOrientation: the
            // page's CSS rotation fallback is the ONLY orientation path it has,
            // and `--led-w` switches that fallback off. Omitted, a PORTRAIT face
            // on a landscape panel rotates itself two seconds after load.
            // (It also means a stale, un-isolated shell has no canvas size to
            // write into the front's storage from this URL.)
            .appendQueryParameter("dpr", density.toString())
            .appendQueryParameter("face", faceIndex.toString())
        if (androidId.isNotBlank()) {
            builder.appendQueryParameter(
                "fp",
                FaceTokenStore.faceFingerprint("android-$androidId", faceIndex),
            )
        }
        if (token.isNotBlank()) builder.appendQueryParameter("token", token)
        return builder.build().toString()
    }

    /**
     * This face's panel size in physical pixels. Never the Activity's.
     *
     * `getRealSize` is deprecated on API 30+ and is the only call that works
     * on the Android 7.1 board this exists for; `WindowMetrics` has no
     * per-Display form that reaches back that far.
     */
    @Suppress("DEPRECATION")
    private fun realSize(): Pair<Int, Int> = try {
        val p = Point()
        display.getRealSize(p)
        if (p.x > 0 && p.y > 0) Pair(p.x, p.y) else Pair(0, 0)
    } catch (_: Throwable) {
        Pair(0, 0)
    }

    /** Navigate this face. Safe to call from any thread. */
    fun load(reason: String) {
        if (destroyed) return
        activity.runOnUiThread {
            val wv = webView ?: return@runOnUiThread
            runCatching {
                lastLoadStartedAtMs = SystemClock.elapsedRealtime()
                val token = FaceTokenStore.resolve(activity.applicationContext, faceIndex)
                val url = buildUrl(token)
                PlayerLogger.i(TAG, "face $faceIndex loading ($reason)")
                wv.setInitialScale(100)
                wv.loadUrl(url)
            }.onFailure { PlayerLogger.e(TAG, "face $faceIndex load failed", it) }
        }
    }

    /**
     * Abort + reload THIS face.
     *
     * ⚠️ `markNextFinishAborted()` BEFORE `stopLoading()` is not optional
     * (C-P1-3): Chromium reports a caller-issued stop as a CLEAN
     * `onPageFinished`, so without it every watchdog abort self-certifies as
     * a successful load and zeroes the strike counter it just incremented.
     */
    fun reload(reason: String) {
        if (destroyed) return
        activity.runOnUiThread {
            val wv = webView ?: return@runOnUiThread
            runCatching {
                client?.markNextFinishAborted()
                wv.stopLoading()
            }
            load(reason)
        }
    }

    // ─── this face's staleness ladder ────────────────────────────────

    private fun tickWatchdog() {
        val now = SystemClock.elapsedRealtime()
        val ageMs = if (lastSuccessfulLoadAtMs == 0L) Long.MAX_VALUE else now - lastSuccessfulLoadAtMs
        val stale = ageMs > WATCHDOG_TIMEOUT_MS
        if (!stale) {
            watchdogConsecutiveFailures = 0
            return
        }
        // C-P0-2 — a navigation still inside its grace window neither strikes
        // nor resets. Without this a slow cold bundle is aborted every tick.
        val loadInFlight = lastLoadStartedAtMs != 0L && (now - lastLoadStartedAtMs) < LOAD_GRACE_MS
        if (loadInFlight) return

        // ⚠️ A face is never force-reloaded during an alert. Reloading a pane
        // that is currently showing a lockdown takes the alert off the glass
        // for the length of a cold boot. The primary's watchdog defers for
        // the same reason.
        if (com.educms.player.display.DisplayEmergency.isHeld(activity.applicationContext)) {
            PlayerLogger.i(TAG, "face $faceIndex is stale but an emergency hold is active — not reloading")
            return
        }
        if (!isNetworkUp()) return

        watchdogConsecutiveFailures += 1
        PlayerLogger.w(
            TAG,
            "face $faceIndex has no successful load for ${ageMs / 1000}s " +
                "(strike $watchdogConsecutiveFailures) — reloading",
        )
        reload("staleness watchdog")
    }

    private fun setRecoveryVisible(visible: Boolean) {
        activity.runOnUiThread {
            runCatching { recoveryOverlay?.visibility = if (visible) View.VISIBLE else View.GONE }
        }
    }

    private fun deviceInfoJson(): String {
        val (w, h) = realSize()
        return """{"face":$faceIndex,"displayId":${display.displayId},"width":$w,"height":$h,""" +
            """"appVersion":"${BuildConfig.VERSION_NAME}"}"""
    }

    // ─── lifecycle ───────────────────────────────────────────────────

    fun onResume() {
        runCatching {
            webView?.onResume()
            webView?.resumeTimers()
        }
    }

    fun onPause() {
        runCatching { webView?.onPause() }
    }

    /**
     * Tear this face down.
     *
     * ⚠️ IT DOES NOT TOUCH THE EMERGENCY HOLD (2026-09-19, verifier finding 8).
     * The first cut stood this face's hold down here so a vanished display
     * could not strand its index in the holding set. But a release from the
     * LAST holder runs the full release path — brightness restored, schedule
     * re-armed — and a face torn down mid-alert (HDMI pulled during a
     * lockdown) can easily BE the last holder, while the alert is still live
     * on the other pane and its page simply has not re-raised yet.
     *
     * Both problems are solved one level up: after a detach the controller
     * calls `DisplayEmergency.setLiveFaces`, which TRANSFERS a departed face's
     * membership to the primary. The box stays held (the fail-safe direction)
     * and the member is one the primary's own all-clear can lift — nothing is
     * stranded, and nothing is released by a cable coming out.
     */
    fun destroy() {
        if (destroyed) return
        destroyed = true
        watchdogHandler.removeCallbacks(watchdogTicker)
        holdReported = false
        val wv = webView
        webView = null
        runCatching {
            wv?.let {
                NativeBridgeChannel.detach(it)
                it.stopLoading()
                (it.parent as? ViewGroup)?.removeView(it)
                it.destroy()
            }
        }.onFailure { PlayerLogger.w(TAG, "face $faceIndex destroy failed: ${it.message}") }
    }
}
