package com.educms.player.webcompat

import android.content.Context
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.educms.player.logging.PlayerLogger

/**
 * The legacy-engine compatibility layer — THE INSTALL (rules in
 * [LegacyEnginePolicy]).
 *
 * Called once per WebView from every place the APK configures one that can
 * show a third-party page: the player WebView (`MainActivity.configureWebView`,
 * which carries website zones in iframes), the website/Website Tabs view
 * (`MainActivity.configureUrlOverlay`) and each second-display face
 * (`FacePlayerHost.configureWebView`) — including the fresh WebView each of
 * those builds after a renderer death, since they re-run the same configure.
 *
 * What it can and cannot do: it registers ONE document-start script whose
 * only effect is to define missing JavaScript builtins in page context. It
 * adds no bridge, no message listener and no JavaScript interface; it reads
 * nothing back from the page. On the player WebViews the player's own origin
 * is skipped inside the script, so the player bundle and its emergency path
 * see exactly the engine they saw before. Never throws.
 */
object LegacyEngineCompat {
    private const val TAG = "LegacyEngineCompat"

    @Volatile private var asset: String? = null
    @Volatile private var assetFailed = false

    /**
     * @param view a short name for the log line (`player`, `overlay`, `face-1`).
     * @param skipOrigins origins whose documents must be left untouched.
     */
    fun install(context: Context, webView: WebView, view: String, skipOrigins: List<String> = emptyList()) {
        try {
            val versionName = try {
                WebViewCompat.getCurrentWebViewPackage(context)?.versionName
            } catch (t: Throwable) {
                null
            }
            val major = LegacyEnginePolicy.majorOf(versionName)
            val documentStart = try {
                WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            } catch (t: Throwable) {
                false
            }
            val decision = LegacyEnginePolicy.decide(major, documentStart)
            if (decision != LegacyEnginePolicy.Decision.INSTALL || major == null) {
                if (decision != LegacyEnginePolicy.Decision.SKIP_MODERN) {
                    PlayerLogger.i(TAG, "PLAYER_LEGACY_POLYFILL skipped view=$view reason=$decision webview=${versionName ?: "unknown"}")
                }
                return
            }
            val source = loadAsset(context) ?: return
            val script = LegacyEnginePolicy.scriptFor(source, skipOrigins)
            if (script == null) {
                PlayerLogger.w(TAG, "PLAYER_LEGACY_POLYFILL skipped view=$view reason=MALFORMED_ASSET")
                return
            }
            WebViewCompat.addDocumentStartJavaScript(webView, script, LegacyEnginePolicy.ALLOWED_ORIGINS)
            PlayerLogger.durable(
                "INFO", TAG,
                LegacyEnginePolicy.installedLine(major, LegacyEnginePolicy.featureCount(source), view),
            )
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "PLAYER_LEGACY_POLYFILL failed view=$view: ${t.message}")
        }
    }

    private fun loadAsset(context: Context): String? {
        asset?.let { return it }
        if (assetFailed) return null
        return try {
            context.assets.open(LegacyEnginePolicy.ASSET_PATH).bufferedReader(Charsets.UTF_8).use { it.readText() }
                .also { asset = it }
        } catch (t: Throwable) {
            assetFailed = true
            PlayerLogger.w(TAG, "PLAYER_LEGACY_POLYFILL asset unreadable: ${t.message}")
            null
        }
    }
}
