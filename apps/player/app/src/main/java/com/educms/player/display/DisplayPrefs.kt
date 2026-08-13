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

    /** Encoded [PendingRevert]. Written with commit(), before the apply. */
    private const val KEY_PENDING_REVERT = "display_pending_revert"

    /** Raw, already-validated `display` block from the manifest. */
    private const val KEY_CONFIG_JSON = "display_config_json"

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
     */
    fun commitPendingRevert(ctx: Context, record: PendingRevert): Boolean = runCatching {
        prefs(ctx).edit().putString(KEY_PENDING_REVERT, record.encode()).commit()
    }.getOrElse {
        PlayerLogger.e(TAG, "commitPendingRevert FAILED — refusing the action", it)
        false
    }

    fun pendingRevert(ctx: Context): PendingRevert? = runCatching {
        PendingRevert.decode(prefs(ctx).getString(KEY_PENDING_REVERT, null))
    }.getOrNull()

    fun clearPendingRevert(ctx: Context) {
        runCatching { prefs(ctx).edit().remove(KEY_PENDING_REVERT).commit() }
            .onFailure { PlayerLogger.w(TAG, "clearPendingRevert failed: ${it.message}") }
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
