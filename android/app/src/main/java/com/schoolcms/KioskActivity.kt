package com.schoolcms

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import com.schoolcms.player.SafeWebViewClient

class KioskActivity : Activity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // 1. Keep Screen Awake permanently
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // 2. Hide Navigation/Status Bars (Immersive Sticky)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )

        setContentView(R.layout.activity_kiosk) // Assuming R layer exists

        // 3. Initialize WebView with strict security config from Stage 1
        webView = findViewById(R.id.kiosk_webview)
        SafeWebViewClient.applyHardening(webView)
        webView.webViewClient = SafeWebViewClient()

        // 4. Pin App Mode (LockTask)
        // Ensures user cannot swipe away or use recent apps. 
        // Requires device owner provisioning in production.
        try {
            startLockTask()
        } catch (e: Exception) {
            // Log fallback if device not provisioned correctly
        }

        // 5. Load Initial Offline Cache State
        // (Wired up to sync loop in production)
        webView.loadUrl("file:///android_asset/default_playlist.html")
    }

    override fun onBackPressed() {
        // Disabled intentionally to prevent kiosk exit
    }
}
