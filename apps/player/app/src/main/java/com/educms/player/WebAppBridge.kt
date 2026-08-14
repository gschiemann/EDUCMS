package com.educms.player

import android.webkit.JavascriptInterface
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist

/**
 * Minimal JS ↔ native bridge surface exposed to the web player as
 * `window.EduCmsNative`. Keep this surface tiny — every method becomes
 * an attack surface if the player loads untrusted content.
 *
 * ⚠️ TRUST BOUNDARY — READ BEFORE ADDING A METHOD (AND-002, 2026-08-01).
 * This object is attached with `WebView.addJavascriptInterface`, which
 * exposes it to **every frame the WebView loads**, not just the top-level
 * EduCMS player document. `removeJavascriptInterface` is never called and
 * no method here can see its caller's origin — so operator-authored and
 * third-party HTML mounted in the player's iframes reaches every method
 * below. Treat EVERY argument as attacker-controlled and validate it
 * natively; comments elsewhere in this repo that claim the bridge is
 * "only exposed to our trusted player web origin" are WRONG. The
 * structural fix (WebViewCompat.addWebMessageListener with explicit
 * allowed-origin rules, or a main-frame-only nonce handshake) is tracked
 * separately.
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
    private val onCheckForUpdates: () -> Unit,
    private val getRecentLogsImpl: () -> String,
    private val uploadDiagnosticsImpl: () -> String,
    private val onExitToDeviceHome: () -> Unit,
    private val onSetBootstrap: (apiRoot: String, fingerprint: String) -> Unit,
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
     * 2026-05-24 — per-screen orientation lock. The /player route calls
     * `bridge.setOrientation('LANDSCAPE' | 'PORTRAIT' | 'AUTO')` when
     * it sees a new value in the manifest or in a signed WS
     * ORIENTATION_CHANGE message. Native side maps to
     * setRequestedOrientation; defaults to a no-op if the lambda isn't
     * wired (e.g. for ad-hoc WebView previews).
     */
    private val onSetOrientation: (String) -> Unit = {},
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
     * True when the origin-scoped [com.educms.player.security.NativeBridgeChannel]
     * is live on this WebView. DIAGNOSTIC ONLY since 2026-08-13 — it is
     * no longer a gate, see `displayApply()`.
     */
    private val secureChannelActive: () -> Boolean = { false },
) {
    /**
     * Escape hatch — exits our kiosk task stack and returns the user to
     * the OEM launcher (Goodview/NovaStar/TCL). Critical for signage
     * boxes where our app is a guest on top of a vendor CMS that
     * controls device + network settings.
     */
    @JavascriptInterface
    fun exitToDeviceHome() = onExitToDeviceHome()
    @JavascriptInterface
    fun unpair() = onUnpair()

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
     * 2026-05-24 — orientation lock. Called by the web player whenever
     * it observes a new orientation value (either via manifest.orientation
     * on the next poll, or via a signed ORIENTATION_CHANGE WS message).
     * Input is validated native-side; unknown values are logged and
     * ignored.
     */
    @JavascriptInterface
    fun setOrientation(value: String) = onSetOrientation(value)

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
        onCheckForUpdates()
        return BuildConfig.VERSION_NAME
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
    fun getRecentLogs(): String = try {
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
    fun uploadDiagnostics(): String = try {
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
