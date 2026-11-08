package com.educms.manager.health

import org.json.JSONArray
import org.json.JSONObject

/**
 * The companion's health facts, as the Player reads them from
 * `content://com.educms.manager.health/manager-health` (2026-11-08, Manager
 * deep dive §5 item 1).
 *
 * WHY. The dashboard knew the Manager's VERSION and nothing else: not whether
 * its watchdog is ticking, how often it relaunched the Player, whether a
 * rollback quarantined a build, or whether an install waits for a person.
 * The Manager holds no device credential, so it does not send these itself:
 * it publishes them here, and the Player carries them inside its own
 * device-authenticated heartbeat (`x-venueos-manager-health`).
 *
 * THE CONTRACT (schema 1), one JSON object — every field states a fact the
 * Manager observed itself, never a guess:
 *   schema                   1
 *   now                      the Manager's clock when the row was built (ms);
 *                            the server judges every age against THIS, so a
 *                            panel whose clock is off never reads "stale"
 *   version / versionCode    the Manager's own build
 *   watchdogTickAt           last completed watchdog tick (ms), 0 = none yet
 *   watchdogStartedAt        when the watchdog service last started (ms)
 *   relaunches.total         every relaunch this install has performed
 *   relaunches.recent        the last 7 days, newest last, at most 20:
 *                            [{at, reason}] — reason ∈ [RELAUNCH_REASONS]
 *   rollback                 {at, versionCode} of the last rollback, or null
 *   quarantined              Player versionCodes refused after a failed boot
 *   installPermission        true / false (Android 8+), null = not knowable
 *   installTapPendingSince   ms since an install has waited for an Install
 *                            tap on the panel, or null
 *
 * Pure (org.json only) so the shape is unit-tested; the Android-side store is
 * [ManagerHealth].
 */
object ManagerHealthReport {
    const val SCHEMA = 1
    const val RECENT_WINDOW_MS = 7L * 24 * 60 * 60 * 1000
    const val MAX_RECENT = 20

    /** Why the watchdog launched the Player. A fixed vocabulary: the server rejects anything else. */
    const val REASON_UNRESPONSIVE = "player-unresponsive"   // heartbeat stale for 3 ticks (crash / kill / hang)
    const val REASON_AFTER_UPDATE = "after-update"          // new build booted its services, UI not foregrounded
    val RELAUNCH_REASONS = setOf(REASON_UNRESPONSIVE, REASON_AFTER_UPDATE)

    data class Relaunch(val atMs: Long, val reason: String)

    data class Facts(
        val nowMs: Long,
        val versionName: String,
        val versionCode: Int,
        val watchdogTickAtMs: Long,
        val watchdogStartedAtMs: Long,
        val relaunchTotal: Int,
        val recent: List<Relaunch>,
        val rollbackAtMs: Long,
        val rollbackVersionCode: Int,
        val quarantined: List<Int>,
        val installPermission: Boolean?,
        val installTapPendingSinceMs: Long,
    )

    /** `at:reason;at:reason` — the prefs encoding. Unknown reasons and junk are dropped. */
    fun encode(list: List<Relaunch>): String = list.joinToString(";") { "${it.atMs}:${it.reason}" }

    fun decode(raw: String?): List<Relaunch> {
        if (raw.isNullOrBlank()) return emptyList()
        return raw.split(';').mapNotNull { part ->
            val i = part.indexOf(':')
            if (i <= 0) return@mapNotNull null
            val at = part.substring(0, i).toLongOrNull() ?: return@mapNotNull null
            val reason = part.substring(i + 1)
            if (at <= 0L || reason !in RELAUNCH_REASONS) null else Relaunch(at, reason)
        }
    }

    /** Keep only the window (a future stamp from a clock jump is dropped too), newest last, capped. */
    fun prune(list: List<Relaunch>, nowMs: Long): List<Relaunch> =
        list.filter { it.atMs <= nowMs && nowMs - it.atMs <= RECENT_WINDOW_MS }
            .sortedBy { it.atMs }
            .takeLast(MAX_RECENT)

    /** One more relaunch. An unknown reason is recorded as unresponsive — the only other cause there is. */
    fun record(prior: List<Relaunch>, nowMs: Long, reason: String): List<Relaunch> {
        val r = if (reason in RELAUNCH_REASONS) reason else REASON_UNRESPONSIVE
        return prune(prior + Relaunch(nowMs, r), nowMs)
    }

    fun toJson(f: Facts): JSONObject = JSONObject().apply {
        put("schema", SCHEMA)
        put("now", f.nowMs)
        put("version", f.versionName.take(40))
        put("versionCode", f.versionCode)
        put("watchdogTickAt", f.watchdogTickAtMs.coerceAtLeast(0L))
        put("watchdogStartedAt", f.watchdogStartedAtMs.coerceAtLeast(0L))
        put("relaunches", JSONObject().apply {
            put("total", f.relaunchTotal.coerceAtLeast(0))
            put("recent", JSONArray().apply {
                prune(f.recent, f.nowMs).forEach { r ->
                    put(JSONObject().apply { put("at", r.atMs); put("reason", r.reason) })
                }
            })
        })
        put(
            "rollback",
            if (f.rollbackAtMs > 0L) JSONObject().apply {
                put("at", f.rollbackAtMs)
                put("versionCode", f.rollbackVersionCode)
            } else JSONObject.NULL,
        )
        put("quarantined", JSONArray().apply { f.quarantined.distinct().sorted().take(10).forEach { put(it) } })
        put("installPermission", f.installPermission ?: JSONObject.NULL)
        put("installTapPendingSince", if (f.installTapPendingSinceMs > 0L) f.installTapPendingSinceMs else JSONObject.NULL)
    }
}
