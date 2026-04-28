package com.educms.manager

import android.content.Context
import android.content.pm.PackageManager
import java.io.File

/**
 * SharedPreferences-backed install state for ManagerSelfUpdateWorker.
 *
 * Why this exists (Plan agent 2026-04-28 punch list — P0-B):
 *   When the worker calls OtaInstaller.installApk to install a new
 *   Manager APK over itself, the OS may kill the worker process
 *   between commit() and Result.success(). WorkManager records the
 *   run as "stopped — never returned a result" and re-enqueues from
 *   scratch. With no breadcrumb on disk that "we attempted vc=N",
 *   the next periodic tick re-downloads + re-attempts the same
 *   install, forever. Bandwidth + battery + flash wear, with zero
 *   visibility from the dashboard.
 *
 * Lifecycle:
 *   1. Worker decides to install vc=N → markInstallInFlight(N)
 *   2. installApk commits, OS kills process
 *   3. New Manager APK boots → MY_PACKAGE_REPLACED fires →
 *      PackageReplacedReceiver clears the marker
 *   4. New Manager's first periodic tick: getInstallInFlight() returns
 *      null (cleared above), worker proceeds normally with version
 *      check
 *
 * Failure recovery:
 *   If MY_PACKAGE_REPLACED never fires (broadcast dropped on bad ROM,
 *   install failed silently), markInstallInFlight stays set across
 *   restarts. The next worker run sees the in-flight marker and:
 *     - If installed version >= marker, the install secretly succeeded
 *       — clear the marker and proceed.
 *     - If installed version < marker, install genuinely failed —
 *       wait STALE_MS and clear so we don't loop forever, OR retry
 *       once if marker is fresh. Decision: clear after 4h to break
 *       any pathological loops. The next worker call will re-attempt.
 */
object InstallTracker {
    private const val PREFS = "edu-cms-manager-install"
    private const val KEY_PENDING_VC = "pending_install_vc"
    private const val KEY_PENDING_AT = "pending_install_at"
    private const val STALE_MS = 4L * 60L * 60L * 1000L  // 4 hours

    /**
     * Record that we're about to install vc=[targetVc] over self.
     * Stamped with current time so [isStale] can detect a never-
     * confirmed install and free up the path.
     */
    fun markInstallInFlight(ctx: Context, targetVc: Int) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit()
            .putInt(KEY_PENDING_VC, targetVc)
            .putLong(KEY_PENDING_AT, System.currentTimeMillis())
            .apply()
    }

    /**
     * Returns the in-flight target versionCode, or null if no install
     * is pending. Auto-clears stale (>4h) entries so a one-time
     * silent failure doesn't permanently block future installs.
     */
    fun getPendingVc(ctx: Context): Int? {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val vc = prefs.getInt(KEY_PENDING_VC, 0)
        if (vc <= 0) return null
        val at = prefs.getLong(KEY_PENDING_AT, 0L)
        if (System.currentTimeMillis() - at > STALE_MS) {
            clearPending(ctx)
            return null
        }
        return vc
    }

    /** Clear the pending marker — called from PackageReplacedReceiver. */
    fun clearPending(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_PENDING_VC)
            .remove(KEY_PENDING_AT)
            .apply()
    }

    /**
     * Read the package id declared inside an APK file.
     *
     * Why (Plan + Kotlin agents — P0-C / P1-2): OtaInstaller.installApk
     * pins setAppPackageName() to the caller-supplied target package.
     * The caller used to pass BuildConfig.PLAYER_PACKAGE (a hardcoded
     * "com.educms.player") or applicationContext.packageName. Both
     * paths break for debug variants where the actual APK declares
     * "com.educms.player.debug" / "com.educms.manager.debug" — and
     * any release/debug crossover (debug Manager downloading a
     * release Player APK from CI). PackageInstaller refuses the
     * install with STATUS_FAILURE_INVALID.
     *
     * Fix: read the package id directly out of the APK file's manifest
     * via PackageManager.getPackageArchiveInfo(). Whatever is declared
     * inside the APK is what we hand to setAppPackageName(); they
     * always agree by construction.
     */
    @Suppress("DEPRECATION")
    fun readApkPackageId(ctx: Context, apk: File): String? {
        return try {
            val info = ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
            info?.packageName
        } catch (_: Exception) {
            null
        }
    }
}
