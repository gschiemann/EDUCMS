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
                t.getString("orientation"), t.getString("fit"))
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
     * Late-frame policy: a frame more than three frame periods late is
     * dropped to catch up — but never two in a row, so a decoder that is
     * merely slow still shows pictures (and the stall watchdog, not this,
     * decides when native has failed).
     */
    fun shouldDrop(lateNs: Long, frameNs: Long, previousDropped: Boolean): Boolean =
        !previousDropped && frameNs > 0 && lateNs > 3 * frameNs

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
