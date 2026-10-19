package com.educms.player.media

/*
 * THE CLOSED SET OF NATIVE END REASONS (design NATIVE-FIRST-ONE-STORE §3.4,
 * owner decision D7 / phase 0, 2026-10-19).
 *
 * Every reason a native session ever reports to the page is a member of
 * exactly ONE of the four sets below, and the page's own table is generated
 * from THIS file (stream C parses it), so the two can never drift apart. The
 * drift is the latent defect of §1.2: a raw exception code such as
 * `manifest-http-503`, `timeout` or `media-incomplete` reached the page as if
 * it were a verdict on the file, and an OFFLINE BOOT blocked native for a day.
 *
 *  • TRANSIENT — native again at the next start. Nothing about this file on
 *    this box was proven; the alert, the operator UI, the lifecycle or the
 *    page itself took the session down.
 *  • NOT_READY — wait. The file, the manifest, the store or the credential
 *    is not there yet. The store retries; the current content (or the
 *    splash with its real download) stays. NEVER a verdict on the file.
 *  • FAULT — a real fault of a VERIFIED file on this decoder: a 24 h block,
 *    keyed by file + face + APK build, and the web engine plays the SAME
 *    verified file (one engine for that content, not a flip).
 *  • REFUSED — the class table or the box says this session may not run at
 *    all (never native here). The page keeps the web engine; no block, no
 *    retry, no network, no surface, no decoder.
 *
 * Repeated TRANSIENT ends (more than [TransientEndTracker.MAX_IN_WINDOW] in
 * [TransientEndTracker.WINDOW_MS] for one content on one face) SETTLE that
 * content on the web engine until the content changes or the page reloads —
 * logged, never a loop.
 *
 * ⚠️ PARSEABLE BY CONSTRUCTION. Keep each set as `val NAME: Set<String> =
 * setOf(` … `)` with ONE quoted literal per line and `//` comments only on
 * lines of their own. Codes are `[a-z0-9-]{1,64}`. Adding a member means
 * adding it to exactly one set here AND regenerating the page's table.
 */
internal object NativeEndReasons {

    // ── TRANSIENT: native again at the next start; never a verdict on the file ──
    val TRANSIENT: Set<String> = setOf(
        // the emergency hold took every surface (§7 E1); the intent is kept, suspended by the hold
        "emergency-held",
        // the Activity paused or was destroyed: the window and its surfaces are gone
        "activity-paused",
        // the face is not ready to own its window (not foreground / not interactive / no focus)
        "lifecycle-not-ready",
        // operator UI took the glass (Back menu, update prompt, blank / dim, canvas editor, URL overlay)
        "operator-ui",
        // the page asked for the stop itself (sharedVideoStop on a v2 / v3 session)
        "page-requested",
        // v4: the page released this face at the stated boundary
        "released",
        // the page intended other content; this session gave way at the boundary
        "content-changed",
        // a positioned slot was covered by the slot that played over it
        "superseded",
        // the page's main-frame document changed (v2 / v3 sessions only; a v4 session continues)
        "document-retired",
        // the page stopped polling for 10 s (v2 / v3 sessions only; a v4 session continues unattended)
        "page-lease-expired",
        // the WebView was replaced and the session could not be re-homed under the same parent
        "host-replaced",
        // the host was torn down (a face Presentation destroyed)
        "host-detached",
        // the pair engine gave way to the per-face engine
        "engine-switched",
        // the protocol-1 pair engine's peer stopped
        "peer-stopped",
        // the box could not open a hardware decoder right now (another session holds it, a transient OMX refusal)
        "decoder-unavailable",
        // the decoder budget across every face refused this session (a pre-roll is refused one early)
        "decoder-budget",
        // the session was retired by its owner before it finished preparing
        "session-retired",
        // the surface was destroyed or left the window
        "output-detached",
        // the surface could not be composed in time (no parent, empty rect, reveal timed out, no hardware acceleration)
        "output-unavailable",
        // a held first frame waited longer than the hold bound for the glass
        "hold-expired",
        // emitted by APKs before 1.1.43 for `lifecycle-not-ready` + `operator-ui` + `page-requested`; kept so an older APK's end is graded the same way
        "page-stopped",
    )

    // ── NOT_READY: wait; the store retries; the current content stays; never a verdict on the file ──
    val NOT_READY: Set<String> = setOf(
        // the verified file is not in the store (not downloaded yet, evicted, or its download failed and will be retried)
        "not-in-store",
        // this face's authenticated manifest could not be read (offline, a timeout, a 4xx / 5xx, the API root unset)
        "manifest-unreachable",
        // the store refused the file for lack of space; the current content stays
        "store-full",
        // the store's directory could not be used right now (unavailable, corrupt copy removed, publish failed)
        "store-unavailable",
        // the manifest's selection no longer names what the page intended; the page decides again
        "selection-changed",
        // this face holds no device credential
        "credential-missing",
        // the credential rotated while native was preparing (the page renews its token); re-read next attempt
        "credential-changed",
        // the credential no longer names this screen (a re-pair); the intent is discarded
        "credential-identity",
    )

    // ── FAULT: a real fault of a verified file: 24 h block keyed by file + face + build; the web engine plays the same file ──
    val FAULT: Set<String> = setOf(
        // the decoder failed on this file (a non-transient CodecException, or a failure inside decode)
        "codec-failed",
        // no hardware AVC decoder on this box accepts this file's format
        "hardware-codec-unavailable",
        // the file carries no AVC video track
        "avc-track",
        // the coded size in the file disagrees with the manifest's
        "coded-size",
        // the container carries a rotation tag native does not apply
        "container-rotation",
        // a lap of the file carried no samples
        "empty-lap",
        // the decoder handed back no input buffer
        "codec-input",
        // the decoder made no progress for 15 s
        "codec-stalled",
        // 8 s without a rendered frame once started
        "output-stalled",
        // the renderer could not prepare this file (the catch-all for prepare)
        "native-prepare",
        // the manifest's descriptor for this file is outside the contract (version, identity, format, transform, origin)
        "descriptor-invalid",
        // the app's own 24 h block for this file + face + build is live
        "blocked",
    )

    // ── REFUSED: the class table / the box: never native here; the page keeps the web engine; no block, no retry ──
    val REFUSED: Set<String> = setOf(
        // this class cannot compose a surface above the window (SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE)
        "composition-unavailable",
        // the positioned-slot engine is off on this class
        "protocol3-disabled",
        // a v4 intent arrived while native-first is off for this face (the page saw protocolMax < 4)
        "native-first-off",
        // a v4 message named a lease that a retired document wrote; it can never act again
        "lease-retired",
    )

    /** What the page does next after an end with this reason. */
    const val NEXT_RETRY = "retry"
    const val NEXT_WAIT = "wait"
    const val NEXT_BLOCK = "block"
    const val NEXT_WEB = "web"
    /** Repeated transient ends settled this content on the web engine (TransientEndTracker). */
    const val NEXT_SETTLE = "settle"

    val ALL: Set<String> = TRANSIENT + NOT_READY + FAULT + REFUSED

    private val code = Regex("[a-z0-9-]{1,64}")

    fun isTransient(reason: String): Boolean = reason in TRANSIENT
    fun isNotReady(reason: String): Boolean = reason in NOT_READY
    fun isFault(reason: String): Boolean = reason in FAULT
    fun isRefused(reason: String): Boolean = reason in REFUSED

    /** The page's next step for a reason of the closed set; an unknown code is graded as the fallback's set would be. */
    fun next(reason: String): String = when (normalize(reason)) {
        in TRANSIENT -> NEXT_RETRY
        in NOT_READY -> NEXT_WAIT
        in FAULT -> NEXT_BLOCK
        else -> NEXT_WEB
    }

    /**
     * Every raw code the engine can produce — the exception messages
     * `FaceVideoReasons.code` passes through, the HTTP codes the source
     * embeds, the renderer's own codes — folded onto the closed set. A member
     * passes through unchanged; anything unrecognised becomes [fallback]
     * (itself normalised), and a fallback outside the set becomes
     * `native-prepare`, so NOTHING outside this table ever reaches the page.
     */
    fun normalize(raw: String, fallback: String = "native-prepare"): String {
        if (raw in ALL) return raw
        val mapped = when {
            !code.matches(raw) -> null
            raw.startsWith("manifest-http-") -> "manifest-unreachable"
            raw in MANIFEST_UNREACHABLE -> "manifest-unreachable"
            raw.startsWith("media-http-") -> "not-in-store"
            raw in NOT_IN_STORE -> "not-in-store"
            raw in STORE_FULL -> "store-full"
            raw in STORE_UNAVAILABLE -> "store-unavailable"
            raw.startsWith("descriptor-") -> "descriptor-invalid"
            raw in DESCRIPTOR_INVALID -> "descriptor-invalid"
            raw in NATIVE_PREPARE -> "native-prepare"
            else -> null
        }
        if (mapped != null) return mapped
        return if (fallback in ALL) fallback else "native-prepare"
    }

    // Raw codes, as the engine emits them today (SharedVideoSource, FaceVideoBox, FaceVideoRenderer).
    private val MANIFEST_UNREACHABLE = setOf("timeout", "authorization-failed", "api-root", "api-origin", "manifest-too-large", "manifest-malformed")
    private val NOT_IN_STORE = setOf("media-redirect", "media-incomplete", "media-size", "media-digest", "source-failed")
    private val STORE_FULL = setOf("media-cache-quota")
    private val STORE_UNAVAILABLE = setOf("media-cache-unavailable", "media-cache-corrupt", "media-publish")
    private val DESCRIPTOR_INVALID = setOf("media-origin")
    private val NATIVE_PREPARE = setOf("codec-not-prepared")
}

/**
 * The settle rule of §3.4: more than [MAX_IN_WINDOW] TRANSIENT ends inside
 * [WINDOW_MS] for ONE content on ONE face settle that content on the web
 * engine — until the content changes ([reset]) or the page reloads
 * ([resetAll]). Pure; the clock is passed in (`elapsedRealtime`).
 */
internal class TransientEndTracker(
    private val windowMs: Long = WINDOW_MS,
    private val maxInWindow: Int = MAX_IN_WINDOW,
) {
    private val ends = HashMap<String, ArrayList<Long>>()
    private val settledKeys = HashSet<String>()

    /** Record a transient end of [contentKey] (`<face>:<sha256>`) at [nowMs]; true when this end settled the content. */
    @Synchronized fun ended(contentKey: String, reason: String, nowMs: Long): Boolean {
        if (!NativeEndReasons.isTransient(reason)) return false
        val list = ends.getOrPut(contentKey) { ArrayList() }
        list.add(nowMs)
        list.removeAll { nowMs - it > windowMs || it > nowMs }
        if (list.size > maxInWindow) settledKeys.add(contentKey)
        return contentKey in settledKeys
    }

    @Synchronized fun settled(contentKey: String): Boolean = contentKey in settledKeys

    /** The content changed: its history and its settlement are gone. */
    @Synchronized fun reset(contentKey: String) { ends.remove(contentKey); settledKeys.remove(contentKey) }

    /** The page reloaded: every settlement is lifted. */
    @Synchronized fun resetAll() { ends.clear(); settledKeys.clear() }

    companion object {
        const val WINDOW_MS = 10L * 60_000L
        const val MAX_IN_WINDOW = 5
        fun key(face: Int, sha256: String): String = "$face:$sha256"
    }
}
