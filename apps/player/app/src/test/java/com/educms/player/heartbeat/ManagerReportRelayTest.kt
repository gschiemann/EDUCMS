package com.educms.player.heartbeat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The Player's relay of companion health and companion reports (2026-11-08).
 * Pure rules first, then source-shape guards that pin the wiring: the header
 * rides ONLY the device-authenticated heartbeat, and the kill switch is read.
 */
class ManagerReportRelayTest {
    private val now = 1_800_000_000_000L

    @Test
    fun `the relay runs only with a token, an allowed host, no kill switch and no auth backoff`() {
        assertTrue(ManagerReportRelay.relayEnabled(false, "tok", true, now, 0L))
        assertFalse(ManagerReportRelay.relayEnabled(true, "tok", true, now, 0L))      // MANAGER_REPORT_RELAY=off
        assertFalse(ManagerReportRelay.relayEnabled(false, null, true, now, 0L))      // unpaired
        assertFalse(ManagerReportRelay.relayEnabled(false, "  ", true, now, 0L))
        assertFalse(ManagerReportRelay.relayEnabled(false, "tok", false, now, 0L))    // not our API host
        assertFalse(ManagerReportRelay.relayEnabled(false, "tok", true, now, now + 1)) // token refused recently
        assertTrue(ManagerReportRelay.relayEnabled(false, "tok", true, now, now))
    }

    @Test
    fun `delivery outcomes - ack delivered and permanently refused, back off on auth, retry the rest`() {
        assertEquals(ManagerReportRelay.Outcome.ACK, ManagerReportRelay.outcomeFor(200))
        assertEquals(ManagerReportRelay.Outcome.ACK, ManagerReportRelay.outcomeFor(201))
        assertEquals(ManagerReportRelay.Outcome.ACK, ManagerReportRelay.outcomeFor(400))
        assertEquals(ManagerReportRelay.Outcome.ACK, ManagerReportRelay.outcomeFor(404))
        assertEquals(ManagerReportRelay.Outcome.AUTH_REFUSED, ManagerReportRelay.outcomeFor(401))
        assertEquals(ManagerReportRelay.Outcome.AUTH_REFUSED, ManagerReportRelay.outcomeFor(403))
        assertEquals(ManagerReportRelay.Outcome.RETRY, ManagerReportRelay.outcomeFor(429))
        assertEquals(ManagerReportRelay.Outcome.RETRY, ManagerReportRelay.outcomeFor(503))
        assertEquals(ManagerReportRelay.Outcome.RETRY, ManagerReportRelay.outcomeFor(-1))
    }

    @Test
    fun `a relayed body keeps the companion's facts and says who sent it`() {
        val out = JSONObject(ManagerReportRelay.relayBody("ota-state", """{"state":"ERROR","message":"x"}""", now)!!)
        assertEquals("ERROR", out.getString("state"))
        assertEquals("x", out.getString("message"))
        assertEquals("manager", out.getString("source"))
        assertEquals("player", out.getString("relayedBy"))
        assertEquals(now, out.getLong("queuedAt"))
        val crash = JSONObject(ManagerReportRelay.relayBody("crash-report", """{"source":"player","message":"boom"}""", 0L)!!)
        assertEquals("manager", crash.getString("source"))  // the companion cannot claim to be the Player
        assertFalse(crash.has("queuedAt"))
        assertNull(ManagerReportRelay.relayBody("reboot", "{}", now))
        assertNull(ManagerReportRelay.relayBody("ota-state", "not json", now))
    }

    @Test
    fun `the health header is sent only while fresh, printable and bounded`() {
        val json = """{"schema":1,"now":1}"""
        assertEquals(json, ManagerReportRelay.headerValue(json, now - 60_000, now))
        assertNull(ManagerReportRelay.headerValue(json, now - ManagerReportRelay.HEALTH_FRESH_MS - 1, now))
        assertNull(ManagerReportRelay.headerValue(json, now + 1, now))
        assertNull(ManagerReportRelay.headerValue(json, 0L, now))
        assertNull(ManagerReportRelay.headerValue(null, now, now))
        assertNull(ManagerReportRelay.headerValue("{\"a\":\"\n\"}", now, now))
        assertNull(ManagerReportRelay.headerValue("{\"a\":\"é\"}", now, now))
        assertNull(ManagerReportRelay.headerValue("x".repeat(5000), now, now))
    }

    @Test
    fun `the server directive is read only when stated`() {
        assertEquals(true, ManagerReportRelay.serverDirective(JSONObject("""{"managerRelay":"off"}""")))
        assertEquals(false, ManagerReportRelay.serverDirective(JSONObject("""{"managerRelay":"on"}""")))
        assertNull(ManagerReportRelay.serverDirective(JSONObject("""{}""")))
        assertNull(ManagerReportRelay.serverDirective(JSONObject("""{"managerRelay":"maybe"}""")))
    }

    private fun src(rel: String): String? = listOf(File(rel), File("../$rel"), File("apps/player/$rel"))
        .firstOrNull { it.isFile }?.readText()

    @Test
    fun `the health header rides only the device-authenticated heartbeat`() {
        val hb = src("app/src/main/java/com/educms/player/heartbeat/HeartbeatService.kt")
        assumeTrue(hb != null)
        val i = hb!!.indexOf("ManagerReportRelay.healthHeader()")
        assertTrue(i > 0)
        val guard = hb.lastIndexOf("if (nativeAllowed) runCatching", i)
        assertTrue("header is set inside an `if (nativeAllowed)` block", guard in (i - 200) until i)
        assertTrue(hb.contains("ManagerReportRelay.acceptServerDirective(prefs, JSONObject(body))"))
    }

    @Test
    fun `the publisher tells the companion whether it relays and drains on its own thread`() {
        val pub = src("app/src/main/java/com/educms/player/heartbeat/ManagerHeartbeatPublisher.kt")
        assumeTrue(pub != null)
        assertTrue(pub!!.contains("put(COL_RELAY, ManagerReportRelay.relayFlag(ctx))"))
        assertTrue(pub.contains("ManagerReportRelay.readHealth(ctx)"))
        assertTrue(pub.contains("ManagerReportRelay.drain(ctx)"))
    }
}
