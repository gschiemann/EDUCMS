package com.educms.manager.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.TimeZone

/** The Manager's half of "Get recent logs" (2026-11-08): bounded, read-only, signature-gated. */
class ManagerLogPolicyTest {

    @Test
    fun `minutes are clamped, garbage is the default`() {
        assertEquals(15, ManagerLogPolicy.minutes(null))
        assertEquals(15, ManagerLogPolicy.minutes("abc"))
        assertEquals(5, ManagerLogPolicy.minutes("1"))
        assertEquals(60, ManagerLogPolicy.minutes("600"))
        assertEquals(30, ManagerLogPolicy.minutes(" 30 "))
    }

    @Test
    fun `since is the wall time minus the window`() {
        assertEquals("01-01 00:55:00.000", ManagerLogPolicy.since(3_600_000L, 5, TimeZone.getTimeZone("UTC")))
    }

    @Test
    fun `the tail keeps the newest bytes, cut on a line`() {
        val text = (1..1000).joinToString("\n") { "m$it" }
        val t = ManagerLogPolicy.tail(text, 100)
        assertTrue(t.toByteArray().size <= 100)
        assertTrue(t.endsWith("m1000"))
        assertEquals("short", ManagerLogPolicy.tail("short", 100))
    }

    @Test
    fun `the provider is declared with the signature permission and enforces it in call`() {
        var dir: File? = File("").absoluteFile
        var manifest: File? = null
        while (dir != null && manifest == null) {
            listOf(File(dir, "src/main/AndroidManifest.xml"), File(dir, "manager/src/main/AndroidManifest.xml"))
                .firstOrNull { it.isFile && it.readText().contains("com.educms.manager") }?.let { manifest = it }
            dir = dir.parentFile
        }
        org.junit.Assume.assumeTrue(manifest != null)
        val xml = manifest!!.readText()
        val block = xml.substring(xml.indexOf(".diagnostics.ManagerLogProvider")).substringBefore("/>")
        assertTrue(block.contains("android:permission=\"com.educms.manager.HEALTH_PERMISSION\""))
        val src = File(manifest!!.parentFile, "java/com/educms/manager/diagnostics/ManagerLogProvider.kt").readText()
        assertTrue(src.contains("checkCallingOrSelfPermission(ManagerLogPolicy.PERMISSION)"))
    }
}
