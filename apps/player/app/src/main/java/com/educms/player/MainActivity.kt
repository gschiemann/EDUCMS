package com.educms.player

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
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
                getDeviceInfo = { deviceInfoJson() }
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
        val builder = Uri.parse(base).buildUpon()
            .appendQueryParameter("client", "android")
            .appendQueryParameter("v", BuildConfig.VERSION_NAME)
        // Pass token only if we already have one (legacy paired device).
        // For a fresh install the web player's /screens/register flow
        // takes over, shows a pairing code on screen, polls for pairing,
        // and writes the device token into WebView localStorage.
        if (token.isNotBlank()) builder.appendQueryParameter("token", token)
        val url = builder.build().toString()
        Log.i("Player", "Loading $url")
        webView.loadUrl(url)
    }

    private fun unpairAndRestart() {
        lifecycleScope.launch {
            deviceStore.clear()
            startActivity(Intent(this@MainActivity, PairingActivity::class.java))
            finish()
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
        // Lock-task / screen-pinning. When the device is set as Device Owner
        // (one-shot ADB command, see README), this puts the player in true
        // kiosk mode — home button, recents, status bar swipe all disabled.
        // No prompt to the user.
        // Without Device Owner, falls back to user-confirmable pinning so
        // the operator at least gets the dialog. Catch + log so a non-DO
        // device never crashes here.
        runCatching { startLockTask() }
            .onFailure { Log.w("MainActivity", "startLockTask not available — install as Device Owner for true kiosk mode", it) }
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
