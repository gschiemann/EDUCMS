package com.educms.player

import android.webkit.JavascriptInterface
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.BridgeNonce
import com.educms.player.security.HostAllowlist

/**
 * What `getRecentLogs` hands back when the nonce gate refuses. Plain text
 * rather than the JSON refusal, because the diagnostics overlay renders
 * this value straight into a `<pre>` block.
 */
private const val REFUSED_LOGS = "(refused: bridge-nonce — this frame may not read device logs)"

/**
 * Minimal JS ↔ native bridge surface exposed to the web player as
 * `window.EduCmsNative`. Keep this surface tiny — every method becomes
 * an attack surface if the player loads untrusted content.
 *
 * ⚠️ TRUST BOUNDARY — READ BEFORE ADDING A METHOD (AND-002, 2026-08-01;
 * SEC-002, 2026-09-04).
 * When this object is attached with `WebView.addJavascriptInterface` it is
 * exposed to **every frame the WebView loads**, not just the top-level
 * EduCMS player document: no method here can see its caller's origin, so
 * operator-authored and third-party HTML mounted in the player's iframes
 * reaches every method below. Treat EVERY argument as attacker-controlled
 * and validate it natively; comments elsewhere in this repo that claim the
 * bridge is "only exposed to our trusted player web origin" are WRONG.
 *
 * SEC-002 (2026-09-04) changed WHERE that object exists rather than what it
 * can do:
 *
 *   • On any WebView that supports both `WEB_MESSAGE_LISTENER` and
 *     `DOCUMENT_START_SCRIPT`, `MainActivity.configureWebView` NO LONGER
 *     calls `addJavascriptInterface` at all. `window.EduCmsNative` is
 *     instead defined by an ORIGIN-SCOPED document-start shim that forwards
 *     to the origin + main-frame-gated channel
 *     ([com.educms.player.security.NativeBridgeChannel]). Untrusted frames
 *     — opaque-origin boards, proxied WEBPAGE content, foreign streaming
 *     hosts — get no such object and no native surface at all. That is a
 *     real boundary, enforced by the WebView.
 *   • On a WebView that supports neither (Chromium 83/87 NovaStar Taurus
 *     posters), the legacy object is still injected, because it is the ONLY
 *     transport those panels have. There, every control-plane method below
 *     requires the per-boot [BridgeNonce] as its first argument — see that
 *     class for what a nonce does and does not buy. Since the 2026-09-04
 *     re-audit that requirement is **DEFAULT-DENY**: an absent or wrong
 *     nonce is refused in every state, including before delivery has armed
 *     the gate. The lifeline set (reload / heartbeat* / bootProof /
 *     register* / hideUrlOverlay / display*) is deliberately outside the
 *     gate, so a device that can never arm keeps playing content and keeps
 *     taking an emergency hold — see [BridgeNonce.GATED_METHODS] for the
 *     full three-class split.
 *
 * Diagnostics methods added 2026-04-23:
 *   getRecentLogs()     — returns the tail of the on-device log file so
 *                         the web overlay can display it without USB access.
 *   uploadDiagnostics() — triggers a log upload to the API and returns a
 *                         status string the overlay can show the operator.
 */
class WebAppBridge(
    private val onUnpair: () -> Unit,
    private val onReload: () -> Unit,
    private val getDeviceInfo: () -> String,
    /**
     * `(userInitiated)`. TRUE only when a HUMAN pressed Update on this
     * screen's own glass — see [checkForUpdatesUserInitiated]. Every other
     * caller (the dashboard's WS push, the manifest poll's
     * forceUpdatePending relay) passes false and stays on the gated route.
     */
    private val onCheckForUpdates: (userInitiated: Boolean) -> Unit,
    private val getRecentLogsImpl: () -> String,
    private val uploadDiagnosticsImpl: () -> String,
    private val onExitToDeviceHome: () -> Unit,
    private val onSetBootstrap: (apiRoot: String, fingerprint: String) -> Unit,
    /**
     * 2026-08-25 (v1.1.5) — hands the native side this screen's DEVICE JWT.
     *
     * The sibling of [onSetBootstrap], and it exists for the same reason:
     * `OtaUpdateWorker` runs in a WorkManager process with no WebView and no
     * access to the page's localStorage, so anything it needs to speak to
     * the API with has to be pushed to prefs by the page first. Without a
     * token the worker's `/player/update-check` is anonymous, which silently
     * disables BOTH the panel-button update bypass and the pending-push
     * clear-on-install (see OtaUpdateWorker.deviceToken).
     *
     * ⚠️ WRITE-ONLY, AND DELIBERATELY REACHABLE FROM THE LEGACY SURFACE.
     * There is no getter — no JS can ever read the stored token back out —
     * and the value is syntax-validated natively before it is persisted.
     * A hostile board iframe writing junk here fails CLOSED: the server
     * rejects the header and the panel stays on the gated path it is on
     * today. Writing a VALID token belonging to a DIFFERENT screen also
     * fails closed, because the server resolves the screen from the
     * fingerprint in the body and `verifyDeviceForScreen` demands the
     * token's `sub` match it. It stays on the legacy surface because the
     * Chromium-83/87 NovaStar Taurus boxes in the field cannot attach the
     * origin-scoped channel at all, and they are exactly the panels that
     * need this.
     */
    private val onSetDeviceToken: (token: String) -> Unit = {},
    private val onShowUrlOverlay: (url: String) -> Unit,
    private val onHideUrlOverlay: () -> Unit,
    private val onOpenSettingsForManager: () -> Unit,
    /**
     * v1.0.58 — web-side liveness heartbeat. Called every 60 s from
     * the player page while the JS event loop is healthy. The watchdog
     * in MainActivity uses this to know "the page is alive even though
     * onPageFinishedOk hasn't fired since boot." Without this, the
     * 10-min freshness watchdog force-reloads every healthy player
     * every 10 min — visible to operators as "the screen disconnected
     * and started playing from the beginning". See MainActivity.
     */
    private val onWebHeartbeat: () -> Unit = {},
    /**
     * 2026-08-30 (W2-4) — the CONTENT-aware half of the heartbeat.
     *
     * [onWebHeartbeat] proves only that the page's JS event loop is
     * running. A player stuck unauthenticated — sync failing, nothing on
     * the glass — keeps that promise forever, which is why the 10-minute
     * staleness watchdog never rescued it. `syncOk` is the missing bit.
     *
     * NULL means "the web bundle didn't tell us" (field absent, or the
     * payload didn't parse). It is deliberately NOT coerced to false:
     * unknown must not be able to force-reload a fleet, and it must not
     * count as healthy either. See ContentWatchdogPolicy.
     */
    private val onWebHeartbeatV2: (syncOk: Boolean?) -> Unit = {},
    /**
     * 2026-09-02 (efficiency program P0-1) — "the page's own once-a-minute
     * telemetry POST reached the server recently."
     *
     * WHY IT EXISTS. The web bundle and this process were BOTH writing
     * `Screen.lastPingAt` on their own timers — the page every 30-45 s, the
     * native [HeartbeatService] every 30 s — which is 2,880 duplicate
     * requests per screen per day for one column. When the page says its
     * unified telemetry is landing, the service drops to a 5-minute
     * liveness floor instead of racing it.
     *
     * ⚠️ IT IS A HINT, NOT A LIVENESS CLAIM (player rule 5: never equate
     * signals). It says the WEB reported; it says nothing about whether the
     * Android process is healthy. That is why the service SLOWS DOWN rather
     * than standing down: if the page dies, is killed, or its WebView is
     * torn out from under it, the native floor is still proving the process
     * is alive and the fleet still sees the screen. Two facts, two
     * reporters, neither substituting for the other.
     *
     * NULL/absent is "the page didn't say" and is recorded as false — the
     * conservative direction, since it only ever means "keep the native
     * heartbeat at its normal cadence", which is today's behaviour.
     */
    private val onWebTelemetryReported: (telemetryOk: Boolean) -> Unit = {},
    /**
     * 2026-05-24 — per-screen orientation lock. The /player route calls
     * `bridge.setOrientation('LANDSCAPE' | 'PORTRAIT' | 'AUTO')` when
     * it sees a new value in the manifest or in a signed WS
     * ORIENTATION_CHANGE message. Native side maps to
     * setRequestedOrientation; defaults to a no-op if the lambda isn't
     * wired (e.g. for ad-hoc WebView previews).
     */
    private val onSetOrientation: (String) -> Unit = {},
    /**
     * 2026-08-25 (v1.1.6) — raises the first-boot setup checklist on THIS
     * panel. Driven by the operator's dashboard: `POST /screens/:id/
     * display-control` with `action: 'OPEN_SETUP'` → signed WS frame →
     * `dispatchDisplayControl` → here.
     *
     * ⚠️ WHY IT IS NOT ROUTED THROUGH `displayApply`. The APK's display
     * vocabulary is exactly five verbs and `DisplayControlApi` is the
     * hardware-mutation surface with its own trust split; this touches no
     * hardware and must not inherit that surface's semantics. A dedicated
     * fire-and-forget method keeps the two apart.
     *
     * ⚠️ IT IS ALSO NOT TRUST-GATED HERE, on purpose. The legacy
     * every-frame surface reaches operator-authored board HTML, so the
     * honest question is "what is the worst a hostile board achieves?" —
     * and the answer is a setup card the operator can dismiss with Back.
     * It opens no permission, grants nothing, and `SetupCeremony.render`
     * still refuses to put it over an emergency hold or inside a locked
     * task. Compare `displayEnrollAdmin`, which IS gated, because it ends
     * in a system dialog that blocks the screen until a human dismisses
     * it.
     */
    private val onOpenSetupChecklist: () -> Unit = {},
    /**
     * 2026-09-02 (P0-2) — FACT 1: the web bundle's client JS is running.
     *
     * Fired from the same mount effect that stamps `data-edu-booted="1"`.
     * Defaulted to a no-op so an ad-hoc WebView preview (and every unit
     * test that builds a bridge) keeps working unwired.
     */
    private val onBootProof: () -> Unit = {},
    /** 2026-09-02 (P0-2) — FACT 2: a registration request has been sent. */
    private val onRegisterAttempt: () -> Unit = {},
    /**
     * 2026-09-02 (P0-2) — FACT 3: how that registration ended.
     * `(ok, failureClass, httpStatus, message)`. `failureClass` is null on
     * success and one of dns/tls/http/timeout/network/storage/unknown
     * otherwise; see [com.educms.player.boot.RegisterFailureClass].
     */
    private val onRegisterResult: (
        ok: Boolean,
        failureClass: String?,
        httpStatus: Int?,
        message: String?,
    ) -> Unit = { _, _, _, _ -> },
    /**
     * Sprint 13 Phase 2 — native RS232 reader for Goodview ECBox3576
     * deployments (and any Android box with a /dev/ttyS* exposed by a
     * hardware UART). Replaces the Beelink mini PC + USB-RS232 dongle
     * path. The web layer (apps/web/src/components/player/CtsBridge.tsx)
     * detects this surface via `ctsSerialEnabled()`, then drives
     * connect/disconnect/status through these methods. Bytes flow back
     * to JS via `window.__ctsSerialBytes(base64)` which the same
     * CtsParser in @cms/scoreboard-cts consumes — single web codebase,
     * two hardware paths. See com.educms.player.serial.SerialPortBridge.
     */
    private val ctsSerial: com.educms.player.serial.SerialPortBridge? = null,
    /**
     * READ-ONLY display/power/audio capability probe. Backs
     * `DisplayCapabilityProbe.probeJson()`. See `probeDisplay()` below
     * for the trust-boundary reasoning on exposing it here.
     */
    private val probeDisplayImpl: () -> String = { "{}" },
    /**
     * 2026-08-13 — the WRITE half: volume / brightness / blank / wake /
     * reboot + the on-device on-off schedule. See the block comment on
     * `displayCapabilities()` below, and `com.educms.player.display`
     * for the provider stack and its safety rules.
     */
    private val displayCapabilitiesImpl: () -> String = { """{"ok":false,"code":"unavailable"}""" },
    /**
     * `(actionJson, trusted)`. `trusted` is true ONLY for the channel
     * entry point, which has verified the exact origin and the main
     * frame; the legacy every-frame surface always passes false and gets
     * the recovery-direction subset. See `displayApply()`.
     */
    private val displayApplyImpl: (String, Boolean) -> String = { _, _ -> """{"ok":false,"code":"unavailable"}""" },
    private val displaySetScheduleImpl: (String, Boolean) -> String = { _, _ -> """{"ok":false,"code":"unavailable"}""" },
    /** `(active, trusted)` — the ⚠️ life-safety emergency interlock. */
    private val displayEmergencyHoldImpl: (Boolean, Boolean) -> String =
        { _, _ -> """{"ok":false,"code":"unavailable"}""" },
    /**
     * 2026-08-14 — raises the one-time device-ADMIN enrolment dialog.
     * Backed by `MainActivity.requestDeviceAdminEnrollment`, which owns
     * BOTH gates (foreground Activity + recent physical presence). See
     * `displayEnrollAdmin()` below.
     */
    private val displayEnrollAdminImpl: () -> String = { """{"ok":false,"code":"unavailable"}""" },
    /**
     * True when the origin-scoped [com.educms.player.security.NativeBridgeChannel]
     * is live on this WebView. DIAGNOSTIC ONLY since 2026-08-13 — it is
     * no longer a gate, see `displayApply()`.
     */
    private val secureChannelActive: () -> Boolean = { false },
    /**
     * SEC-002 — the per-boot main-frame secret, present ONLY when this
     * bridge is exposed through `addJavascriptInterface` (the every-frame
     * transport). NULL means the legacy object was never injected on this
     * device, so there is nothing to gate: the only way in is the
     * origin + main-frame-checked channel. See [BridgeNonce].
     */
    private val bridgeNonce: BridgeNonce? = null,
) {
    /**
     * The one decision point for every gated `@JavascriptInterface` method.
     *
     * Returns true — allow — when there is no nonce at all (an ad-hoc
     * preview / a test harness that constructed the bridge without one), and
     * otherwise defers to [BridgeNonce.allow], which since the 2026-09-04
     * SEC-002 re-audit is DEFAULT-DENY: it accepts only a caller presenting
     * the current value, armed or not.
     *
     * ⚠️ `bridgeNonce == null` is NOT a fleet state. `MainActivity` passes a
     * nonce on every path, including PATH A, where nothing but
     * [com.educms.player.security.NativeBridgeChannel] can call these methods
     * and it presents [channelNonce] after clearing the strictly stronger
     * origin + main-frame gates.
     */
    private fun gate(method: String, nonce: String?): Boolean =
        bridgeNonce?.allow(method, nonce) ?: true

    /**
     * The nonce, for the ONE caller that has already proven strictly more
     * than the nonce ever could.
     *
     * [com.educms.player.security.NativeBridgeChannel] verifies the exact
     * origin AND `isMainFrame` before it dispatches, so a channel message
     * has cleared a higher bar than "knows a global the main frame holds".
     * It therefore calls the nonce-bearing overloads with this value.
     *
     * Deliberately NOT annotated `@JavascriptInterface`: it is invisible to
     * `window.EduCmsNative` and unreachable from any frame. Handing the
     * nonce out over the bridge is the one shortcut that would make the
     * whole mechanism worthless, since every frame holds the object.
     */
    internal fun channelNonce(): String = bridgeNonce?.value() ?: ""

    /**
     * Escape hatch — exits our kiosk task stack and returns the user to
     * the OEM launcher (Goodview/NovaStar/TCL). Critical for signage
     * boxes where our app is a guest on top of a vendor CMS that
     * controls device + network settings.
     *
     * ⚠️ NONCE-GATED (SEC-002). A hostile frame calling this drops the
     * kiosk out of the player — an availability failure on a display whose
     * other job is showing a lockdown alert.
     */
    @JavascriptInterface
    fun exitToDeviceHome() {
        if (!gate("exitToDeviceHome", null)) return
        onExitToDeviceHome()
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun exitToDeviceHome(nonce: String) {
        if (!gate("exitToDeviceHome", nonce)) return
        onExitToDeviceHome()
    }

    /**
     * ⚠️ NONCE-GATED (SEC-002) — removes the screen from the CMS, which
     * takes it off the emergency channel.
     */
    @JavascriptInterface
    fun unpair() {
        if (!gate("unpair", null)) return
        onUnpair()
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun unpair(nonce: String) {
        if (!gate("unpair", nonce)) return
        onUnpair()
    }

    /**
     * ⚠️ DELIBERATELY NOT NONCE-GATED. A REFRESH_WEB recovery command rides
     * this method (CLAUDE.md player rule 6), and the web side's `nativeFire`
     * reports a native refusal as a successful delivery — so a gated
     * `reload` would silently kill that recovery path on every web bundle
     * that predates the nonce, on exactly the pre-channel panels that have
     * no other transport. A hostile frame calling it re-loads the assigned
     * content; it changes no state and reads nothing.
     */
    @JavascriptInterface
    fun reload() = onReload()

    /**
     * v1.0.58 — Web-side liveness heartbeat. The player page calls
     * this every ~60 s while it's running. Native side records the
     * timestamp; the watchdog ticker treats a fresh heartbeat exactly
     * like a fresh onPageFinishedOk for staleness math. No logging
     * here (would flood the log file at 1/min) — MainActivity logs
     * the first heartbeat each session for diagnostic confidence.
     */
    @JavascriptInterface
    fun heartbeat() = onWebHeartbeat()

    /**
     * 2026-08-30 (W2-4) — heartbeat WITH state. Strict superset of
     * [heartbeat]: it always ticks process liveness exactly like the
     * original, and additionally reports whether the player believes its
     * manifest sync is healthy.
     *
     * `stateJson` is expected to be `{"syncOk": true|false, …}`. Unknown
     * keys are ignored so the web side can grow the payload without an
     * APK release.
     *
     * PARSING IS FAIL-SOFT BY DESIGN. This arrives from the page on a
     * 60-second timer; a malformed payload must never cost the screen its
     * liveness tick (that would INVENT the stuck-watchdog bug this feature
     * exists to fix). So the liveness half runs first, unconditionally,
     * and anything unparseable degrades to `syncOk = null` — see
     * [onWebHeartbeatV2]. Only a real JSON boolean counts; a string
     * `"false"` or a `0` is treated as unknown rather than silently
     * coerced.
     *
     * [heartbeat] is untouched and stays the path older web bundles use.
     *
     * Registered on BOTH surfaces: this legacy `@JavascriptInterface`
     * (the only surface Chromium-83/87 Taurus panels have) AND
     * `NativeBridgeChannel.METHODS` + its dispatch arm — landed together
     * with the web half's `NATIVE_VOID_METHODS` entry, as the three-file
     * atomic contract requires (the web drift guard asserts sorted
     * equality against the Kotlin array).
     */
    @JavascriptInterface
    fun heartbeatV2(stateJson: String) {
        // Liveness FIRST — never gated on parsing.
        onWebHeartbeat()
        var syncOk: Boolean? = null
        var telemetryOk = false
        try {
            val json = org.json.JSONObject(stateJson)
            syncOk = json.opt("syncOk") as? Boolean
            // 2026-09-02 — an ADDITIVE key on an existing method, which is
            // why this whole wave needs no new bridge method and therefore
            // no three-file atomic contract, no KNOWN_METHODS exclusion and
            // no fleet-floor gate. The doc above has always promised that
            // unknown keys are ignored, so a 1.1.7-1.1.16 APK simply does
            // not read it and keeps its current heartbeat cadence — correct
            // behaviour on an old APK, not a degradation.
            telemetryOk = json.opt("telemetryOk") as? Boolean ?: false
        } catch (_: Throwable) {
            // Fail-soft, as documented: a malformed payload costs the screen
            // nothing. `syncOk` stays unknown (neither refreshes nor
            // disarms the content watchdog) and `telemetryOk` stays false,
            // which just means the native heartbeat keeps its full cadence.
        }
        onWebHeartbeatV2(syncOk)
        onWebTelemetryReported(telemetryOk)
    }

    /**
     * 2026-05-24 — orientation lock. Called by the web player whenever
     * it observes a new orientation value (either via manifest.orientation
     * on the next poll, or via a signed ORIENTATION_CHANGE WS message).
     * Input is validated native-side; unknown values are logged and
     * ignored.
     *
     * ⚠️ NONCE-GATED (SEC-002) — a hostile frame calling this rotates a
     * bolted-to-the-wall panel 90°, which no remote command can undo from
     * the operator's side once the content is unreadable.
     */
    @JavascriptInterface
    fun setOrientation(value: String) {
        if (!gate("setOrientation", null)) return
        onSetOrientation(value)
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun setOrientation(nonce: String, value: String) {
        if (!gate("setOrientation", nonce)) return
        onSetOrientation(value)
    }

    /**
     * 2026-08-25 (v1.1.6) — raise the setup checklist on this panel.
     *
     * The dashboard half of the operator's *"i … have no way to know how to
     * pull those up again"*. Fire-and-forget: the Activity decides whether
     * the checklist may appear (emergency hold, lock task, the
     * manager-install gate) and logs its own refusal — a return value here
     * would be a promise this layer cannot keep.
     */
    @JavascriptInterface
    fun openSetupChecklist() {
        try {
            onOpenSetupChecklist()
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "openSetupChecklist failed: ${ex.message}")
        }
    }

    // ─── BOOT + REGISTRATION PROOF (2026-09-02, P0-2, v1.1.13) ──────────
    //
    // THE THREE FACTS, AND WHY THEY ARE THREE. Player rule 5 — never equate
    // signals. The APK's evidence that a screen was healthy used to be an
    // HTTP 200 plus `onPageFinished`, and BOTH are true of a
    // server-rendered shell whose client bundle never executed: the
    // Android-9 Goodview panels showed "Connecting to your CMS…" — real
    // server-rendered text — for days while the APK saw nothing wrong.
    //
    // `bootProof` says the page's own JS ran. It does NOT say a
    // registration was attempted (a bundle can boot and never reach the
    // register effect). `registerAttempt` says a request left. It does NOT
    // say anything came back (a proxy that answers headers and stalls the
    // body produces an attempt and no result for as long as it hangs). Only
    // `registerResult` closes the loop, and it carries a CLASS so the
    // diagnostic screen can say what the evidence supports instead of
    // "something went wrong".
    //
    // All three are fire-and-forget and are registered on BOTH surfaces
    // (this legacy `@JavascriptInterface` — the only one Chromium-83/87
    // Taurus panels have — and `NativeBridgeChannel.METHODS` + dispatch).

    /** FACT 1 — the web bundle's client JS is running. */
    @JavascriptInterface
    fun bootProof() {
        try {
            onBootProof()
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "bootProof failed: ${ex.message}")
        }
    }

    /** FACT 2 — a `POST /screens/register` has just been issued. */
    @JavascriptInterface
    fun registerAttempt() {
        try {
            onRegisterAttempt()
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "registerAttempt failed: ${ex.message}")
        }
    }

    /**
     * FACT 3 — the registration verdict, as
     * `{"ok":true}` or `{"ok":false,"class":"dns","status":429,"message":"…"}`.
     *
     * FAIL-SOFT, AND IN THE PESSIMISTIC DIRECTION. An unparseable payload
     * is reported as a FAILURE of class `unknown`, never as a success:
     * the only thing that may satisfy the boot watchdog is a verdict we
     * actually read and that actually said ok. Treating garbage as success
     * would re-create the exact bug this file exists to close — a native
     * side that believes a screen is healthy on evidence that proves
     * nothing.
     */
    @JavascriptInterface
    fun registerResult(resultJson: String) {
        var ok = false
        var failureClass: String? = "unknown"
        var status: Int? = null
        var message: String? = null
        try {
            val obj = org.json.JSONObject(resultJson)
            ok = obj.opt("ok") as? Boolean ?: false
            if (ok) {
                failureClass = null
            } else {
                failureClass = obj.optString("class", "").trim().ifEmpty { "unknown" }
                status = if (obj.has("status")) obj.optInt("status", 0).takeIf { it > 0 } else null
                message = obj.optString("message", "").trim().take(300).ifEmpty { null }
            }
        } catch (ex: Throwable) {
            PlayerLogger.w("WebAppBridge", "registerResult payload unreadable: ${ex.message}")
        }
        try {
            onRegisterResult(ok, failureClass, status, message)
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "registerResult failed: ${ex.message}")
        }
    }

    /** Returns device info as JSON: manufacturer, model, sdk, width, height, appVersion. */
    @JavascriptInterface
    fun deviceInfo(): String = getDeviceInfo()

    /**
     * Returns this device's display/power/audio control surface as JSON —
     * what we could drive (backlight nodes, Settings keys, device-owner
     * state, serial ports, vendor packages) if we built a control layer.
     * See `DisplayCapabilityProbe` for the full field list and its
     * read-only safety contract.
     *
     * PULL-ONLY, BY DESIGN. This must not be folded into `deviceInfo()`
     * or the heartbeat payload: those feed Screen telemetry, and a new
     * high-frequency Screen field invalidates the manifest hot-cache
     * fleet-wide (CLAUDE.md → manifest content cache, rule 7). The
     * dashboard calls this on demand, per screen.
     *
     * TRUST BOUNDARY (per the file header): like every method here, this
     * is reachable from any frame the WebView loads, including
     * operator-authored template HTML. What it returns is device
     * *fingerprinting* material — model, build fingerprint, installed
     * vendor packages, admin state. It deliberately returns NO secrets:
     * no api root, no device JWT, no pairing code, no log tail (contrast
     * `uploadDiagnostics`, which is host-allowlist-gated for exactly that
     * reason). A hostile iframe learns what hardware it is running on,
     * which it can already largely infer from the UA string and screen
     * metrics. That was judged an acceptable trade for a diagnostic the
     * dashboard needs on every screen; if the bridge is ever narrowed to
     * a main-frame nonce handshake, this method should ride along.
     */
    @JavascriptInterface
    fun probeDisplay(): String = try {
        probeDisplayImpl()
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "probeDisplay failed: ${ex.message}")
        """{"error":"${ex.message}"}"""
    }

    // ────────────────────────────────────────────────────────────────
    // Display CONTROL (2026-08-13) — the write half of the probe above.
    //
    // ⚠️ TRUST BOUNDARY. Per this file's header, the legacy
    // `addJavascriptInterface` surface is materialised in EVERY frame
    // the WebView loads, including operator-authored EXTERNAL_HTML board
    // iframes. For `probeDisplay()` the worst case is device
    // fingerprinting. For THESE methods the worst case is a hostile
    // board blanking a hallway screen, dimming it to nothing, or
    // rebooting it — a real physical denial of service on hardware
    // nobody can reach, on a display whose other job is showing a
    // lockdown alert.
    //
    // ── WHY THE FIRST VERSION OF THIS GATE WAS A NO-OP ──────────────
    //
    // v1 refused the legacy transport `if (secureChannelActive())`. That
    // INVERTS: `secureChannelActive` is false precisely on the devices
    // where NativeBridgeChannel cannot attach — the oldest, hardest-to-
    // reach, wall-mounted signage controllers — so the gate protected
    // the modern boxes and left the ones that need it most wide open.
    // Every frame on those devices could call
    // `EduCmsNative.displayApply('{"action":"BLANK"}')` with no
    // dead-man armed.
    //
    // ── THE GATE NOW ────────────────────────────────────────────────
    //
    // These methods pass `trusted = false` UNCONDITIONALLY, on every
    // device, regardless of whether the channel is up. Native
    // `DisplayControlApi` then allows only the RECOVERY-direction subset
    // — wake, and a brightness change that raises — and refuses BLANK,
    // REBOOT, KEEP, allowBlack, any lowering and the whole schedule
    // installer. The full capability is reachable only through
    // `*ViaSecureChannel`, which NativeBridgeChannel calls after it has
    // verified the exact origin AND the main frame.
    //
    // A pre-channel device therefore loses REMOTE blank/dim/schedule
    // until it can take a channel-capable WebView. A screen with no
    // remote blank is strictly safer than one any iframe can blank, and
    // it keeps the recovery path open in both directions.
    //
    // `displayCapabilities()` is READ-ONLY and stays ungated so a board
    // can ask what it is running on, exactly like `probeDisplay()`.
    // `displayEmergencyHold()` is ungated in BOTH directions — raising is
    // fail-safe (it can only make a dark screen visible) and releasing is
    // recovery-direction (it darkens nothing; every darkening action here
    // stays trusted-only). On a pre-channel box EVERY call arrives on
    // this transport, so a trusted-only release meant the first alert
    // pinned the screen lit forever with no way back.
    // ────────────────────────────────────────────────────────────────

    /**
     * What this box can actually drive, and by which mechanism:
     * `{"ok":true,"capabilities":{"BRIGHTNESS":"software-dim",…},"state":{…}}`.
     *
     * The dashboard MUST render its per-screen controls from this map
     * and nothing else. A capability that is absent means the hardware
     * cannot do it; a capability resolved to `software-dim` means the
     * image dims but the backlight does not, and the UI is required to
     * say so rather than pretend it is a real brightness control.
     */
    @JavascriptInterface
    fun displayCapabilities(): String = try {
        displayCapabilitiesImpl()
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displayCapabilities failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * Apply one immediate action —
     * `{"action":"SET_BRIGHTNESS","percent":40,"revertAfterMs":30000}`.
     * Every value is validated and clamped NATIVELY (the MIN_SAFE
     * brightness floor lives in Kotlin, not in React, precisely because
     * this argument is attacker-controlled).
     */
    @JavascriptInterface
    fun displayApply(actionJson: String): String = try {
        // trusted = false, ALWAYS. Not conditional on the channel — see
        // the block comment above for why the conditional version was a
        // no-op on exactly the devices that needed it.
        displayApplyImpl(actionJson, false)
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displayApply failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * Install the manifest's `display` block (schedule rows + brightness
     * policy + vendor recipe). The schedule then runs from AlarmManager
     * ON THE DEVICE, so a screen that loses network still blanks at
     * 22:00 and wakes at 07:00.
     *
     * Trusted-transport only: a schedule row is a STANDING instruction to
     * blank the panel every night, which is strictly worse than a one-off
     * blank (that at least carries a dead-man revert).
     */
    @JavascriptInterface
    fun displaySetSchedule(configJson: String): String = try {
        displaySetScheduleImpl(configJson, false)
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displaySetSchedule failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * ⚠️ LIFE SAFETY — the emergency interlock.
     *
     * The web player calls this whenever emergency state changes: on the
     * signed WS OVERRIDE / ALL_CLEAR handlers, AND on every manifest poll
     * that carries an `emergency` field so a screen with no WebSocket,
     * riding the HTTP polling backstop, is covered too. Idempotent —
     * re-reporting the same state is a cheap no-op.
     *
     * While the hold is active the native display layer refuses every
     * BLANK, every brightness-lowering action and every REBOOT, from the
     * bridge, the on-device scheduler and the dead-man revert alike, and
     * forces the panel visible. See
     * `com.educms.player.display.DisplayEmergency`.
     *
     * BOTH directions are honoured on THIS untrusted transport, on
     * purpose (2026-08-14). `active = true` can only ever make a dark
     * screen visible. `active = false` is ALSO recovery-direction: it
     * darkens nothing by itself, and every darkening action on this
     * transport stays trusted-only, so a hostile frame that clears a hold
     * unlocks nothing it can use. Refusing it was worse than the threat
     * it modelled — on a Chromium 83-87 Taurus the origin-scoped channel
     * cannot attach at all, so EVERY call lands here, and the first alert
     * engaged a hold nothing could ever lift. See
     * `DisplayControlApi.emergencyHoldJson` for the full argument.
     */
    @JavascriptInterface
    fun displayEmergencyHold(active: Boolean): String = try {
        displayEmergencyHoldImpl(active, false)
    } catch (ex: Exception) {
        PlayerLogger.e("WebAppBridge", "displayEmergencyHold FAILED", ex)
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * ONE-TAP DEVICE-ADMIN ENROLMENT (2026-08-14).
     *
     * Raises the Android `ACTION_ADD_DEVICE_ADMIN` dialog for the
     * Player's own `display.PlayerAdminReceiver`, which declares
     * force-lock and nothing else. Approving it promotes BLANK/WAKE from
     * the software floor (a black overlay over a still-lit panel that
     * saves no power) to `DevicePolicyManager.lockNow()` — a real
     * panel-off. It grants nothing else: not reboot, not silent install,
     * not device owner.
     *
     * Returns `{"ok":true,"state":"prompt-pending"}`, or `ok:false` with
     * a stable `code`: `already-enrolled`, `prompt-pending`,
     * `recently-declined`, `no-operator-present`, `prompt-unavailable`.
     *
     * ─────────────────────────────────────────────────────────────────
     * ⚠️ WHY THIS ONE IS NOT ON THE `NativeBridgeChannel` ALLOWLIST
     * ─────────────────────────────────────────────────────────────────
     * It is only on this legacy every-frame surface, which is the one
     * transport that exists on 100% of the fleet (including the
     * Chromium 83-87 Taurus, where `WEB_MESSAGE_LISTENER` is
     * unavailable and the origin-scoped channel can never attach).
     *
     * Adding it to `NativeBridgeChannel.METHODS` REQUIRES the matching
     * entry in `apps/web/src/app/player/nativeBridge.ts`
     * (`NATIVE_VALUE_METHODS`) plus the `toHaveLength` bump in
     * `apps/web/src/app/player/__tests__/nativeBridge.test.ts` — that
     * suite reads the Kotlin array off disk and asserts sorted equality,
     * so a Kotlin-only addition turns the blocking `web-jest` job RED.
     * Those files are outside this change's file domain, so the channel
     * registration is deliberately left as a paired follow-up: all three
     * edits must land in ONE commit.
     *
     * ⚠️ The every-frame exposure is NOT unguarded. Enrolment is not a
     * recovery-direction action, so it does not belong in
     * `DisplayControlApi.isRecoveryAction`'s untrusted subset — but the
     * gate that actually fits it is presence, not transport:
     * `MainActivity.requestDeviceAdminEnrollment` refuses unless
     * somebody physically touched this box in the last 60 s. A hostile
     * board iframe on an unattended wall panel gets
     * `no-operator-present` and nothing else; and even with a human
     * present the worst outcome is a system dialog they must actively
     * approve, rate-limited by the enrolment debounce and the
     * once-declined cooldown.
     */
    @JavascriptInterface
    fun displayEnrollAdmin(): String = try {
        displayEnrollAdminImpl()
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displayEnrollAdmin failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * Channel-only entry points. [com.educms.player.security.NativeBridgeChannel]
     * dispatches here instead of to the `@JavascriptInterface` methods
     * above, so the full capability is reachable by the one caller that
     * has already passed BOTH the exact-origin and main-frame checks.
     *
     * Deliberately NOT annotated `@JavascriptInterface` — these names are
     * invisible to `window.EduCmsNative` and unreachable from any frame.
     */
    internal fun displayApplyViaSecureChannel(actionJson: String): String = try {
        displayApplyImpl(actionJson, true)
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displayApply(secure) failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    internal fun displaySetScheduleViaSecureChannel(configJson: String): String = try {
        displaySetScheduleImpl(configJson, true)
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "displaySetSchedule(secure) failed: ${ex.message}")
        """{"ok":false,"code":"exception"}"""
    }

    internal fun displayEmergencyHoldViaSecureChannel(active: Boolean): String = try {
        displayEmergencyHoldImpl(active, true)
    } catch (ex: Exception) {
        PlayerLogger.e("WebAppBridge", "displayEmergencyHold(secure) FAILED", ex)
        """{"ok":false,"code":"exception"}"""
    }

    /**
     * Whether the origin-scoped channel is live. Diagnostic only — it is
     * deliberately NOT a gate any more (see the block comment above);
     * exposing it keeps the boot-log/telemetry answer honest about which
     * transport a given kiosk is on, which is removal criterion #3 in
     * NativeBridgeChannel's header.
     */
    internal fun secureTransportLive(): Boolean = try {
        secureChannelActive()
    } catch (ex: Exception) {
        false
    }

    /**
     * Kicks off a one-time OTA update check. Called by the web player
     * when it receives a signed CHECK_FOR_UPDATES WebSocket message
     * from an admin clicking "Push APK update" in the dashboard.
     * Returns the app's versionName so the server side can log what
     * build was asked to update (forensic trail for forced rollouts).
     */
    @JavascriptInterface
    fun checkForUpdates(): String {
        if (!gate("checkForUpdates", null)) return BridgeNonce.REFUSAL_JSON
        onCheckForUpdates(false)
        return BuildConfig.VERSION_NAME
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun checkForUpdates(nonce: String): String {
        if (!gate("checkForUpdates", nonce)) return BridgeNonce.REFUSAL_JSON
        onCheckForUpdates(false)
        return BuildConfig.VERSION_NAME
    }

    /**
     * The SAME OTA check, stamped as OPERATOR-AUTHORIZED.
     *
     * ⚠️ A SEPARATE METHOD, NOT A PARAMETER ON [checkForUpdates], and that
     * is load-bearing in two directions:
     *
     *  1. Every existing caller of `checkForUpdates` is a RELAY — the
     *     dashboard's signed CHECK_FOR_UPDATES push, the manifest poll's
     *     `forceUpdatePending` fallback, the boot-time catch-up. None of
     *     them means "a person is standing at this screen", and silently
     *     promoting them all would hand every relay a rollout-hold bypass.
     *     A distinct name makes the human path the one that opts in.
     *  2. `nativeHas('checkForUpdatesUserInitiated')` is how the web player
     *     tells a v1.1.5+ APK from every older build, so it can fall back
     *     to plain `checkForUpdates` instead of calling into a method that
     *     is not there. An arity change on the existing method would be
     *     invisible to that check.
     *
     * Returns this build's versionName, exactly like its sibling, so the
     * caller can log what asked to update.
     */
    @JavascriptInterface
    fun checkForUpdatesUserInitiated(): String {
        if (!gate("checkForUpdatesUserInitiated", null)) return BridgeNonce.REFUSAL_JSON
        PlayerLogger.i("WebAppBridge", "checkForUpdates — USER INITIATED (panel button)")
        onCheckForUpdates(true)
        return BuildConfig.VERSION_NAME
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun checkForUpdatesUserInitiated(nonce: String): String {
        if (!gate("checkForUpdatesUserInitiated", nonce)) return BridgeNonce.REFUSAL_JSON
        PlayerLogger.i("WebAppBridge", "checkForUpdates — USER INITIATED (panel button)")
        onCheckForUpdates(true)
        return BuildConfig.VERSION_NAME
    }

    /**
     * Persist this screen's device JWT for the out-of-process workers.
     * See [onSetDeviceToken] for the trust reasoning; this is the thin
     * @JavascriptInterface skin over it.
     */
    @JavascriptInterface
    fun setDeviceToken(token: String) {
        if (!gate("setDeviceToken", null)) return
        setDeviceTokenImpl(token)
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun setDeviceToken(nonce: String, token: String) {
        if (!gate("setDeviceToken", nonce)) return
        setDeviceTokenImpl(token)
    }

    private fun setDeviceTokenImpl(token: String) {
        try {
            onSetDeviceToken(token)
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "setDeviceToken failed: ${ex.message}")
        }
    }

    /**
     * Returns the tail of the on-device rotating log as a JSON-safe string.
     * Called by the web player's diagnostics overlay (Enter-key panel).
     * The result is plain text; the overlay wraps it in a <pre> block.
     *
     * Returns at most 500 lines so the JS bridge message stays well under
     * WebView's inter-process IPC limit (~4 MB on most platforms).
     */
    @JavascriptInterface
    fun getRecentLogs(): String {
        if (!gate("getRecentLogs", null)) return REFUSED_LOGS
        return recentLogs()
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun getRecentLogs(nonce: String): String {
        if (!gate("getRecentLogs", nonce)) return REFUSED_LOGS
        return recentLogs()
    }

    private fun recentLogs(): String = try {
        getRecentLogsImpl()
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "getRecentLogs failed: ${ex.message}")
        "(getRecentLogs error: ${ex.message})"
    }

    /**
     * Triggers an async log upload to the API server and returns a short
     * status string immediately so the overlay can give feedback.
     * The actual HTTP POST runs in the background; the operator will see
     * the result in the server-side AuditLog or Supabase storage.
     */
    @JavascriptInterface
    fun uploadDiagnostics(): String {
        if (!gate("uploadDiagnostics", null)) return BridgeNonce.REFUSAL_JSON
        return uploadDiagnostics0()
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun uploadDiagnostics(nonce: String): String {
        if (!gate("uploadDiagnostics", nonce)) return BridgeNonce.REFUSAL_JSON
        return uploadDiagnostics0()
    }

    private fun uploadDiagnostics0(): String = try {
        uploadDiagnosticsImpl()
    } catch (ex: Exception) {
        PlayerLogger.w("WebAppBridge", "uploadDiagnostics failed: ${ex.message}")
        "error: ${ex.message}"
    }

    /**
     * v1.0.11 — bootstrap the native side with the API root + device
     * fingerprint that the web player already knows.
     *
     * Why this exists: HeartbeatService and OtaUpdateWorker both read
     * `api_root` and `device_fingerprint` from SharedPreferences on
     * every run, and silently no-op when either is null. Up through
     * v1.0.10 nothing in the native code ever wrote those keys, so
     * BOTH services have been dead since they were added.
     *
     * Symptom on operator's machine (2026-04-27): pushed an OTA from
     * the dashboard, the dashboard cycled through fake stage progress,
     * then declared "no response." The kiosk never moved off v1.0.9
     * because the WebSocket-triggered worker exited at line 78 of
     * OtaUpdateWorker — `api_root` was null.
     *
     * Fix: web player calls EduCmsNative.setBootstrap(apiRoot, fp)
     * once on mount. We persist both values to prefs. From that
     * moment on every periodic + manual OTA check has what it needs
     * to actually fire.
     *
     * Idempotent — safe to call on every page load.
     *
     * ⚠️ AND-001 (2026-08-01) — `apiRoot` is the host the OTA updater
     * later downloads an APK from, and this method is callable from any
     * frame (see the trust-boundary note at the top of this file), so an
     * unvalidated value was an attacker-chosen OTA server → silent
     * install of an attacker-signed APK (the signing key is public).
     * The host is now pinned natively: `MainActivity`'s `onSetBootstrap`
     * lambda runs `HostAllowlist.isAllowed()` before persisting, and
     * `OtaUpdateWorker` re-checks at the point of USE so a value
     * persisted by an older build can never be honoured.
     */
    @JavascriptInterface
    fun setBootstrap(apiRoot: String, fingerprint: String) {
        if (!gate("setBootstrap", null)) return
        setBootstrapImpl(apiRoot, fingerprint)
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun setBootstrap(nonce: String, apiRoot: String, fingerprint: String) {
        if (!gate("setBootstrap", nonce)) return
        setBootstrapImpl(apiRoot, fingerprint)
    }

    private fun setBootstrapImpl(apiRoot: String, fingerprint: String) {
        try {
            onSetBootstrap(apiRoot, fingerprint)
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "setBootstrap failed: ${ex.message}")
        }
    }

    /**
     * Show an external URL in the native overlay WebView. The overlay
     * WebView does NOT receive this bridge.
     *
     * ⚠️ AND-005 (2026-08-01). This method is reachable from every frame
     * (see the trust-boundary note at the top of this file), so any JS on
     * the screen can put full-screen web content on a school hallway
     * display. The validation below is deliberately SCHEME/SYNTAX-only,
     * NOT a first-party host allowlist:
     *
     *   This surface's legitimate job is to render arbitrary OPERATOR-
     *   CHOSEN customer websites — it is the native renderer for
     *   `text/html` playlist items (apps/web .../player/page.tsx, the
     *   "Native Android URL overlay" effect), e.g. the customer site an
     *   operator scheduled on a lobby screen. Pinning the host to
     *   venue-os.app would silently kill that shipped feature on every
     *   APK kiosk in the field.
     *
     * So we harden what can be hardened without breaking the product:
     *   - must parse as a hierarchical URI (no smuggled control bytes)
     *   - https only — `http://` is already dead anyway, res/xml/
     *     network_security_config.xml sets cleartextTrafficPermitted=false
     *   - no embedded credentials (`https://evil.com@real.site/`)
     *   - non-web schemes (javascript:, data:, file:, content:, intent:)
     *     are refused by construction
     *
     * The real fix for "any frame can drive this" is origin-gating the
     * bridge (AND-002), not a host allowlist here. If the product decides
     * URL playlist items must be first-party only, swap `isSafeWebUrl`
     * for `HostAllowlist.requireAllowed("showUrlOverlay", …)` — that is a
     * one-line change and a deliberate feature removal.
     */
    @JavascriptInterface
    fun showUrlOverlay(url: String) {
        if (!gate("showUrlOverlay", null)) return
        showUrlOverlayImpl(url)
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun showUrlOverlay(nonce: String, url: String) {
        if (!gate("showUrlOverlay", nonce)) return
        showUrlOverlayImpl(url)
    }

    private fun showUrlOverlayImpl(url: String) {
        val cleanUrl = url.trim()
        if (!HostAllowlist.isSafeWebUrl(cleanUrl)) {
            PlayerLogger.w(
                "WebAppBridge",
                "showUrlOverlay REJECTED — not a plain https URL: ${HostAllowlist.describe(cleanUrl)}",
            )
            return
        }
        try {
            onShowUrlOverlay(cleanUrl)
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "showUrlOverlay failed: ${ex.message}")
        }
    }

    /**
     * ⚠️ DELIBERATELY NOT NONCE-GATED (SEC-002). Recovery direction: it can
     * only ever REMOVE content from the glass, and the method that puts
     * content there ([showUrlOverlay]) is gated. Same argument the
     * emergency interlock already makes for `displayEmergencyHold(false)` —
     * a screen that can be pinned under an overlay with no way back is the
     * worse failure.
     */
    @JavascriptInterface
    fun hideUrlOverlay() {
        try {
            onHideUrlOverlay()
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "hideUrlOverlay failed: ${ex.message}")
        }
    }

    /**
     * 2026-05-04 — Manager-permission deep-link.
     *
     * Operator (post-OTA): "manager didnt get permissions because it
     * never asks me to give those permissions when you side load the
     * app, it asks for the player permissions but then just installs
     * the manager and never asks for them".
     *
     * When Manager doesn't have "Install unknown apps" granted, every
     * OTA install of Player is blocked. This bridge method opens the
     * Settings page directly at the Manager package's install-unknown-
     * apps toggle — operator hits the toggle, comes back, and the
     * next OTA tick succeeds. Saves them from navigating six menus
     * deep on a kiosk remote.
     */
    @JavascriptInterface
    fun openSettingsForManager() {
        if (!gate("openSettingsForManager", null)) return
        openSettingsForManagerImpl()
    }

    /** Nonce-bearing form — see [BridgeNonce]. */
    @JavascriptInterface
    fun openSettingsForManager(nonce: String) {
        if (!gate("openSettingsForManager", nonce)) return
        openSettingsForManagerImpl()
    }

    private fun openSettingsForManagerImpl() {
        try {
            onOpenSettingsForManager()
        } catch (ex: Exception) {
            PlayerLogger.w("WebAppBridge", "openSettingsForManager failed: ${ex.message}")
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Sprint 13 Phase 2 — CTS native serial bridge surface.
    //
    // Exposed to the web layer as `window.EduCmsNative.ctsSerial*()`.
    // CtsBridge.tsx mounts → reads ctsSerialEnabled() → if true, skips
    // the Web Serial picker UI and drives this surface directly.
    //
    // Every method returns a JSON string (so we don't have to deal
    // with JS↔Kotlin object marshalling). The web layer parses it.
    // Errors come back as `{ok:false, code, message}` so the operator
    // sees actionable diagnostics, not stack traces.
    // ────────────────────────────────────────────────────────────────

    /**
     * Build-time + runtime gate. True when this APK was compiled with
     * the native serial bridge AND the device has at least one tty we
     * could plausibly read. The web layer uses this to choose between
     * Web Serial (Beelink) and native (ECBox) at mount.
     */
    @JavascriptInterface
    fun ctsSerialEnabled(): Boolean {
        return ctsSerial?.isAvailable() ?: false
    }

    /**
     * Open the serial port + start the read loop. Idempotent — a second
     * call while already open returns the current state. Defaults match
     * CTS Gen 6 spec (9600 8-E-1). Returns JSON:
     *   {ok:true, state, devicePath, baudRate, dataBits, stopBits, parity}
     *   {ok:false, code, message}
     */
    @JavascriptInterface
    fun ctsSerialConnect(
        devicePath: String,
        baudRate: Int,
        dataBits: Int,
        stopBits: Int,
        parity: String,
    ): String {
        val bridge = ctsSerial ?: return """{"ok":false,"code":"unavailable","message":"Native serial bridge not configured on this build"}"""
        return try {
            bridge.connect(devicePath, baudRate, dataBits, stopBits, parity)
        } catch (ex: Throwable) {
            PlayerLogger.w("WebAppBridge", "ctsSerialConnect failed: ${ex.message}")
            """{"ok":false,"code":"exception","message":"${ex.message ?: "unknown"}"}"""
        }
    }

    /**
     * Close the serial port + stop the read loop. Idempotent.
     */
    @JavascriptInterface
    fun ctsSerialDisconnect(): String {
        val bridge = ctsSerial ?: return """{"ok":false,"code":"unavailable"}"""
        return try {
            bridge.disconnect()
        } catch (ex: Throwable) {
            PlayerLogger.w("WebAppBridge", "ctsSerialDisconnect failed: ${ex.message}")
            """{"ok":false,"code":"exception","message":"${ex.message ?: "unknown"}"}"""
        }
    }

    /**
     * Live status — for the kiosk info overlay + ops dashboard. JSON:
     *   {open, devicePath, bytesRead, lastByteAt, lastError?}
     */
    @JavascriptInterface
    fun ctsSerialStatus(): String {
        val bridge = ctsSerial ?: return """{"open":false,"unavailable":true}"""
        return try {
            bridge.status()
        } catch (ex: Throwable) {
            """{"open":false,"code":"exception","message":"${ex.message ?: "unknown"}"}"""
        }
    }
}
