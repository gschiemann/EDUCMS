package com.educms.manager.alertwatch

import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.database.MatrixCursor
import android.util.Log
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Record
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Stamp

/**
 * The two rows the alert-watch watchdog lives on, persisted in the Manager's
 * prefs so a Manager restart neither forgets the Player's last stamp nor the
 * no-loop memory (2026-11-08, wave 5).
 *
 *  • STAMP — written BY THE PLAYER through `PlayerHealthProvider` at
 *    `content://com.educms.manager.health/alert-watch` after every pass of
 *    its native alert watch. Read by [AlertWatchWatchdog].
 *  • RECORD — written BY THE MANAGER (the latest verdict, rule 7) and read by
 *    the Player at `…/alert-watch-watchdog`, which carries it on its own
 *    signed heartbeat. The Manager itself posts nothing to the server.
 *  • MEMORY — the policy's [AlertWatchWatchdogPolicy.Memory], encoded flat.
 *
 * Column names are the wire contract with the Player's `AlertWatchStamp.kt`;
 * change them in both or in neither.
 */
object AlertWatchStore {

    private const val TAG = "AlertWatchStore"
    private const val PREFS = "edu_manager_alert_watch"

    // ── the stamp (Player → Manager) ──
    const val COL_AT_ELAPSED_MS = "at_elapsed_ms"
    const val COL_STATE = "state"
    const val COL_PANEL_DARK = "panel_dark"
    const val COL_HOLD_HELD = "hold_held"
    const val COL_FACES = "faces"
    const val COL_MODE = "mode"
    const val COL_REASON = "reason"
    val STAMP_COLUMNS = arrayOf(COL_AT_ELAPSED_MS, COL_STATE, COL_PANEL_DARK, COL_HOLD_HELD, COL_FACES, COL_MODE, COL_REASON)

    // ── the record (Manager → Player) ──
    const val COL_VERDICT = "verdict"
    const val COL_RECORD_AT_ELAPSED_MS = "record_at_elapsed_ms"
    const val COL_STAMP_AGE_MS = "stamp_age_ms"
    const val COL_STAMP_STATE = "stamp_state"
    const val COL_LADDER_RUNG = "ladder_rung"
    const val COL_LADDER_AT_ELAPSED_MS = "ladder_at_elapsed_ms"
    const val COL_INTERVENTIONS_24H = "interventions_24h"
    val RECORD_COLUMNS = arrayOf(
        COL_VERDICT, COL_MODE, COL_RECORD_AT_ELAPSED_MS, COL_STAMP_AGE_MS, COL_STAMP_STATE, COL_FACES, COL_REASON,
        COL_LADDER_RUNG, COL_LADDER_AT_ELAPSED_MS, COL_INTERVENTIONS_24H,
    )

    private const val K_STAMP_AT = "stamp_at"
    private const val K_STAMP_STATE = "stamp_state"
    private const val K_STAMP_DARK = "stamp_dark"
    private const val K_STAMP_HOLD = "stamp_hold"
    private const val K_STAMP_FACES = "stamp_faces"
    private const val K_STAMP_MODE = "stamp_mode"
    private const val K_STAMP_REASON = "stamp_reason"

    private const val K_REC_VERDICT = "rec_verdict"
    private const val K_REC_MODE = "rec_mode"
    private const val K_REC_AT = "rec_at"
    private const val K_REC_STAMP_AGE = "rec_stamp_age"
    private const val K_REC_STAMP_STATE = "rec_stamp_state"
    private const val K_REC_FACES = "rec_faces"
    private const val K_REC_REASON = "rec_reason"
    private const val K_REC_LADDER_RUNG = "rec_ladder_rung"
    private const val K_REC_LADDER_AT = "rec_ladder_at"
    private const val K_REC_N24 = "rec_n24"

    private const val K_MEMORY = "memory"

    private fun prefs(ctx: Context): SharedPreferences? =
        runCatching { ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }.getOrNull()

    // ─── the stamp ───────────────────────────────────────────────────

    /** The provider's insert: accept only what the contract names; never throw. */
    fun writeStamp(ctx: Context, v: ContentValues): Boolean {
        val at = v.getAsLong(COL_AT_ELAPSED_MS) ?: return false
        val state = AlertWatchWatchdogPolicy.stampStateOf(v.getAsString(COL_STATE)) ?: return false
        val p = prefs(ctx) ?: return false
        return runCatching {
            p.edit()
                .putLong(K_STAMP_AT, at)
                .putString(K_STAMP_STATE, AlertWatchWatchdogPolicy.wire(state))
                .putBoolean(K_STAMP_DARK, (v.getAsInteger(COL_PANEL_DARK) ?: 0) != 0)
                .putBoolean(K_STAMP_HOLD, (v.getAsInteger(COL_HOLD_HELD) ?: 0) != 0)
                .putInt(K_STAMP_FACES, (v.getAsInteger(COL_FACES) ?: 0).coerceIn(0, 8))
                .putString(K_STAMP_MODE, AlertWatchWatchdogPolicy.wire(AlertWatchWatchdogPolicy.modeOf(v.getAsString(COL_MODE))))
                .putString(K_STAMP_REASON, AlertWatchWatchdogPolicy.safeReason(v.getAsString(COL_REASON)))
                .commit()
        }.onFailure { Log.w(TAG, "stamp write failed: ${it.message}") }.getOrDefault(false)
    }

    fun readStamp(ctx: Context): Stamp? {
        val p = prefs(ctx) ?: return null
        return runCatching {
            if (!p.contains(K_STAMP_AT)) return null
            val state = AlertWatchWatchdogPolicy.stampStateOf(p.getString(K_STAMP_STATE, null)) ?: return null
            Stamp(
                atElapsedMs = p.getLong(K_STAMP_AT, 0L),
                state = state,
                panelDark = p.getBoolean(K_STAMP_DARK, false),
                holdHeld = p.getBoolean(K_STAMP_HOLD, false),
                faces = p.getInt(K_STAMP_FACES, 0),
                mode = AlertWatchWatchdogPolicy.modeOf(p.getString(K_STAMP_MODE, null)),
                reason = p.getString(K_STAMP_REASON, null),
            )
        }.getOrNull()
    }

    /** The stamp as the provider answers a query for it. */
    fun stampCursor(ctx: Context): MatrixCursor {
        val c = MatrixCursor(STAMP_COLUMNS)
        readStamp(ctx)?.let { s ->
            c.addRow(arrayOf<Any?>(
                s.atElapsedMs, AlertWatchWatchdogPolicy.wire(s.state), if (s.panelDark) 1 else 0, if (s.holdHeld) 1 else 0,
                s.faces, AlertWatchWatchdogPolicy.wire(s.mode), s.reason ?: "",
            ))
        }
        return c
    }

    // ─── the record ──────────────────────────────────────────────────

    /** Store the latest verdict. Returns true when it differed from the stored one (a fact worth a log line). */
    fun writeRecord(ctx: Context, r: Record, nowElapsedMs: Long): Boolean {
        val p = prefs(ctx) ?: return false
        return runCatching {
            val same = p.getString(K_REC_VERDICT, null) == AlertWatchWatchdogPolicy.wire(r.verdict) &&
                p.getString(K_REC_MODE, null) == AlertWatchWatchdogPolicy.wire(r.mode) &&
                p.getString(K_REC_LADDER_RUNG, null) == (r.ladder?.let { AlertWatchWatchdogPolicy.wire(it.rung) } ?: "") &&
                p.getLong(K_REC_LADDER_AT, -1L) == (r.ladder?.atMs ?: -1L) &&
                p.getInt(K_REC_N24, -1) == r.interventionsLast24h
            if (same) return false
            p.edit()
                .putString(K_REC_VERDICT, AlertWatchWatchdogPolicy.wire(r.verdict))
                .putString(K_REC_MODE, AlertWatchWatchdogPolicy.wire(r.mode))
                .putLong(K_REC_AT, nowElapsedMs)
                .putLong(K_REC_STAMP_AGE, r.stampAgeMs ?: -1L)
                .putString(K_REC_STAMP_STATE, r.stampState?.let { AlertWatchWatchdogPolicy.wire(it) } ?: "")
                .putInt(K_REC_FACES, r.faces)
                .putString(K_REC_REASON, r.reason ?: "")
                .putString(K_REC_LADDER_RUNG, r.ladder?.let { AlertWatchWatchdogPolicy.wire(it.rung) } ?: "")
                .putLong(K_REC_LADDER_AT, r.ladder?.atMs ?: -1L)
                .putInt(K_REC_N24, r.interventionsLast24h)
                .commit()
            true
        }.onFailure { Log.w(TAG, "record write failed: ${it.message}") }.getOrDefault(false)
    }

    /** Forget the record (the mode went off): the Player then carries nothing. */
    fun clearRecord(ctx: Context) {
        runCatching {
            prefs(ctx)?.edit()?.remove(K_REC_VERDICT)?.remove(K_REC_MODE)?.remove(K_REC_AT)?.remove(K_REC_STAMP_AGE)
                ?.remove(K_REC_STAMP_STATE)?.remove(K_REC_FACES)?.remove(K_REC_REASON)?.remove(K_REC_LADDER_RUNG)
                ?.remove(K_REC_LADDER_AT)?.remove(K_REC_N24)?.commit()
        }
    }

    /** The record as the provider answers a query for it (one row, or none). */
    fun recordCursor(ctx: Context): MatrixCursor {
        val c = MatrixCursor(RECORD_COLUMNS)
        val p = prefs(ctx) ?: return c
        runCatching {
            val verdict = p.getString(K_REC_VERDICT, null) ?: return c
            c.addRow(arrayOf<Any?>(
                verdict,
                p.getString(K_REC_MODE, "off"),
                p.getLong(K_REC_AT, 0L),
                p.getLong(K_REC_STAMP_AGE, -1L),
                p.getString(K_REC_STAMP_STATE, ""),
                p.getInt(K_REC_FACES, 0),
                p.getString(K_REC_REASON, ""),
                p.getString(K_REC_LADDER_RUNG, ""),
                p.getLong(K_REC_LADDER_AT, -1L),
                p.getInt(K_REC_N24, 0),
            ))
        }
        return c
    }

    // ─── the memory ──────────────────────────────────────────────────

    fun readMemory(ctx: Context): AlertWatchWatchdogPolicy.Memory =
        AlertWatchWatchdogPolicy.decode(runCatching { prefs(ctx)?.getString(K_MEMORY, null) }.getOrNull())

    fun writeMemory(ctx: Context, m: AlertWatchWatchdogPolicy.Memory) {
        runCatching { prefs(ctx)?.edit()?.putString(K_MEMORY, AlertWatchWatchdogPolicy.encode(m))?.apply() }
            .onFailure { Log.w(TAG, "memory write failed: ${it.message}") }
    }

    /** For a log line: the record in one secret-free phrase. */
    fun describe(r: Record): String = buildString {
        append(AlertWatchWatchdogPolicy.wire(r.verdict))
        append(" mode=").append(AlertWatchWatchdogPolicy.wire(r.mode))
        r.stampAgeMs?.let { append(" stampAgeS=").append(it / 1000) }
        r.stampState?.let { append(" stamp=").append(AlertWatchWatchdogPolicy.wire(it)) }
        append(" faces=").append(r.faces)
        r.ladder?.let { append(" rung=").append(AlertWatchWatchdogPolicy.wire(it.rung)) }
        append(" n24h=").append(r.interventionsLast24h)
        r.reason?.let { append(" reason=").append(it) }
    }
}
