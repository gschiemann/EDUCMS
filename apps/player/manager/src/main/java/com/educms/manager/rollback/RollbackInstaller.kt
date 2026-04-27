package com.educms.manager.rollback

import android.content.Context
import android.util.Log
import com.educms.manager.BuildConfig
import com.educms.manager.OtaInstaller

/**
 * Coordinates the rollback when a fresh install fails first-boot.
 *
 * Trigger: WatchdogService notices that pendingVc was set, the
 * grace window expired, and Player has missed all heartbeats since
 * the install committed. That's "Player is dead post-install."
 *
 * Action:
 *   1. Add the bad versionCode to QuarantineList so OtaWorker
 *      doesn't re-download it on the next periodic check.
 *   2. Look up the previous-good APK in ApkArchive (saved by
 *      OtaWorker before commit).
 *   3. PackageInstaller install that previous APK on top of the
 *      broken one. For debug builds (which is what we ship today)
 *      the installed package has android:debuggable=true implicitly,
 *      so PackageInstaller allows downgrade without special flags.
 *      For release builds we'd need to use device-owner-only
 *      `DevicePolicyManager.installSystemUpdate` or uninstall+
 *      install (loses pairing). Phase 2.5 problem.
 *   4. Clear pending install state so Watchdog stops trying to
 *      rollback the same broken install in a loop.
 *
 * Best-effort throughout — if any step fails (no archive, install
 * fails, etc.) we log and bail. The kiosk is in a degraded state
 * but Manager itself stays alive.
 */
object RollbackInstaller {
    private const val TAG = "RollbackInstaller"

    /**
     * Attempt to roll the Player back to [previousVc]. Returns true
     * if the install was at least committed (not whether it boots —
     * that's the next first-boot watchdog cycle).
     */
    fun rollback(ctx: Context, badVc: Int, previousVc: Int, reason: String): Boolean {
        Log.w(TAG, "ROLLBACK initiated: bad=$badVc → restoring=$previousVc reason=\"${reason.take(120)}\"")

        // Add to quarantine FIRST. If the rollback install itself
        // somehow fails, we still want OtaWorker to refuse to
        // re-download badVc on its next periodic tick.
        QuarantineList.add(ctx, badVc, reason)

        if (previousVc <= 0) {
            Log.e(TAG, "rollback aborted — no previous version recorded (first-ever Manager install?)")
            // Clear pending so we don't loop forever.
            InstallState.clearPending(ctx)
            return false
        }
        val archived = ApkArchive.get(ctx, previousVc)
        if (archived == null) {
            Log.e(TAG, "rollback aborted — no archived APK for vc=$previousVc")
            InstallState.clearPending(ctx)
            return false
        }
        Log.i(TAG, "reinstalling archived APK: ${archived.absolutePath} (${archived.length()}b)")

        // Reuse OtaInstaller for the actual commit. PackageInstaller
        // sees a same-package install request with a (potentially
        // older) versionCode. Debug builds allow downgrade
        // automatically; release builds will fail here on Android
        // versions that don't allow it without device-owner help.
        OtaInstaller.installApk(ctx, archived, BuildConfig.PLAYER_PACKAGE)

        // Clear pending state. Even if the install above didn't
        // succeed, we don't want WatchdogService re-firing the same
        // rollback every tick.
        InstallState.clearPending(ctx)
        return true
    }
}
