package com.educms.player.display

import android.content.Context
import android.content.SharedPreferences
import com.educms.player.logging.PlayerLogger

/**
 * Native persistence for the display-control layer.
 *
 * Lives in the SAME `edu_player` SharedPreferences file every other
 * native subsystem uses (`api_root`, `device_fingerprint`,
 * `screen_orientation`, `lock_task_opt_out`, `operator_pin`…), following
 * the established convention: string/boolean keys, defaults chosen so a
 * MISSING key is the SAFE behaviour, every access wrapped so a corrupt
 * prefs file can never crash a hallway kiosk at boot.
 *
 * `apply()` (asynchronous) is used everywhere EXCEPT the dead-man revert
 * record, which uses `commit()` — see [PendingRevert]'s header for why
 * that one deviation is mandatory.
 */
object DisplayPrefs {

    private const val TAG = "DisplayPrefs"
    const val PREFS_NAME = "edu_player"

    /** Last brightness we drove, 0..100. Mirrors what is on the panel. */
    private const val KEY_BRIGHTNESS = "display_brightness_pct"

    /** Last volume we drove, 0..100. */
    private const val KEY_VOLUME = "display_volume_pct"

    /** Whether the screen is currently blanked BY US. */
    private const val KEY_BLANKED = "display_blanked"

    /**
     * Encoded [PendingRevert] SET — one record per line, at most one per
     * capability. Written with commit(), before the apply.
     */
    private const val KEY_PENDING_REVERT = "display_pending_revert"

    /** Raw, already-validated `display` block from the manifest. */
    private const val KEY_CONFIG_JSON = "display_config_json"

    /**
     * ⚠️ LIFE SAFETY. True while the web player reports an ACTIVE
     * emergency (lockdown / evacuation / weather). Written with
     * `commit()` for the same reason the revert record is: a process
     * death mid-emergency must not bring the screen back blanked.
     * See [DisplayEmergency].
     */
    private const val KEY_EMERGENCY_HOLD = "display_emergency_hold"

    /** When the current hold engaged, for the ops report. 0 = not held. */
    private const val KEY_EMERGENCY_HOLD_SINCE = "display_emergency_hold_since"

    /**
     * Brightness the screen was at before an emergency hold forced it to
     * full, so releasing the hold restores what the operator configured
     * rather than leaving every screen at 100% forever. -1 = none saved.
     */
    private const val KEY_PREHOLD_BRIGHTNESS = "display_prehold_brightness_pct"

    /**
     * `Settings.System.SCREEN_OFF_TIMEOUT` as it was BEFORE
     * [ScreenTimeoutBlankProvider] shortened it. -1 = none saved. The
     * provider is only allowed to blank because it promises to put this
     * back on wake.
     */
    private const val KEY_PRIOR_SCREEN_OFF_TIMEOUT = "display_prior_screen_off_timeout_ms"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ─── live state ────────────────────────────────────────────────

    /**
     * Default 100. A screen we have never touched is at whatever the
     * firmware set, which for signage hardware is full brightness — and
     * guessing LOW here would make a first-ever revert dim a screen that
     * was never dimmed.
     */
    fun brightnessPercent(ctx: Context): Int = runCatching {
        prefs(ctx).getInt(KEY_BRIGHTNESS, 100).coerceIn(0, 100)
    }.getOrDefault(100)

    fun setBrightnessPercent(ctx: Context, percent: Int) {
        runCatching { prefs(ctx).edit().putInt(KEY_BRIGHTNESS, percent.coerceIn(0, 100)).apply() }
            .onFailure { PlayerLogger.w(TAG, "setBrightnessPercent failed: ${it.message}") }
    }

    fun volumePercent(ctx: Context): Int = runCatching {
        prefs(ctx).getInt(KEY_VOLUME, 100).coerceIn(0, 100)
    }.getOrDefault(100)

    fun setVolumePercent(ctx: Context, percent: Int) {
        runCatching { prefs(ctx).edit().putInt(KEY_VOLUME, percent.coerceIn(0, 100)).apply() }
            .onFailure { PlayerLogger.w(TAG, "setVolumePercent failed: ${it.message}") }
    }

    fun blanked(ctx: Context): Boolean = runCatching {
        prefs(ctx).getBoolean(KEY_BLANKED, false)
    }.getOrDefault(false)

    fun setBlanked(ctx: Context, value: Boolean) {
        runCatching { prefs(ctx).edit().putBoolean(KEY_BLANKED, value).apply() }
            .onFailure { PlayerLogger.w(TAG, "setBlanked failed: ${it.message}") }
    }

    // ─── dead-man revert ───────────────────────────────────────────

    /**
     * SYNCHRONOUS by design. `apply()` schedules the disk write on a
     * background thread; a process kill in the window between the call
     * and the flush would lose the record — i.e. exactly the scenario
     * the record exists for. Returns false when the write did not land,
     * and the caller then REFUSES to apply the action.
     *
     * Writes the WHOLE set at once. Passing an empty list removes the
     * key, which is how a fired/cancelled revert is cleared.
     */
    fun commitPendingReverts(ctx: Context, records: List<PendingRevert>): Boolean = runCatching {
        val editor = prefs(ctx).edit()
        if (records.isEmpty()) {
            editor.remove(KEY_PENDING_REVERT)
        } else {
            editor.putString(KEY_PENDING_REVERT, PendingRevert.encodeAll(records))
        }
        editor.commit()
    }.getOrElse {
        PlayerLogger.e(TAG, "commitPendingReverts FAILED — refusing the action", it)
        false
    }

    /** Every outstanding record, at most one per capability. */
    fun pendingReverts(ctx: Context): List<PendingRevert> = runCatching {
        PendingRevert.decodeAll(prefs(ctx).getString(KEY_PENDING_REVERT, null))
    }.getOrDefault(emptyList())

    /** The record that fires SOONEST, for the "reverting in Ns" readout. */
    fun nextPendingRevert(ctx: Context): PendingRevert? =
        pendingReverts(ctx).minByOrNull { it.dueAtEpochMs }

    fun clearPendingReverts(ctx: Context) {
        runCatching { prefs(ctx).edit().remove(KEY_PENDING_REVERT).commit() }
            .onFailure { PlayerLogger.w(TAG, "clearPendingReverts failed: ${it.message}") }
    }

    // ─── ⚠️ emergency hold (life safety) ───────────────────────────

    /**
     * Default FALSE, and that default is deliberate in BOTH directions:
     * a missing key means "no emergency", which is the state that lets
     * the schedule run normally. The hold is set only by an explicit
     * report from the web player, and it is written with `commit()` so
     * an OOM kill between the report and the flush cannot lose it.
     */
    fun emergencyHold(ctx: Context): Boolean = runCatching {
        prefs(ctx).getBoolean(KEY_EMERGENCY_HOLD, false)
    }.getOrDefault(false)

    fun emergencyHoldSince(ctx: Context): Long = runCatching {
        prefs(ctx).getLong(KEY_EMERGENCY_HOLD_SINCE, 0L)
    }.getOrDefault(0L)

    /** SYNCHRONOUS — see [KEY_EMERGENCY_HOLD]. */
    fun commitEmergencyHold(ctx: Context, active: Boolean, sinceMs: Long): Boolean = runCatching {
        val editor = prefs(ctx).edit().putBoolean(KEY_EMERGENCY_HOLD, active)
        if (active) editor.putLong(KEY_EMERGENCY_HOLD_SINCE, sinceMs) else editor.remove(KEY_EMERGENCY_HOLD_SINCE)
        editor.commit()
    }.getOrElse {
        PlayerLogger.e(TAG, "commitEmergencyHold FAILED", it)
        false
    }

    /** Null when nothing was saved. */
    fun preHoldBrightnessPercent(ctx: Context): Int? = runCatching {
        prefs(ctx).getInt(KEY_PREHOLD_BRIGHTNESS, -1).takeIf { it in 0..100 }
    }.getOrNull()

    fun setPreHoldBrightnessPercent(ctx: Context, percent: Int?) {
        runCatching {
            val editor = prefs(ctx).edit()
            if (percent == null) {
                editor.remove(KEY_PREHOLD_BRIGHTNESS)
            } else {
                editor.putInt(KEY_PREHOLD_BRIGHTNESS, percent.coerceIn(0, 100))
            }
            // commit(), not apply(): this is read on the release path of a
            // life-safety hold and must survive a kill in between.
            editor.commit()
        }.onFailure { PlayerLogger.w(TAG, "setPreHoldBrightnessPercent failed: ${it.message}") }
    }

    // ─── screen-off timeout snapshot ───────────────────────────────

    /** Null when nothing was saved (i.e. we have not shortened it). */
    fun priorScreenOffTimeoutMs(ctx: Context): Int? = runCatching {
        prefs(ctx).getInt(KEY_PRIOR_SCREEN_OFF_TIMEOUT, -1).takeIf { it > 0 }
    }.getOrNull()

    fun setPriorScreenOffTimeoutMs(ctx: Context, ms: Int?) {
        runCatching {
            val editor = prefs(ctx).edit()
            if (ms == null || ms <= 0) {
                editor.remove(KEY_PRIOR_SCREEN_OFF_TIMEOUT)
            } else {
                editor.putInt(KEY_PRIOR_SCREEN_OFF_TIMEOUT, ms)
            }
            // commit(): the value that un-does a blank must not be lost to
            // a process kill.
            editor.commit()
        }.onFailure { PlayerLogger.w(TAG, "setPriorScreenOffTimeoutMs failed: ${it.message}") }
    }

    // ─── manifest `display` block ──────────────────────────────────

    fun configJson(ctx: Context): String? = runCatching {
        prefs(ctx).getString(KEY_CONFIG_JSON, null)
    }.getOrNull()

    fun setConfigJson(ctx: Context, json: String?) {
        runCatching {
            val editor = prefs(ctx).edit()
            if (json.isNullOrBlank()) editor.remove(KEY_CONFIG_JSON) else editor.putString(KEY_CONFIG_JSON, json)
            editor.apply()
        }.onFailure { PlayerLogger.w(TAG, "setConfigJson failed: ${it.message}") }
    }
}
