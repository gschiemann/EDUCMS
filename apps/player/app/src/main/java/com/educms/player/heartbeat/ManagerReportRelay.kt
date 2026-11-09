package com.educms.player.heartbeat

import android.content.Context
import android.content.SharedPreferences
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Player's half of Manager health and signed Manager reports
 * (2026-11-08, Manager deep dive §5 items 1 and 2).
 *
 * 1. HEALTH. Every publisher tick (30 s, its own thread) reads the
 *    companion's schema-1 health row from its provider and caches it;
 *    [HeartbeatService] carries the cached copy as `x-venueos-manager-health`
 *    on its device-authenticated heartbeat. Nothing is sent that the
 *    companion did not write, and a copy older than [HEALTH_FRESH_MS] is not
 *    sent at all — the server then simply has no new health, which it
 *    renders as "not reporting since …", never as healthy.
 *
 * 2. RELAY. The companion queues the `ota-state` / `crash-report` posts it
 *    used to make anonymously; the Player posts them on its own channel with
 *    `Authorization: Bearer <device token>` and acknowledges what the server
 *    answered. The Player tells the companion whether it relays (`relay` on
 *    the heartbeat row): not when the server switched it off
 *    (`MANAGER_REPORT_RELAY=off` → heartbeat reply `managerRelay: "off"`),
 *    not without a device token or an allow-listed API host, and not for
 *    [AUTH_BACKOFF_MS] after the server refused the token. In every one of
 *    those the companion posts anonymously, as 1.0.24 does.
 */
object ManagerReportRelay {
    private const val TAG = "ManagerReportRelay"
    const val HEADER = "x-venueos-manager-health"
    const val HEALTH_FRESH_MS = 3L * 60_000
    const val AUTH_BACKOFF_MS = 10L * 60_000
    const val MAX_PER_ROUND = 5
    const val PREF_RELAY_OFF = "manager_relay_off"

    @Volatile private var healthJson: String? = null
    @Volatile private var healthReadAtMs: Long = 0L
    @Volatile private var authBlockedUntilMs: Long = 0L

    // ── pure rules (unit-tested) ─────────────────────────────────────────

    fun relayEnabled(serverOff: Boolean, token: String?, apiHostAllowed: Boolean, nowMs: Long, blockedUntilMs: Long): Boolean =
        !serverOff && !token.isNullOrBlank() && apiHostAllowed && nowMs >= blockedUntilMs

    enum class Outcome { ACK, RETRY, AUTH_REFUSED }

    /**
     * 2xx: delivered. A permanent refusal of the report itself (400 / 404 /
     * 413 / 422 — a bad body or a deleted screen) is acknowledged too: sending
     * it again can never succeed. 401 / 403: the token is not accepted — keep
     * the report, stop relaying for a while so the companion goes anonymous.
     * Anything else (429, 5xx, no answer): keep it for the next round.
     */
    fun outcomeFor(httpCode: Int): Outcome = when {
        httpCode in 200..299 -> Outcome.ACK
        httpCode == 401 || httpCode == 403 -> Outcome.AUTH_REFUSED
        httpCode == 400 || httpCode == 404 || httpCode == 413 || httpCode == 422 -> Outcome.ACK
        else -> Outcome.RETRY
    }

    /** The body the server receives: the companion's own, attributed and stamped. */
    fun relayBody(kind: String, companionBody: String, queuedAtMs: Long): String? {
        if (kind != KIND_OTA_STATE && kind != KIND_CRASH) return null
        val o = try { JSONObject(companionBody) } catch (_: Exception) { return null }
        o.put("source", "manager")
        o.put("relayedBy", "player")
        if (queuedAtMs > 0L) o.put("queuedAt", queuedAtMs)
        return o.toString()
    }

    /** The cached health row, only while fresh, only printable ASCII, bounded. */
    fun headerValue(json: String?, readAtMs: Long, nowMs: Long): String? {
        if (json.isNullOrBlank() || readAtMs <= 0L) return null
        if (nowMs < readAtMs || nowMs - readAtMs > HEALTH_FRESH_MS) return null
        if (json.length > 4096 || !json.all { it.code in 0x20..0x7e }) return null
        return json
    }

    /** `managerRelay` on a heartbeat reply: "off" / "on"; anything else leaves the stored value. */
    fun serverDirective(reply: JSONObject): Boolean? = when (reply.optString("managerRelay", "")) {
        "off" -> true
        "on" -> false
        else -> null
    }

    // ── device side ──────────────────────────────────────────────────────

    fun healthHeader(nowMs: Long = System.currentTimeMillis()): String? = headerValue(healthJson, healthReadAtMs, nowMs)

    /** HeartbeatService: record the server's kill-switch answer. Write only on a change. */
    fun acceptServerDirective(prefs: SharedPreferences, reply: JSONObject) {
        val off = serverDirective(reply) ?: return
        if (prefs.getBoolean(PREF_RELAY_OFF, false) != off) {
            prefs.edit().putBoolean(PREF_RELAY_OFF, off).apply()
            PlayerLogger.i(TAG, "server says the companion report relay is ${if (off) "OFF" else "on"}")
        }
    }

    /** Publisher tick: should the heartbeat row say we relay? */
    fun relayFlag(ctx: Context): Int {
        val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        val apiRoot = prefs.getString("api_root", null)
        return if (relayEnabled(
                serverOff = prefs.getBoolean(PREF_RELAY_OFF, false),
                token = prefs.getString("device_token", null)?.trim(),
                apiHostAllowed = HostAllowlist.isApiHost(apiRoot),
                nowMs = System.currentTimeMillis(),
                blockedUntilMs = authBlockedUntilMs,
            )
        ) 1 else 0
    }

    /** Publisher tick, after the heartbeat insert: cache the companion's health row. */
    fun readHealth(ctx: Context) {
        try {
            ctx.contentResolver.query(URI_MANAGER_HEALTH, null, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return
                val idx = c.getColumnIndex(COL_REPORT_JSON)
                if (idx < 0) return
                val json = c.getString(idx)?.trim()
                if (!json.isNullOrBlank()) {
                    healthJson = json
                    healthReadAtMs = System.currentTimeMillis()
                }
            }
        } catch (_: Exception) {
            // An old companion has no such path (null cursor / IllegalArgument) — nothing to carry.
        }
    }

    /** Publisher tick: post what the companion queued, then acknowledge it. Bounded; never throws. */
    fun drain(ctx: Context) {
        if (relayFlag(ctx) != 1) return
        val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        val apiRoot = prefs.getString("api_root", null) ?: return
        val fp = prefs.getString("device_fingerprint", null)?.takeIf { it.isNotBlank() } ?: return
        val token = prefs.getString("device_token", null)?.trim()?.takeIf { it.isNotBlank() } ?: return
        data class Row(val id: Long, val kind: String, val body: String, val at: Long)
        val rows = try {
            ctx.contentResolver.query(URI_REPORTS, null, null, null, null)?.use { c ->
                val iId = c.getColumnIndex(COL_REPORT_ID)
                val iKind = c.getColumnIndex(COL_REPORT_KIND)
                val iBody = c.getColumnIndex(COL_REPORT_BODY)
                val iAt = c.getColumnIndex(COL_REPORT_AT)
                if (iId < 0 || iKind < 0 || iBody < 0) return
                val out = ArrayList<Row>()
                while (c.moveToNext() && out.size < MAX_PER_ROUND) {
                    out += Row(c.getLong(iId), c.getString(iKind) ?: "", c.getString(iBody) ?: "{}", if (iAt >= 0) c.getLong(iAt) else 0L)
                }
                out
            } ?: return
        } catch (_: Exception) {
            return
        }
        var acked = 0L
        for (row in rows) {
            val body = relayBody(row.kind, row.body, row.at)
            if (body == null) { acked = row.id; continue }   // unreadable: drop it, never loop on it
            val code = post("$apiRoot/api/v1/screens/status/$fp/${row.kind}", token, body)
            when (outcomeFor(code)) {
                Outcome.ACK -> acked = row.id
                Outcome.AUTH_REFUSED -> {
                    authBlockedUntilMs = System.currentTimeMillis() + AUTH_BACKOFF_MS
                    PlayerLogger.w(TAG, "companion relay: server refused the device token (HTTP $code) — companion posts anonymously for ${AUTH_BACKOFF_MS / 60_000} min")
                    break
                }
                Outcome.RETRY -> break
            }
        }
        if (acked > 0L) {
            try {
                ctx.contentResolver.delete(URI_REPORTS, null, arrayOf(acked.toString()))
                PlayerLogger.i(TAG, "relayed companion reports up to #$acked on the signed channel")
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "companion relay ack failed: ${e.message}")
            }
        }
    }

    private fun post(url: String, token: String, body: String): Int {
        if (!HostAllowlist.isApiHost(url)) return -1
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
                instanceFollowRedirects = false
            }
            try {
                conn.outputStream.use { it.write(body.toByteArray()) }
                conn.responseCode
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            -1
        }
    }

    // Mirrors of the companion's PlayerHealthProvider strings — change both in lockstep.
    private const val AUTHORITY = "com.educms.manager.health"
    const val PATH_MANAGER_HEALTH = "manager-health"
    const val PATH_REPORTS = "reports"
    const val COL_REPORT_JSON = "report_json"
    const val COL_REPORT_ID = "id"
    const val COL_REPORT_KIND = "kind"
    const val COL_REPORT_BODY = "body_json"
    const val COL_REPORT_AT = "created_ms"
    const val KIND_OTA_STATE = "ota-state"
    const val KIND_CRASH = "crash-report"
    private val URI_MANAGER_HEALTH = android.net.Uri.parse("content://$AUTHORITY/$PATH_MANAGER_HEALTH")
    private val URI_REPORTS = android.net.Uri.parse("content://$AUTHORITY/$PATH_REPORTS")
}
