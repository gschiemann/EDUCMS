package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * 1.1.46 — the above-window native layer steps aside for a system install
 * confirmation, and comes back only when the Activity is resumed, focused and
 * no install is pending.
 */
class NativeStepAsideTest {

    @Test
    fun `a pending install or the update card takes the window from native`() {
        assertTrue(NativeStepAside.uiClear(true, installPending = false, updateCardShowing = false))
        assertFalse(NativeStepAside.uiClear(true, installPending = true, updateCardShowing = false))
        assertFalse(NativeStepAside.uiClear(true, installPending = false, updateCardShowing = true))
        assertFalse(NativeStepAside.uiClear(false, installPending = false, updateCardShowing = false))
    }

    @Test
    fun `readiness - native resumes only when resumed AND focused AND nothing pending`() {
        val r = NativeVideoReadiness()
        fun obs(fg: Boolean, focused: Boolean, pending: Boolean) =
            r.observe(fg, interactive = true, focused = focused, uiClear = NativeStepAside.uiClear(true, pending, false))
        val ready = obs(fg = true, focused = true, pending = false)
        assertTrue(ready.ready)
        val epoch = ready.epoch
        assertFalse("the dialog took focus", obs(fg = true, focused = false, pending = false).ready)
        assertFalse("the Activity paused", obs(fg = false, focused = false, pending = true).ready)
        assertFalse("resumed over a still-pending install", obs(fg = true, focused = true, pending = true).ready)
        val back = obs(fg = true, focused = true, pending = false)
        assertTrue(back.ready)
        assertEquals("a new readiness epoch: the old session cannot slip back", epoch + 1, back.epoch)
    }

    @Test
    fun `MainActivity wires the pending install into the native uiClear and yields on focus loss`() {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        Assume.assumeTrue(root != null)
        val f = File(root, "src/main/java/com/educms/player/MainActivity.kt")
        Assume.assumeTrue(f.isFile)
        val s = f.readText()
        val clear = s.substringAfter("internal fun nativeVideoUiClear(): Boolean =").substringBefore("@SuppressLint")
        assertTrue(clear.contains("NativeStepAside.uiClear("))
        assertTrue(clear.contains("installPending = installPromptOutstanding"))
        val focus = s.substringAfter("override fun onWindowFocusChanged(hasFocus: Boolean) {").substringBefore("private fun reapplyImmersive")
        assertTrue(focus.contains("FaceVideoBox.yieldToUi(h, \"page-stopped\")"))
    }
}
