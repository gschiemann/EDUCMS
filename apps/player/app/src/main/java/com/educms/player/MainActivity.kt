package com.educms.player

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.educms.player.bootstrap.ManagerBootstrap
import com.educms.player.bootstrap.ManagerUpgradeDecision
import com.educms.player.bootstrap.ManagerUpgradeMath
import com.educms.player.bootstrap.ManagerUpgradeProbe
import com.educms.player.databinding.ActivityMainBinding
import com.educms.player.display.DisplayCapabilityProbe
import com.educms.player.display.DisplayControlApi
import com.educms.player.display.DisplayEmergency
import com.educms.player.display.DisplayGuard
import com.educms.player.display.DisplayScheduler
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.display.DisplayWindowBridge
import com.educms.player.led.LedCanvasHost
import com.educms.player.led.LedSystemPromptBanner
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.InstallPromptGate
import com.educms.player.security.HostAllowlist
import com.educms.player.security.LockTaskController
import com.educms.player.security.NativeBridgeChannel
import com.educms.player.watchdog.ContentWatchdogPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Fullscreen WebView player. Loads the EduCMS web player URL with the device's
 * pairing token. The web app does the rendering; this Activity provides the
 * immersive kiosk shell, wake lock, and crash recovery.
 */
class MainActivity : ComponentActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var urlOverlayView: WebView
    private val deviceStore by lazy { DeviceStore(applicationContext) }
    private lateinit var recovery: NetworkRecoveryController
    private var urlOverlayCurrentUrl: String? = null

    /**
     * SECONDARY FACES (2026-09-16, double-sided displays).
     *
     * Hosts faces 1..N in `android.app.Presentation` windows on the eligible
     * secondary displays. ⚠️ INERT on every screen in the fleet: it hosts
     * nothing unless `edu_player`/`face_count` says otherwise, and nothing
     * sets that key yet — see [com.educms.player.face.FaceHostController]'s
     * header for why the web storage namespace has to land first.
     *
     * Face 0 — this Activity's own `webView` and every field around it — is
     * deliberately NOT routed through a host. A face owns a private copy of
     * every per-WebView fact instead, so it can never write the primary's
     * `lastSuccessfulLoadAtMs` and certify a wedged front as fresh.
     */
    private var faceHosts: com.educms.player.face.FaceHostController? = null

    /**
     * Last-seen IME (soft keyboard) visibility. Used by the
     * onApplyWindowInsetsListener below to detect close-transitions
     * and force a WebView repaint that clears the post-keyboard
     * black bar. Initialized false (assumes keyboard not visible at
     * activity start, which is enforced by stateAlwaysHidden in the
     * manifest).
     */
    private var lastImeVisible: Boolean = false

    /**
     * AND-002 — true once the origin-scoped [NativeBridgeChannel] is live
     * on this WebView. False means this device fell back to the legacy
     * `addJavascriptInterface` bridge alone (pre-M77 WebView), which is
     * reachable from every frame. Surfaced in `deviceInfoJson()` so the
     * fleet can be checked from the dashboard rather than device by
     * device — that check is removal criterion #4 for the legacy surface.
     */
    private var nativeChannelActive: Boolean = false

    /**
     * SEC-002 — true when this device took the LEGACY path in
     * [configureWebView]: `addJavascriptInterface` is attached and
     * `window.EduCmsNative` therefore exists in every frame the WebView
     * loads, including operator-authored board iframes and proxied WEBPAGE
     * content. False means the origin-scoped channel plus its document-start
     * compat shim carry the whole bridge and untrusted frames see nothing.
     *
     * Reported in `deviceInfoJson()` as `legacyBridge` so the dashboard can
     * answer "which screens still expose the every-frame surface" without a
     * site visit — the same job `secureBridge` does for criterion #4.
     */
    private var legacyBridgeInjected: Boolean = false

    /**
     * SEC-002 — the per-boot main-frame secret for the legacy path. Held so
     * the WebViewClient can re-deliver it on every navigation of a WebView
     * too old for document-start injection (Chromium 83/87 Taurus).
     */
    private var bridgeNonce: com.educms.player.security.BridgeNonce? = null

    /**
     * SEC-002 — true when the nonce could not be installed as a
     * document-start script and must be evaluated into the top frame on
     * each navigation instead. See
     * [NativeBridgeChannel.injectBridgeNonceIntoTopFrame].
     */
    private var bridgeNonceNeedsEval: Boolean = false

    /**
     * SEC-002 (re-audit, 2026-09-04) — the bounded re-delivery pump for the
     * `evaluateJavascript` path.
     *
     * ⛔ WHY THIS EXISTS. The gate is now DEFAULT-DENY, so an
     * `evaluateJavascript` that Chromium drops before the new document
     * commits no longer degrades to "everything allowed" — it degrades to
     * "the control plane stays shut". A single shot at `onPageStarted` plus
     * one at `onPageFinished` therefore is not good enough for the MAIN
     * frame: `onPageFinished` can be tens of seconds out on a slow panel,
     * and until then the player's own chrome cannot unpair or re-bootstrap.
     *
     * So delivery RETRIES on a short schedule until it arms, then stops. It
     * is a security-NEUTRAL mechanism — `evaluateJavascript` targets the top
     * frame by construction, so every retry lands in exactly the frame the
     * one-shot version targeted, and no sub-frame can observe it.
     *
     * Bounded on purpose: an unbounded pump on a panel whose WebView never
     * runs our JS is a forever-timer on a device that must not jank.
     * [BRIDGE_NONCE_RETRY_MAX] × [BRIDGE_NONCE_RETRY_MS] ≈ 6 s of trying,
     * re-armed from scratch by the next main-frame document callback.
     */
    private var bridgeNonceRetriesLeft: Int = 0

    /** Main-thread runnable for [bridgeNonceRetriesLeft]. One at a time. */
    private var bridgeNonceRetry: Runnable? = null

    /**
     * C-P1-3 — the live client for the player WebView, kept so every
     * `stopLoading()` we issue can first disqualify the clean
     * `onPageFinished` Chromium will deliver for it. See
     * [SafePlayerWebViewClient.markNextFinishAborted].
     */
    private var playerWebViewClient: SafePlayerWebViewClient? = null

    /**
     * C-P1-3 — has the web bundle's JS ever proven it RAN in this process?
     *
     * `lastSuccessfulLoadAtMs != 0L` is the anti-brick gate on lock task,
     * but it is forgeable: an error document, or an abort we issued
     * ourselves, sets it through `onPageFinishedOk` without a single line
     * of our JavaScript having executed. A heartbeat cannot be forged that
     * way — it can only arrive if the player bundle parsed, booted and
     * reached its own timer. So THAT is what arms the pin.
     */
    private var webHeartbeatEverReceived: Boolean = false

    /**
     * Belt-and-suspenders kiosk-stuck watchdog (2026-05-05).
     *
     * Operator: "i have this on one of my screens, im sure its because
     * we pushed updates and it disconnected while the site was down…
     * how do we prevent this so the screen always stays alive… right
     * now my only fix is to reboot the screen".
     *
     * NetworkRecoveryController already covers the visible-error path
     * (4xx / 5xx / DNS / renderer crash) — but if the WebView lands in
     * any OTHER stuck state (DNS cache poisoning, OEM Chromium bug,
     * stale service worker holding a busted page, etc.), nothing
     * rescues it. This watchdog is the safety net: every WATCHDOG_TICK
     * minutes, if the WebView hasn't reported a fresh successful page
     * load in WATCHDOG_TIMEOUT minutes, force-reload the player URL.
     *
     * Cheap (one Handler.postDelayed). Idempotent (a healthy page
     * resets lastSuccessfulLoadAtMs every load). Doesn't interrupt a
     * working screen — only kicks in when something is genuinely
     * silently stuck.
     */
    private var lastSuccessfulLoadAtMs: Long = 0L

    /**
     * C-P0-2 (2026-08-30 deep audit) — when [loadPlayer] last STARTED a
     * navigation. `elapsedRealtime`, never wall clock.
     *
     * THE BUG THIS CLOSES. The staleness watchdog had no notion of a load
     * being in flight, so a page slower than one tick was aborted and
     * restarted every 2 minutes — forever. A cold 4K bundle on a Taurus
     * over school Wi-Fi, or the first load after an OTA, could never
     * finish: every attempt was killed at the 2-minute mark by the tick
     * that was supposed to rescue it, and each restart began from zero.
     * The watchdog became the outage.
     *
     * [LOAD_GRACE_MS] is the answer: a tick that finds the page stale but
     * finds a navigation younger than the grace window does nothing at
     * all — no strike, no reload. Only after the grace expires may a stale
     * tick strike.
     */
    private var lastLoadStartedAtMs: Long = 0L

    /**
     * 2026-08-03 — consecutive watchdog ticks that found a stale page.
     * Reset to 0 on every successful load / web heartbeat. Once it
     * reaches [WATCHDOG_UNPIN_AFTER_FAILURES] we release lock task mode,
     * because a kiosk whose WebView is durably dead cannot render the
     * on-screen "Exit to device home" button — pinning it would be a soft
     * brick with no operator way out. See LockTaskController's header.
     */
    private var watchdogConsecutiveFailures: Int = 0

    /**
     * 2026-08-30 (W2-4) — the CONTENT-aware watchdog.
     *
     * The staleness watchdog above asks "is the web runtime alive?" and a
     * player stuck unauthenticated answers yes forever: its JS event loop
     * is fine, so `heartbeat()` keeps refreshing
     * [lastSuccessfulLoadAtMs] while the glass stays dark. This policy
     * consumes the richer `heartbeatV2` signal and forces a reload when
     * the runtime is alive but sync has not been OK for 30 minutes.
     *
     * DORMANT until the first V2 heartbeat, so an APK paired with an
     * older web bundle behaves exactly as it does today. See
     * [ContentWatchdogPolicy].
     */
    private val contentWatchdog = ContentWatchdogPolicy()

    private val watchdogHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val watchdogTicker = object : Runnable {
        override fun run() {
            val nowMs = android.os.SystemClock.elapsedRealtime()

            // C-P1-8 — the Manager-install gate deliberately WITHHOLDS the
            // WebView behind a full-screen overlay (it hides the pairing
            // code until the companion service is installed). Reloading
            // the player underneath it defeats the gate, and a recovery
            // overlay raised by the resulting load error can cover the
            // gate's own UI — leaving the installer staring at
            // "Reconnecting…" with no way to finish setup. Skip BOTH
            // branches while the gate is up; the gate's own poller
            // (startManagerInstallPoller) owns the reload that ends it.
            if (managerGateShown) {
                PlayerLogger.d("MainActivity", "Watchdog: manager gate is up — skipping this tick")
                watchdogHandler.postDelayed(this, WATCHDOG_TICK_MS)
                return
            }

            // C-P0-1 — feed the CURRENT connectivity reading to the content
            // watchdog on every tick, not just when a heartbeat lands. A
            // page whose JS has wedged stops heartbeating entirely; if the
            // last thing it said was "offline" the policy would stay
            // disarmed forever. Reuses NetworkRecoveryController's single
            // ConnectivityManager registration.
            val networkUp = isNetworkUp()
            contentWatchdog.onNetworkState(nowMs, networkUp)

            val ageMs = if (lastSuccessfulLoadAtMs == 0L) Long.MAX_VALUE
                else nowMs - lastSuccessfulLoadAtMs
            val stale = ageMs > WATCHDOG_TIMEOUT_MS
            // C-P0-2 — is a navigation still plausibly in flight? A cold
            // bundle over school Wi-Fi can legitimately outrun a 2-minute
            // tick, and the old code aborted + restarted it every tick,
            // guaranteeing it never finished. Grace only suppresses the
            // STRIKE and the reload; it never marks the page healthy.
            val loadInFlight = lastLoadStartedAtMs != 0L &&
                (nowMs - lastLoadStartedAtMs) < LOAD_GRACE_MS

            // If we've been past the timeout AND the recovery overlay
            // isn't already running its own loop, force-reload. The
            // recovery controller will pick up the resulting load
            // event (success or error) and resume normal flow.
            if (stale && loadInFlight) {
                // Deliberately neither strike nor reset: the page has not
                // proven itself, but we have not given it its chance yet
                // either. The next tick past the grace window judges it.
                PlayerLogger.d(
                    "MainActivity",
                    "Watchdog: page is stale but a load started " +
                        "${(nowMs - lastLoadStartedAtMs) / 1000}s ago — inside the " +
                        "${LOAD_GRACE_MS / 1000}s grace, not striking",
                )
            } else if (stale) {
                watchdogConsecutiveFailures += 1
                PlayerLogger.w(
                    "MainActivity",
                    "Watchdog: no successful page load in ${ageMs / 1000}s — forcing reload " +
                        "(consecutive failures=$watchdogConsecutiveFailures)",
                )
                // Safety valve — a page this broken can't show the
                // operator's escape hatch, so give them the OS back.
                // Re-armed automatically by the next onPageFinishedOk.
                if (watchdogConsecutiveFailures >= WATCHDOG_UNPIN_AFTER_FAILURES) {
                    LockTaskController.disengage(
                        this@MainActivity,
                        "watchdog: $watchdogConsecutiveFailures consecutive failed ticks — " +
                            "handing the device back so an operator can reach the OS",
                    )
                }
                // C-P1-3 — Chromium delivers OUR OWN stopLoading as a clean
                // onPageFinished (crbug/473261), never as an error. Tell
                // the client to disqualify it, or this abort would
                // synthesise a "successful load" that clears recovery,
                // zeroes the strike counter and pins lock task on a page
                // that never painted.
                playerWebViewClient?.markNextFinishAborted()
                runCatching { webView.stopLoading() }
                lifecycleScope.launch {
                    loadPlayer(resolveDeviceToken())
                }
            } else {
                watchdogConsecutiveFailures = 0
            }

            // 2026-08-30 (W2-4) — second opinion, ADDITIVE to the
            // staleness check above (which is deliberately untouched,
            // including its WATCHDOG_UNPIN_AFTER_FAILURES semantics).
            // Catches the case that check structurally cannot see: a web
            // runtime that is alive and heartbeating while showing
            // nothing, because its manifest sync is failing. Silent until
            // the page starts sending heartbeatV2.
            //
            // `!stale` because both branches CAN be true in one tick (a
            // screen that reported syncOk=false for half an hour and then
            // stopped heartbeating entirely satisfies each independently),
            // and firing both would queue two loadPlayer navigations back
            // to back. The staleness branch already reloaded; asking again
            // this tick buys nothing and would burn the content
            // watchdog's cooldown on a reload it did not cause.
            if (!stale && contentWatchdog.shouldForceReload(nowMs)) {
                // C-P0-1 — an active emergency must NEVER be navigated off
                // the glass. The policy's own KDoc anticipated this gate
                // and left it to the caller precisely so declining costs
                // nothing: `markFired` is BELOW this check, so a screen
                // held in lockdown does not burn the cooldown and gets a
                // clean verdict the moment the all-clear lands.
                if (DisplayEmergency.isHeld(applicationContext)) {
                    PlayerLogger.w(
                        "MainActivity",
                        "Content watchdog wanted a reload but an emergency is HELD — " +
                            "refusing to navigate the alert off the glass",
                    )
                } else {
                    contentWatchdog.markFired(nowMs)
                    PlayerLogger.w(
                        "MainActivity",
                        "Content watchdog: web runtime alive but sync not OK for >30min — " +
                            "forcing reload (the screen is heartbeating with nothing on it)",
                    )
                    // C-P1-3 — same abort accounting as the branch above.
                    playerWebViewClient?.markNextFinishAborted()
                    runCatching { webView.stopLoading() }
                    lifecycleScope.launch {
                        loadPlayer(resolveDeviceToken())
                    }
                }
            }

            // Re-arm. Always re-arm — even after a forced reload —
            // so a chronic stuck-state is reloaded on every interval.
            watchdogHandler.postDelayed(this, WATCHDOG_TICK_MS)
        }
    }

    /**
     * C-P0-1 — "does this box currently have an uplink?", delegated to
     * [NetworkRecoveryController], which already owns the one
     * `ConnectivityManager` registration in the process. Before the
     * controller is constructed (or if it ever fails to register) this
     * answers `true`, which is exactly today's behaviour: optimism means
     * the content watchdog keeps working as it did, and only a KNOWN
     * outage suppresses it.
     */
    private fun isNetworkUp(): Boolean =
        if (::recovery.isInitialized) recovery.isNetworkUp() else true

    // ─── BOOT + REGISTRATION WATCHDOG (2026-09-02, P0-2) ─────────────
    //
    // A SECOND, FASTER TICKER, and deliberately not a branch inside the
    // staleness watchdog above. That one runs every 2 minutes and asks
    // "has a page loaded recently"; this one runs every 10 seconds and
    // asks "did the player actually START". They are different questions
    // on different timescales — the boot deadlines are 30/60/120 s, and
    // folding them into a 2-minute tick would make a 30-second deadline
    // fire up to four times late, in front of an installer who is
    // standing there deciding whether to unbolt the panel.
    //
    // It stops itself the moment the boot is satisfied or the card is up,
    // so a healthy screen pays for it only during boot.
    private val bootWatchdogHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val bootWatchdogTicker = object : Runnable {
        override fun run() {
            val nowMs = android.os.SystemClock.elapsedRealtime()
            val facts = com.educms.player.boot.BootDiagnostics.tracker.facts()
            if (facts.satisfied) {
                // Registration succeeded — nothing left to watch until the
                // next navigation re-arms us via loadPlayer().
                return
            }
            com.educms.player.boot.BootDiagnostics.tick(
                this@MainActivity,
                nowMs,
                bootDiagnosticSuppressionNow(),
            )
            // Keep ticking even while the card is up: the probes refresh on
            // the next RAISE only, but the tracker still needs to see a
            // success arrive so it can take the card down.
            bootWatchdogHandler.postDelayed(this, com.educms.player.boot.BootDiagnostics.TICK_MS)
        }
    }

    /**
     * Open the OS network settings from the boot diagnostic.
     *
     * Wi-Fi settings FIRST because that is what a signage box actually
     * needs 95% of the time, with the general Settings panel as the
     * fallback: stripped OEM ROMs (TaurusOS, several Goodview builds) do
     * not always resolve ACTION_WIFI_SETTINGS, and a button that throws is
     * worse than one that lands one screen away. NEW_TASK because we may
     * be launching from a card, not from a normal Activity transition.
     */
    private fun openNetworkSettings() {
        val candidates = listOf(
            Settings.ACTION_WIFI_SETTINGS,
            Settings.ACTION_SETTINGS,
        )
        for (action in candidates) {
            val ok = runCatching {
                startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            }.getOrDefault(false)
            if (ok) {
                PlayerLogger.i("BootDiagnostics", "opened $action")
                return
            }
        }
        PlayerLogger.w("BootDiagnostics", "no settings activity resolved on this ROM")
    }

    private fun startBootWatchdog() {
        bootWatchdogHandler.removeCallbacks(bootWatchdogTicker)
        bootWatchdogHandler.postDelayed(
            bootWatchdogTicker,
            com.educms.player.boot.BootDiagnostics.TICK_MS,
        )
    }

    private fun stopBootWatchdog() {
        bootWatchdogHandler.removeCallbacks(bootWatchdogTicker)
    }

    /**
     * The five things that outrank a boot diagnostic. Evaluated HERE
     * because this Activity is the only place that can see all of them;
     * the decision itself is the pure [bootDiagnosticSuppression].
     */
    private fun bootDiagnosticSuppressionNow(): String? =
        com.educms.player.boot.bootDiagnosticSuppression(
            emergencyHeld = runCatching {
                DisplayEmergency.isHeld(applicationContext)
            }.getOrDefault(false),
            installPromptOutstanding = runCatching {
                installPromptOutstanding
            }.getOrDefault(false),
            managerGateShown = managerGateShown,
            setupCeremonyShowing = runCatching {
                com.educms.player.setup.SetupCeremony.isShowing()
            }.getOrDefault(false),
            lockTaskActive = runCatching {
                LockTaskController.isActive(this)
            }.getOrDefault(false),
        )

    companion object {
        /**
         * SEC-002 (re-audit) — spacing and cap for the bridge-nonce
         * re-delivery pump. 24 × 250 ms ≈ 6 s of trying per main-frame
         * document callback, and the callbacks fire on both `onPageStarted`
         * and `onPageCommitVisible`, so a page that commits late still gets
         * a fresh budget. In practice delivery succeeds on the first or
         * second attempt; the budget exists for the Chromium-83 case where
         * a pre-commit `evaluateJavascript` is dropped on the floor.
         */
        private const val BRIDGE_NONCE_RETRY_MS = 250L
        private const val BRIDGE_NONCE_RETRY_MAX = 24

        /** How often to check freshness. 2 minutes. */
        private const val WATCHDOG_TICK_MS = 2L * 60L * 1000L
        /** How long the page can be stale before we force a reload. 10 minutes. */
        private const val WATCHDOG_TIMEOUT_MS = 10L * 60L * 1000L

        /**
         * C-P0-2 — how long a navigation started by [loadPlayer] is left
         * alone before a stale tick may strike it. 3 minutes.
         *
         * Sized against the slowest load we actually ship into: a cold 4K
         * bundle, on a Chromium-83 Taurus, over a school uplink, with an
         * empty HTTP cache after an OTA. That comfortably exceeds one
         * [WATCHDOG_TICK_MS] (2 min), which is the whole point — under the
         * old code such a load was aborted and restarted by the very tick
         * meant to rescue it, so it could never finish at all.
         */
        private const val LOAD_GRACE_MS = 3L * 60L * 1000L

        /**
         * 2026-08-03 — after this many consecutive stale watchdog ticks we
         * RELEASE lock task mode. Rationale in LockTaskController's
         * header: the operator's on-screen escape hatch lives inside the
         * WebView, so a durably dead WebView + a pinned task = no way out
         * without ADB.
         *
         * ⚠️ C-P0-2 (2026-08-30) — THE TIMELINE, RECOMPUTED. The old KDoc
         * claimed "~30 min"; the audit measured ~6 min cold / ~16 min warm
         * for a 3-strike valve on a 2-minute tick, because strikes landed
         * on CONSECUTIVE ticks. [LOAD_GRACE_MS] now interleaves a skipped
         * tick after every reload, so strikes land 4 minutes apart:
         *
         *   COLD BOOT (never loaded once). loadPlayer at t=0, first tick
         *   at t=2 (in grace, skip) → t=4 strike 1 + reload → t=6 (grace,
         *   skip) → t=8 strike 2 + reload → t=10 (grace, skip) → t=12
         *   STRIKE 3, UNPIN.  ≈ 12 minutes.
         *
         *   WARM (was healthy at T, then died). Stale from T+10; first
         *   tick to see it lands by T+12 and strikes immediately (the last
         *   load is far older than the grace) → +4 → +4.
         *   UNPIN ≈ T+18 to T+20 minutes.
         *
         * Both are still well inside "serviceable within one site visit"
         * and still far longer than any transient outage, which is the
         * property that matters. Do not restore the "~30 min" claim
         * without re-deriving it from the tick, the grace and the strike
         * count together.
         */
        private const val WATCHDOG_UNPIN_AFTER_FAILURES = 3

        // 2026-05-24 — operator-controlled orientation lock.
        // SharedPreferences key for the most-recently-applied value,
        // used on cold-boot before the manifest poll lands.
        private const val PREFS_NAME = "edu_player"
        /**
         * 2026-08-30 (W2-1) — THE canonical native device-token key. Same
         * file/key the `setDeviceToken` bridge writes and the OTA worker
         * reads; see [resolveDeviceToken] and [resolveNativeToken].
         */
        private const val PREF_DEVICE_TOKEN = "device_token"
        private const val PREF_ORIENTATION = "screen_orientation"
        const val ORIENTATION_LANDSCAPE = "LANDSCAPE"
        const val ORIENTATION_PORTRAIT = "PORTRAIT"
        const val ORIENTATION_AUTO = "AUTO"

        /**
         * AND-008 — accepted shape for the device fingerprint handed to
         * `setBootstrap`. It is concatenated into the log-upload and
         * ota-state URLs, so keep it to path-safe characters. Covers every
         * fingerprint the web player mints (`android-<androidId>`,
         * `device-<ts>-<rand>`) plus operator `?deviceId=` values.
         */
        private val FINGERPRINT_RE = Regex("^[A-Za-z0-9._-]{8,128}\$")

        /**
         * 2026-08-25 (v1.1.5) — accepted shape for the device JWT handed to
         * `setDeviceToken`. Three base64url segments, nothing else.
         *
         * This is a SYNTAX check, never an authenticity one — only the
         * server can say whether a token is real, and it does. The point is
         * narrower and worth stating: the value is concatenated into an
         * `Authorization: Bearer …` header, so refusing anything that could
         * carry a CR/LF (or a space, or a second header's worth of text)
         * keeps a hostile board from reshaping the request the OTA worker
         * sends to an allowlisted host. The upper bound is generous —
         * device JWTs here run ~300-500 chars and claims can grow.
         */
        private val DEVICE_TOKEN_RE =
            Regex("^[A-Za-z0-9_-]{4,2048}\\.[A-Za-z0-9_-]{4,4096}\\.[A-Za-z0-9_-]{4,2048}\$")

        /**
         * 2026-08-14 — explicit-component action that raises the
         * device-admin enrolment dialog. See
         * [handleDeviceAdminEnrollIntent]; deliberately NOT declared in
         * an `<intent-filter>`.
         */
        const val ACTION_ENROLL_DISPLAY_ADMIN = "com.educms.player.ENROLL_DISPLAY_ADMIN"

        /**
         * 2026-08-25 — explicit-component action that RE-OPENS the setup
         * checklist on a screen that was only partly granted. See
         * [handleOpenSetupIntent]; like the action above, deliberately
         * NOT declared in an `<intent-filter>`.
         */
        const val ACTION_OPEN_SETUP = "com.educms.player.OPEN_SETUP"

        /**
         * How recently somebody must have touched this box for the
         * web-bridge enrolment request to be honoured. 60 s is long
         * enough to cover "tap the button, read the confirm copy, tap
         * again" and far too short for an unattended wall panel.
         */
        private const val LOCAL_INPUT_WINDOW_MS = 60L * 1000L

        /**
         * 2026-09-02 (P0-2) — how long a Back press waits for the WEB
         * player to answer before the native side takes over.
         *
         * 1.5 s. Long enough that a running page's stop-overlay always
         * wins the race (it is a synchronous state set behind one
         * `evaluateJavascript` hop), short enough that an installer
         * pressing Back on a dead page is not left wondering whether the
         * remote works. The check is on the BOOT PROOF, not a timer alone:
         * a page that has proven its JS runs is never preempted.
         */
        private const val BACK_WEB_ANSWER_GRACE_MS = 1_500L

        /**
         * 2026-09-01 — is THIS Activity resumed right now?
         *
         * The one fact [com.educms.player.ota.RelaunchEscalation] cannot get
         * any other way. `startActivity` from a background process is
         * SILENTLY dropped on Android 10+ (no exception, no result code) when
         * the app is neither HOME, nor holds SYSTEM_ALERT_WINDOW, nor is/has
         * a device owner — which is exactly the state the two Goodview panels
         * were in when an OTA installed and the app never came back. So a
         * successful `startActivity` call proves nothing; only the Activity
         * reaching `onResume` does. Escalation reads this a few seconds
         * later and treats "still false" as the launch not having landed.
         *
         * Process-scoped and deliberately cheap: a volatile boolean written
         * on the main thread by the two lifecycle callbacks below, read from
         * a Handler callback on the same thread. Not a security control, not
         * persisted, and it says nothing about whether CONTENT is loaded —
         * that stays the render-proof/watchdog's job (never equate signals).
         */
        @Volatile
        @JvmStatic
        var isInForeground: Boolean = false
            private set

        // ─── 2026-09-01 (TC22 F1): the SECOND fact ──────────────────
        //
        // "MainActivity is not resumed" has two causes that need opposite
        // responses, and until now they shared one flag. A system install
        // confirmation PAUSES us — so [isInForeground] reads false exactly
        // while the operator is being asked to approve the companion
        // upgrade, and every relaunch actor read that as "the player is
        // gone" and pulled MainActivity in front of the dialog. That is the
        // TC22 failure: "it… asked to update the manager but it did not
        // update it."
        //
        // These four fields are the raw facts; [InstallPromptGate] owns
        // what they mean, and [installPromptOutstanding] is the only thing
        // callers read. Process-scoped and deliberately cheap — volatile
        // primitives, written on the main thread and from the in-process
        // install receiver, read from Handler callbacks and a WorkManager
        // worker in the same process. Not a security control.

        /** `elapsedRealtime()` of the last `startActivity(confirmIntent)`; 0 = none. */
        @Volatile
        private var installPromptRaisedAtMs: Long = 0L

        /** The package that confirmation is about; null = the ROM did not say. */
        @Volatile
        private var installPromptTargetPackage: String? = null

        /** The installer reported SUCCESS/FAILURE for it. */
        @Volatile
        private var installPromptTerminalStatusSeen: Boolean = false

        /** The target package's installed version actually changed. */
        @Volatile
        private var installPromptTargetVersionChanged: Boolean = false

        /**
         * Is a system install confirmation (as far as anything we can
         * honestly observe) on the glass right now?
         *
         * ⚠️ Every reader must treat `true` as "do not relaunch, do not
         * escalate, do not report RELAUNCH_BLOCKED" — never as "the screen
         * is healthy". It says nothing about content; that stays the
         * render-proof/watchdog's job.
         *
         * Self-limiting by construction: the verdict re-derives from the
         * timestamps on every read, so it goes false on its own after
         * [InstallPromptGate.MAX_OUTSTANDING_MS] even if every clearing
         * signal is dropped. A hold that could latch forever would be a
         * worse bug than the one it fixes.
         */
        @JvmStatic
        val installPromptOutstanding: Boolean
            get() = InstallPromptGate.isOutstanding(installPromptFacts())

        /**
         * `elapsedRealtime` of the last raise, or null. Read by the F4
         * re-issue rule so we never re-raise in the same breath as the
         * trampoline's own resume.
         */
        @JvmStatic
        val installPromptLastRaisedAtMs: Long?
            get() = installPromptRaisedAtMs.takeIf { it > 0L }

        private fun installPromptFacts() = InstallPromptGate.Facts(
            raisedAtMs = installPromptRaisedAtMs.takeIf { it > 0L },
            nowMs = android.os.SystemClock.elapsedRealtime(),
            targetVersionChanged = installPromptTargetVersionChanged,
            terminalStatusSeen = installPromptTerminalStatusSeen,
            activityResumed = isInForeground,
        )

        /** Called immediately before `startActivity(confirmIntent)`. */
        @JvmStatic
        fun noteInstallPromptRaised(targetPackage: String?) {
            installPromptRaisedAtMs = android.os.SystemClock.elapsedRealtime()
            installPromptTargetPackage = targetPackage
            installPromptTerminalStatusSeen = false
            installPromptTargetVersionChanged = false
        }

        /**
         * A package we may have been prompting about changed on disk
         * (PACKAGE_ADDED / PACKAGE_REPLACED, the gate poller seeing the new
         * version code, or a STATUS_SUCCESS). The dialog is provably gone.
         *
         * A null [pkg] — or a null recorded target — clears regardless: an
         * unknown package can only end a hold early, which is the safe
         * direction.
         */
        @JvmStatic
        fun noteInstallLanded(pkg: String?) {
            val target = installPromptTargetPackage
            if (target == null || pkg == null || pkg == target) {
                installPromptTargetVersionChanged = true
            }
        }

        /**
         * Drop the hold outright. For the cases where nothing is on the
         * glass to protect at all — a raise that threw, or a gate that has
         * released — as opposed to [noteInstallLanded], which is a claim
         * about the INSTALL and must stay honest.
         */
        @JvmStatic
        fun clearInstallPromptHold(reason: String) {
            if (installPromptRaisedAtMs == 0L) return
            installPromptRaisedAtMs = 0L
            installPromptTargetPackage = null
            installPromptTerminalStatusSeen = false
            installPromptTargetVersionChanged = false
            PlayerLogger.i("MainActivity", "install-prompt hold cleared — $reason")
        }

        /** The session reported a terminal FAILURE/ABORTED. */
        @JvmStatic
        fun noteInstallStatusTerminal(pkg: String?) {
            val target = installPromptTargetPackage
            if (target == null || pkg == null || pkg == target) {
                installPromptTerminalStatusSeen = true
            }
        }
    }

    // ─── 2026-08-14: physical-presence marker ───────────────────────

    /**
     * `SystemClock.elapsedRealtime()` of the last LOCAL input — a touch,
     * a remote key, a USB keyboard. 0 = nobody has touched this box since
     * the Activity started.
     *
     * ⚠️ Its only consumer is the device-admin enrolment gate (see
     * [requestDeviceAdminEnrollment]). It is NOT a security control and
     * must not be used as one — it is a PRESENCE control, and presence is
     * a genuine product requirement there: enrolment ends in an Android
     * system dialog that a human has to read and approve, so firing it
     * when nobody is standing at the panel puts a security prompt on a
     * wall in front of customers and blocks the content behind it until
     * somebody drives 20 minutes to dismiss it.
     *
     * `elapsedRealtime`, never `currentTimeMillis`: Android steps the
     * wall clock on first NTP sync, and a backwards step would make a
     * stale marker look fresh.
     */
    @Volatile
    private var lastLocalInputAtMs: Long = 0L

    /**
     * Called by the framework from `dispatchTouchEvent` /
     * `dispatchKeyEvent` before the event reaches any view, so it covers
     * the WebView, the signage remote's D-pad and a plugged-in keyboard
     * alike.
     */
    override fun onUserInteraction() {
        super.onUserInteraction()
        lastLocalInputAtMs = android.os.SystemClock.elapsedRealtime()
    }

    // ─── 2026-08-03: kiosk lock task mode ───────────────────────────

    /**
     * Tracks resumed-ness for [maybeEngageLockTask]. `onPageFinishedOk`
     * can fire while the activity is paused (a background reload), and
     * `startLockTask()` from a non-resumed activity throws.
     */
    private var isResumedForLockTask: Boolean = false

    /**
     * Ask [LockTaskController] to pin the kiosk. It applies every gate
     * itself (device owner + DO lock-task allowlist + opt-out pref), so
     * this is a no-op on an OEM-CMS guest box and on any unprovisioned
     * sideload — read that file's header before changing either call
     * site.
     *
     * TWO deliberate constraints on WHEN we call it:
     *
     *  1. **Only from a RESUMED activity.** `startLockTask()` throws
     *     `IllegalStateException` otherwise (caught, but it would just
     *     log noise and never pin).
     *  2. **Only after the player page has actually rendered once**
     *     (`lastSuccessfulLoadAtMs != 0L`). This is the anti-brick rule:
     *     the operator's on-screen way out ("Exit to device home") lives
     *     inside the WebView, so a build that crash-loops before it can
     *     paint must never pin itself. Combined with the watchdog's
     *     unpin valve, a screen that cannot show its escape hatch is
     *     never locked.
     */
    private fun maybeEngageLockTask(why: String) {
        if (!isResumedForLockTask) return
        if (lastSuccessfulLoadAtMs == 0L) return
        runCatching { LockTaskController.engageIfPermitted(this) }
            .onFailure { PlayerLogger.w("MainActivity", "maybeEngageLockTask($why) threw: ${it.message}") }
    }

    /**
     * Read the last-applied orientation from SharedPreferences, falling back
     * to what the PANEL's own framebuffer says when nothing has ever been
     * applied.
     *
     * ── THE BUG THIS FIXES (field install, 2026-08-25, v1.1.5) ─────────
     *
     * Operator, on a brand-new 2160×3840 Goodview: *"the screen came up
     * landscape to start with the text all jumbled but once i paired it, it
     * got the correct portrait layout"*. The splash's own debug strip read
     * `VP 720×405` — a LANDSCAPE CSS viewport on a panel whose framebuffer
     * is portrait — so the splash's `@media (orientation: portrait)` rules
     * never engaged and its content overflowed.
     *
     * Cause: before pairing there is no Screen row, so no manifest, so no
     * `orientation` value, so this returned the hard-coded LANDSCAPE default
     * and `applyOrientation` rotated a portrait panel into landscape. The
     * moment the manifest arrived with PORTRAIT it corrected itself — which
     * is why it only ever looked wrong during setup, i.e. during the exact
     * minutes an installer is standing in front of it.
     *
     * ⚠️ WHAT IS AND IS NOT EVIDENCE — read before touching this. The
     * standing lesson (2026-08-24, first fleet install) is that **a panel
     * cannot report that it is physically bolted sideways**: a LANDSCAPE
     * framebuffer on a rotated panel still reports landscape, so explicit
     * PORTRAIT from the operator is the only signal that covers that case,
     * and nothing here changes that. But the converse is not symmetric — a
     * PORTRAIT-SHAPED FRAMEBUFFER is direct, physical evidence that the
     * panel is portrait, because no vendor ships a landscape panel with a
     * taller-than-wide framebuffer. We act on that half only.
     *
     * ⚠️ AND IT IS A FALLBACK, NEVER AN OVERRIDE:
     *   • A stored value — every value the operator, the manifest or a
     *     signed ORIENTATION_CHANGE ever applied — wins outright and is
     *     read exactly as before.
     *   • The derived value is applied with `persist = false` (see the call
     *     site in onCreate), so it never masquerades as an operator choice
     *     and never blocks a later explicit value.
     *   • A LANDSCAPE-shaped framebuffer derives LANDSCAPE — byte-for-byte
     *     today's default — so every panel in the field is unaffected.
     */
    private fun loadSavedOrientation(): String {
        return try {
            val stored = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_ORIENTATION, null)
            if (!stored.isNullOrBlank()) stored else deriveOrientationFromPanel()
        } catch (e: Exception) {
            PlayerLogger.w("Orientation", "loadSavedOrientation failed: ${e.message}")
            ORIENTATION_LANDSCAPE
        }
    }

    /**
     * PORTRAIT when this display's NATURAL framebuffer is taller than it is
     * wide; LANDSCAPE otherwise (and on any error).
     *
     * "Natural" matters: `getRealSize` reports the display in its CURRENT
     * rotation, so on a box the firmware has already rotated it would answer
     * for the rotation rather than the panel. Un-rotating by
     * `Display.getRotation()` gives the panel's own shape, which is the
     * physical fact we are allowed to trust.
     *
     * Deliberately NOT `resources.displayMetrics`: those follow the
     * Activity's configuration, and this runs from `onCreate` immediately
     * before we call `setRequestedOrientation` — reading a value we are
     * about to overwrite is how a fallback ends up agreeing with the bug it
     * exists to fix.
     */
    private fun deriveOrientationFromPanel(): String = try {
        @Suppress("DEPRECATION")
        val display = windowManager.defaultDisplay
        val size = android.graphics.Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)
        val rotation = display.rotation
        val sideways = rotation == android.view.Surface.ROTATION_90 ||
            rotation == android.view.Surface.ROTATION_270
        val naturalW = if (sideways) size.y else size.x
        val naturalH = if (sideways) size.x else size.y
        val derived =
            if (naturalW > 0 && naturalH > naturalW) ORIENTATION_PORTRAIT else ORIENTATION_LANDSCAPE
        PlayerLogger.i(
            "Orientation",
            "no stored orientation — derived $derived from the panel " +
                "(real ${size.x}×${size.y}, rotation=$rotation, natural ${naturalW}×$naturalH)",
        )
        derived
    } catch (e: Exception) {
        PlayerLogger.w("Orientation", "deriveOrientationFromPanel failed: ${e.message}")
        ORIENTATION_LANDSCAPE
    }

    /**
     * Apply an orientation value coming from the operator (via the
     * manifest poll, the signed WS ORIENTATION_CHANGE message, or
     * cold-boot SharedPreferences).
     *
     * Maps the three string values to the standard Android API:
     *   LANDSCAPE → SCREEN_ORIENTATION_LANDSCAPE
     *   PORTRAIT  → SCREEN_ORIENTATION_PORTRAIT
     *   AUTO      → SCREEN_ORIENTATION_UNSPECIFIED  (back to sensor)
     *
     * Idempotent — only calls setRequestedOrientation if the new value
     * differs from the current requestedOrientation, so a manifest poll
     * that returns the same value every 10s doesn't trigger a redundant
     * Activity recreation.
     *
     * If the underlying Goodview / Taurus firmware ignores the Android
     * API (rare but documented on some locked ROMs), the /player route
     * applies a CSS transform:rotate(90deg) fallback within ~2s of
     * detecting that the layout still reports landscape dimensions
     * after PORTRAIT was requested. That logic lives in apps/web/src/
     * app/player/page.tsx — this Activity just makes the request and
     * persists the choice.
     */
    fun applyOrientation(orientation: String, persist: Boolean = true) {
        val normalized = orientation.uppercase()
        val target = when (normalized) {
            ORIENTATION_LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            ORIENTATION_PORTRAIT  -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            ORIENTATION_AUTO      -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> {
                PlayerLogger.w("Orientation", "unknown value: $orientation; ignoring")
                return
            }
        }
        if (requestedOrientation != target) {
            PlayerLogger.i("Orientation", "applying $normalized")
            requestedOrientation = target
        }
        if (persist) {
            runCatching {
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .putString(PREF_ORIENTATION, normalized)
                    .apply()
            }.onFailure { PlayerLogger.w("Orientation", "persist failed: ${it.message}") }
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Display control — the Activity-owned half (2026-08-13).
    //
    // The provider stack in `com.educms.player.display` is Context-only;
    // these four hooks are the one thing it cannot do for itself. They
    // are registered into DisplayWindowBridge (which holds them WEAKLY)
    // and every one of them marshals to the UI thread, because BOTH
    // bridge transports deliver off it: the legacy @JavascriptInterface
    // surface runs on WebView's "JavaBridge" thread and
    // NativeBridgeChannel hops to a background executor on purpose.
    // ────────────────────────────────────────────────────────────────

    /**
     * Opaque black overlay used by the software-dim floor. Created
     * lazily and added on top of the WebView + overlays in the root
     * FrameLayout, so no layout XML change is needed and nothing about
     * the running player is torn down — the page keeps rendering,
     * heartbeating and holding its WebSocket behind the black.
     */
    private var displayBlackoutView: View? = null

    /**
     * Held as a STRONG field precisely because DisplayWindowBridge keeps
     * only a WeakReference: when this Activity is reaped by an OEM ROM
     * without onDestroy, the hooks go with it instead of leaking the
     * Activity and its WebView.
     */
    private val displayHooks = DisplayWindowBridge.Hooks(
        setWindowBrightness = { fraction ->
            runOnUiThread {
                runCatching {
                    // ⚠️ LIFE-SAFETY UI-THREAD GUARD. See the note on
                    // setBlackout below — same race, same close.
                    if (DisplayEmergency.blocksWindowDim(
                            DisplayEmergency.isHeld(applicationContext),
                            fraction,
                        )
                    ) {
                        PlayerLogger.e(
                            "DisplayWindow",
                            "REFUSED window brightness $fraction on the UI thread — " +
                                "an emergency alert is active and this would dim the alert",
                        )
                        return@runCatching
                    }
                    val lp = window.attributes
                    // A negative value hands brightness back to the
                    // system (BRIGHTNESS_OVERRIDE_NONE).
                    lp.screenBrightness = if (fraction < 0f) {
                        WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    } else {
                        fraction.coerceIn(0f, 1f)
                    }
                    window.attributes = lp
                }.onFailure { PlayerLogger.w("DisplayWindow", "setWindowBrightness failed: ${it.message}") }
            }
        },
        // ⚠️ LIFE-SAFETY UI-THREAD GUARD — this is the LAST line of
        // defence and it is the only one that is race-free.
        //
        // DisplayControlRegistry's emergency gate is check-then-act
        // across a thread boundary: the 22:00 alarm can read
        // isHeld()==false, pass, and post its blackout AFTER a lockdown
        // OVERRIDE engages the hold on the bridge worker thread. Every
        // window mutation funnels through THIS looper, and the hold is
        // `commit()`ed before the enforce path posts anything, so a
        // darkening post enqueued after the commit sees held=true here
        // and dies, while one enqueued before it is followed by the
        // enforce posts. Either interleaving ends with a visible alert.
        setBlackout = { visible ->
            runOnUiThread {
                if (DisplayEmergency.blocksBlackout(DisplayEmergency.isHeld(applicationContext), visible)) {
                    PlayerLogger.e(
                        "DisplayWindow",
                        "REFUSED blackout on the UI thread — an emergency alert is active " +
                            "(a blank raced the interlock and lost)",
                    )
                } else {
                    applyBlackout(visible)
                }
            }
        },
        setKeepScreenOn = { on ->
            runOnUiThread {
                runCatching {
                    // ⚠️ LIFE-SAFETY UI-THREAD GUARD. Every blank clears
                    // this flag FIRST — a window holding KEEP_SCREEN_ON
                    // pins the panel lit whatever the vendor broadcast or
                    // the screen-off timeout says. So a blank that lost the
                    // race still reached HERE even with its overlay and its
                    // dim refused, and left the panel free to sleep on the
                    // OS timeout with a lockdown alert on it.
                    if (DisplayEmergency.blocksKeepScreenOff(
                            DisplayEmergency.isHeld(applicationContext),
                            on,
                        )
                    ) {
                        PlayerLogger.e(
                            "DisplayWindow",
                            "REFUSED clearing KEEP_SCREEN_ON on the UI thread — " +
                                "an emergency alert is active and the panel must not be free to sleep",
                        )
                        return@runCatching
                    }
                    if (on) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                    // activity_main.xml ALSO sets android:keepScreenOn on
                    // the root FrameLayout. Clearing only the window flag
                    // leaves the view-level one holding the panel lit,
                    // which reads as "blank didn't work on this vendor".
                    if (::binding.isInitialized) binding.root.keepScreenOn = on
                }.onFailure { PlayerLogger.w("DisplayWindow", "setKeepScreenOn failed: ${it.message}") }
            }
        },
        requestWake = { runOnUiThread { requestScreenWake() } },
    )

    private fun applyBlackout(visible: Boolean) {
        runCatching {
            if (!::binding.isInitialized) return@runCatching
            if (visible) {
                val view = displayBlackoutView ?: View(this).also { v ->
                    v.setBackgroundColor(android.graphics.Color.BLACK)
                    // Swallow taps so a blanked screen cannot be poked
                    // into interacting with the page underneath.
                    v.isClickable = true
                    v.isFocusable = true
                    binding.root.addView(
                        v,
                        android.widget.FrameLayout.LayoutParams(
                            android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                            android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    displayBlackoutView = v
                }
                view.visibility = View.VISIBLE
                view.bringToFront()
            } else {
                displayBlackoutView?.visibility = View.GONE
            }
        }.onFailure { PlayerLogger.w("DisplayWindow", "applyBlackout failed: ${it.message}") }
    }

    /**
     * Re-assert the wake flags. onCreate sets these ONCE; adding a flag
     * that is already set does not re-trigger a wake, so we clear and
     * re-add. Deprecated in favour of setTurnScreenOn() on API 27+, but
     * the flag path is what the rest of this Activity uses and it works
     * on every minSdk-24 target we ship to.
     */
    @Suppress("DEPRECATION")
    private fun requestScreenWake() {
        runCatching {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
            window.addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
            if (::binding.isInitialized) binding.root.keepScreenOn = true
            PlayerLogger.i("DisplayWindow", "wake requested via window flags")
        }.onFailure { PlayerLogger.w("DisplayWindow", "requestScreenWake failed: ${it.message}") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlayerLogger.i("MainActivity", "onCreate — ${Build.MANUFACTURER} ${Build.MODEL} SDK ${Build.VERSION.SDK_INT}")
        // 2026-05-07 (v1.0.52) — device beacon. Diagnostic-only logging
        // expanded so support can answer "what's the kiosk's actual
        // hardware / WebView / ABI / network state?" from a single
        // log line set without ADB. No behavior change. NovaStar Taurus
        // research dump (docs/research/NOVA_STAR_DEEP_DIVE.md) flagged
        // that we'd been guessing at TB30/TB40 internals — this fixes
        // that for every kiosk, every boot.
        runCatching {
            PlayerLogger.i(
                "DeviceBeacon",
                "abi=${Build.SUPPORTED_ABIS.joinToString(",")}" +
                    " arch=${if (Build.SUPPORTED_64_BIT_ABIS.isNotEmpty()) "64-bit" else "32-bit"}" +
                    " brand=${Build.BRAND}" +
                    " device=${Build.DEVICE}" +
                    " hardware=${Build.HARDWARE}" +
                    " release=${Build.VERSION.RELEASE}" +
                    " fingerprint=${Build.FINGERPRINT.take(80)}",
            )
            // WebView is the runtime that matters most for our app.
            // Old Chromium (e.g. <90 on RK3288 boards) kills modern TLS
            // and breaks our SSR-rendered Vercel-served React.
            val wvPkg = android.webkit.WebView.getCurrentWebViewPackage()
            PlayerLogger.i(
                "DeviceBeacon",
                "webview pkg=${wvPkg?.packageName ?: "unknown"}" +
                    " version=${wvPkg?.versionName ?: "unknown"}" +
                    " versionCode=${wvPkg?.longVersionCode ?: -1}",
            )
            val (w, h) = getRealDisplaySize()
            val density = resources.displayMetrics.density
            PlayerLogger.i(
                "DeviceBeacon",
                "display=${w}x${h} density=${density} scaledDensity=${resources.displayMetrics.scaledDensity}",
            )
            // Network identity is a first-call diagnostic. We don't
            // probe captivity here (that's NetworkRecoveryController's
            // job); we just log what NetworkInfo says is present.
            val cm = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            val active = cm?.activeNetwork
            val caps = active?.let { cm.getNetworkCapabilities(it) }
            val transports = mutableListOf<String>()
            caps?.let {
                if (it.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)) transports += "wifi"
                if (it.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)) transports += "ethernet"
                if (it.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)) transports += "cellular"
                if (it.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)) transports += "vpn"
            }
            val internet = caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) ?: false
            val validated = caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: false
            PlayerLogger.i(
                "DeviceBeacon",
                "network transport=${transports.joinToString(",").ifEmpty { "none" }}" +
                    " internet=$internet validated=$validated",
            )
        }.onFailure { PlayerLogger.w("DeviceBeacon", "beacon log emit failed: ${it.message}") }

        // 2026-04-28 (v1.0.22) — handle install-prompt trampoline.
        // OtaInstallReceiver routes STATUS_PENDING_USER_ACTION through
        // here because BroadcastReceiver-launched activities are blocked
        // by Android 11+ Background Activity Launch on Goodview signage
        // ROMs. MainActivity is foregrounded so it satisfies BAL.
        handleInstallPromptTrampoline(intent)

        // 2026-08-14 — field-ops device-admin enrolment trigger. A no-op
        // on every normal launch (the action is absent), and the ONLY
        // boot-path reference to enrolment anywhere in the app: it fires
        // solely when somebody deliberately sent that action, never
        // because the box booted. See handleDeviceAdminEnrollIntent.
        handleDeviceAdminEnrollIntent(intent)
        // Cold-start form of the setup re-entry action. Only arms a flag
        // — onResume raises the checklist, after setContentView.
        handleOpenSetupIntent(intent)

        // 2026-05-24 — per-screen orientation lock.
        //
        // Old behavior (SCREEN_ORIENTATION_FULL_SENSOR) deferred to the
        // device accelerometer. On stationary signage hardware
        // (Goodview, NovaStar Taurus, BrightSign, no-name wall-mount
        // Android boxes) there's no useful sensor — Android falls back
        // to the firmware default, which means a portrait-mounted
        // Goodview panel renders landscape content sideways.
        //
        // New behavior: read the last-applied orientation from
        // SharedPreferences on boot (so a cold-restart picks the same
        // value the operator last set) and apply it via
        // setRequestedOrientation. The manifest poll + WS message
        // handlers both call applyOrientation(String) when the value
        // changes; that path is in WebAppBridge.handleOrientation.
        applyOrientation(loadSavedOrientation(), persist = false)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // 2026-05-05 (v1.0.50) — force the system bar areas to be
        // TRANSPARENT, not opaque black. On some Goodview / NovaStar
        // TaurusOS builds, the WindowInsetsControllerCompat.hide()
        // call doesn't fully eliminate the bar; what remains is an
        // opaque dark strip that overlaps our edge-to-edge content
        // and is visually indistinguishable from a "black bar at the
        // top". With transparent colors set, even if the OEM forces
        // the bar to remain visible, the WebView content shows
        // through and there's no visible bar.
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = android.graphics.Color.TRANSPARENT
            window.navigationBarColor = android.graphics.Color.TRANSPARENT
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        webView = binding.webview
        urlOverlayView = binding.urlOverlayView

        // ── THE LED CANVAS (2026-09-02, 1.1.14) ─────────────────────
        //
        // On a NovaStar TB poster the Android canvas is the controller's
        // 1920×1080 frame buffer and the LED shows only its TOP-LEFT
        // column (320×1080 on the fleet standard). Everything the WEB
        // player draws is already pinned into that column
        // (apps/web/src/app/player/layout.tsx); every NATIVE surface was
        // still centred in 1920, i.e. off the glass — which is what a
        // fresh 1.1.13 install on "LED Poster 3" looked like: black, with
        // a button waiting a metre to the right of the panel.
        //
        // These two XML overlays are the native surfaces that live in
        // activity_main; the boot diagnostic, the setup checklist and the
        // system-prompt banner pin themselves where they mount. The
        // WebView and the blackout view deliberately KEEP the full frame
        // buffer — the page pins itself, and a blank that covered only a
        // third of the buffer would be a light leak.
        //
        // No-op on every non-poster device (LedCanvas.nativeCanvas → null).
        LedCanvasHost.pinAll(this, binding.managerGateOverlay, binding.recoveryOverlay)
        LedCanvasHost.fitNarrow(binding.managerGateOverlay)
        LedCanvasHost.fitNarrow(binding.recoveryOverlay)

        // ── Display control (2026-08-13) ────────────────────────────
        // Order matters and is safety-critical:
        //
        //  1. register the window hooks, so the provider stack has
        //     somewhere to apply to;
        //  2. REPLAY any pending dead-man revert. If the operator was
        //     mid-test when this process died — OOM kill, OEM battery
        //     reaper, OTA self-update, power cut — this is what puts
        //     the screen back. An overdue record reverts immediately;
        //     one still in the future re-arms its alarm. This runs on
        //     EVERY process start, not just a cold boot, because
        //     MainActivity is the only Activity this APK has and
        //     BootReceiver does not fire on an OOM restart;
        //  3. re-apply the persisted brightness/blank state, so a
        //     scheduled blank that fired while the Activity was dead
        //     is honoured the moment a window exists again;
        //  4. re-arm the schedule alarm. Redundant with BootReceiver
        //     on purpose — OEM signage ROMs drop boot receivers, and
        //     the alarm is the ONLY thing that blanks a screen whose
        //     network is down.
        runCatching {
            DisplayWindowBridge.register(displayHooks)
            DisplayGuard.replayPending(applicationContext)
            DisplayControlApi.onWindowAttached(applicationContext)
            DisplayScheduler.armAndApply(applicationContext)
        }.onFailure { PlayerLogger.w("DisplayControl", "display bootstrap failed: ${it.message}") }

        // Self-healing recovery — catches main-frame load failures and
        // 5xx errors, shows a branded "Reconnecting…" overlay, probes
        // /api/v1/health on a backoff, and reloads the WebView when the
        // server returns. Operator no longer has to power-cycle the
        // kiosk to recover from a Vercel/Railway redeploy blip.
        recovery = NetworkRecoveryController(
            context = applicationContext,
            baseUrl = BuildConfig.PLAYER_BASE_URL,
            // 2026-08-30 (W2-2) — the health probe hits the API root, which
            // is NOT baseUrl. Resolved lazily so a screen that bootstraps
            // mid-recovery picks up its real API host immediately.
            apiRootProvider = { ApiRoot.resolve(applicationContext) },
            onShowOverlay = { state ->
                // 2026-05-19 (v1.0.71) — operator on screen M43 reported
                // the URL iframe is on top but the recoveryOverlay text
                // ("Reconnecting to server…", "The screen will resume
                // automatically.") was BLEEDING THROUGH behind the
                // website. Root cause: while a URL asset is showing in
                // urlOverlayView, the MAIN player webview can still
                // fire onReceivedError / renderer-gone events (it's
                // still mounted underneath, polling heartbeat). That
                // kicks the recovery loop, which pops this overlay —
                // but the URL iframe's hardware-accelerated layer on
                // Taurus punches through view z-order, leaving the
                // recovery text faintly visible behind the website.
                //
                // Fix: ONLY make the recoveryOverlay visible when the
                // URL overlay is NOT showing. Keep the text fields
                // up to date so the overlay renders correctly the
                // moment the URL is dismissed. The recovery loop
                // keeps running silently underneath so the player
                // reconnects in the background.
                binding.recoveryTitle.text = state.title
                binding.recoverySub.text = state.sub
                if (state.errorLabel.isNullOrBlank()) {
                    binding.recoveryError.visibility = View.GONE
                } else {
                    binding.recoveryError.visibility = View.VISIBLE
                    binding.recoveryError.text = state.errorLabel
                }
                if (urlOverlayView.visibility != View.VISIBLE) {
                    binding.recoveryOverlay.visibility = View.VISIBLE
                } else {
                    binding.recoveryOverlay.visibility = View.GONE
                }
            },
            onHideOverlay = {
                binding.recoveryOverlay.visibility = View.GONE
            },
            onReloadRequested = {
                lifecycleScope.launch {
                    loadPlayer(resolveDeviceToken())
                }
            },
        )

        // Start the safety-net watchdog after recovery is ready. First
        // tick fires WATCHDOG_TICK_MS from now; gives the initial
        // loadPlayer() call time to actually load before we start
        // checking freshness.
        watchdogHandler.postDelayed(watchdogTicker, WATCHDOG_TICK_MS)

        // 2026-05-05 (v1.0.50) — operator: ".49 same fucking bug,
        // search locations on e-arc.com and when i click in the
        // search field i get the keyboard and the black bar at the
        // top and then close the keyboard and it stays".
        //
        // v1.0.48 (IME-close repaint) and v1.0.49 (re-hide system
        // bars on transition) didn't fix it. Both were chasing
        // wrong root causes. Real bug: under
        // setDecorFitsSystemWindows(false) + adjustResize on
        // Goodview/NovaStar TaurusOS, the IME inset gets applied
        // somewhere in the layout chain and pushes the WebView DOWN
        // — exposing the FrameLayout's black background at the top.
        // Close doesn't reliably restore.
        //
        // v1.0.50 strategy: PREVENT any layout change on IME
        // transition entirely.
        //   1. Manifest switched to adjustNothing — Android won't
        //      try to resize the window.
        //   2. This listener returns WindowInsetsCompat.CONSUMED on
        //      every dispatch — child views (FrameLayout, both
        //      WebViews) NEVER see the IME inset, so they never
        //      apply it, even if a default ViewParent behavior
        //      tried to.
        //   3. System bars stay hidden + transparent (set above)
        //      so even if the OEM tries to force the status bar
        //      back, it's transparent and the WebView shows
        //      through.
        //
        // The IME just slides up as a transparent overlay over the
        // bottom of the WebView. Nothing in our layout shifts. No
        // black bar can ever appear.
        //
        // We still track open/close transitions to:
        //   - reset the WebView scroll on close (covers any
        //     in-page scroll the focus event might have caused)
        //   - re-apply our hide on the system bars (defense in
        //     depth — some OEM ROMs flash the bars on IME pop)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            if (imeVisible != lastImeVisible) {
                lastImeVisible = imeVisible
                // Defense-in-depth: re-hide system bars on every
                // transition. v1.0.49 logic preserved.
                runCatching {
                    WindowInsetsControllerCompat(window, window.decorView)
                        .hide(WindowInsetsCompat.Type.systemBars())
                }.onFailure { Log.w("Player", "IME-transition system-bar hide failed", it) }
                if (!imeVisible) {
                    // IME just closed — reset BOTH WebViews. The user
                    // could be on the main player OR the URL overlay
                    // (e-arc.com etc); only one of them currently has
                    // input focus, but resetting both is harmless.
                    runCatching {
                        webView.scrollTo(0, 0)
                        webView.clearFocus()
                        webView.requestLayout()
                        webView.evaluateJavascript(
                            "window.scrollTo(0,0);" +
                            "if(document.scrollingElement)document.scrollingElement.scrollTop=0;" +
                            "if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();" +
                            "window.dispatchEvent(new Event('resize'));",
                            null,
                        )
                        if (::urlOverlayView.isInitialized && urlOverlayView.visibility == View.VISIBLE) {
                            urlOverlayView.scrollTo(0, 0)
                            urlOverlayView.clearFocus()
                            urlOverlayView.requestLayout()
                            urlOverlayView.evaluateJavascript(
                                "window.scrollTo(0,0);" +
                                "if(document.scrollingElement)document.scrollingElement.scrollTop=0;" +
                                "if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();" +
                                "window.dispatchEvent(new Event('resize'));",
                                null,
                            )
                        }
                    }.onFailure { Log.w("Player", "IME-close repaint hook failed", it) }
                }
            }
            // Critical: CONSUMED so the IME inset doesn't propagate to
            // child views. Without this, default ViewGroup behavior
            // (or some OEM-customized one) can apply the inset to the
            // FrameLayout/WebView and push it down — that's the black
            // bar. With CONSUMED, the WebView NEVER moves regardless
            // of IME state.
            WindowInsetsCompat.CONSUMED
        }

        configureWebView(webView)
        configureUrlOverlay(urlOverlayView)

        // Back-button handler. Previously this just swallowed Back so
        // operators couldn't accidentally exit. Operator (2026-04-27)
        // now needs the remote's Back to actually do something — it
        // does nothing on signage remotes. Two-tier behavior:
        //   - Single press → tell the web player to surface the
        //     Stop/Exit splash (operator chose this control on
        //     purpose; respect it).
        //   - The web player's overlay decides what to do next: stop
        //     playback, exit to launcher, or unpair. If the WebView
        //     has back-history (e.g. someone navigated to /pair via
        //     QR), let that take precedence first.
        // 2026-09-02 (P0-2) — hand the boot watchdog its host. The three
        // callbacks are this Activity's own semantics; BootDiagnostics owns
        // no policy about what Retry / Settings / Exit mean, and it holds
        // only a WeakReference so a recreate cannot leak an Activity.
        com.educms.player.boot.BootDiagnostics.attach(
            activity = this,
            decorate = ::applyRemoteFocus,
            onRetry = {
                // Same abort accounting the watchdog reloads use (C-P1-3):
                // Chromium delivers our own stopLoading as a CLEAN
                // onPageFinished, which would otherwise synthesise a
                // "successful load" for a page that never painted.
                playerWebViewClient?.markNextFinishAborted()
                runCatching { webView.stopLoading() }
                lifecycleScope.launch { loadPlayer(resolveDeviceToken()) }
            },
            onNetworkSettings = { openNetworkSettings() },
            onExit = { exitToDeviceHomeNow("boot diagnostic: operator chose Exit") },
        )

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 2026-08-30 (field install, two bricked units): while the
                // Manager-install gate owns the screen the WebView has no
                // player page, so the stop-overlay dispatch below lands in
                // a void — Back did literally NOTHING and the installer was
                // trapped on "Setting up companion service…" with a remote
                // as their only input. Pre-provisioning there is no signage
                // to protect; Back is an honest exit to the OEM launcher so
                // they can fix network/permissions and come back.
                if (managerGateShown && readManagerVersion() == null) {
                    PlayerLogger.i("MainActivity", "back-press on manager gate — exiting to device home")
                    exitToDeviceHomeNow("back-press on the manager-install gate")
                    return
                }
                // 2026-09-01 (TC22 F2): the COMPANION-UPGRADE gate is a
                // different situation and needs a different escape. Manager
                // IS installed here, so the branch above does not fire and
                // the key would have fallen through to the stop-overlay
                // dispatch below — into a WebView holding no player page.
                // That is the "silent state toggle" rule 15 forbids: a dead
                // key on a wall panel whose remote is the only input.
                // Exiting to the OEM launcher would be wrong too (this is a
                // working, paired signage panel). The useful, honest escape
                // is: stop waiting, play content now, retry the companion
                // upgrade on the next boot or update check.
                if (managerGateShown && managerGateReleasable) {
                    releaseManagerUpgradeGate("back-press — operator chose to keep playing")
                    return
                }
                // 2026-09-01 (GUQ55 / GUQ65 / G65 / TC22 field find): NEVER
                // walk WebView history while the PLAYER page is on the glass.
                // Every `loadPlayer()` reload re-loads the player URL with
                // `?token=` re-attached while the page had scrubbed it, so
                // each REFRESH_WEB / wedge auto-refresh / Manager-install
                // reload left one more cross-document entry behind — and this
                // branch then spent the operator's Back presses walking DOWN
                // that stack, one full page load per press ("connecting… then
                // the content plays again"), never reaching the overlay
                // below. The "/pair via QR" case this branch was written for
                // never existed inside the kiosk WebView (that QR is for the
                // operator's phone). History navigation is now allowed only
                // when a NON-player document is showing — none exists today.
                // The web player carries its own history trap (backTrap.ts)
                // so older APKs in the field get the same one-press behavior.
                val currentUrl = webView.url
                val onPlayerPage = currentUrl == null ||
                    currentUrl == "about:blank" ||
                    (runCatching { Uri.parse(currentUrl).path ?: "" }.getOrDefault("")).startsWith("/player")
                if (!onPlayerPage && webView.canGoBack()) {
                    PlayerLogger.i("MainActivity", "back-press: non-player document — walking WebView history")
                    webView.goBack()
                    return
                }
                // 2026-09-02 (P0-2): the diagnostic card, when it is up, is
                // the actionable escape and owns Back itself (first press
                // selects Exit, second exits). Its own dispatchKeyEvent
                // normally consumes the key before this callback is
                // reached; this branch is the belt for an OEM ROM that
                // routes Back straight to the dispatcher.
                if (com.educms.player.boot.BootDiagnostics.isShowing()) {
                    PlayerLogger.i("MainActivity", "back-press while the boot diagnostic is up — leaving it to the card")
                    return
                }
                // Tell the web player to show its Stop/Exit overlay.
                // The bridge method already exists for the dashboard's
                // "Stop screen" action; we just trigger it locally.
                try {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('edu-show-stop-overlay'))",
                        null,
                    )
                } catch (e: Exception) {
                    PlayerLogger.w("MainActivity", "back-press: failed to dispatch stop-overlay event", e)
                }
                // ⚠️ AND THE GAP 9838f511 COULD NOT CLOSE (2026-09-02, P0-2).
                // That commit fixed Back for a page that is RUNNING: the
                // history trap keeps one same-document entry on top so the
                // dispatch above lands on a live listener. It cannot help
                // when the page's JS never ran — the exact Android-9
                // Goodview shape — because there is no listener to receive
                // the event and `evaluateJavascript` reports nothing about
                // whether anything handled it. So: if the page has never
                // reported a client boot, wait a short beat (a slow-but-
                // alive page must not be preempted) and, if it still has
                // not, raise the NATIVE card, which has a real Exit. Back
                // stops being a dead key on a wall panel whose remote is
                // the only input (player rule 15).
                if (!com.educms.player.boot.BootDiagnostics.tracker.facts().clientBooted) {
                    bootWatchdogHandler.postDelayed({
                        val facts = com.educms.player.boot.BootDiagnostics.tracker.facts()
                        if (facts.clientBooted || facts.satisfied) return@postDelayed
                        if (com.educms.player.boot.BootDiagnostics.isShowing()) return@postDelayed
                        val suppression = bootDiagnosticSuppressionNow()
                        if (suppression != null) {
                            PlayerLogger.w(
                                "MainActivity",
                                "back-press had no web listener but not raising the diagnostic — $suppression",
                            )
                            return@postDelayed
                        }
                        PlayerLogger.w(
                            "MainActivity",
                            "back-press was not answered by the page (no client boot reported) — " +
                                "raising the native diagnostic so Back reaches a real escape",
                        )
                        com.educms.player.boot.BootDiagnostics.raiseForDeadBack(this@MainActivity)
                    }, BACK_WEB_ANSWER_GRACE_MS)
                }
            }
        })

        // v1.0.14 — listen for Manager install so we can reload the
        // WebView the moment Manager appears (so &mv= heartbeat
        // updates). Registered here in onCreate; unregistered in
        // onDestroy. Safe even if Manager is already installed —
        // the receiver just never fires.
        //
        // v1.0.23 — registering BEFORE the Manager-installed check
        // below is critical: if Manager finishes installing in the
        // tiny window between our check and registration, we'd miss
        // the broadcast and the gate would hang forever.
        registerManagerInstallReceiver()

        // v1.0.23 — Manager-install gate. Player MUST NOT load its
        // WebView (pairing screen, splash, kiosk content) until the
        // Manager companion APK is confirmed installed.
        //
        // Why: Manager IS the install agent for future Player + Manager
        // OTA updates (DEVICE_OWNER + UPDATE_PACKAGES_WITHOUT_USER_ACTION
        // in v1.0.23+ Manager builds). Without Manager, every future
        // upgrade requires the operator to physically walk to the
        // screen with a USB stick. Operator (2026-04-28): "player
        // shouldnt launch until manager installed" — confirmed.
        //
        // Why MainActivity, not PlayerApp: Android 11+ Background
        // Activity Launch silently drops startActivity() calls from
        // BroadcastReceivers + non-foregrounded contexts on Goodview's
        // stripped TaurusOS. PlayerApp.onCreate runs before any Activity
        // is foregrounded → STATUS_PENDING_USER_ACTION's system Install
        // dialog gets dropped, no error logged, operator sees nothing.
        // Firing bootstrap from MainActivity.onCreate AFTER setContentView
        // means we're foregrounded → BAL bypass → dialog appears.
        val managerVersion = readManagerVersion()
        val companionRefusal = ManagerBootstrap.posterRefusal(applicationContext)
        if (companionRefusal != null) {
            // 2026-09-02 (v1.1.16) — NOVASTAR POSTER: NO COMPANION, NO GATE, NO
            // HOLD. See SetupCeremonyMath.companionBootstrapRefusal for why;
            // in short, everything the companion flow puts on screen draws
            // off the LED, and ViPlex already does the companion's one job.
            // Straight to the player, exactly as a current companion would.
            PlayerLogger.i(
                "MainActivity",
                "Manager ${managerVersion ?: "missing"} — not bootstrapped: $companionRefusal",
            )
            lifecycleScope.launch {
                loadPlayer(resolveDeviceToken())
            }
        } else if (managerVersion != null) {
            // ⚠️ 2026-09-01 (TC22 F2) — THIS CHECK USED TO BE BINARY, and
            // that is the whole field failure. `readManagerVersion() != null`
            // is true for a STALE companion too, so an upgrade took the
            // happy path below: content started playing and the bundled-
            // Manager install dialog was raised from the same onCreate, in
            // that order, with nothing holding anything. Operator: "the
            // screen keeps trying to play the existing content before it
            // gets to finish the updating process — it needs to put the
            // content on hold, do the upgrade, and then auto start the
            // content again."
            //
            // Now we ASK first (bundled versionCode vs installed) and only
            // then choose: hold + upgrade + auto-resume, or the untouched
            // happy path. The probe is IO, so `loadPlayer` waits on it —
            // bounded, and short of the WebView's own cold-boot cost.
            PlayerLogger.i("MainActivity", "Manager $managerVersion installed — checking whether it is current")
            evaluateManagerUpgradeHold("boot") {
                lifecycleScope.launch {
                    loadPlayer(resolveDeviceToken())
                }
                // 2026-08-24 — the install-permission prompts that used to fire
                // HERE (Player's, then the Manager's) are now steps 1 and 2 of
                // SetupCeremony, which onResume drives. They fired from onCreate
                // side by side with the Home prompt below, so a first boot
                // stacked three dialogs on top of each other; the ceremony runs
                // one at a time and resumes after each Settings round-trip.
                // Player bundles Manager. Re-run bootstrap even when
                // Manager is present so beta Player OTAs can carry Manager
                // upgrades forward on non-device-owner Goodview hardware.
                ManagerBootstrap.bootstrapIfNeeded(applicationContext)
            }
        } else {
            // Manager NOT installed — gate the player.
            PlayerLogger.i("MainActivity", "Manager missing — showing install gate")
            showManagerGate("Setting up companion service…")
            // Defensive: poll PackageManager every 2s in case the
            // PACKAGE_ADDED broadcast is dropped (some OEM ROMs
            // have been observed to do this when receivers are
            // registered late in onCreate).
            startManagerInstallPoller()
            // v1.0.24 — gate-driven permission flow. Don't fire two
            // dialogs at once. If we don't have install-unknown-apps
            // permission yet, deep-link to Settings FIRST, then fire
            // bootstrap when the user returns (onResume). If permission
            // is already granted, fire bootstrap immediately.
            proceedWithBootstrapOrRequestPermission()
        }

        // 2026-08-24 — the Home-app prompt that used to fire here is now the
        // LAST step of SetupCeremony (it is the one grant that touches the
        // vendor CMS's own territory, so everything cheaper runs first).
        // The whole ceremony is driven from onResume — which always runs
        // right after onCreate, and again after every Settings round-trip,
        // which is what chains the steps into one guided flow.

        // ── Secondary faces (2026-09-16, double-sided displays) ─────
        //
        // LAST in onCreate on purpose: the primary's WebView is configured,
        // its first load is dispatched, and the manager gate has already
        // decided whether it owns the screen. A face is additional glass, not
        // a reason to reorder the box's own boot.
        //
        // ⚠️ This is a NO-OP on every screen in the fleet. `requestedFaceCount()`
        // answers 1 unless `edu_player`/`face_count` says otherwise, so the
        // controller enumerates displays, hosts nothing, publishes an honest
        // snapshot and stops — even on a DH43 with an eligible HDMI panel
        // sitting right there. Read FaceHostController's header before
        // changing that default: the web half of the per-face localStorage
        // namespace is not wired yet, and hosting a second face before it
        // lands puts BOTH panes into a mutual 401 loop.
        runCatching {
            val controller = com.educms.player.face.FaceHostController(
                activity = this,
                isNetworkUp = { isNetworkUp() },
            )
            faceHosts = controller
            controller.start()
        }.onFailure {
            // A face is never allowed to cost the primary its boot.
            PlayerLogger.e("MainActivity", "face host controller failed to start", it)
        }
    }

    /**
     * v1.0.22 — install-prompt trampoline. OtaInstallReceiver forwards
     * STATUS_PENDING_USER_ACTION's EXTRA_INTENT here because Android 11+
     * Background Activity Launch on Goodview ROMs silently drops
     * BroadcastReceiver-issued startActivity calls. MainActivity is a
     * foregrounded user-visible Activity (singleTask launchMode ensures
     * a single instance), satisfying BAL for the system Install dialog.
     */
    override fun onNewIntent(newIntent: Intent?) {
        super.onNewIntent(newIntent)
        handleInstallPromptTrampoline(newIntent)
        handleDeviceAdminEnrollIntent(newIntent)
        handleOpenSetupIntent(newIntent)
    }

    /**
     * ── FIELD-OPS SETUP RE-ENTRY (2026-08-25) ───────────────────────
     *
     * A tech at the box, or the provisioning script, re-opens the setup
     * checklist on a partly-granted screen with one line and no APK
     * change:
     *
     * ```
     * adb shell am start -n com.educms.player/com.educms.player.MainActivity \
     *     -a com.educms.player.OPEN_SETUP
     * # debug builds carry applicationIdSuffix ".debug":
     * adb shell am start -n com.educms.player.debug/com.educms.player.MainActivity \
     *     -a com.educms.player.OPEN_SETUP
     * ```
     *
     * Same shape, and the same reasoning, as
     * [handleDeviceAdminEnrollIntent] above: explicit component only, NO
     * `<intent-filter>`, so this adds no implicit surface any app on the
     * box could resolve. The worst an external caller achieves is a setup
     * list the operator can dismiss with Back — and it still refuses to
     * appear over an emergency hold or inside a locked task.
     *
     * It only sets a flag; the checklist itself is raised from onResume.
     * onCreate runs this BEFORE `setContentView`, and `setContentView`
     * clears the content frame the checklist attaches to — building it
     * here would put a view on screen and then wipe it.
     */
    @Volatile
    private var pendingOpenSetup = false

    private fun handleOpenSetupIntent(launchIntent: Intent?) {
        if (launchIntent?.action != ACTION_OPEN_SETUP) return
        // Consume it, so a singleTask relaunch of a retained intent
        // cannot re-open setup on every future resume.
        launchIntent.action = Intent.ACTION_MAIN
        pendingOpenSetup = true
        PlayerLogger.i("SetupCeremony", "setup checklist requested by intent")
    }

    // ─── 2026-08-25 (v1.1.6): CABLE-FREE SETUP RE-ENTRY ─────────────
    //
    // Operator, first install on v1.1.5: *"it popped up with the config
    // page but after you do the first 4 requirements it just launched so i
    // didnt get to even do the optional ones at all and HAVE NO WAY TO
    // KNOW HOW TO PULL THOSE UP AGAIN"*.
    //
    // v1.1.5's only re-entry was the adb action above — worth nothing to
    // somebody at a wall-mounted panel. Two routes replace it, and both
    // land here:
    //
    //   1. THE PRIMARY, from the dashboard: `POST /screens/:id/
    //      display-control` with `action:'OPEN_SETUP'` → signed WS frame →
    //      the web player calls `openSetupChecklist` on the bridge. The
    //      operator taps in the dashboard, walks to the panel, and the
    //      list is already up.
    //   2. THE BACKUP, at the glass: hold the TOP-LEFT corner for 6 s.
    //      For the panel whose network is not up yet — which is exactly
    //      the panel most likely to still need its grants.

    /**
     * Raise the checklist, from wherever the request came from.
     *
     * Applies the SAME manager-install gate `onResume` applies, because
     * the reason is the same one: until Manager is installed, the
     * manager-install gate owns the screen and runs its own permission
     * flow, and two drivers on one screen is the stacking the checklist
     * replaced. Every refusal says so in the log with its source, so a
     * dashboard tap that appears to do nothing is answerable from the
     * panel's own diagnostics instead of a site visit.
     */
    private fun openSetupChecklistNow(source: String) {
        runOnUiThread {
            runCatching {
                if (isFinishing || isDestroyed) return@runCatching
                if (readManagerVersion() == null) {
                    PlayerLogger.i(
                        "SetupCeremony",
                        "open ($source) ignored — the manager-install gate owns the screen",
                    )
                    return@runCatching
                }
                PlayerLogger.i("SetupCeremony", "setup checklist requested by $source")
                // A finger still resting on the corner must not re-fire the
                // hold the moment the list is dismissed.
                setupCornerHold.cancel()
                com.educms.player.setup.SetupCeremony.open(this, ::applyRemoteFocus)
            }.onFailure {
                PlayerLogger.w("SetupCeremony", "open ($source) threw: ${it.message}")
            }
        }
    }

    /**
     * The corner-hold timer. Android delivers NO touch events while a
     * finger is stationary, so "still down 6 seconds later" cannot be
     * answered from the event stream — it needs a timer that the touch
     * stream arms and cancels. The RULES live in
     * [com.educms.player.setup.SetupCornerGesture] (pure, unit-tested);
     * this is only the clock.
     */
    private inner class SetupCornerHold {
        private val handler = android.os.Handler(android.os.Looper.getMainLooper())
        private val fire = Runnable {
            if (gesture?.isArmed == true) {
                openSetupChecklistNow("corner hold")
            }
        }

        /** Built lazily — `resources.displayMetrics` needs a Context. */
        private var gesture: com.educms.player.setup.SetupCornerGesture? = null

        private fun ensure(): com.educms.player.setup.SetupCornerGesture =
            gesture ?: com.educms.player.setup.SetupCornerGesture(
                cornerPx = com.educms.player.setup.SetupCornerGesture
                    .cornerPxFor(resources.displayMetrics.density),
                slopPx = com.educms.player.setup.SetupCornerGesture
                    .slopPxFor(resources.displayMetrics.density),
            ).also { gesture = it }

        fun onTouch(event: MotionEvent) {
            when (
                ensure().onTouch(
                    event.actionMasked,
                    event.x,
                    event.y,
                    event.pointerCount,
                )
            ) {
                com.educms.player.setup.SetupCornerGesture.Decision.ARM -> {
                    handler.removeCallbacks(fire)
                    handler.postDelayed(
                        fire,
                        com.educms.player.setup.SetupCornerGesture.HOLD_MS,
                    )
                }
                com.educms.player.setup.SetupCornerGesture.Decision.DISARM ->
                    handler.removeCallbacks(fire)
                com.educms.player.setup.SetupCornerGesture.Decision.NONE -> Unit
            }
        }

        fun cancel() {
            handler.removeCallbacks(fire)
            gesture?.reset()
        }
    }

    private val setupCornerHold = SetupCornerHold()

    /**
     * ⚠️ OBSERVE, NEVER CONSUME. The event is handed to `super` unchanged
     * on every path, so an interactive board sees byte-identical touch
     * input whether or not the corner gesture is running. A `return true`
     * anywhere in here would silently break touch content on every panel
     * in the fleet.
     */
    override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
        if (event != null) {
            runCatching { setupCornerHold.onTouch(event) }
                .onFailure { PlayerLogger.w("SetupCeremony", "corner gesture threw: ${it.message}") }
        }
        return super.dispatchTouchEvent(event)
    }

    /**
     * ── FIELD-OPS ENROLMENT TRIGGER (2026-08-14) ────────────────────
     *
     * A tech at the box, or the provisioning script, can raise the
     * device-admin prompt with one line and no APK change:
     *
     * ```
     * adb shell am start -n com.educms.player/com.educms.player.MainActivity \
     *     -a com.educms.player.ENROLL_DISPLAY_ADMIN
     * # debug builds carry applicationIdSuffix ".debug":
     * adb shell am start -n com.educms.player.debug/com.educms.player.MainActivity \
     *     -a com.educms.player.ENROLL_DISPLAY_ADMIN
     * ```
     *
     * (The CLASS is always `com.educms.player.MainActivity` — only the
     * package half of the component takes the suffix, which is why the
     * `/.MainActivity` shorthand is wrong on a debug kiosk.)
     *
     * NOTE the explicit `-n`. This action deliberately has NO
     * `<intent-filter>`: MainActivity is already exported (it carries
     * LAUNCHER), so an explicit component start works, and adding a
     * filter would create a new IMPLICIT surface any app on the box
     * could resolve. Exposure is therefore identical to today's
     * `OPEN_PLAYER` action, and the worst an external caller achieves is
     * a system dialog the operator must actively approve — rate-limited
     * by [DeviceAdminEnrollmentMath]'s debounce and decline cooldown.
     *
     * Not presence-gated, unlike the bridge path: whoever can send this
     * either has a shell on the device (in which case
     * `adb shell dpm set-active-admin …` is strictly easier and this
     * grants nothing new) or is already an app on the box.
     */
    private fun handleDeviceAdminEnrollIntent(launchIntent: Intent?) {
        if (launchIntent?.action != ACTION_ENROLL_DISPLAY_ADMIN) return
        // Consume it, so a singleTask relaunch of a retained intent
        // cannot re-prompt on every future resume.
        launchIntent.action = Intent.ACTION_MAIN
        PlayerLogger.i("DisplayControl", "device-admin enrolment requested by intent")
        val result = com.educms.player.display.DeviceAdminEnrollment.requestEnrollment(
            this,
            com.educms.player.display.DeviceAdminEnrollment.SOURCE_INTENT,
        )
        PlayerLogger.i("DisplayControl", "enrolment intent result: $result")
    }

    /**
     * The enrolment entry point the WEB layer calls, via
     * `WebAppBridge.displayEnrollAdmin()`.
     *
     * ⚠️ TWO GATES, and both are product requirements rather than
     * defence-in-depth theatre:
     *
     *  1. **A foreground Activity.** `ACTION_ADD_DEVICE_ADMIN` needs one,
     *     and requiring it is what keeps enrolment off every background
     *     path.
     *  2. **Recent physical presence.** The legacy
     *     `addJavascriptInterface` surface is materialised in EVERY frame
     *     the WebView loads, including operator-authored EXTERNAL_HTML
     *     board iframes (see WebAppBridge's header). Enrolment is not a
     *     recovery-direction action, so it does not belong in the
     *     untrusted subset — but the honest gate here is not "which
     *     transport" (on a Chromium 83-87 Taurus there IS only the
     *     untrusted one), it is "is a human standing at this panel".
     *     They must be: they have to tap Activate on the system dialog.
     *     No touch in [LOCAL_INPUT_WINDOW_MS] ⇒ the dialog would sit
     *     unattended over the content on a wall. Refused.
     *
     * Everything runs on the UI thread; the bridge call can arrive on
     * the JavaBridge thread or the channel worker.
     */
    private fun requestDeviceAdminEnrollment(): String {
        val sinceInput = android.os.SystemClock.elapsedRealtime() - lastLocalInputAtMs
        if (lastLocalInputAtMs == 0L || sinceInput > LOCAL_INPUT_WINDOW_MS) {
            PlayerLogger.w(
                "DisplayControl",
                "REFUSED device-admin enrolment — no local input in the last " +
                    "${LOCAL_INPUT_WINDOW_MS / 1000}s, so nobody is at the screen to approve the dialog",
            )
            return """{"ok":false,"code":"no-operator-present",""" +
                """"message":"tap the screen first — this setup ends in a dialog somebody has to approve"}"""
        }
        // startActivity must run on the UI thread; the bridge does not.
        // Hand off and answer immediately with what we know — the real
        // outcome is settled in onResume, and the dashboard/probe reads
        // it from `admin.enrollment.state`.
        val latch = java.util.concurrent.CountDownLatch(1)
        val holder = arrayOfNulls<String>(1)
        runOnUiThread {
            holder[0] = try {
                com.educms.player.display.DeviceAdminEnrollment.requestEnrollment(
                    this,
                    com.educms.player.display.DeviceAdminEnrollment.SOURCE_BRIDGE,
                )
            } catch (t: Throwable) {
                PlayerLogger.w("DisplayControl", "enrolment request threw: ${t.message}")
                """{"ok":false,"code":"exception"}"""
            }
            latch.countDown()
        }
        // Bounded: the UI thread of a kiosk that must never jank should
        // clear this instantly. A timeout is not a failure of the
        // enrolment, only of our ability to report it synchronously.
        return if (latch.await(3, java.util.concurrent.TimeUnit.SECONDS)) {
            holder[0] ?: """{"ok":false,"code":"exception"}"""
        } else {
            """{"ok":true,"state":"prompt-pending","detail":"dispatched"}"""
        }
    }

    private fun handleInstallPromptTrampoline(launchIntent: Intent?) {
        if (launchIntent?.action != com.educms.player.ota.OtaInstallReceiver.ACTION_LAUNCH_INSTALL_PROMPT) return
        // ⚠️ AND-006 (2026-08-01) — INTENT REDIRECTION. MainActivity is
        // exported (it is the launcher), so ANY app on the device could
        // send this action with its own Intent in the extras and we would
        // have called startActivity() on it — a classic confused-deputy
        // that lends our identity (and any URI grants riding on the
        // forwarded Intent) to the caller.
        //
        // We no longer read ANY caller-supplied Intent. OtaInstallReceiver
        // runs in THIS process (same package, no android:process) and
        // stages the system-minted confirm Intent in an in-process holder;
        // an external app cannot populate that. The extra it used to send
        // is deliberately ignored even if present.
        val staged = com.educms.player.ota.OtaInstallReceiver.peekPendingInstallPrompt()
        if (staged == null) {
            PlayerLogger.w(
                "MainActivity",
                "install-prompt trampoline fired with nothing staged in-process — ignoring (external caller?)",
            )
            return
        }
        // TC22 F4 — the staged prompt is no longer consumed by this read, so
        // spend the ACTION instead. Without this, a same-process Activity
        // re-creation would re-deliver the trampoline intent from
        // `getIntent()` and raise the confirmation again, outside the
        // re-issue budget that exists precisely to bound that.
        launchIntent.action = null
        raiseInstallPrompt(staged, "trampoline")
    }

    /**
     * 2026-09-01 (TC22 F1) — the ONE place a system install confirmation is
     * put on the glass, so there is exactly one place that records the fact.
     *
     * ⚠️ [MainActivity.noteInstallPromptRaised] MUST be called BEFORE
     * `startActivity`, not after: the confirmation Activity comes to the
     * front (and pauses us) synchronously enough that a relaunch actor
     * reading `isInForeground` on another thread can see "paused" before a
     * post-hoc write lands. Ordering it first makes the suppression fact
     * true for the entire window in which it matters.
     */
    private fun raiseInstallPrompt(
        staged: com.educms.player.ota.StagedInstallPrompt,
        source: String,
    ) {
        // Assignment (not addFlags) — this REPLACES every flag the system
        // intent carried, including any FLAG_GRANT_*_URI_PERMISSION.
        staged.intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        noteInstallPromptRaised(staged.targetPackage)
        // The package installer draws its confirmation centred in the
        // controller's frame buffer — off an LED poster's column entirely.
        // Announce it where the glass can show it (2026-09-02, 1.1.14);
        // no-op on every non-poster device.
        //
        // ⚠️ NO KEY COPY (1.1.15): a poster has no remote, only a USB mouse
        // whose pointer cannot leave the 320 px column. The banner carries a
        // clickable "Bring VenueOS back" instead, plus a 60 s self-return —
        // this is the ONE system dialog a ViPlex-provisioned poster still
        // meets, because the operator raises it by choosing to install.
        LedSystemPromptBanner.announce(
            this,
            "A software update is ready to install",
            "The Install button is on that page, off the LED.",
        )
        try {
            startActivity(staged.intent)
            PlayerLogger.i(
                "MainActivity",
                "install prompt launched from foreground (BAL bypass, source=$source, " +
                    "target=${staged.targetPackage ?: "unknown"}) — relaunch actors are held off " +
                    "while it is up",
            )
        } catch (e: Exception) {
            // The launch never happened, so nothing is on the glass to
            // protect. Clearing immediately keeps a failed raise from
            // suppressing a genuine relaunch for ten minutes.
            clearInstallPromptHold("prompt launch threw")
            PlayerLogger.e("MainActivity", "install prompt launch failed", e)
        }
    }

    /**
     * 2026-08-24 — the first-run permission prompts that lived here
     * (install-unknown-apps for Player, then for the Manager companion,
     * then the Home-app opt-in) MOVED to
     * `com.educms.player.setup.SetupCeremony`, which also adds the three
     * grants they never asked for: WRITE_SETTINGS (real brightness),
     * battery exemption, and device ADMIN (a true panel-off).
     *
     * They fired from onCreate side by side, so a first boot stacked
     * three dialogs at once; the ceremony drives them one at a time from
     * onResume, so it resumes itself after every Settings round-trip.
     * Their SharedPreferences keys are unchanged, so a screen already set
     * up never re-nags after this ships.
     *
     * 2026-08-25 — the ceremony's SHELL changed again (same six grants,
     * same intents, same order): instead of a dialog per grant it now
     * renders ONE persistent checklist over the WebView, so a Settings
     * round-trip always lands back in the same place with live status and
     * a progress count. Raised here from onResume; re-openable later via
     * [ACTION_OPEN_SETUP]; torn down in onDestroy.
     *
     * `applyRemoteFocus` below STAYS — the ceremony is handed it and
     * applies it to every focusable row and button on that checklist, so
     * there is still exactly one implementation of the kiosk remote-focus
     * treatment.
     */

    /**
     * Make a control reachable by the kiosk REMOTE. Taurus / OEM signage
     * ROMs strip the default focus-highlight drawable, so the operator
     * can't see — or reach — what's selected; the screen looks dead. This
     * gives a view a theme-independent focus highlight (translucent
     * fill).
     *
     * 2026-08-25 — takes a View rather than an AlertDialog now that the
     * setup ceremony renders a checklist instead of six dialogs. Still
     * the SINGLE implementation of the treatment: SetupCeremony is handed
     * a reference to it and applies it to every focusable row and button
     * it builds. If a future dialog needs it, pass each of its buttons.
     */
    private fun applyRemoteFocus(view: View) {
        view.isFocusable = true
        // ⚠️ FOCUSABLE IN TOUCH MODE TOO (2026-09-01, field report G65-B).
        // This was `false`, which is the correct default for an ordinary
        // touch app and wrong for every control this function is applied to.
        // These panels are TOUCH-CAPABLE and REMOTE-DRIVEN: the window sits
        // in touch mode until a D-pad key arrives, and in touch mode
        // `requestFocus()` on a view that is not focusableInTouchMode
        // returns FALSE and does nothing — silently. That is why the setup
        // card's parking and the manager gate's `surfaceGateRetry()` could
        // both call requestFocus() and still leave the operator with no
        // highlight and a dead OK key: "the remote control has no control
        // over that popup so it just sits there."
        //
        // The highlight treatment below is UNCHANGED — this only makes the
        // control reachable in the state the panel actually boots into.
        view.isFocusableInTouchMode = true
        view.setOnFocusChangeListener { v, hasFocus ->
            // Theme-independent highlight — does not rely on the
            // OEM ROM's (stripped) focus drawable.
            v.setBackgroundColor(if (hasFocus) 0x553B82F6.toInt() else 0)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
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
            userAgentString = "$userAgentString EduCmsPlayer/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})"
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(wv.settings, WebSettingsCompat.FORCE_DARK_AUTO)
        }

        // ── AND-002 / SEC-002 — ONE handler set, ONE transport ──────
        // Built once and handed to the origin-scoped `NativeBridgeChannel`
        // and — only on the devices that can take nothing else — the legacy
        // `addJavascriptInterface` surface, so the two can never drift
        // apart. Which of those a device gets is decided below; see
        // NativeBridgeChannel's header for the device-class split and what
        // must be true before the legacy path is deleted outright.
        val nonce = com.educms.player.security.BridgeNonce()
        bridgeNonce = nonce
        val webAppBridge = WebAppBridge(
                // AND-004 REVERTED (2026-08-03) — this call site briefly
                // ran through an on-device operator-PIN gate. It was the
                // WRONG LAYER and is now removed:
                //
                //  * The web player's unpair is THREE layers deep and runs
                //    SERVER-FIRST (apps/web/src/app/player/page.tsx ~:6497
                //    — `POST /api/v1/screens/unpair/:fp` at :6527, and only
                //    THEN the native `EduCmsNative.unpair()` at :6550). By
                //    the time this lambda runs the screen is already off
                //    the emergency channel server-side, so gating the
                //    native step bought zero security.
                //  * The gate failed CLOSED with no provisioning path in
                //    existence (see OperatorPinGate's header), which
                //    permanently disabled the operator's on-device escape
                //    hatch on every deployed screen.
                //
                // The real fix for "a student with a USB keyboard walks up
                // to the screen" is lock-task mode — see LockTaskController.
                onUnpair = { unpairAndRestart() },
                // C-P1-6 — the bridge reload must actually BUST CACHE.
                //
                // This was a bare `wv.reload()`, and nothing in the APK
                // ever called `clearCache` — with `cacheMode =
                // LOAD_DEFAULT` that re-serves the same bundle from the
                // HTTP cache. The web player's `hardCacheBustingReload`
                // PREFERS this native path precisely because it is
                // supposed to be the strong one on Taurus, so the
                // strongest-looking rung of the ladder was the weakest:
                // REFRESH_WEB, bundle-drift recovery and the operator's
                // own Sync button could all come back to the identical
                // stale document.
                //
                // Now: drop the cache, then re-run loadPlayer so the URL
                // is REBUILT (fresh device token, current display metrics,
                // current manager version) rather than replayed.
                //
                // Scope, stated honestly: `clearCache(false)` drops the
                // RAM cache (the `true` variant also wipes the disk cache
                // for EVERY origin this WebView has ever touched, which
                // would nuke the offline-content the player deliberately
                // keeps), and `loadPlayer` re-derives the URL rather than
                // replaying the last one. Neither reaches the SERVICE
                // WORKER, which owns the offline shell by design — a SW
                // update is the web half's job, not this bridge's.
                onReload = {
                    runOnUiThread {
                        runCatching { wv.clearCache(false) }
                        lifecycleScope.launch {
                            loadPlayer(resolveDeviceToken())
                        }
                    }
                },
                getDeviceInfo = { deviceInfoJson() },
                // READ-ONLY capability probe (2026-08-13). Answers "what
                // display/power/audio control does THIS box expose?" per
                // screen, with no adb and no vendor SDK. Pull-only — it is
                // deliberately NOT part of deviceInfoJson()/heartbeat, so
                // it can never thrash the manifest hot-cache.
                probeDisplayImpl = { DisplayCapabilityProbe.probeJson(applicationContext) },
                // `userInitiated` is TRUE only via the bridge's
                // `checkForUpdatesUserInitiated()` — the panel's own Update
                // button. It stamps `source:"user"` on the update-check,
                // which the server honours as operator authorization and
                // which bypasses the rollout/canary hold. Every relay path
                // (WS push, manifest poll) arrives here with false.
                onCheckForUpdates = { userInitiated ->
                    PlayerApp.fireOtaCheckNow(applicationContext, userInitiated)
                    // 2026-09-01 (TC22 F2, operator addendum): "from the
                    // dashboard, if the player is on the latest version but
                    // the manager is not, there is no way to push the
                    // updated manager." There wasn't: `fireOtaCheckNow`
                    // enqueues the PLAYER's OTA worker and broadcasts to
                    // the Manager, whose own self-update lane is blocked on
                    // this fleet (it needs an install-unknown-apps grant the
                    // setup ceremony never walks anyone through). The
                    // bundled companion inside THIS APK was only ever
                    // installed from a cold onCreate.
                    //
                    // Both trigger shapes are honoured — the panel's own
                    // Update button (userInitiated = true) and every relay
                    // path, which is how the dashboard's CHECK_FOR_UPDATES
                    // arrives (false). Declines cost one asset read and a
                    // log line; a hold is capped at one attempt per target
                    // version per process.
                    evaluateManagerUpgradeHold(
                        if (userInitiated) "update-check-user" else "update-check-push",
                    ) { /* nothing to do — content is already playing */ }
                },
                getRecentLogsImpl = {
                    PlayerLogger.i("MainActivity", "getRecentLogs requested via JS bridge")
                    PlayerLogger.readRecent()
                },
                uploadDiagnosticsImpl = {
                    val prefs = applicationContext.getSharedPreferences("edu_player", android.content.Context.MODE_PRIVATE)
                    val apiRoot = prefs.getString("api_root", null)
                    // C-INFO-1 — read `device_token`, the key that is
                    // actually WRITTEN (by the `setDeviceToken` bridge;
                    // see PREF_DEVICE_TOKEN). `device_jwt` has never had a
                    // writer anywhere in the APK, so this read returned
                    // null on every screen and every diagnostics upload
                    // the fleet has ever sent went up ANONYMOUS — the
                    // server could not attribute a log bundle to the
                    // screen that produced it.
                    val jwt = prefs.getString(PREF_DEVICE_TOKEN, null)
                    val fp = prefs.getString("device_fingerprint", null)
                    if (apiRoot.isNullOrBlank()) {
                        PlayerLogger.w("MainActivity", "uploadDiagnostics: api_root not set — cannot upload")
                        "error: api_root not configured"
                    } else if (!HostAllowlist.requireAllowed("uploadDiagnostics", apiRoot)) {
                        // AND-008 — the diagnostics bridge is callable from
                        // any frame and ships the device log (device ids,
                        // api roots, screen ids, truncated token hints) to
                        // whatever host `api_root` names. Re-check the
                        // destination at the point of USE so a value
                        // persisted by an older build can't exfiltrate.
                        "error: upload destination is not an allowed VenueOS host"
                    } else {
                        // Security: log only truncated token hint, never the full JWT.
                        PlayerLogger.i("MainActivity", "uploadDiagnostics triggered via JS bridge (jwt=${PlayerLogger.truncateSecret(jwt)})")
                        PlayerLogger.uploadRecent(apiRoot, jwt, fp)
                        "upload started — check server AuditLog"
                    }
                },
                onExitToDeviceHome = {
                    // Escape hatch back to the OEM launcher (Goodview/NovaStar/TCL).
                    // Customer feedback 2026-04-21: once the EduCMS app launches they
                    // had no way back to the OEM CMS to check network settings /
                    // reboot the screen. Calling `finishAffinity()` kills our entire
                    // task stack; Android then shows the device's HOME, which on an
                    // OEM signage box is the vendor's launcher.
                    //
                    // 2026-05-27 (operator-report): on EP6N units provisioned with
                    // the Manager companion as device owner (v1.0.64+ behavior —
                    // see AndroidManifest.xml comment on KioskHomeAlias), our
                    // KioskHomeAlias is enabled and pinned as the HOME activity via
                    // DevicePolicyManager.addPersistentPreferredActivity(). When we
                    // fire ACTION_MAIN + CATEGORY_HOME, Android resolves HOME to
                    // US, restarting MainActivity → "exit to launcher takes me
                    // back to the syncing purple screen". To actually leave the
                    // player, we MUST disable the alias BEFORE firing HOME so
                    // Android resolves HOME to the OEM launcher (the next-highest-
                    // priority HOME activity in the manifest table). PlayerApp's
                    // onCreate re-enables the alias on next launch — so once the
                    // operator manually relaunches our app from the OEM home, we
                    // resume kiosk-home duties without a config trip.
                    //
                    // AND-004 REVERTED (2026-08-03) — this was briefly
                    // wrapped in an on-device operator-PIN gate that failed
                    // CLOSED with no provisioning path, which permanently
                    // disabled this escape hatch on every deployed screen.
                    // See the note on `onUnpair` above and LockTaskController
                    // for the correct fix.
                    PlayerLogger.i("MainActivity", "Exit to device home requested via JS bridge")
                    exitToDeviceHomeNow("operator chose \"Exit to device home\"")
                },
                onSetBootstrap = { apiRoot, fingerprint ->
                    // v1.0.11 — write the prefs that HeartbeatService and
                    // OtaUpdateWorker read on every run. Up through
                    // v1.0.10 NOTHING wrote these keys, so both services
                    // silently no-op'd. This is the line that finally
                    // turns native heartbeat + OTA on in the field.
                    //
                    // We strip a trailing /api/v1 if the web player
                    // accidentally includes it — both services append
                    // /api/v1/... themselves, so a doubled prefix would
                    // produce a 404 with no log to read.
                    //
                    // ⚠️ AND-001 (2026-08-01) — THIS IS THE OTA TRUST
                    // ANCHOR. `apiRoot` arrives from JavaScript, and this
                    // bridge is reachable from every frame the player
                    // WebView loads (including operator-authored and
                    // third-party iframe content). Whatever lands in the
                    // `api_root` pref is where OtaUpdateWorker asks for an
                    // APK — and the APK signing key is committed to a
                    // PUBLIC repo, so an attacker-chosen OTA server is a
                    // silent, reboot- and OTA-surviving install of an
                    // attacker-signed build on a hallway display.
                    //
                    // The host is therefore pinned in NATIVE code, which
                    // JavaScript cannot reach. Rejected values are NOT
                    // persisted; OtaUpdateWorker re-checks at the point of
                    // use, and PlayerApp purges a stale hostile value at
                    // process start, so an older build's pref can't be
                    // honoured either.
                    val cleanApiRoot = apiRoot.trim()
                        .removeSuffix("/")
                        .removeSuffix("/api/v1")
                    val cleanFp = fingerprint.trim()
                    if (cleanApiRoot.isEmpty() || cleanFp.isEmpty()) {
                        PlayerLogger.w(
                            "MainActivity",
                            "setBootstrap rejected — empty values (apiRoot=${cleanApiRoot.length} fp=${cleanFp.length})"
                        )
                    } else if (!HostAllowlist.requireApiHost("setBootstrap", cleanApiRoot)) {
                        // C-P1-5 — judged against the narrow API set, not
                        // the broad first-party allowlist. The broad list
                        // necessarily contains the OTA release host
                        // `github.com`, which serves no API at all, so
                        // accepting it here let any frame persist an
                        // api_root that silently killed the health probe
                        // (recovery wedged forever), the native heartbeat
                        // (dashboard says OFFLINE), OTA and diagnostics —
                        // and survived reboot and OTA. See
                        // HostAllowlist.isApiHost.
                        //
                        // Refused: not an allowed API root (or not https).
                        // requireApiHost() already logged scheme+host.
                    } else if (!FINGERPRINT_RE.matches(cleanFp)) {
                        // AND-008 — the fingerprint is concatenated into
                        // the log-upload / ota-state URL paths. Keep it to
                        // path-safe characters so JS can't reshape those
                        // URLs from inside the allowlisted host.
                        PlayerLogger.w(
                            "MainActivity",
                            "setBootstrap rejected — fingerprint has an unexpected shape (len=${cleanFp.length})",
                        )
                    } else {
                        val prefs = applicationContext.getSharedPreferences(
                            "edu_player",
                            android.content.Context.MODE_PRIVATE,
                        )
                        val priorApi = prefs.getString("api_root", null)
                        val priorFp = prefs.getString("device_fingerprint", null)
                        prefs.edit()
                            .putString("api_root", cleanApiRoot)
                            .putString("device_fingerprint", cleanFp)
                            .apply()
                        if (priorApi != cleanApiRoot || priorFp != cleanFp) {
                            PlayerLogger.i(
                                "MainActivity",
                                "setBootstrap wrote prefs: apiRoot=$cleanApiRoot fp=${cleanFp.take(12)}…",
                            )
                        }
                    }
                },
                // 2026-08-25 (v1.1.5) — the device JWT, pushed to prefs for
                // the out-of-process OTA worker. See WebAppBridge's
                // `onSetDeviceToken` for the full trust argument; the short
                // version is that this is WRITE-ONLY (no getter exists on
                // any bridge surface) and every failure mode is fail-closed:
                // a bad token means an anonymous update-check, which is
                // exactly what the whole fleet does today.
                //
                // The shape check is the same posture as `FINGERPRINT_RE`
                // above — the value is concatenated into an Authorization
                // header, so it must not be able to carry a newline and
                // inject a second header. `HttpURLConnection` would throw on
                // that, which is safe but noisy; refusing it here keeps the
                // worker's log honest about WHY there is no token.
                onSetDeviceToken = { token ->
                    val clean = token.trim()
                    if (clean.isEmpty()) {
                        // An unpair legitimately clears it — drop the stored
                        // value rather than leaving a token for a screen this
                        // box is no longer paired to.
                        applicationContext
                            .getSharedPreferences("edu_player", android.content.Context.MODE_PRIVATE)
                            .edit().remove("device_token").apply()
                        PlayerLogger.i("MainActivity", "setDeviceToken cleared the stored device token")
                    } else if (!DEVICE_TOKEN_RE.matches(clean)) {
                        PlayerLogger.w(
                            "MainActivity",
                            "setDeviceToken rejected — not a bare JWT (len=${clean.length})",
                        )
                    } else {
                        val prefs = applicationContext.getSharedPreferences(
                            "edu_player",
                            android.content.Context.MODE_PRIVATE,
                        )
                        val prior = prefs.getString("device_token", null)
                        prefs.edit().putString("device_token", clean).apply()
                        if (prior != clean) {
                            PlayerLogger.i(
                                "MainActivity",
                                "setDeviceToken stored a device token (len=${clean.length}) — " +
                                    "OTA update-check is now device-authenticated",
                            )
                        }
                    }
                },
                onShowUrlOverlay = { url ->
                    runOnUiThread { showUrlOverlay(url) }
                },
                onHideUrlOverlay = {
                    runOnUiThread { hideUrlOverlay() }
                },
                // 2026-05-06 (v1.0.51) — operator: ".49 OTA upgrade
                // still doesn't fucking work, i set the manager to
                // that permission manually and it still doesnt work".
                //
                // The "Manager update blocked: Install unknown apps
                // permission is missing" comes from
                // ManagerSelfUpdateWorker — Manager updating ITSELF.
                // Manager has no MainActivity / no UI to prompt for
                // install permission, so it relies on this dashboard
                // bridge to deep-link the operator to Settings.
                //
                // Original bug: hardcoded `package:com.educms.manager`
                // sent users on debug builds (.debug applicationId
                // suffix) to a non-existent app entry. They toggled
                // a phantom; Manager.debug stayed without permission;
                // worker kept reporting "blocked".
                //
                // Fix: probe PackageManager for whichever Manager
                // variant is actually installed (production or debug)
                // and target THAT. If neither is installed, fall back
                // to production id so the Settings link still resolves
                // to a useful page.
                //
                // ALSO trigger an immediate OTA re-check after the
                // intent fires, so the operator doesn't have to wait
                // 6 hours for the periodic worker to retry. By the
                // time they finish toggling permission and Resume,
                // the worker has already re-run and the stale "blocked"
                // banner clears on its own.
                onOpenSettingsForManager = {
                    runOnUiThread {
                        val installedManagerPkg = listOf(
                            "com.educms.manager",
                            "com.educms.manager.debug",
                        ).firstOrNull { pkg ->
                            try { packageManager.getPackageInfo(pkg, 0); true }
                            catch (_: Exception) { false }
                        } ?: "com.educms.manager"
                        PlayerLogger.i(
                            "MainActivity",
                            "openSettingsForManager: deep-linking to ACTUAL installed Manager ($installedManagerPkg)",
                        )
                        try {
                            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                                .setData(Uri.parse("package:$installedManagerPkg"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            startActivity(intent)
                        } catch (e: Exception) {
                            PlayerLogger.w("MainActivity", "openSettingsForManager failed", e)
                            try {
                                startActivity(
                                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                        .setData(Uri.parse("package:$installedManagerPkg"))
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                )
                            } catch (_: Exception) { /* swallow */ }
                        }
                        // Also schedule a one-shot OTA re-check so the
                        // banner clears once the new permission state
                        // takes effect — operator doesn't have to
                        // hunt for "Sync now".
                        runCatching { PlayerApp.fireOtaCheckNow(applicationContext) }
                    }
                },
                // v1.0.58 — Web-side heartbeat handler. Web calls
                // window.EduCmsNative.heartbeat() every ~60s while
                // the page is alive. We treat it identically to a
                // fresh onPageFinishedOk for the watchdog freshness
                // check (line 87) — that keeps the 10-minute
                // force-reload from firing on long-running healthy
                // players. Without this, every kiosk visibly
                // disconnects + replays from item 0 every 10 minutes
                // because the watchdog only sees `lastSuccessfulLoadAtMs`
                // get set ONCE at boot, never refreshes during
                // continuous playback.
                onWebHeartbeat = {
                    val now = android.os.SystemClock.elapsedRealtime()
                    val first = lastSuccessfulLoadAtMs == 0L
                    lastSuccessfulLoadAtMs = now
                    if (first) {
                        PlayerLogger.i(
                            "MainActivity",
                            "Web heartbeat: first tick received — watchdog freshness reset",
                        )
                    }
                    // C-P1-3 — THE proof that our JavaScript actually ran,
                    // which no page-load callback can give (an error
                    // document and an abort both finish "cleanly"). This is
                    // what arms lock task; see webHeartbeatEverReceived.
                    if (!webHeartbeatEverReceived) {
                        webHeartbeatEverReceived = true
                        PlayerLogger.i(
                            "MainActivity",
                            "Web heartbeat: JS proven live — lock task may now engage",
                        )
                        // The bridge runs on a WebView JS thread;
                        // startLockTask() must be called from the main one.
                        runOnUiThread { maybeEngageLockTask("first web heartbeat") }
                    }
                },
                // 2026-08-30 (W2-4) — the content-aware half. The bridge
                // has ALREADY ticked onWebHeartbeat above by the time this
                // fires (heartbeatV2 calls both), so process liveness is
                // handled; all that is left is to feed the policy. `null`
                // means the page didn't say — recorded as unknown, which
                // neither refreshes nor disarms. See ContentWatchdogPolicy.
                onWebHeartbeatV2 = { syncOk ->
                    val now = android.os.SystemClock.elapsedRealtime()
                    // C-P0-1 — `syncOk` alone cannot tell "the credential
                    // is dead" from "the internet is out"; both fail the
                    // manifest fetch. Pairing it with the platform's own
                    // connectivity reading is what stops us reloading a
                    // screen that is playing cached content through an
                    // outage. See ContentWatchdogPolicy rules 5 + 6.
                    contentWatchdog.onV2Heartbeat(now, syncOk, isNetworkUp())
                },
                // 2026-09-02 (efficiency program P0-1) — the page tells us
                // whether its own once-a-minute telemetry POST is landing.
                // When it is, HeartbeatService drops from a 60 s status POST
                // to a 5-minute liveness floor instead of writing the same
                // `lastPingAt` column the page just wrote. Recorded in the
                // shared prefs the service already reads, because that
                // service runs in its own process and cannot see this one's
                // memory. Slowing down, never standing down: the native
                // floor is the only thing proving the ANDROID PROCESS is
                // alive if this page dies.
                onWebTelemetryReported = { telemetryOk ->
                    HeartbeatService.noteWebTelemetry(applicationContext, telemetryOk)
                },
                // 2026-05-24 — orientation lock. Web calls
                // window.EduCmsNative.setOrientation(value) when it
                // observes a new orientation in the manifest poll or
                // in a signed WS ORIENTATION_CHANGE message. Native
                // calls setRequestedOrientation on the UI thread and
                // persists the choice in SharedPreferences so a
                // cold-boot picks the same value before the manifest
                // poll lands.
                onSetOrientation = { raw ->
                    runOnUiThread { applyOrientation(raw) }
                },
                // 2026-08-25 (v1.1.6) — the DASHBOARD route back into
                // setup. The web player calls this after a signed
                // OPEN_SETUP frame clears its push gate; every refusal
                // (emergency hold, lock task, manager gate) is decided and
                // logged inside openSetupChecklistNow.
                onOpenSetupChecklist = { openSetupChecklistNow("dashboard") },
                // ── BOOT + REGISTRATION PROOF (2026-09-02, P0-2) ────────
                // The three facts an HTTP 200 + onPageFinished cannot give
                // us. Bridge callbacks arrive on the bridge worker thread;
                // the tracker is main-thread-only by contract, so each hop
                // is posted. `elapsedRealtime` throughout — a signage box
                // steps its wall clock on first NTP sync and a wall-clock
                // deadline would fire instantly or never.
                onBootProof = {
                    val now = android.os.SystemClock.elapsedRealtime()
                    runOnUiThread { com.educms.player.boot.BootDiagnostics.onClientBooted(now) }
                },
                onRegisterAttempt = {
                    val now = android.os.SystemClock.elapsedRealtime()
                    runOnUiThread { com.educms.player.boot.BootDiagnostics.onRegisterAttempt(now) }
                },
                onRegisterResult = { ok, cls, status, message ->
                    val now = android.os.SystemClock.elapsedRealtime()
                    runOnUiThread {
                        com.educms.player.boot.BootDiagnostics.onRegisterResult(
                            applicationContext, now, ok, cls, status, message,
                        )
                    }
                },
                // Sprint 13 Phase 2 — native CTS serial bridge for
                // Goodview ECBox3576 deployments. Single shared
                // SerialPortBridge instance per Activity (one tty per
                // box for v1; multi-port boxes can swap in a manager
                // class later). The bridge holds a weak reference to
                // the WebView so it can push bytes back to JS via
                // window.__ctsSerialBytes(base64).
                ctsSerial = com.educms.player.serial.SerialPortBridge(
                    getWebView = { wv },
                ),
                // 2026-08-13 — display CONTROL (volume / brightness /
                // blank / wake / reboot + the on-device on-off
                // schedule). Every argument is validated natively inside
                // DisplayControlApi; nothing here trusts the caller.
                //
                // These run on the caller's thread (JavaBridge for the
                // legacy surface, the channel's worker for the secure
                // one). That is correct: the provider stack is
                // Context-only and marshals to the UI thread itself via
                // DisplayWindowBridge, so a slow sysfs write never
                // blocks a frame on a kiosk that must not jank.
                displayCapabilitiesImpl = { DisplayControlApi.capabilitiesJson(applicationContext) },
                displayApplyImpl = { json, trusted ->
                    DisplayControlApi.applyJson(applicationContext, json, trusted)
                },
                displaySetScheduleImpl = { json, trusted ->
                    DisplayControlApi.setScheduleJson(applicationContext, json, trusted)
                },
                // ⚠️ LIFE SAFETY — the emergency interlock. See
                // com.educms.player.display.DisplayEmergency.
                // ⚠️ `faceIndex` (2026-09-16, double-sided displays) names WHICH
                // PANE reported. This lambda serves the PRIMARY's WebView, so
                // in practice it is 0 — but it is threaded through rather than
                // hard-coded, because the web bundle is the thing that knows
                // which document it is, and a hard-coded 0 here would credit a
                // face's hold to the primary and let the primary's later
                // all-clear release an alert it never raised.
                displayEmergencyHoldImpl = { active, trusted, faceIndex ->
                    DisplayControlApi.emergencyHoldJson(applicationContext, active, trusted, faceIndex)
                },
                // 2026-08-14 — one-tap device-ADMIN enrolment, the tier
                // that turns BLANK from "black overlay over a lit panel"
                // into a real lockNow() panel-off. Activity-scoped and
                // presence-gated inside requestDeviceAdminEnrollment();
                // read its KDoc before moving this anywhere.
                displayEnrollAdminImpl = { requestDeviceAdminEnrollment() },
                // DIAGNOSTIC ONLY. This used to gate the mutators off the
                // legacy transport, which inverted: it evaluated false on
                // exactly the pre-channel devices that needed the gate
                // most. The mutators now mark the legacy caller untrusted
                // unconditionally. See WebAppBridge.displayApply().
                secureChannelActive = { nativeChannelActive },
                // SEC-002 — the per-boot main-frame secret. Created
                // unconditionally and ARMED only if this device ends up on
                // the legacy every-frame path below; an unarmed nonce allows
                // everything, so channel-only devices are unaffected.
                bridgeNonce = nonce,
        )

        // ── THE TRANSPORT DECISION (SEC-002, 2026-09-04) ──────
        //
        // This used to be "attach BOTH, unconditionally". The legacy
        // `addJavascriptInterface` object has no origin scoping — the
        // WebView materialises it in EVERY frame, sandbox flags and opaque
        // origins included — so every operator-authored EXTERNAL_HTML board
        // and every third-party page a WEBPAGE widget iframed through
        // `/api/v1/proxy/web` held `window.EduCmsNative` and could unpair
        // the screen, exit the kiosk, repoint the OTA root or read the
        // device log. That is SEC-002.
        //
        // ⚠️ ORDER MATTERS: the channel is attached FIRST, because whether
        // we may skip the legacy object depends on whether it came up.
        // Materialises `window.EduCmsNativeChannel` ONLY in a main frame
        // whose origin is exactly BuildConfig.PLAYER_BASE_URL's; returns
        // false (and logs DEGRADED) on a pre-M77 WebView.
        nativeChannelActive = NativeBridgeChannel.attach(wv, webAppBridge)

        // PATH A — channel + an origin-scoped document-start shim that
        // republishes the `EduCmsNative` NAME for any stale cached web
        // bundle. Untrusted frames match neither origin rule, so they get
        // no native object at all. `addJavascriptInterface` is never
        // called on these devices.
        val compatShim = nativeChannelActive && NativeBridgeChannel.attachLegacyCompatShim(wv)

        // PATH B — the every-frame object, for the WebViews that can take
        // neither the channel nor a document-start script (Chromium 83/87
        // NovaStar Taurus posters). Keeping it is not a preference: it is
        // the ONLY transport those panels have, and deleting it would leave
        // a wall-mounted LED poster with no bridge and no way to be told
        // about an emergency hold. The control-plane methods on it are
        // nonce-gated instead — see BridgeNonce for what that buys and
        // what it does not.
        legacyBridgeInjected = !compatShim
        if (legacyBridgeInjected) {
            wv.addJavascriptInterface(webAppBridge, "EduCmsNative")
            // Deliver the nonce to the MAIN FRAME ONLY. Document-start when
            // the WebView supports it (origin-scoped, before any frame
            // script); otherwise evaluateJavascript per navigation, which
            // targets the top frame by construction — wired into the
            // WebViewClient below. Enforcement arms on delivery and only on
            // delivery: a failure here degrades to exactly the pre-SEC-002
            // behaviour, loudly, rather than locking the page out of its
            // own bridge.
            val viaDocStart = NativeBridgeChannel.injectBridgeNonceAtDocumentStart(wv, nonce.value()) {
                nonce.arm()
            }
            bridgeNonceNeedsEval = !viaDocStart
            PlayerLogger.w(
                "Player",
                "SEC-002 — legacy every-frame bridge ATTACHED on this device (channel=" +
                    nativeChannelActive + ", nonceDelivery=" +
                    (if (viaDocStart) "document-start" else "top-frame-eval") + ")",
            )
        } else {
            PlayerLogger.i(
                "Player",
                "SEC-002 — no addJavascriptInterface on this device; " +
                    "EduCmsNative is the origin-scoped compat shim over the channel",
            )
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("PlayerWeb", "${cm.messageLevel()}: ${cm.message()} @${cm.sourceId()}:${cm.lineNumber()}")
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }
        }

        val client = SafePlayerWebViewClient(
            onRendererGone = {
                Log.w("Player", "WebView renderer crashed — handing to recovery")
                // C-P2-9 — ONE actor drives the reload.
                //
                // This used to kick the recovery loop AND fire its own
                // loadPlayer, so a renderer crash queued TWO navigations:
                // ours immediately, and the recovery loop's the moment its
                // first /health probe came back (typically ~3 s later,
                // straight through the first one). The recovery loop is
                // the better actor — it waits for the server to actually
                // be up, and it shows the operator the "Reconnecting…"
                // overlay meanwhile instead of a black screen — so it owns
                // the reload and we do not race it.
                //
                // The direct load survives ONLY as the no-recovery
                // fallback: if the controller was never constructed there
                // is no other actor, and doing nothing would leave a dead
                // renderer on the wall forever.
                playerWebViewClient?.markNextFinishAborted()
                if (::recovery.isInitialized) {
                    recovery.onError("Renderer crashed")
                } else {
                    lifecycleScope.launch {
                        loadPlayer(resolveDeviceToken())
                    }
                }
            },
            onMainFrameError = { label ->
                if (::recovery.isInitialized) recovery.onError(label)
            },
            // SEC-002 — re-deliver the bridge nonce into the top frame on
            // the WebViews that cannot take a document-start script. Only
            // reached on the legacy path (`bridgeNonceNeedsEval`), so a
            // channel-only device never evaluates anything here.
            //
            // Since the re-audit made the gate DEFAULT-DENY, a dropped
            // injection costs the MAIN frame its control plane rather than
            // opening the surface to everyone, so this is a bounded retry
            // rather than a single shot. See [bridgeNonceRetriesLeft].
            onMainFrameDocument = { view, _ -> pumpBridgeNonceDelivery(view) },
            onPageFinishedOk = {
                lastSuccessfulLoadAtMs = android.os.SystemClock.elapsedRealtime()
                if (::recovery.isInitialized) recovery.onPageLoaded()
                watchdogConsecutiveFailures = 0
                // C-P1-3 — a finish is no longer sufficient to PIN the
                // kiosk. `onPageFinishedOk` can still be reached by a
                // document that painted nothing useful, and pinning such a
                // screen hides the operator's only on-screen way out. A
                // web heartbeat proves our JS ran, so the pin waits for
                // one — see [webHeartbeatEverReceived]. The first
                // heartbeat calls maybeEngageLockTask itself, so a healthy
                // boot still pins within ~60 s of first paint.
                if (webHeartbeatEverReceived) {
                    maybeEngageLockTask("page loaded")
                } else {
                    PlayerLogger.d(
                        "MainActivity",
                        "Page finished but no web heartbeat yet — deferring lock task",
                    )
                }
            },
        )
        playerWebViewClient = client
        wv.webViewClient = client
    }

    /**
     * SEC-002 (re-audit, 2026-09-04) — deliver the bridge nonce into the top
     * frame, and keep trying on a bounded schedule until it lands.
     *
     * Called from every main-frame document callback
     * (`onPageStarted` / `onPageCommitVisible` / `onPageFinished` — see
     * [SafePlayerWebViewClient.onMainFrameDocument]). Each call RESETS the
     * budget, because each one means a fresh document that has not been
     * handed the value yet.
     *
     * NO-OPS unless this device took the legacy every-frame path AND has no
     * document-start injection: on PATH A there is no `addJavascriptInterface`
     * object to gate, and where the document-start script installed the value
     * it is already in every player document before any frame script runs.
     *
     * Idempotent and self-cancelling: `arm()` flips a latch, so a duplicate
     * delivery is free, and the pump stops the moment [BridgeNonce.armed] is
     * true — or when the budget runs out, which leaves the screen in the
     * honest degraded state (content + emergency intact, control plane shut)
     * rather than spinning a timer forever on a panel whose WebView will
     * never run our JS.
     */
    private fun pumpBridgeNonceDelivery(view: WebView) {
        val n = bridgeNonce ?: return
        if (!bridgeNonceNeedsEval) return
        bridgeNonceRetry?.let { view.removeCallbacks(it) }
        bridgeNonceRetry = null
        bridgeNonceRetriesLeft = BRIDGE_NONCE_RETRY_MAX
        deliverBridgeNonceOnce(view, n)
    }

    /** One attempt, plus the re-arm. See [pumpBridgeNonceDelivery]. */
    private fun deliverBridgeNonceOnce(view: WebView, n: com.educms.player.security.BridgeNonce) {
        if (n.armed()) return
        NativeBridgeChannel.injectBridgeNonceIntoTopFrame(view, n.value()) { n.arm() }
        if (n.armed() || bridgeNonceRetriesLeft <= 0) {
            if (!n.armed()) {
                PlayerLogger.w(
                    "Player",
                    "SEC-002 — bridge nonce still UNDELIVERED after $BRIDGE_NONCE_RETRY_MAX attempts. " +
                        "This screen keeps playing content and still takes an emergency hold; its " +
                        "control-plane bridge methods (unpair/setBootstrap/logs/…) stay refused " +
                        "until a delivery lands. Reported as bridgeNonceArmed=false in deviceInfo.",
                )
            }
            bridgeNonceRetry = null
            return
        }
        bridgeNonceRetriesLeft -= 1
        val again = Runnable { deliverBridgeNonceOnce(view, n) }
        bridgeNonceRetry = again
        view.postDelayed(again, BRIDGE_NONCE_RETRY_MS)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureUrlOverlay(wv: WebView) {
        wv.visibility = View.GONE
        // 2026-05-20 — D-pad navigation needs the overlay WebView to hold
        // Android view focus, otherwise super.onKeyDown routes remote keys
        // to whatever else has focus (the main player WebView) and the
        // overlay's DOM — where the SpatialNavigation shim listens — never
        // sees them. WebViews default to focusable, but we set it
        // explicitly + grab focus in showUrlOverlay() so it's deterministic.
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
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
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString EduCmsUrlOverlay/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})"
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(wv.settings, WebSettingsCompat.FORCE_DARK_OFF)
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("UrlOverlayWeb", "${cm.messageLevel()}: ${cm.message()} @${cm.sourceId()}:${cm.lineNumber()}")
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }
        }

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                PlayerLogger.i("MainActivity", "URL overlay page started: ${url ?: "(unknown)"}")
                super.onPageStarted(view, url, favicon)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                PlayerLogger.i("MainActivity", "URL overlay page finished: ${url ?: "(unknown)"}")
                super.onPageFinished(view, url)
                // 2026-05-07 — D-pad spatial navigation. Operator: "Goodview's
                // player tabs around websites with the remote, ours doesn't."
                // Android System WebView ignores the chromium
                // --enable-spatial-navigation flag, so we inject a JS shim
                // here that listens for arrow / Enter / Back keys and moves
                // focus geometrically among visible focusable elements.
                //
                // Targeted ONLY at this URL overlay (third-party customer
                // content). The main `webView` runs the trusted EduCMS
                // dashboard which already has its own keyboard nav and
                // visible focus rings managed by the React app.
                view?.let { SpatialNavigation.inject(it) }
            }
        }
    }

    private fun showUrlOverlay(url: String) {
        val cleanUrl = url.trim()
        if (cleanUrl.isBlank()) {
            hideUrlOverlay()
            return
        }
        // AND-005 defence-in-depth — WebAppBridge already validated, but
        // this is the only place that actually calls loadUrl() on the
        // overlay WebView, so re-assert https + a real host here. Any
        // future caller inherits the check for free.
        if (!HostAllowlist.isSafeWebUrl(cleanUrl)) {
            PlayerLogger.w(
                "MainActivity",
                "showUrlOverlay REFUSED — not a plain https URL: ${HostAllowlist.describe(cleanUrl)}",
            )
            return
        }
        if (urlOverlayCurrentUrl == cleanUrl && urlOverlayView.visibility == View.VISIBLE) {
            return
        }
        urlOverlayCurrentUrl = cleanUrl
        PlayerLogger.i("MainActivity", "Showing URL overlay: $cleanUrl")
        urlOverlayView.loadUrl(cleanUrl)
        urlOverlayView.visibility = View.VISIBLE
        urlOverlayView.bringToFront()
        // Grab view focus so D-pad / remote keys route into THIS WebView
        // (and thus its DOM, where the SpatialNavigation shim listens).
        // bringToFront() only changes z-order, not focus — without this
        // the main player WebView keeps focus and the remote can't drive
        // the URL page. (2026-05-20)
        urlOverlayView.requestFocus()
        binding.managerGateOverlay.bringToFront()
        // 2026-05-19 (v1.0.71) — was: binding.recoveryOverlay.bringToFront()
        // Removed. Intent was to keep the recovery overlay on top of the
        // URL iframe, but Taurus's WebView hardware-accel layer punches
        // through Android view z-order — the iframe ends up on top
        // anyway, and the recovery text leaks faintly through behind it
        // (operator caught this on M43). Recovery is about player
        // health; while a URL is showing the operator wants the URL,
        // not "Reconnecting…" copy fighting for pixels. Force-hide the
        // recovery overlay; the recovery loop keeps running silently
        // and we re-show the overlay in hideUrlOverlay() if it's still
        // active when the URL is dismissed.
        if (binding.recoveryOverlay.visibility == View.VISIBLE) {
            PlayerLogger.i("MainActivity", "Suppressing recovery overlay — URL is now in front")
        }
        binding.recoveryOverlay.visibility = View.GONE
    }

    private fun hideUrlOverlay() {
        if (urlOverlayView.visibility != View.VISIBLE && urlOverlayCurrentUrl == null) return
        PlayerLogger.i("MainActivity", "Hiding URL overlay")
        urlOverlayCurrentUrl = null
        urlOverlayView.visibility = View.GONE
        urlOverlayView.loadUrl("about:blank")
        // 2026-05-19 (v1.0.71) — if the recovery loop is still running
        // (the main player webview is in an error state), re-show the
        // overlay now that the URL is out of the way. Without this the
        // operator would see a black screen (URL gone, main webview
        // still broken) for up to 60s until the next recovery tick
        // calls onShowOverlay again.
        if (::recovery.isInitialized && recovery.isActive()) {
            PlayerLogger.i("MainActivity", "Recovery still active — re-showing overlay after URL dismissed")
            binding.recoveryOverlay.visibility = View.VISIBLE
        }
    }

    /**
     * The ONE way any native reload path gets a device token.
     * (2026-08-30 player reliability program, W2-1.)
     *
     * Every `loadPlayer(...)` caller used to read the legacy DataStore
     * directly and append whatever it found as `?token=`. Nothing had
     * written that store since PairingActivity was deleted, so what it
     * held was always an OLD credential — and re-injecting it on every
     * boot, watchdog reload and renderer-crash reload downgraded a web
     * player that had already rotated to a newer token.
     *
     * The decision table is [resolveNativeToken]; this method is only the
     * IO bridging around it. The legacy clear is recorded as intent by the
     * pure function and awaited here, so a migrated screen never reaches
     * `loadPlayer` with the legacy row still on disk.
     *
     * Every store access is wrapped — a token read must never be able to
     * throw on the path that puts content on a hallway screen. A failure
     * degrades to "no native token", which is the fresh-install case the
     * web player's own register/pair flow already handles.
     */
    private suspend fun resolveDeviceToken(): String {
        val prefs = runCatching {
            applicationContext.getSharedPreferences(
                PREFS_NAME, android.content.Context.MODE_PRIVATE,
            )
        }.getOrNull()
        val legacy = runCatching { deviceStore.deviceToken.first() }.getOrNull()

        var migrated = false
        val token = resolveNativeToken(
            getPrefsToken = { runCatching { prefs?.getString(PREF_DEVICE_TOKEN, null) }.getOrNull() },
            getLegacyToken = { legacy },
            writePrefsToken = { value ->
                runCatching { prefs?.edit()?.putString(PREF_DEVICE_TOKEN, value)?.apply() }
            },
            clearLegacyToken = { migrated = true },
        )

        if (migrated) {
            // Suspend work can't run inside the pure function's lambda, so
            // it flagged intent and we finish the job here — before the
            // caller navigates.
            runCatching { deviceStore.clearToken() }
                .onFailure { PlayerLogger.w("MainActivity", "legacy token clear failed: ${it.message}") }
            PlayerLogger.i(
                "MainActivity",
                "Device token migrated out of the legacy DataStore into edu_player/device_token " +
                    "— the stale-credential reload loop is closed on this screen",
            )
        }
        return token.orEmpty()
    }

    private fun loadPlayer(token: String) {
        // C-P0-2 — stamp the START of this navigation before anything can
        // fail, so the watchdog's grace window covers the whole attempt
        // (URL construction, display-metric probes and all). See
        // [lastLoadStartedAtMs] and LOAD_GRACE_MS.
        lastLoadStartedAtMs = android.os.SystemClock.elapsedRealtime()
        // 2026-09-02 (P0-2) — the SAME instant re-arms the boot watchdog.
        // Every deadline it enforces (client JS, register attempt, register
        // result) is measured from a navigation START, so this must be the
        // one stamp both watchdogs share; a second, later stamp would let a
        // reload quietly buy the page another 30 s of silence.
        com.educms.player.boot.BootDiagnostics.onLoadStarted(lastLoadStartedAtMs)
        startBootWatchdog()

        val base = BuildConfig.PLAYER_BASE_URL.trimEnd('/')

        // Detect NATIVE display resolution. window.screen.width inside
        // the WebView returns DPI-adjusted CSS pixels (e.g. 1920 becomes
        // 640 at 3x density) which makes every template render at 1/3
        // fidelity on a 4K LED wall. Reading DisplayMetrics + the real
        // display size gives us true physical pixels; we pass them as
        // URL params so the player sizes scenes to actual hardware.
        val (wPx, hPx) = getRealDisplaySize()
        val density = resources.displayMetrics.density

        // Stable device fingerprint that survives app reinstalls.
        // Settings.Secure.ANDROID_ID persists across an uninstall +
        // reinstall cycle (only factory reset rotates it on Android 8+).
        // Without this the web player generates a random UUID in
        // localStorage — which gets wiped on reinstall → device looks
        // brand new → admin has to re-pair every time. Passing the
        // Android ID via ?fp= lets the web player use the same
        // fingerprint across reinstalls so the paired screen comes
        // back online automatically.
        val androidId = try {
            android.provider.Settings.Secure.getString(
                contentResolver, android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }

        // v1.0.13 — also report Manager APK version when installed,
        // so dashboard can show both Player + Manager versions per
        // kiosk via the existing /screens/status heartbeat.
        val managerVersion = readManagerVersion()
        val builder = Uri.parse(base).buildUpon()
            .appendQueryParameter("client", "android")
            .appendQueryParameter("v", BuildConfig.VERSION_NAME)
            .appendQueryParameter("vc", BuildConfig.VERSION_CODE.toString())
            .appendQueryParameter("w", wPx.toString())
            .appendQueryParameter("h", hPx.toString())
            .appendQueryParameter("dpr", density.toString())
        // 2026-04-28 — always send mv= explicitly so the server can
        // distinguish "Manager just got uninstalled" (empty string)
        // from "Player too old to know about Manager" (param absent).
        // Without this, dashboard chip stayed at the last-known
        // Manager version forever after the operator uninstalled it.
        builder.appendQueryParameter("mv", managerVersion ?: "")
        if (androidId.isNotBlank()) {
            // Prefix so the web player can tell an APK-provided fp from a
            // browser-generated one in logs / device cards.
            builder.appendQueryParameter("fp", "android-$androidId")
        }
        // Pass token only if we already have one (legacy paired device).
        // For a fresh install the web player's /screens/register flow
        // takes over, shows a pairing code on screen, polls for pairing,
        // and writes the device token into WebView localStorage.
        if (token.isNotBlank()) builder.appendQueryParameter("token", token)
        val url = builder.build().toString()
        Log.i("Player", "Loading $url  (native ${wPx}x${hPx} @ ${density}x)")

        // Tell the WebView to render at native resolution, not the
        // default CSS-pixel-scaled size. setInitialScale(100) disables
        // Android's auto-shrink; wide-viewport + overview mode makes
        // the 1920x1080 scene map to physical pixels on large displays.
        webView.setInitialScale(100)
        webView.loadUrl(url)
    }

    /**
     * Read the device's real display size in PHYSICAL pixels. On modern
     * Android 11+ we prefer WindowMetrics (includes navigation bars).
     * Falls back to Display.getRealSize() on older versions, and finally
     * DisplayMetrics.widthPixels for anything exotic.
     */
    private fun getRealDisplaySize(): Pair<Int, Int> {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val metrics = windowManager.maximumWindowMetrics
                val b = metrics.bounds
                Pair(b.width(), b.height())
            } else {
                @Suppress("DEPRECATION")
                val d = windowManager.defaultDisplay
                val size = android.graphics.Point()
                @Suppress("DEPRECATION") d.getRealSize(size)
                Pair(size.x, size.y)
            }
        } catch (_: Exception) {
            val dm = resources.displayMetrics
            Pair(dm.widthPixels, dm.heightPixels)
        }
    }

    private fun unpairAndRestart() {
        // Clear EVERY native token store so the web player re-registers
        // on next manifest call, then reload the WebView. The web player
        // itself handles the show-pairing-code UI — we don't bounce to a
        // separate native activity anymore (PairingActivity was removed;
        // it was getting pinned as the TV auto-launcher target on some
        // devices and stealing the boot flow).
        //
        // 2026-08-30 (W2-1) — BOTH stores, unconditionally. The canonical
        // `edu_player`/`device_token` used to be cleared only as a side
        // effect of the web player calling `setDeviceToken('')`, three
        // layers into its own unpair; if that call never landed (the page
        // was already broken — which is WHY somebody is unpairing) the
        // token survived and the next reload re-paired the screen to the
        // credential the operator just revoked. Clearing the legacy key
        // too means an unpaired token can never resurrect from either
        // store on the next boot.
        //
        // ⚠️ C-P2-10 (2026-08-30) — ORDER IS LOAD-BEARING: LEGACY FIRST.
        //
        // `resolveDeviceToken()` MIGRATES: prefs empty + legacy present ⇒
        // copy the legacy value into prefs. So with the old order (prefs
        // cleared first, DataStore second) a `resolveDeviceToken()` racing
        // between the two — the watchdog tick, the recovery loop's reload,
        // the manager-gate poller, any of which can be in flight while the
        // operator taps Unpair — saw exactly that shape and helpfully
        // migrated the revoked credential straight back into the prefs we
        // had just emptied. The screen re-paired itself to the token the
        // operator was revoking: W2-1's resurrection bug, re-entering
        // through the unpair path.
        //
        // Clearing the legacy store FIRST makes the race harmless in both
        // interleavings: a resolve that runs before this sees the old
        // (about-to-be-cleared) world, and one that runs after the legacy
        // clear finds nothing to migrate.
        //
        // `deviceStore.clear()` (not `clearToken()`) is deliberate: unpair
        // means unpair, so the whole DataStore goes — including the USB
        // sneakernet keys, which belong to the screen identity being
        // dropped.
        lifecycleScope.launch {
            runCatching { deviceStore.clear() }
                .onFailure { PlayerLogger.w("MainActivity", "unpair: DataStore clear failed: ${it.message}") }
            runCatching {
                applicationContext
                    .getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                    .edit().remove(PREF_DEVICE_TOKEN).apply()
            }.onFailure { PlayerLogger.w("MainActivity", "unpair: prefs token clear failed: ${it.message}") }
            // ⚠️ UNPAIRING THE PRIMARY UNPAIRS THE WHOLE PHYSICAL UNIT
            // (2026-09-16). The box has ONE operator-visible identity; leaving
            // a face holding a live credential after the front was revoked is
            // precisely the "resurrection" shape W2-1 closed on the primary.
            // Per-face keys only — never DeviceStore.clear(), which is already
            // done above and owns the box's USB sneakernet keys.
            runCatching { com.educms.player.face.FaceTokenStore.clearEveryFace(applicationContext) }
                .onFailure { PlayerLogger.w("MainActivity", "unpair: face token clear failed: ${it.message}") }
            PlayerLogger.i("MainActivity", "Unpair: both native token stores cleared (legacy first)")
            runOnUiThread {
                webView.loadUrl("about:blank")
                val token = ""
                loadPlayer(token)
            }
        }
    }

    /**
     * Look up the installed Manager APK's versionName via
     * PackageManager. Returns null when Manager isn't installed.
     * Tries production package first, then debug variant.
     */
    @Suppress("DEPRECATION")
    private fun readManagerVersion(): String? {
        for (pkg in listOf("com.educms.manager", "com.educms.manager.debug")) {
            try {
                val info = packageManager.getPackageInfo(pkg, 0)
                return info.versionName
            } catch (_: Exception) { /* try next */ }
        }
        return null
    }

    private fun deviceInfoJson(): String {
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels
        // `secureBridge` / `lockTask` (2026-08-03) are fleet-visibility
        // fields, not features: they answer "can we delete the legacy
        // addJavascriptInterface surface yet?" and "is this screen
        // actually pinned?" from the dashboard instead of by grepping
        // per-device logs. See NativeBridgeChannel + LockTaskController.
        //
        // `legacyBridge` (SEC-002, 2026-09-04) is the field that answers the
        // audit finding: TRUE means this screen still materialises
        // `window.EduCmsNative` in every frame — the population that is
        // still exposed, and the population a content kill switch has to
        // cover. It is a DIFFERENT question from `secureBridge`, not a
        // restatement: a device can have the channel and still take the
        // legacy path when it has no document-start injection.
        // `bridgeNonceArmed` / `bridgeNonceRefused` (SEC-002 re-audit,
        // 2026-09-04) are what make the DEFAULT-DENY gate auditable from the
        // dashboard instead of by reading a device log. On a legacy-path
        // screen, `bridgeNonceArmed:false` is the honest statement that this
        // panel is running with its control-plane bridge shut — content,
        // heartbeat, recovery and the emergency hold are unaffected, but
        // unpair / setBootstrap / the log paths are refused. On a PATH A
        // screen it is meaningless and always false: nothing is gated there
        // because nothing was injected, which is why it must always be read
        // NEXT TO `legacyBridge`, never on its own.
        val nonce = bridgeNonce
        return """{"manufacturer":"${Build.MANUFACTURER}","model":"${Build.MODEL}","sdk":${Build.VERSION.SDK_INT},"width":$w,"height":$h,"appVersion":"${BuildConfig.VERSION_NAME}","secureBridge":$nativeChannelActive,"legacyBridge":$legacyBridgeInjected,"bridgeNonceArmed":${nonce?.armed() ?: false},"bridgeNonceRefused":${nonce?.refusedWhileUnarmed() ?: false},"lockTask":${LockTaskController.isActive(this)}}"""
    }

    override fun onResume() {
        super.onResume()
        // See the companion's [isInForeground] — the only proof a post-OTA
        // relaunch actually landed on the glass.
        isInForeground = true
        webView.onResume()
        if (::urlOverlayView.isInitialized) {
            urlOverlayView.onResume()
        }
        webView.resumeTimers()
        if (::urlOverlayView.isInitialized) {
            urlOverlayView.resumeTimers()
        }
        // v1.0.24 — if we deep-linked to Settings to get the install
        // permission and the user is now back, re-check + auto-fire
        // bootstrap so the system Install dialog appears without a
        // re-launch of the app. No-op when not gating.
        if (awaitingPermissionGrant && managerGateShown && !managerGateTargetSatisfied()) {
            val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                packageManager.canRequestPackageInstalls()
            if (granted) {
                awaitingPermissionGrant = false
                PlayerLogger.i("MainActivity", "Permission granted on return — firing bootstrap now")
                binding.managerGateStatus.text = "Installing companion service…"
                binding.managerGateHint.text = "When you see the system Install dialog, tap Install."
                ManagerBootstrap.bootstrapIfNeeded(applicationContext)
            } else {
                // User came back without granting. Surface retry button
                // so they can either re-open Settings or manually grant.
                PlayerLogger.i("MainActivity", "Returned without grant — surfacing retry on gate")
                binding.managerGateStatus.text =
                    "Permission still needed — press OK to open Settings, or Back to exit."
                surfaceGateRetry()
            }
        }
        // 2026-09-01 (TC22 F4) — if we are holding content for a companion
        // upgrade and the confirmation we raised is gone without the
        // install landing (BAL-dropped, covered, or dismissed by one of the
        // relaunch actors before F1 stopped them), put it back. Bounded;
        // a no-op on every screen that is not gating.
        maybeReissueInstallPrompt()

        // ── Kiosk lock task mode (2026-08-03) ───────────────────────
        //
        // HISTORY, so nobody re-introduces the old bug: this used to be
        // an unconditional `startLockTask()`, which trapped every
        // operator who sideloaded the APK for testing. Without device-
        // owner provisioning that call silently degrades to Android's
        // *screen pinning* variant — an "App is pinned" dialog whose only
        // exit is hold-Back+Overview, a gesture that does not exist on a
        // signage remote. It was removed and replaced by this comment.
        //
        // LockTaskController is the correct version of that idea. It
        // refuses to call startLockTask() at all unless the Manager
        // companion is genuinely DEVICE OWNER *and* has put us on the
        // DO's lock-task allowlist — the pair of conditions that
        // guarantees we get the real LOCK_TASK_MODE_LOCKED and never the
        // trapping variant. On an OEM-CMS box, or any plain sideload,
        // every gate fails and behaviour is byte-for-byte what it is
        // today. Read that file's header before changing this.
        isResumedForLockTask = true
        maybeEngageLockTask("onResume")

        // ── Display control (2026-08-13) ────────────────────────────
        //
        // 1. RE-RESOLVE the provider chain. WRITE_SETTINGS is an appop
        //    the operator grants OUT OF PROCESS — by tapping through
        //    Settings.ACTION_MANAGE_WRITE_SETTINGS, or by a one-shot
        //    `adb shell appops set <pkg> WRITE_SETTINGS allow` — and
        //    neither restarts us. Without this the registry kept
        //    reporting the pre-grant answer until the process next died,
        //    so SettingsBrightnessProvider and ScreenTimeoutBlankProvider
        //    were unreachable in the field no matter what the operator
        //    did. resolve() is a handful of stats plus one canWrite().
        //
        // 2. ⚠️ RE-ASSERT the emergency hold. If an alert is active this
        //    forces the panel visible again — the window hooks are
        //    re-registered per Activity instance, and a hold that
        //    survived a process death has to be re-applied to the NEW
        //    window or the alert stays behind a black overlay.
        //
        // 3. SETTLE a pending device-admin enrolment prompt (2026-08-14).
        //    `ACTION_ADD_DEVICE_ADMIN` takes the operator out of our
        //    Activity and back into it, so THIS is the moment we learn
        //    how it ended. Deliberately BEFORE the invalidate: settling
        //    a successful enrolment invalidates too, and ordering it
        //    first means the resolution below already sees
        //    BLANK=device-admin in the same resume — no process restart,
        //    which is the whole point of the tier. Settling is cheap and
        //    a no-op when no prompt is outstanding (it returns null
        //    before touching prefs).
        runCatching {
            com.educms.player.display.DeviceAdminEnrollment.settlePending(applicationContext)
            com.educms.player.display.DisplayControlRegistry.invalidate()
            com.educms.player.display.DisplayEmergency.enforceIfHeld(applicationContext)
        }.onFailure { PlayerLogger.w("DisplayControl", "onResume display refresh failed: ${it.message}") }

        // Secondary faces resume with the box. Wrapped because a face must
        // never be able to throw out of the primary's lifecycle.
        runCatching { faceHosts?.onResume() }
            .onFailure { PlayerLogger.w("MainActivity", "face onResume failed: ${it.message}") }

        // ── Guided setup (2026-08-24, checklist shell 2026-08-25) ───
        //
        // THE reason this lives in onResume and not onCreate: every grant
        // in the ceremony ends with the operator leaving us for a system
        // Settings screen and coming back — which IS an onResume. Driving
        // from here is what re-reads every grant live and re-renders the
        // checklist the moment they return, so the list they left is the
        // list they come back to, one row further along. It also means a
        // grant made outside the ceremony (or a step skipped and later
        // done by hand) is noticed as soon as we are foregrounded.
        //
        // Ordered AFTER the display refresh above on purpose: settlePending
        // + invalidate have already run, so a device-admin enrolment the
        // operator just completed is visible as satisfied here and the
        // ceremony moves on to the next step instead of re-offering it.
        //
        // Gated on Manager being installed because until it is, the
        // manager-install gate owns the screen and runs its own
        // permission flow (proceedWithBootstrapOrRequestPermission) —
        // two drivers on one screen is the exact stacking this replaced.
        val forcedSetup = pendingOpenSetup
        pendingOpenSetup = false
        // ⚠️ 2026-09-01 (TC22 F2) — `!managerGateShown` is NEW and load-
        // bearing. The gate's own comment already says two dialog drivers on
        // one screen is the exact stacking the ceremony replaced; until now
        // the gate implied `readManagerVersion() == null`, so this condition
        // could never be true while it was up. The companion-UPGRADE gate
        // breaks that implication (Manager is installed, just stale), and
        // the post-upgrade grant card fires in precisely this window — two
        // remote-focus surfaces fighting over one D-pad.
        if (readManagerVersion() != null && !managerGateShown) {
            if (forcedSetup) {
                com.educms.player.setup.SetupCeremony.open(this, ::applyRemoteFocus)
            } else {
                com.educms.player.setup.SetupCeremony.resume(this, ::applyRemoteFocus)
            }
        } else if (forcedSetup) {
            PlayerLogger.i(
                "SetupCeremony",
                "OPEN_SETUP ignored — the manager-install gate owns the screen",
            )
        }
    }

    override fun onPause() {
        isInForeground = false
        isResumedForLockTask = false
        // We deliberately DON'T stopLockTask here — the activity should keep
        // its pinned state while the OS swaps focus (e.g. notification panel
        // attempts). Only release on destroy / explicit unpair.
        if (::urlOverlayView.isInitialized) {
            urlOverlayView.onPause()
        }
        webView.onPause()
        runCatching { faceHosts?.onPause() }
            .onFailure { PlayerLogger.w("MainActivity", "face onPause failed: ${it.message}") }
        super.onPause()
    }

    override fun onDestroy() {
        webView.stopLoading()
        if (::urlOverlayView.isInitialized) {
            urlOverlayView.stopLoading()
            urlOverlayView.loadUrl("about:blank")
        }
        if (::recovery.isInitialized) recovery.shutdown()
        // Drop the display window hooks. The bridge holds them weakly so
        // an un-clean death is already safe; this is the clean path.
        // NOTE: the persisted brightness/blank STATE is deliberately left
        // alone — a screen that is meant to be blanked overnight must
        // stay blanked across an Activity restart, and onWindowAttached()
        // re-applies it when a window comes back.
        // Tear the faces down BEFORE the window hooks go: each host stands its
        // own emergency hold down on the way out, so a face that is holding
        // when the Activity dies cannot strand the interlock on a pane that no
        // longer exists. If it was the LAST holder the release runs exactly as
        // it does today, schedule re-evaluation and all.
        runCatching { faceHosts?.stop() }
            .onFailure { PlayerLogger.w("MainActivity", "face host shutdown failed: ${it.message}") }
        faceHosts = null
        runCatching { DisplayWindowBridge.clear() }
        // Drop the setup checklist (and its guard tick) so this destroyed
        // Activity is never held by the SetupCeremony singleton. No-op
        // when nothing is up, or when the live checklist belongs to a
        // newer Activity instance.
        runCatching { com.educms.player.setup.SetupCeremony.detach(this) }
        // Same reasoning for the boot diagnostic: drop the card and the
        // host callbacks so a destroyed Activity is never retained, and
        // stop its ticker (the staleness watchdog's is stopped below).
        runCatching { com.educms.player.boot.BootDiagnostics.detach(this) }
        stopBootWatchdog()
        watchdogHandler.removeCallbacks(watchdogTicker)
        try {
            if (managerInstallReceiverRegistered) {
                unregisterReceiver(managerInstallReceiver)
                managerInstallReceiverRegistered = false
            }
        } catch (_: Exception) { /* tolerated */ }
        // v1.0.23 — cancel any pending Manager-install poll callbacks
        // so they don't fire after the activity is gone.
        stopManagerInstallPoller()
        if (::urlOverlayView.isInitialized) {
            (urlOverlayView.parent as? android.view.ViewGroup)?.removeView(urlOverlayView)
            urlOverlayView.destroy()
        }
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    /**
     * v1.0.14 — listen for ACTION_PACKAGE_ADDED so when Manager
     * finishes installing (via ManagerBootstrap), Player reloads its
     * WebView. The reload re-runs loadPlayer() which re-reads
     * Manager's version via PackageManager and includes &mv= on the
     * page URL. Without this reload, the page URL set on first launch
     * has no &mv= (Manager wasn't installed yet at that point), so
     * heartbeat keeps reporting Player-only and the dashboard chip
     * never gets the Manager version.
     *
     * Filter to com.educms.manager(.debug) so we don't reload on
     * arbitrary unrelated installs.
     */
    private var managerInstallReceiverRegistered = false
    private val managerInstallReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: Intent) {
            val pkg = intent.data?.schemeSpecificPart
            if (pkg == "com.educms.manager" || pkg == "com.educms.manager.debug") {
                PlayerLogger.i("MainActivity", "Manager package added/replaced ($pkg) — hiding gate + loading WebView")
                // TC22 F1 — the companion changed on disk, so any install
                // confirmation we were holding relaunches off is provably
                // gone. Clear before touching the UI.
                noteInstallLanded(pkg)
                runOnUiThread {
                    // v1.0.23 — hide the install gate + cancel poller
                    // (no-op if neither was active, e.g. a same-version
                    // re-install on a kiosk that already had Manager).
                    //
                    // TC22 F2 — this is ALSO the primary release for the
                    // companion-UPGRADE hold: ACTION_PACKAGE_REPLACED is
                    // already in this receiver's filter, so the new
                    // companion landing hides the gate and re-runs
                    // `loadPlayer()` (which is what refreshes `&mv=`).
                    // Hold, upgrade, auto-resume — no new machinery.
                    managerGateReleasable = false
                    managerGateTargetVc = 0
                    hideManagerGate()
                    stopManagerInstallPoller()
                    lifecycleScope.launch {
                        loadPlayer(resolveDeviceToken())
                    }
                }
            }
        }
    }

    /**
     * v1.0.23 — show the Manager-install gate. Blocks the WebView
     * behind a full-screen overlay until Manager is detected via
     * PackageManager + ACTION_PACKAGE_ADDED.
     *
     * The "Retry install" button is hidden by default — surfaced by
     * showManagerGateRetry() only after a sufficiently long stall
     * (managerGateStartedElapsedMs + 60s with no install) so impatient
     * operators don't keep mashing it during the normal install
     * flow.
     */
    private var managerGateShown = false
    private fun showManagerGate(status: String) {
        managerGateShown = true
        // 2026-09-01 — `elapsedRealtime`, replacing `currentTimeMillis`:
        // signage boxes step the wall clock on first NTP sync, and a
        // forward step used to surface "Retry install" instantly while a
        // backward step could hide it for the whole hold. Both gate timers
        // (the 60 s retry rung and the upgrade gate's bounded self-release)
        // now read this one monotonic stamp.
        managerGateStartedElapsedMs = android.os.SystemClock.elapsedRealtime()
        binding.managerGateOverlay.visibility = View.VISIBLE
        binding.managerGateStatus.text = status
        binding.managerGateRetry.setOnClickListener {
            PlayerLogger.i("MainActivity", "Manager gate: retry requested")
            binding.managerGateRetry.visibility = View.GONE
            // v1.0.24 — retry runs through the same permission-gated
            // flow. If permission is still missing it deep-links to
            // Settings again; otherwise fires bootstrap directly.
            proceedWithBootstrapOrRequestPermission()
        }
    }

    private fun hideManagerGate() {
        if (!managerGateShown) return
        managerGateShown = false
        binding.managerGateOverlay.visibility = View.GONE
        // Whatever system prompt the gate was announcing is done with us.
        LedSystemPromptBanner.dismiss("companion gate closed")
    }

    // ─── 2026-09-01 (TC22 F2): HOLD CONTENT FOR A COMPANION UPGRADE ──
    //
    // "It updated the player and at least asked to update the manager but
    // it did not update it… it needs to put the content on hold, do the
    // upgrade, and then auto start the content again."
    //
    // ONE implementation, TWO triggers — boot (`onCreate`, when the
    // companion is installed but stale) and an update check
    // (CHECK_FOR_UPDATES from the dashboard, or the panel's own Update
    // button), because a screen already running the latest Player has no
    // other way to be told "your companion is behind" (operator,
    // 2026-09-01: "from the dashboard, if the player is on the latest
    // version but the manager is not, there is no way to push the updated
    // manager").
    //
    // ⚠️ WHAT "HOLD" MEANS HERE, EXACTLY. The gate is a full-screen
    // overlay: content leaves the glass, and `loadPlayer()` re-runs on
    // release (which is also what refreshes `&mv=` after the upgrade). The
    // WebView underneath is deliberately LEFT RUNNING rather than blanked
    // or paused — it keeps heartbeating (so the screen does not read
    // offline for the length of the hold) and it stays able to receive an
    // OVERRIDE, which the poller turns into an immediate release. Killing
    // the page to silence three minutes of audio would trade a real
    // life-safety property for a cosmetic one.

    /** Package id of the production companion — the one target we hold for. */
    private val MANAGER_PKG = "com.educms.manager"

    /**
     * Longest the upgrade gate may hold content with no version change.
     * 3 minutes: long enough for a person to walk to the panel and tap
     * Install, short enough that a screen nobody is standing at gets
     * itself back on the air. See the poller for why this exists at all.
     */
    private val MANAGER_UPGRADE_HOLD_MAX_MS = 3L * 60L * 1000L

    /**
     * Longest we wait for the bundled-APK probe before giving up and
     * behaving exactly as this build did before F2. The probe extracts a
     * ~2 MB asset and parses its manifest — normally well under a second —
     * but a boot must never be hostage to local IO.
     */
    private val MANAGER_PROBE_BUDGET_MS = 4_000L

    /** True only for the UPGRADE gate: it may release itself and play. */
    private var managerGateReleasable = false

    /** versionCode we are waiting for; 0 = "any installed version will do". */
    private var managerGateTargetVc = 0

    /** One hold per target per process — a CHECK_FOR_UPDATES may repeat. */
    private var managerUpgradeHoldAttemptedVc = 0

    /**
     * `elapsedRealtime` at gate raise — written by [showManagerGate], so it
     * covers BOTH gates. Never `currentTimeMillis`: signage boxes step the
     * wall clock on first NTP sync, and a stepped clock either surfaces the
     * retry button instantly or hides it for the whole hold.
     */
    private var managerGateStartedElapsedMs = 0L

    /** Installed versionCode of [pkg], or -1 when absent / unreadable. */
    @Suppress("DEPRECATION")
    private fun readPackageVersionCode(pkg: String): Int = try {
        packageManager.getPackageInfo(pkg, 0).versionCode
    } catch (_: Exception) {
        -1
    }

    /** Installed companion versionCode, or null when it is not installed. */
    private fun readInstalledManagerVersionCode(): Int? =
        listOf(MANAGER_PKG, "com.educms.manager.debug")
            .map { readPackageVersionCode(it) }
            .firstOrNull { it >= 0 }

    // ─── 2026-09-01 (TC22 F4): RE-ISSUE A DROPPED CONFIRMATION ───────
    //
    // The staged confirm Intent used to be single-use: one reader, which
    // nulled it. A BAL-dropped launch, or a dialog covered by one of the
    // relaunch actors, consumed the only copy and nothing re-staged it —
    // the bundled-companion upgrade could then be retried only by a COLD
    // onCreate. The prompt now survives; this is what re-shows it.
    //
    // ⚠️ HARD-CAPPED ON PURPOSE. The honest failure mode of a re-issuable
    // system dialog is a loop: operator dismisses, we resume, we re-raise.
    // A wall panel with a dialog nobody can dismiss is a brick. So: only
    // while we are already holding content for the upgrade, only after the
    // previous raise has settled, only a couple of times, and after that
    // the gate's own remote-focused "Retry install" button and its Back
    // escape are the way forward.

    /** `stagedAtMs` of the prompt the counter below belongs to. */
    private var installPromptStageSeenMs = 0L

    /** How many times THAT prompt has been re-shown. */
    private var installPromptReissues = 0

    private fun maybeReissueInstallPrompt() {
        val staged = com.educms.player.ota.OtaInstallReceiver.peekPendingInstallPrompt() ?: return
        if (staged.stagedAtMs != installPromptStageSeenMs) {
            installPromptStageSeenMs = staged.stagedAtMs
            installPromptReissues = 0
        }
        val nowMs = android.os.SystemClock.elapsedRealtime()
        val landed = staged.targetPackage != null &&
            staged.targetVersionCodeAtStage >= 0 &&
            readPackageVersionCode(staged.targetPackage) != staged.targetVersionCodeAtStage
        if (!InstallPromptGate.stagedPromptStillUsable(staged.stagedAtMs, nowMs, landed)) {
            com.educms.player.ota.OtaInstallReceiver.clearPendingInstallPrompt()
            PlayerLogger.i(
                "MainActivity",
                "staged install prompt dropped — " +
                    if (landed) "the target package changed" else "it aged out",
            )
            return
        }
        val reissue = InstallPromptGate.shouldReissue(
            holdingContentForUpgrade = managerGateShown && !awaitingPermissionGrant,
            hasStagedPrompt = true,
            outstanding = installPromptOutstanding,
            reissuesUsed = installPromptReissues,
            lastRaisedAtMs = installPromptLastRaisedAtMs,
            nowMs = nowMs,
        )
        if (!reissue) return
        installPromptReissues += 1
        PlayerLogger.i(
            "MainActivity",
            "re-showing the staged install confirmation (attempt " +
                "$installPromptReissues/${InstallPromptGate.MAX_REISSUES}) — the gate is still " +
                "holding content and the target package has not changed",
        )
        raiseInstallPrompt(staged, "reissue-$installPromptReissues")
    }

    /**
     * Has the gate's goal been reached? Version-aware for the upgrade gate,
     * byte-for-byte the old "is it installed at all" for the first-install
     * gate (`managerGateTargetVc == 0`).
     */
    private fun managerGateTargetSatisfied(): Boolean =
        if (managerGateTargetVc > 0) {
            (readInstalledManagerVersionCode() ?: 0) >= managerGateTargetVc
        } else {
            readManagerVersion() != null
        }

    /**
     * Ask whether this screen should hold content for a companion upgrade,
     * and act on the answer. Safe to call while content is playing, safe to
     * call twice, and safe to call from any thread.
     *
     * [onDeclined] runs on the main thread whenever we are NOT holding —
     * that is where the boot path does its ordinary `loadPlayer()`, so the
     * happy path is unchanged apart from waiting for the probe.
     */
    private fun evaluateManagerUpgradeHold(
        trigger: String,
        onDeclined: (ManagerUpgradeDecision) -> Unit,
    ) {
        lifecycleScope.launch {
            val probe = probeManagerUpgradeBounded()
            if (probe == null) {
                PlayerLogger.w(
                    "MainActivity",
                    "companion-upgrade probe ($trigger) did not answer inside " +
                        "${MANAGER_PROBE_BUDGET_MS}ms — proceeding without a hold",
                )
                onDeclined(ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE)
                return@launch
            }
            val decision = ManagerUpgradeMath.decide(
                probe = probe,
                emergencyHeld = runCatching {
                    DisplayEmergency.isHeld(applicationContext)
                }.getOrDefault(false),
                gateAlreadyShown = managerGateShown,
                holdAlreadyAttemptedForVc = managerUpgradeHoldAttemptedVc,
            )
            PlayerLogger.i(
                "MainActivity",
                "companion-upgrade check ($trigger): installed vc=${probe.installedVersionCode} " +
                    "bundled vc=${probe.bundledVersionCode} -> $decision",
            )
            if (decision == ManagerUpgradeDecision.HOLD_AND_UPGRADE) {
                beginManagerUpgradeHold(probe.bundledVersionCode, trigger)
            } else {
                onDeclined(decision)
            }
        }
    }

    /**
     * The probe, with a REAL bound. `withTimeoutOrNull` cannot interrupt a
     * blocking read, so the wait is done with a latch on a daemon thread:
     * the answer is used if it arrives in time and abandoned if it does not.
     */
    private suspend fun probeManagerUpgradeBounded(): ManagerUpgradeProbe? =
        withContext(Dispatchers.IO) {
            val holder = java.util.concurrent.atomic.AtomicReference<ManagerUpgradeProbe?>(null)
            val latch = java.util.concurrent.CountDownLatch(1)
            Thread {
                try {
                    holder.set(ManagerBootstrap.probeUpgrade(applicationContext))
                } catch (t: Throwable) {
                    PlayerLogger.w("MainActivity", "companion-upgrade probe threw: ${t.message}")
                } finally {
                    latch.countDown()
                }
            }.apply { isDaemon = true }.start()
            if (latch.await(MANAGER_PROBE_BUDGET_MS, java.util.concurrent.TimeUnit.MILLISECONDS)) {
                holder.get()
            } else {
                null
            }
        }

    /**
     * Raise the upgrade gate, then run the bootstrap that installs the
     * bundled companion. Release is owned by the existing pair: the
     * PACKAGE_REPLACED receiver (primary) and the 2 s poller (belt), both
     * of which end in `loadPlayer()` — hold, upgrade, auto-resume.
     */
    private fun beginManagerUpgradeHold(targetVc: Int, trigger: String) {
        managerGateReleasable = true
        managerGateTargetVc = targetVc
        managerUpgradeHoldAttemptedVc = targetVc
        PlayerLogger.i(
            "MainActivity",
            "companion upgrade ($trigger): holding content, target vc=$targetVc",
        )
        binding.managerGateTitle.text = "Updating your player"
        showManagerGate("Updating companion service…")
        // Copy states what the evidence proves (rule 10): we know we are
        // holding playback and we know an install was started. We cannot
        // see the glass, so nothing here claims a dialog is showing.
        binding.managerGateHint.text =
            "Playback is paused while this finishes. If an Install dialog appears, choose Install."
        startManagerInstallPoller()
        ManagerBootstrap.bootstrapIfNeeded(applicationContext)
    }

    /**
     * Stop holding and play content. The ONLY way out of the upgrade gate
     * other than the upgrade landing — used by the remote's Back key, by an
     * incoming emergency, and by the bounded-hold timeout.
     */
    private fun releaseManagerUpgradeGate(reason: String) {
        if (!managerGateShown) return
        PlayerLogger.w("MainActivity", "companion-upgrade gate released — $reason")
        managerGateReleasable = false
        managerGateTargetVc = 0
        hideManagerGate()
        stopManagerInstallPoller()
        binding.managerGateRetry.visibility = View.GONE
        // A confirmation may still be staged/outstanding for a companion we
        // are no longer waiting on; dropping the hold keeps it from
        // suppressing a genuine post-OTA relaunch for the next ten minutes.
        clearInstallPromptHold("companion-upgrade gate released")
        lifecycleScope.launch {
            loadPlayer(resolveDeviceToken())
        }
    }

    /**
     * Surface the gate's "Retry install" button REMOTE-FIRST (2026-08-30,
     * field install): OEM signage ROMs strip the default focus highlight,
     * and nothing ever parked focus on this button — on a remote-only
     * panel the gate looked dead. Decorate with the same focus treatment
     * every other kiosk control gets, then park focus so the remote's OK
     * key fires it with zero navigation.
     */
    private fun surfaceGateRetry() {
        if (binding.managerGateRetry.visibility == View.VISIBLE) return
        applyRemoteFocus(binding.managerGateRetry)
        binding.managerGateRetry.visibility = View.VISIBLE
        binding.managerGateRetry.requestFocus()
    }

    /**
     * v1.0.23 — defensive 2-second PackageManager poll for the case
     * where ACTION_PACKAGE_ADDED isn't delivered to our receiver
     * (Android 14+ runtime-registered receiver edge cases, OEM doze
     * behavior, etc.). The receiver path remains primary; this is
     * the belt to its suspenders.
     *
     * Surfaces the "Retry install" button if Manager hasn't appeared
     * after 60s — usually means the operator dismissed the system
     * Install dialog or hasn't tapped Install yet.
     */
    private val managerPollHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val managerPollRunnable = object : Runnable {
        override fun run() {
            if (!managerGateShown) return

            // ⚠️ 2026-09-01 (TC22 F2) — AN ALERT OUTRANKS AN UPGRADE. The
            // upgrade gate is a full-screen overlay; if an emergency lands
            // while it is up, the alert renders in the WebView BEHIND it.
            // Release immediately and put content back on the glass. Only
            // for the releasable (upgrade) gate — the first-install gate
            // has no paired screen to show an alert on yet.
            if (managerGateReleasable && DisplayEmergency.isHeld(applicationContext)) {
                releaseManagerUpgradeGate("an emergency alert is active — content outranks the upgrade")
                return
            }

            // ⚠️ VERSION-AWARE (TC22 F2). "Is it installed?" was the right
            // question for the first-install gate and the WRONG one for an
            // upgrade: a stale companion IS installed, so the old poller
            // would have released this gate on its very first tick and put
            // the screen straight back into the race this fixes.
            if (managerGateTargetSatisfied()) {
                PlayerLogger.i(
                    "MainActivity",
                    "Manager poll: target satisfied (installed=${readManagerVersion()} " +
                        "targetVc=$managerGateTargetVc) — hiding gate and loading player",
                )
                managerGateReleasable = false
                managerGateTargetVc = 0
                hideManagerGate()
                noteInstallLanded(MANAGER_PKG)
                lifecycleScope.launch {
                    loadPlayer(resolveDeviceToken())
                }
                return
            }
            val heldMs = android.os.SystemClock.elapsedRealtime() - managerGateStartedElapsedMs
            // Surface retry button + clearer status after a stall.
            if (heldMs > 60_000L && binding.managerGateRetry.visibility != View.VISIBLE) {
                binding.managerGateStatus.text = if (managerGateReleasable) {
                    "No companion update yet — press OK to retry, or Back to start playing."
                } else {
                    "If the system Install dialog didn't appear, press OK to retry — or Back to exit."
                }
                surfaceGateRetry()
            }

            // ⚠️ THE SCREEN MUST GET ITSELF BACK. A signage box stuck on
            // "Updating companion service…" forever — because the operator
            // walked away, or the confirmation was refused, or the ROM
            // dropped it — is a worse outcome than a stale companion. After
            // a bounded total the upgrade gate releases itself and plays
            // content, logging exactly why. The FIRST-INSTALL gate is
            // deliberately NOT released this way: it withholds the pairing
            // code on purpose until the companion exists (v1.0.23).
            if (managerGateReleasable) {
                if (heldMs >= MANAGER_UPGRADE_HOLD_MAX_MS) {
                    releaseManagerUpgradeGate(
                        "no companion version change in ${heldMs / 1000}s (target vc " +
                            "$managerGateTargetVc, installed ${readInstalledManagerVersionCode()}) — " +
                            "playing content rather than holding the screen",
                    )
                    return
                }
            }
            managerPollHandler.postDelayed(this, 2_000L)
        }
    }
    private fun startManagerInstallPoller() {
        managerPollHandler.removeCallbacks(managerPollRunnable)
        managerPollHandler.postDelayed(managerPollRunnable, 2_000L)
    }
    private fun stopManagerInstallPoller() {
        managerPollHandler.removeCallbacks(managerPollRunnable)
    }

    /**
     * v1.0.24 — seamless permission + bootstrap flow.
     *
     * Operator (2026-04-28 v1.0.23 field test): "i saw the installer
     * but when i clicked back out of the permissions window it
     * dissappeared". Two dialogs were racing: the system Install
     * dialog (from PackageInstaller) and the deep-linked Settings
     * page (from what is now SetupCeremony's install step) — first
     * re-launch was needed to clear the conflict. That is also why the
     * ceremony refuses to run until Manager is installed: this flow owns
     * the screen until then, and two dialog drivers is the same race.
     *
     * v1.0.24 fix: do them in sequence, not in parallel.
     *   1. If install-unknown-apps permission missing → set gate
     *      status, deep-link to Settings, mark awaitingPermissionGrant.
     *      Do NOT fire bootstrap yet (no install dialog to fight with).
     *   2. User toggles permission, taps Back → onResume fires.
     *   3. onResume re-checks permission. If granted, fire bootstrap.
     *      Install dialog appears unobstructed.
     *   4. User taps Install → Manager installs → gate hides →
     *      WebView loads. One smooth sequence, no re-launch needed.
     */
    private var awaitingPermissionGrant = false
    private fun proceedWithBootstrapOrRequestPermission() {
        // API < 26 doesn't gate ACTION_INSTALL_PACKAGE behind a per-app
        // toggle, so canRequestPackageInstalls doesn't even exist —
        // bootstrap can fire directly.
        val needsPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        if (needsPermission) {
            PlayerLogger.i("MainActivity", "Install permission missing — deep-linking to Settings, gating bootstrap")
            binding.managerGateStatus.text = "Tap Allow on the next screen to grant install permission"
            binding.managerGateHint.text = "We'll continue automatically when you return."
            try {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Say IN THE LED COLUMN what Android is about to open — that
                // Settings page is drawn centred in the controller's frame
                // buffer, off a poster's glass. No key copy: a poster has no
                // remote (1.1.15). No-op on every non-poster device.
                LedSystemPromptBanner.announce(
                    this,
                    "Allow this screen to install apps",
                    "A poster is never asked for this (v1.1.16). If you see it, push the current build from ViPlex.",
                )
                startActivity(intent)
                awaitingPermissionGrant = true
            } catch (e: Exception) {
                PlayerLogger.w("MainActivity", "Could not open install-sources settings", e)
                // Fall through to manual instructions on the gate.
                binding.managerGateStatus.text =
                    "Manual setup needed: Settings → Apps → EduCMS Player → Install unknown apps → Allow"
                binding.managerGateHint.text = "Tap Retry install once permission is granted."
                binding.managerGateRetry.visibility = View.VISIBLE
            }
            return
        }
        // Permission already granted — fire bootstrap directly.
        PlayerLogger.i("MainActivity", "Install permission already granted — firing bootstrap from foreground")
        binding.managerGateStatus.text = "Installing companion service…"
        binding.managerGateHint.text = "When you see the system Install dialog, tap Install."
        LedSystemPromptBanner.announce(
            this,
            "Install the companion service",
            "The Install button is on that page, off the LED.",
        )
        ManagerBootstrap.bootstrapIfNeeded(applicationContext)
    }
    private fun registerManagerInstallReceiver() {
        if (managerInstallReceiverRegistered) return
        try {
            val filter = android.content.IntentFilter().apply {
                addAction(Intent.ACTION_PACKAGE_ADDED)
                addAction(Intent.ACTION_PACKAGE_REPLACED)
                addDataScheme("package")
            }
            // Android 14+ requires explicit RECEIVER_EXPORTED/_NOT_EXPORTED
            // when registering BroadcastReceivers at runtime. PACKAGE_ADDED
            // is a system-protected broadcast (only the OS can send it),
            // so EXPORTED is correct here.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                registerReceiver(managerInstallReceiver, filter, RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(managerInstallReceiver, filter)
            }
            managerInstallReceiverRegistered = true
            PlayerLogger.i("MainActivity", "registered PACKAGE_ADDED receiver for Manager")
        } catch (e: Exception) {
            PlayerLogger.w("MainActivity", "failed to register PACKAGE_ADDED receiver: ${e.message}")
        }
    }

    /**
     * The full "leave the player, land on the OEM launcher" routine —
     * extracted 2026-08-30 (byte-faithful) from the `onExitToDeviceHome`
     * bridge lambda so the manager-install gate's Back key can run the
     * SAME battle-tested escape (lock-task disengage → alias off →
     * preferred-activity clear → explicit non-self HOME → fallback HOME →
     * finishAffinity). Two callers: the JS bridge, and gate-Back.
     */
    private fun exitToDeviceHomeNow(reason: String) {
        runOnUiThread {
            // ── Step 0: LEAVE LOCK TASK MODE FIRST ──────────────
            // 2026-08-03. Inside a locked task, `finishAffinity()`
            // and a HOME intent are both no-ops — every step below
            // would run, log success, and leave the operator
            // exactly where they started. This IS the on-screen
            // escape hatch from lock task; see LockTaskController.
            // No-op on a screen that was never pinned.
            LockTaskController.disengage(this, reason)

            val pm = packageManager
            // ── Step 1: turn OFF the KioskHomeAlias ─────────────
            // Without this, Android's HOME resolver still finds us
            // as a HOME handler and may route the intent back to
            // our own activity (causing the "exits to launcher
            // then bounces back to syncing splash" loop).
            try {
                val aliasComponent = ComponentName(packageName, "$packageName.KioskHomeAlias")
                val enabled = pm.getComponentEnabledSetting(aliasComponent)
                val isEnabledNow =
                    enabled == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                if (isEnabledNow) {
                    pm.setComponentEnabledSetting(
                        aliasComponent,
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP,
                    )
                    PlayerLogger.i(
                        "MainActivity",
                        "KioskHomeAlias disabled before exit — OEM launcher will receive next HOME intent. PlayerApp.onCreate re-enables on next start.",
                    )
                }
            } catch (t: Throwable) {
                PlayerLogger.w("MainActivity", "Failed to disable KioskHomeAlias before exit", t)
            }

            // ── Step 2: clear OUR package's preferred-activity
            //  entries (1.0.74 belt-and-suspenders). On EP6N
            //  units provisioned with Manager as device owner,
            //  Manager called DevicePolicyManager
            //  .addPersistentPreferredActivity to pin our alias
            //  as HOME. Disabling the alias removes us as a
            //  resolver candidate, but the persistent-pref
            //  table on some Android 14 ROMs (notably the EP6N
            //  stock build) keeps a stale entry for our package
            //  for ~30s after the component flip — long enough
            //  for the HOME intent below to hit it. Clearing
            //  the non-persistent preferred-activity table
            //  costs nothing when there are no entries and
            //  forces Android to do a fresh resolver pass.
            try {
                @Suppress("DEPRECATION")
                pm.clearPackagePreferredActivities(packageName)
            } catch (t: Throwable) {
                PlayerLogger.w("MainActivity", "clearPackagePreferredActivities failed (non-fatal)", t)
            }

            // ── Step 3: pick a non-self HOME activity EXPLICITLY
            //  (1.0.74 belt-and-suspenders). Rather than fire a
            //  generic ACTION_MAIN+CATEGORY_HOME and hope the
            //  resolver picks the OEM launcher, enumerate every
            //  HOME handler on the device and explicitly target
            //  the first one that isn't us. This bypasses the
            //  resolver + the persistent-pref table entirely —
            //  Android will always send the user to the OEM
            //  Goodview launcher (or Settings if no launcher
            //  exists, an edge case worth surviving cleanly).
            val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
            }
            val resolveInfos = try {
                pm.queryIntentActivities(homeIntent, 0)
            } catch (t: Throwable) {
                PlayerLogger.w("MainActivity", "queryIntentActivities(HOME) failed", t)
                emptyList<android.content.pm.ResolveInfo>()
            }
            val nonSelfHome = resolveInfos.firstOrNull {
                val pkg = it.activityInfo?.packageName
                pkg != null && pkg != packageName
            }
            val launchedExplicitly = if (nonSelfHome != null) {
                val targetPkg = nonSelfHome.activityInfo.packageName
                val targetCls = nonSelfHome.activityInfo.name
                PlayerLogger.i(
                    "MainActivity",
                    "Explicitly launching OEM launcher: $targetPkg/$targetCls",
                )
                val target = Intent(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    component = ComponentName(targetPkg, targetCls)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK
                }
                runCatching { startActivity(target) }
                    .onFailure {
                        PlayerLogger.w("MainActivity", "explicit OEM launcher start failed", it)
                    }
                    .isSuccess
            } else {
                false
            }

            // ── Step 4: fallback — generic HOME intent ──────────
            //  Only used when Step 3 found no non-self HOME (no
            //  OEM launcher installed) or the explicit start
            //  failed. After step 1 disabled our alias, the
            //  generic intent should resolve to Settings on
            //  most stock Android builds, which still gives the
            //  operator a way out.
            if (!launchedExplicitly) {
                PlayerLogger.w(
                    "MainActivity",
                    "No non-self HOME handler found — falling back to generic HOME intent",
                )
                val fallback = homeIntent.apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                runCatching { startActivity(fallback) }
                    .onFailure { PlayerLogger.w("MainActivity", "fallback HOME intent failed", it) }
            }
            finishAffinity()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Operator (2026-04-27): "im trying to use the goodview remote
        // control but the enter button and back button do nothing."
        // Cause: this method previously returned `true` for every key
        // except volume — which silently swallowed Enter, Back, and
        // every D-pad direction so the WebView never got them.
        //
        // Now: allow remote-control keys to flow through to the
        // WebView so HTML buttons can be focused and clicked. Power /
        // home / menu we still block (those would exit the kiosk and
        // leave the screen on a stale frame). Anything not explicitly
        // listed defaults to swallow.
        return when (keyCode) {
            // Volume — let the OS handle it (mutes / changes volume).
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_MUTE -> super.onKeyDown(keyCode, event)

            // Remote-control navigation — pass through to the WebView so
            // the player page can handle button focus + click. Without
            // this the entire page is unreachable via remote.
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_TAB,
            KeyEvent.KEYCODE_SPACE,
            // Numeric keys for entering pairing codes via remote — most
            // signage remotes have a number pad and the operator should
            // be able to type the 6-digit pairing code directly.
            KeyEvent.KEYCODE_0, KeyEvent.KEYCODE_1, KeyEvent.KEYCODE_2,
            KeyEvent.KEYCODE_3, KeyEvent.KEYCODE_4, KeyEvent.KEYCODE_5,
            KeyEvent.KEYCODE_6, KeyEvent.KEYCODE_7, KeyEvent.KEYCODE_8,
            KeyEvent.KEYCODE_9 -> super.onKeyDown(keyCode, event)

            // Back — let it go through. The OnBackPressedCallback below
            // owns the actual decision (back-history nav in the WebView,
            // or exit on long-press). super() routes to that callback.
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_ESCAPE -> super.onKeyDown(keyCode, event)

            // Everything else (Power, Home, Menu, Search, Camera, etc.)
            // stays swallowed — those would either exit the kiosk or
            // leave it in a bad state.
            else -> true
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) reapplyImmersive()
    }

    private fun reapplyImmersive() {
        WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        }
    }
}
