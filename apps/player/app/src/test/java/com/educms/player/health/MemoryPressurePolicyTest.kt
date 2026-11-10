package com.educms.player.health

import android.content.ComponentCallbacks2
import com.educms.player.health.MemoryPressurePolicy.Action
import org.junit.Assert.*
import org.junit.Test

class MemoryPressurePolicyTest {

    @Suppress("DEPRECATION")
    @Test fun `every literal equals its SDK constant`() {
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE, MemoryPressurePolicy.RUNNING_MODERATE)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW, MemoryPressurePolicy.RUNNING_LOW)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, MemoryPressurePolicy.RUNNING_CRITICAL)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN, MemoryPressurePolicy.UI_HIDDEN)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND, MemoryPressurePolicy.BACKGROUND)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_MODERATE, MemoryPressurePolicy.MODERATE)
        assertEquals(ComponentCallbacks2.TRIM_MEMORY_COMPLETE, MemoryPressurePolicy.COMPLETE)
    }

    private fun d(level: Int, last: Long? = null, held: Boolean? = false, off: Boolean = false, now: Long = 1_000_000L) =
        MemoryPressurePolicy.decide(level, now, last, held, off)

    @Test fun `ui hidden is not pressure - a dark panel is not short of memory`() {
        assertEquals(Action.IGNORE, d(MemoryPressurePolicy.UI_HIDDEN))
        assertEquals(Action.IGNORE, d(0))
    }

    @Test fun `moderate and low levels are recorded only`() {
        for (l in listOf(5, 10, 40, 60)) assertEquals("level $l", Action.RECORD, d(l))
    }

    @Test fun `critical, complete and low-memory free the rebuildable cache`() {
        assertEquals(Action.RECORD_AND_FREE, d(MemoryPressurePolicy.RUNNING_CRITICAL))
        assertEquals(Action.RECORD_AND_FREE, d(MemoryPressurePolicy.COMPLETE))
        assertEquals(Action.RECORD_AND_FREE, d(MemoryPressurePolicy.LOW_MEMORY))
    }

    @Test fun `never frees while an emergency is held or when that state is unreadable`() {
        assertEquals(Action.RECORD, d(15, held = true))
        assertEquals(Action.RECORD, d(80, held = null))
    }

    @Test fun `the kill switch withdraws the free`() {
        assertEquals(Action.RECORD, d(15, off = true))
    }

    @Test fun `one free per cooldown`() {
        val now = 1_000_000L
        assertEquals(Action.RECORD, d(15, last = now - 60_000, now = now))
        assertEquals(Action.RECORD_AND_FREE, d(15, last = now - MemoryPressurePolicy.FREE_COOLDOWN_MS, now = now))
    }

    @Test fun `a box held at critical frees at most once per cooldown over an hour`() {
        var r = MemoryPressurePolicy.Record()
        var t = 0L
        while (t < 60 * 60_000L) {
            val a = MemoryPressurePolicy.decide(15, t, r.lastFreeAtMs, false, false)
            r = MemoryPressurePolicy.apply(r, 15, t, a)
            t += 5_000
        }
        assertEquals(720, r.count)
        assertEquals(6, r.frees)
        assertEquals(15, r.maxLevel)
    }

    @Test fun `the record keeps the highest and the last level`() {
        var r = MemoryPressurePolicy.Record()
        r = MemoryPressurePolicy.apply(r, 60, 10, Action.RECORD)
        r = MemoryPressurePolicy.apply(r, 10, 20, Action.RECORD)
        assertEquals(2, r.count); assertEquals(60, r.maxLevel); assertEquals(10, r.lastLevel); assertEquals(20L, r.lastAtMs)
        assertEquals(0, r.frees)
        assertEquals(r, MemoryPressurePolicy.apply(r, 20, 30, Action.IGNORE))
    }
}
