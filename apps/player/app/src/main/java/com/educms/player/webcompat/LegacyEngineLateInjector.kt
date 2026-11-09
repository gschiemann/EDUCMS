package com.educms.player.webcompat

import android.webkit.WebView
import com.educms.player.logging.PlayerLogger

/**
 * The legacy-engine layer's LATE path (rules in [LegacyEnginePolicy], "THE
 * LATE PATH"): on an engine without `DOCUMENT_START_SCRIPT`, the same asset is
 * evaluated into each main-frame document of an opted-in view.
 *
 * TIMING IS THE WHOLE GAME (sandbox 2026-11-09,
 * `docs/handoffs/2026-11-09-metabase-late-injection-sandbox.md`): a Metabase
 * 0.64 that boots before the layer lands treats its session as signed out —
 * the login works once, then every reload bounces to /auth/login. Injected by
 * DOMContentLoaded it works across login, reload and nine routes. So the
 * view's WebViewClient feeds this every early moment it has:
 *  - [onDocumentStarted] from `onPageStarted` (WebView dispatches it at commit);
 *  - [onResource] from `onLoadResource` — the first [RESOURCE_SHOTS] subresource
 *    loads of the document, i.e. before a `defer` bundle can have run;
 *  - [onDocument] from `onPageCommitVisible` and `onPageFinished` (safety net).
 * The asset feature-detects, so every repeat is a no-op.
 *
 * Proof, durable: the first time the layer is seen in a page, the line
 * `PLAYER_LEGACY_POLYFILL installed webview=N features=N view=V mode=late
 * first=<readyState>`; and whenever the earliest proven landing in a document
 * was AFTER parsing (`interactive`/`complete` — too late for a boot-time
 * builtin), `PLAYER_LEGACY_POLYFILL late-after-parse …` (bounded), so the
 * on-glass check can tell "in time" from "lucky".
 *
 * It evaluates the polyfill asset and one read-only probe, and nothing else —
 * no bridge, no listener, no JavaScript interface. Never throws. Main thread
 * only (WebViewClient callbacks).
 */
class LegacyEngineLateInjector(
    private val script: String,
    private val major: Int,
    private val features: Int,
    private val view: String,
) {
    private var docUrl: String? = null
    private var docGeneration = 0
    private var docAssessed = false
    private var resourceShots = 0
    private var proven = false
    private var afterParseLogged = 0
    private var failedLogged = false

    /** `onPageStarted`: a new main-frame document. */
    fun onDocumentStarted(webView: WebView?, url: String?) {
        docGeneration++
        docUrl = url
        docAssessed = false
        resourceShots = 0
        inject(webView, url)
    }

    /** `onLoadResource`: the document is fetching its files — the bundle has not run yet. */
    fun onResource(webView: WebView?) {
        if (resourceShots >= RESOURCE_SHOTS) return
        resourceShots++
        inject(webView, docUrl)
    }

    /** `onPageCommitVisible` / `onPageFinished`. */
    fun onDocument(webView: WebView?, url: String?) {
        if (url != null && url != docUrl) {
            docUrl = url
            docAssessed = false
        }
        inject(webView, url)
    }

    private fun inject(webView: WebView?, url: String?) {
        if (webView == null || !LegacyEnginePolicy.lateTargetUrl(url)) return
        try {
            webView.evaluateJavascript(script, null)
            if (docAssessed) return
            val generation = docGeneration
            val expected = url
            webView.evaluateJavascript(LegacyEnginePolicy.LATE_PROBE_JS) { raw ->
                if (generation != docGeneration || docAssessed) return@evaluateJavascript
                val probe = LegacyEnginePolicy.parseLateProbe(raw) ?: return@evaluateJavascript
                // A shot that landed in the outgoing document says nothing about this one.
                if (!LegacyEnginePolicy.sameDocument(probe.href, expected)) return@evaluateJavascript
                if (!probe.present) return@evaluateJavascript
                docAssessed = true
                if (!proven) {
                    proven = true
                    PlayerLogger.durable("INFO", TAG, LegacyEnginePolicy.lateInstalledLine(major, features, view, probe.readyState))
                }
                if (probe.readyState != "loading" && afterParseLogged < AFTER_PARSE_LOG_CAP) {
                    afterParseLogged++
                    PlayerLogger.durable("WARN", TAG, LegacyEnginePolicy.lateAfterParseLine(view, probe.readyState))
                }
            }
        } catch (t: Throwable) {
            if (!failedLogged) {
                failedLogged = true
                PlayerLogger.w(TAG, "PLAYER_LEGACY_POLYFILL late inject failed view=$view: ${t.message}")
            }
        }
    }

    companion object {
        private const val TAG = "LegacyEngineCompat"
        /** Subresource loads per document that each get a shot (the first ones are the bundle's). */
        const val RESOURCE_SHOTS = 3
        private const val AFTER_PARSE_LOG_CAP = 5
    }
}
