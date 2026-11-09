package com.educms.manager.health

import android.content.Context
import android.os.Build
import android.util.Log
import com.educms.manager.BuildConfig
import com.educms.manager.rollback.QuarantineList

/**
 * The prefs-backed store behind [ManagerHealthReport] (2026-11-08).
 *
 * Every writer is one line at the place the fact happens (the watchdog tick,
 * a relaunch, a rollback, an install that waits for a tap) and never throws:
 * health bookkeeping must never cost the watchdog a tick. Reads build the
 * schema-1 JSON the provider hands the Player.
 */
object ManagerHealth {
    private const val TAG = "ManagerHealth"
    private const val PREFS = "edu_manager_health"
    private const val K_TICK = "tick_at"
    private const val K_STARTED = "started_at"
    private const val K_TOTAL = "relaunch_total"
    private const val K_RECENT = "relaunch_recent"
    private const val K_ROLLBACK_AT = "rollback_at"
    private const val K_ROLLBACK_VC = "rollback_vc"
    private const val K_TAP_SINCE = "tap_pending_since"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private inline fun safely(what: String, block: () -> Unit) {
        try { block() } catch (e: Exception) { Log.w(TAG, "$what failed: ${e.message}") }
    }

    fun noteWatchdogStarted(ctx: Context, nowMs: Long = System.currentTimeMillis()) =
        safely("noteWatchdogStarted") { prefs(ctx).edit().putLong(K_STARTED, nowMs).apply() }

    fun noteWatchdogTick(ctx: Context, nowMs: Long = System.currentTimeMillis()) =
        safely("noteWatchdogTick") { prefs(ctx).edit().putLong(K_TICK, nowMs).apply() }

    fun noteRelaunch(ctx: Context, reason: String, nowMs: Long = System.currentTimeMillis()) = safely("noteRelaunch") {
        val p = prefs(ctx)
        val next = ManagerHealthReport.record(ManagerHealthReport.decode(p.getString(K_RECENT, null)), nowMs, reason)
        p.edit()
            .putInt(K_TOTAL, p.getInt(K_TOTAL, 0) + 1)
            .putString(K_RECENT, ManagerHealthReport.encode(next))
            .apply()
    }

    fun noteRollback(ctx: Context, badVersionCode: Int, nowMs: Long = System.currentTimeMillis()) = safely("noteRollback") {
        prefs(ctx).edit().putLong(K_ROLLBACK_AT, nowMs).putInt(K_ROLLBACK_VC, badVersionCode).apply()
    }

    /** An install committed by the Manager now waits for a person to tap Install. Keeps the FIRST stamp. */
    fun noteInstallTapPending(ctx: Context, nowMs: Long = System.currentTimeMillis()) = safely("noteInstallTapPending") {
        val p = prefs(ctx)
        if (p.getLong(K_TAP_SINCE, 0L) <= 0L) p.edit().putLong(K_TAP_SINCE, nowMs).apply()
    }

    /** The install finished either way (success or a terminal failure). */
    fun clearInstallTapPending(ctx: Context) = safely("clearInstallTapPending") {
        prefs(ctx).edit().remove(K_TAP_SINCE).apply()
    }

    fun facts(ctx: Context, nowMs: Long = System.currentTimeMillis()): ManagerHealthReport.Facts {
        val p = prefs(ctx)
        val permission: Boolean? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.packageManager.canRequestPackageInstalls() else null
        } catch (_: Exception) { null }
        val quarantined = try { QuarantineList.all(ctx) } catch (_: Exception) { emptyList() }
        return ManagerHealthReport.Facts(
            nowMs = nowMs,
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            watchdogTickAtMs = p.getLong(K_TICK, 0L),
            watchdogStartedAtMs = p.getLong(K_STARTED, 0L),
            relaunchTotal = p.getInt(K_TOTAL, 0),
            recent = ManagerHealthReport.decode(p.getString(K_RECENT, null)),
            rollbackAtMs = p.getLong(K_ROLLBACK_AT, 0L),
            rollbackVersionCode = p.getInt(K_ROLLBACK_VC, 0),
            quarantined = quarantined,
            installPermission = permission,
            installTapPendingSinceMs = p.getLong(K_TAP_SINCE, 0L),
        )
    }

    fun snapshotJson(ctx: Context): String = ManagerHealthReport.toJson(facts(ctx)).toString()
}
