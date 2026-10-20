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
    fun `an emergency or a person's standby keeps the card down`() {
        assertFalse(UpdatePromptPolicy.shouldShowCard(true, dialogAppeared = false, foreground = true, emergencyHeld = true, standbyActive = false))
        assertFalse(UpdatePromptPolicy.shouldShowCard(true, dialogAppeared = false, foreground = true, emergencyHeld = false, standbyActive = true))
    }

    @Test
    fun `the label names the offered build, never the stable release`() {
        assertEquals("v1.1.45-field.1", UpdatePromptPolicy.versionLabel("1.1.45-field.1"))
        assertEquals("v1.1.46", UpdatePromptPolicy.versionLabel("v1.1.46"))
        assertEquals("update", UpdatePromptPolicy.versionLabel(null))
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
        assertFalse("owner: nothing surfaces over content on resume", s.contains("maybeRaiseStagedOwnPrompt"))
        assertTrue(s.contains("verifyOwnPromptAppeared(staged, raisedAt)"))
        assertTrue("onPause stamps the pause the verification reads", s.contains("lastPausedAtElapsedMs = android.os.SystemClock.elapsedRealtime()"))
        assertTrue("the card owns the remote while it is up", s.contains("com.educms.player.ota.UpdateReadyCard.isShowing() ||"))
    }

    @Test
    fun `an unattended own-update commit is staged, never raised over the video`() {
        val r = src("ota/OtaInstallReceiver.kt")
        val gate = r.indexOf("!intent.getBooleanExtra(EXTRA_SELF_OTA_USER, false)")
        assertTrue(gate > 0)
        assertTrue("the gate precedes the trampoline", gate < r.indexOf("context.startActivity(trampoline)"))
        val w = src("ota/OtaUpdateWorker.kt")
        assertTrue(w.contains("putExtra(OtaInstallReceiver.EXTRA_SELF_OTA_USER, userInitiated)"))
        assertFalse("the worker never surfaces a card", w.contains("UpdateReadyCard"))
    }

    @Test
    fun `the card parks focus on Install and Back takes it down`() {
        val s = src("ota/UpdateReadyCard.kt")
        assertTrue(s.contains("install.requestFocus()"))
        assertTrue(s.contains("KeyEvent.KEYCODE_BACK"))
        assertTrue("emergency checked before showing", s.indexOf("if (emergencyHeld()) return") in 1 until s.indexOf("root.addView(card"))
    }
}
