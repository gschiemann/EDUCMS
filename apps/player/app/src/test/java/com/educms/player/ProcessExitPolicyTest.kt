package com.educms.player

import android.app.ApplicationExitInfo
import org.junit.Assert.*
import org.junit.Test

/** P2-7 (2026-10-03 review): which process exits are logged, and what the line may carry. */
class ProcessExitPolicyTest {

    @Test fun `every literal equals its SDK constant`() {
        assertEquals(ApplicationExitInfo.REASON_SIGNALED, ProcessExitPolicy.REASON_SIGNALED)
        assertEquals(ApplicationExitInfo.REASON_LOW_MEMORY, ProcessExitPolicy.REASON_LOW_MEMORY)
        assertEquals(ApplicationExitInfo.REASON_CRASH, ProcessExitPolicy.REASON_CRASH)
        assertEquals(ApplicationExitInfo.REASON_CRASH_NATIVE, ProcessExitPolicy.REASON_CRASH_NATIVE)
        assertEquals(ApplicationExitInfo.REASON_ANR, ProcessExitPolicy.REASON_ANR)
        assertEquals(ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE, ProcessExitPolicy.REASON_EXCESSIVE_RESOURCE_USAGE)
        assertEquals(ApplicationExitInfo.REASON_OTHER, ProcessExitPolicy.REASON_OTHER)
        assertEquals(ApplicationExitInfo.REASON_FREEZER, ProcessExitPolicy.REASON_FREEZER)
    }

    @Test fun `an OEM or lmkd kill is kept - the Cleveland shape`() {
        assertTrue(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_SIGNALED))
        assertTrue(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE))
        assertTrue(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_OTHER))
        assertTrue(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_CRASH))
        assertTrue(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_LOW_MEMORY))
    }

    @Test fun `exits caused by the user, by us or by an update are not logged`() {
        assertFalse(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_EXIT_SELF))
        assertFalse(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_USER_REQUESTED))
        assertFalse(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_USER_STOPPED))
        assertFalse(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_PACKAGE_UPDATED))
        assertFalse(ProcessExitPolicy.keep(ApplicationExitInfo.REASON_UNKNOWN))
    }

    @Test fun `a description never carries a URL, a control character or more than the cap`() {
        val clean = ProcessExitPolicy.sanitizeDescription(
            "Killing 1234:com.educms.player (adj 900):\n\tloading https://host/path?token=abc and more",
        )
        assertFalse(clean.contains("https://"))
        assertFalse(clean.contains("token=abc"))
        assertFalse(clean.contains("\n"))
        assertTrue(clean.contains("[url]"))
        assertEquals(ProcessExitPolicy.DESCRIPTION_CAP, ProcessExitPolicy.sanitizeDescription("x".repeat(5_000)).length)
        assertEquals("", ProcessExitPolicy.sanitizeDescription(null))
        assertEquals("", ProcessExitPolicy.sanitizeDescription("   "))
    }

    @Test fun `the line keeps the marker the server looks for, and the description only when there is one`() {
        val bare = ProcessExitPolicy.line(1L, 2, 9, 400, 10L, 20L, null)
        assertTrue(bare.startsWith("PLAYER_PROCESS_EXIT at=1 reason=2 status=9 importance=400 "))
        assertFalse(bare.contains("desc="))
        assertTrue(ProcessExitPolicy.line(1L, 2, 9, 400, 10L, 20L, "lmkd kill").endsWith("desc=\"lmkd kill\""))
    }
}
