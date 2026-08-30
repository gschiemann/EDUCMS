package com.educms.player.security

import android.content.Context
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import java.net.URI

/**
 * Native host allowlist — the last line of defence for every network
 * destination the APK will talk to on behalf of JavaScript.
 *
 * ============================================================
 * WHY THIS EXISTS (2026-08-01 security remediation, AND-001)
 * ============================================================
 *
 * The `@JavascriptInterface` bridge (`WebAppBridge`, exposed as
 * `window.EduCmsNative`) is attached to the MAIN player WebView and is
 * therefore reachable from **every frame that WebView loads** — including
 * the operator-authored / third-party HTML the player deliberately mounts
 * in iframes. `removeJavascriptInterface` is never called and no bridge
 * method inspects the calling origin, so "only our trusted player page
 * calls this" was never true (see AND-002 in the same report).
 *
 * The worst consequence was `setBootstrap(apiRoot, fingerprint)`:
 * whatever host JS handed us was persisted to SharedPreferences and then
 * used by `OtaUpdateWorker` as the OTA server. Because the APK's signing
 * key is committed to a PUBLIC repo, an attacker-chosen OTA server means
 * an attacker-signed APK installs over us — persistent, reboot- and
 * OTA-surviving RCE on a school hallway display.
 *
 * So the OTA / bootstrap destination is now pinned in NATIVE code, where
 * JavaScript cannot reach it, and the check is applied BOTH at the setter
 * and at every point of USE (so a hostile value persisted by an older
 * build can never be honoured).
 *
 * ============================================================
 * MATCHING RULES — deliberately strict, fail closed
 * ============================================================
 *
 *  - The URL must PARSE as a hierarchical `java.net.URI`. Anything the
 *    parser rejects (backslashes, spaces, control bytes) is refused.
 *  - Scheme must be `https`. The only exception is a build whose
 *    compile-time `BuildConfig.PLAYER_BASE_URL` is itself `http://`
 *    (emulator / LAN dev builds) — and then only for that exact host.
 *    This anchors the dev exemption to a COMPILE-TIME constant instead
 *    of `BuildConfig.DEBUG`, which cannot be trusted here: the shipped
 *    kiosk APK is currently a debug-signed build.
 *  - Userinfo in the authority (`https://evil.com@venue-os.app/`) is
 *    refused outright — it is only ever a confusion vector for us.
 *  - Host match is EXACT equality or a DOT-BOUNDARY suffix. Never
 *    `contains()` / `startsWith()`:
 *        "venue-os.app"            → allowed (exact)
 *        "staging-api.venue-os.app" → allowed (dot boundary)
 *        "venue-os.app.evil.com"    → REFUSED
 *        "evilvenue-os.app"         → REFUSED
 *        "venue-os.app."            → REFUSED (trailing-dot FQDN)
 *
 * ============================================================
 * MAINTAINING THE LIST
 * ============================================================
 *
 * Adding a host here widens the OTA trust boundary — treat it like a
 * signing-key change, not a config tweak. NEVER add a shared multi-tenant
 * apex (`up.railway.app`, `vercel.app`, `herokuapp.com`, `github.io`):
 * anyone can deploy under those, so a dot-boundary suffix match on them
 * is equivalent to no allowlist at all. Pin the full host.
 */
object HostAllowlist {

    private const val TAG = "HostAllowlist"
    private const val PREFS = "edu_player"
    private const val PREF_API_ROOT = "api_root"

    /**
     * First-party hosts, in addition to the compile-time
     * `BuildConfig.PLAYER_BASE_URL` host (added automatically below).
     *
     *  - `venue-os.app`                      web player + any first-party
     *                                        api/staging subdomain.
     *  - `api-production-39a1.up.railway.app` the production API origin the
     *                                        web player passes to
     *                                        `setBootstrap()` (pinned in
     *                                        full — NOT `up.railway.app`).
     *  - `github.com`                        release-asset host for the OTA
     *                                        APK (`browser_download_url`).
     *                                        The 302 to
     *                                        `*.githubusercontent.com` is
     *                                        followed by HttpURLConnection
     *                                        itself and is deliberately NOT
     *                                        listed — `raw.githubusercontent
     *                                        .com` serves arbitrary user
     *                                        repos and must never be a
     *                                        first-hop OTA source.
     */
    private val STATIC_HOSTS = arrayOf(
        "venue-os.app",
        "api-production-39a1.up.railway.app",
        "github.com",
    )

    private val baseScheme: String? = schemeOf(BuildConfig.PLAYER_BASE_URL)
    private val baseHost: String? = hostOf(BuildConfig.PLAYER_BASE_URL)

    private val allowedHosts: List<String> = run {
        val out = ArrayList<String>()
        val bh = baseHost
        if (bh != null && bh.isNotEmpty()) out.add(bh)
        for (h in STATIC_HOSTS) {
            val n = h.lowercase()
            if (!out.contains(n)) out.add(n)
        }
        out
    }

    /**
     * C-P1-5 (2026-08-30 deep audit) — the API-ROOT allowlist: strictly
     * narrower than [allowedHosts], and the ONLY list `api_root` may come
     * from.
     *
     * WHAT WENT WRONG. `setBootstrap` validated its `apiRoot` against the
     * broad first-party list, which necessarily includes the OTA release
     * host `github.com` — a host that serves no API at all. The bridge is
     * reachable from every frame the player WebView loads, so any iframe
     * could persist `api_root = https://github.com`, and that one write
     * quietly severed FOUR independent lifelines at once, all of them
     * derived from the same pref:
     *
     *   • the recovery loop's `/api/v1/health` probe can never succeed ⇒
     *     a screen that enters recovery stays there until a power cycle,
     *     which is the exact wedge NetworkRecoveryController exists to
     *     prevent;
     *   • `HeartbeatService` posts its status nowhere ⇒ the dashboard
     *     shows the screen OFFLINE while it is running fine;
     *   • the OTA + ota-state calls stop resolving;
     *   • diagnostics uploads stop resolving.
     *
     * And it SURVIVES reboot and OTA, because it is a persisted pref.
     *
     * Matching mechanics are identical to [isAllowed] — parse, no
     * userinfo, https (or the compile-time http dev exemption, which is
     * what keeps `http://10.0.2.2:3000` working for emulator builds),
     * exact host or dot-boundary suffix. Only the SET narrows: the
     * compile-time player host and the pinned production API host. A
     * dot-boundary match is retained for those two because we own the
     * `venue-os.app` apex and legitimately run `staging-api.venue-os.app`;
     * `api-production-39a1.up.railway.app` is pinned in full precisely
     * because `up.railway.app` is a shared multi-tenant apex.
     *
     * @param rawUrl the candidate API ROOT (a URL — `https://host[:port]`,
     *        optionally with a path we ignore), not a bare hostname.
     */
    fun isApiHost(rawUrl: String?): Boolean {
        val uri = parse(rawUrl) ?: return false
        if (uri.userInfo != null) return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val rawHost = uri.host ?: return false
        val host = rawHost.lowercase()
        if (host.isEmpty()) return false
        if (!schemeOk(scheme, host)) return false
        for (allowed in apiHosts) {
            if (host == allowed) return true
            if (host.endsWith(".$allowed")) return true
        }
        return false
    }

    /**
     * The API-root set. Deliberately does NOT include `github.com` (nor
     * any other OTA-download host) — adding one back re-opens C-P1-5.
     */
    private val apiHosts: List<String> = run {
        val out = ArrayList<String>()
        val bh = baseHost
        if (bh != null && bh.isNotEmpty()) out.add(bh)
        val api = "api-production-39a1.up.railway.app"
        if (!out.contains(api)) out.add(api)
        out
    }

    /** [isApiHost] plus a WARN log naming the caller, like [requireAllowed]. */
    fun requireApiHost(callSite: String, rawUrl: String?): Boolean {
        if (isApiHost(rawUrl)) return true
        PlayerLogger.w(
            TAG,
            "BLOCKED $callSite — host is not an allowed VenueOS API root: ${describe(rawUrl)} " +
                "(allowed: ${apiHosts.joinToString(", ")})",
        )
        return false
    }

    /**
     * True when [rawUrl] is a syntactically-sound https URL whose host is
     * on the first-party allowlist. Everything else — including null,
     * blank, unparseable, non-https, userinfo-bearing and unknown-host
     * URLs — returns false.
     */
    fun isAllowed(rawUrl: String?): Boolean {
        val uri = parse(rawUrl) ?: return false
        if (uri.userInfo != null) return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val rawHost = uri.host ?: return false
        val host = rawHost.lowercase()
        if (host.isEmpty()) return false
        if (!schemeOk(scheme, host)) return false
        for (allowed in allowedHosts) {
            if (host == allowed) return true
            if (host.endsWith(".$allowed")) return true
        }
        return false
    }

    /**
     * [isAllowed] plus a WARN log naming the caller. Returns the same
     * boolean so call sites read as a guard clause.
     */
    fun requireAllowed(callSite: String, rawUrl: String?): Boolean {
        if (isAllowed(rawUrl)) return true
        PlayerLogger.w(TAG, "BLOCKED $callSite — host is not on the native allowlist: ${describe(rawUrl)}")
        return false
    }

    /**
     * Scheme / syntax sanity for a URL we are going to RENDER (not one we
     * authenticate to): parseable, https (or the dev-build exemption), a
     * real host, no embedded credentials.
     *
     * Deliberately does NOT apply the host allowlist — see the comment on
     * `WebAppBridge.showUrlOverlay`; that surface legitimately displays
     * arbitrary operator-chosen customer websites.
     */
    fun isSafeWebUrl(rawUrl: String?): Boolean {
        val uri = parse(rawUrl) ?: return false
        if (uri.userInfo != null) return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val rawHost = uri.host ?: return false
        val host = rawHost.lowercase()
        if (host.isEmpty()) return false
        return schemeOk(scheme, host)
    }

    /**
     * Log-safe rendering of a URL: scheme + host only. Never log the full
     * URL — query strings on our own endpoints can carry device tokens.
     */
    fun describe(rawUrl: String?): String {
        if (rawUrl == null) return "(null)"
        val uri = parse(rawUrl) ?: return "(unparseable, ${rawUrl.length} chars)"
        return (uri.scheme ?: "?") + "://" + (uri.host ?: "?")
    }

    /** For boot diagnostics. */
    fun allowedHostsForLog(): String = allowedHosts.joinToString(", ")

    /**
     * The compile-time player ORIGIN — `scheme://host` (plus `:port` when
     * `BuildConfig.PLAYER_BASE_URL` carries a non-default one). Null when
     * the constant is unparseable.
     *
     * This is the trust anchor for the AND-002 bridge channel: it is the
     * exact origin `MainActivity.loadPlayer()` navigates to, so it is the
     * only origin allowed to speak to native code. Deliberately NOT the
     * host allowlist above — that list intentionally also covers the API
     * and OTA hosts, which must never be able to drive the bridge.
     *
     * See `com.educms.player.security.NativeBridgeChannel`.
     */
    fun playerOrigin(): String? {
        val uri = parse(BuildConfig.PLAYER_BASE_URL) ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val rawHost = uri.host ?: return null
        val host = rawHost.lowercase()
        if (host.isEmpty()) return null
        val port = uri.port
        return if (port >= 0) "$scheme://$host:$port" else "$scheme://$host"
    }

    /**
     * Boot-time self-heal. An APK built before this allowlist existed may
     * have persisted an attacker-supplied `api_root`; every background
     * consumer (heartbeat, crash upload, OTA-state reports, Manager
     * bootstrap) reads that pref directly. Purging it once per process
     * start closes all of them at the same time — the web player re-calls
     * `setBootstrap()` on its next page load, which re-populates the pref
     * only if the value passes [isApiHost].
     *
     * C-P1-5 — this now judges with [isApiHost], not [isAllowed]. A screen
     * poisoned with `api_root = https://github.com` by a build that only
     * had the broad check therefore self-heals on its very next process
     * start, without waiting for a page load.
     */
    fun sanitizePersistedApiRoot(ctx: Context) {
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val saved = prefs.getString(PREF_API_ROOT, null)
            if (saved == null || saved.isBlank()) return
            if (isApiHost(saved)) return
            PlayerLogger.e(
                TAG,
                "PURGING persisted api_root — not an allowed VenueOS API root: ${describe(saved)} " +
                    "(allowed: ${apiHosts.joinToString(", ")})",
            )
            prefs.edit().remove(PREF_API_ROOT).apply()
        } catch (ex: Exception) {
            PlayerLogger.w(TAG, "sanitizePersistedApiRoot failed: ${ex.message}")
        }
    }

    // ─── internals ──────────────────────────────────────────────

    private fun schemeOk(scheme: String, host: String): Boolean {
        if (scheme == "https") return true
        // Dev-build exemption, anchored to the compile-time base URL only.
        val bh = baseHost
        return scheme == "http" && baseScheme == "http" && bh != null && host == bh
    }

    private fun parse(raw: String?): URI? {
        if (raw == null) return null
        val s = raw.trim()
        if (s.isEmpty()) return null
        return try {
            val u = URI(s)
            if (u.isOpaque) null else u
        } catch (_: Exception) {
            null
        }
    }

    private fun schemeOf(raw: String?): String? = parse(raw)?.scheme?.lowercase()

    private fun hostOf(raw: String?): String? {
        val h = parse(raw)?.host ?: return null
        val n = h.lowercase()
        return if (n.isEmpty()) null else n
    }
}
