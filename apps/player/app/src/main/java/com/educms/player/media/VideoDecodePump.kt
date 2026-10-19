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
    /** The release lead (ns) used for the last snapped frame — [releaseLeadNs] of the grid's period at that moment. */
    var lastReleaseLeadNs = 0L; private set

    /** True while releases are being snapped (a grid exists and has enough samples). */
    val snapping: Boolean get() = vsync?.ready == true

    fun start(ptsUs: Long, nowNs: Long) {
        // With a grid the FIRST frame is due on a vsync, one period out so its
        // release (at most 0.8 P early) is still in the future: the one free
        // alignment, made before anything is on the glass.
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
     * the vsync CLOSEST to the due time, asked for [releaseLeadNs] early — a
     * lead SIZED TO THE GRID (1.1.43) so SurfaceFlinger latches the buffer for
     * exactly that vsync: never the one before (Media3's rule) and never the
     * one after. The media clock is then slewed by at most [MAX_SLEW_NS]
     * toward the grid, so the error of the following frames shrinks to zero
     * and stays there instead of walking across half a period and flipping
     * to the next vsync.
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
        val lead = releaseLeadNs(v.periodNs)
        lastReleaseLeadNs = lead
        return maxOf(snapped - lead, nowNs)
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
        /**
         * THE GRID-SIZED RELEASE LEAD (1.1.43, field 2026-10-18). Media3's fixed
         * 0.8 P lead tolerates ~6.6 ms of app-vsync / latch phase offset at
         * 30 Hz but only ~3.3 ms at 60 Hz, and on the rk3328 / Android 11 unit
         * (1080x1920@60.00) it sat near that ROM's latch edge: ~0.17 % of
         * frames were latched one vsync EARLY (17 ms then 50 ms interval
         * pairs, 2,021 of 1.13 M frames in 10.5 h). So the lead is a function
         * of the measured period: 0.8 P on slow grids (period ≥ [LEAD_SLOW_PERIOD_NS],
         * i.e. ≤ 40 Hz), 0.5 P on fast grids (period ≤ [LEAD_FAST_PERIOD_NS],
         * i.e. ≥ 50 Hz), linear between — a 60 Hz grid releases ~8.3 ms before
         * its vsync, dead centre between the previous and the next latch.
         */
        const val LEAD_SLOW_PERIOD_NS = 25_000_000L
        const val LEAD_FAST_PERIOD_NS = 20_000_000L
        const val LEAD_SLOW_PER_MILLE = 800L
        const val LEAD_FAST_PER_MILLE = 500L

        /** The release lead for a vsync grid of [periodNs], in ns (see above). */
        fun releaseLeadNs(periodNs: Long): Long {
            val span = LEAD_SLOW_PERIOD_NS - LEAD_FAST_PERIOD_NS
            val t = (periodNs - LEAD_FAST_PERIOD_NS).coerceIn(0L, span)
            val perMille = LEAD_FAST_PER_MILLE + (LEAD_SLOW_PER_MILLE - LEAD_FAST_PER_MILLE) * t / span
            return periodNs * perMille / 1000L
        }
    }
}
