package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.util.Calendar
import java.util.TimeZone

/**
 * [ScheduleTriggerPolicy] — a manual Turn on / Turn off holds until the on/off
 * schedule's NEXT trigger (player 1.1.61). Driven through the real
 * [DisplayScheduleMath], so the decision is the one [DisplayScheduler] makes.
 */
class ScheduleTriggerPolicyTest {

    private val la = "America/Los_Angeles"
    private val all = setOf(0, 1, 2, 3, 4, 5, 6)
    private val day = DisplaySchedule(
        id = "day",
        daysOfWeek = all,
        onMinuteOfDay = DisplayScheduleMath.parseHHmm("07:00")!!,
        offMinuteOfDay = DisplayScheduleMath.parseHHmm("18:00")!!,
        timezone = la,
    )

    /** What [DisplayScheduler.applyDesiredNow] decides at [nowMs]: null = leave the panel alone. */
    private fun decide(nowMs: Long, manualAtMs: Long, blanked: Boolean): DisplayAction? {
        val desiredOn = DisplayScheduleMath.desiredOnAt(listOf(day), nowMs) ?: return null
        if (desiredOn == !blanked) return null
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), nowMs)
        if (!ScheduleTriggerPolicy.scheduleMayLevel(last?.atMs, manualAtMs)) return null
        return if (desiredOn) DisplayAction.Wake else DisplayAction.Blank
    }

    @Test
    fun `manual ON at 20_23 inside the 18_00-07_00 off window stays on until 07_00`() {
        val turnOn = epoch(2026, 11, 1, 20, 23)
        // Every re-evaluation inside the window (the 37 s later display-block
        // change, a process start at 02:00, 06:59) leaves the panel ON.
        for (now in listOf(
            turnOn + 37_000L,
            epoch(2026, 11, 1, 23, 0),
            epoch(2026, 11, 2, 2, 0),
            epoch(2026, 11, 2, 6, 59),
        )) {
            assertEquals("re-evaluated at $now", null, decide(now, turnOn, blanked = false))
        }
        // 07:00 is a trigger: the schedule speaks again — and says ON, which it already is.
        assertEquals(null, decide(epoch(2026, 11, 2, 7, 0), turnOn, blanked = false))
        // 18:00 the next day blanks it, as scheduled.
        assertEquals(DisplayAction.Blank, decide(epoch(2026, 11, 2, 18, 0), turnOn, blanked = false))
    }

    @Test
    fun `without a manual command the schedule levels the panel at any re-evaluation`() {
        assertEquals(DisplayAction.Blank, decide(epoch(2026, 11, 1, 20, 24), manualAtMs = 0L, blanked = false))
        assertEquals(DisplayAction.Wake, decide(epoch(2026, 11, 2, 9, 0), manualAtMs = 0L, blanked = true))
    }

    @Test
    fun `a manual OFF inside the on window holds until 18_00`() {
        val turnOff = epoch(2026, 11, 2, 10, 0)
        assertEquals(null, decide(epoch(2026, 11, 2, 10, 5), turnOff, blanked = true))
        assertEquals(null, decide(epoch(2026, 11, 2, 17, 59), turnOff, blanked = true))
        // Next morning's 07:00 trigger wakes it.
        assertEquals(DisplayAction.Wake, decide(epoch(2026, 11, 3, 7, 0), turnOff, blanked = true))
    }

    @Test
    fun `a trigger missed while the box was off still applies after a manual command older than it`() {
        val turnOn = epoch(2026, 11, 1, 12, 0)
        // Box dead across 18:00, back at 19:00: the 18:00 trigger is newer than the manual ON.
        assertEquals(DisplayAction.Blank, decide(epoch(2026, 11, 1, 19, 0), turnOn, blanked = false))
    }

    @Test
    fun `policy edges`() {
        assertTrue(ScheduleTriggerPolicy.scheduleMayLevel(null, 0L))
        assertFalse(ScheduleTriggerPolicy.scheduleMayLevel(null, 5L))
        assertFalse(ScheduleTriggerPolicy.scheduleMayLevel(5L, 5L))
        assertTrue(ScheduleTriggerPolicy.scheduleMayLevel(6L, 5L))
    }

    @Test
    fun `wiring - the scheduler consults the policy and person commands are marked manual`() {
        val scheduler = source("src/main/java/com/educms/player/display/DisplayScheduler.kt")
        assertTrue(scheduler.contains("ScheduleTriggerPolicy.scheduleMayLevel("))
        assertTrue(source("src/main/java/com/educms/player/display/DisplayControlApi.kt")
            .contains("wakeSource = \"command\", manual = true"))
        assertTrue(source("src/main/java/com/educms/player/heartbeat/NativePowerControl.kt")
            .contains("wakeSource = \"power-on\", manual = true"))
        assertTrue(source("src/main/java/com/educms/player/display/DisplayControlRegistry.kt")
            .contains("DisplayPrefs.setManualPowerAtMs("))
    }

    private fun source(relative: String): String {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        val f = root?.let { File(it, relative) }
        Assume.assumeTrue("source not on disk: $relative", f?.isFile == true)
        return f!!.readText()
    }

    private fun epoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance(TimeZone.getTimeZone(la))
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}
