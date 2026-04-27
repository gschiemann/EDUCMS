package com.educms.manager

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * DeviceAdminReceiver — required ceremony for Android device-admin
 * APIs. Manager becomes "device admin" via either:
 *
 *   1. User toggle in Settings → Device admin apps (won't grant
 *      DEVICE_OWNER, only the lighter device-admin role; not what
 *      we want)
 *   2. ADB: `adb shell dpm set-device-owner com.educms.manager/.AdminReceiver`
 *      run on a device that has NO existing accounts. This grants
 *      true DEVICE_OWNER status — same powers Apple-MDM-style apps
 *      use to silently install profiles.
 *
 * (2) is the path we ship. It requires a freshly-factory-reset
 * device (or a never-set-up one) because Android refuses to set a
 * device owner once any user account or DPM-managed setup has
 * happened.
 *
 * Once we ARE device owner, we can:
 *   - Install APKs silently (PackageInstaller fires no UI prompt)
 *   - Lock the kiosk to a single app (`setLockTaskPackages`)
 *   - Disable "Install unknown apps" toggling
 *   - Suppress system update banners
 *   - Prevent uninstall of Manager itself
 *
 * We DO NOT exercise the destructive admin powers (lock/wipe) —
 * those are declared in xml/device_admin.xml only because the
 * device-admin contract requires SOMETHING in <uses-policies>.
 * Code-wise this class never calls dpm.lockNow() or dpm.wipeData().
 */
class AdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        val isDeviceOwner = isDeviceOwner(context)
        Log.i(TAG, "AdminReceiver enabled — deviceOwner=$isDeviceOwner")

        // Whenever admin is enabled (initial provisioning OR user
        // toggle from Settings), make sure WatchdogService is alive.
        // The receiver runs in our process so onEnabled is a fine
        // place to kick the service.
        ManagerApp.startWatchdogService(context)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "AdminReceiver disabled — Manager has lost device-admin role")
    }

    companion object {
        private const val TAG = "AdminReceiver"

        /**
         * Returns the ComponentName Android needs whenever calling
         * a DevicePolicyManager API (eg dpm.setLockTaskPackages,
         * dpm.installPackage). Pinned here so callers don't have to
         * remember the receiver's class.
         */
        fun componentName(ctx: Context): ComponentName =
            ComponentName(ctx, AdminReceiver::class.java)

        /**
         * True iff Manager is provisioned as DEVICE_OWNER. When
         * false, OTA installs fall back to the "system Install
         * prompt" path (same behavior as today's Player-only flow);
         * the prompt blocks unattended kiosks but at least nothing
         * crashes.
         */
        fun isDeviceOwner(ctx: Context): Boolean {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                ?: return false
            return try {
                dpm.isDeviceOwnerApp(ctx.packageName)
            } catch (e: Exception) {
                Log.w(TAG, "isDeviceOwnerApp threw: ${e.message}")
                false
            }
        }
    }
}
