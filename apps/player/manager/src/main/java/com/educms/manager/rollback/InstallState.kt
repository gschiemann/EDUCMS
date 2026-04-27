package com.educms.manager.rollback

import android.content.Context

/**
 * Tracks Manager's understanding of the OTA install lifecycle:
 *   - LastKnownGoodVc: the Player versionCode that we've seen
 *     successfully boot + heartbeat. Set after a fresh install's
 *     first heartbeat lands within the grace window.
 *   - PendingVc: if non-zero, an install was just committed for
 *     this versionCode and we're inside the post-install grace
 *     window watching for first-boot health. Cleared on success
 *     OR on rollback.
 *   - PendingAtMs: timestamp the install was committed. Used by
 *     WatchdogService to compute grace-window expiration.
 *   - PendingPrevVc: the versionCode that WAS installed before
 *     the pending one. If rollback fires, this is the target.
 *
 * Stored as plain SharedPreferences keys under "edu_manager_state".
 *
 * Expected lifecycle:
 *   1. OtaWorker calls beginInstall(newVc, prevVc) before commit
 *   2. PackageInstaller commits, Player restarts with newVc
 *   3a. Within grace window, Player heartbeat lands → ManagerApp's
 *       Receiver (or WatchdogService) calls promoteToGood()
 *   3b. Grace window expires with no heartbeat → WatchdogService
 *       calls RollbackInstaller.rollback() which uses pendingPrevVc
 */
object InstallState {
    private const val PREFS = "edu_manager_state"

    private const val KEY_LAST_KNOWN_GOOD_VC = "last_known_good_vc"
    private const val KEY_PENDING_VC = "pending_install_vc"
    private const val KEY_PENDING_AT_MS = "pending_install_at_ms"
    private const val KEY_PENDING_PREV_VC = "pending_install_prev_vc"

    /** 90 seconds — heartbeat cadence is 30s; 3 missed heartbeats = bad. */
    const val GRACE_WINDOW_MS = 90_000L

    fun beginInstall(ctx: Context, newVc: Int, prevVc: Int) {
        prefs(ctx).edit()
            .putInt(KEY_PENDING_VC, newVc)
            .putLong(KEY_PENDING_AT_MS, System.currentTimeMillis())
            .putInt(KEY_PENDING_PREV_VC, prevVc)
            .apply()
    }

    fun promoteToGood(ctx: Context, vc: Int) {
        prefs(ctx).edit()
            .putInt(KEY_LAST_KNOWN_GOOD_VC, vc)
            .remove(KEY_PENDING_VC)
            .remove(KEY_PENDING_AT_MS)
            .remove(KEY_PENDING_PREV_VC)
            .apply()
    }

    fun clearPending(ctx: Context) {
        prefs(ctx).edit()
            .remove(KEY_PENDING_VC)
            .remove(KEY_PENDING_AT_MS)
            .remove(KEY_PENDING_PREV_VC)
            .apply()
    }

    fun pendingVc(ctx: Context): Int = prefs(ctx).getInt(KEY_PENDING_VC, 0)
    fun pendingAtMs(ctx: Context): Long = prefs(ctx).getLong(KEY_PENDING_AT_MS, 0L)
    fun pendingPrevVc(ctx: Context): Int = prefs(ctx).getInt(KEY_PENDING_PREV_VC, 0)
    fun lastKnownGoodVc(ctx: Context): Int = prefs(ctx).getInt(KEY_LAST_KNOWN_GOOD_VC, 0)

    fun isInGraceWindow(ctx: Context, now: Long = System.currentTimeMillis()): Boolean {
        val at = pendingAtMs(ctx)
        if (at == 0L) return false
        return (now - at) < GRACE_WINDOW_MS
    }

    /** True iff we have a pending install AND grace window has expired. */
    fun isPendingExpired(ctx: Context, now: Long = System.currentTimeMillis()): Boolean {
        val at = pendingAtMs(ctx)
        if (at == 0L) return false
        return (now - at) >= GRACE_WINDOW_MS
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
