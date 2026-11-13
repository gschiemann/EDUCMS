package com.educms.player

import com.educms.player.UrlOverlayDrawProofPolicy.Reading
import com.educms.player.UrlOverlayDrawProofPolicy.Sample
import com.educms.player.UrlOverlayDrawProofPolicy.Verdict
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlOverlayDrawProofPolicyTest {
    /** What `evaluateJavascript` hands back for a script that returned this string. */
    private fun reply(inner: String): String = JSONObject.quote(inner)

    private fun doc(
        b: Int = 1, rs: String = "complete", w: Int = 1920, h: Int = 1080,
        el: Int = 12, tx: Int = 0, md: Int = 0, pt: Int = 0, op: Int = 0,
    ): String = reply("""{"v":1,"b":$b,"rs":"$rs","w":$w,"h":$h,"el":$el,"tx":$tx,"md":$md,"pt":$pt,"op":$op}""")

    private fun reading(raw: String?): Reading = UrlOverlayDrawProofPolicy.read(UrlOverlayDrawProofPolicy.parse(raw))

    // ── reading one probe ────────────────────────────────────────────────

    @Test fun `text, a sized picture or a painted element is content`() {
        assertEquals(Reading.CONTENT, reading(doc(tx = 40)))
        assertEquals(Reading.CONTENT, reading(doc(tx = 1)))
        assertEquals(Reading.CONTENT, reading(doc(pt = 1)))
    }

    @Test fun `a page that is one full-screen video, canvas, image or frame is content`() {
        // No text at all, three elements, one sized media element.
        assertEquals(Reading.CONTENT, reading(doc(el = 3, tx = 0, md = 1)))
    }

    @Test fun `a document with nothing visible is empty — with or without a body`() {
        // The single-page app that never booted: a root div and its scripts.
        assertEquals(Reading.EMPTY, reading(doc(el = 9)))
        assertEquals(Reading.EMPTY, reading(doc(b = 0, el = 0, rs = "loading")))
    }

    @Test fun `what the probe cannot see into is unreadable, never empty`() {
        // Custom elements / shadow hosts with no light-DOM text.
        assertEquals(Reading.UNREADABLE, reading(doc(op = 2)))
        // A view with no viewport lays nothing out.
        assertEquals(Reading.UNREADABLE, reading(doc(w = 0)))
        assertEquals(Reading.UNREADABLE, reading(doc(h = 0)))
    }

    @Test fun `no reply and garbage are unreadable`() {
        val garbage = listOf(
            null, "", "null", "undefined", "\"error\"", "42", "{}", "[1,2]", "\"\"", "\"not json\"",
            // an object, not the string our script returns
            """{"v":1,"b":1}""",
            // wrong version, missing fields, wrong types, negative and non-finite numbers
            reply("""{"v":2,"b":1,"rs":"complete","w":1,"h":1,"el":1,"tx":1,"md":0,"pt":0,"op":0}"""),
            reply("""{"v":1,"b":1,"rs":"complete","w":1,"h":1,"el":1,"tx":1}"""),
            reply("""{"v":1,"b":1,"rs":7,"w":1,"h":1,"el":1,"tx":1,"md":0,"pt":0,"op":0}"""),
            reply("""{"v":1,"b":1,"rs":"complete","w":1,"h":1,"el":1,"tx":"9","md":0,"pt":0,"op":0}"""),
            reply("""{"v":1,"b":1,"rs":"complete","w":1,"h":1,"el":1,"tx":-5,"md":0,"pt":0,"op":0}"""),
            // far past the size bound
            reply("""{"v":1,"pad":"${"x".repeat(2_000)}"}"""),
        )
        for (g in garbage) {
            assertNull("must not parse: $g", UrlOverlayDrawProofPolicy.parse(g))
            assertEquals(Reading.UNREADABLE, reading(g))
        }
    }

    @Test fun `numbers from the page are clamped and the state string is bounded`() {
        val e = UrlOverlayDrawProofPolicy.parse(
            reply("""{"v":1,"b":1,"rs":"${"z".repeat(60)}","w":1e12,"h":1080,"el":1e300,"tx":5,"md":0,"pt":0,"op":0}"""),
        )
        assertNotNull(e)
        assertEquals(1_000_000, e!!.viewportWidth)
        assertEquals(1_000_000, e.elements)
        assertEquals(16, e.readyState.length)
        assertEquals(Reading.CONTENT, UrlOverlayDrawProofPolicy.read(e))
    }

    // ── the verdict over time ────────────────────────────────────────────

    @Test fun `content is drawn at once, even on an early probe`() {
        assertEquals(Verdict.DRAWN, UrlOverlayDrawProofPolicy.classify(null, Sample(1_000, Reading.CONTENT)))
        assertEquals(
            Verdict.DRAWN,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.EMPTY), Sample(20_000, Reading.CONTENT)),
        )
    }

    @Test fun `one empty probe is never blank — a slow app is still booting`() {
        assertEquals(Verdict.UNKNOWN, UrlOverlayDrawProofPolicy.classify(null, Sample(8_000, Reading.EMPTY)))
        assertEquals(Verdict.UNKNOWN, UrlOverlayDrawProofPolicy.classify(null, Sample(600_000, Reading.EMPTY)))
        assertEquals(Verdict.UNKNOWN, UrlOverlayDrawProofPolicy.classify(null, null))
    }

    @Test fun `early empty probes never count toward blank`() {
        // 1 s then 3 s: both empty, both before the first countable probe.
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(1_000, Reading.EMPTY), Sample(3_000, Reading.EMPTY)),
        )
        // 3 s then 8 s: the earlier one is not countable.
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(3_000, Reading.EMPTY), Sample(8_000, Reading.EMPTY)),
        )
        // 3 s then 20 s: far apart, but the earlier one is still not countable.
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(3_000, Reading.EMPTY), Sample(20_000, Reading.EMPTY)),
        )
    }

    @Test fun `blank needs two consecutive countable empty probes spaced apart`() {
        assertEquals(
            Verdict.BLANK,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.EMPTY), Sample(20_000, Reading.EMPTY)),
        )
        // Too close together: one look, taken twice.
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.EMPTY), Sample(12_000, Reading.EMPTY)),
        )
        // Not consecutive: content or an unreadable probe in between resets it.
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.CONTENT), Sample(20_000, Reading.EMPTY)),
        )
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.UNREADABLE), Sample(20_000, Reading.EMPTY)),
        )
    }

    @Test fun `an unreadable probe is unknown whatever came before`() {
        assertEquals(
            Verdict.UNKNOWN,
            UrlOverlayDrawProofPolicy.classify(Sample(8_000, Reading.EMPTY), Sample(20_000, Reading.UNREADABLE)),
        )
    }

    // ── the schedule ─────────────────────────────────────────────────────

    /** Walk the schedule for a page that reads [readings] in order; returns (probe time, verdict) pairs. */
    private fun walk(readings: List<Reading>): List<Pair<Long, Verdict>> {
        val out = mutableListOf<Pair<Long, Verdict>>()
        var t = 0L
        var previous: Sample? = null
        var verdict = Verdict.UNKNOWN
        var latest: Reading? = null
        readings.forEachIndexed { i, r ->
            t += UrlOverlayDrawProofPolicy.nextProbeDelayMs(i, latest, verdict)
            val s = Sample(t, r)
            verdict = UrlOverlayDrawProofPolicy.classify(previous, s)
            previous = s
            latest = r
            out += t to verdict
        }
        return out
    }

    @Test fun `the opening schedule is 1, 3, 8 and 20 seconds after the main frame finished`() {
        val w = walk(List(4) { Reading.EMPTY })
        assertEquals(listOf(1_000L, 3_000L, 8_000L, 20_000L), w.map { it.first })
        assertEquals(listOf(Verdict.UNKNOWN, Verdict.UNKNOWN, Verdict.UNKNOWN, Verdict.BLANK), w.map { it.second })
    }

    @Test fun `no page is called blank sooner than 20 seconds after it finished`() {
        // Whatever mix of readings a page produces, the first BLANK is never before 20 s.
        val all = listOf(Reading.EMPTY, Reading.CONTENT, Reading.UNREADABLE)
        fun combos(n: Int): List<List<Reading>> =
            if (n == 0) listOf(emptyList()) else combos(n - 1).flatMap { head -> all.map { head + it } }
        for (seq in combos(6)) {
            val firstBlank = walk(seq).firstOrNull { it.second == Verdict.BLANK } ?: continue
            assertTrue("blank at ${firstBlank.first} ms for $seq", firstBlank.first >= 20_000L)
        }
    }

    @Test fun `a drawn page is watched once a minute and a later blank still needs two looks`() {
        val w = walk(listOf(Reading.CONTENT, Reading.CONTENT, Reading.EMPTY, Reading.EMPTY))
        assertEquals(listOf(1_000L, 61_000L, 121_000L, 133_000L), w.map { it.first })
        assertEquals(listOf(Verdict.DRAWN, Verdict.DRAWN, Verdict.UNKNOWN, Verdict.BLANK), w.map { it.second })
    }

    @Test fun `a blank page that draws later is drawn again`() {
        val w = walk(listOf(Reading.EMPTY, Reading.EMPTY, Reading.EMPTY, Reading.EMPTY, Reading.CONTENT))
        assertEquals(Verdict.BLANK, w[3].second)
        assertEquals(60_000L, w[4].first - w[3].first)
        assertEquals(Verdict.DRAWN, w[4].second)
    }

    @Test fun `a probe that never reads settles as unknown after the opening schedule, not before`() {
        for (done in 0..3) {
            assertFalse(UrlOverlayDrawProofPolicy.settledUnknown(done, Reading.UNREADABLE, Verdict.UNKNOWN))
        }
        assertTrue(UrlOverlayDrawProofPolicy.settledUnknown(4, Reading.UNREADABLE, Verdict.UNKNOWN))
        // One empty look is waiting for its second look — not settled.
        assertFalse(UrlOverlayDrawProofPolicy.settledUnknown(4, Reading.EMPTY, Verdict.UNKNOWN))
        assertFalse(UrlOverlayDrawProofPolicy.settledUnknown(9, Reading.CONTENT, Verdict.DRAWN))
        // After the opening schedule an unreadable page is looked at once a minute.
        assertEquals(60_000L, UrlOverlayDrawProofPolicy.nextProbeDelayMs(4, Reading.UNREADABLE, Verdict.UNKNOWN))
        assertEquals(12_000L, UrlOverlayDrawProofPolicy.nextProbeDelayMs(7, Reading.EMPTY, Verdict.UNKNOWN))
    }

    // ── the reload ───────────────────────────────────────────────────────

    private fun mayReload(
        verdict: Verdict = Verdict.BLANK, done: Int = 0, visible: Boolean = true, tabs: Boolean = false,
        target: String? = "https://example.com/", failed: Boolean = false, held: Boolean = false,
    ) = UrlOverlayDrawProofPolicy.shouldReloadBlank(verdict, done, visible, tabs, target, failed, held)

    @Test fun `only a blank verdict reloads — never unknown, never drawn`() {
        assertTrue(mayReload())
        assertFalse(mayReload(verdict = Verdict.UNKNOWN))
        assertFalse(mayReload(verdict = Verdict.DRAWN))
    }

    @Test fun `never during an emergency hold, for Website Tabs, a hidden view or a failed load`() {
        assertFalse(mayReload(held = true))
        assertFalse(mayReload(tabs = true))
        assertFalse(mayReload(visible = false))
        assertFalse(mayReload(failed = true))
        assertFalse(mayReload(target = null))
        assertFalse(mayReload(target = " "))
    }

    @Test fun `reloads are bounded by the existing backoff table and then stop`() {
        assertEquals(UrlOverlayRecoveryPolicy.retrySteps, UrlOverlayDrawProofPolicy.MAX_BLANK_RELOADS)
        assertEquals(6, UrlOverlayDrawProofPolicy.MAX_BLANK_RELOADS)
        val delays = (0 until UrlOverlayDrawProofPolicy.MAX_BLANK_RELOADS).map {
            assertTrue(mayReload(done = it))
            UrlOverlayDrawProofPolicy.blankReloadDelayMs(it)
        }
        assertEquals(listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L), delays)
        assertEquals(delays, (1..6).map { UrlOverlayRecoveryPolicy.retryDelayMs(it) })
        for (done in listOf(6, 7, 1_000, Int.MAX_VALUE, -1)) assertFalse("reload $done", mayReload(done = done))
    }

    // ── what is evaluated, and what is told ──────────────────────────────

    @Test fun `only web documents are probed`() {
        assertTrue(UrlOverlayDrawProofPolicy.isProbeableUrl("https://playlist.example.org/"))
        assertTrue(UrlOverlayDrawProofPolicy.isProbeableUrl("HTTP://example.org"))
        for (u in listOf(null, "", "about:blank", "data:text/html,x", "file:///x", "javascript:1", "chrome://crash")) {
            assertFalse("$u", UrlOverlayDrawProofPolicy.isProbeableUrl(u))
        }
    }

    @Test fun `the probe is small, read-only and ES5`() {
        val js = UrlOverlayDrawProofPolicy.PROBE_JS
        assertTrue("the probe grew: ${js.length}", js.length < 1_500)
        assertTrue(js.startsWith("(function(){try{") && js.endsWith("catch(x){return 'error';}})()"))
        // It writes nothing into the page and reaches nothing outside it.
        for (banned in listOf(
            "innerHTML", "outerHTML", "document.write", "appendChild", "removeChild", "setAttribute", ".style.",
            "location", "cookie", "localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "postMessage",
            "addEventListener", "eval(", "Function(", "EduCms", "window.name", "navigator",
        )) {
            assertFalse("the probe must not use $banned", js.contains(banned))
        }
        // The only property it ever assigns is on its own result object `o`.
        assertFalse(Regex("""\b(d|b|e|a|s|r|g|t|window|document)\.[A-Za-z]+\s*=[^=]""").containsMatchIn(js))
        // ES5: no arrow functions, let/const, template strings or spread.
        for (modern in listOf("=>", "let ", "const ", "`", "...")) assertFalse("ES5 only: $modern", js.contains(modern))
        assertEquals(js.count { it == '(' }, js.count { it == ')' })
        assertEquals(js.count { it == '{' }, js.count { it == '}' })
    }

    @Test fun `the state event quotes whatever URL it is given`() {
        val hostile = "https://x.example/?a='});alert(1);//\"</script> "
        val js = UrlOverlayDrawProofPolicy.stateEventJs(hostile, UrlOverlayDrawProofPolicy.STATE_BLANK, 3)
        assertTrue(js.startsWith("window.dispatchEvent(new CustomEvent('edu-url-overlay-state',{detail:{url:\""))
        assertTrue(js.endsWith(",state:\"blank\",attempts:3}}))"))
        // The URL sits inside one JSON string literal: its own double quote is escaped.
        val literal = js.substringAfter("{detail:{url:").substringBefore(",state:")
        assertEquals(hostile, org.json.JSONTokener(literal).nextValue())
        // Attempts are clamped; a long URL is cut.
        assertTrue(UrlOverlayDrawProofPolicy.stateEventJs("https://x", "drawn", -4).endsWith("attempts:0}}))"))
        assertTrue(UrlOverlayDrawProofPolicy.stateEventJs("https://x", "drawn", 5_000).endsWith("attempts:99}}))"))
        assertTrue(UrlOverlayDrawProofPolicy.stateEventJs("https://" + "a".repeat(9_000), "drawn", 0).length < 2_300)
    }
}
