package com.educms.manager.health

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The provider contract the Player reads (2026-11-08): the schema-1 health
 * JSON and the signed-report outbox. The Player mirrors the column / path
 * strings (ManagerHeartbeatPublisher); the source-shape guards at the bottom
 * fail when one side moves without the other.
 */
class ManagerHealthContractTest {
    private val day = 24L * 60 * 60 * 1000
    private val now = 1_800_000_000_000L

    private fun facts(
        recent: List<ManagerHealthReport.Relaunch> = emptyList(),
        rollbackAt: Long = 0L,
        tapSince: Long = 0L,
        permission: Boolean? = true,
    ) = ManagerHealthReport.Facts(
        nowMs = now, versionName = "1.1.66-field.1", versionCode = 10166,
        watchdogTickAtMs = now - 12_000, watchdogStartedAtMs = now - day,
        relaunchTotal = 5, recent = recent, rollbackAtMs = rollbackAt, rollbackVersionCode = 10165,
        quarantined = listOf(10165, 10165, 10160), installPermission = permission,
        installTapPendingSinceMs = tapSince,
    )

    @Test
    fun `schema 1 carries every fact the dashboard grades`() {
        val j = JSONObject(ManagerHealthReport.toJson(facts()).toString())
        assertEquals(1, j.getInt("schema"))
        assertEquals(now, j.getLong("now"))
        assertEquals("1.1.66-field.1", j.getString("version"))
        assertEquals(10166, j.getInt("versionCode"))
        assertEquals(now - 12_000, j.getLong("watchdogTickAt"))
        assertEquals(5, j.getJSONObject("relaunches").getInt("total"))
        assertTrue(j.isNull("rollback"))
        assertEquals(listOf(10160, 10165), (0 until j.getJSONArray("quarantined").length()).map { j.getJSONArray("quarantined").getInt(it) })
        assertTrue(j.getBoolean("installPermission"))
        assertTrue(j.isNull("installTapPendingSince"))
    }

    @Test
    fun `unknown permission and a pending tap are stated, not guessed`() {
        val j = ManagerHealthReport.toJson(facts(permission = null, tapSince = now - 60_000, rollbackAt = now - day))
        assertTrue(j.isNull("installPermission"))
        assertEquals(now - 60_000, j.getLong("installTapPendingSince"))
        assertEquals(10165, j.getJSONObject("rollback").getInt("versionCode"))
    }

    @Test
    fun `recent relaunches keep 7 days, newest last, capped, future stamps dropped`() {
        val old = ManagerHealthReport.Relaunch(now - 8 * day, ManagerHealthReport.REASON_UNRESPONSIVE)
        val future = ManagerHealthReport.Relaunch(now + 60_000, ManagerHealthReport.REASON_UNRESPONSIVE)
        val keep = ManagerHealthReport.Relaunch(now - day, ManagerHealthReport.REASON_AFTER_UPDATE)
        assertEquals(listOf(keep), ManagerHealthReport.prune(listOf(future, old, keep), now))
        var list = emptyList<ManagerHealthReport.Relaunch>()
        repeat(30) { i -> list = ManagerHealthReport.record(list, now - 1000L * (30 - i), ManagerHealthReport.REASON_UNRESPONSIVE) }
        assertEquals(ManagerHealthReport.MAX_RECENT, list.size)
        assertEquals(now - 1000L, list.last().atMs)
    }

    @Test
    fun `the prefs encoding round-trips and drops junk and unknown reasons`() {
        val list = listOf(
            ManagerHealthReport.Relaunch(now - 5000, ManagerHealthReport.REASON_UNRESPONSIVE),
            ManagerHealthReport.Relaunch(now - 1000, ManagerHealthReport.REASON_AFTER_UPDATE),
        )
        assertEquals(list, ManagerHealthReport.decode(ManagerHealthReport.encode(list)))
        assertEquals(1, ManagerHealthReport.decode("x:y;12:made-up;${now}:player-unresponsive").size)
        assertEquals(ManagerHealthReport.REASON_UNRESPONSIVE, ManagerHealthReport.record(emptyList(), now, "weird").single().reason)
    }

    @Test
    fun `the header stays small even at the cap`() {
        val many = (1..40).map { ManagerHealthReport.Relaunch(now - it * 1000L, ManagerHealthReport.REASON_UNRESPONSIVE) }
        val text = ManagerHealthReport.toJson(facts(recent = many, rollbackAt = now, tapSince = now)).toString()
        assertTrue("health header is ${text.length} bytes", text.length < 2048)
        assertTrue(text.all { it.code in 0x20..0x7e })
    }

    // ── the signed-report outbox ─────────────────────────────────────────

    @Test
    fun `reports go to the Player only while it says it relays and is heartbeating`() {
        val route = ManagerReportOutbox::route
        assertEquals(ManagerReportOutbox.Route.OUTBOX, route(now, now - 30_000, 1))
        assertEquals(ManagerReportOutbox.Route.ANONYMOUS, route(now, now - 30_000, 0))     // old Player / relay off
        assertEquals(ManagerReportOutbox.Route.ANONYMOUS, route(now, 0L, 1))              // never heartbeated
        assertEquals(ManagerReportOutbox.Route.ANONYMOUS, route(now, now - 6 * 60_000, 1)) // Player dead
        assertEquals(ManagerReportOutbox.Route.ANONYMOUS, route(now, now + 60_000, 1))     // clock went back
    }

    @Test
    fun `the outbox is bounded, ids only increase, ack removes up to the id`() {
        var box = emptyList<ManagerReportOutbox.Entry>()
        repeat(25) { box = ManagerReportOutbox.enqueue(box, ManagerReportOutbox.KIND_OTA_STATE, "{\"state\":\"ERROR\"}", now) }
        assertEquals(ManagerReportOutbox.MAX_ENTRIES, box.size)
        assertEquals(6L, box.first().id)
        assertEquals(25L, box.last().id)
        val after = ManagerReportOutbox.ack(box, 20L)
        assertEquals(listOf(21L, 22L, 23L, 24L, 25L), after.map { it.id })
        assertEquals(26L, ManagerReportOutbox.enqueue(after, ManagerReportOutbox.KIND_CRASH, "{}", now).last().id)
        assertEquals(after, ManagerReportOutbox.decode(ManagerReportOutbox.encode(after)))
    }

    @Test
    fun `the outbox refuses unknown kinds and survives a corrupt store`() {
        assertEquals(emptyList<ManagerReportOutbox.Entry>(), ManagerReportOutbox.decode("not json"))
        assertEquals(0, ManagerReportOutbox.decode("""[{"id":1,"kind":"reboot","body":"{}"}]""").size)
        var threw = false
        try { ManagerReportOutbox.enqueue(emptyList(), "reboot", "{}", now) } catch (_: IllegalArgumentException) { threw = true }
        assertTrue(threw)
    }

    // ── source shape: the two sides of the contract stay in lockstep ─────

    private fun src(rel: String): String? = listOf(File(rel), File("../$rel"), File("apps/player/$rel"))
        .firstOrNull { it.isFile }?.readText()

    @Test
    fun `the Player mirrors the provider's paths and columns`() {
        val provider = src("manager/src/main/java/com/educms/manager/PlayerHealthProvider.kt")
        val publisher = src("app/src/main/java/com/educms/player/heartbeat/ManagerHeartbeatPublisher.kt")
        val relay = src("app/src/main/java/com/educms/player/heartbeat/ManagerReportRelay.kt")
        assumeTrue(provider != null && publisher != null && relay != null)
        val player = publisher + relay
        for (lit in listOf("\"manager-health\"", "\"reports\"", "\"report_json\"", "\"relay\"", "\"body_json\"", "\"kind\"")) {
            assertTrue("provider declares $lit", provider!!.contains(lit))
            assertTrue("player mirrors $lit", player!!.contains(lit))
        }
    }

    @Test
    fun `every relaunch the watchdog performs is recorded with a reason`() {
        val wd = src("manager/src/main/java/com/educms/manager/WatchdogService.kt")
        assumeTrue(wd != null)
        assertFalse(wd!!.contains("forceRestartPlayer()"))
        assertTrue(wd.contains("ManagerHealth.noteRelaunch("))
        assertTrue(wd.contains("ManagerHealth.noteWatchdogTick("))
    }
}
