package com.educms.player.standby

import com.educms.player.display.ScheduleTransition
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * AFTER THE ALL-CLEAR, BACK TO HOW IT WAS (player 1.1.23).
 *
 * The 1.1.22 drill on the X80 passed the part that matters most — a panel a
 * person had turned off with the remote WOKE for the alert — but after the
 * all-clear it stayed ON. The owner wants it back the way it was. The rules,
 * one test each, plus the wiring that keeps the life-safety half untouched:
 * nothing here can darken a screen while an alert is held.
 */
class StandbyRestoreAfterAlertTest {

    private val off = StandbyRecord(sinceWallMs = 1_000_000L, sinceElapsedMs = 50_000L, bootCount = 7)

    private fun interrupted(atElapsed: Long = 80_000L, record: StandbyRecord = off) =
        InterruptedStandby(record = record, interruptedAtElapsedMs = atElapsed)

    private fun decide(
        i: InterruptedStandby? = interrupted(),
        held: Boolean = false,
        nowElapsed: Long = 200_000L,
        nowBoot: Int = 7,
        wakeAt: Long? = null,
        schedule: ScheduleTransition? = null,
    ) = UserStandbyPolicy.restoreAfterAlert(i, held, nowElapsed, nowBoot, wakeAt, schedule)

    // ─── the rules ───────────────────────────────────────────────────────

    @Test
    fun `a standby the alert ended is put back after the all-clear`() {
        assertEquals(RestoreDecision.RESTORE, decide())
    }

    @Test
    fun `nothing is put to sleep when nobody had the panel off`() {
        assertEquals(RestoreDecision.NOTHING_INTERRUPTED, decide(i = null))
    }

    @Test
    fun `never while any face is still in an alert`() {
        assertEquals(RestoreDecision.STILL_HELD, decide(held = true))
        // …and that outranks everything after it.
        assertEquals(RestoreDecision.STILL_HELD, decide(held = true, wakeAt = null, nowBoot = 7))
    }

    @Test
    fun `a reboot during the alert voids the standby — a boot is on`() {
        assertEquals(RestoreDecision.REBOOTED, decide(nowBoot = 8))
        // A ROM with no boot count: the uptime clock went backwards.
        assertEquals(
            RestoreDecision.REBOOTED,
            decide(i = interrupted(record = off.copy(bootCount = -1)), nowBoot = -1, nowElapsed = 20_000L),
        )
    }

    @Test
    fun `a WAKE command during the alert wins — the panel stays on`() {
        assertEquals(RestoreDecision.WAKE_COMMAND_DURING_ALERT, decide(wakeAt = 90_000L))
        // The same instant counts too: it came with the alert, after the off.
        assertEquals(RestoreDecision.WAKE_COMMAND_DURING_ALERT, decide(wakeAt = 80_000L))
    }

    @Test
    fun `a wake from BEFORE the alert says nothing about it`() {
        assertEquals(RestoreDecision.RESTORE, decide(wakeAt = 60_000L))
    }

    @Test
    fun `the schedule's ON trigger after the person's off wins`() {
        val onAfterOff = ScheduleTransition(atMs = off.sinceWallMs + 60_000L, on = true)
        assertEquals(RestoreDecision.SCHEDULE_ON_AFTER_OFF, decide(schedule = onAfterOff))
    }

    @Test
    fun `an ON window already running when the person pressed power does not`() {
        val onBeforeOff = ScheduleTransition(atMs = off.sinceWallMs - 60_000L, on = true)
        assertEquals(RestoreDecision.RESTORE, decide(schedule = onBeforeOff))
        // An OFF trigger in between agrees with the person.
        val offAfter = ScheduleTransition(atMs = off.sinceWallMs + 60_000L, on = false)
        assertEquals(RestoreDecision.RESTORE, decide(schedule = offAfter))
    }

    @Test
    fun `a standby we put back stays a standby while our blank takes hold`() {
        // A screen-off timeout takes 15 s and the software floor never turns
        // the backlight off — interactivity must not end a restored standby.
        val restored = off.copy(restoredByUs = true)
        assertTrue(UserStandbyPolicy.recordStillValid(restored, 60_000L, 7, screenInteractive = true))
        // A person's own standby is still over the moment the panel is on.
        assertFalse(UserStandbyPolicy.recordStillValid(off, 60_000L, 7, screenInteractive = true))
        // A reboot still voids either.
        assertFalse(UserStandbyPolicy.recordStillValid(restored, 60_000L, 8, screenInteractive = true))
    }

    // ─── wiring ───────────────────────────────────────────────────────────

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun code(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            .replace(Regex("//[^\\n]*"), "")
    }

    private fun body(src: String, signature: String): String {
        val start = src.indexOf(signature)
        assertTrue("missing: $signature", start >= 0)
        var depth = 0
        var i = src.indexOf('{', start)
        val open = i
        while (i < src.length) {
            when (src[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return src.substring(open, i + 1)
                }
            }
            i++
        }
        return src.substring(open)
    }

    private val emergency by lazy { code("src/main/java/com/educms/player/display/DisplayEmergency.kt") }
    private val standby by lazy { code("src/main/java/com/educms/player/standby/UserStandby.kt") }

    @Test
    fun `the alert remembers the standby before ending it, and its own wake is not a command`() {
        val enforce = body(emergency, "fun enforceNow(")
        val remember = enforce.indexOf("UserStandby.rememberForAlertRestore(app)")
        val end = enforce.indexOf("UserStandby.end(app, \"an emergency alert\")")
        assertTrue("remember, then end", remember in 0 until end)
        assertTrue(
            "the alert's registry wake must run as OUR wake",
            enforce.indexOf("UserStandby.duringOwnWake") in 0 until enforce.indexOf("DisplayAction.Wake"),
        )
        assertFalse(
            "the alert path must never restore — only the release may",
            enforce.contains("restoreAfterAlertIfDue"),
        )
    }

    @Test
    fun `the restore runs only on the committed release, last`() {
        val release = body(emergency, "private fun release(")
        val commit = release.indexOf("DisplayPrefs.commitEmergencyHold(")
        val schedule = release.indexOf("DisplayScheduler.armAndApply(app)")
        val restore = release.indexOf("UserStandby.restoreAfterAlertIfDue(app)")
        assertTrue("after the hold is committed released", restore > commit && commit >= 0)
        assertTrue("after the schedule has had its say", restore > schedule && schedule >= 0)
        assertFalse(body(emergency, "private fun engage(").contains("restoreAfterAlertIfDue"))
        // The pre-existing life-safety rule still holds: the interlock is
        // never GATED by a standby.
        assertFalse(
            emergency.contains("UserStandby.isActive") || emergency.contains("UserStandby.activeRecord") ||
                emergency.contains("relaunchMode"),
        )
    }

    @Test
    fun `the restore re-checks the hold, marks the blank ours, and goes through the registry`() {
        val restore = body(standby, "fun restoreAfterAlertIfDue(")
        assertTrue(restore.contains("DisplayEmergency.isHeld(app)"))
        val own = restore.indexOf("noteOwnBlank()")
        val blank = restore.indexOf("DisplayControlRegistry.apply(app, DisplayAction.Blank")
        assertTrue("noteOwnBlank first, then the blank", own in 0 until blank)
        assertTrue("re-enter standby only after a blank that took", restore.indexOf("enterRestored(") > blank)
        assertTrue("one-shot", restore.contains("clearInterrupted(app)"))
    }

    @Test
    fun `ending a restored standby takes our blank off, as our own wake`() {
        val exit = body(standby, "private fun exit(")
        assertTrue(exit.contains("wasRestoredByUs"))
        assertTrue(exit.contains("duringOwnWake { DisplayControlRegistry.apply(app, DisplayAction.Wake"))
    }

    @Test
    fun `a WAKE command is noted, and the schedule does not undo a restored standby`() {
        val registry = code("src/main/java/com/educms/player/display/DisplayControlRegistry.kt")
        assertTrue(body(registry, "fun apply(").contains("UserStandby.noteDeliberateWake(app)"))
        assertTrue(standby.contains("if (ownWakeDepth.get()!! > 0) return"))
        val scheduler = code("src/main/java/com/educms/player/display/DisplayScheduler.kt")
        assertTrue(
            body(scheduler, "fun applyDesiredNow(").contains("if (desiredOn && UserStandby.isActive(app))"),
        )
    }
}
