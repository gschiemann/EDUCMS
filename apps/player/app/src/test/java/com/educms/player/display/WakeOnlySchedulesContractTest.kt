package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ⚠️ THE WAKE-ONLY CONTRACT, page → parser (2026-10-03, user standby).
 *
 * The page (`apps/web/src/app/player/displayControl.ts`,
 * `toDeviceDisplayConfig`) forwards its SOFT windows as `wakeOnlySchedules`.
 * They exist for one thing — the schedule's ON trigger waking a panel a person
 * powered off with the remote — and must NEVER blank a panel: the 2026-08-25
 * split routed those panels to the soft overlay precisely because their power
 * path is unproven.
 *
 * The fixture is the exact JSON `toDeviceDisplayConfig` produces for a soft
 * panel (the web test "forwards SOFT windows as wakeOnlySchedules" pins the
 * producer side of the same bytes).
 */
class WakeOnlySchedulesContractTest {

    private val fromThePage = """
        {"version":1,"schedules":[],"brightness":{"minSafePercent":5,"allowBlack":false},"vendorRecipes":[],
         "wakeOnlySchedules":[{"id":"sched-1","daysOfWeek":[1,2,3,4,5],"onTime":"07:00","offTime":"22:00",
                               "timezone":"America/Los_Angeles"}]}
    """.trimIndent()

    @Test
    fun `the parser reads the page's wake-only rows and keeps them out of the hard array`() {
        val config = DisplayConfigParser.parse(fromThePage)
        assertTrue("a wake-only row must never be armed as a hard blank", config.schedules.isEmpty())
        assertEquals(1, config.wakeOnlySchedules.size)
        val row = config.wakeOnlySchedules.first()
        assertEquals(setOf(1, 2, 3, 4, 5), row.daysOfWeek)
        assertEquals(7 * 60, row.onMinuteOfDay)
        assertEquals(22 * 60, row.offMinuteOfDay)
        assertTrue(config.warnings.isEmpty())
    }

    @Test
    fun `a block without the key parses exactly as before`() {
        val config = DisplayConfigParser.parse("""{"version":1,"schedules":[]}""")
        assertTrue(config.wakeOnlySchedules.isEmpty())
    }

    @Test
    fun `the device levels the panel from the HARD rows only — wake-only rows can never blank`() {
        val src = source("src/main/java/com/educms/player/display/DisplayScheduler.kt") ?: return
        val start = src.indexOf("fun applyDesiredNow(")
        // The function body only: up to its closing brace at member indent.
        val body = src.substring(start, src.indexOf("\n    }\n", start))
        assertTrue(body.contains("val schedules = config.schedules\n"))
        assertTrue(body.contains("DisplayScheduleMath.desiredOnAt(schedules,"))
        assertFalse(
            "applyDesiredNow must never derive the on/off LEVEL from the wake-only rows",
            body.substringAfter("val schedules = config.schedules").contains("wakeOnlySchedules"),
        )
    }

    private fun source(relative: String): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val direct = File(dir, relative)
            if (direct.isFile) return direct.readText()
            val nested = File(dir, "app/$relative")
            if (nested.isFile) return nested.readText()
            dir = dir.parentFile
        }
        Assume.assumeTrue("source not on disk: $relative", false)
        return null
    }
}
