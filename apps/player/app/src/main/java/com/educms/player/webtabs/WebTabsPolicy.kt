package com.educms.player.webtabs

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Website Tabs — every DECISION the native site view makes, as pure functions
 * (2026-09-28).
 *
 * The web widget (`apps/web/src/components/widgets/WebsiteTabsWidget.tsx`)
 * hands MainActivity a `webTabsShow` JSON: a URL, the device-pixel bounds of
 * the site area, the tabs' hosts, whether the kiosk is incognito, and the
 * localised copy for the two pages this side has to paint. MainActivity lays
 * the overlay WebView out to those bounds and consults THIS object for what
 * that WebView may do. Nothing here touches Android, so every rule below is
 * unit-tested on the JVM (`WebTabsPolicyTest`).
 *
 * ── THE SECURITY POSTURE, IN ONE PLACE ────────────────────────────────
 *  • DEFAULT DENY. A top-level navigation is allowed only to a host that is
 *    one of the tabs' hosts (or a dot-boundary subdomain of one). Everything
 *    else — a link to another site, a redirect off the site, a login
 *    provider on a third host — gets the "This kiosk only shows these sites"
 *    page and the kiosk never leaves. The list comes from the tabs the
 *    operator configured, and from nothing else.
 *  • WEB SCHEMES ONLY. `file:`, `content:`, `intent:`, `javascript:`,
 *    `data:` and every other non-http(s) scheme are refused as navigations
 *    in this view — for Website Tabs AND for the plain URL-asset overlay,
 *    which used to let them through. `about:blank` is allowed because we
 *    load it ourselves to clear the view.
 *  • NO BRIDGE. The overlay WebView never gets `addJavascriptInterface`,
 *    `addWebMessageListener` or a document-start script; the only script it
 *    ever runs from us is the remote-control spatial-navigation shim. A site
 *    it shows can therefore reach no native method. `WebTabsWiringTest`
 *    pins that as a source fact.
 *  • SIGN OUT ON IDLE. `webTabsHide({wipe:true})` clears cookies, the
 *    current page's storage, every visited origin's quota storage, the
 *    cache, history and form data. Cookies are process-wide on Android — the
 *    player page holds none (its device credential is a localStorage token,
 *    which this never touches), so wiping them costs the sites their logins
 *    and the player nothing. `WebStorage.deleteAllData()` is deliberately
 *    NOT used: it would erase the player's own localStorage, credential
 *    included (CLAUDE.md player rule 3).
 */
object WebTabsPolicy {

    /** The payload version this build understands. Anything else is refused. */
    const val VERSION = 1

    /** Device-pixel rectangle of the site area. */
    data class Bounds(val left: Int, val top: Int, val width: Int, val height: Int)

    /** Copy for the pages this side paints, localised by the web widget. */
    data class Copy(
        val title: String,
        val body: String,
        val back: String,
        val offlineTitle: String,
        val offlineBody: String,
    ) {
        companion object {
            val FALLBACK = Copy(
                title = "This kiosk only shows these sites",
                body = "Tap a tab to keep browsing.",
                back = "Back",
                offlineTitle = "Can't reach this site right now",
                offlineBody = "Check the screen's internet connection.",
            )
        }
    }

    data class ShowRequest(
        val url: String,
        val bounds: Bounds,
        /** Normalised hosts (lower-case, no `www.`); see [normalizeHost]. */
        val allowHosts: List<String>,
        val incognito: Boolean,
        val sessionKey: String,
        val focus: Boolean,
        val copy: Copy,
    )

    data class HideRequest(val wipe: Boolean)

    /** Widest / tallest site area we will lay out — a sanity ceiling, not a limit any panel reaches. */
    private const val MAX_EDGE_PX = 16384

    /**
     * Parse `webTabsShow`'s argument. Null when the payload is not something
     * this build should act on — wrong version, no usable URL, degenerate
     * bounds, or an empty allowlist (a Website Tabs zone always has at least
     * the URL's own host; an empty list would mean "allow nothing", which is a
     * blank screen, so it is refused loudly instead).
     */
    fun parseShowRequest(json: String?): ShowRequest? {
        if (json.isNullOrBlank()) return null
        val o = try {
            JSONObject(json)
        } catch (_: Exception) {
            return null
        }
        if (o.optInt("v", -1) != VERSION) return null
        val url = o.optString("url", "").trim()
        if (!isWebUrl(url)) return null
        val b = o.optJSONObject("bounds") ?: return null
        val bounds = Bounds(
            left = b.optInt("left", -1),
            top = b.optInt("top", -1),
            width = b.optInt("width", 0),
            height = b.optInt("height", 0),
        )
        if (bounds.left < 0 || bounds.top < 0) return null
        if (bounds.width <= 0 || bounds.height <= 0) return null
        if (bounds.width > MAX_EDGE_PX || bounds.height > MAX_EDGE_PX) return null
        val hosts = parseHosts(o.optJSONArray("allowHosts"))
        // The start URL must itself be inside the allowlist, or the very first
        // page would be the blocked page.
        if (hosts.isEmpty() || !isAllowedNavigation(url, hosts)) return null
        val c = o.optJSONObject("copy")
        val copy = if (c == null) Copy.FALLBACK else Copy(
            title = c.optString("title", "").ifBlank { Copy.FALLBACK.title },
            body = c.optString("body", "").ifBlank { Copy.FALLBACK.body },
            back = c.optString("back", "").ifBlank { Copy.FALLBACK.back },
            offlineTitle = c.optString("offlineTitle", "").ifBlank { Copy.FALLBACK.offlineTitle },
            offlineBody = c.optString("offlineBody", "").ifBlank { Copy.FALLBACK.offlineBody },
        )
        return ShowRequest(
            url = url,
            bounds = bounds,
            allowHosts = hosts,
            incognito = o.optBoolean("incognito", true),
            sessionKey = o.optString("sessionKey", "").take(64),
            focus = o.optBoolean("focus", false),
            copy = copy,
        )
    }

    /**
     * Parse `webTabsHide`'s argument. Garbage or an empty string means
     * "just hide": hiding must never be refused (it is the recovery
     * direction), and a wipe is opt-in.
     */
    fun parseHideRequest(json: String?): HideRequest {
        if (json.isNullOrBlank()) return HideRequest(wipe = false)
        return try {
            val o = JSONObject(json)
            HideRequest(wipe = o.optBoolean("wipe", false))
        } catch (_: Exception) {
            HideRequest(wipe = false)
        }
    }

    private fun parseHosts(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until arr.length()) {
            val raw = arr.optString(i, "")
            val h = normalizeHost(raw) ?: continue
            if (!out.contains(h)) out.add(h)
            if (out.size >= 64) break
        }
        return out
    }

    /**
     * Lower-case, strip one leading `www.`, strip a trailing dot; null for
     * anything that is not a plausible hostname (spaces, slashes, a scheme,
     * an empty label). Mirrors the web's `tabHost`.
     */
    fun normalizeHost(raw: String?): String? {
        if (raw == null) return null
        var h = raw.trim().lowercase()
        if (h.isEmpty()) return null
        // www. first, THEN the trailing dot: the other order turned "www." into the
        // host "www" (WebTabsPolicyTest caught it).
        if (h.startsWith("www.")) h = h.removePrefix("www.")
        if (h.endsWith(".")) h = h.dropLast(1)
        if (h.isEmpty()) return null
        if (!HOST_PATTERN.matches(h)) return null
        return h
    }

    // Letters, digits, hyphens and dots only — no ports, paths or schemes.
    private val HOST_PATTERN = Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")

    /** True for a parseable `http(s)` URL with a real host and no embedded credentials. */
    fun isWebUrl(url: String?): Boolean {
        val u = parse(url) ?: return false
        val scheme = u.scheme?.lowercase() ?: return false
        if (scheme != "https" && scheme != "http") return false
        if (u.userInfo != null) return false
        val host = u.host?.lowercase() ?: return false
        return host.isNotEmpty()
    }

    /**
     * Is this navigation one the overlay may perform at all? Web URLs yes;
     * `about:blank` yes (we load it to clear the view); every other scheme —
     * `file:`, `content:`, `intent:`, `javascript:`, `data:`, `market:`,
     * `tel:` … — no. Applies to the plain URL-asset overlay too.
     */
    fun isNavigableScheme(url: String?): Boolean {
        if (url == null) return false
        val s = url.trim()
        if (s.equals("about:blank", ignoreCase = true)) return true
        return isWebUrl(s)
    }

    /**
     * The default-deny rule: allowed iff the URL is a web URL whose host is
     * exactly an allowed host, its `www.` form, or a dot-boundary subdomain
     * of one. `district.example.evil.com` is refused; so is an empty list.
     * Mirrors the web's `isUrlWithinTabs` exactly.
     */
    fun isAllowedNavigation(url: String?, allowHosts: List<String>): Boolean {
        if (!isWebUrl(url)) return false
        val host = parse(url)!!.host.lowercase().trimEnd('.')
        for (raw in allowHosts) {
            val a = normalizeHost(raw) ?: continue
            if (host == a || host == "www.$a") return true
            if (host.endsWith(".$a")) return true
        }
        return false
    }

    /** What the site view does with one main-frame navigation during a session. */
    enum class NavDecision { ALLOW, ALLOW_AND_LEARN, BLOCK }

    /** A session never remembers more sign-in hosts than this; past it, off-list navigations block. */
    const val MAX_LEARNED_HOSTS = 12

    /**
     * SIGN-IN FOLLOWING (v1.1.19). A site behind a sign-in sends the visitor
     * to its sign-in page on ANOTHER domain and back — demo.medpower.org →
     * login.learn.medpower.com → learn.medpower.org, every hop a server
     * redirect. Plain default-deny refused the first hop, so the kiosk showed
     * the blocked page where a laptop shows the login.
     *
     * The line is WHO is navigating:
     *  • the site itself — a server redirect, or its own script with no tap
     *    behind it — may go to another `https` host, and that host is
     *    remembered for the rest of the session so the sign-in page's own
     *    links and forms keep working;
     *  • a tap on "Sign in with …" that is an OAuth / OpenID Connect request
     *    whose `redirect_uri` comes back to the tabs' sites, likewise;
     *  • a visitor's tap on any other link off the tabs' sites: BLOCKED.
     * The caller forgets the remembered hosts when the session ends (idle
     * return, hide, sign-out), and never learns more than [MAX_LEARNED_HOSTS].
     */
    fun decideNavigation(
        url: String?,
        allowHosts: List<String>,
        learnedHosts: Collection<String>,
        isRedirect: Boolean,
        hasGesture: Boolean,
    ): NavDecision {
        if (isAllowedNavigation(url, allowHosts)) return NavDecision.ALLOW
        val host = hostOf(url) ?: return NavDecision.BLOCK
        if (learnedHosts.contains(host)) return NavDecision.ALLOW
        // Only an encrypted page is ever learned.
        if (parse(url)?.scheme?.lowercase() != "https") return NavDecision.BLOCK
        if (learnedHosts.size >= MAX_LEARNED_HOSTS) return NavDecision.BLOCK
        if (isRedirect || !hasGesture) return NavDecision.ALLOW_AND_LEARN
        if (isSignInRequest(url, allowHosts, learnedHosts)) return NavDecision.ALLOW_AND_LEARN
        return NavDecision.BLOCK
    }

    /**
     * An OAuth 2 / OpenID Connect authorization request (`client_id` plus a
     * `redirect_uri`) whose `redirect_uri` returns to one of the tabs' sites
     * or to a host this session already learned.
     */
    fun isSignInRequest(url: String?, allowHosts: List<String>, learnedHosts: Collection<String>): Boolean {
        val query = parse(url)?.rawQuery ?: return false
        val params = parseQuery(query)
        if (params["client_id"].isNullOrBlank()) return false
        val back = params["redirect_uri"] ?: return false
        if (isAllowedNavigation(back, allowHosts)) return true
        val backHost = hostOf(back) ?: return false
        return learnedHosts.contains(backHost)
    }

    /** The lower-cased host of a web URL, trailing dot dropped; null for anything else. */
    fun hostOf(url: String?): String? {
        if (!isWebUrl(url)) return null
        return parse(url)?.host?.lowercase()?.trimEnd('.')
    }

    private fun parseQuery(raw: String): Map<String, String> {
        val out = HashMap<String, String>()
        for (pair in raw.split('&')) {
            if (pair.isEmpty()) continue
            val i = pair.indexOf('=')
            val key = decodeQueryPart(if (i < 0) pair else pair.substring(0, i)) ?: continue
            val value = decodeQueryPart(if (i < 0) "" else pair.substring(i + 1)) ?: continue
            if (!out.containsKey(key)) out[key] = value
        }
        return out
    }

    private fun decodeQueryPart(s: String): String? =
        try {
            java.net.URLDecoder.decode(s, "UTF-8")
        } catch (_: Exception) {
            null
        }

    /**
     * The origins whose quota storage (IndexedDB, Cache Storage, WebSQL) a
     * sign-out clears through `WebStorage.deleteOrigin` — `https://` and
     * `http://` for each allowed host and its `www.` form, plus every origin
     * the overlay actually visited (subdomains the allowlist admitted).
     */
    fun wipeOriginsFor(allowHosts: List<String>, visitedOrigins: Collection<String>): List<String> {
        val out = LinkedHashSet<String>()
        for (raw in allowHosts) {
            val h = normalizeHost(raw) ?: continue
            out.add("https://$h")
            out.add("https://www.$h")
            out.add("http://$h")
            out.add("http://www.$h")
        }
        for (o in visitedOrigins) {
            val origin = originOf(o) ?: continue
            out.add(origin)
        }
        return out.toList()
    }

    /** `https://Host:443/path` → `https://host:443`; null for non-web. */
    fun originOf(url: String?): String? {
        val u = parse(url) ?: return null
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = u.host?.lowercase() ?: return null
        if (host.isEmpty()) return null
        return if (u.port >= 0) "$scheme://$host:${u.port}" else "$scheme://$host"
    }

    /**
     * The in-page half of the sign-out, run in the CURRENT document before we
     * navigate away: its localStorage / sessionStorage / IndexedDB / Cache
     * Storage. Per-origin by construction (it runs as that origin), which is
     * what makes it safe where `WebStorage.deleteAllData()` is not. ES5 only —
     * this string is evaluated in whatever WebView the panel ships.
     */
    const val WIPE_PAGE_STORAGE_JS: String =
        "(function(){try{localStorage.clear();}catch(e){}try{sessionStorage.clear();}catch(e){}" +
            "try{if(window.indexedDB&&indexedDB.databases){indexedDB.databases().then(function(l){" +
            "for(var i=0;i<l.length;i++){if(l[i]&&l[i].name){indexedDB.deleteDatabase(l[i].name);}}});}}catch(e){}" +
            "try{if(window.caches){caches.keys().then(function(k){for(var i=0;i<k.length;i++){caches.delete(k[i]);}});}}catch(e){}" +
            "})();"

    /** The page shown for a navigation outside the tabs' sites. Self-contained, no network, no script beyond Back. */
    fun blockedPageHtml(copy: Copy): String = messagePageHtml(copy.title, copy.body, copy.back, "#0f172a")

    /** The page shown when the site cannot be reached. */
    fun offlinePageHtml(copy: Copy): String = messagePageHtml(copy.offlineTitle, copy.offlineBody, copy.back, "#1e293b")

    private fun messagePageHtml(title: String, body: String, back: String, bg: String): String {
        val t = escapeHtml(title)
        val b = escapeHtml(body)
        val k = escapeHtml(back)
        return "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<style>html,body{margin:0;height:100%;background:$bg;color:#f8fafc;font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif}" +
            ".w{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;height:100%;padding:6vmin;box-sizing:border-box}" +
            "h1{font-size:5.2vmin;line-height:1.15;margin:0 0 3vmin;max-width:24em}p{font-size:2.8vmin;opacity:.78;margin:0 0 5vmin;max-width:32em}" +
            "button{font:inherit;font-size:3vmin;font-weight:800;padding:2.2vmin 5vmin;border-radius:999px;border:0;background:#f59e0b;color:#111;min-width:12em}" +
            "button:focus{outline:4px solid #fff;outline-offset:3px}</style></head>" +
            "<body><div class=\"w\"><h1>$t</h1><p>$b</p>" +
            "<button type=\"button\" autofocus onclick=\"try{history.back()}catch(e){}\">$k</button></div></body></html>"
    }

    /** `&<>"'` → entities. The copy comes from the web bundle, but it is still text going into HTML. */
    fun escapeHtml(s: String): String = buildString(s.length + 16) {
        for (ch in s) {
            when (ch) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&#39;")
                else -> append(ch)
            }
        }
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
}
