package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Measurement that cannot lie (plan §4E, STAB-01): the interval histogram and the persisted ledger. */
class NativeVideoTimingTest {
    private val ms = 1_000_000L

    @Test fun bucketsAreCentredOnQuarterPeriodsSoTheJudderPatternIsReadable() {
        val h = RenderIntervalHistogram.forFps(30.0)
        assertEquals(8_333_333L, h.unitNs)
        // 33.3 ms = the source period: bucket 4, with ±4.17 ms of slack on either side.
        assertEquals(4, h.bucketOf(33_333_333L))
        assertEquals(4, h.bucketOf(29_200_000L))
        assertEquals(4, h.bucketOf(37_400_000L))
        assertEquals(3, h.bucketOf(29_100_000L))
        assertEquals(5, h.bucketOf(37_600_000L))
        // The bimodal 17 / 50 ms judder lands in buckets 2 and 6; a dropped compositor frame (2P) in 8.
        assertEquals(2, h.bucketOf(16_700_000L))
        assertEquals(6, h.bucketOf(50 * ms))
        assertEquals(8, h.bucketOf(66_666_666L))
        // Duplicates and very long gaps are clamped into the end buckets, never lost.
        assertEquals(0, h.bucketOf(1))
        assertEquals(15, h.bucketOf(130 * ms))
        assertEquals(15, h.bucketOf(10_000 * ms))
        assertEquals(RenderIntervalHistogram.PERIOD_BUCKET, 4)
    }

    @Test fun aSmoothThirtyFpsSessionHasEveryIntervalInThePeriodBucket() {
        val h = RenderIntervalHistogram.forFps(30.0)
        repeat(1800) { h.observe(33_333_333L + (it % 7) * 400_000L - 1_200_000L) }
        assertEquals(1800L, h.count)
        assertEquals(1800L, h.onPeriod())
        assertEquals(1800L, h.buckets()[4])
        assertTrue(h.minNs in 32_000_000L..33_400_000L)
        assertTrue(h.maxNs in 33_300_000L..34_600_000L)
        assertEquals(33_333_333L + (1799 % 7) * 400_000L - 1_200_000L, h.lastNs)
    }

    @Test fun theJudderYouCanSeeShowsAsABimodalHistogramWhileCountersLookHealthy() {
        val h = RenderIntervalHistogram.forFps(30.0)
        repeat(600) { h.observe(if (it % 2 == 0) 16_700_000L else 50 * ms) }
        val b = h.buckets()
        assertEquals(300L, b[2]); assertEquals(300L, b[6]); assertEquals(0L, b[4])
        assertEquals(0L, h.onPeriod())
        assertEquals(600L, h.count)
        assertEquals(33_350_000L, h.meanNs()) // the mean alone would call this perfect
    }

    @Test fun nonPositiveDeltasAreClockArtefactsAndTheReportIsBoundedAndRoundTrips() {
        val h = RenderIntervalHistogram.forFps(30.0)
        h.observe(0); h.observe(-5)
        assertEquals(0L, h.count)
        h.observe(33 * ms)
        val j = h.writeTo(JSONObject())
        assertEquals(16, j.getJSONArray("intervalBuckets").length())
        assertEquals(1L, j.getLong("intervalCount"))
        assertEquals(33 * ms, j.getLong("intervalMinNs"))
        assertEquals(33 * ms, j.getLong("intervalMaxNs"))
        assertEquals(33 * ms, j.getLong("intervalLastNs"))
        assertEquals(33 * ms, j.getLong("intervalMeanNs"))
        assertEquals(8_333_333L, j.getLong("intervalUnitNs"))
        // Any frame rate: the unit follows the period; a nonsense rate is clamped, never a division by zero.
        assertEquals(4_166_666L, RenderIntervalHistogram.forFps(60.0).unitNs)
        assertTrue(RenderIntervalHistogram.forFps(0.0).unitNs > 0)
        assertTrue(RenderIntervalHistogram.forFps(Double.NaN).unitNs > 0)
        assertEquals(1L, RenderIntervalHistogram(3).unitNs)
    }

    private class Memory(var value: String? = null) : NativeTimingLedger.Store {
        var writes = 0
        override fun read(): String? = value
        override fun write(value: String) { this.value = value; writes++ }
    }

    private fun entry(n: Int, reason: String = "page-stopped") = JSONObject().put("n", n).put("reason", reason).put("at", 1000L + n)

    @Test fun theLedgerIsBoundedWithAnExplicitOverflowCountAndSurvivesAReload() {
        val store = Memory()
        val ledger = NativeTimingLedger(store, capacity = 3)
        for (n in 1..5) ledger.record(entry(n))
        assertEquals(3, ledger.size)
        assertEquals(2L, ledger.overflow)
        val snap = ledger.snapshot()
        assertEquals(3, snap.getJSONArray("entries").length())
        assertEquals(3, snap.getJSONArray("entries").getJSONObject(0).getInt("n"))
        assertEquals(5, snap.getJSONArray("entries").getJSONObject(2).getInt("n"))
        assertEquals(2L, snap.getLong("overflow"))
        assertEquals(3, snap.getInt("capacity"))
        // A new process reads the same queue back, overflow included.
        val reloaded = NativeTimingLedger(store, capacity = 3)
        assertEquals(3, reloaded.size)
        assertEquals(2L, reloaded.overflow)
        assertFalse(reloaded.hasLive)
    }

    @Test fun aSessionTheProcessNeverClosedBecomesItsOwnEntryOnTheNextBoot() {
        val store = Memory()
        NativeTimingLedger(store, capacity = 4).apply {
            record(entry(1))
            live(entry(2, reason = "running"))
        }
        assertTrue(JSONObject(store.value!!).has("live"))
        // The process died here. The next one recovers the checkpoint as a failure of its own.
        val next = NativeTimingLedger(store, capacity = 4)
        assertTrue(next.hasLive)
        assertTrue(next.recoverLive(NativeTimingLedger.REASON_PROCESS_ENDED, atMs = 99_000L))
        assertFalse(next.hasLive)
        assertFalse("nothing to recover twice", next.recoverLive(NativeTimingLedger.REASON_PROCESS_ENDED, 99_001L))
        val entries = next.snapshot().getJSONArray("entries")
        assertEquals(2, entries.length())
        val recovered = entries.getJSONObject(1)
        assertEquals(2, recovered.getInt("n"))
        assertEquals("process-ended", recovered.getString("reason"))
        assertEquals(99_000L, recovered.getLong("at"))
        assertTrue(recovered.getBoolean("recovered"))
        // A fresh session cannot erase the previous failure (STAB-01).
        next.live(entry(3, "running")); next.record(entry(3))
        assertEquals("process-ended", next.snapshot().getJSONArray("entries").getJSONObject(1).getString("reason"))
        assertEquals(3, next.snapshot().getJSONArray("entries").length())
    }

    @Test fun aCheckpointFromAnEarlierBootIsADeviceRebootNotAProcessDeath() {
        // The fleet's panels reboot nightly on an OEM schedule; the accounting must survive the device, not just the process.
        assertEquals("device-rebooted", NativeTimingLedger.recoveryReason(41, 42))
        assertEquals("process-ended", NativeTimingLedger.recoveryReason(42, 42))
        assertEquals("process-ended", NativeTimingLedger.recoveryReason(null, 42))
        assertEquals("process-ended", NativeTimingLedger.recoveryReason(41, null))
        val store = Memory()
        NativeTimingLedger(store, capacity = 4).live(entry(1, "running").put("bootCount", 41))
        val next = NativeTimingLedger(store, capacity = 4)
        assertEquals(41L, next.liveBootCount)
        assertTrue(next.recoverLive(NativeTimingLedger.recoveryReason(next.liveBootCount, 42), 5L))
        assertEquals("device-rebooted", next.snapshot().getJSONArray("entries").getJSONObject(0).getString("reason"))
        assertEquals(41L, next.snapshot().getJSONArray("entries").getJSONObject(0).getLong("bootCount"))
        // A checkpoint without a boot count, or a boot count that cannot be read, is a process death.
        NativeTimingLedger(store, capacity = 4).live(entry(2, "running").put("bootCount", JSONObject.NULL))
        assertNull(NativeTimingLedger(store, capacity = 4).liveBootCount)
    }

    @Test fun aCleanEndClearsTheCheckpointAndGarbageOnDiskIsAnEmptyLedgerNotACrash() {
        val store = Memory()
        val ledger = NativeTimingLedger(store, capacity = 2)
        ledger.live(entry(1, "running"))
        ledger.record(entry(1))
        assertFalse(JSONObject(store.value!!).has("live"))
        assertFalse(NativeTimingLedger(store, capacity = 2).hasLive)
        val broken = NativeTimingLedger(Memory("not json"), capacity = 2)
        assertEquals(0, broken.size)
        assertEquals(0L, broken.overflow)
        assertFalse(broken.recoverLive("process-ended", 1L))
        val bigger = NativeTimingLedger(Memory(JSONObject().put("entries", org.json.JSONArray(listOf(entry(1), entry(2), entry(3)))).put("overflow", -4).toString()), capacity = 2)
        assertEquals("a queue longer than the capacity is cut at the capacity", 2, bigger.size)
        assertEquals(0L, bigger.overflow)
    }
}
