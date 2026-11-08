package com.educms.player.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** ON-DEVICE LOG REDACTION (2026-11-08): nothing that grants access leaves the panel. */
class LogRedactionTest {

    @Test
    fun `device tokens and bearer headers are removed`() {
        val out = LogRedaction.line("D/Http: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig and token=abc123")
        assertFalse(out.contains("eyJhbGci"))
        assertFalse(out.contains("abc123"))
        assertTrue(out.contains("[credential]"))
    }

    @Test
    fun `wifi passwords and SSIDs are removed`() {
        val out = LogRedaction.line("I/WifiSetup: connect SSID=\"Staff Net\" psk=\"correct horse\" passphrase:battery wpa2=staple")
        assertFalse(out.contains("Staff Net"))
        assertFalse(out.contains("correct horse"))
        assertFalse(out.contains("battery"))
        assertFalse(out.contains("staple"))
    }

    @Test
    fun `e-mail addresses and URL secrets are removed, the host and path stay`() {
        val out = LogRedaction.line("W/Web: https://user:pw@cdn.example.com/media/a.mp4?X-Amz-Signature=deadbeef sent to ops@school.example.org")
        assertFalse(out.contains("deadbeef"))
        assertFalse(out.contains("user:pw"))
        assertFalse(out.contains("ops@school"))
        assertTrue(out.contains("cdn.example.com/media/a.mp4"))
        assertTrue(out.contains("[email]"))
    }

    @Test
    fun `an ordinary line is unchanged`() {
        val line = "11-08 12:00:01.123  1234  1300 I PlayerLogger: PLAYER_PROCESS_START pid=1234 boot=7"
        assertEquals(line, LogRedaction.line(line))
    }

    @Test
    fun `lines and the bundle are bounded`() {
        assertTrue(LogRedaction.line("x".repeat(20_000)).length < LogRedaction.MAX_LINE + 40)
        val big = (1..5_000).joinToString("\n") { "line $it ok" }
        val tail = LogRedaction.tail(big, 2_000)
        assertTrue(tail.toByteArray().size <= 2_100)
        assertTrue(tail.endsWith("line 5000 ok"))
        assertTrue(tail.startsWith("[earlier lines dropped"))
    }
}
