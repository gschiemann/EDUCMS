package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * `display.alertWatchWatchdog` (2026-11-08, Manager wave 5): the lead's switch
 * for the companion Manager's alert-watch watchdog, carried by the Player.
 * Exactly `"on"` or `"observe"`; everything else is off — today's behaviour.
 */
class DisplayConfigAlertWatchModeTest {

    private fun block(extra: String) = """{"version":1,"schedules":[]$extra}"""

    @Test
    fun `absent is off`() {
        assertNull(DisplayConfigParser.parse(block("")).alertWatchWatchdogMode)
        assertNull(DisplayConfigParser.parse(null).alertWatchWatchdogMode)
    }

    @Test
    fun `on and observe are carried, case-insensitively`() {
        assertEquals("on", DisplayConfigParser.parse(block(""","alertWatchWatchdog":"on"""")).alertWatchWatchdogMode)
        assertEquals("observe", DisplayConfigParser.parse(block(""","alertWatchWatchdog":" Observe """")).alertWatchWatchdogMode)
    }

    @Test
    fun `anything else is off - a typo enables nothing`() {
        assertNull(DisplayConfigParser.parse(block(""","alertWatchWatchdog":"off"""")).alertWatchWatchdogMode)
        assertNull(DisplayConfigParser.parse(block(""","alertWatchWatchdog":true""")).alertWatchWatchdogMode)
        assertNull(DisplayConfigParser.parse(block(""","alertWatchWatchdog":1""")).alertWatchWatchdogMode)
        assertNull(DisplayConfigParser.parse(block(""","alertWatchWatchdog":"onn"""")).alertWatchWatchdogMode)
    }

    @Test
    fun `the key never changes anything else in the block`() {
        val a = DisplayConfigParser.parse(block(""","vendorBacklight":false"""))
        val b = DisplayConfigParser.parse(block(""","vendorBacklight":false,"alertWatchWatchdog":"on""""))
        assertEquals(a.vendorBacklightDisabled, b.vendorBacklightDisabled)
        assertEquals(a.schedules, b.schedules)
        assertEquals(a.warnings, b.warnings)
    }
}
