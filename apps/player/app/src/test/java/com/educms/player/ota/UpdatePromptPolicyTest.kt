package com.educms.player.ota

import com.educms.player.ota.UpdatePromptPolicy.OkAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * 1.1.46 — the PLAYER raises its own update's confirmation from the
 * foreground; if Android refuses it, a remote-focused "Update ready" card
 * goes up; an emergency always wins.
 */
class UpdatePromptPolicyTest {

    private val t0 = 9_000_000L

    @Test
    fun `a staged own-update confirmation is raised on resume, once`() {
        assertTrue(UpdatePromptPolicy.shouldRaiseStagedOnResume(true, t0, 0L, false, false, t0 + 1_000L))
        assertFalse("already raised", UpdatePromptPolicy.shouldRaiseStagedOnResume(true, t0, t0, false, false, t0 + 1_000L))
        assertFalse("not ours (companion upgrade keeps its own gate)", UpdatePromptPolicy.shouldRaiseStagedOnResume(false, t0, 0L, false, false, t0 + 1_000L))
        assertFalse("stale", UpdatePromptPolicy.shouldRaiseStagedOnResume(true, t0, 0L, false, false, t0 + UpdatePromptPolicy.SHOW_WINDOW_MS))
    }

    @Test
    fun `an emergency or a person's standby keeps it down`() {
        assertFalse(UpdatePromptPolicy.shouldRaiseStagedOnResume(true, t0, 0L, emergencyHeld = true, standbyActive = false, nowMs = t0 + 1))
        assertFalse(UpdatePromptPolicy.shouldRaiseStagedOnResume(true, t0, 0L, emergencyHeld = false, standbyActive = true, nowMs = t0 + 1))
        assertFalse(UpdatePromptPolicy.shouldShowCard(true, dialogAppeared = false, foreground = true, emergencyHeld = true, standbyActive = false))
    }

    @Test
    fun `a raise that never paused the Activity was refused - the card goes up`() {
        assertFalse(UpdatePromptPolicy.dialogAppeared(t0, t0 - 50))
        assertTrue(UpdatePromptPolicy.dialogAppeared(t0, t0 + 40))
        assertFalse(UpdatePromptPolicy.dialogAppeared(0L, t0))
        assertTrue(UpdatePromptPolicy.shouldShowCard(true, dialogAppeared = false, foreground = true, emergencyHeld = false, standbyActive = false))
        assertFalse("the dialog is up", UpdatePromptPolicy.shouldShowCard(true, true, true, false, false))
        assertFalse("not on glass", UpdatePromptPolicy.shouldShowCard(true, false, false, false, false))
    }

    @Test
    fun `the card leaves for an emergency and is bounded`() {
        assertTrue(UpdatePromptPolicy.keepCard(false, 60_000L))
        assertFalse(UpdatePromptPolicy.keepCard(true, 60_000L))
        assertFalse(UpdatePromptPolicy.keepCard(false, UpdatePromptPolicy.SHOW_WINDOW_MS))
    }

    @Test
    fun `OK raises the staged confirmation, else asks for a person-initiated check`() {
        assertEquals(OkAction.RAISE_STAGED, UpdatePromptPolicy.onOk(true))
        assertEquals(OkAction.REQUEST_USER_CHECK, UpdatePromptPolicy.onOk(false))
    }

    private fun src(relative: String): String {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, "src/main/java/com/educms/player/$relative")
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `the Activity raises on resume and verifies every own-update raise`() {
        val s = src("MainActivity.kt")
        assertTrue(s.contains("maybeRaiseStagedOwnPrompt(\"resume\")"))
        assertTrue(s.contains("verifyOwnPromptAppeared(staged, raisedAt)"))
        assertTrue("onPause stamps the pause the verification reads", s.contains("lastPausedAtElapsedMs = android.os.SystemClock.elapsedRealtime()"))
        assertTrue("the card owns the remote while it is up", s.contains("com.educms.player.ota.UpdateReadyCard.isShowing() ||"))
    }

    @Test
    fun `the card parks focus on Install and Back takes it down`() {
        val s = src("ota/UpdateReadyCard.kt")
        assertTrue(s.contains("install.requestFocus()"))
        assertTrue(s.contains("KeyEvent.KEYCODE_BACK"))
        assertTrue("emergency checked before showing", s.indexOf("if (emergencyHeld()) return") in 1 until s.indexOf("root.addView(card"))
    }
}
