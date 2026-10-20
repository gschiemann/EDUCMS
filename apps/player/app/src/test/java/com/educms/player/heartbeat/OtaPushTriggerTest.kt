package com.educms.player.heartbeat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * 1.1.46 — the native heartbeat turns a push into an update check on its own
 * (Android 9 "Commercial" units never ran the WorkManager one-shot).
 */
class OtaPushTriggerTest {

    private val t0 = 1_800_000_000_000L

    @Test
    fun `a push identity is acted on once`() {
        assertTrue(OtaPushTrigger.isNewPush("2026-10-20T16:55:00Z", null, 0L, t0))
        assertFalse(OtaPushTrigger.isNewPush("2026-10-20T16:55:00Z", "2026-10-20T16:55:00Z", t0, t0 + 1))
        assertTrue(OtaPushTrigger.isNewPush("2026-10-20T17:00:00Z", "2026-10-20T16:55:00Z", t0, t0 + 1))
    }

    @Test
    fun `a keyless push is rate-limited, and a backwards clock never blocks it`() {
        assertFalse(OtaPushTrigger.isNewPush("", "legacy-1", t0, t0 + 30_000L))
        assertTrue(OtaPushTrigger.isNewPush("", "legacy-1", t0, t0 + 60_000L))
        assertTrue(OtaPushTrigger.isNewPush("", "legacy-1", t0, t0 - 5_000L))
        assertEquals("legacy-$t0", OtaPushTrigger.keyOf("", t0))
        assertEquals("k", OtaPushTrigger.keyOf("k", t0))
    }

    @Test
    fun `no check started within the grace - the heartbeat runs it itself`() {
        val after = t0 + OtaPushTrigger.INLINE_AFTER_MS
        assertTrue(OtaPushTrigger.shouldRunInline(t0, 0L, busy = false, nowMs = after))
        assertTrue("a check from BEFORE the push does not count", OtaPushTrigger.shouldRunInline(t0, t0 - 1, false, after))
    }

    @Test
    fun `WorkManager or the page relay ran it - no second check`() {
        val after = t0 + OtaPushTrigger.INLINE_AFTER_MS
        assertFalse(OtaPushTrigger.shouldRunInline(t0, t0 + 5_000L, false, after))
        assertFalse("never queues behind a running check", OtaPushTrigger.shouldRunInline(t0, 0L, true, after))
        assertFalse("not before the grace", OtaPushTrigger.shouldRunInline(t0, 0L, false, t0 + 10_000L))
        assertTrue("a wall clock stepped back reads as due", OtaPushTrigger.shouldRunInline(t0, 0L, false, t0 - 1))
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
    fun `the heartbeat fires the push check with its identity and schedules the inline fallback`() {
        val s = src("heartbeat/HeartbeatService.kt")
        assertTrue(s.contains("PlayerApp.fireOtaCheckForPush(applicationContext, pushKey)"))
        assertTrue(s.contains("scheduleInlineOtaFallback(pushKey, now)"))
        assertTrue(s.contains("OtaCheck(applicationContext, data).run()"))
    }

    @Test
    fun `the push one-shot carries no network constraint`() {
        val s = src("PlayerApp.kt")
        val body = s.substringAfter("fun fireOtaCheckForPush(").substringBefore("fun triggerManagerOtaCheck")
        assertTrue(body.contains("OtaUpdateWorker.KEY_PUSH"))
        assertFalse("JobScheduler's CONNECTED = VALIDATED on API 26-28", body.contains("setConstraints"))
    }
}
