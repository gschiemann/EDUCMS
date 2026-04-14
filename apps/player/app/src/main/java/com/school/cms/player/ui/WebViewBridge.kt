package com.school.cms.player.ui

import android.content.Context
import android.webkit.JavascriptInterface
import android.widget.Toast

class WebViewBridge(private val context: Context) {

    @JavascriptInterface
    fun reportPlaybackStart(assetId: String) {
        // Here we would interact with PlayerDao to insert a PlaybackLog entry
    }

    @JavascriptInterface
    fun reportPlaybackComplete(assetId: String) {
        // Playback finished, move to next via StateMachine or let JS handle it natively
    }

    @JavascriptInterface
    fun logError(errorMsg: String) {
        // Transmit non-fatal frontend errors back through the telemetry system
    }

    @JavascriptInterface
    fun triggerToastDebug(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }
}
