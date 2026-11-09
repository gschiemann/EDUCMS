package com.educms.player.webcompat

import android.webkit.WebView
import com.educms.player.logging.PlayerLogger

/**
 * The legacy-engine layer's LATE path (rules in [LegacyEnginePolicy], "THE
 * LATE PATH"): on an engine without `DOCUMENT_START_SCRIPT`, the same asset is
 * evaluated into each main-frame document of an opted-in view. The view's
 * WebViewClient calls [inject] from `onPageStarted`, `onPageCommitVisible`
 * and `onPageFinished`; the asset feature-detects, so every repeat is a no-op.
 *
 * What it can and cannot do: it evaluates the polyfill asset and one
 * read-only probe, and nothing else — no bridge, no listener, no JavaScript
 * interface. The probe's only use is the durable proof line. Never throws.
 * Main thread only (WebViewClient callbacks).
 */
class LegacyEngineLateInjector(
    private val script: String,
    private val major: Int,
    private val features: Int,
    private val view: String,
) {
    private var proven = false
    private var failedLogged = false

    fun inject(webView: WebView?, url: String?) {
        if (webView == null || !LegacyEnginePolicy.lateTargetUrl(url)) return
        try {
            webView.evaluateJavascript(script, null)
            if (!proven) {
                webView.evaluateJavascript(LegacyEnginePolicy.LATE_PROBE_JS) { result ->
                    if (!proven && result == "true") {
                        proven = true
                        PlayerLogger.durable("INFO", TAG, LegacyEnginePolicy.lateInstalledLine(major, features, view))
                    }
                }
            }
        } catch (t: Throwable) {
            if (!failedLogged) {
                failedLogged = true
                PlayerLogger.w(TAG, "PLAYER_LEGACY_POLYFILL late inject failed view=$view: ${t.message}")
            }
        }
    }

    private companion object {
        const val TAG = "LegacyEngineCompat"
    }
}
