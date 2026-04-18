package com.educms.player

import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi

/**
 * Restricts navigation to the configured PLAYER_BASE_URL host and recovers
 * from WebView renderer crashes (which are common on long-running signage).
 */
class SafePlayerWebViewClient(
    private val onRendererGone: () -> Unit,
) : WebViewClient() {

    private val allowedHost: String? = runCatching {
        Uri.parse(BuildConfig.PLAYER_BASE_URL).host
    }.getOrNull()

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val host = request.url.host ?: return true
        // Allow only same-origin navigation; block everything else (mailto:, tel:, etc.).
        val allow = allowedHost != null && (host == allowedHost || host.endsWith(".$allowedHost"))
        if (!allow) {
            Log.w("PlayerWeb", "Blocked navigation to $host")
        }
        return !allow
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        Log.d("PlayerWeb", "page started: $url")
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) {
            Log.w("PlayerWeb", "main-frame error: ${error.description} on ${request.url}")
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        Log.e("PlayerWeb", "renderer gone — didCrash=${detail.didCrash()}")
        onRendererGone()
        return true // we handled it; don't crash the host process
    }
}
