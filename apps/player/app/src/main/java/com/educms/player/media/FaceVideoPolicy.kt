package com.educms.player.media

import android.media.MediaCodec
import org.json.JSONObject

/*
 * PER-FACE NATIVE VIDEO — protocol 2 (2026-10-12).
 *
 * The protocol-1 engine (SharedVideoBox) couples the two faces of a DH43 into
 * ONE session that can only play the SAME file on both sides. Protocol 2 is
 * the general engine: every face (the primary display AND each presentation
 * face) owns an INDEPENDENT session, so any combination works — the same file
 * on both faces, a different file on each face, video on one face and a
 * template/image on the other, or a single-sided screen. Each session decodes
 * one verified on-disk file on hardware straight into that face's own
 * SurfaceView, which sits BELOW that face's WebView; the page layer (and
 * every emergency surface) paints above it.
 *
 * It rides the SAME four bridge methods as protocol 1 (sharedVideoPrepare /
 * Commit / Stop / State) — a `version: 2` request selects it, and the state
 * reply carries `protocol: 2` so the page can tell an APK that has it from
 * one that does not. No bridge method was added (CLAUDE.md player rule 9).
 *
 * Everything in this file is pure and unit-tested (FaceVideoPolicyTest).
 */

/** What the page may ask for: identity only — never a URL, never a token. */
internal data class FaceVideoRequest(val screenId: String, val revision: String, val sha256: String, val assetId: String) {
    companion object {
        private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        /** Null for anything that is not a well-formed protocol-2 request. */
        fun parse(json: String): FaceVideoRequest? = runCatching {
            require(json.length <= 1024)
            val j = JSONObject(json)
            require(j.getInt("version") == 2)
            val r = FaceVideoRequest(j.getString("screenId"), j.getString("revision"),
                j.getString("sha256").lowercase(), j.getString("assetId"))
            require(uuid.matches(r.screenId) && uuid.matches(r.assetId))
            require(r.revision.length in 1..128 && Regex("[a-f0-9]{64}").matches(r.sha256))
            r
        }.getOrNull()
    }
}

/**
 * The server's selection for ONE face, read by native from that face's own
 * authenticated manifest (`nativeVideo`). The page's request must match it
 * exactly or nothing plays.
 */
internal data class FaceVideoDescriptor(
    val screenId: String, val tenantId: String, val faceIndex: Int, val revision: String,
    val assetId: String, val url: String, val sha256: String, val size: Long,
    val width: Int, val height: Int, val fps: Double, val orientation: String, val fit: String,
    /** The M43 experiments the server switched on for THIS screen (1.1.41); absent = none. Outside `revision`. */
    val experiments: NativeVideoExperiments = NativeVideoExperiments.NONE,
) {
    fun matches(r: FaceVideoRequest): Boolean =
        r.screenId == screenId && r.revision == revision && r.sha256 == sha256 && r.assetId == assetId

    companion object {
        private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        val FITS = setOf("cover", "contain", "fill")
        fun parse(j: JSONObject): FaceVideoDescriptor {
            require(j.getInt("version") == 2) { "descriptor-version" }
            fun id(key: String): String = j.getString(key).also { require(uuid.matches(it)) { "descriptor-identity" } }
            val a = j.getJSONObject("asset")
            val t = j.getJSONObject("transform")
            val d = FaceVideoDescriptor(id("screenId"), id("tenantId"), j.getInt("faceIndex"), j.getString("revision"),
                a.getString("id"), a.getString("url"), a.getString("sha256"), a.getLong("size"),
                a.getInt("width"), a.getInt("height"), a.getDouble("fps"),
                t.getString("orientation"), t.getString("fit"),
                NativeVideoExperiments.parse(j.optJSONObject("experiments")))
            require(d.faceIndex in 0..1) { "descriptor-face" }
            require(d.revision.length in 1..128 && uuid.matches(d.assetId)) { "descriptor-revision" }
            require(Regex("[a-f0-9]{64}").matches(d.sha256)) { "descriptor-digest" }
            require(d.size in 1..SharedVideoSourcePolicy.MAX_BYTES && d.width in 16..4096 && d.height in 16..4096 &&
                d.fps.isFinite() && d.fps > 0 && d.fps <= 30) { "descriptor-format" }
            require(d.fit in FITS && d.orientation in setOf("PORTRAIT", "LANDSCAPE", "AUTO")) { "descriptor-transform" }
            require(SharedVideoSourcePolicy.allowed(d.url)) { "media-origin" }
            return d
        }
    }
}

internal object FaceVideoPolicy {
    /**
     * Hardware decoders this box may run natively at once, across every face.
     * Two is the DH43's case (two panels, one rk3288) and what Goodview's own
     * CMS runs; the codec's own advertised instance limit can only lower it.
     */
    const val MAX_DECODERS = 2

    fun decoderAllowed(activeElsewhere: Int, advertisedInstances: Int): Boolean =
        activeElsewhere < minOf(MAX_DECODERS, if (advertisedInstances > 0) advertisedInstances else 1)

    /**
     * How the decoder meets the surface. `cover` crops on the compositor
     * (SCALE_TO_FIT_WITH_CROPPING: proportions kept, overhang trimmed equally);
     * `contain` and `fill` scale to the surface — for `contain` the SURFACE
     * itself is letterboxed by [frame], so scaling to it keeps proportions.
     */
    fun scalingMode(fit: String): Int =
        if (fit == "cover") MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
        else MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT

    /**
     * The SurfaceView rectangle inside a face of outW×outH, as
     * [left, top, width, height]. Full-face for cover/fill; centred and
     * proportion-true for contain, using the video's size AFTER the output
     * rotation (a portrait clip rotated onto a landscape panel swaps axes).
     */
    fun frame(fit: String, videoW: Int, videoH: Int, degrees: Int, outW: Int, outH: Int): IntArray {
        if (fit != "contain" || videoW <= 0 || videoH <= 0 || outW <= 0 || outH <= 0) return intArrayOf(0, 0, outW, outH)
        val swap = degrees % 180 != 0
        val vw = (if (swap) videoH else videoW).toDouble()
        val vh = (if (swap) videoW else videoH).toDouble()
        val scale = minOf(outW / vw, outH / vh)
        val w = minOf(outW, Math.round(vw * scale).toInt()).coerceAtLeast(1)
        val h = minOf(outH, Math.round(vh * scale).toInt()).coerceAtLeast(1)
        return intArrayOf((outW - w) / 2, (outH - h) / 2, w, h)
    }

    /**
     * Files to delete from a face-video cache directory before a download:
     * everything not pinned by a live session on ANY face, except the newest
     * [keepExtra] unpinned copies (a quick switch back costs no download).
     * Two faces playing two different files therefore never evict each other.
     */
    fun prune(files: List<Pair<String, Long>>, pinned: Set<String>, keepExtra: Int = 1): Set<String> =
        files.filter { it.first !in pinned }.sortedByDescending { it.second }.drop(keepExtra).map { it.first }.toSet()

    /** A failure the page should treat as transient (retry later) rather than a fault of this file on this box. */
    fun transient(reason: String): Boolean = reason in TRANSIENT
    private val TRANSIENT = setOf("emergency-held", "activity-paused", "host-detached", "document-retired",
        "content-changed", "peer-stopped", "page-stopped", "engine-switched", "page-lease-expired")
}

/*
 * PROTOCOL 3 — positioned slots (2026-10-12). Design + hardware matrix:
 * docs/research/2026-10-12-native-video/02-protocol-3.md.
 *
 * Protocol 2 plays ONE solo video full-face. Protocol 3 adds SLOTS, each an
 * independent session with its own surface at a rect the PAGE measured:
 *  • `item:<id>` — a video inside a mixed playlist. The page prepares it as
 *    the hidden next-up; `commit` renders the first frame and HOLDS it on a
 *    surface PARKED OFF-SCREEN (so it can never show before its turn);
 *    `play` moves the surface onto its rect and releases the clip, which
 *    plays ONCE and keeps its last frame (`ended`) until the page stops it.
 *  • `zone:<id>` — a template VIDEO zone: same hold/play hand-off, loops.
 *
 * 1.1.41 — ONE COMPOSITING CONTRACT (SoloVideoLayer.kt): a slot's surface is
 * ABOVE the window from creation, parked beyond the physical display while it
 * pre-rolls, and moved onto its rect at `play`; the WebView stays opaque
 * black beneath it (no transparent hole any more). The one limitation: page
 * content cannot draw over a native slot, so a zone that another zone
 * overlaps stays web (`zone-overlap`, decided by the API and the page), and
 * a native→native transition is a hard cut handed over by the held frame.
 *
 * Same four bridge methods: a `version: 3` message on sharedVideoPrepare
 * carries an `op` (prepare / layout / play); commit / stop address the
 * session id; state adds `protocolMax: 3` + `sessions[]` and keeps its
 * protocol-2 top level for older web bundles. No bridge method was added.
 */

/** CSS-px rect in the page's layout viewport; native scales it to the WebView's own size. */
internal data class FaceZoneLayout(val x: Int, val y: Int, val w: Int, val h: Int, val vw: Int, val vh: Int, val degrees: Int, val fit: String) {
    companion object {
        fun parse(j: JSONObject): FaceZoneLayout {
            val l = FaceZoneLayout(j.getInt("x"), j.getInt("y"), j.getInt("w"), j.getInt("h"), j.getInt("vw"), j.getInt("vh"),
                j.getInt("degrees"), j.getString("fit"))
            require(l.x >= 0 && l.y >= 0 && l.w >= 2 && l.h >= 2 && l.vw > 0 && l.vh > 0 && l.vw <= 16384 && l.vh <= 16384 &&
                l.x + l.w <= l.vw && l.y + l.h <= l.vh) { "layout-rect" }
            require(l.degrees in setOf(0, 90, 180, 270) && l.fit in FaceVideoDescriptor.FITS) { "layout-transform" }
            return l
        }
    }
}

/** A protocol-3 prepare: identity + slot + layout — never a URL, never a token. */
internal data class FaceZoneRequest(
    val screenId: String, val revision: String, val slot: String, val sha256: String, val assetId: String,
    val loop: Boolean, val layout: FaceZoneLayout,
) {
    /** What makes two requests the SAME session (the layout may move without a restart). */
    val identity: List<String> get() = listOf(screenId, revision, slot, sha256, assetId, loop.toString())
}

/** Every version-3 message the page may send on sharedVideoPrepare. */
internal sealed class FaceZoneMessage {
    data class Prepare(val request: FaceZoneRequest) : FaceZoneMessage()
    data class Layout(val sessionId: String, val layout: FaceZoneLayout) : FaceZoneMessage()
    data class Play(val sessionId: String) : FaceZoneMessage()

    companion object {
        private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        val SLOT = Regex("(item|zone):[A-Za-z0-9_-]{1,64}")
        /** Null for anything that is not a well-formed protocol-3 message (protocol 1/2 flow elsewhere). */
        fun parse(json: String): FaceZoneMessage? = runCatching {
            require(json.length <= 2048)
            val j = JSONObject(json)
            require(j.getInt("version") == 3)
            when (j.getString("op")) {
                "prepare" -> {
                    val r = FaceZoneRequest(j.getString("screenId"), j.getString("revision"), j.getString("slot"),
                        j.getString("sha256").lowercase(), j.getString("assetId"), j.getBoolean("loop"),
                        FaceZoneLayout.parse(j.getJSONObject("layout")))
                    require(uuid.matches(r.screenId) && uuid.matches(r.assetId) && SLOT.matches(r.slot))
                    require(r.revision.length in 1..128 && Regex("[a-f0-9]{64}").matches(r.sha256))
                    Prepare(r)
                }
                "layout" -> Layout(j.getString("sessionId").also { require(uuid.matches(it)) }, FaceZoneLayout.parse(j.getJSONObject("layout")))
                "play" -> Play(j.getString("sessionId").also { require(uuid.matches(it)) })
                else -> error("op")
            }
        }.getOrNull()
    }
}

/**
 * The server's protocol-3 list for ONE face (`nativeVideoItems` in that face's
 * own authenticated manifest): the files native may play, by slot. A page
 * request must name a listed slot whose file identity matches exactly.
 */
internal data class FaceVideoItems(
    val screenId: String, val tenantId: String, val faceIndex: Int, val revision: String, val orientation: String,
    val items: List<FaceVideoItem>,
) {
    fun find(r: FaceZoneRequest): FaceVideoItem? = items.firstOrNull {
        it.slot == r.slot && it.sha256 == r.sha256 && it.assetId == r.assetId && it.loop == r.loop
    }?.takeIf { r.screenId == screenId && r.revision == revision }

    /** The per-session descriptor the renderer validates the file against; the fit is the page's. */
    fun descriptor(item: FaceVideoItem, fit: String) = FaceVideoDescriptor(
        screenId, tenantId, faceIndex, revision, item.assetId, item.url, item.sha256, item.size,
        item.width, item.height, item.fps, orientation, fit,
    )

    companion object {
        private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        fun parse(j: JSONObject): FaceVideoItems {
            require(j.getInt("version") == 3) { "descriptor-version" }
            fun id(key: String): String = j.getString(key).also { require(uuid.matches(it)) { "descriptor-identity" } }
            val arr = j.getJSONArray("items")
            require(arr.length() in 1..64) { "descriptor-items" }
            val items = (0 until arr.length()).map { i ->
                val e = arr.getJSONObject(i)
                val a = e.getJSONObject("asset")
                val it = FaceVideoItem(e.getString("slot"), e.getBoolean("loop"), a.getString("id"), a.getString("url"),
                    a.getString("sha256"), a.getLong("size"), a.getInt("width"), a.getInt("height"), a.getDouble("fps"))
                require(FaceZoneMessage.SLOT.matches(it.slot) && uuid.matches(it.assetId)) { "descriptor-slot" }
                require(Regex("[a-f0-9]{64}").matches(it.sha256)) { "descriptor-digest" }
                require(it.size in 1..SharedVideoSourcePolicy.MAX_BYTES && it.width in 16..4096 && it.height in 16..4096 &&
                    it.fps.isFinite() && it.fps > 0 && it.fps <= 30) { "descriptor-format" }
                require(SharedVideoSourcePolicy.allowed(it.url)) { "media-origin" }
                it
            }
            require(items.map { it.slot }.toSet().size == items.size) { "descriptor-slot" }
            val d = FaceVideoItems(id("screenId"), id("tenantId"), j.getInt("faceIndex"), j.getString("revision"), j.getString("orientation"), items)
            require(d.faceIndex in 0..1) { "descriptor-face" }
            require(d.revision.length in 1..128 && d.orientation in setOf("PORTRAIT", "LANDSCAPE", "AUTO")) { "descriptor-revision" }
            return d
        }
    }
}

internal data class FaceVideoItem(
    val slot: String, val loop: Boolean, val assetId: String, val url: String, val sha256: String,
    val size: Long, val width: Int, val height: Int, val fps: Double,
)

internal object FaceZonePolicy {
    /**
     * Decoders a box may run across every face under protocol 3: a playing
     * slot plus one pre-rolled next slot per face of a double-sided unit
     * (four), lowered by the codec's own advertised instance limit. A pre-roll
     * is refused one decoder earlier than playback, so the picture on glass
     * always wins the last decoder. A codec that still cannot be created ends
     * the session with the TRANSIENT `decoder-unavailable`, never a 24 h block.
     */
    const val MAX_DECODERS = 4
    /** When the codec advertises nothing: a playing + a pre-rolled slot on one face, a playing slot on the other. */
    const val UNKNOWN_DECODERS = 3
    fun decoderAllowed(activeElsewhere: Int, advertisedInstances: Int, preroll: Boolean): Boolean {
        val cap = minOf(MAX_DECODERS, if (advertisedInstances > 0) advertisedInstances else UNKNOWN_DECODERS)
        return activeElsewhere < (if (preroll) cap - 1 else cap)
    }

    /** A held first frame may wait this long for the glass before the session is retired (`hold-expired`). */
    const val HOLD_MAX_MS = 10 * 60 * 1000L

    /**
     * The page's CSS-px rect → this WebView's px, as [left, top, width,
     * height], scaled by the WebView's size over the page's layout viewport
     * (that ratio is the device pixel ratio, whatever the ROM reports) and
     * clamped inside the WebView. Empty when nothing is left on glass.
     */
    fun rect(l: FaceZoneLayout, outW: Int, outH: Int): IntArray {
        if (outW <= 0 || outH <= 0) return intArrayOf(0, 0, 0, 0)
        val sx = outW.toDouble() / l.vw
        val sy = outH.toDouble() / l.vh
        val x0 = Math.round(l.x * sx).toInt().coerceIn(0, outW)
        val y0 = Math.round(l.y * sy).toInt().coerceIn(0, outH)
        val x1 = Math.round((l.x + l.w) * sx).toInt().coerceIn(0, outW)
        val y1 = Math.round((l.y + l.h) * sy).toInt().coerceIn(0, outH)
        return intArrayOf(x0, y0, maxOf(0, x1 - x0), maxOf(0, y1 - y0))
    }

    /** Where a pre-rolled surface waits: entirely to the right of the WebView, same size, never on glass. */
    fun parked(rect: IntArray, outW: Int): IntArray = intArrayOf(outW, rect[1], rect[2], rect[3])

    /** Do two [rect]s share any pixel? (Which on-glass session a `play` supersedes.) */
    fun overlaps(a: IntArray, b: IntArray): Boolean =
        a[2] > 0 && a[3] > 0 && b[2] > 0 && b[3] > 0 &&
            a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

    /** A session may move its surface; a change of rotation or fit needs a new decoder (restart). */
    fun moveOnly(old: FaceZoneLayout, new: FaceZoneLayout): Boolean = old.degrees == new.degrees && old.fit == new.fit
}

/**
 * Seamless loop timeline. A looping session never sends end-of-stream and
 * never flushes the codec (the flush + re-prime is the visible hitch at the
 * seam); instead the extractor rewinds and every sample of the next lap is
 * queued with a presentation time continuing exactly one frame after the
 * last lap's final picture.
 */
internal class LoopTimeline(private val frameUs: Long) {
    private var offsetUs = 0L
    private var lapBaseRaw = 0L
    private var fileStartRaw = Long.MAX_VALUE
    private var queuedMax = Long.MIN_VALUE
    var laps = 0L; private set

    /** The presentation time to queue for a raw sample time of the current lap. */
    fun queue(rawUs: Long): Long {
        if (laps == 0L && rawUs < fileStartRaw) fileStartRaw = rawUs
        val q = offsetUs + rawUs - lapBaseRaw
        if (q > queuedMax) queuedMax = q
        return q
    }

    /** The lap ended on input. False when it carried no samples at all (a broken file must not spin). */
    fun wrap(): Boolean {
        if (queuedMax == Long.MIN_VALUE) return false
        offsetUs = queuedMax + frameUs
        lapBaseRaw = fileStartRaw
        queuedMax = Long.MIN_VALUE
        laps++
        return true
    }
}
