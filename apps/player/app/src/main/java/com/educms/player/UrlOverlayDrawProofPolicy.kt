package com.educms.player

import org.json.JSONObject
import org.json.JSONTokener

/**
 * Did the website a playlist shows actually draw something? (2026-11-13)
 *
 * The plain URL overlay already recovers from a main-frame load ERROR
 * ([UrlOverlayRecoveryPolicy]) and from a renderer crash. It could not see a
 * page that answered HTTP 200 and then drew nothing — a single-page app whose
 * script never booted, a cancelled sub-resource, a hung boot. `onPageFinished`
 * fires for that page exactly as for a healthy one (player rule 5: it is not
 * page success), the glass is a white sheet, and the fleet read "showing
 * content".
 *
 * So after a successful main-frame load the Activity asks the overlay's
 * DOCUMENT what it holds ([PROBE_JS], through `evaluateJavascript` — no bridge,
 * no listener, no interface is added to that view) and this object decides.
 * Every rule is here and pure; the Activity only schedules and acts.
 *
 * What a verdict means, and no more:
 *  - [Verdict.DRAWN]   the document holds visible content (text, a sized
 *                      picture / video / canvas / frame, a form control, a
 *                      background image). It does NOT say the content is the
 *                      right content — a site's own error text is "drawn".
 *  - [Verdict.BLANK]   the document held nothing visible on TWO countable
 *                      probes at least [MIN_CONFIRM_GAP_MS] apart.
 *  - [Verdict.UNKNOWN] not decided: too early, one empty probe so far, or the
 *                      probe could not be read. Nothing is ever reloaded on it.
 */
internal object UrlOverlayDrawProofPolicy {

    enum class Verdict { DRAWN, BLANK, UNKNOWN }

    /** One probe, read. */
    enum class Reading { CONTENT, EMPTY, UNREADABLE }

    /** What the document reported. Untrusted: every field is bounded in [parse]. */
    data class Evidence(
        val hasBody: Boolean,
        val readyState: String,
        val viewportWidth: Int,
        val viewportHeight: Int,
        val elements: Int,
        val textChars: Int,
        val media: Int,
        val painted: Int,
        val opaque: Int,
    )

    /** A reading and when it was taken, in ms since the main frame finished. */
    data class Sample(val sinceFinishedMs: Long, val reading: Reading)

    /**
     * The probe schedule after `onPageFinished`, as delays between probes.
     *
     * 1 s and 3 s are EARLY probes: they can only say DRAWN (a page that has
     * content is proven at once, so a healthy website slide is not held as
     * "loading" for eight seconds on every rotation). They can never count
     * toward BLANK.
     *
     * 8 s is the first COUNTABLE probe and 20 s the second: a blank verdict
     * needs both, so no page is ever reloaded sooner than 20 s after its main
     * frame finished. A slow single-page app on a 2015-class SoC (rk3288) is
     * still fetching and compiling its bundle at 3-5 s; 8 s is past that for a
     * working site and 12 s more is a second, independent look.
     */
    private val scheduleMs = longArrayOf(1_000L, 2_000L, 5_000L, 12_000L)

    /** No empty probe before this counts toward BLANK. */
    const val FIRST_COUNTABLE_MS = 8_000L

    /** Two countable empty probes must be at least this far apart (scheduled: 12 s). */
    const val MIN_CONFIRM_GAP_MS = 10_000L

    /** After a verdict the document is looked at again this often — a page can go blank later. */
    const val WATCH_INTERVAL_MS = 60_000L

    /** The second look after a watch probe came back empty. */
    const val CONFIRM_DELAY_MS = 12_000L

    /** Bound on the probe's reply; anything longer is not ours. */
    const val MAX_REPLY_CHARS = 512

    /**
     * Reloads of a blank page are bounded by the EXISTING backoff table: one
     * reload per step of [UrlOverlayRecoveryPolicy.retryDelayMs], then none.
     * After the last one the overlay keeps reporting BLANK and is left alone
     * until the document draws, the slide changes, or the overlay is hidden.
     */
    val MAX_BLANK_RELOADS: Int = UrlOverlayRecoveryPolicy.retrySteps

    /**
     * The probe. Read-only, ES5, one try/catch, bounded work: at most 600
     * elements are looked at and at most 300 computed styles are read. It
     * returns a short JSON string and changes nothing in the page.
     *
     *  b   document.body exists            rs  document.readyState
     *  w,h viewport                        el  element count (capped)
     *  tx  characters of visible text (body.innerText, trimmed, capped)
     *  md  img / video / canvas / svg / iframe / object / embed / picture with a
     *      client rect of at least 2 x 2
     *  pt  sized form controls, and sized elements with a background image
     *  op  sized custom elements or shadow hosts — content this probe cannot
     *      see into, so "nothing found" is not "nothing there"
     */
    const val PROBE_JS: String =
        "(function(){try{var d=document,b=d.body,w=window.innerWidth|0,h=window.innerHeight|0," +
            "o={v:1,b:b?1:0,rs:String(d.readyState||''),w:w,h:h,el:0,tx:0,md:0,pt:0,op:0};" +
            "if(!b)return JSON.stringify(o);" +
            "var t=String(b.innerText||'').replace(/^\\s+|\\s+\$/g,'');o.tx=t.length>9999?9999:t.length;" +
            "var a=d.getElementsByTagName('*'),n=a.length,m=n<600?n:600,i,e,g,r,s,k=0;o.el=n>99999?99999:n;" +
            "for(i=0;i<m;i++){e=a[i];g=String(e.tagName||'').toLowerCase();" +
            "r=e.getBoundingClientRect?e.getBoundingClientRect():null;" +
            "if(!r||r.width<2||r.height<2)continue;" +
            "if(g==='img'||g==='video'||g==='canvas'||g==='svg'||g==='iframe'||g==='object'||g==='embed'||g==='picture'){o.md++;continue;}" +
            "if(g==='input'||g==='button'||g==='select'||g==='textarea'){o.pt++;continue;}" +
            "if(g.indexOf('-')>0||e.shadowRoot){o.op++;continue;}" +
            "if(o.pt===0&&k<300){k++;s=window.getComputedStyle?window.getComputedStyle(e):null;" +
            "if(s&&s.backgroundImage&&s.backgroundImage!=='none')o.pt++;}}" +
            "return JSON.stringify(o);}catch(x){return 'error';}})()"

    /**
     * Parse what `evaluateJavascript` handed back. That value is the script's
     * result JSON-encoded, so a string result arrives as a quoted JSON string
     * holding our JSON. A hostile page can make it anything: null on any shape
     * that is not exactly ours, every number clamped.
     */
    fun parse(callbackValue: String?): Evidence? {
        if (callbackValue == null || callbackValue.length > MAX_REPLY_CHARS * 2) return null
        return try {
            val inner = JSONTokener(callbackValue).nextValue() as? String ?: return null
            if (inner.length > MAX_REPLY_CHARS) return null
            val o = JSONObject(inner)
            if (o.optInt("v", 0) != 1) return null
            fun count(key: String): Int? {
                val n = o.opt(key) as? Number ?: return null
                val d = n.toDouble()
                if (d.isNaN() || d.isInfinite() || d < 0) return null
                return d.coerceAtMost(1_000_000.0).toInt()
            }
            val rs = (o.opt("rs") as? String ?: return null).take(16)
            Evidence(
                hasBody = (count("b") ?: return null) > 0,
                readyState = rs,
                viewportWidth = count("w") ?: return null,
                viewportHeight = count("h") ?: return null,
                elements = count("el") ?: return null,
                textChars = count("tx") ?: return null,
                media = count("md") ?: return null,
                painted = count("pt") ?: return null,
                opaque = count("op") ?: return null,
            )
        } catch (_: Throwable) {
            null
        }
    }

    /** Only a web document is probed — never `about:blank`, the offline card or a `data:` page. */
    fun isProbeableUrl(url: String?): Boolean =
        url != null && (url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true))

    /** One probe's reading. Null evidence (no reply, garbage) is never EMPTY. */
    fun read(e: Evidence?): Reading {
        if (e == null) return Reading.UNREADABLE
        // A view with no viewport lays nothing out: every rect is zero and
        // "nothing sized" would be a statement about the view, not the page.
        if (e.viewportWidth <= 0 || e.viewportHeight <= 0) return Reading.UNREADABLE
        if (e.textChars > 0 || e.media > 0 || e.painted > 0) return Reading.CONTENT
        // Custom elements / shadow hosts may draw where the probe cannot look.
        if (e.opaque > 0) return Reading.UNREADABLE
        return Reading.EMPTY
    }

    /**
     * The verdict from the newest sample and the one before it (same document
     * load; null when there is none).
     */
    fun classify(previous: Sample?, latest: Sample?): Verdict {
        if (latest == null) return Verdict.UNKNOWN
        return when (latest.reading) {
            Reading.CONTENT -> Verdict.DRAWN
            Reading.UNREADABLE -> Verdict.UNKNOWN
            Reading.EMPTY -> {
                val confirmed = latest.sinceFinishedMs >= FIRST_COUNTABLE_MS &&
                    previous != null && previous.reading == Reading.EMPTY &&
                    previous.sinceFinishedMs >= FIRST_COUNTABLE_MS &&
                    latest.sinceFinishedMs - previous.sinceFinishedMs >= MIN_CONFIRM_GAP_MS
                if (confirmed) Verdict.BLANK else Verdict.UNKNOWN
            }
        }
    }

    /**
     * How long until the next probe. [probesDone] counts the probes taken
     * since the main frame finished; [latest] is the newest reading and
     * [verdict] what [classify] made of it.
     */
    fun nextProbeDelayMs(probesDone: Int, latest: Reading?, verdict: Verdict): Long {
        if (verdict == Verdict.DRAWN || verdict == Verdict.BLANK) return WATCH_INTERVAL_MS
        if (probesDone < scheduleMs.size) return scheduleMs[probesDone.coerceAtLeast(0)]
        // Past the opening schedule: one empty look gets its second look.
        return if (latest == Reading.EMPTY) CONFIRM_DELAY_MS else WATCH_INTERVAL_MS
    }

    /**
     * The opening schedule ran and the probe never produced a reading we can
     * use: say so ("unknown") instead of leaving the page at "loading" forever.
     */
    fun settledUnknown(probesDone: Int, latest: Reading?, verdict: Verdict): Boolean =
        verdict == Verdict.UNKNOWN && probesDone >= scheduleMs.size && latest != Reading.EMPTY

    /**
     * May a blank page be reloaded now? Never for Website Tabs, a hidden view,
     * a failed load (the error path owns that), an emergency hold, or once the
     * bounded reloads are spent.
     */
    fun shouldReloadBlank(
        verdict: Verdict,
        reloadsDone: Int,
        visible: Boolean,
        websiteTabsOwnIt: Boolean,
        targetUrl: String?,
        loadFailed: Boolean,
        emergencyHeld: Boolean,
    ): Boolean =
        verdict == Verdict.BLANK && reloadsDone in 0 until MAX_BLANK_RELOADS && visible && !websiteTabsOwnIt &&
            !targetUrl.isNullOrBlank() && !loadFailed && !emergencyHeld

    /** The wait before reload number `reloadsDone + 1` — the existing backoff table. */
    fun blankReloadDelayMs(reloadsDone: Int): Long =
        UrlOverlayRecoveryPolicy.retryDelayMs(reloadsDone.coerceAtLeast(0) + 1)

    /** The state names the player page hears (`edu-url-overlay-state`). */
    const val STATE_LOADING = "loading"
    const val STATE_DRAWN = "drawn"
    const val STATE_BLANK = "blank"
    const val STATE_FAILED = "failed"
    const val STATE_UNKNOWN = "unknown"

    /**
     * What the page passes to `urlOverlayReport` instead of a URL to stand the
     * proof down (the server's kill switch). It can never be a web URL.
     */
    const val STAND_DOWN = "off"

    /** The event the Activity dispatches into the PLAYER page (never into the site). */
    const val STATE_EVENT = "edu-url-overlay-state"

    /**
     * The script for the player WebView. `url` and `state` go through
     * [JSONObject.quote], so no URL can break out of the literal.
     */
    fun stateEventJs(url: String, state: String, attempts: Int): String =
        "window.dispatchEvent(new CustomEvent('$STATE_EVENT',{detail:{url:${JSONObject.quote(url.take(2048))}," +
            "state:${JSONObject.quote(state)},attempts:${attempts.coerceIn(0, 99)}}}))"
}
