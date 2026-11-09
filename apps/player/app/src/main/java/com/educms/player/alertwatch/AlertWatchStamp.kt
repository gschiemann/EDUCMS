package com.educms.player.alertwatch

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import com.educms.player.logging.PlayerLogger

/**
 * THE ALERT-WATCH STAMP (2026-11-08, Manager wave 5; life safety, CHANGE class).
 *
 * After every pass of the native alert watch, the Player writes ONE row into
 * the companion Manager's health provider saying how the watch stands: when
 * (the shared `elapsedRealtime` clock), whether it is watching, how many
 * manifests, whether the panel is dark by the watch's own reckoning (a
 * vendor-dark GUQ counts), whether a hold is up, and the mode the server gave
 * this screen. The Manager's `AlertWatchWatchdog` reads it on its 30 s tick
 * and, while the panel is dark, judges whether the watch is ALIVE — the one
 * fact nothing outside the Player's process checked until now.
 *
 * The same object reads the Manager's latest VERDICT back
 * (`…/alert-watch-watchdog`) and renders it as the `x-venueos-alert-watch-watchdog`
 * header of the Player's own signed native heartbeat, so every intervention
 * the Manager makes is a fact on the dashboard, carried by the device
 * credential — the Manager itself posts nothing.
 *
 * ⚠️ OBSERVABILITY ONLY. Nothing here touches the hold, the watch's decisions
 * or the display. A missing Manager, a refused insert, a provider that throws:
 * each is logged once and the watch runs exactly as before.
 *
 * The column names are the wire contract with the Manager's
 * `alertwatch/AlertWatchStore.kt`; change them in both or in neither. The
 * Manager module is NOT a build dependency of the Player (same reasoning as
 * `ManagerHeartbeatPublisher`).
 */
object AlertWatchStamp {

    private const val TAG = "AlertWatchStamp"

    private const val AUTHORITY = "com.educms.manager.health"
    // Lazy: `Uri.parse` is an Android call, and the pure half of this object
    // (shouldPublish, headerJson, q) runs in JVM tests that never reach it.
    private val URI_STAMP: Uri by lazy { Uri.parse("content://$AUTHORITY/alert-watch") }
    private val URI_RECORD: Uri by lazy { Uri.parse("content://$AUTHORITY/alert-watch-watchdog") }

    // ── the stamp (Player → Manager) ──
    const val COL_AT_ELAPSED_MS = "at_elapsed_ms"
    const val COL_STATE = "state"
    const val COL_PANEL_DARK = "panel_dark"
    const val COL_HOLD_HELD = "hold_held"
    const val COL_FACES = "faces"
    const val COL_MODE = "mode"
    const val COL_REASON = "reason"

    // ── the record (Manager → Player) ──
    const val COL_VERDICT = "verdict"
    const val COL_RECORD_AT_ELAPSED_MS = "record_at_elapsed_ms"
    const val COL_STAMP_AGE_MS = "stamp_age_ms"
    const val COL_STAMP_STATE = "stamp_state"
    const val COL_LADDER_RUNG = "ladder_rung"
    const val COL_LADDER_AT_ELAPSED_MS = "ladder_at_elapsed_ms"
    const val COL_INTERVENTIONS_24H = "interventions_24h"

    /** The native heartbeat header the record rides on (API: `screens/alert-watch-watchdog.ts`). */
    const val HEADER = "x-venueos-alert-watch-watchdog"

    /** A header longer than this is not sent (the API refuses longer ones too). */
    const val MAX_HEADER_CHARS = 1024

    /** The quiet interval between two stamps that say the same thing. */
    const val MIN_GAP_MS = 10_000L

    /** What the stamp says. Mirror of the Manager's `StampState` wire values. */
    enum class State(val wire: String) { WATCHING("watching"), IDLE("idle"), NOT_WATCHABLE("not-watchable") }

    /** One stamp, before it becomes ContentValues. Pure, so a test can build and compare it. */
    data class Payload(
        val atElapsedMs: Long,
        val state: State,
        val panelDark: Boolean,
        val holdHeld: Boolean,
        val faces: Int,
        /** `on` / `observe` / null (off: the Manager does nothing). */
        val mode: String?,
        val reason: String?,
    ) {
        /** Everything but the time: two payloads that differ here are worth a stamp at once. */
        fun shape(): String = "${state.wire}|$panelDark|$holdHeld|$faces|${mode ?: ""}|${reason ?: ""}"
    }

    /**
     * Should this payload be written now? Yes when it SAYS something new, or
     * when [MIN_GAP_MS] has passed since the last write (so the Manager sees
     * a fresh time at least every ten seconds while the watch is passing).
     * A backwards clock never wedges it.
     */
    fun shouldPublish(lastShape: String?, lastAtMs: Long?, next: Payload): Boolean {
        if (lastShape == null || lastAtMs == null) return true
        if (next.shape() != lastShape) return true
        return next.atElapsedMs < lastAtMs || next.atElapsedMs - lastAtMs >= MIN_GAP_MS
    }

    fun stateOf(status: NativeAlertWatchEngine.WatchStatus): State = when (status) {
        NativeAlertWatchEngine.WatchStatus.WATCHING -> State.WATCHING
        NativeAlertWatchEngine.WatchStatus.IDLE -> State.IDLE
        NativeAlertWatchEngine.WatchStatus.NOT_WATCHABLE -> State.NOT_WATCHABLE
    }

    /** The server's mode for this screen, from the manifest's `display.alertWatchWatchdog` (DisplayConfig). */
    fun modeOf(raw: String?): String? = when (raw?.trim()?.lowercase()) {
        "on" -> "on"
        "observe" -> "observe"
        else -> null
    }

    fun values(p: Payload): ContentValues = ContentValues().apply {
        put(COL_AT_ELAPSED_MS, p.atElapsedMs)
        put(COL_STATE, p.state.wire)
        put(COL_PANEL_DARK, if (p.panelDark) 1 else 0)
        put(COL_HOLD_HELD, if (p.holdHeld) 1 else 0)
        put(COL_FACES, p.faces)
        put(COL_MODE, p.mode ?: "off")
        put(COL_REASON, p.reason ?: "")
    }

    // ─── the Android half ────────────────────────────────────────────

    private val lock = Any()
    private var lastShape: String? = null
    private var lastAtMs: Long? = null
    @Volatile private var loggedMissingProvider = false
    @Volatile private var lastKick: String? = null

    /**
     * Called by the watch loop after every pass, on its IO dispatcher. Never
     * throws; never blocks the watch on anything but one bounded binder call.
     */
    fun publish(ctx: Context, p: Payload) {
        runCatching {
            val go = synchronized(lock) {
                if (!shouldPublish(lastShape, lastAtMs, p)) return
                lastShape = p.shape()
                lastAtMs = p.atElapsedMs
                true
            }
            if (!go) return
            val result = ctx.applicationContext.contentResolver.insert(URI_STAMP, values(p))
            if (result == null && !loggedMissingProvider) {
                loggedMissingProvider = true
                PlayerLogger.i(TAG, "no companion Manager provider for the alert-watch stamp (or one that predates it) — the watch runs as before, unwatched from outside")
            }
        }.onFailure {
            if (!loggedMissingProvider) {
                loggedMissingProvider = true
                PlayerLogger.w(TAG, "alert-watch stamp refused (${it.javaClass.simpleName}) — the watch runs as before")
            }
        }
    }

    /** Remember that the Manager kicked us (observability; the next stamp's log line names it). */
    fun noteKick(step: String) {
        lastKick = step
    }

    /**
     * The Manager's latest verdict as the heartbeat header value, or null when
     * there is none (no Manager, a Manager that predates it, mode off, or a
     * row this reader cannot make sense of). Bounded; never throws.
     */
    fun watchdogReportHeader(ctx: Context): String? = runCatching {
        val c = ctx.applicationContext.contentResolver.query(URI_RECORD, null, null, null, null) ?: return null
        c.use { cur ->
            if (!cur.moveToFirst()) return null
            fun str(col: String): String? = cur.getColumnIndex(col).takeIf { it >= 0 }?.let { cur.getString(it) }?.takeIf { it.isNotEmpty() }
            fun long(col: String): Long? = cur.getColumnIndex(col).takeIf { it >= 0 }?.let { cur.getLong(it) }
            val verdict = str(COL_VERDICT) ?: return null
            val mode = str(COL_MODE) ?: "off"
            if (mode == "off") return null
            val now = SystemClock.elapsedRealtime()
            val recordAt = long(COL_RECORD_AT_ELAPSED_MS) ?: return null
            val ladderAt = long(COL_LADDER_AT_ELAPSED_MS)?.takeIf { it >= 0 }
            headerJson(
                verdict = verdict,
                mode = mode,
                ageMs = (now - recordAt).coerceAtLeast(0L),
                stampAgeMs = long(COL_STAMP_AGE_MS)?.takeIf { it >= 0 },
                stampState = str(COL_STAMP_STATE),
                faces = long(COL_FACES)?.toInt() ?: 0,
                reason = str(COL_REASON),
                ladderRung = str(COL_LADDER_RUNG),
                ladderAgeMs = ladderAt?.let { (now - it).coerceAtLeast(0L) },
                interventions24h = long(COL_INTERVENTIONS_24H)?.toInt() ?: 0,
                kicked = lastKick,
            )
        }
    }.getOrNull()

    /**
     * `{"v":1,"verdict":…,"mode":…,"ageMs":…,"stampAgeMs":…,"stampState":…,"faces":…,
     *   "reason":…,"ladder":{"rung":…,"ageMs":…},"n24h":…,"kicked":…}` — hand-built so
     * a JVM test can read it (the app module's `org.json` returns defaults).
     * Null when it would exceed [MAX_HEADER_CHARS].
     */
    fun headerJson(
        verdict: String,
        mode: String,
        ageMs: Long,
        stampAgeMs: Long?,
        stampState: String?,
        faces: Int,
        reason: String?,
        ladderRung: String?,
        ladderAgeMs: Long?,
        interventions24h: Int,
        kicked: String?,
    ): String? {
        val sb = StringBuilder(256)
        sb.append("{\"v\":1")
        sb.append(",\"verdict\":").append(q(verdict))
        sb.append(",\"mode\":").append(q(mode))
        sb.append(",\"ageMs\":").append(ageMs)
        if (stampAgeMs != null) sb.append(",\"stampAgeMs\":").append(stampAgeMs)
        if (stampState != null) sb.append(",\"stampState\":").append(q(stampState))
        sb.append(",\"faces\":").append(faces.coerceIn(0, 8))
        if (reason != null) sb.append(",\"reason\":").append(q(reason))
        if (ladderRung != null && ladderAgeMs != null) {
            sb.append(",\"ladder\":{\"rung\":").append(q(ladderRung)).append(",\"ageMs\":").append(ladderAgeMs).append('}')
        }
        sb.append(",\"n24h\":").append(interventions24h.coerceIn(0, 999))
        if (kicked != null) sb.append(",\"kicked\":").append(q(kicked))
        sb.append('}')
        return sb.toString().takeIf { it.length <= MAX_HEADER_CHARS }
    }

    /** A JSON string of printable ASCII only — a header value can carry nothing else. */
    internal fun q(s: String): String {
        val sb = StringBuilder(s.length + 2).append('"')
        for (ch in s.take(160)) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch.code in 0x20..0x7E -> sb.append(ch)
                else -> Unit
            }
        }
        return sb.append('"').toString()
    }
}
