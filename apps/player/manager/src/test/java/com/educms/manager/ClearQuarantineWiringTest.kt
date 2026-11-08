package com.educms.manager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Manager wave 3 (#8): the dashboard's Clear quarantine reaches the Manager only
 * through a signature-protected broadcast the Player relays, and does exactly one
 * thing (clear the list).
 */
class ClearQuarantineWiringTest {
    private fun moduleDir(): File? =
        listOf(File("."), File("manager"), File("apps/player/manager"))
            .firstOrNull { File(it, "src/main/AndroidManifest.xml").exists() }

    @Test
    fun `the action name is the one the Player sends`() {
        assertEquals("com.educms.manager.CLEAR_QUARANTINE", ClearQuarantineReceiver.ACTION)
    }

    @Test
    fun `the receiver is declared and guarded by the signature permission`() {
        val dir = moduleDir(); assumeTrue(dir != null)
        val manifest = File(dir!!, "src/main/AndroidManifest.xml").readText()
        val at = manifest.indexOf(".ClearQuarantineReceiver")
        assertTrue("receiver declared", at > 0)
        val block = manifest.substring(at, manifest.indexOf("</receiver>", at))
        assertTrue(block.contains("android:permission=\"com.educms.manager.HEALTH_PERMISSION\""))
        assertTrue(block.contains(ClearQuarantineReceiver.ACTION))
    }

    @Test
    fun `the receiver only clears the quarantine list`() {
        val dir = moduleDir(); assumeTrue(dir != null)
        val src = File(dir!!, "src/main/java/com/educms/manager/ClearQuarantineReceiver.kt").readText()
        assertTrue(src.contains("QuarantineList.clear(context)"))
        assertTrue(!src.contains("OtaInstaller") && !src.contains("PackageInstaller"))
    }
}
