package com.educms.player.media

import kotlin.math.abs

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
    // 1.1.47 — the PARITY LOCK (field 2026-10-20, M43 / L55VEC): a 30 fps clip on a 60 Hz vsync grid
    // whose panel scans at 30 Hz. Every frame must land on the SAME one of the two 60 Hz phases; a
    // release that moves to the other phase is shown one 60 Hz tick early or late by the 30 Hz scan —
    // a judder no release-interval counter sees. See [releaseTime].
    /** Vsyncs per frame while the lock holds (grid = N × fps, N ≥ 2); 0 when the cadence is not an integer multiple. */
    var lockMultiple = 0; private set
    /** The last locked target vsync: every later target sits a whole multiple of [lockMultiple] periods from it. */
    private var lockBaseNs = 0L
    private var lockBaseDueNs = 0L
    /** True while releases are locked to one parity of the grid. */
    val parityLocked: Boolean get() = lockMultiple >= 2 && lockBaseNs != 0L
    /** Locked targets that landed on another parity than the lock (only a grid that itself stepped can do it; expected 0). */
    var parityFlips = 0L; private set
    /** Deliberate one-frame holds or skips at the locked cadence that absorbed media-clock drift. */
    var driftCorrections = 0L; private set
    /** Frames whose closest vsync was on the other parity and were kept on the locked one instead. */
    var parityRescues = 0L; private set

    /** True while releases are being snapped (a grid exists and has enough samples). */
    val snapping: Boolean get() = vsync?.ready == true

    fun start(ptsUs: Long, nowNs: Long) {
        // With a grid the FIRST frame is due on a vsync, one period out so its
        // release (at most 0.8 P early) is still in the future: the one free
        // alignment, made before anything is on the glass.
        val v = vsync
        originNs = if (v != null && v.ready) v.nextVsyncAtOrAfter(nowNs + v.periodNs) else nowNs
        firstPtsUs = ptsUs
        // The parity is chosen ONCE per session, by its first snapped frame.
        lockBaseNs = 0L; lockBaseDueNs = 0L; lockMultiple = 0
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
        val snapped = lockedTarget(v, dueNs)
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

    /**
     * 1.1.47 — THE PARITY LOCK. When the grid is an integer multiple N ≥ 2 of
     * the clip's rate ([cadenceMultiple]: 30 fps on 60 Hz, 25 on 50, 24 on 48),
     * the first snapped frame picks one of the N phases and every later target
     * stays on it: the closest vsync of THAT phase, never the closest vsync
     * overall. Drift between the clip's clock and the panel is absorbed by the
     * same bounded slew; when it ever exceeds half a FRAME the target moves by
     * a whole frame on the locked cadence (a deliberate one-frame hold or skip,
     * counted in [driftCorrections]) — never by one vsync onto the other phase.
     * Any other cadence (30 on 30 Hz, 60 on 60 Hz) snaps exactly as before.
     */
    private fun lockedTarget(v: VsyncGrid, dueNs: Long): Long {
        val p = v.periodNs
        val nearest = v.closestVsync(dueNs)
        val n = cadenceMultiple(frameNs, p)
        if (n < 2) { lockMultiple = 0; lockBaseNs = 0L; return nearest }
        if (n != lockMultiple || lockBaseNs == 0L) {
            // First snapped frame of the session (or the grid changed its multiple): choose the parity once.
            lockMultiple = n; lockBaseNs = nearest; lockBaseDueNs = dueNs
            return nearest
        }
        val base = lockBaseNs
        val k = Math.floorDiv(nearest - base + p / 2, p)
        val r = Math.floorMod(k, n.toLong())
        val target = if (r == 0L) nearest else {
            parityRescues++
            // Re-snapped onto the CURRENT grid, so a grid that re-anchored still gets real vsyncs.
            val lo = v.closestVsync(base + (k - r) * p)
            val hi = v.closestVsync(base + (k + n - r) * p)
            if (abs(dueNs - lo) <= abs(hi - dueNs)) lo else hi
        }
        // Honest bookkeeping against the lock base: the parity actually aimed at, and whether the step
        // from the last target differs from the step the clip's own clock asked for (a hold or a skip).
        val kt = Math.floorDiv(target - base + p / 2, p)
        if (Math.floorMod(kt, n.toLong()) != 0L) parityFlips++
        val step = n.toLong() * p
        val asked = Math.floorDiv(dueNs - lockBaseDueNs + step / 2, step)
        val got = Math.floorDiv(target - base + step / 2, step)
        if (asked != got) driftCorrections++
        lockBaseNs = target; lockBaseDueNs = dueNs
        return target
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
        /** A frame period within this fraction (per mille) of N grid periods counts as an N:1 cadence. */
        const val CADENCE_TOLERANCE_PER_MILLE = 30L

        /**
         * N when one frame of [frameNs] spans N ≥ 2 whole periods of a grid of
         * [periodNs] (within [CADENCE_TOLERANCE_PER_MILLE]); else 0 — 1:1 and
         * non-integer cadences are not parity-locked.
         */
        fun cadenceMultiple(frameNs: Long, periodNs: Long): Int {
            if (periodNs <= 0L || frameNs <= 0L) return 0
            val n = (frameNs + periodNs / 2) / periodNs
            if (n < 2L || n > 8L) return 0
            val off = abs(frameNs - n * periodNs)
            return if (off * 1000L <= n * periodNs * CADENCE_TOLERANCE_PER_MILLE) n.toInt() else 0
        }

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
