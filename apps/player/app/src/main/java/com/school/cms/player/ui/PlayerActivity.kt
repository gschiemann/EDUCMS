package com.school.cms.player.ui

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import com.school.cms.player.R

class PlayerActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        // 1. App-Level Hardening: Lock Task Mode
        try {
            startLockTask()
        } catch (e: Exception) {
            // Fails if not Device Owner or whitelisted
        }

        // 2. Immersive Sticky Mode & Disable Nav Bar
        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                )

        setupWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = findViewById(R.id.player_web_view)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false // Crucial for unattended signage
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        
        // Add JS Bridge to communicate State / Telemetry 
        webView.addJavascriptInterface(WebViewBridge(this), "AndroidSignageBridge")

        // Load local fallback or initial state
        webView.loadUrl("file:///android_asset/loading_state.html")
    }

    // 3. Touch Lock Strategy
    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        // By default, for non-interactive displays, intercept and drop all touches.
        // Returning true means the event is consumed and stops propagating to the WebView.
        return true 
    }

    // 4. Escape Gesture Disabling
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Intercept volume, back, and standard keys
        return when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_HOME -> true // Consume event
            else -> super.onKeyDown(keyCode, event)
        }
    }

    @Deprecated("Deprecated in Java", ReplaceWith("/* Intercepted */", ""))
    override fun onBackPressed() {
        // Completely disabled to thwart escaping
    }
}
