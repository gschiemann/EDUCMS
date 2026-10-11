package com.educms.player.logging

import com.educms.player.logging.DiagnosticsUploadPolicy.Reason
import com.educms.player.logging.DiagnosticsUploadPolicy.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** THE AUTOMATIC DEVICE-LOG UPLOAD (2026-10-11): debounced, spaced, capped. */
class DiagnosticsUploadPolicyTest {

    private val now = 1_000_000L

    @Test
    fun `the first trigger uploads after the debounce, so the lines that explain it are in the tail`() {
        assertEquals(now + DiagnosticsUploadPolicy.DEBOUNCE_MS, DiagnosticsUploadPolicy.scheduleAt(now, State(), Reason.WAKE_LANDED))
    }

    @Test
    fun `a routine trigger waits out the minimum gap — an alert waits only a minute`() {
        val recent = State(uploadsMs = listOf(now - 60_000L))
        assertEquals(now - 60_000L + DiagnosticsUploadPolicy.MIN_GAP_MS, DiagnosticsUploadPolicy.scheduleAt(now, recent, Reason.WAKE_NOT_ON_GLASS))
        assertEquals(now + DiagnosticsUploadPolicy.DEBOUNCE_MS, DiagnosticsUploadPolicy.scheduleAt(now, recent, Reason.ALERT_SETTLED))
        // Never before the debounce, even for an alert right after an upload.
        val justNow = State(uploadsMs = listOf(now - 1_000L))
        assertEquals(now - 1_000L + DiagnosticsUploadPolicy.ALERT_MIN_GAP_MS, DiagnosticsUploadPolicy.scheduleAt(now, justNow, Reason.ALERT_SETTLED))
    }

    @Test
    fun `a pending upload absorbs a later trigger — the earlier instant wins`() {
        val pending = State(scheduledAtMs = now + 10_000L)
        assertEquals(now + 10_000L, DiagnosticsUploadPolicy.scheduleAt(now, pending, Reason.PROCESS_RESTART_AFTER_WAKE))
        val later = State(scheduledAtMs = now + 200_000L)
        assertEquals(now + DiagnosticsUploadPolicy.DEBOUNCE_MS, DiagnosticsUploadPolicy.scheduleAt(now, later, Reason.WAKE_LANDED))
    }

    @Test
    fun `the hourly cap refuses and old uploads fall out of the hour`() {
        val uploads = (0 until DiagnosticsUploadPolicy.MAX_PER_HOUR).map { now - 3_000_000L + it * 60_000L }
        assertNull(DiagnosticsUploadPolicy.scheduleAt(now, State(uploadsMs = uploads), Reason.ALERT_SETTLED))
        val anHourOn = now + 60L * 60_000L
        assertEquals(
            anHourOn + DiagnosticsUploadPolicy.DEBOUNCE_MS,
            DiagnosticsUploadPolicy.scheduleAt(anHourOn, State(uploadsMs = uploads), Reason.ALERT_SETTLED),
        )
    }
}
