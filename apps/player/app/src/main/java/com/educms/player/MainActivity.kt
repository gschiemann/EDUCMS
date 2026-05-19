package com.educms.player

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
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
import com.educms.player.logging.PlayerLogger
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
                PlayerLogger.w(
                    "MainActivity",
                    "Watchdog: no successful page load in ${ageMs / 1000}s — forcing reload",
                )
                runCatching { webView.stopLoading() }
                lifecycleScope.launch {
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
                }
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

        // FULL sensor rotation — user mounts the display however they
        // want (portrait, landscape, reverse). The WebView handles any
        // orientation; the web player's CSS scales 1920×1080 scenes to
        // fit either aspect via transform:scale.
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR

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
            // Fire the legacy permission prompt for future OTAs only
            // after Manager is installed — at that point the popup
            // can't conflict with the gate-driven install dialog.
            maybePromptForInstallPermission()
            // v1.0.57 — and the Manager's permission too. Without
            // this, Manager has REQUEST_INSTALL_PACKAGES in its
            // manifest but the per-app source toggle is OFF, so its
            // background OTA installs fail silently. Player is the
            // only foreground process that can launch Settings on
            // the operator's behalf; tagging it onto the existing
            // permission prompt flow gets both grants in one visit.
            maybePromptForManagerInstallPermission()
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

        // v1.0.65 — offer to make Player the device's HOME app. This
        // is the non-Device-Owner path to OTA auto-relaunch: when
        // Player is HOME, the OS itself brings it back after an
        // update install. Fires once per install, gated inside the
        // method (skipped under Device Owner — which pins HOME for us
        // — and skipped if Player is already HOME).
        maybePromptForHomeAppSetup()
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
    }

    private fun handleInstallPromptTrampoline(launchIntent: Intent?) {
        if (launchIntent?.action != com.educms.player.ota.OtaInstallReceiver.ACTION_LAUNCH_INSTALL_PROMPT) return
        @Suppress("DEPRECATION")
        val prompt: Intent? = launchIntent.getParcelableExtra(
            com.educms.player.ota.OtaInstallReceiver.EXTRA_INSTALL_PROMPT,
        )
        if (prompt == null) {
            PlayerLogger.w("MainActivity", "trampoline fired but no install_prompt_intent extra")
            return
        }
        prompt.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        try {
            startActivity(prompt)
            PlayerLogger.i("MainActivity", "install prompt launched from foreground (BAL bypass)")
        } catch (e: Exception) {
            PlayerLogger.e("MainActivity", "install prompt launch failed", e)
        }
    }

    /**
     * First-run permission prompt. Android ≥ 8 gates ACTION_INSTALL_PACKAGE
     * behind a per-app user toggle in Settings (NOT developer mode — a
     * standard end-user permission). Without it, OTAs fail with a vague
     * "For your security, your phone isn't allowed to install unknown
     * apps from this source" dialog that confuses operators.
     *
     * Flow:
     *   1. Check packageManager.canRequestPackageInstalls()
     *   2. If false AND we haven't asked yet this install, show a friendly
     *      dialog explaining what's needed.
     *   3. On Allow: deep-link to the per-app settings page pre-filtered
     *      to this package via ACTION_MANAGE_UNKNOWN_APP_SOURCES.
     *   4. User toggles the switch, hits Back, we're in business.
     *
     * We only nag once per install (tracked in SharedPreferences)
     * because operators SHOULD be able to defer this without the kiosk
     * pestering them every reboot. Re-offer the dialog from the web
     * player's overlay if they ever try to Check-for-updates and it
     * still isn't granted — see SoftwareInfoRow on the web side.
     */
    /**
     * Make a native AlertDialog reachable by the kiosk REMOTE. Taurus /
     * OEM signage ROMs strip the default button focus-highlight
     * drawable, so the operator can't see — or reach — what's selected;
     * the dialog looks dead. This gives every button a theme-independent
     * focus highlight (translucent fill) and parks initial focus on the
     * positive button so the D-pad has a starting point. Wrap a
     * built-and-shown AlertDialog: applyRemoteFocus(builder…show()).
     */
    private fun applyRemoteFocus(dialog: AlertDialog) {
        for (which in intArrayOf(
            AlertDialog.BUTTON_POSITIVE,
            AlertDialog.BUTTON_NEGATIVE,
            AlertDialog.BUTTON_NEUTRAL,
        )) {
            val b = dialog.getButton(which) ?: continue
            b.isFocusable = true
            b.isFocusableInTouchMode = false
            b.setOnFocusChangeListener { v, hasFocus ->
                // Theme-independent highlight — does not rely on the
                // OEM ROM's (stripped) button focus drawable.
                v.setBackgroundColor(if (hasFocus) 0x553B82F6.toInt() else 0)
            }
        }
        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
    }

    private fun maybePromptForInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (packageManager.canRequestPackageInstalls()) return
        val prefs = getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        if (prefs.getBoolean("installPromptShown", false)) return

        applyRemoteFocus(AlertDialog.Builder(this)
            .setTitle("One-time setup")
            .setMessage(
                "To apply player updates automatically, EduCMS needs permission " +
                "to install updates. Tap Allow to open the setting — you'll " +
                "only need to do this once. After you grant it, future updates " +
                "install with a quick confirmation."
            )
            .setPositiveButton("Allow") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .setData(Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                } catch (e: Exception) {
                    Log.w("MainActivity", "Could not open install-sources settings", e)
                }
            }
            .setNegativeButton("Later") { _, _ -> /* remind from overlay */ }
            .setCancelable(true)
            .show())

        prefs.edit().putBoolean("installPromptShown", true).apply()
    }

    /**
     * v1.0.57 — Manager install-permission grant flow.
     *
     * Operator (2026-05-15): "i want the APK upgrade to fucking work,
     * it has never worked in 57 fucking versions, the player gets
     * permissions for unknown but the manager never gets a popup to
     * set those permissions, and the upgrade never fully works".
     *
     * The bug: Manager APK gets sideloaded by Player's ManagerBootstrap
     * via PackageInstaller. Manager declares REQUEST_INSTALL_PACKAGES
     * in its manifest, but Android STILL requires the user to toggle
     * "Allow from this source" per-app in Settings before that
     * permission is effective. Manager has NO MainActivity (it's a
     * daemon) so it can't open Settings itself — its existing
     * `maybePromptForInstallPermission` in ManagerApp.onCreate posts
     * a notification that kiosk operators on Taurus / LED controllers
     * almost never see (notification shade is hidden in kiosk mode
     * or behind hardware bezels).
     *
     * Result: Player can install Manager fine (Player has the
     * permission), but when Manager later tries to install a Player
     * update it gets blocked with no operator-facing prompt → "upgrade
     * never fully works".
     *
     * THIS FIX: Player is the only foreground-privileged process on
     * the kiosk. Right after Player's own permission grant flow, AND
     * once Manager is detected as installed, Player launches Settings
     * pre-filtered to Manager's per-app source page on behalf of
     * Manager. The operator who's already standing at the kiosk
     * granting Player's permission grants Manager's in the same
     * session. One walk-up, both permissions sorted.
     *
     * Tracked in SharedPreferences ("managerInstallPromptShown") so
     * we nag once per install. Operator can defer via "Later"; the
     * overlay-side software-info row in the web player offers a
     * "re-prompt" button for missed cases.
     */
    private fun maybePromptForManagerInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        // Skip if Manager isn't installed (bootstrap hasn't completed
        // yet, or operator opted out via skip-manager.txt). Will run
        // again on next launch when bootstrap finishes.
        val managerPkg = listOf("com.educms.manager", "com.educms.manager.debug").firstOrNull { pkg ->
            try {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(pkg, 0)
                true
            } catch (_: Exception) { false }
        } ?: run {
            PlayerLogger.i("MainActivity", "Manager not installed yet — deferring permission prompt")
            return
        }
        val prefs = getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        if (prefs.getBoolean("managerInstallPromptShown", false)) return

        applyRemoteFocus(AlertDialog.Builder(this)
            .setTitle("One more setup step")
            .setMessage(
                "EduCMS also needs to grant install permission to the companion app " +
                "(Manager) that delivers Player updates in the background. Tap Allow " +
                "to open the setting — same one-time flow you just did for Player. " +
                "Without this, automatic updates won't apply."
            )
            .setPositiveButton("Allow") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .setData(Uri.parse("package:$managerPkg"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                    PlayerLogger.i("MainActivity", "Opened Settings for Manager install-sources ($managerPkg)")
                } catch (e: Exception) {
                    Log.w("MainActivity", "Could not open Manager install-sources settings", e)
                }
            }
            .setNegativeButton("Later") { _, _ ->
                PlayerLogger.i("MainActivity", "Operator deferred Manager install-perm prompt")
            }
            .setCancelable(true)
            .show())

        prefs.edit().putBoolean("managerInstallPromptShown", true).apply()
    }

    /**
     * v1.0.65 — Home-app setup prompt (the non-Device-Owner path to
     * OTA auto-relaunch).
     *
     * After an OTA install the Player process is killed; for it to
     * come back ON SCREEN by itself, the OS has to relaunch it — and
     * the only thing Android will auto-relaunch is the HOME app.
     * Under Device Owner, Manager pins Player as HOME via
     * DevicePolicyManager and this prompt is unnecessary. WITHOUT
     * Device Owner there is no API to pin it — the operator has to
     * pick Player as the Home app once, in Settings. This prompt
     * walks them through that on the first launch after a sideload.
     *
     * Skipped when:
     *   - Manager is Device Owner (HOME is pinned for us already)
     *   - Player is already the Home app
     *   - the prompt has been shown once before (operator can
     *     re-trigger from the web overlay's software-info row)
     *
     * On "Set as home" we (1) flip on the kioskHomeOptIn pref so
     * PlayerApp keeps the KioskHomeAlias enabled, (2) enable that
     * alias now so Player is a selectable Home candidate, and (3)
     * deep-link to the Home-app settings screen. The alias ships
     * DISABLED precisely so we never register as a launcher on an
     * OEM-CMS box unless the operator deliberately opts in here.
     */
    private fun maybePromptForHomeAppSetup() {
        val prefs = getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        if (prefs.getBoolean("homeSetupPromptShown", false)) return

        // Device Owner already pins HOME for us — no operator step.
        if (managerIsDeviceOwner()) {
            prefs.edit().putBoolean("homeSetupPromptShown", true).apply()
            return
        }
        // Already the Home app — nothing to do.
        if (isPlayerTheHomeApp()) {
            prefs.edit().putBoolean("homeSetupPromptShown", true).apply()
            return
        }

        applyRemoteFocus(AlertDialog.Builder(this)
            .setTitle("Finish update setup")
            .setMessage(
                "Set Venue OS Player as this screen's Home app so it " +
                "comes back automatically after an update installs — " +
                "no walking up to the screen. Tap \"Set as home\", then " +
                "choose Venue OS Player from the list. One-time setup.",
            )
            .setPositiveButton("Set as home") { _, _ ->
                prefs.edit().putBoolean("kioskHomeOptIn", true).apply()
                enableKioskHomeAlias()
                openHomeSettings()
                PlayerLogger.i("MainActivity", "Operator opted into kiosk Home-app setup")
            }
            .setNegativeButton("Not now") { _, _ ->
                PlayerLogger.i("MainActivity", "Operator deferred Home-app setup")
            }
            .setCancelable(true)
            .show())

        prefs.edit().putBoolean("homeSetupPromptShown", true).apply()
    }

    private fun managerIsDeviceOwner(): Boolean = try {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE)
            as? android.app.admin.DevicePolicyManager
        dpm != null && (
            dpm.isDeviceOwnerApp("com.educms.manager") ||
                dpm.isDeviceOwnerApp("com.educms.manager.debug")
        )
    } catch (_: Exception) { false }

    private fun isPlayerTheHomeApp(): Boolean = try {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val res = packageManager.resolveActivity(
            intent,
            android.content.pm.PackageManager.MATCH_DEFAULT_ONLY,
        )
        res?.activityInfo?.packageName == packageName
    } catch (_: Exception) { false }

    /** Enable our own KioskHomeAlias so Player shows up as a Home-app
     *  candidate. Toggling our own component needs no permission. */
    private fun enableKioskHomeAlias() {
        try {
            val alias = android.content.ComponentName(
                packageName,
                "com.educms.player.KioskHomeAlias",
            )
            packageManager.setComponentEnabledSetting(
                alias,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                android.content.pm.PackageManager.DONT_KILL_APP,
            )
            PlayerLogger.i("MainActivity", "KioskHomeAlias enabled (operator opt-in)")
        } catch (e: Exception) {
            PlayerLogger.w("MainActivity", "enableKioskHomeAlias failed: ${e.message}")
        }
    }

    /** Deep-link to the Home-app picker. ACTION_HOME_SETTINGS isn't on
     *  every OEM ROM, so fall back to the top-level Settings app. */
    private fun openHomeSettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_HOME_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {
            try {
                startActivity(
                    Intent(Settings.ACTION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (e: Exception) {
                PlayerLogger.w("MainActivity", "openHomeSettings failed: ${e.message}")
            }
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

        wv.addJavascriptInterface(
            WebAppBridge(
                onUnpair = { unpairAndRestart() },
                onReload = { runOnUiThread { wv.reload() } },
                getDeviceInfo = { deviceInfoJson() },
                onCheckForUpdates = { PlayerApp.fireOtaCheckNow(applicationContext) },
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
                    PlayerLogger.i("MainActivity", "Exit to device home requested via JS bridge")
                    runOnUiThread {
                        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                            addCategory(Intent.CATEGORY_HOME)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        }
                        runCatching { startActivity(homeIntent) }
                            .onFailure { PlayerLogger.w("MainActivity", "home intent failed", it) }
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
                    val cleanApiRoot = apiRoot.trim()
                        .removeSuffix("/")
                        .removeSuffix("/api/v1")
                    val cleanFp = fingerprint.trim()
                    if (cleanApiRoot.isEmpty() || cleanFp.isEmpty()) {
                        PlayerLogger.w(
                            "MainActivity",
                            "setBootstrap rejected — empty values (apiRoot=${cleanApiRoot.length} fp=${cleanFp.length})"
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
            ),
            "EduCmsNative"
        )

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
            },
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureUrlOverlay(wv: WebView) {
        wv.visibility = View.GONE
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
        if (urlOverlayCurrentUrl == cleanUrl && urlOverlayView.visibility == View.VISIBLE) {
            return
        }
        urlOverlayCurrentUrl = cleanUrl
        PlayerLogger.i("MainActivity", "Showing URL overlay: $cleanUrl")
        urlOverlayView.loadUrl(cleanUrl)
        urlOverlayView.visibility = View.VISIBLE
        urlOverlayView.bringToFront()
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
        return """{"manufacturer":"${Build.MANUFACTURER}","model":"${Build.MODEL}","sdk":${Build.VERSION.SDK_INT},"width":$w,"height":$h,"appVersion":"${BuildConfig.VERSION_NAME}"}"""
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
        // Kiosk pinning is now OPT-IN via a manifest flag (default: off).
        // Unconditionally calling startLockTask() was trapping operators
        // who sideloaded the APK for testing — without Device Owner
        // provisioning Android shows a "App is pinned" dialog that
        // swallows the back button, kills the TV remote, and has no
        // on-screen way out.
        //
        // To enable real kiosk lock-in, provision the device as Device
        // Owner via ADB:
        //   adb shell dpm set-device-owner com.educms.player/.KioskAdminReceiver
        // then set `android:requiredLockTaskFeatures` or call
        // startLockTask() from a boot config. For normal installs we
        // just leave the activity running full-screen / immersive,
        // which is enough for a paired signage player.
        if (BuildConfig.DEBUG) {
            Log.i("MainActivity", "Kiosk pin disabled (not auto-enabled). Use Device Owner provisioning for true lock-in.")
        }
    }

    override fun onPause() {
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
     * page (from maybePromptForInstallPermission) — first re-launch
     * was needed to clear the conflict.
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
