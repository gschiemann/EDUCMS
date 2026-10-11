package com.educms.player.wake

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The `wake` / `proc` blocks of the native runtime report (2026-10-11):
 * what the server's `native-runtime.ts` schema accepts, and a header that
 * stays inside the server's 1 KiB parse limit with EVERY block present.
 */
class WakeReportTest {

    private val full = WakeTimeline(
        source = "dead-man-revert",
        requestedAtWallMs = 1_791_688_602_995L,
        requestedAtElapsedMs = 123_456L,
        interactiveAtWallMs = 1_791_688_603_400L,
        resumedAtWallMs = 1_791_688_604_100L,
        pageLoadAtWallMs = 1_791_688_660_000L,
        launches = 1,
        outcome = "on-glass",
    )

    @Test
    fun `every step is reported under the short keys the server schema names`() {
        val json = WakeReport.json(full, pid = 4242, processStartedAtWallMs = 1_791_688_000_000L, bootCount = 17)
        val wake = json.getJSONObject("wake")
        assertEquals("dead-man-revert", wake.getString("src"))
        assertEquals(full.requestedAtWallMs, wake.getLong("reqAt"))
        assertEquals(full.interactiveAtWallMs, wake.getLong("onAt"))
        assertEquals(full.resumedAtWallMs, wake.getLong("resAt"))
        assertEquals(full.pageLoadAtWallMs, wake.getLong("loadAt"))
        assertEquals(1, wake.getInt("n"))
        assertEquals("on-glass", wake.getString("out"))
        val proc = json.getJSONObject("proc")
        assertEquals(4242, proc.getInt("pid"))
        assertEquals(1_791_688_000_000L, proc.getLong("at"))
        assertEquals(17, proc.getInt("boot"))
    }

    @Test
    fun `a step that has not happened is absent, not zero`() {
        val pending = WakeTimeline("emergency", 1_791_688_602_995L, 1L)
        val wake = WakeReport.json(pending, 1, 1L, -1).getJSONObject("wake")
        assertFalse(wake.has("onAt"))
        assertFalse(wake.has("resAt"))
        assertFalse(wake.has("loadAt"))
        assertEquals("pending", wake.getString("out"))
        assertNull(pending.resumeAfterMs)
        assertEquals(1_105L, full.resumeAfterMs)
        // No boot count where the ROM does not keep one.
        assertFalse(WakeReport.json(pending, 1, 1L, -1).getJSONObject("proc").has("boot"))
        // No wake on record → no wake block, the process block still goes.
        val none = WakeReport.json(null, 7, 9L, 3)
        assertFalse(none.has("wake"))
        assertEquals(7, none.getJSONObject("proc").getInt("pid"))
    }

    @Test
    fun `the whole header stays inside the server's 1 KiB limit with every block present`() {
        // The report as NativePowerControl.report builds it, with the sleep
        // block at its longest and the wake + proc blocks on top.
        val header = org.json.JSONObject()
            .put("schema", 1)
            .put("interactive", true)
            .put("foreground", false)
            .put("standbySinceMs", 1_791_688_602_995L)
            .put("elapsedRealtimeMs", 9_999_999_999L)
            .put("powerOnAck", "2026-10-09T00:00:00.123Z")
            .put("powerOnAttempts", 3)
            .put(
                "sleep",
                org.json.JSONObject()
                    .put("blank", "accessibility-lock-xxxxxxxxxxxxxx")
                    .put("dream", true)
                    .put("a11y", true)
                    .put("admin", true)
                    .put("last", org.json.JSONObject().put("m", "accessibility-lock-xxxxxxxxxxxxxx").put("o", "unknown").put("at", 1_791_688_602_995L))
                    .put("restore", org.json.JSONObject().put("d", "RESTORE_SOMETHING_LONG_DECISION_NAME_XXX").put("o", "kept-on").put("at", 1_791_688_602_995L))
                    .put("offIdleS", 999_999_999L)
                    .put("offAt", 1_791_688_602_995L)
                    .put("attS", 999_999_999),
            )
        val blocks = WakeReport.json(
            full.copy(source = "x".repeat(40), launches = 99, outcome = "y".repeat(40)),
            Int.MAX_VALUE,
            Long.MAX_VALUE / 4,
            Int.MAX_VALUE,
        )
        header.put("wake", blocks.getJSONObject("wake")).put("proc", blocks.getJSONObject("proc"))
        val text = header.toString()
        assertTrue("header is ${text.length} chars", text.length <= 900)
        // And the clamps held.
        assertEquals(WakeReport.MAX_SOURCE_CHARS, header.getJSONObject("wake").getString("src").length)
        assertEquals(9, header.getJSONObject("wake").getInt("n"))
        assertEquals(16, header.getJSONObject("wake").getString("out").length)
    }
}
