package com.educms.player

import android.app.ApplicationExitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** `PLAYER_BOOT_REASON` formatting (2026-10-12). */
class BootReasonPolicyTest {

    @Test
    fun `property values are one safe token, capped, with unreadable and unset told apart`() {
        assertEquals("unreadable", BootReasonPolicy.sanitize(null))
        assertEquals("unset", BootReasonPolicy.sanitize(""))
        assertEquals("unset", BootReasonPolicy.sanitize("   "))
        assertEquals("reboot,watchdog", BootReasonPolicy.sanitize("reboot,watchdog"))
        assertEquals("kernel_panic_x", BootReasonPolicy.sanitize("kernel panic x"))
        assertEquals(BootReasonPolicy.VALUE_CAP, BootReasonPolicy.sanitize("a".repeat(500)).length)
    }

    @Test
    fun `the properties line carries every key`() {
        val line = BootReasonPolicy.propertiesLine(
            43_310L,
            BootReasonPolicy.PROPERTIES.associateWith { if (it == "sys.boot.reason") "watchdog" else null },
        )
        assertTrue(line.startsWith("PLAYER_BOOT_REASON uptimeMs=43310 "))
        assertTrue(line.contains("sys.boot.reason=watchdog"))
        assertTrue(line.contains("ro.boot.bootreason=unreadable"))
        BootReasonPolicy.PROPERTIES.forEach { assertTrue(it, line.contains("$it=")) }
    }

    @Test
    fun `previous exit line names the reason and sanitises the description`() {
        val line = BootReasonPolicy.previousExitLine(1L, 2, 9, "Killing https://evil.example/x  now")
        assertTrue(line.startsWith("PLAYER_BOOT_REASON prevExit at=1 reason=2(signaled) status=9"))
        assertFalse(line.contains("https://"))
        assertTrue(BootReasonPolicy.noPreviousExitLine().startsWith("PLAYER_BOOT_REASON prevExit=none"))
    }

    @Test
    fun `reason literals match the SDK constants`() {
        assertEquals("signaled", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_SIGNALED))
        assertEquals("crash-native", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_CRASH_NATIVE))
        assertEquals("anr", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_ANR))
        assertEquals("user-requested", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_USER_REQUESTED))
        assertEquals("other", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_OTHER))
        assertEquals("dependency-died", BootReasonPolicy.reasonName(ApplicationExitInfo.REASON_DEPENDENCY_DIED))
    }
}
