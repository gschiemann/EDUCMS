package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * [DisplayScheduleMath.lastTransitionAtOrBefore] — "when did the schedule
 * last turn the screen on or off?" (2026-10-03, user standby).
 *
 * The user-standby rule compares this instant with the moment a person
 * pressed the remote's power key, so it must name the REAL transition — not
 * the start of a window that overlapped one already running — and it must
 * get the midnight-crossing and DST cases right, exactly like the forward
 * math it mirrors.
 */
class DisplayScheduleLastTransitionTest {

    private val la = "America/Los_Angeles"
    private val all = setOf(0, 1, 2, 3, 4, 5, 6)

    @Test
    fun `returns the latest ON at or after its own instant`() {
        val day = s("day", all, "07:00", "22:00")
        val at = epoch(2026, 9, 30, 7, 0)
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), at)
        assertNotNull(t)
        assertEquals(at, t!!.atMs)
        assertTrue(t.on)
    }

    @Test
    fun `returns the latest OFF after the window closes`() {
        val day = s("day", all, "07:00", "22:00")
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), epoch(2026, 9, 30, 23, 30))
        assertEquals(epoch(2026, 9, 30, 22, 0), t!!.atMs)
        assertFalse(t.on)
    }

    @Test
    fun `before today's ON it is yesterday's OFF`() {
        val day = s("day", all, "07:00", "22:00")
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), epoch(2026, 9, 30, 6, 0))
        assertEquals(epoch(2026, 9, 29, 22, 0), t!!.atMs)
        assertFalse(t.on)
    }

    @Test
    fun `an overlapping window's start is not a trigger`() {
        // 07:00–22:00 plus 12:00–14:00: at 13:00 the last REAL change is 07:00.
        val day = s("day", all, "07:00", "22:00")
        val lunch = s("lunch", all, "12:00", "14:00")
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day, lunch), epoch(2026, 9, 30, 13, 0))
        assertEquals(epoch(2026, 9, 30, 7, 0), t!!.atMs)
        assertTrue(t.on)
    }

    @Test
    fun `a midnight-crossing window turns ON the day before and OFF the next morning`() {
        // Friday 22:00 → Saturday 07:00. 2026-10-02 is a Friday.
        val friNight = s("fri-night", setOf(5), "22:00", "07:00")
        val sat3am = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(friNight), epoch(2026, 10, 3, 3, 0))
        assertEquals(epoch(2026, 10, 2, 22, 0), sat3am!!.atMs)
        assertTrue(sat3am.on)
        val sat8am = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(friNight), epoch(2026, 10, 3, 8, 0))
        assertEquals(epoch(2026, 10, 3, 7, 0), sat8am!!.atMs)
        assertFalse(sat8am.on)
    }

    @Test
    fun `days not in the schedule are skipped back to the last real change`() {
        // Weekdays only; Sunday 2026-10-04 noon → last change is Friday 22:00.
        val weekdays = s("wk", setOf(1, 2, 3, 4, 5), "07:00", "22:00")
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(weekdays), epoch(2026, 10, 4, 12, 0))
        assertEquals(epoch(2026, 10, 2, 22, 0), t!!.atMs)
        assertFalse(t.on)
    }

    @Test
    fun `DST spring-forward lands the ON on the local wall minute`() {
        // 2026-03-08 is the US spring-forward Sunday.
        val day = s("day", all, "07:00", "22:00")
        val t = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), epoch(2026, 3, 8, 9, 0))
        assertEquals(epoch(2026, 3, 8, 7, 0), t!!.atMs)
    }

    @Test
    fun `no schedules means no trigger`() {
        assertNull(DisplayScheduleMath.lastTransitionAtOrBefore(emptyList(), epoch(2026, 9, 30, 12, 0)))
    }

    private fun s(id: String, days: Set<Int>, on: String, off: String) = DisplaySchedule(
        id = id,
        daysOfWeek = days,
        onMinuteOfDay = DisplayScheduleMath.parseHHmm(on)!!,
        offMinuteOfDay = DisplayScheduleMath.parseHHmm(off)!!,
        timezone = la,
    )

    private fun epoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance(TimeZone.getTimeZone(la))
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}
