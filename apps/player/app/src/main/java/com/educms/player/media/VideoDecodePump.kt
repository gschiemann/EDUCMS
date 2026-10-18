package com.educms.player.media

/** All operations stay on the codec thread and must be nonblocking. */
internal class VideoDecodePump(
    private val feed: () -> Boolean,
    private val drain: () -> Boolean,
) {
    fun step(): Boolean {
        var progress = false
        // Release ready output before reading more compressed bytes from disk.
        // A full input queue must never delay the output that frees its space.
        for (i in 0 until 8) {
            if (!drain()) break
            progress = true
        }
        // Fill free input buffers rather than requiring one packet per output
        // frame. Reordering codecs can need several packets before any output.
        for (i in 0 until 8) {
            if (!feed()) break
            progress = true
        }
        return progress
    }
}

/**
 * Surface timestamps use nanoTime; the media clock is never moved to hide
 * lag. The ONE exception is deliberate and bounded (experiment 4, 1.1.42):
 * with a vsync grid ([VsyncGrid]) the clock is slewed by at most
 * [MAX_SLEW_NS] per frame TOWARD the grid, so the frame timeline stays
 * locked to the panel's vsync with no visible jump — the drift between the
 * clip's PTS clock and the panel's vsync is what periodically held or skipped
 * a frame on a 30 Hz panel with perfect decoding.
 */
internal class VideoFrameSchedule(frameUs: Long, refreshRate: Float, private val vsync: VsyncGrid? = null) {
    private val frameNs = frameUs.coerceAtLeast(1) * 1000
    private val hz = refreshRate.takeIf { it.isFinite() && it >= 20f && it <= 240f } ?: 60f
    val leadNs = (2_000_000_000.0 / hz).toLong().coerceAtMost(50_000_000L)
    private var originNs: Long? = null
    private var firstPtsUs = 0L
    private var lastSubmittedNs: Long? = null
    private var lastPresentationNs: Long? = null
    var lateFrames = 0L; private set
    var lastLateUs = 0L; private set
    var maxLateUs = 0L; private set
    var maxSubmitGapMs = 0L; private set
    // Experiment 4 — what the snap did, for the timing snapshot.
    var snappedFrames = 0L; private set
    var snapErrorMaxUs = 0L; private set
    private var snapErrorSumUs = 0L
    val snapErrorMeanUs: Long get() = if (snappedFrames == 0L) 0L else snapErrorSumUs / snappedFrames
    /** Cumulative signed adjustment of the media clock (ns): the measured drift between the two clocks. */
    var clockSlewNs = 0L; private set
    /** The vsync the last snapped frame was aimed at (0 before the first). */
    var lastTargetNs = 0L; private set

    /** True while releases are being snapped (a grid exists and has enough samples). */
    val snapping: Boolean get() = vsync?.ready == true

    fun start(ptsUs: Long, nowNs: Long) {
        // With a grid the FIRST frame is due on a vsync, one period out so its
        // release (0.8 P early) is still in the future: the one free alignment,
        // made before anything is on the glass.
        val v = vsync
        originNs = if (v != null && v.ready) v.nextVsyncAtOrAfter(nowNs + v.periodNs) else nowNs
        firstPtsUs = ptsUs
        lastSubmittedNs = nowNs
        lastPresentationNs = nowNs
    }

    fun due(ptsUs: Long, nowNs: Long): Long {
        if (originNs == null) start(ptsUs, nowNs)
        return originNs!! + (ptsUs - firstPtsUs) * 1000
    }

    /**
     * The timestamp to hand `releaseOutputBuffer` for a frame due at [dueNs]:
     * without a grid, the due time itself (never earlier than now); with one,
     * the vsync CLOSEST to the due time, asked for [VSYNC_LEAD_NUM]/[VSYNC_LEAD_DEN]
     * of a period early so SurfaceFlinger latches the buffer for exactly that
     * vsync and never the one before (Media3's rule). The media clock is then
     * slewed by at most [MAX_SLEW_NS] toward the grid, so the error of the
     * following frames shrinks to zero and stays there instead of walking
     * across half a period and flipping to the next vsync.
     */
    fun releaseTime(dueNs: Long, nowNs: Long): Long {
        val v = vsync
        if (v == null || !v.ready) return maxOf(dueNs, nowNs)
        val snapped = v.closestVsync(dueNs)
        val err = snapped - dueNs
        snappedFrames++
        val errUs = (if (err < 0) -err else err) / 1000
        snapErrorSumUs += errUs
        if (errUs > snapErrorMaxUs) snapErrorMaxUs = errUs
        val slew = err.coerceIn(-MAX_SLEW_NS, MAX_SLEW_NS)
        originNs = (originNs ?: nowNs) + slew
        clockSlewNs += slew
        lastTargetNs = snapped
        return maxOf(snapped - v.periodNs * VSYNC_LEAD_NUM / VSYNC_LEAD_DEN, nowNs)
    }

    fun shouldDrop(dueNs: Long, nowNs: Long): Boolean =
        nowNs - dueNs > frameNs &&
            lastSubmittedNs?.let { nowNs - it < 250_000_000L } == true

    fun observe(dueNs: Long, nowNs: Long) {
        lastLateUs = ((nowNs - dueNs) / 1000).coerceAtLeast(0)
        if (lastLateUs > 0) lateFrames++
        maxLateUs = maxOf(maxLateUs, lastLateUs)
    }

    fun submitted(nowNs: Long, presentationNs: Long = nowNs) {
        lastSubmittedNs?.let { maxSubmitGapMs = maxOf(maxSubmitGapMs, (nowNs - it) / 1_000_000) }
        lastSubmittedNs = nowNs
        lastPresentationNs = presentationNs
    }

    /** An empty EOS may follow a future-scheduled last picture immediately. */
    fun endDeadline(nowNs: Long): Long = lastPresentationNs?.let { it + frameNs } ?: nowNs

    companion object {
        /** "A few hundred microseconds per frame": 0.3 ms, i.e. at most 0.9 % of a 30 fps period. */
        const val MAX_SLEW_NS = 300_000L
        /** Release 0.8 of a vsync period before the target vsync (Media3's VSYNC_OFFSET_PERCENTAGE). */
        const val VSYNC_LEAD_NUM = 4L
        const val VSYNC_LEAD_DEN = 5L
    }
}
