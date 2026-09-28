package com.educms.player.webtabs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Website Tabs — the rules the native site view enforces, on the JVM
 * (2026-09-28).
 *
 * The overlay WebView shows whatever site the operator pasted, so the whole
 * security argument is "it can navigate NOWHERE else and it can reach NO
 * native surface". The second half is a source fact ([WebTabsWiringTest]);
 * this file is the first half, plus the sign-out plan and the payload
 * contract with the web widget (`website-tabs-config.ts` mirrors these
 * exactly — same allowlist semantics, same version, same copy keys).
 */
class WebTabsPolicyTest {

    private val hosts = listOf("district.example", "lunch.example")

    // ─── the default-deny allowlist ─────────────────────────────────────

    @Test
    fun `allows the tabs' hosts, their www forms and dot-boundary subdomains only`() {
        assertTrue(WebTabsPolicy.isAllowedNavigation("https://district.example/anything?x=1", hosts))
        assertTrue(WebTabsPolicy.isAllowedNavigation("https://www.district.example/", hosts))
        assertTrue(WebTabsPolicy.isAllowedNavigation("https://portal.district.example/login", hosts))
        assertTrue(WebTabsPolicy.isAllowedNavigation("http://lunch.example/menu", hosts))
        assertTrue(WebTabsPolicy.isAllowedNavigation("https://DISTRICT.example/", hosts))

        assertFalse(WebTabsPolicy.isAllowedNavigation("https://evil.example/", hosts))
        assertFalse(WebTabsPolicy.isAllowedNavigation("https://district.example.evil.com/", hosts))
        assertFalse(WebTabsPolicy.isAllowedNavigation("https://notdistrict.example/", hosts))
        assertFalse(WebTabsPolicy.isAllowedNavigation("https://district.example@evil.com/", hosts))
    }

    @Test
    fun `an empty allowlist admits nothing — never fail open`() {
        assertFalse(WebTabsPolicy.isAllowedNavigation("https://district.example/", emptyList()))
        assertFalse(WebTabsPolicy.isAllowedNavigation("https://district.example/", listOf("", "  ")))
    }

    // ─── schemes ────────────────────────────────────────────────────────

    @Test
    fun `non-web schemes are never navigable, in any allowlist state`() {
        val hostile = listOf(
            "file:///sdcard/Download/x.apk",
            "content://com.android.providers.downloads/1",
            "intent://scan/#Intent;scheme=zxing;package=x;end",
            "javascript:alert(document.cookie)",
            "data:text/html,<script>1</script>",
            "market://details?id=com.evil",
            "tel:911",
            "about:srcdoc",
            "",
        )
        for (u in hostile) {
            assertFalse("navigable: $u", WebTabsPolicy.isNavigableScheme(u))
            assertFalse("allowed: $u", WebTabsPolicy.isAllowedNavigation(u, hosts))
        }
        assertFalse(WebTabsPolicy.isNavigableScheme(null))
        // about:blank is ours — we load it to clear the view.
        assertTrue(WebTabsPolicy.isNavigableScheme("about:blank"))
        assertTrue(WebTabsPolicy.isNavigableScheme("https://district.example/"))
    }

    // ─── host normalisation ─────────────────────────────────────────────

    @Test
    fun `hosts normalise to lower-case, no www, no trailing dot, and junk is refused`() {
        assertEquals("district.example", WebTabsPolicy.normalizeHost(" WWW.District.Example. "))
        assertEquals("a-b.c", WebTabsPolicy.normalizeHost("a-b.c"))
        assertNull(WebTabsPolicy.normalizeHost("https://district.example"))
        assertNull(WebTabsPolicy.normalizeHost("district.example/path"))
        assertNull(WebTabsPolicy.normalizeHost("district example"))
        assertNull(WebTabsPolicy.normalizeHost("www."))
        assertNull(WebTabsPolicy.normalizeHost(""))
        assertNull(WebTabsPolicy.normalizeHost(null))
    }

    // ─── the show payload ───────────────────────────────────────────────

    private fun show(
        url: String = "https://www.district.example/portal",
        bounds: String = """{"left":0,"top":160,"width":1600,"height":1040}""",
        hosts: String = """["district.example","lunch.example"]""",
        extra: String = "",
    ) = """{"v":1,"url":"$url","bounds":$bounds,"allowHosts":$hosts,"incognito":true,"sessionKey":"wt-1","focus":false,
        "copy":{"title":"Solo estos sitios","body":"Toque una pestaña","back":"Atrás","offlineTitle":"Sin conexión","offlineBody":"Compruebe la red"}$extra}"""

    @Test
    fun `parses a valid request`() {
        val r = WebTabsPolicy.parseShowRequest(show())
        assertNotNull(r)
        r!!
        assertEquals("https://www.district.example/portal", r.url)
        assertEquals(WebTabsPolicy.Bounds(0, 160, 1600, 1040), r.bounds)
        assertEquals(listOf("district.example", "lunch.example"), r.allowHosts)
        assertTrue(r.incognito)
        assertEquals("wt-1", r.sessionKey)
        assertFalse(r.focus)
        assertEquals("Solo estos sitios", r.copy.title)
        assertEquals("Atrás", r.copy.back)
        assertEquals("Sin conexión", r.copy.offlineTitle)
    }

    @Test
    fun `refuses a request this build does not understand`() {
        assertNull("wrong version", WebTabsPolicy.parseShowRequest(show().replace("\"v\":1", "\"v\":2")))
        assertNull("no version", WebTabsPolicy.parseShowRequest(show().replace("\"v\":1,", "")))
        assertNull("not json", WebTabsPolicy.parseShowRequest("nope"))
        assertNull("empty", WebTabsPolicy.parseShowRequest(""))
        assertNull("null", WebTabsPolicy.parseShowRequest(null))
    }

    @Test
    fun `refuses a start URL that is not a web URL or not inside its own allowlist`() {
        assertNull(WebTabsPolicy.parseShowRequest(show(url = "javascript:alert(1)")))
        assertNull(WebTabsPolicy.parseShowRequest(show(url = "file:///sdcard/x.html")))
        assertNull(WebTabsPolicy.parseShowRequest(show(url = "https://evil.example/")))
        assertNull("empty allowlist", WebTabsPolicy.parseShowRequest(show(hosts = "[]")))
        assertNull("no allowlist", WebTabsPolicy.parseShowRequest(show().replace(""","allowHosts":["district.example","lunch.example"]""", "")))
    }

    @Test
    fun `refuses degenerate bounds`() {
        assertNull(WebTabsPolicy.parseShowRequest(show(bounds = """{"left":0,"top":0,"width":0,"height":100}""")))
        assertNull(WebTabsPolicy.parseShowRequest(show(bounds = """{"left":-5,"top":0,"width":100,"height":100}""")))
        assertNull(WebTabsPolicy.parseShowRequest(show(bounds = """{"left":0,"top":0,"width":100000,"height":100}""")))
        assertNull(WebTabsPolicy.parseShowRequest(show().replace(""""bounds":{"left":0,"top":160,"width":1600,"height":1040},""", "")))
    }

    @Test
    fun `normalises and de-duplicates the allowlist, and falls back to English copy`() {
        val r = WebTabsPolicy.parseShowRequest(
            """{"v":1,"url":"https://district.example/","bounds":{"left":1,"top":1,"width":10,"height":10},
               "allowHosts":["WWW.District.Example.","district.example","lunch.example/menu",""]}""",
        )
        assertNotNull(r)
        assertEquals(listOf("district.example"), r!!.allowHosts)
        assertEquals(WebTabsPolicy.Copy.FALLBACK, r.copy)
        assertTrue("incognito defaults ON", r.incognito)
    }

    @Test
    fun `hide parses wipe, and garbage means just hide`() {
        assertTrue(WebTabsPolicy.parseHideRequest("""{"v":1,"wipe":true}""").wipe)
        assertFalse(WebTabsPolicy.parseHideRequest("""{"v":1,"wipe":false}""").wipe)
        assertFalse(WebTabsPolicy.parseHideRequest("").wipe)
        assertFalse(WebTabsPolicy.parseHideRequest(null).wipe)
        assertFalse(WebTabsPolicy.parseHideRequest("not json").wipe)
    }

    // ─── the sign-out plan ──────────────────────────────────────────────

    @Test
    fun `the wipe covers both schemes, www forms and every visited origin — never everything`() {
        val origins = WebTabsPolicy.wipeOriginsFor(
            listOf("district.example"),
            listOf("https://portal.district.example", "https://portal.district.example/login?x", "not a url", "https://cdn.other.example:8443/a"),
        )
        assertEquals(
            listOf(
                "https://district.example",
                "https://www.district.example",
                "http://district.example",
                "http://www.district.example",
                "https://portal.district.example",
                "https://cdn.other.example:8443",
            ),
            origins,
        )
        // The player page's own origin is never in this list by construction:
        // it is neither a tab host nor a page the site view visited.
        assertFalse(origins.any { it.contains("venue-os.app") })
    }

    @Test
    fun `the in-page wipe script stays ES5 and balanced`() {
        val js = WebTabsPolicy.WIPE_PAGE_STORAGE_JS
        for (banned in listOf("=>", "`", "const ", "let ", "class ")) {
            assertFalse("uses $banned", js.contains(banned))
        }
        assertEquals(js.count { it == '(' }, js.count { it == ')' })
        assertEquals(js.count { it == '{' }, js.count { it == '}' })
        assertTrue(js.contains("localStorage.clear()"))
        assertTrue(js.contains("sessionStorage.clear()"))
        assertTrue(js.contains("indexedDB"))
        assertTrue(js.contains("caches"))
    }

    // ─── the pages this side paints ─────────────────────────────────────

    @Test
    fun `the blocked and offline pages carry the copy, escaped, and only a Back button`() {
        val copy = WebTabsPolicy.Copy("A <b>", "B & \"c\"", "Back'", "Off <i>", "Line & more")
        val blocked = WebTabsPolicy.blockedPageHtml(copy)
        assertTrue(blocked.contains("A &lt;b&gt;"))
        assertTrue(blocked.contains("B &amp; &quot;c&quot;"))
        assertTrue(blocked.contains("Back&#39;"))
        assertFalse(blocked.contains("<b>"))
        assertTrue(blocked.contains("history.back()"))
        assertFalse("no network references", blocked.contains("http"))
        val offline = WebTabsPolicy.offlinePageHtml(copy)
        assertTrue(offline.contains("Off &lt;i&gt;"))
        assertTrue(offline.contains("Line &amp; more"))
    }

    @Test
    fun `originOf keeps scheme, host and explicit port`() {
        assertEquals("https://a.b", WebTabsPolicy.originOf("https://A.B/path?q"))
        assertEquals("http://a.b:8080", WebTabsPolicy.originOf("http://a.b:8080/"))
        assertNull(WebTabsPolicy.originOf("about:blank"))
        assertNull(WebTabsPolicy.originOf("javascript:1"))
        assertNull(WebTabsPolicy.originOf(null))
    }
}
