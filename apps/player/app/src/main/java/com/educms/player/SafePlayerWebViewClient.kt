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
 *
 * Self-healing hooks added 2026-04-27 — the OS-default "webpage not
 * available" dialog used to wedge the kiosk forever when a Vercel /
 * Railway deploy briefly took the server offline. Now every main-frame
 * error and HTTP error feeds NetworkRecoveryController, which probes
 * /api/v1/health on a backoff and reloads the player when it's healthy.
 */
class SafePlayerWebViewClient(
    private val onRendererGone: () -> Unit,
    /** Called on main thread for any main-frame load failure. */
    private val onMainFrameError: ((label: String) -> Unit)? = null,
    /** Called on main thread when the page finishes loading successfully. */
    private val onPageFinishedOk: (() -> Unit)? = null,
    /**
     * SEC-002 — "a MAIN-FRAME document of the player is now current in this
     * WebView." Fires on `onPageStarted`, `onPageCommitVisible` AND
     * `onPageFinished` — three shots at three different points in a
     * navigation's life, because the gate they feed is default-deny and a
     * dropped delivery now costs the player's own chrome its control plane.
     * BEFORE
     * any of the success/abort qualification the other callbacks apply,
     * because its consumer is not measuring health: it re-delivers the
     * per-boot bridge nonce into the top frame on WebViews too old for a
     * document-start script (Chromium 83/87). Deliberately not gated on a
     * successful load — a nonce that is only delivered on healthy pages is a
     * nonce the recovery path cannot use.
     *
     * `about:` documents are filtered out here; they are our own internal
     * recovery step, not a player document.
     */
    private val onMainFrameDocument: ((view: WebView, url: String) -> Unit)? = null,
) : WebViewClient() {

    private fun notifyMainFrameDocument(view: WebView, url: String) {
        if (url.startsWith("about:")) return
        try {
            onMainFrameDocument?.invoke(view, url)
        } catch (t: Throwable) {
            Log.w("PlayerWeb", "onMainFrameDocument threw: ${t.message}")
        }
    }

    private val allowedHost: String? = runCatching {
        Uri.parse(BuildConfig.PLAYER_BASE_URL).host
    }.getOrNull()

    /**
     * 2026-08-30 (W2-3) — remembers whether the main frame failed during
     * the navigation that is currently finishing. See [LoadOutcomeTracker]
     * for why: an error document finishes loading like any other page, and
     * treating that as success disarmed recovery + the watchdog and pinned
     * lock task on a screen showing nothing.
     */
    private val loadOutcome = LoadOutcomeTracker()

    /**
     * C-P1-3 (2026-08-30 deep audit) — did WE kill the navigation that is
     * about to finish?
     *
     * WHY THIS EXISTS. Chromium reports a caller-initiated
     * `WebView.stopLoading()` as a CLEAN `onPageFinished` — never as an
     * error (crbug/473261). [LoadOutcomeTracker] therefore cannot see it:
     * no `onReceivedError` ever fires, so the finish looks like a
     * flawless load. That is load-bearing, because `onPageFinishedOk`
     * clears the recovery loop, zeroes the watchdog strike counter and
     * arms lock task. Every abort the watchdog issued was thus
     * self-certifying as a success on a page that had painted nothing —
     * the strike counter could never reach [WATCHDOG_UNPIN_AFTER_FAILURES]
     * on the one screen that most needed the valve.
     *
     * Contract: MainActivity calls [markNextFinishAborted] IMMEDIATELY
     * before each `stopLoading()` it issues. The flag is one-shot and is
     * cleared by whichever comes first — the aborted finish, or the next
     * genuine [onPageStarted]. So a `stopLoading()` on an idle WebView
     * (no finish ever arrives) cannot swallow a later real success.
     */
    private var abortedByUs: Boolean = false

    /**
     * C-P1-3 — arm the abort disqualifier. Call this on the main thread,
     * immediately BEFORE `webView.stopLoading()`.
     */
    fun markNextFinishAborted() {
        abortedByUs = true
    }

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
        // A new navigation — the previous one's failure no longer applies.
        loadOutcome.onPageStarted()
        // C-P1-3 — …and neither does the previous one's abort. A real
        // navigation is starting; whatever we killed before it is history.
        abortedByUs = false
        // SEC-002 — earliest point at which a top-frame script can land in
        // the new document.
        notifyMainFrameDocument(view, url)
    }

    /**
     * SEC-002 (re-audit, 2026-09-04) — the delivery point BETWEEN
     * `onPageStarted` and `onPageFinished`.
     *
     * This is the callback that fires when the new document has actually
     * COMMITTED and its first pixels are about to paint. It is the earliest
     * moment at which `evaluateJavascript` provably targets the new
     * document rather than the outgoing one — which is exactly the race that
     * could drop the `onPageStarted` attempt and leave the value undelivered
     * until `onPageFinished`, tens of seconds later on a slow panel.
     *
     * It matters more now than it did before the gate became default-deny:
     * the cost of a late delivery used to be an open surface, and is now a
     * shut control plane on the player's own chrome. API 23; `minSdk` is 24.
     */
    override fun onPageCommitVisible(view: WebView, url: String) {
        notifyMainFrameDocument(view, url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        // Skip about:blank — that's our internal step during recovery,
        // not a real success.
        if (url == "about:blank") return
        Log.d("PlayerWeb", "page finished: $url")
        // SEC-002 — second delivery attempt, before ANY of the
        // success/abort qualification below. `onPageStarted`'s injection can
        // be lost when the navigation had not committed yet; this one lands
        // in a document that provably exists. Both are idempotent.
        notifyMainFrameDocument(view, url)
        // C-P1-3 — an abort WE issued arrives here looking exactly like a
        // clean load (crbug/473261). Consume the flag and refuse to count
        // it: the watchdog aborted this page precisely because it was not
        // working, so certifying it as a success would undo the same
        // tick's own strike.
        if (abortedByUs) {
            abortedByUs = false
            Log.w("PlayerWeb", "page finished from our own stopLoading — not counting as success: $url")
            return
        }
        // 2026-08-30 (W2-3) — "finished" is NOT "succeeded". Chromium
        // finishes error documents too (net::ERR_* interstitials, and any
        // 4xx/5xx body), and onPageFinishedOk is load-bearing: it clears
        // the recovery loop, zeroes the watchdog failure counter and
        // engages lock task mode. A screen stuck on a 403 used to satisfy
        // all three and pin itself with nothing on the glass.
        if (!loadOutcome.onPageFinished()) {
            Log.w("PlayerWeb", "page finished after main-frame error — not counting as success: $url")
            return
        }
        onPageFinishedOk?.invoke()
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        // The default Android "Webpage not available" / net::ERR_* page
        // is the screen the operator gets stuck on. Trigger the recovery
        // controller so the kiosk auto-heals when the server returns.
        val msg = "${error.errorCode}: ${error.description}"
        Log.w("PlayerWeb", "main-frame error: $msg on ${request.url}")
        loadOutcome.onMainFrameError()
        onMainFrameError?.invoke(msg)
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (!request.isForMainFrame) return
        val code = errorResponse.statusCode
        // 2026-05-05 — operator: kiosk got stuck on Chromium's "Webpage
        // not available / net::ERR_HTTP_RESPONSE_CODE_FAILURE" page
        // after a Vercel redeploy. That error code maps to BOTH 4xx
        // and 5xx depending on what Vercel served mid-deploy (briefly
        // 404 while routes shuffle, or 502 while the rebuild propagates).
        //
        // Pre-fix: this method only triggered recovery on 5xx, so a 4xx
        // mid-deploy left the screen wedged forever (operator had to
        // power-cycle).
        //
        // Post-fix: trigger recovery on ANY non-2xx for the main frame.
        // The recovery loop probes /api/v1/health on a backoff and only
        // reloads when it sees status:ok — so we won't hammer a real
        // 404 forever, we'll just re-check until the deploy finishes.
        // For a paired screen hitting a genuinely-deleted URL, the
        // operator sees the Reconnecting overlay (much friendlier than
        // the OS error page) and pairing recovery / re-pair flow can
        // still resolve it. Better to over-recover than wedge.
        //
        // 2026-08-30 (W2-3) — the same non-2xx condition now ALSO
        // disqualifies the onPageFinished that follows. Chromium loads the
        // error body as a document and finishes it; before this, that
        // finish counted as a successful load and cancelled the very
        // recovery loop this method had just started.
        if (code !in 200..299) {
            val msg = "HTTP $code from ${request.url}"
            Log.w("PlayerWeb", "main-frame HTTP error: $msg")
            loadOutcome.onMainFrameError()
            onMainFrameError?.invoke(msg)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        Log.e("PlayerWeb", "renderer gone — didCrash=${detail.didCrash()}")
        onRendererGone()
        return true // we handled it; don't crash the host process
    }
}
