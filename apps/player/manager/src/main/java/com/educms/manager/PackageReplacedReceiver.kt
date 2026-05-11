package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receives ACTION_MY_PACKAGE_REPLACED (Manager upgraded itself) AND
 * ACTION_PACKAGE_REPLACED for com.educms.player / com.educms.player.debug
 * (Player upgraded via OtaUpdateWorker → PackageInstaller).
 *
 * Why two actions?
 *
 *   MY_PACKAGE_REPLACED is the reliable self-upgrade signal for Manager.
 *   When Player installs itself via OtaInstaller, the OtaInstallReceiver
 *   STATUS_SUCCESS handler fires a relaunch attempt — BUT that handler
 *   runs in the OLD process that is about to die. On Goodview / NovaStar
 *   signage ROMs that don't requeue the PendingIntent after package
 *   replacement, STATUS_SUCCESS is either dropped or arrives after the
 *   process is dead. Result: install succeeded, Player closed, kiosk
 *   stranded on the launcher.
 *
 *   PACKAGE_REPLACED (the system-wide variant) is fired at every
 *   registered receiver for the whole device when ANY package replaces
 *   itself. Manager is a persistent DEVICE_OWNER process with no
 *   activity being killed; it reliably receives this broadcast even
 *   after Player's old process dies. Manager then calls relaunchPackage()
 *   on Player using the same retry-with-backoff logic that already lives
 *   in OtaInstallReceiver — so the two paths share identical relaunch
 *   semantics.
 *
 * Security: PACKAGE_REPLACED fires for ALL packages on the device (OS
 * itself, system apps, third-party apps). We filter by
 * intent.dataString (scheme-specific part) immediately; anything that
 * isn't our own package or Player's known package ids is silently
 * ignored. The broadcast has no permission gate by design (system
 * protected broadcast), so spoofing it is blocked at the ART level.
 *
 * Manager self-upgrade behavior (MY_PACKAGE_REPLACED path) is unchanged.
 *
 * Why this is a P0 fix (operator report 2026-04-29):
 *
 *   "i clixcked install and it closed the app and never launched it...
 *    i mabually launched"
 *
 *   The OTA chain (server → WS → worker → install dialog → tap →
 *   install) worked; the post-install relaunch was broken. This fix
 *   ensures Manager observes Player's package-replace event and
 *   launches Player even when Player's own process is dead.
 */
class PackageReplacedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val replacedPkg = intent.dataString?.removePrefix("package:") ?: ""
        Log.i(TAG, "Package-replaced receiver fired (action=$action pkg=$replacedPkg)")

        when (action) {
            Intent.ACTION_MY_PACKAGE_REPLACED -> handleManagerReplaced(context)
            Intent.ACTION_PACKAGE_REPLACED -> handlePackageReplaced(context, replacedPkg)
            else -> Log.w(TAG, "ignoring unexpected action $action")
        }
    }

    // ── Manager self-replaced ─────────────────────────────────────────

    private fun handleManagerReplaced(context: Context) {
        // Security audit P1-SEC-10 (2026-04-28) — MY_PACKAGE_REPLACED
        // is always for our own package so no data-string check needed.

        // 1. Clear the in-flight install marker.
        try {
            InstallTracker.clearPending(context)
            Log.i(TAG, "cleared pending self-install marker")
        } catch (e: Exception) {
            Log.w(TAG, "InstallTracker.clearPending failed: ${e.message}")
        }

        // 2. Restart the watchdog — Goodview/NovaStar ROMs don't
        //    respawn FGS automatically across package-replace.
        try {
            ManagerApp.startWatchdogService(context)
            Log.i(TAG, "watchdog restarted")
        } catch (e: Exception) {
            Log.w(TAG, "startWatchdogService failed: ${e.message}")
        }

        // 3. Re-schedule both periodic workers with the new cadence.
        try {
            ManagerApp.scheduleOtaWorker(context)
            ManagerApp.scheduleManagerSelfUpdateWorker(context)
            Log.i(TAG, "both periodic OTA workers re-scheduled post-upgrade")
        } catch (e: Exception) {
            Log.w(TAG, "schedule re-enqueue failed: ${e.message}")
        }

        // 4. Fire one-shot OTA checks so the dashboard sees the bump.
        try {
            ManagerApp.triggerImmediateOtaCheck(context)
            ManagerApp.triggerImmediateManagerSelfUpdate(context)
            Log.i(TAG, "one-shot OTA checks enqueued post-upgrade")
        } catch (e: Exception) {
            Log.w(TAG, "triggerImmediate* failed: ${e.message}")
        }
    }

    // ── Another package (Player) replaced ────────────────────────────

    private fun handlePackageReplaced(context: Context, pkg: String) {
        // Filter: only care about Player's known package ids.
        if (pkg != PLAYER_PKG && pkg != PLAYER_DEBUG_PKG) {
            // Silently ignore — this fires for every package on the device.
            return
        }
        Log.i(TAG, "Player package replaced ($pkg) — relaunching via Manager")
        val pending = goAsync()
        Thread {
            try {
                relaunchPackage(context, pkg)
            } finally {
                pending.finish()
            }
        }.start()
    }

    /**
     * Launch the freshly-installed Player's main activity. Tries the
     * exact package that was replaced first, then the alternate variant,
     * with up to 6 attempts / 1s backoff (≤7s) to allow PackageManager
     * registration to complete on slow Goodview SoCs.
     *
     * 2026-05-12 (Manager v1.0.18) — Android 14+ BAL fix.
     *
     * Operator on stock Android 14 emulator (which matches the OS
     * version on The Den): post-install relaunch failed because
     * Android 14 tightened Background Activity Launch rules — FGS no
     * longer auto-grants BAL. The system logged:
     *
     *   ActivityTaskManager: Background activity launch blocked
     *     callingPackage: com.educms.manager.debug
     *     callingUidProcState: FOREGROUND_SERVICE
     *     backgroundStartPrivileges:
     *       allowsBackgroundActivityStarts=false
     *
     * Fix: route the activity start through a PendingIntent with
     * ActivityOptions.setPendingIntentBackgroundActivityStartMode
     * (MODE_BACKGROUND_ACTIVITY_START_ALLOWED). On API 34+ this is
     * the documented way for a non-foregrounded caller to start an
     * activity. On older APIs the legacy direct startActivity is
     * the right pattern; we keep that path for API < 34.
     */
    private fun relaunchPackage(ctx: Context, pkg: String) {
        val candidates = listOf(pkg, if (pkg.endsWith(".debug")) pkg.removeSuffix(".debug") else "$pkg.debug")
        for (attempt in 0..5) {
            for (candidate in candidates) {
                try {
                    val launch = ctx.packageManager.getLaunchIntentForPackage(candidate)
                    if (launch != null) {
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                            // API 34+: PendingIntent + ActivityOptions with
                            // BAL grant. Required as of Android 14 because
                            // FGS no longer auto-grants BAL.
                            Api34BalLauncher.launchAllowingBackgroundStart(ctx, launch)
                        } else {
                            ctx.startActivity(launch)
                        }
                        Log.i(TAG, "relaunched $candidate after Player install (attempt=$attempt)")
                        return
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "relaunch $candidate attempt=$attempt: ${e.message}")
                }
            }
            try { Thread.sleep(1000) } catch (_: InterruptedException) { /* swallow */ }
        }
        Log.w(TAG, "all relaunch attempts failed for $pkg — kiosk stranded, watchdog will recover")
    }

    companion object {
        private const val TAG = "PkgReplacedReceiver"
        private const val PLAYER_PKG = "com.educms.player"
        private const val PLAYER_DEBUG_PKG = "com.educms.player.debug"
    }
}
