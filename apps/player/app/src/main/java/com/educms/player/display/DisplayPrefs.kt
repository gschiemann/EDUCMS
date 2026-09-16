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
     * ⚠️ LIFE SAFETY (2026-09-16, double-sided displays). Comma-separated
     * face indices that are CURRENTLY holding — `"0"`, `"0,1"`, `""`.
     *
     * WHY A SET AND NOT A BOOLEAN. [KEY_EMERGENCY_HOLD] is ONE
     * process-wide flag, while the web side's dedup latch
     * (`emergencyHold.ts` `lastSent`) is per-JS-context. With two faces
     * that is two latches writing one boolean, so FACE B'S ALL-CLEAR
     * RELEASES FACE A'S LIVE LOCKDOWN. The hold is therefore held while
     * ANY face holds, and this key is the membership.
     *
     * Written with `commit()` for exactly the reason the boolean is: a
     * process death mid-emergency must not come back released.
     *
     * A MISSING key is the SAFE state in both directions, which is the
     * convention this whole file follows. Missing + boolean TRUE reads as
     * held-by-the-primary (the pre-face world had exactly one holder), so
     * an APK upgrading mid-alert stays held and a face's routine release
     * cannot clear a hold it never raised. Missing + boolean FALSE reads
     * as not held. See [DisplayEmergency.currentHoldFaces].
     */
    private const val KEY_EMERGENCY_HOLD_FACES = "display_emergency_hold_faces"

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

    /**
     * The raw [KEY_EMERGENCY_HOLD_FACES] value.
     *
     * Null means ABSENT — which is a different fact from "empty", and the
     * difference is load-bearing on an APK that upgraded mid-alert. Parsing
     * is [DisplayEmergency.parseHoldFaces]; it is pure so it can be tested
     * without an emulator.
     */
    fun emergencyHoldFacesRaw(ctx: Context): String? = runCatching {
        prefs(ctx).getString(KEY_EMERGENCY_HOLD_FACES, null)
    }.getOrNull()

    /**
     * SYNCHRONOUS — see [KEY_EMERGENCY_HOLD].
     *
     * Writes the boolean, the since-stamp and the holding-face set in ONE
     * commit so a kill can never leave the two disagreeing in the unsafe
     * direction. `facesRaw == null` removes the set (the full-release case).
     */
    fun commitEmergencyHold(
        ctx: Context,
        active: Boolean,
        sinceMs: Long,
        facesRaw: String?,
    ): Boolean = runCatching {
        val editor = prefs(ctx).edit().putBoolean(KEY_EMERGENCY_HOLD, active)
        if (active) editor.putLong(KEY_EMERGENCY_HOLD_SINCE, sinceMs) else editor.remove(KEY_EMERGENCY_HOLD_SINCE)
        if (facesRaw == null) editor.remove(KEY_EMERGENCY_HOLD_FACES) else editor.putString(KEY_EMERGENCY_HOLD_FACES, facesRaw)
        editor.commit()
    }.getOrElse {
        PlayerLogger.e(TAG, "commitEmergencyHold FAILED", it)
        false
    }

    /**
     * Record a face JOINING a hold that is already engaged, touching
     * nothing else.
     *
     * The re-raise path must not re-stamp [KEY_EMERGENCY_HOLD_SINCE] (that
     * stamp is ops' only signal for "this screen has been held for six
     * hours because the page died mid-alert") and must not re-snapshot the
     * pre-hold brightness. But the new member MUST be recorded, or that
     * face's later release would be the one that clears the whole thing.
     */
    fun commitEmergencyHoldFaces(ctx: Context, facesRaw: String): Boolean = runCatching {
        prefs(ctx).edit().putString(KEY_EMERGENCY_HOLD_FACES, facesRaw).commit()
    }.getOrElse {
        PlayerLogger.e(TAG, "commitEmergencyHoldFaces FAILED", it)
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

    // ─── device-admin enrolment bookkeeping ────────────────────────
    //
    // Our own record of the enrolment CEREMONY. The OS's
    // `isAdminActive()` is always the authoritative answer to "are we an
    // admin"; these three only answer "did we ask, and how did it go",
    // which the OS does not remember for us. All default to 0 = never,
    // and a wiped prefs file degrades to "never asked" — the safe
    // direction, because it costs at most one extra operator-initiated
    // prompt and never grants anything.
    //
    // `apply()`, not `commit()`: unlike the revert record and the
    // emergency hold, losing one of these to a process kill costs
    // nothing safety-relevant (worst case the prompt-pending marker is
    // lost and the next request re-prompts). See [DeviceAdminEnrollment].

    /** When we last fired ACTION_ADD_DEVICE_ADMIN. 0 = none outstanding. */
    private const val KEY_ADMIN_PROMPTED_AT = "display_admin_prompted_at"

    /** When a fired prompt was last observed NOT to have enrolled us. */
    private const val KEY_ADMIN_DECLINED_AT = "display_admin_declined_at"

    /** When we first observed ourselves to be an active admin. */
    private const val KEY_ADMIN_ENROLLED_AT = "display_admin_enrolled_at"

    /**
     * The persisted half of [AdminEnrollmentRecord]. `isActiveAdmin` is
     * NOT stored — it is asked of the OS on every read, because a cached
     * copy is exactly how a screen ends up offering a blank it can no
     * longer perform after an operator revoked the admin in Settings.
     */
    fun adminEnrollmentRecord(ctx: Context, isActiveAdmin: Boolean): AdminEnrollmentRecord = runCatching {
        val p = prefs(ctx)
        AdminEnrollmentRecord(
            isActiveAdmin = isActiveAdmin,
            promptedAtMs = p.getLong(KEY_ADMIN_PROMPTED_AT, 0L),
            declinedAtMs = p.getLong(KEY_ADMIN_DECLINED_AT, 0L),
            enrolledAtMs = p.getLong(KEY_ADMIN_ENROLLED_AT, 0L),
        )
    }.getOrDefault(AdminEnrollmentRecord(isActiveAdmin = isActiveAdmin))

    fun setAdminEnrollmentRecord(ctx: Context, record: AdminEnrollmentRecord) {
        runCatching {
            val editor = prefs(ctx).edit()
            if (record.promptedAtMs > 0L) {
                editor.putLong(KEY_ADMIN_PROMPTED_AT, record.promptedAtMs)
            } else {
                editor.remove(KEY_ADMIN_PROMPTED_AT)
            }
            if (record.declinedAtMs > 0L) {
                editor.putLong(KEY_ADMIN_DECLINED_AT, record.declinedAtMs)
            } else {
                editor.remove(KEY_ADMIN_DECLINED_AT)
            }
            if (record.enrolledAtMs > 0L) {
                editor.putLong(KEY_ADMIN_ENROLLED_AT, record.enrolledAtMs)
            } else {
                editor.remove(KEY_ADMIN_ENROLLED_AT)
            }
            editor.apply()
        }.onFailure { PlayerLogger.w(TAG, "setAdminEnrollmentRecord failed: ${it.message}") }
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
