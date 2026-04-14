package com.schoolcms.player

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * SafeWebViewClient strictly limits the capabilities of the WebView
 * rendering uploaded CMS assets (HTML wrappers or SVGs).
 * Mitigates Unsafe Asset Rendering (Release Blocker RT-02).
 */
class SafeWebViewClient : WebViewClient() {

    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
        val url = request?.url?.toString() ?: ""

        // CSP: Only allow self, or specific cloud domain
        if (!url.startsWith("https://cms-cloud-domain.com") && !url.startsWith("file:///android_asset/")) {
            // Block external requests (SSRF / Data exfiltration prevention)
            return WebResourceResponse("text/plain", "UTF-8", null)
        }

        return super.shouldInterceptRequest(view, request)
    }

    companion object {
        fun applyHardening(webView: WebView) {
            val settings = webView.settings
            
            // Absolutely disable JavaScript for basic media/signage rendering
            settings.javaScriptEnabled = false
            
            // Disable access to the broader local filesystem 
            // (Cache access should be managed via content providers or tight scoped storage)
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            
            // Never allow Javascript interfaces (Native bridge)
            webView.removeJavascriptInterface("android")
            webView.removeJavascriptInterface("Android")
        }
    }
}
