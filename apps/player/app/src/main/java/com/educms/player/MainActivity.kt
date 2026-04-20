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
import com.educms.player.databinding.ActivityMainBinding
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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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

        configureWebView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { /* swallow */ }
        })

        // Always load /player — the web player handles its own
        // register → show pairing code → poll → play flow. No native
        // PairingActivity redirect; the APK is a kiosk shell, not a
        // parallel pairing implementation. If a legacy native token is
        // already in DataStore we pass it along so the player can skip
        // the register step.
        lifecycleScope.launch {
            val token = deviceStore.deviceToken.first()
            loadPlayer(token.orEmpty())
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
                lifecycleScope.launch {
                    val token = deviceStore.deviceToken.first().orEmpty()
                    loadPlayer(token)
                }
            }
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

        val builder = Uri.parse(base).buildUpon()
            .appendQueryParameter("client", "android")
            .appendQueryParameter("v", BuildConfig.VERSION_NAME)
            .appendQueryParameter("w", wPx.toString())
            .appendQueryParameter("h", hPx.toString())
            .appendQueryParameter("dpr", density.toString())
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
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_MUTE -> super.onKeyDown(keyCode, event)
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
