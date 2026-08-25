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
import com.educms.player.databinding.ActivityMainBinding
import com.educms.player.display.DisplayCapabilityProbe
import com.educms.player.display.DisplayControlApi
import com.educms.player.display.DisplayEmergency
import com.educms.player.display.DisplayGuard
import com.educms.player.display.DisplayScheduler
import com.educms.player.display.DisplayWindowBridge
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import com.educms.player.security.LockTaskController
import com.educms.player.security.NativeBridgeChannel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

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
     * 2026-08-03 — consecutive watchdog ticks that found a stale page.
     * Reset to 0 on every successful load / web heartbeat. Once it
     * reaches [WATCHDOG_UNPIN_AFTER_FAILURES] we release lock task mode,
     * because a kiosk whose WebView is durably dead cannot render the
     * on-screen "Exit to device home" button — pinning it would be a soft
     * brick with no operator way out. See LockTaskController's header.
     */
    private var watchdogConsecutiveFailures: Int = 0

    private val watchdogHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val watchdogTicker = object : Runnable {
        override fun run() {
            val ageMs = if (lastSuccessfulLoadAtMs == 0L) Long.MAX_VALUE
                else android.os.SystemClock.elapsedRealtime() - lastSuccessfulLoadAtMs
            // If we've been past the timeout AND the recovery overlay
            // isn't already running its own loop, force-reload. The
            // recovery controller will pick up the resulting load
            // event (success or error) and resume normal flow.
            if (ageMs > WATCHDOG_TIMEOUT_MS) {
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
                runCatching { webView.stopLoading() }
                lifecycleScope.launch {
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
                }
            } else {
                watchdogConsecutiveFailures = 0
            }
            // Re-arm. Always re-arm — even after a forced reload —
            // so a chronic stuck-state is reloaded on every interval.
            watchdogHandler.postDelayed(this, WATCHDOG_TICK_MS)
        }
    }

    companion object {
        /** How often to check freshness. 2 minutes. */
        private const val WATCHDOG_TICK_MS = 2L * 60L * 1000L
        /** How long the page can be stale before we force a reload. 10 minutes. */
        private const val WATCHDOG_TIMEOUT_MS = 10L * 60L * 1000L

        /**
         * 2026-08-03 — after this many consecutive stale watchdog ticks
         * (~30 min of a page that will not load) we RELEASE lock task
         * mode. Rationale in LockTaskController's header: the operator's
         * on-screen escape hatch lives inside the WebView, so a durably
         * dead WebView + a pinned task = no way out without ADB. Three
         * ticks is long enough that a transient outage never unpins a
         * healthy fleet, short enough that a genuinely bricked screen is
         * serviceable within one site visit.
         */
        private const val WATCHDOG_UNPIN_AFTER_FAILURES = 3

        // 2026-05-24 — operator-controlled orientation lock.
        // SharedPreferences key for the most-recently-applied value,
        // used on cold-boot before the manifest poll lands.
        private const val PREFS_NAME = "edu_player"
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
     * Read the last-applied orientation from SharedPreferences. Returns
     * LANDSCAPE by default — matches the historical effective behavior
     * of SCREEN_ORIENTATION_FULL_SENSOR on stationary signage hardware
     * (no accelerometer → defaults to firmware-set landscape).
     */
    private fun loadSavedOrientation(): String {
        return try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_ORIENTATION, ORIENTATION_LANDSCAPE) ?: ORIENTATION_LANDSCAPE
        } catch (e: Exception) {
            PlayerLogger.w("Orientation", "loadSavedOrientation failed: ${e.message}")
            ORIENTATION_LANDSCAPE
        }
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
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
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
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
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
        if (managerVersion != null) {
            // Happy path — Manager already installed. Load WebView as
            // we always have. If a legacy native token is in DataStore,
            // pass it along so the player can skip the register step.
            PlayerLogger.i("MainActivity", "Manager $managerVersion installed — loading player")
            lifecycleScope.launch {
                val token = deviceStore.deviceToken.first()
                loadPlayer(token.orEmpty())
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
        val prompt: Intent? = com.educms.player.ota.OtaInstallReceiver.takePendingInstallPrompt()
        if (prompt == null) {
            PlayerLogger.w(
                "MainActivity",
                "install-prompt trampoline fired with nothing staged in-process — ignoring (external caller?)",
            )
            return
        }
        // Assignment (not addFlags) — this REPLACES every flag the system
        // intent carried, including any FLAG_GRANT_*_URI_PERMISSION.
        prompt.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        try {
            startActivity(prompt)
            PlayerLogger.i("MainActivity", "install prompt launched from foreground (BAL bypass)")
        } catch (e: Exception) {
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
        view.isFocusableInTouchMode = false
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

        // ── AND-002 — ONE handler set, TWO transports ───────────────
        // Built once and handed to both the legacy
        // `addJavascriptInterface` surface and the new origin-scoped
        // `NativeBridgeChannel`, so the two can never drift apart.
        // See NativeBridgeChannel's header for why both ship this
        // release and what must be true before the legacy one is
        // deleted.
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
                onReload = { runOnUiThread { wv.reload() } },
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
                },
                getRecentLogsImpl = {
                    PlayerLogger.i("MainActivity", "getRecentLogs requested via JS bridge")
                    PlayerLogger.readRecent()
                },
                uploadDiagnosticsImpl = {
                    val prefs = applicationContext.getSharedPreferences("edu_player", android.content.Context.MODE_PRIVATE)
                    val apiRoot = prefs.getString("api_root", null)
                    val jwt = prefs.getString("device_jwt", null)
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
                    runOnUiThread {
                        // ── Step 0: LEAVE LOCK TASK MODE FIRST ──────────────
                        // 2026-08-03. Inside a locked task, `finishAffinity()`
                        // and a HOME intent are both no-ops — every step below
                        // would run, log success, and leave the operator
                        // exactly where they started. This IS the on-screen
                        // escape hatch from lock task; see LockTaskController.
                        // No-op on a screen that was never pinned.
                        LockTaskController.disengage(this, "operator chose \"Exit to device home\"")

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
                    } else if (!HostAllowlist.requireAllowed("setBootstrap", cleanApiRoot)) {
                        // Refused: not a first-party host (or not https).
                        // requireAllowed() already logged scheme+host.
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
                displayEmergencyHoldImpl = { active, trusted ->
                    DisplayControlApi.emergencyHoldJson(applicationContext, active, trusted)
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
        )

        // ── Transport 1 (LEGACY, still required) ────────────────────
        // Injects `window.EduCmsNative` into EVERY frame this WebView
        // loads — including operator-authored and third-party iframes.
        // That is exactly the AND-002 finding, and it is knowingly kept
        // for ONE release only: the APK and the web bundle deploy
        // independently, so removing it here would break every kiosk
        // that hasn't yet taken the matching web deploy (and every
        // service-worker-cached bundle still in the field).
        //
        // ⚠️ Do not delete this line until ALL FOUR removal criteria in
        //    NativeBridgeChannel's header are met.
        wv.addJavascriptInterface(webAppBridge, "EduCmsNative")

        // ── Transport 2 (SECURE, preferred) ─────────────────────────
        // Materialises `window.EduCmsNativeChannel` ONLY in a main frame
        // whose origin is exactly BuildConfig.PLAYER_BASE_URL's. Returns
        // false (and logs DEGRADED) on a pre-M77 WebView, where we stay
        // on transport 1 alone.
        nativeChannelActive = NativeBridgeChannel.attach(wv, webAppBridge)

        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("PlayerWeb", "${cm.messageLevel()}: ${cm.message()} @${cm.sourceId()}:${cm.lineNumber()}")
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }
        }

        wv.webViewClient = SafePlayerWebViewClient(
            onRendererGone = {
                Log.w("Player", "WebView renderer crashed — reloading")
                // Treat a renderer crash like a network failure — kick
                // the recovery loop. If the server is fine the loop
                // probes /health, succeeds on first try, and reloads
                // immediately. If the server is also down the operator
                // gets the friendly "reconnecting" overlay instead of a
                // blank black screen until power-cycle.
                if (::recovery.isInitialized) recovery.onError("Renderer crashed")
                lifecycleScope.launch {
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
                }
            },
            onMainFrameError = { label ->
                if (::recovery.isInitialized) recovery.onError(label)
            },
            onPageFinishedOk = {
                lastSuccessfulLoadAtMs = android.os.SystemClock.elapsedRealtime()
                if (::recovery.isInitialized) recovery.onPageLoaded()
                // 2026-08-03 — a healthy page is the ONLY thing that arms
                // the kiosk lock. See maybeEngageLockTask.
                watchdogConsecutiveFailures = 0
                maybeEngageLockTask("page loaded")
            },
        )
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

    private fun loadPlayer(token: String) {
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
        // Clear the native DataStore token so the web player re-registers
        // on next manifest call, then reload the WebView. The web player
        // itself handles the show-pairing-code UI — we don't bounce to a
        // separate native activity anymore (PairingActivity was removed;
        // it was getting pinned as the TV auto-launcher target on some
        // devices and stealing the boot flow).
        lifecycleScope.launch {
            deviceStore.clear()
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
        return """{"manufacturer":"${Build.MANUFACTURER}","model":"${Build.MODEL}","sdk":${Build.VERSION.SDK_INT},"width":$w,"height":$h,"appVersion":"${BuildConfig.VERSION_NAME}","secureBridge":$nativeChannelActive,"lockTask":${LockTaskController.isActive(this)}}"""
    }

    override fun onResume() {
        super.onResume()
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
        if (awaitingPermissionGrant && managerGateShown && readManagerVersion() == null) {
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
                binding.managerGateStatus.text = "Permission still needed — tap Retry to open Settings."
                binding.managerGateRetry.visibility = View.VISIBLE
            }
        }
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
        if (readManagerVersion() != null) {
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
        isResumedForLockTask = false
        // We deliberately DON'T stopLockTask here — the activity should keep
        // its pinned state while the OS swaps focus (e.g. notification panel
        // attempts). Only release on destroy / explicit unpair.
        if (::urlOverlayView.isInitialized) {
            urlOverlayView.onPause()
        }
        webView.onPause()
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
        runCatching { DisplayWindowBridge.clear() }
        // Drop the setup checklist (and its guard tick) so this destroyed
        // Activity is never held by the SetupCeremony singleton. No-op
        // when nothing is up, or when the live checklist belongs to a
        // newer Activity instance.
        runCatching { com.educms.player.setup.SetupCeremony.detach(this) }
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
                PlayerLogger.i("MainActivity", "Manager package added ($pkg) — hiding gate + loading WebView")
                runOnUiThread {
                    // v1.0.23 — hide the install gate + cancel poller
                    // (no-op if neither was active, e.g. a same-version
                    // re-install on a kiosk that already had Manager).
                    hideManagerGate()
                    stopManagerInstallPoller()
                    lifecycleScope.launch {
                        val token = deviceStore.deviceToken.first().orEmpty()
                        loadPlayer(token)
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
     * (managerInstallStartedAt + 60s with no install) so impatient
     * operators don't keep mashing it during the normal install
     * flow.
     */
    private var managerInstallStartedAt: Long = 0L
    private var managerGateShown = false
    private fun showManagerGate(status: String) {
        managerGateShown = true
        managerInstallStartedAt = System.currentTimeMillis()
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
            val installedVersion = readManagerVersion()
            if (installedVersion != null) {
                PlayerLogger.i("MainActivity", "Manager poll detected $installedVersion — proceeding")
                hideManagerGate()
                lifecycleScope.launch {
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
                }
                return
            }
            // Surface retry button + clearer status after a stall.
            val elapsed = System.currentTimeMillis() - managerInstallStartedAt
            if (elapsed > 60_000L && binding.managerGateRetry.visibility != View.VISIBLE) {
                binding.managerGateStatus.text =
                    "If the system Install dialog didn't appear, tap Retry install."
                binding.managerGateRetry.visibility = View.VISIBLE
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
