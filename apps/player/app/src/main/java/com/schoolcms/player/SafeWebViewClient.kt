package com.schoolcms.player

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

class SafeWebViewClient : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
        val url = request?.url?.toString() ?: ""
        if (!url.startsWith("https://cms-cloud-domain.com") && !url.startsWith("file:///android_asset/")) {
            return WebResourceResponse("text/plain", "UTF-8", null)
        }
        return super.shouldInterceptRequest(view, request)
    }

    companion object {
        fun applyHardening(webView: WebView) {
            val settings = webView.settings
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webView.removeJavascriptInterface("android")
            webView.removeJavascriptInterface("Android")
        }
    }
}
