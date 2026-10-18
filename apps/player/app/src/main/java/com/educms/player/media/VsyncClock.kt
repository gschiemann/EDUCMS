package com.educms.player.media

import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import kotlin.math.abs

/**
 * EXPERIMENT 4 — `vsyncSnap` (player 1.1.42, plan 2026-10-17 §4E): the vsync grid.
 *
 * A 30 fps clip on a 30 Hz panel has no headroom. The clip's PTS clock and the
 * panel's vsync are two free-running clocks: left alone, a frame periodically
 * straddles a vsync and is held or skipped with perfect decoding (M43, 3.5 h
 * soak: 44 off-cadence intervals, 72 late). Media3's VideoFrameReleaseHelper
 * snaps every release to the vsync closest to the frame's due time and absorbs
 * drift slowly; this is that, for our decoder loop.
 *
 * [VsyncEstimator] is the pure half: a bounded, allocation-free running
 * estimate of the vsync PERIOD (the mean interval over the whole baseline since
 * the last re-anchor, so jitter averages out as 1/N) and PHASE (the latest
 * Choreographer frame timestamp). A missed callback counts as the whole number
 * of periods it spanned; a stamp that fits no grid (a display-mode change, a
 * clock step) re-anchors and starts the baseline again. [VsyncSampler] feeds it
 * from `Choreographer` on the UI thread while any snapping session presents —
 * one callback per vsync, a few integer operations each.
 *
 * Reads happen on the decode thread through two volatiles; a torn read pairs a
 * new anchor with a period that moved by nanoseconds — harmless by construction.
 * The grid is the DEFAULT display's (Choreographer is per thread, driven by the
 * default display); a face on another panel is not snapped (FaceVideoBox).
 */
internal interface VsyncGrid {
    /** True once enough samples were seen to trust the period and the phase. */
    val ready: Boolean
    val periodNs: Long
    /** A recent vsync timestamp (System.nanoTime domain): the grid's phase. */
    val anchorNs: Long
    /** Accepted samples since the last re-anchor. */
    val samples: Long
}

/** The vsync closest to [targetNs] on this grid. */
internal fun VsyncGrid.closestVsync(targetNs: Long): Long {
    val p = periodNs
    val a = anchorNs
    return a + Math.floorDiv(targetNs - a + p / 2, p) * p
}

/** The first vsync at or after [ns] on this grid. */
internal fun VsyncGrid.nextVsyncAtOrAfter(ns: Long): Long {
    val p = periodNs
    val a = anchorNs
    return a + Math.floorDiv(ns - a + p - 1, p) * p
}

internal class VsyncEstimator(nominalPeriodNs: Long) : VsyncGrid {
    private var nominalNs: Long = nominalPeriodNs.coerceIn(MIN_PERIOD_NS, MAX_PERIOD_NS)
    @Volatile override var periodNs: Long = nominalNs
        private set
    @Volatile override var anchorNs: Long = 0L
        private set
    @Volatile override var samples: Long = 0L
        private set
    /** Re-anchors forced by a stamp that fit no grid (a mode change, a clock step). */
    @Volatile var resets: Long = 0L
        private set
    private var firstNs = 0L
    /** Whole vsync periods between [firstNs] and [anchorNs] (missed callbacks included). */
    private var intervals = 0L

    override val ready: Boolean get() = samples >= MIN_SAMPLES

    val nominalPeriodNs: Long get() = nominalNs

    /** One `Choreographer` frame timestamp. UI thread; allocation-free. */
    fun observe(frameTimeNs: Long) {
        val anchor = anchorNs
        if (anchor == 0L) { begin(frameTimeNs); return }
        val delta = frameTimeNs - anchor
        if (delta <= 0L) return // a duplicate or an out-of-order stamp is not a vsync
        val p = periodNs
        val k = (delta + p / 2) / p // whole periods since the anchor; a missed callback counts as what it spanned
        val residual = delta - k * p
        if (k < 1L || abs(residual) > p / 4) {
            // Fits no grid at this period: the display changed mode, or the clock stepped. The
            // observed interval becomes the new hypothesis (a 30 → 60 Hz switch is learned in two
            // stamps) and the baseline starts again here.
            if (delta in MIN_PERIOD_NS..MAX_PERIOD_NS) periodNs = delta
            begin(frameTimeNs)
            resets++
            return
        }
        if (k > MAX_MISSED) {
            // A stall (the UI thread was away for many periods): the stamp still sits on the grid,
            // so the learned period stands and only the baseline restarts.
            begin(frameTimeNs)
            resets++
            return
        }
        intervals += k
        anchorNs = frameTimeNs
        samples++
        if (samples >= MIN_SAMPLES) {
            periodNs = ((frameTimeNs - firstNs) / intervals).coerceIn(MIN_PERIOD_NS, MAX_PERIOD_NS)
        }
    }

    /** The display's nominal rate changed (a mode switch at a session boundary): forget the old grid. */
    fun reset(nominalPeriodNs: Long) {
        nominalNs = nominalPeriodNs.coerceIn(MIN_PERIOD_NS, MAX_PERIOD_NS)
        periodNs = nominalNs
        anchorNs = 0L
        samples = 0L
        firstNs = 0L
        intervals = 0L
    }

    private fun begin(t: Long) {
        firstNs = t
        anchorNs = t
        intervals = 0L
        samples = 1L
    }

    companion object {
        /** Samples before the grid is trusted: the phase is exact from one, the period needs a baseline. */
        const val MIN_SAMPLES = 8L
        /** A gap longer than this many periods is not a missed callback but a stopped display. */
        const val MAX_MISSED = 8L
        /** 240 Hz … 20 Hz. */
        const val MIN_PERIOD_NS = 4_166_666L
        const val MAX_PERIOD_NS = 50_000_000L

        fun periodNsFor(hz: Float): Long =
            (1_000_000_000.0 / (hz.takeIf { it.isFinite() && it >= 20f && it <= 240f } ?: 60f)).toLong()
    }
}

/**
 * Feeds ONE process-wide [VsyncEstimator] from `Choreographer` while at least
 * one snapping session is presenting. UI thread only; [acquire] / [release] are
 * reference-counted so the callback stops re-posting when the last session ends.
 */
internal class VsyncSampler(private val main: Handler = Handler(Looper.getMainLooper())) {
    val estimator = VsyncEstimator(VsyncEstimator.periodNsFor(60f))
    private var users = 0
    private var posted = false
    private val callback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (users <= 0) { posted = false; return }
            estimator.observe(frameTimeNanos)
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /**
     * UI thread. One more session wants the grid of a display at [nominalHz].
     * A nominal that moved by more than 2 % (a mode switch) resets the estimate;
     * the sessions already running then re-lock on the new grid through the
     * bounded slew (VideoFrameSchedule).
     */
    fun acquire(nominalHz: Float): VsyncGrid {
        val nominal = VsyncEstimator.periodNsFor(nominalHz)
        if (abs(estimator.nominalPeriodNs - nominal) * 50L > nominal) estimator.reset(nominal)
        users++
        if (!posted) {
            posted = true
            Choreographer.getInstance().postFrameCallback(callback)
        }
        return estimator
    }

    /** Any thread. The callback stops re-posting once nobody needs the grid. */
    fun release() {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { release() }; return }
        users = maxOf(0, users - 1)
    }

    val active: Boolean get() = users > 0
}
