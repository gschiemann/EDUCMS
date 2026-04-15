package com.schoolcms

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import com.schoolcms.player.SafeWebViewClient

class KioskActivity : Activity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )

        setContentView(R.layout.activity_kiosk) 

        webView = findViewById(R.id.kiosk_webview)
        SafeWebViewClient.applyHardening(webView)
        webView.webViewClient = SafeWebViewClient()

        try {
            startLockTask()
        } catch (e: Exception) {
            // Ignored
        }

        webView.loadUrl("file:///android_asset/default_playlist.html")
    }

    override fun onBackPressed() {
        // Disabled
    }
}
