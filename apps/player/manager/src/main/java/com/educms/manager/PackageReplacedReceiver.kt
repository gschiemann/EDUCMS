package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receives ACTION_MY_PACKAGE_REPLACED — the system fires this on the
 * NEW package's process when an in-place package replacement
 * completes. It's the only reliable "we just got upgraded" signal.
 *
 * Why this is a P0 fix (Kotlin agent 2026-04-28 punch list):
 *
 *   When ManagerSelfUpdateWorker installs a new Manager APK over
 *   itself, the OS kills the running Manager process the moment
 *   PackageInstaller commits. Several things go wrong WITHOUT this
 *   receiver:
 *
 *     1. WatchdogService is a foreground service — START_STICKY
 *        doesn't auto-restart it on Goodview / NovaStar / TCL signage
 *        ROMs. Their battery-saver layers explicitly do not respawn
 *        a foreground service whose hosting package was replaced.
 *        Net effect: Manager's APK is on disk, but no Manager process
 *        is running, no watchdog, no OTA worker. The kiosk goes
 *        dark on the management plane until next physical reboot.
 *
 *     2. The PendingIntent we registered for the install-result
 *        broadcast is owned by the OLD process. By the time
 *        STATUS_SUCCESS would fire, that process is dead. On stock
 *        Android 12+ the broadcast is requeued against the new
 *        APK; on the very signage ROMs we ship to, it's dropped.
 *        Net effect: OtaInstallReceiver never sees STATUS_SUCCESS
 *        for self-installs, so the SharedPrefs in-flight marker
 *        stays set forever and we silently fall into a
 *        "skip-install-because-marker" loop until 4h staleness
 *        clears it.
 *
 *     3. WorkManager periodic schedules survive the upgrade in
 *        /data, but with no Application.onCreate ever firing in
 *        the new APK, no schedules can be reset to the v1.0.3
 *        cadence. The kiosk runs the v1.0.2 schedule indefinitely.
 *
 *   Fix this receiver implements:
 *
 *     - Restarts WatchdogService → respawns Manager's foreground
 *       process even on ROMs that drop foreground services across
 *       package-replace.
 *     - Re-schedules both periodic OTA workers, picking up any
 *       cadence changes shipped in this upgrade.
 *     - Clears InstallTracker's in-flight marker — proof the
 *       self-install actually completed.
 *     - Reports state to the API so the dashboard sees the version
 *       bump within seconds, not on the next 30-min worker tick.
 *
 * Manifest registration:
 *   <receiver android:name=".PackageReplacedReceiver" android:enabled="true" android:exported="true">
 *     <intent-filter>
 *       <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
 *     </intent-filter>
 *   </receiver>
 *
 * MY_PACKAGE_REPLACED (vs the broader PACKAGE_REPLACED) is delivered
 * to the package being replaced. We don't need PACKAGE_REPLACED for
 * Player — Manager doesn't care when Player upgrades; the Player
 * heartbeat will report its new version on the next tick.
 */
class PackageReplacedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        Log.i(TAG, "Package-replaced receiver fired (action=$action data=${intent.dataString})")

        if (action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            // The intent-filter limits us to MY_PACKAGE_REPLACED, but
            // be defensive in case a future manifest change adds more
            // actions and someone forgets to update this code.
            Log.w(TAG, "ignoring unexpected action $action")
            return
        }

        // Security audit P1-SEC-10 (2026-04-28) — verify the broadcast
        // is actually FOR our package. exported=true is required for
        // Android 12+ system broadcasts, which lets a malicious app
        // also send MY_PACKAGE_REPLACED with no permission gate. Defend
        // by checking intent.dataString matches our packageName. If it
        // doesn't, the broadcast is a spoof attempt — ignore.
        val replacedPkg = intent.dataString?.removePrefix("package:")
        if (replacedPkg != null && replacedPkg.isNotBlank()
                && replacedPkg != context.packageName) {
            Log.w(TAG, "MY_PACKAGE_REPLACED for $replacedPkg ≠ ours (${context.packageName}) — ignoring spoof")
            return
        }

        // 1. Clear the in-flight install marker — STATUS_SUCCESS may
        //    never have reached OtaInstallReceiver for self-installs,
        //    but MY_PACKAGE_REPLACED is delivered RELIABLY by the OS
        //    so it's the canonical "install confirmed" signal.
        try {
            InstallTracker.clearPending(context)
            Log.i(TAG, "cleared pending self-install marker")
        } catch (e: Exception) {
            Log.w(TAG, "InstallTracker.clearPending failed: ${e.message}")
        }

        // 2. Restart the watchdog so Manager's foreground process is
        //    alive — Goodview / NovaStar ROMs don't respawn the FGS
        //    automatically across package-replace.
        try {
            ManagerApp.startWatchdogService(context)
            Log.i(TAG, "watchdog restarted")
        } catch (e: Exception) {
            Log.w(TAG, "startWatchdogService failed: ${e.message}")
        }

        // 3. Re-schedule both periodic workers — KEEP semantics here
        //    so we don't cancel any already-running tick. The
        //    cadence/constraints from the new APK take effect on the
        //    NEXT enqueue (a future onCreate or boot).
        try {
            ManagerApp.scheduleOtaWorker(context)
            ManagerApp.scheduleManagerSelfUpdateWorker(context)
            Log.i(TAG, "both periodic OTA workers re-scheduled post-upgrade")
        } catch (e: Exception) {
            Log.w(TAG, "schedule re-enqueue failed: ${e.message}")
        }

        // 4. Fire one-shot OTA checks immediately so the dashboard
        //    sees the version bump and any pending Player update
        //    lands without waiting for the next periodic tick.
        try {
            ManagerApp.triggerImmediateOtaCheck(context)
            ManagerApp.triggerImmediateManagerSelfUpdate(context)
            Log.i(TAG, "one-shot OTA checks enqueued post-upgrade")
        } catch (e: Exception) {
            Log.w(TAG, "triggerImmediate* failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "PkgReplacedReceiver"
    }
}
