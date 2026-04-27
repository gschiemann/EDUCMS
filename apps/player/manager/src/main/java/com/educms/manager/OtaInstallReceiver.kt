package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/**
 * Catches the PackageInstaller.Session result for OTA installs
 * fired by OtaInstaller.
 *
 * Possible outcomes:
 *   STATUS_SUCCESS              — install landed; new Player APK
 *                                 ready, will boot itself in moments
 *   STATUS_FAILURE_*            — install rejected (signature
 *                                 mismatch, storage full, malformed
 *                                 APK, etc.). Phase 2 triggers
 *                                 rollback here.
 *   STATUS_PENDING_USER_ACTION  — Manager isn't device owner; system
 *                                 needs the operator to tap "Install"
 *                                 on a system prompt. We launch the
 *                                 prompt activity; on unattended
 *                                 kiosks this still gets us nowhere
 *                                 but it's the documented fallback.
 *
 * Phase 1: just log every outcome and report state to the API
 * (existing /api/v1/screens/:fp/ota-state endpoint shipped in
 * v1.0.12). Rollback logic comes in Phase 2.
 */
class OtaInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getIntExtra(OtaInstaller.EXTRA_SESSION_ID, -1)
        val targetPackage = intent.getStringExtra(OtaInstaller.EXTRA_TARGET_PACKAGE) ?: "(unknown)"
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        Log.i(
            TAG,
            "install result: sessionId=$sessionId target=$targetPackage status=${statusName(status)} message=$message",
        )

        when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(TAG, "OTA install SUCCESS for $targetPackage — Manager is done; new Player will boot")
                // Phase 2: report INSTALLED state to API + clear
                // any "pending update" flags we tracked locally.
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Fallback path when not provisioned as DEVICE_OWNER.
                // The system needs the operator to tap "Install" on
                // a confirmation prompt; relaunching that prompt is
                // the documented dance.
                @Suppress("DEPRECATION")
                val pendingIntent: Intent? = intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (pendingIntent != null) {
                    pendingIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    try {
                        context.startActivity(pendingIntent)
                        Log.i(TAG, "launched system Install prompt (kiosk needs DEVICE_OWNER for silent install)")
                    } catch (e: Exception) {
                        Log.e(TAG, "could not launch install prompt: ${e.message}", e)
                    }
                } else {
                    Log.w(TAG, "STATUS_PENDING_USER_ACTION but no EXTRA_INTENT — install stalled")
                }
            }
            else -> {
                Log.e(TAG, "OTA install FAILED: ${statusName(status)} — $message")
                // Phase 2: report ERROR state to API + trigger
                // rollback logic if we already removed the previous
                // APK from disk.
            }
        }
    }

    private fun statusName(status: Int): String = when (status) {
        PackageInstaller.STATUS_SUCCESS -> "SUCCESS"
        PackageInstaller.STATUS_FAILURE -> "FAILURE"
        PackageInstaller.STATUS_FAILURE_ABORTED -> "FAILURE_ABORTED"
        PackageInstaller.STATUS_FAILURE_BLOCKED -> "FAILURE_BLOCKED"
        PackageInstaller.STATUS_FAILURE_CONFLICT -> "FAILURE_CONFLICT"
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "FAILURE_INCOMPATIBLE (signature mismatch?)"
        PackageInstaller.STATUS_FAILURE_INVALID -> "FAILURE_INVALID"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "FAILURE_STORAGE"
        PackageInstaller.STATUS_PENDING_USER_ACTION -> "PENDING_USER_ACTION"
        else -> "UNKNOWN($status)"
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
    }
}
