package com.educms.player.standby

import com.educms.player.display.DisplaySchedule
import com.educms.player.display.DisplayScheduleMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * USER STANDBY — the owner's rule, as JVM tests (2026-10-03, player 1.1.21).
 *
 * "Respect the remote but a schedule overrides it when it hits on or off
 * trigger." Every decision the Android half makes is one of these functions;
 * each test names the field behaviour it pins.
 */
class UserStandbyPolicyTest {

    private val la = "America/Los_Angeles"

    // ─── who turned the panel off ───────────────────────────────────

    private fun facts(
        emergencyHeld: Boolean = false,
        ourBlankInForce: Boolean = false,
        sinceOwnBlankMs: Long? = null,
        playerOnGlass: Boolean = true,
    ) = ScreenOffFacts(emergencyHeld, ourBlankInForce, sinceOwnBlankMs, playerOnGlass)

    @Test
    fun `a power-off while the player is on the glass is a USER standby`() {
        // The 1.1.20 bug: nothing classified this at all, and the Watchdog
        // undid it within 15 minutes.
        assertEquals(ScreenOffCause.USER, UserStandbyPolicy.classifyScreenOff(facts()))
    }

    @Test
    fun `our own blank is never mistaken for the remote`() {
        // A scheduled or operator blank (device-admin lock, screen-off timeout,
        // software floor) clears KEEP_SCREEN_ON and the OS turns the panel off.
        assertEquals(ScreenOffCause.OURS, UserStandbyPolicy.classifyScreenOff(facts(ourBlankInForce = true)))
        // …including the device-admin lock whose ACTION_SCREEN_OFF can land
        // before the blanked mirror is written.
        assertEquals(ScreenOffCause.OURS, UserStandbyPolicy.classifyScreenOff(facts(sinceOwnBlankMs = 500L)))
        // The screen-off timeout mechanism lets go 15 s later — still ours.
        assertEquals(ScreenOffCause.OURS, UserStandbyPolicy.classifyScreenOff(facts(sinceOwnBlankMs = 16_000L)))
        // An old blank of ours, long since woken, says nothing about this one.
        assertEquals(
            ScreenOffCause.USER,
            UserStandbyPolicy.classifyScreenOff(facts(sinceOwnBlankMs = UserStandbyPolicy.OWN_BLANK_GRACE_MS + 1)),
        )
    }

    @Test
    fun `a screen-off during an alert is never standby — the alert outranks the remote`() {
        assertEquals(ScreenOffCause.EMERGENCY, UserStandbyPolicy.classifyScreenOff(facts(emergencyHeld = true)))
        // Even when every other fact says "a person did it".
        assertEquals(
            ScreenOffCause.EMERGENCY,
            UserStandbyPolicy.classifyScreenOff(facts(emergencyHeld = true, playerOnGlass = true)),
        )
    }

    @Test
    fun `a screen-off while the player is not on the glass keeps the pre-1_1_21 behaviour`() {
        // An OS timeout over the OEM launcher or Settings is indistinguishable
        // from a key press; the relaunch paths may still bring the player back.
        assertEquals(ScreenOffCause.NOT_ON_GLASS, UserStandbyPolicy.classifyScreenOff(facts(playerOnGlass = false)))
    }

    @Test
    fun `paused BY the sleep still counts as on the glass`() {
        // The broadcast can arrive just after the sleep paused the Activity.
        assertTrue(UserStandbyPolicy.playerOnGlass(inForeground = true, sincePausedBySleepMs = null))
        assertTrue(UserStandbyPolicy.playerOnGlass(inForeground = false, sincePausedBySleepMs = 300L))
        assertFalse(UserStandbyPolicy.playerOnGlass(inForeground = false, sincePausedBySleepMs = null))
        assertFalse(
            "a pause long ago is not this sleep",
            UserStandbyPolicy.playerOnGlass(
                inForeground = false,
                sincePausedBySleepMs = UserStandbyPolicy.PAUSED_BY_SLEEP_WINDOW_MS + 1,
            ),
        )
    }

    // ─── persistence: survive a process death, never a reboot ───────

    private val record = StandbyRecord(sinceWallMs = 1_000_000L, sinceElapsedMs = 50_000L, bootCount = 7)

    @Test
    fun `the record survives a process death while the panel stays off`() {
        assertTrue(UserStandbyPolicy.recordStillValid(record, 60_000L, 7, screenInteractive = false))
        // A ROM without BOOT_COUNT still keeps it on the same boot.
        assertTrue(UserStandbyPolicy.recordStillValid(record.copy(bootCount = -1), 60_000L, -1, false))
    }

    @Test
    fun `a reboot ends it — a boot is on`() {
        assertFalse("BOOT_COUNT moved", UserStandbyPolicy.recordStillValid(record, 60_000L, 8, false))
        assertFalse("elapsedRealtime went backwards", UserStandbyPolicy.recordStillValid(record, 10_000L, 7, false))
    }

    @Test
    fun `a panel that is on is not in standby — a missed SCREEN_ON is caught on the next read`() {
        assertFalse(UserStandbyPolicy.recordStillValid(record, 60_000L, 7, screenInteractive = true))
    }

    // ─── what a relaunch path may do ────────────────────────────────

    @Test
    fun `relaunch paths do nothing to a remote-slept panel whose player is alive`() {
        assertEquals(RelaunchMode.SKIP, UserStandbyPolicy.relaunchMode(standbyActive = true, activityAlive = true))
    }

    @Test
    fun `a dead player is still brought back in standby — dark, so an alert can reach it`() {
        assertEquals(RelaunchMode.DARK, UserStandbyPolicy.relaunchMode(standbyActive = true, activityAlive = false))
    }

    @Test
    fun `outside standby every relaunch path is unchanged`() {
        assertEquals(RelaunchMode.NORMAL, UserStandbyPolicy.relaunchMode(false, true))
        assertEquals(RelaunchMode.NORMAL, UserStandbyPolicy.relaunchMode(false, false))
    }

    // ─── the schedule's ON trigger: last command wins ───────────────

    private val weekdays = setOf(1, 2, 3, 4, 5)
    private val dayWindow = DisplaySchedule("day", weekdays, 7 * 60, 22 * 60, la)

    @Test
    fun `the ON trigger wakes a panel the remote turned off BEFORE it`() {
        // Wednesday 2026-09-30: remote off at 23:00 Tuesday, ON trigger 07:00.
        val off = epoch(la, 2026, 9, 29, 23, 0)
        val standby = record.copy(sinceWallMs = off)
        val at = epoch(la, 2026, 9, 30, 7, 1)
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(dayWindow), at)
        assertNotNull(last)
        assertTrue(UserStandbyPolicy.scheduleEndsStandby(standby, last))
    }

    @Test
    fun `an ON window already running does NOT undo a later remote-off`() {
        // Remote off at 10:00 inside the 07:00–22:00 window. Last command wins:
        // the person spoke after the schedule did.
        val standby = record.copy(sinceWallMs = epoch(la, 2026, 9, 30, 10, 0))
        val at = epoch(la, 2026, 9, 30, 15, 0)
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(dayWindow), at)
        assertFalse(UserStandbyPolicy.scheduleEndsStandby(standby, last))
    }

    @Test
    fun `the OFF trigger never ends a standby — only an ON does`() {
        val standby = record.copy(sinceWallMs = epoch(la, 2026, 9, 30, 10, 0))
        val at = epoch(la, 2026, 9, 30, 22, 5)
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(listOf(dayWindow), at)
        assertNotNull(last)
        assertFalse(last!!.on)
        assertFalse(UserStandbyPolicy.scheduleEndsStandby(standby, last))
    }

    @Test
    fun `no schedule, no trigger`() {
        val standby = record.copy(sinceWallMs = epoch(la, 2026, 9, 30, 10, 0))
        assertFalse(UserStandbyPolicy.scheduleEndsStandby(standby, null))
        assertFalse(
            UserStandbyPolicy.scheduleEndsStandby(
                standby,
                DisplayScheduleMath.lastTransitionAtOrBefore(emptyList(), epoch(la, 2026, 9, 30, 12, 0)),
            ),
        )
    }

    @Test
    fun `a late or missed alarm reaches the same answer`() {
        // The trigger is judged by timestamps, not by "the alarm fired now":
        // an evaluation three hours late still wakes the panel.
        val standby = record.copy(sinceWallMs = epoch(la, 2026, 9, 29, 23, 0))
        val late = epoch(la, 2026, 9, 30, 10, 0)
        assertTrue(
            UserStandbyPolicy.scheduleEndsStandby(
                standby,
                DisplayScheduleMath.lastTransitionAtOrBefore(listOf(dayWindow), late),
            ),
        )
    }

    private fun epoch(tz: String, year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance(TimeZone.getTimeZone(tz))
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}
