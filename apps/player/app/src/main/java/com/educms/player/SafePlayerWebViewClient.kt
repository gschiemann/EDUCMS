package com.educms.player

import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi
import com.educms.player.usb.UsbCacheIndex
import java.io.ByteArrayInputStream
import java.io.FileInputStream

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

    /**
     * Intercept asset GETs for content the operator sideloaded via USB.
     * UsbCacheIndex maps asset URL → File on local disk; if we have a hit
     * we return a synthesized WebResourceResponse pointing at the file.
     * Critical for zero-network operation: even with no internet at all,
     * the WebView's <img>/<video> tags hit local disk through us.
     */
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.method != "GET") return null
        val url = request.url?.toString() ?: return null
        val file = UsbCacheIndex.lookup(url)
        if (file != null && file.exists()) {
            val ext = file.extension.lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
            return try {
                WebResourceResponse(mime, "UTF-8", FileInputStream(file)).apply {
                    setStatusCodeAndReasonPhrase(200, "OK")
                    responseHeaders = mapOf(
                        "Content-Length" to file.length().toString(),
                        "Cache-Control" to "public, max-age=31536000, immutable",
                        "X-EduCMS-Source" to "usb-cache",
                    )
                }
            } catch (e: Exception) {
                Log.w("PlayerWeb", "Failed to serve usb-cache file ${file.path}", e)
                null
            }
        }
        // HIGH-7 audit fix: when the device is in offline-first mode (USB
        // cache is populated) and an asset URL we'd normally expect from
        // the cache misses, synthesize a 504 stub instead of letting the
        // WebView try the network and surface a visible error page. This
        // mirrors the Service Worker fetch handler's behavior in
        // apps/web/public/sw-player.js. For online operation (USB cache
        // empty) we still return null so the WebView can fetch from the
        // CDN normally.
        if (UsbCacheIndex.isPopulated() && looksLikeMediaUrl(url)) {
            return WebResourceResponse(
                "application/octet-stream", "UTF-8",
                ByteArrayInputStream(ByteArray(0)),
            ).apply {
                setStatusCodeAndReasonPhrase(504, "Offline / not cached")
                responseHeaders = mapOf(
                    "Content-Length" to "0",
                    "Cache-Control" to "no-store",
                    "X-EduCMS-Source" to "usb-cache-miss",
                )
            }
        }
        return null
    }

    private fun looksLikeMediaUrl(url: String): Boolean {
        val path = runCatching { android.net.Uri.parse(url).path?.lowercase() ?: "" }.getOrDefault("")
        return MEDIA_EXTENSIONS.any { path.endsWith(it) }
    }
    companion object {
        private val MEDIA_EXTENSIONS = listOf(
            ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg",
            ".mp4", ".webm", ".mov", ".m4v",
            ".mp3", ".ogg", ".wav", ".m4a",
        )
    }

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
