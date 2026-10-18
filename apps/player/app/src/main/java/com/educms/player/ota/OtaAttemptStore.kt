package com.educms.player.ota

import android.content.Context
import com.educms.player.logging.PlayerLogger
import java.io.File

/**
 * Persists the one [OtaAttemptPolicy.Attempt] this screen is working on, so a
 * verified download and the outcome of its install survive the worker, the
 * receiver and a reboot (2026-10-17, unattended-updates program).
 *
 * One attempt at a time, by design: a new offered build replaces the old one
 * (and its file). The kept APK lives where it always did —
 * `getExternalFilesDir(null)/updates/edu-player-<versionCode>.apk`.
 *
 * `commit()` (synchronous) rather than `apply()`: the receivers that record an
 * outcome can be killed the moment they return, and a lost "NEEDS_TAP" is
 * exactly the record that stops the next unattended check from raising the
 * dialog again.
 */
object OtaAttemptStore {
    private const val TAG = "OtaAttemptStore"
    private const val PREFS = "edu_player_ota_attempt"
    private const val K_VC = "vc"
    private const val K_VN = "vn"
    private const val K_SHA = "sha"
    private const val K_VERIFIED = "verified"
    private const val K_COMMITS = "commits"
    private const val K_OUTCOME = "outcome"
    private const val K_CODE = "code"
    private const val K_OUTCOME_AT = "outcome_at"

    fun updatesDir(ctx: Context): File =
        File(ctx.getExternalFilesDir(null), "updates").apply { mkdirs() }

    /** The kept APK for [versionCode] — same name the worker always used. */
    fun apkFile(ctx: Context, versionCode: Int): File = File(updatesDir(ctx), "edu-player-$versionCode.apk")

    fun read(ctx: Context): OtaAttemptPolicy.Attempt? = try {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val vc = p.getInt(K_VC, 0)
        val sha = p.getString(K_SHA, null)
        if (vc <= 0 || sha.isNullOrBlank()) null else OtaAttemptPolicy.Attempt(
            versionCode = vc,
            versionName = p.getString(K_VN, null) ?: "$vc",
            sha256 = sha,
            verified = p.getBoolean(K_VERIFIED, false),
            commits = p.getInt(K_COMMITS, 0),
            outcome = runCatching {
                OtaAttemptPolicy.Outcome.valueOf(p.getString(K_OUTCOME, null) ?: "NONE")
            }.getOrDefault(OtaAttemptPolicy.Outcome.NONE),
            failureCode = p.getString(K_CODE, null),
        )
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "read failed: ${t.message}")
        null
    }

    fun write(ctx: Context, a: OtaAttemptPolicy.Attempt) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt(K_VC, a.versionCode)
                .putString(K_VN, a.versionName)
                .putString(K_SHA, a.sha256.lowercase())
                .putBoolean(K_VERIFIED, a.verified)
                .putInt(K_COMMITS, a.commits)
                .putString(K_OUTCOME, a.outcome.name)
                .putString(K_CODE, a.failureCode)
                .putLong(K_OUTCOME_AT, System.currentTimeMillis())
                .commit()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "write failed: ${t.message}")
        }
    }

    /**
     * Record what happened to the build [versionCode] — only if that is still
     * the build on record (a late status for an old build changes nothing).
     */
    fun recordOutcome(
        ctx: Context,
        versionCode: Int,
        outcome: OtaAttemptPolicy.Outcome,
        failureCode: String? = null,
    ) {
        val a = read(ctx) ?: return
        if (a.versionCode != versionCode) return
        write(ctx, a.copy(outcome = outcome, failureCode = failureCode))
    }

    /** Forget the attempt and delete every kept APK (it landed, or nothing is offered). */
    fun clear(ctx: Context, reason: String) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
            updatesDir(ctx).listFiles()?.forEach { f -> if (f.name.endsWith(".apk")) runCatching { f.delete() } }
            PlayerLogger.i(TAG, "attempt cleared ($reason)")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "clear failed: ${t.message}")
        }
    }

    /** Delete every kept APK except the one for [keepVersionCode]. */
    fun deleteOtherApks(ctx: Context, keepVersionCode: Int) {
        val keep = apkFile(ctx, keepVersionCode).name
        updatesDir(ctx).listFiles()?.forEach { f ->
            if (f.name.endsWith(".apk") && f.name != keep) runCatching { f.delete() }
        }
    }
}
