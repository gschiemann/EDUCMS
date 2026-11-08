package com.educms.manager.health

import org.json.JSONArray
import org.json.JSONObject

/**
 * Signed Manager reports (2026-11-08, deep dive §5 item 2 — the OTA-01 class).
 *
 * The Manager holds no device credential, so every `ota-state` /
 * `crash-report` it posts is anonymous. From this build it hands the report
 * to the Player instead: it queues it here, the Player reads
 * `content://com.educms.manager.health/reports`, posts each one on its own
 * device-authenticated channel (`Authorization: Bearer <device token>`) and
 * deletes what the server acknowledged.
 *
 * THE ROUTE RULE ([route]). The outbox is used only while the Player says it
 * will relay — its heartbeat row carries `relay=1` — and that heartbeat is
 * fresh (≤ [RELAY_FRESH_MS]). Otherwise the Manager posts anonymously exactly
 * as 1.0.24 does. That is the failure direction: no Player, an old Player, an
 * unpaired Player, a Player whose relay is switched off by the server
 * (`MANAGER_REPORT_RELAY=off`) or one that stopped heartbeating all fall back
 * to today's path — a report is never stranded behind a relay that is not there.
 *
 * Bounded: at most [MAX_ENTRIES]; the oldest is dropped first.
 * Pure (org.json only); the Android store is in [ManagerReports].
 */
object ManagerReportOutbox {
    const val RELAY_FRESH_MS = 5L * 60_000
    const val MAX_ENTRIES = 20
    const val KIND_OTA_STATE = "ota-state"
    const val KIND_CRASH = "crash-report"
    val KINDS = setOf(KIND_OTA_STATE, KIND_CRASH)

    enum class Route { OUTBOX, ANONYMOUS }

    data class Entry(val id: Long, val kind: String, val body: String, val atMs: Long)

    fun route(nowMs: Long, playerHeartbeatAtMs: Long, playerRelayFlag: Int): Route {
        if (playerRelayFlag != 1 || playerHeartbeatAtMs <= 0L) return Route.ANONYMOUS
        val age = nowMs - playerHeartbeatAtMs
        return if (age in 0..RELAY_FRESH_MS) Route.OUTBOX else Route.ANONYMOUS
    }

    fun decode(raw: String?): List<Entry> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val kind = o.optString("kind")
                val id = o.optLong("id", 0L)
                if (id <= 0L || kind !in KINDS) null
                else Entry(id, kind, o.optString("body", "{}"), o.optLong("at", 0L))
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun encode(list: List<Entry>): String = JSONArray().apply {
        list.forEach { e ->
            put(JSONObject().apply { put("id", e.id); put("kind", e.kind); put("body", e.body); put("at", e.atMs) })
        }
    }.toString()

    /** Append one report; ids only ever increase; the oldest falls off past the cap. */
    fun enqueue(prior: List<Entry>, kind: String, body: String, nowMs: Long): List<Entry> {
        require(kind in KINDS) { "unknown report kind $kind" }
        val nextId = (prior.maxOfOrNull { it.id } ?: 0L) + 1L
        return (prior + Entry(nextId, kind, body, nowMs)).takeLast(MAX_ENTRIES)
    }

    /** The Player acknowledged everything up to [ackedId]. */
    fun ack(prior: List<Entry>, ackedId: Long): List<Entry> = prior.filter { it.id > ackedId }
}
