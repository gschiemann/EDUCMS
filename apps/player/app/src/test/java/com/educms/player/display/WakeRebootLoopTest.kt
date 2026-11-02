package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * A WAKE THAT REBOOTS THE BOX MUST LEAVE IT ON — NO LOOP (player 1.1.61).
 *
 * Field case (t982 panel, 1.1.60, off window 18:00–07:00): a dashboard Turn on
 * at 20:30 woke the panel from `CmdPowerOff` standby with the power key; the
 * panel came back by REBOOTING. Every process start ran the schedule's
 * LEVEL check ("off window, panel on" → `CmdPowerOff`), the heartbeat's
 * POWER_ON retry woke it again (another reboot), three times — boot count
 * 486 → 489 — and once the retry budget was spent the last re-blank stuck:
 * the panel ended OFF.
 *
 * This replays that sequence with the real policies (PowerIntentPolicy,
 * ScheduleTriggerPolicy, DisplayScheduleMath, VendorBacklightPolicy.powerStep)
 * and a box whose every SENT power key reboots it.
 */
class WakeRebootLoopTest {

    private val la = "America/Los_Angeles"
    private val day = DisplaySchedule(
        "day", setOf(0, 1, 2, 3, 4, 5, 6),
        DisplayScheduleMath.parseHHmm("07:00")!!, DisplayScheduleMath.parseHHmm("18:00")!!, la,
    )

    private class Box {
        var blanked = true          // DisplayPrefs.blanked (asleep since 18:00)
        var manualAt = 0L           // DisplayPrefs.manualPowerAtMs
        var panelOn = false         // what CmdGetScreenStatus reads
        var reboots = 0
        var powerKeys = 0
        var powerOffs = 0
    }

    /** One process start: the boot restore, then DisplayScheduler.applyDesiredNow. */
    private fun boot(b: Box, now: Long, honourManual: Boolean) {
        if (PowerIntentPolicy.atWindowAttached(emergencyHeld = false, blanked = b.blanked) == PowerIntentPolicy.Restore.REBLANK) {
            blank(b)
        }
        val desiredOn = DisplayScheduleMath.desiredOnAt(listOf(day), now) ?: return
        if (desiredOn == !b.blanked) return
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(day), now)
        if (honourManual && !ScheduleTriggerPolicy.scheduleMayLevel(last?.atMs, b.manualAt)) return
        if (desiredOn) wake(b, now, manual = false) else blank(b)
    }

    private fun blank(b: Box) {
        b.blanked = PowerIntentPolicy.beforeApply(DisplayAction.Blank, b.blanked)
        if (VendorBacklightPolicy.powerStep(false, b.panelOn, null, null) == VendorBacklightPolicy.PowerStep.SEND) {
            b.powerOffs++
            b.panelOn = false
        }
    }

    /** Returns true when the wake rebooted the box. */
    private fun wake(b: Box, now: Long, manual: Boolean): Boolean {
        b.blanked = PowerIntentPolicy.beforeApply(DisplayAction.Wake, b.blanked)
        if (manual) b.manualAt = now
        if (VendorBacklightPolicy.powerStep(true, b.panelOn, null, null) != VendorBacklightPolicy.PowerStep.SEND) return false
        b.powerKeys++
        b.reboots++          // this panel answers the power key by rebooting
        b.panelOn = true
        return true
    }

    /** The dashboard Turn on, with the heartbeat's bounded POWER_ON retries (3 attempts). */
    private fun replay(honourManual: Boolean): Box {
        val b = Box()
        var t = epoch(2026, 11, 1, 20, 30)
        var attempts = 0
        while (attempts < 3) {
            attempts++
            val rebooted = wake(b, t, manual = true)
            if (!rebooted) break
            t += 45_000L
            boot(b, t, honourManual)
            if (b.panelOn) break      // observed interactive: the heartbeat acknowledges, no more attempts
            t += 15_000L
        }
        return b
    }

    @Test
    fun `wake causes a reboot - the panel stays on and nothing loops`() {
        val b = replay(honourManual = true)
        assertEquals(1, b.reboots)
        assertEquals(1, b.powerKeys)
        assertEquals(0, b.powerOffs)
        assertTrue(b.panelOn)
        assertEquals(false, b.blanked)
        // A later process start inside the window (nightly reboot, OTA) leaves it on too.
        boot(b, epoch(2026, 11, 2, 3, 0), honourManual = true)
        assertTrue(b.panelOn)
        assertEquals(0, b.powerOffs)
        // 07:00 is the next trigger: already on, nothing sent. 18:00 then sleeps it.
        boot(b, epoch(2026, 11, 2, 18, 0), honourManual = true)
        assertEquals(1, b.powerOffs)
    }

    @Test
    fun `the 1_1_60 level check reproduces the field loop - three reboots, ends off`() {
        val b = replay(honourManual = false)
        assertEquals(3, b.reboots)
        assertEquals(3, b.powerOffs)
        assertEquals(false, b.panelOn)
    }

    @Test
    fun `a heartbeat retry after the reboot sends no power key to a panel that reads on`() {
        val b = replay(honourManual = true)
        val keys = b.powerKeys
        val rebooted = wake(b, epoch(2026, 11, 1, 20, 32), manual = true)
        assertEquals(false, rebooted)
        assertEquals(keys, b.powerKeys)
    }

    private fun epoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance(TimeZone.getTimeZone(la))
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}
