package com.educms.player.display

import com.educms.player.display.RestoreBlankAfterAlertPolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * AFTER THE ALL-CLEAR, A SCREEN WE HAD BLANKED GOES BACK TO BLANK (1.1.51).
 *
 * The owner's X80 drill (2026-10-20): the screen was off (dashboard Turn off)
 * before the alert, woke for it, and stayed ON after the all-clear. The 1.1.23
 * restore only knew about a PERSON's remote-off. One test per rule, plus the
 * wiring facts that keep the life-safety half untouched.
 */
class RestoreBlankAfterAlertPolicyTest {

    private fun decide(
        pre: Boolean? = true,
        blankedNow: Boolean = false,
        desiredOn: Boolean? = null,
        wakeCmd: Boolean = false,
        held: Boolean = false,
    ) = RestoreBlankAfterAlertPolicy.decide(pre, blankedNow, desiredOn, wakeCmd, held)

    @Test fun `a screen that was blanked before the alert is put back to blank`() {
        assertEquals(Decision.RESTORE_BLANK, decide())
        // A hard schedule that says OFF agrees; one with no opinion changes nothing.
        assertEquals(Decision.RESTORE_BLANK, decide(desiredOn = false))
        assertEquals(Decision.RESTORE_BLANK, decide(desiredOn = null))
    }

    @Test fun `a screen that was on before the alert is left on`() {
        assertEquals(Decision.WAS_ON, decide(pre = false))
        assertEquals(Decision.WAS_ON, decide(pre = null))
    }

    @Test fun `never while any face is still in an alert — and that outranks everything`() {
        assertEquals(Decision.STILL_HELD, decide(held = true))
        assertEquals(Decision.STILL_HELD, decide(held = true, pre = false, blankedNow = true))
    }

    @Test fun `already dark again (the standby restore or the schedule did it) — nothing more to do`() {
        assertEquals(Decision.ALREADY_BLANKED, decide(blankedNow = true))
    }

    @Test fun `a WAKE command during the alert wins over the earlier off`() {
        assertEquals(Decision.WAKE_COMMAND_DURING_ALERT, decide(wakeCmd = true))
    }

    @Test fun `the hard schedule saying ON right now keeps the screen on`() {
        assertEquals(Decision.SCHEDULE_SAYS_ON, decide(desiredOn = true))
    }

    // ─── wiring, as source facts (skipped, not failed, off-disk) ─────────

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

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }
    }

    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val next = Regex("\\n\\s*(private |internal |override |public )?fun ").find(src, at + signature.length)
        return src.substring(at, next?.range?.first ?: src.length)
    }

    @Test fun `the hold snapshots the blank once per alert, and the release restores it LAST, after standby and schedule`() {
        val src = read("src/main/java/com/educms/player/display/DisplayEmergency.kt")
        val engage = body(src, "private fun engage(")
        assertTrue("snapshot taken on the first engage, beside the brightness", engage.contains("DisplayPrefs.setPreHoldBlanked(app, DisplayPrefs.blanked(app))"))
        assertTrue("…and only after the re-raise short-circuit (never re-taken after we drove it to false)",
            engage.indexOf("if (alreadyHeld)") < engage.indexOf("setPreHoldBlanked"))
        val release = body(src, "private fun release(")
        val schedule = release.indexOf("DisplayScheduler.armAndApply(app)")
        val standby = release.indexOf("UserStandby.restoreAfterAlertIfDue(app)")
        val blank = release.indexOf("restoreBlankIfDue(app)")
        assertTrue("order: schedule, standby, then the blank restore", schedule in 0 until standby && standby < blank)
        val restore = body(src, "private fun restoreBlankIfDue(")
        assertTrue("one-shot: the snapshot is consumed before the decision", restore.indexOf("setPreHoldBlanked(app, null)") < restore.indexOf("RestoreBlankAfterAlertPolicy.decide("))
        assertTrue("the hold is re-checked at the decision", restore.contains("stillHeld = isHeld(app)"))
        assertTrue("ours, before the provider runs", restore.indexOf("UserStandby.noteOwnBlank()") < restore.indexOf("DisplayAction.Blank"))
        assertTrue("never a latch-prone lock", restore.contains("RestoreBlankPolicy.allows("))
    }

    @Test fun `a WAKE command during the hold is noted through the one standby hook, never by an own wake`() {
        val standby = read("src/main/java/com/educms/player/standby/UserStandby.kt")
        val note = body(standby, "fun noteDeliberateWake(")
        assertTrue("own wakes return first", note.indexOf("ownWakeDepth.get()!! > 0) return") < note.indexOf("noteWakeCommandDuringHold"))
        assertTrue(note.contains("DisplayEmergency.isHeld(app)"))
        val prefs = read("src/main/java/com/educms/player/display/DisplayPrefs.kt")
        assertTrue("taking a fresh snapshot clears the stale wake note", body(prefs, "fun setPreHoldBlanked(").contains("remove(KEY_WAKE_CMD_DURING_HOLD)"))
    }
}
