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
                Log.i(TAG, "OTA install SUCCESS for $targetPackage — relaunching")
                // 2026-04-28 — operator: 'i hit yes and it then closed
                // the app and ttok me to the android app screen, never
                // relanched the app... what you built was a fucking
                // piece of shit and would have never worked'.
                //
                // Cause: Android's PackageInstaller does NOT auto-launch
                // the freshly-installed app. After a successful install,
                // the foreground activity (the Install prompt or the
                // installer process) finishes, and the system returns
                // the user to whatever was below — usually the home
                // launcher. Cinematic fail for kiosk UX.
                //
                // Fix: launch the target package's main activity here.
                // Skip self-installs (we just installed Manager onto
                // ourselves; the OS will have killed our process and
                // restarted us via the foreground service — we don't
                // need to launch anything).
                if (targetPackage != context.packageName) {
                    relaunchPackage(context, targetPackage)
                }
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

    /**
     * Launch the freshly-installed package's main activity. Used
     * after STATUS_SUCCESS so the kiosk wakes back up to running
     * Player instead of getting stranded on the OEM home launcher.
     *
     * Tries production then debug variant, since Manager handles
     * both com.educms.player and com.educms.player.debug.
     */
    private fun relaunchPackage(ctx: Context, pkg: String) {
        val candidates = listOf(pkg, "$pkg.debug")
        for (candidate in candidates) {
            try {
                val launch = ctx.packageManager.getLaunchIntentForPackage(candidate)
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    ctx.startActivity(launch)
                    Log.i(TAG, "relaunched $candidate after successful install")
                    return
                }
            } catch (e: Exception) {
                Log.w(TAG, "relaunch $candidate failed: ${e.message}")
            }
        }
        Log.w(TAG, "no launch intent found for $pkg or $pkg.debug — kiosk stays on home")
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
