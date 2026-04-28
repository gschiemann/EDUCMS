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
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
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
    private val deviceStore by lazy { DeviceStore(applicationContext) }
    private lateinit var recovery: NetworkRecoveryController

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlayerLogger.i("MainActivity", "onCreate — ${Build.MANUFACTURER} ${Build.MODEL} SDK ${Build.VERSION.SDK_INT}")

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

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        webView = binding.webview

        // Self-healing recovery — catches main-frame load failures and
        // 5xx errors, shows a branded "Reconnecting…" overlay, probes
        // /api/v1/health on a backoff, and reloads the WebView when the
        // server returns. Operator no longer has to power-cycle the
        // kiosk to recover from a Vercel/Railway redeploy blip.
        recovery = NetworkRecoveryController(
            context = applicationContext,
            baseUrl = BuildConfig.PLAYER_BASE_URL,
            onShowOverlay = { state ->
                binding.recoveryOverlay.visibility = View.VISIBLE
                binding.recoveryTitle.text = state.title
                binding.recoverySub.text = state.sub
                if (state.errorLabel.isNullOrBlank()) {
                    binding.recoveryError.visibility = View.GONE
                } else {
                    binding.recoveryError.visibility = View.VISIBLE
                    binding.recoveryError.text = state.errorLabel
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

        configureWebView(webView)

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
        } else {
            // Manager NOT installed — gate the player.
            PlayerLogger.i("MainActivity", "Manager missing — showing install gate, firing bootstrap from foreground")
            showManagerGate("Installing companion service…")
            // Fire bootstrap from this foregrounded Activity context.
            // ManagerBootstrap.bootstrapIfNeeded reads the bundled APK
            // out of assets and commits a PackageInstaller session;
            // the system Install dialog appears (BAL is satisfied
            // because MainActivity is foregrounded). When the user
            // taps Install, ACTION_PACKAGE_ADDED fires →
            // managerInstallReceiver.onReceive() → hideManagerGate()
            // + loadPlayer().
            ManagerBootstrap.bootstrapIfNeeded(applicationContext)
            // Defensive: poll PackageManager every 2s in case the
            // PACKAGE_ADDED broadcast is dropped (some OEM ROMs
            // have been observed to do this when receivers are
            // registered late in onCreate).
            startManagerInstallPoller()
        }

        // One-time setup prompt for OTA install permission. Every
        // Android ≥ 8 app that wants to install APKs needs the user
        // to toggle "Install unknown apps" for that specific app —
        // same thing Yodeck / OptiSigns / Xibo ask for on their first
        // launch. We fire this ONCE at cold boot; if the user grants
        // it, future OTA updates show the streamlined system prompt
        // (or skip it entirely on some OEMs) instead of the scary
        // "app can't be installed" dialog that greeted them tonight.
        maybePromptForInstallPermission()
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
    private fun maybePromptForInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (packageManager.canRequestPackageInstalls()) return
        val prefs = getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        if (prefs.getBoolean("installPromptShown", false)) return

        AlertDialog.Builder(this)
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
            .show()

        prefs.edit().putBoolean("installPromptShown", true).apply()
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
                if (::recovery.isInitialized) recovery.onPageLoaded()
            },
        )
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
        webView.resumeTimers()
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
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.stopLoading()
        if (::recovery.isInitialized) recovery.shutdown()
        try {
            if (managerInstallReceiverRegistered) {
                unregisterReceiver(managerInstallReceiver)
                managerInstallReceiverRegistered = false
            }
        } catch (_: Exception) { /* tolerated */ }
        // v1.0.23 — cancel any pending Manager-install poll callbacks
        // so they don't fire after the activity is gone.
        stopManagerInstallPoller()
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
            PlayerLogger.i("MainActivity", "Manager gate: retry install requested")
            binding.managerGateStatus.text = "Retrying companion install…"
            binding.managerGateRetry.visibility = View.GONE
            ManagerBootstrap.bootstrapIfNeeded(applicationContext)
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
