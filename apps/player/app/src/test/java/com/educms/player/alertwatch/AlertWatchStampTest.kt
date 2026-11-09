package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE ALERT-WATCH STAMP — the pure half (2026-11-08, Manager wave 5): when a
 * stamp is worth a binder call, and the header the Manager's verdict rides on.
 */
class AlertWatchStampTest {

    private fun payload(at: Long, state: AlertWatchStamp.State = AlertWatchStamp.State.WATCHING, dark: Boolean = true, faces: Int = 1, mode: String? = "on") =
        AlertWatchStamp.Payload(at, state, dark, holdHeld = false, faces = faces, mode = mode, reason = null)

    @Test
    fun `the first stamp always goes`() {
        assertTrue(AlertWatchStamp.shouldPublish(null, null, payload(0)))
    }

    @Test
    fun `an unchanged stamp waits ten seconds, a changed one goes at once`() {
        val first = payload(1_000L)
        assertFalse(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(1_000L + AlertWatchStamp.MIN_GAP_MS - 1)))
        assertTrue(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(1_000L + AlertWatchStamp.MIN_GAP_MS)))
        assertTrue(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(1_500L, state = AlertWatchStamp.State.IDLE, dark = false)))
        assertTrue(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(1_500L, faces = 2)))
        assertTrue(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(1_500L, mode = "observe")))
    }

    @Test
    fun `a backwards clock never wedges the stamp`() {
        val first = payload(1_000_000L)
        assertTrue(AlertWatchStamp.shouldPublish(first.shape(), first.atElapsedMs, payload(10L)))
    }

    @Test
    fun `the mode is exactly on or observe - anything else is off`() {
        assertEquals("on", AlertWatchStamp.modeOf("on"))
        assertEquals("on", AlertWatchStamp.modeOf(" ON "))
        assertEquals("observe", AlertWatchStamp.modeOf("observe"))
        assertNull(AlertWatchStamp.modeOf("off"))
        assertNull(AlertWatchStamp.modeOf("true"))
        assertNull(AlertWatchStamp.modeOf(null))
    }

    @Test
    fun `the engine's status maps one to one onto the wire`() {
        assertEquals("watching", AlertWatchStamp.stateOf(NativeAlertWatchEngine.WatchStatus.WATCHING).wire)
        assertEquals("idle", AlertWatchStamp.stateOf(NativeAlertWatchEngine.WatchStatus.IDLE).wire)
        assertEquals("not-watchable", AlertWatchStamp.stateOf(NativeAlertWatchEngine.WatchStatus.NOT_WATCHABLE).wire)
    }

    // ─── the header ─────────────────────────────────────────────────

    @Test
    fun `the header is compact JSON with the ladder only when there is one`() {
        val h = AlertWatchStamp.headerJson(
            verdict = "rearm-sent", mode = "on", ageMs = 12_000L, stampAgeMs = 250_000L, stampState = "watching",
            faces = 2, reason = null, ladderRung = "rearm", ladderAgeMs = 12_000L, interventions24h = 1, kicked = null,
        )!!
        assertEquals(
            """{"v":1,"verdict":"rearm-sent","mode":"on","ageMs":12000,"stampAgeMs":250000,"stampState":"watching","faces":2,"ladder":{"rung":"rearm","ageMs":12000},"n24h":1}""",
            h,
        )
        val plain = AlertWatchStamp.headerJson("healthy", "observe", 5L, 3_000L, "watching", 1, null, null, null, 0, "rearm")!!
        assertEquals("""{"v":1,"verdict":"healthy","mode":"observe","ageMs":5,"stampAgeMs":3000,"stampState":"watching","faces":1,"n24h":0,"kicked":"rearm"}""", plain)
        assertFalse(plain.contains("ladder"))
    }

    @Test
    fun `a reason is quoted, escaped and kept printable`() {
        assertEquals("\"not \\\"paired\\\"\"", AlertWatchStamp.q("not \"paired\"\n"))
        assertEquals("\"a\\\\b\"", AlertWatchStamp.q("a\\b"))
        assertEquals(162, AlertWatchStamp.q("x".repeat(500)).length)
        val h = AlertWatchStamp.headerJson("not-watchable", "on", 1L, 2L, "not-watchable", 0, "this screen is not paired (no usable device token)", null, null, 0, null)
        assertNotNull(h)
        assertTrue(h!!.all { it.code in 0x20..0x7E })
    }

    @Test
    fun `the header never exceeds the budget the API accepts`() {
        val h = AlertWatchStamp.headerJson("x".repeat(160), "y".repeat(160), Long.MAX_VALUE, Long.MAX_VALUE, "z".repeat(160), 99, "r".repeat(160), "l".repeat(160), Long.MAX_VALUE, 99_999, "k".repeat(160))
        assertTrue(h == null || h.length <= AlertWatchStamp.MAX_HEADER_CHARS)
        assertEquals("x-venueos-alert-watch-watchdog", AlertWatchStamp.HEADER)
    }

    @Test
    fun `the stamp's columns are the Manager's wire contract`() {
        // Mirror of apps/player/manager/.../alertwatch/AlertWatchStore.kt — change both or neither.
        assertEquals("at_elapsed_ms", AlertWatchStamp.COL_AT_ELAPSED_MS)
        assertEquals("state", AlertWatchStamp.COL_STATE)
        assertEquals("panel_dark", AlertWatchStamp.COL_PANEL_DARK)
        assertEquals("hold_held", AlertWatchStamp.COL_HOLD_HELD)
        assertEquals("faces", AlertWatchStamp.COL_FACES)
        assertEquals("mode", AlertWatchStamp.COL_MODE)
        assertEquals("reason", AlertWatchStamp.COL_REASON)
        assertEquals("verdict", AlertWatchStamp.COL_VERDICT)
        assertEquals("record_at_elapsed_ms", AlertWatchStamp.COL_RECORD_AT_ELAPSED_MS)
        assertEquals("ladder_rung", AlertWatchStamp.COL_LADDER_RUNG)
        assertEquals("interventions_24h", AlertWatchStamp.COL_INTERVENTIONS_24H)
    }
}
