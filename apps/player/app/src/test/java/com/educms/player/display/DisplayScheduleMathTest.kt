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
 * Schedule time math: timezones, DST, and the midnight-crossing case.
 *
 * This is the code that decides whether a wall-mounted screen is lit.
 * Getting the midnight-crossing wrong by one day means a Friday-night
 * 22:00→07:00 schedule blanks the screen at midnight instead of 07:00;
 * getting the timezone wrong means a California school's hallway goes
 * dark at 14:00 because the box shipped from a factory on Asia/Shanghai.
 *
 * Pure JVM — no android.*, no device clock. Every "now" is passed in.
 */
class DisplayScheduleMathTest {

    private val LA = "America/Los_Angeles"
    private val NY = "America/New_York"
    private val TOKYO = "Asia/Tokyo"

    // ─── HH:mm parsing ──────────────────────────────────────────────

    @Test
    fun `parses HH mm and refuses anything else`() {
        assertEquals(0, DisplayScheduleMath.parseHHmm("00:00"))
        assertEquals(7 * 60, DisplayScheduleMath.parseHHmm("07:00"))
        assertEquals(22 * 60 + 30, DisplayScheduleMath.parseHHmm("22:30"))
        assertEquals(23 * 60 + 59, DisplayScheduleMath.parseHHmm("23:59"))
        assertEquals(7 * 60, DisplayScheduleMath.parseHHmm("7:00"))
        assertEquals(7 * 60, DisplayScheduleMath.parseHHmm("07:00:00"))

        listOf(null, "", "  ", "24:00", "07:60", "-1:00", "7", "7:00 PM", "abc", "07:00:99", "1:2:3:4")
            .forEach { assertNull("must reject '$it'", DisplayScheduleMath.parseHHmm(it)) }
    }

    @Test
    fun `parses the day tokens this repo already uses`() {
        assertEquals(0, DisplayScheduleMath.parseDayToken("Sun"))
        assertEquals(1, DisplayScheduleMath.parseDayToken("mon"))
        assertEquals(1, DisplayScheduleMath.parseDayToken("Monday"))
        assertEquals(6, DisplayScheduleMath.parseDayToken("SAT"))
        assertEquals(3, DisplayScheduleMath.parseDayToken("3"))
        assertNull(DisplayScheduleMath.parseDayToken("7"))
        assertNull(DisplayScheduleMath.parseDayToken("Funday"))
        assertNull(DisplayScheduleMath.parseDayToken(null))
    }

    // ─── same-day window: on 07:00 / off 22:00 ──────────────────────

    @Test
    fun `same-day window 0700 to 2200 is on during the day and off at night`() {
        val weekdays = setOf(1, 2, 3, 4, 5) // Mon..Fri
        val s = schedule("day", weekdays, "07:00", "22:00", LA)
        assertFalse(s.crossesMidnight)

        // Wednesday 2026-08-12 in Los Angeles.
        assertFalse("06:59 is before the window", covers(s, LA, 2026, 8, 12, 6, 59))
        assertTrue("07:00 is the first lit minute", covers(s, LA, 2026, 8, 12, 7, 0))
        assertTrue(covers(s, LA, 2026, 8, 12, 12, 0))
        assertTrue("21:59 is the last lit minute", covers(s, LA, 2026, 8, 12, 21, 59))
        assertFalse("22:00 is the first dark minute", covers(s, LA, 2026, 8, 12, 22, 0))
        assertFalse(covers(s, LA, 2026, 8, 12, 23, 30))
        assertFalse("after midnight is NOT covered by a same-day window", covers(s, LA, 2026, 8, 13, 2, 0))
    }

    @Test
    fun `a day not in daysOfWeek is never lit`() {
        val s = schedule("weekdays", setOf(1, 2, 3, 4, 5), "07:00", "22:00", LA)
        // 2026-08-15 is a Saturday, 2026-08-16 a Sunday.
        assertFalse(covers(s, LA, 2026, 8, 15, 12, 0))
        assertFalse(covers(s, LA, 2026, 8, 16, 12, 0))
        assertTrue(covers(s, LA, 2026, 8, 17, 12, 0)) // Monday
    }

    // ─── MIDNIGHT CROSSING: on 22:00 / off 07:00 ────────────────────

    @Test
    fun `midnight-crossing window 2200 to 0700 runs into the NEXT morning`() {
        // Friday only. daysOfWeek names the day the window STARTS on,
        // so "Friday night" keeps the screen lit into Saturday 07:00.
        val s = schedule("friday-night", setOf(5), "22:00", "07:00", LA)
        assertTrue(s.crossesMidnight)

        // 2026-08-14 is a Friday.
        assertFalse("21:59 Friday is still dark", covers(s, LA, 2026, 8, 14, 21, 59))
        assertTrue("22:00 Friday lights up", covers(s, LA, 2026, 8, 14, 22, 0))
        assertTrue("23:59 Friday still lit", covers(s, LA, 2026, 8, 14, 23, 59))
        assertTrue("00:00 SATURDAY still lit — this is the case that breaks naive math", covers(s, LA, 2026, 8, 15, 0, 0))
        assertTrue("03:00 Saturday still lit", covers(s, LA, 2026, 8, 15, 3, 0))
        assertTrue("06:59 Saturday is the last lit minute", covers(s, LA, 2026, 8, 15, 6, 59))
        assertFalse("07:00 Saturday goes dark", covers(s, LA, 2026, 8, 15, 7, 0))
        assertFalse("Saturday NIGHT is dark — Saturday is not a start day", covers(s, LA, 2026, 8, 15, 23, 0))
        assertFalse("Friday MORNING is dark — the window has not started yet", covers(s, LA, 2026, 8, 14, 3, 0))
    }

    @Test
    fun `the two windows are exact complements of each other`() {
        // 07:00→22:00 and 22:00→07:00 on every day must partition the
        // clock: every instant is covered by exactly one of them.
        val allDays = setOf(0, 1, 2, 3, 4, 5, 6)
        val day = schedule("day", allDays, "07:00", "22:00", LA)
        val night = schedule("night", allDays, "22:00", "07:00", LA)
        val base = epoch(LA, 2026, 8, 12, 0, 0)
        for (minute in 0 until (48 * 60)) {
            val at = base + minute * 60_000L
            val inDay = DisplayScheduleMath.covers(day, at)
            val inNight = DisplayScheduleMath.covers(night, at)
            assertTrue("minute $minute must be covered by exactly one window", inDay != inNight)
        }
    }

    // ─── timezones ──────────────────────────────────────────────────

    @Test
    fun `the SCREEN timezone decides, not the JVM default`() {
        val la = schedule("la", setOf(3), "07:00", "22:00", LA)
        val tokyo = schedule("tokyo", setOf(3), "07:00", "22:00", TOKYO)

        // 2026-08-12 15:00 UTC = 08:00 in Los Angeles (lit) and
        // 00:00 on the 13th in Tokyo (dark, and a different weekday).
        val at = epoch("UTC", 2026, 8, 12, 15, 0)
        assertTrue("08:00 LA is inside the window", DisplayScheduleMath.covers(la, at))
        assertFalse("midnight Tokyo is outside it", DisplayScheduleMath.covers(tokyo, at))
    }

    @Test
    fun `two screens in different zones each honour their own schedule`() {
        val la = schedule("la", setOf(0, 1, 2, 3, 4, 5, 6), "07:00", "22:00", LA)
        val ny = schedule("ny", setOf(0, 1, 2, 3, 4, 5, 6), "07:00", "22:00", NY)
        // 2026-08-12 11:30 UTC = 04:30 LA (dark) / 07:30 NY (lit).
        val at = epoch("UTC", 2026, 8, 12, 11, 30)
        assertFalse(DisplayScheduleMath.covers(la, at))
        assertTrue(DisplayScheduleMath.covers(ny, at))
        assertTrue(DisplayScheduleMath.desiredOnAt(listOf(ny), at) == true)
        assertTrue(DisplayScheduleMath.desiredOnAt(listOf(la), at) == false)
    }

    @Test
    fun `an unknown timezone falls back to UTC, never to the device default`() {
        // A Goodview box very often still carries the factory's
        // timezone. Silently using it would look like a schedule bug
        // rather than a bad zone id.
        val bogus = DisplayScheduleMath.zoneOf("Mars/Olympus_Mons")
        assertEquals("UTC", bogus.id)
        assertEquals("UTC", DisplayScheduleMath.zoneOf("").id)
        assertEquals(TimeZone.getTimeZone(LA).id, DisplayScheduleMath.zoneOf(LA).id)
    }

    @Test
    fun `spring-forward and fall-back keep the wall-clock boundary`() {
        // 2026-03-08 is US spring-forward (02:00 → 03:00 local).
        val s = schedule("dst", setOf(0, 1, 2, 3, 4, 5, 6), "07:00", "22:00", LA)
        assertTrue("07:00 local on the short day is still the boundary", covers(s, LA, 2026, 3, 8, 7, 0))
        assertFalse(covers(s, LA, 2026, 3, 8, 6, 59))

        // 2026-11-01 is fall-back (02:00 happens twice).
        assertTrue(covers(s, LA, 2026, 11, 1, 7, 0))
        assertFalse(covers(s, LA, 2026, 11, 1, 22, 0))

        // The overnight window across the fall-back night is ~10 h of
        // wall clock but 11 h of real time — the boundary is what
        // matters, and it holds.
        val night = schedule("n", setOf(0, 1, 2, 3, 4, 5, 6), "22:00", "07:00", LA)
        assertTrue(covers(night, LA, 2026, 10, 31, 23, 0))
        assertTrue(covers(night, LA, 2026, 11, 1, 6, 59))
        assertFalse(covers(night, LA, 2026, 11, 1, 7, 0))
    }

    // ─── desiredOnAt semantics ──────────────────────────────────────

    @Test
    fun `no schedules means NO OPINION, never blank`() {
        assertNull(
            "an empty schedule list must not be read as 'turn the screen off'",
            DisplayScheduleMath.desiredOnAt(emptyList(), System.currentTimeMillis()),
        )
    }

    @Test
    fun `overlapping schedules union to ON`() {
        val morning = schedule("am", setOf(3), "06:00", "12:00", LA)
        val evening = schedule("pm", setOf(3), "17:00", "23:00", LA)
        val at1 = epoch(LA, 2026, 8, 12, 7, 0)
        val at2 = epoch(LA, 2026, 8, 12, 14, 0)
        val at3 = epoch(LA, 2026, 8, 12, 18, 0)
        assertEquals(true, DisplayScheduleMath.desiredOnAt(listOf(morning, evening), at1))
        assertEquals(false, DisplayScheduleMath.desiredOnAt(listOf(morning, evening), at2))
        assertEquals(true, DisplayScheduleMath.desiredOnAt(listOf(morning, evening), at3))
    }

    // ─── next transition ────────────────────────────────────────────

    @Test
    fun `next transition finds the upcoming boundary and its target state`() {
        val s = schedule("day", setOf(0, 1, 2, 3, 4, 5, 6), "07:00", "22:00", LA)

        // At 05:00 the next boundary is 07:00, turning the screen ON.
        val morning = DisplayScheduleMath.nextTransitionAfter(listOf(s), epoch(LA, 2026, 8, 12, 5, 0))
        assertNotNull(morning)
        requireNotNull(morning)
        assertEquals(epoch(LA, 2026, 8, 12, 7, 0), morning.atMs)
        assertTrue("the 07:00 boundary turns the screen on", morning.on)

        // At 12:00 the next boundary is 22:00, turning it OFF.
        val evening = DisplayScheduleMath.nextTransitionAfter(listOf(s), epoch(LA, 2026, 8, 12, 12, 0))
        requireNotNull(evening)
        assertEquals(epoch(LA, 2026, 8, 12, 22, 0), evening.atMs)
        assertFalse("the 22:00 boundary turns the screen off", evening.on)

        // At 23:00 the next boundary is 07:00 TOMORROW.
        val tomorrow = DisplayScheduleMath.nextTransitionAfter(listOf(s), epoch(LA, 2026, 8, 12, 23, 0))
        requireNotNull(tomorrow)
        assertEquals(epoch(LA, 2026, 8, 13, 7, 0), tomorrow.atMs)
        assertTrue(tomorrow.on)
    }

    @Test
    fun `next transition across a midnight-crossing window lands on the morning boundary`() {
        val s = schedule("night", setOf(5), "22:00", "07:00", LA)
        // Friday 23:00 → the next boundary is Saturday 07:00, OFF.
        val next = DisplayScheduleMath.nextTransitionAfter(listOf(s), epoch(LA, 2026, 8, 14, 23, 0))
        requireNotNull(next)
        assertEquals(epoch(LA, 2026, 8, 15, 7, 0), next.atMs)
        assertFalse(next.on)
    }

    @Test
    fun `next transition skips a whole week when only one day is selected`() {
        val s = schedule("sunday", setOf(0), "09:00", "17:00", LA)
        // Monday 2026-08-10 → next boundary is Sunday 2026-08-16 09:00.
        val next = DisplayScheduleMath.nextTransitionAfter(listOf(s), epoch(LA, 2026, 8, 10, 12, 0))
        requireNotNull(next)
        assertEquals(epoch(LA, 2026, 8, 16, 9, 0), next.atMs)
        assertTrue(next.on)
    }

    @Test
    fun `no schedules means no alarm to arm`() {
        assertNull(DisplayScheduleMath.nextTransitionAfter(emptyList(), System.currentTimeMillis()))
    }

    // ─── config parsing of schedule rows ────────────────────────────

    @Test
    fun `equal on and off times drops the row instead of guessing`() {
        val config = DisplayConfigParser.parse(
            """
            {"timezone":"$LA","schedules":[
              {"id":"typo","daysOfWeek":["Mon"],"onTime":"07:00","offTime":"07:00"},
              {"id":"good","daysOfWeek":["Mon"],"onTime":"07:00","offTime":"22:00"}
            ]}
            """.trimIndent(),
        )
        assertEquals(1, config.schedules.size)
        assertEquals("good", config.schedules[0].id)
        assertTrue(config.warnings.any { it.contains("typo") })
    }

    @Test
    fun `a row with no timezone is dropped rather than defaulting to the device clock`() {
        val config = DisplayConfigParser.parse(
            """{"schedules":[{"id":"tzless","daysOfWeek":["Mon"],"onTime":"07:00","offTime":"22:00"}]}""",
        )
        assertEquals(0, config.schedules.size)
        assertTrue(config.warnings.any { it.contains("timezone") })
    }

    @Test
    fun `daysOfWeek accepts names, ints and the comma string this repo already uses`() {
        val byName = DisplayConfigParser.parse(
            """{"timezone":"$LA","schedules":[{"daysOfWeek":["Mon","Wed","Fri"],"onTime":"07:00","offTime":"22:00"}]}""",
        )
        assertEquals(setOf(1, 3, 5), byName.schedules.single().daysOfWeek)

        val byInt = DisplayConfigParser.parse(
            """{"timezone":"$LA","schedules":[{"daysOfWeek":[0,6],"onTime":"07:00","offTime":"22:00"}]}""",
        )
        assertEquals(setOf(0, 6), byInt.schedules.single().daysOfWeek)

        val byCsv = DisplayConfigParser.parse(
            """{"timezone":"$LA","schedules":[{"daysOfWeek":"Mon,Tue,Wed","onTime":"07:00","offTime":"22:00"}]}""",
        )
        assertEquals(setOf(1, 2, 3), byCsv.schedules.single().daysOfWeek)
    }

    @Test
    fun `inactive rows are skipped and a malformed row does not kill its siblings`() {
        val config = DisplayConfigParser.parse(
            """
            {"timezone":"$LA","schedules":[
              {"id":"off","isActive":false,"daysOfWeek":["Mon"],"onTime":"07:00","offTime":"22:00"},
              {"id":"broken","daysOfWeek":["Mon"],"onTime":"nope","offTime":"22:00"},
              {"id":"nodays","daysOfWeek":[],"onTime":"07:00","offTime":"22:00"},
              {"id":"keep","daysOfWeek":["Tue"],"onTime":"08:00","offTime":"20:00"}
            ]}
            """.trimIndent(),
        )
        assertEquals(1, config.schedules.size)
        assertEquals("keep", config.schedules[0].id)
    }

    @Test
    fun `an unparseable display block yields no schedules and no crash`() {
        listOf(null, "", "not json", "[]").forEach { raw ->
            val config = DisplayConfigParser.parse(raw)
            assertEquals(0, config.schedules.size)
            assertEquals(0, config.recipes.size)
            assertNull(config.matchingRecipe("Goodview", "ECBox3576", "rk3288"))
        }
    }

    // ─── helpers ────────────────────────────────────────────────────

    private fun schedule(id: String, days: Set<Int>, on: String, off: String, tz: String) = DisplaySchedule(
        id = id,
        daysOfWeek = days,
        onMinuteOfDay = DisplayScheduleMath.parseHHmm(on)!!,
        offMinuteOfDay = DisplayScheduleMath.parseHHmm(off)!!,
        timezone = tz,
    )

    private fun covers(s: DisplaySchedule, tz: String, y: Int, mo: Int, d: Int, h: Int, mi: Int): Boolean =
        DisplayScheduleMath.covers(s, epoch(tz, y, mo, d, h, mi))

    /** Wall-clock local time in [tz] → epoch millis. */
    private fun epoch(tz: String, year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance(TimeZone.getTimeZone(tz))
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}
