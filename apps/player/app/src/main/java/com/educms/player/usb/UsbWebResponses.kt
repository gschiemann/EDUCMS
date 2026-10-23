package com.educms.player.usb

import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.io.RandomAccessFile

/**
 * Serves an imported USB package to the player page (2026-10-22).
 *
 *   • `/__venueos/usb/package.json` on the player's own origin → the VERIFIED
 *     manifest from `usb-cache/` (404 when there is none). The page's service
 *     worker passes this path through untouched (sw-player.js).
 *   • any media URL the package carries → its verified file on this device,
 *     with `Range` support (a <video> and the worker's chunked precache both
 *     send Range; the old interceptor ignored it).
 *
 * Wired into BOTH the page's WebViewClient and the WebView ServiceWorkerClient:
 * the player's media is fetched by its service worker, which the WebViewClient
 * never sees — the reason the old USB cache was never used.
 *
 * Nothing else is intercepted: a URL the package does not name goes to the
 * network exactly as before. (The old "504 every media miss once a stick was
 * imported" rule is gone — it blocked every later network publish.)
 */
object UsbWebResponses {
    const val PACKAGE_PATH = "/__venueos/usb/package.json"

    fun intercept(request: WebResourceRequest, playerHost: String?): WebResourceResponse? {
        if (request.method != "GET") return null
        val uri = request.url ?: return null
        if (uri.path == PACKAGE_PATH) {
            if (playerHost == null || uri.host != playerHost) return null
            return packageResponse()
        }
        val file = UsbCacheIndex.lookup(uri.toString()) ?: return null
        if (!file.isFile) return null
        val range = request.requestHeaders?.entries?.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value
        return runCatching { fileResponse(file, range) }.getOrNull()
    }

    private fun packageResponse(): WebResourceResponse {
        val f = UsbCacheIndex.packageManifest()
        if (f == null || !f.isFile) {
            return WebResourceResponse("application/json", "UTF-8", ByteArrayInputStream("{}".toByteArray())).apply {
                setStatusCodeAndReasonPhrase(404, "Not Found")
                responseHeaders = mapOf("Cache-Control" to "no-store")
            }
        }
        return WebResourceResponse("application/json", "UTF-8", f.inputStream()).apply {
            setStatusCodeAndReasonPhrase(200, "OK")
            responseHeaders = mapOf("Cache-Control" to "no-store", "Content-Length" to f.length().toString())
        }
    }

    private fun fileResponse(file: File, rangeHeader: String?): WebResourceResponse {
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
        val length = file.length()
        val range = UsbRange.parse(rangeHeader, length)
        val base = mutableMapOf(
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin" to "*",
            "X-EduCMS-Source" to "usb-cache",
        )
        if (range == null) {
            return WebResourceResponse(mime, null, file.inputStream()).apply {
                setStatusCodeAndReasonPhrase(200, "OK")
                responseHeaders = base + ("Content-Length" to length.toString())
            }
        }
        val count = range.last - range.first + 1
        return WebResourceResponse(mime, null, sliceStream(file, range.first, count)).apply {
            setStatusCodeAndReasonPhrase(206, "Partial Content")
            responseHeaders = base + mapOf(
                "Content-Length" to count.toString(),
                "Content-Range" to "bytes ${range.first}-${range.last}/$length",
            )
        }
    }

    private fun sliceStream(file: File, start: Long, count: Long): InputStream {
        val raf = RandomAccessFile(file, "r")
        raf.seek(start)
        val raw = object : InputStream() {
            override fun read(): Int = raf.read()
            override fun read(b: ByteArray, off: Int, len: Int): Int = raf.read(b, off, len)
            override fun close() = raf.close()
        }
        return object : FilterInputStream(raw) {
            private var left = count
            override fun read(): Int {
                if (left <= 0) return -1
                val r = super.read()
                if (r >= 0) left--
                return r
            }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (left <= 0) return -1
                val n = super.read(b, off, minOf(len.toLong(), left).toInt())
                if (n > 0) left -= n
                return n
            }
        }
    }
}
