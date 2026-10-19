package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

/**
 * Experiment 4 (1.1.42, plan §4E): a fake Choreographer proves the vsync
 * estimator converges on a jittery, drifting grid; a fake grid proves the
 * release times never jump — 30 fps lands one frame on every vsync of a 30 Hz
 * grid and on every second vsync of a 60 Hz grid (2:2), with the media clock
 * slewed by a bounded amount per frame to stay locked.
 */
class VsyncClockTest {
    /** Vsync stamps at t0 + n·P with ±jitter and the occasional missed callback — what Choreographer hands a busy UI thread. */
    private class FakeChoreographer(val periodNs: Long, val t0: Long = 1_000_000_000L, seed: Long = 7L) {
        private val rnd = java.util.Random(seed)
        var n = 0L
        fun vsyncAt(n: Long): Long = t0 + n * periodNs
        fun next(jitterNs: Long = 500_000L, miss: (Long) -> Boolean = { false }): Long? {
            n++
            if (miss(n)) return null
            val jitter = if (jitterNs == 0L) 0L else rnd.nextLong() % (jitterNs + 1)
            return vsyncAt(n) + jitter
        }
    }

    private class Grid(override val periodNs: Long, override val anchorNs: Long, override val ready: Boolean = true, override val samples: Long = 100L) : VsyncGrid

    @Test fun theEstimatorConvergesOnAJitteryDriftingGridAndCountsMissedCallbacksAsWholePeriods() {
        // The panel says 30.00 Hz; its real period is 33.340 ms (200 ppm slow) and the stamps jitter ±0.5 ms.
        val truePeriod = 33_340_000L
        val e = VsyncEstimator(VsyncEstimator.periodNsFor(30f))
        assertEquals(33_333_333L, e.nominalPeriodNs)
        assertFalse(e.ready)
        assertEquals(0L, e.anchorNs)
        val fake = FakeChoreographer(truePeriod)
        var fed = 0L
        repeat(1200) { fake.next(miss = { it % 97L == 0L })?.let { e.observe(it); fed++ } }
        assertTrue(e.ready)
        assertEquals(fed, e.samples)
        assertEquals(0L, e.resets)
        assertTrue("period within 2 µs of the truth, got ${e.periodNs}", abs(e.periodNs - truePeriod) < 2_000L)
        // The phase is the latest stamp (±its own jitter); predictions a few frames out stay within that jitter.
        for (ahead in 1L..5L) {
            val truth = fake.vsyncAt(fake.n + ahead)
            assertTrue("prediction $ahead frames out", abs(e.closestVsync(truth) - truth) <= 510_000L)
            val next = e.nextVsyncAtOrAfter(truth - 1_000L)
            assertTrue("next vsync is at or after the asked time", next >= truth - 1_000L)
            assertTrue("…and less than a period later", next < truth - 1_000L + e.periodNs)
            assertEquals(0L, (next - e.anchorNs) % e.periodNs)
        }
        // A duplicate or out-of-order stamp is not a vsync.
        val before = e.samples
        e.observe(e.anchorNs); e.observe(e.anchorNs - 5_000_000L)
        assertEquals(before, e.samples)
    }

    @Test fun aModeSwitchReanchorsAndLearnsTheNewPeriodWhileAStallKeepsTheLearnedOne() {
        val e = VsyncEstimator(VsyncEstimator.periodNsFor(30f))
        val thirty = FakeChoreographer(33_333_333L)
        repeat(200) { thirty.next(jitterNs = 200_000L)?.let(e::observe) }
        assertTrue(e.ready); assertEquals(0L, e.resets)
        val learned = e.periodNs
        // A 400 ms UI stall (12 periods): the grid is unchanged, so the period survives; the baseline restarts.
        var t = thirty.vsyncAt(thirty.n) + 12 * 33_333_333L
        e.observe(t)
        assertEquals(1L, e.resets)
        assertEquals(learned, e.periodNs)
        assertFalse("re-anchored: the baseline must be rebuilt before the grid is trusted again", e.ready)
        repeat(VsyncEstimator.MIN_SAMPLES.toInt()) { t += 33_333_333L; e.observe(t) }
        assertTrue(e.ready)
        // The panel switches to 60 Hz without anyone telling the estimator: the stamps fit no 33 ms grid,
        // it adopts the observed interval and is accurate again within a handful of samples.
        var sixty = t
        repeat(40) { sixty += 16_666_667L; e.observe(sixty) }
        assertTrue(e.ready)
        assertTrue("60 Hz learned, got ${e.periodNs}", abs(e.periodNs - 16_666_667L) < 2_000L)
        assertTrue(e.resets >= 2L)
        // An explicit reset (the sampler saw a new nominal rate) forgets everything.
        e.reset(VsyncEstimator.periodNsFor(60f))
        assertFalse(e.ready); assertEquals(0L, e.anchorNs); assertEquals(16_666_666L, e.periodNs)
        // Bounds: nonsense rates clamp, never divide by zero.
        assertEquals(VsyncEstimator.periodNsFor(60f), VsyncEstimator.periodNsFor(Float.NaN))
        assertEquals(VsyncEstimator.MIN_PERIOD_NS, VsyncEstimator(1L).periodNs)
        assertEquals(VsyncEstimator.MAX_PERIOD_NS, VsyncEstimator(Long.MAX_VALUE / 4).periodNs)
    }

    /** Runs a 30 fps clip through the schedule on [grid]; returns the targets each frame was aimed at. */
    private fun run(grid: VsyncGrid, schedule: VideoFrameSchedule, frames: Int, startNs: Long, onFrame: (Int, Long, Long) -> Unit = { _, _, _ -> }): List<Long> {
        val targets = ArrayList<Long>(frames)
        var now = startNs
        var pts = 0L
        val lead = VideoFrameSchedule.releaseLeadNs(grid.periodNs)
        for (i in 0 until frames) {
            val due = schedule.due(pts, now)
            // The pump hands a frame over about 30 ms before it is due (inside the 2-vsync lead the
            // renderer keeps; later hand-overs release at `now`, still before the target vsync).
            now = maxOf(now, due - 30_000_000L)
            val release = schedule.releaseTime(due, now)
            val target = schedule.lastTargetNs
            assertTrue("frame $i released no earlier than now", release >= now)
            assertTrue("frame $i released before its target vsync", release < target)
            // 1.1.43: the GRID-SIZED lead — exactly releaseLeadNs(P) early (or at `now` when handed over late) …
            assertEquals("frame $i released the grid-sized lead before its vsync", maxOf(target - lead, now), release)
            assertEquals(lead, schedule.lastReleaseLeadNs)
            // … which lands at least half a period before the target on every grid, and NEVER on or before
            // the previous vsync (so SurfaceFlinger can latch it for exactly the target, never an early one).
            assertTrue("frame $i released ≥ P/2 before its vsync: ${target - release} of ${grid.periodNs}", target - release >= grid.periodNs / 2)
            assertTrue("frame $i released after the previous vsync: ${target - release} of ${grid.periodNs}", target - release < grid.periodNs)
            onFrame(i, due, target)
            targets.add(target)
            schedule.submitted(now, target)
            pts += 33_333
        }
        return targets
    }

    @Test fun theReleaseLeadIsSizedToTheGrid() {
        val ms = 1_000_000L
        // 30 Hz (33.3 ms): Media3's 0.8 P — 26.7 ms early, 6.7 ms of latch-phase tolerance.
        assertEquals(33_333_333L * 800L / 1000L, VideoFrameSchedule.releaseLeadNs(33_333_333L))
        // 60 Hz (16.7 ms): 0.5 P — 8.3 ms early, dead centre between the previous and the next latch
        // (the rk3328 / Android 11 unit latched ~0.17 % of frames one vsync EARLY on the 13.3 ms lead).
        assertEquals(16_666_667L / 2L, VideoFrameSchedule.releaseLeadNs(16_666_667L))
        assertTrue(VideoFrameSchedule.releaseLeadNs(16_666_667L) in 8_300_000L..8_400_000L)
        // 50 Hz (20 ms) is the fast end (0.5 P), 40 Hz (25 ms) the slow end (0.8 P); linear between.
        assertEquals(10 * ms, VideoFrameSchedule.releaseLeadNs(20 * ms))
        assertEquals(20 * ms, VideoFrameSchedule.releaseLeadNs(25 * ms))
        val mid = VideoFrameSchedule.releaseLeadNs(22_500_000L) // 44.4 Hz: 0.65 P
        assertEquals(22_500_000L * 650L / 1000L, mid)
        // Monotone in the period across the whole clamp range, and always inside (P/2, 0.8 P].
        var last = 0L
        for (p in 4_166_666L..50_000_000L step 100_000L) {
            val lead = VideoFrameSchedule.releaseLeadNs(p)
            assertTrue("lead for $p: $lead", lead >= p / 2 && lead <= p * 4 / 5)
            assertTrue("non-decreasing at $p", lead >= last)
            last = lead
        }
        // 24 Hz (41.7 ms) and 120 Hz (8.3 ms) sit on the clamps.
        assertEquals(41_666_666L * 800L / 1000L, VideoFrameSchedule.releaseLeadNs(41_666_666L))
        assertEquals(8_333_333L / 2L, VideoFrameSchedule.releaseLeadNs(8_333_333L))
    }

    @Test fun aSixtyHertzGridReleasesEightMillisecondsBeforeEachVsyncAndNeverOnThePreviousOne() {
        val grid = Grid(periodNs = 16_666_667L, anchorNs = 3_000_000_000L)
        val s = VideoFrameSchedule(33_333, 60f, grid)
        var minLead = Long.MAX_VALUE; var maxLead = 0L
        run(grid, s, frames = 6_000, startNs = 3_000_020_000L) { _, _, _ ->
            minLead = minOf(minLead, s.lastReleaseLeadNs); maxLead = maxOf(maxLead, s.lastReleaseLeadNs)
        }
        assertEquals(8_333_333L, minLead); assertEquals(8_333_333L, maxLead)
        assertEquals(6_000L, s.snappedFrames)
        assertEquals(0L, s.lateFrames)
    }

    @Test fun thirtyFpsOnAThirtyHertzGridPutsExactlyOneFrameOnEveryVsyncDespiteDrift() {
        // The clip's PTS step is exactly 33.333 ms; the panel's real vsync is 33.340 ms: 200 ppm of drift.
        val grid = Grid(periodNs = 33_340_000L, anchorNs = 5_000_000_000L)
        val s = VideoFrameSchedule(33_333, 30f, grid)
        assertTrue(s.snapping)
        val targets = run(grid, s, frames = 20_000, startNs = 5_000_123_456L)
        for (i in 1 until targets.size) assertEquals("frame $i is exactly one vsync after frame ${i - 1}", grid.periodNs, targets[i] - targets[i - 1])
        assertEquals(20_000L, s.snappedFrames)
        // Locked: the first frame starts ON a vsync, and the slew keeps every later one within the per-frame drift.
        assertTrue("max snap error ${s.snapErrorMaxUs} µs", s.snapErrorMaxUs <= 10L)
        assertTrue("mean snap error ${s.snapErrorMeanUs} µs", s.snapErrorMeanUs <= 10L)
        // The media clock moved by the accumulated drift (33.340 − 33.333 ms = 7 µs × 20 000 frames), in the drift's direction.
        assertTrue("slew ${s.clockSlewNs} ns", abs(s.clockSlewNs - 20_000L * 7_000L) < 1_000_000L)
        // The late / drop policy is untouched by snapping: nothing here was late.
        assertEquals(0L, s.lateFrames)
    }

    @Test fun thirtyFpsOnASixtyHertzGridIsACleanTwoTwoCadence() {
        val grid = Grid(periodNs = 16_666_667L, anchorNs = 9_000_000_000L)
        val s = VideoFrameSchedule(33_333, 60f, grid)
        val targets = run(grid, s, frames = 20_000, startNs = 9_000_050_000L)
        for (i in 1 until targets.size) assertEquals("frame $i lands two vsyncs after frame ${i - 1}", 2 * grid.periodNs, targets[i] - targets[i - 1])
        assertTrue("max snap error ${s.snapErrorMaxUs} µs", s.snapErrorMaxUs <= 10L)
        assertEquals(20_000L, s.snappedFrames)
    }

    @Test fun aPhaseStepIsAbsorbedByTheBoundedSlewWithNoSkippedOrHeldVsync() {
        // The grid re-anchors 5 ms later than the old phase predicted (a jittered re-anchor): one interval
        // is longer by exactly the step, nothing is skipped or doubled, and the clock catches up at ≤ 0.3 ms / frame.
        val period = 33_333_333L
        var anchor = 2_000_000_000L
        val grid = object : VsyncGrid {
            override val ready = true; override val periodNs = period; override val anchorNs: Long get() = anchor; override val samples = 50L
        }
        val s = VideoFrameSchedule(33_333, 30f, grid)
        val errors = ArrayList<Long>()
        val targets = run(grid, s, frames = 2_000, startNs = 2_000_010_000L) { i, due, target ->
            if (i == 1_000) anchor += 5_000_000L
            errors.add(target - due)
        }
        for (i in 1 until targets.size) {
            val d = targets[i] - targets[i - 1]
            if (i == 1_001) assertEquals("the one interval that carries the grid's own step", period + 5_000_000L, d)
            else assertEquals("frame $i", period, d)
        }
        // Right after the step the frame is early by 5 ms against the new grid (plus one frame of the 333 ns drift
        // between a 33.333000 ms PTS step and the 33.333333 ms grid); within 17 frames the slew has it locked.
        assertTrue("error right after the step: ${errors[1_001]}", errors[1_001] in 5_000_000L..5_001_000L)
        assertTrue(errors[1_001 + 20] in 0L..10_000L)
        for (i in 1_002..1_020) assertTrue("each frame moves at most 0.3 ms: ${errors[i - 1] - errors[i]}", errors[i - 1] - errors[i] <= VideoFrameSchedule.MAX_SLEW_NS)
        // Total slew = the 5 ms step + the drift over 2 000 frames (333 ns each).
        assertTrue("total slew ${s.clockSlewNs}", abs(s.clockSlewNs - (5_000_000L + 2_000L * 333L)) < 100_000L)
        assertEquals(5_000L, s.snapErrorMaxUs)
    }

    @Test fun withoutAReadyGridTheScheduleIsExactlyWhatItWasBefore() {
        val none = VideoFrameSchedule(33_333, 30f)
        val now = 7_000_000_000L
        val due = none.due(1_000_000L, now)
        assertEquals(now, due)
        assertEquals(now + 33_333_000L, none.due(1_033_333L, now))
        assertEquals(maxOf(due, now + 1_000L), none.releaseTime(due, now + 1_000L))
        assertEquals(due + 5_000L, none.releaseTime(due + 5_000L, now))
        assertEquals(0L, none.snappedFrames); assertEquals(0L, none.clockSlewNs); assertFalse(none.snapping)
        val notReady = VideoFrameSchedule(33_333, 30f, Grid(33_333_333L, 1L, ready = false, samples = 2L))
        assertFalse(notReady.snapping)
        val d2 = notReady.due(0L, now)
        assertEquals(now, d2)
        assertEquals(now, notReady.releaseTime(d2, now))
        assertEquals(0L, notReady.snappedFrames)
    }
}
