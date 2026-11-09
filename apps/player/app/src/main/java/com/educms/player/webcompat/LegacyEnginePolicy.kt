package com.educms.player.webcompat

import org.json.JSONArray

/**
 * The legacy-engine compatibility layer — THE RULES, pure (no Android), so
 * every branch is a JVM unit test (`LegacyEnginePolicyTest`).
 *
 * WHY. A frozen-firmware panel (Goodview GUQ, Android 11) ships system
 * WebView 95. Modern single-page apps (a Metabase 0.64 dashboard is the
 * field case) call builtins Chrome 95 lacks — `Array.prototype.findLast`,
 * `structuredClone`, `Object.groupBy`, Set methods, … — and die at login.
 * Such sites send `frame-ancestors 'none'` and a CSP without `unsafe-inline`,
 * so the only fix that reaches them is a document-start script registered on
 * the WebView itself (not subject to the page's CSP), loading the feature-
 * detected ES5 polyfills in `assets/legacy-engine-polyfills.js`.
 *
 * THE GATE. Install only when BOTH hold:
 *   1. the system WebView's major version is KNOWN and below
 *      [MODERN_WEBVIEW_MAJOR] — a modern engine (and an engine we cannot
 *      read) behaves exactly as before;
 *   2. the WebView supports `DOCUMENT_START_SCRIPT` (Chromium 83/87 Taurus
 *      class does not — it is skipped, never half-installed).
 *
 * THE LATE PATH (2026-11-09, field failure). The GUQ's WebView is the
 * platform-signed AOSP `com.android.webview` 95, and it does NOT offer
 * `DOCUMENT_START_SCRIPT` — so on the one panel the layer was built for it
 * logged `skipped reason=SKIP_NO_DOCUMENT_START` and the customer's Metabase
 * login still failed (`i?.throwIfAborted is not a function`). A view that
 * opts in (`lateAllowed`: the URL overlay, which shows the site as its own
 * top-level document) now gets [Decision.INSTALL_LATE] instead: the same
 * asset, evaluated into each main-frame document at page start, commit and
 * finish by [LegacyEngineLateInjector]. The asset feature-detects, so a
 * repeat is a no-op. It is late — page scripts may run first — which is
 * enough for builtins a site looks up when it calls them (the login's
 * `throwIfAborted`), not for ones it needs while its bundle first runs; on
 * Chrome 95 those already exist natively. Only for majors at or above
 * [LATE_INJECTION_MIN_MAJOR], so the Chromium 83/87 Taurus class is untouched.
 *
 * Failure direction: any doubt → not installed → today's behaviour.
 * Kill switch: none at runtime (auto-detected per device, no setting); it is
 * withdrawn by a build without it (revert, or the previous APK).
 */
object LegacyEnginePolicy {

    /** Engines at or above this Chromium major never load the layer. Chrome 120 has every builtin it adds except a few newer ones (Promise.try, Iterator helpers, Set methods, async-iterable streams) that SPAs rarely require. */
    const val MODERN_WEBVIEW_MAJOR = 120

    /** The APK asset the layer loads. */
    const val ASSET_PATH = "legacy-engine-polyfills.js"

    /** The placeholder in the asset the APK replaces with the origins to leave untouched. */
    const val SKIP_ORIGINS_PLACEHOLDER = "/*VENUEOS_SKIP_ORIGINS*/[]/*VENUEOS_SKIP_ORIGINS_END*/"

    /** Allowed-origin rule for `addDocumentStartJavaScript`: every frame, every origin. */
    val ALLOWED_ORIGINS: Set<String> = setOf("*")

    /** The oldest engine the late path runs on (the asset is proven on 91; Taurus 83/87 stays untouched). */
    const val LATE_INJECTION_MIN_MAJOR = 90

    enum class Decision { INSTALL, INSTALL_LATE, SKIP_MODERN, SKIP_UNKNOWN_VERSION, SKIP_NO_DOCUMENT_START }

    /** `95.0.4638.74` → 95. Null for anything that does not start with a plausible major. */
    fun majorOf(versionName: String?): Int? {
        val head = versionName?.trim()?.substringBefore('.')?.takeIf { it.isNotEmpty() } ?: return null
        if (head.length > 4 || !head.all { it in '0'..'9' }) return null
        return head.toIntOrNull()?.takeIf { it > 0 }
    }

    fun decide(major: Int?, documentStartSupported: Boolean, lateAllowed: Boolean = false): Decision = when {
        major == null -> Decision.SKIP_UNKNOWN_VERSION
        major >= MODERN_WEBVIEW_MAJOR -> Decision.SKIP_MODERN
        documentStartSupported -> Decision.INSTALL
        lateAllowed && major >= LATE_INJECTION_MIN_MAJOR -> Decision.INSTALL_LATE
        else -> Decision.SKIP_NO_DOCUMENT_START
    }

    /** The late path only targets real web documents — never `about:`, `data:` or our offline pages. */
    fun lateTargetUrl(url: String?): Boolean {
        val u = url?.trim()?.lowercase() ?: return false
        return u.startsWith("https://") || u.startsWith("http://")
    }

    /**
     * Evaluated after the layer, once per injector until it answers `true`:
     * proof the layer is present in the page (the field case's missing builtin).
     */
    const val LATE_PROBE_JS =
        "(function(){try{return typeof AbortSignal==='function'&&typeof AbortSignal.prototype.throwIfAborted==='function'}catch(e){return false}})()"

    /** The durable line once the late path is proven in a page. */
    fun lateInstalledLine(major: Int, features: Int, view: String): String =
        installedLine(major, features, view) + " mode=late"

    /** Feature groups in the asset: one `feature('…'` call per line start. */
    fun featureCount(script: String): Int =
        Regex("""(?m)^\s*feature\('""").findAll(script).count()

    /**
     * The script the WebView gets: the asset with [skipOrigins] (the player's
     * own origin on the player WebViews) substituted, so our own documents run
     * on exactly the engine they ran on before. Null when the asset lacks the
     * placeholder — a malformed asset is never installed.
     */
    fun scriptFor(asset: String, skipOrigins: List<String>): String? {
        if (!asset.contains(SKIP_ORIGINS_PLACEHOLDER)) return null
        val list = JSONArray().apply { skipOrigins.forEach { put(it) } }.toString()
        return asset.replace(SKIP_ORIGINS_PLACEHOLDER, list)
    }

    /** The durable line the on-glass check reads. */
    fun installedLine(major: Int, features: Int, view: String): String =
        "PLAYER_LEGACY_POLYFILL installed webview=$major features=$features view=$view"
}
