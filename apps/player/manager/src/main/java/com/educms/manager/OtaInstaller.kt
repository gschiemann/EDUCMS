package com.educms.manager

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Silent OTA installer. Runs after the OtaWorker (Phase 1.5) has
 * downloaded + verified an APK to disk. This class just hands the
 * file to PackageInstaller.Session and commits.
 *
 * If Manager is provisioned as DEVICE_OWNER, Android grants the
 * commit() call INSTALL_PACKAGES authority silently — no prompt,
 * no user tap. That's the entire reason this class exists.
 *
 * If Manager is NOT device owner (eg early test deploys before
 * provisioning lands on every kiosk), commit() falls back to the
 * standard "Install / Cancel" prompt. Same as today's Player-only
 * flow; degraded but not broken.
 *
 * The install result lands in OtaInstallReceiver via the
 * IntentSender we provide here.
 */
object OtaInstaller {

    private const val TAG = "OtaInstaller"

    /**
     * Install the APK at [apkFile]. The caller is expected to have
     * verified SHA-256 already; we don't second-guess at this layer.
     *
     * [targetPackage] must match the APK's declared package id.
     * PackageInstaller will reject any mismatch (defends against
     * an attacker swapping a malicious APK into the staging dir).
     */
    fun installApk(ctx: Context, apkFile: File, targetPackage: String) {
        if (!apkFile.exists() || apkFile.length() == 0L) {
            Log.e(TAG, "APK file missing or empty: ${apkFile.absolutePath}")
            return
        }

        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        // Pin the target package so a session can't be redirected
        // to install something else.
        params.setAppPackageName(targetPackage)

        // Silent install: on API 31+ (Android 12+) DEVICE_OWNER kiosks,
        // suppress the "Install / Cancel" prompt entirely. The API-31
        // symbol is isolated in Api31SilentInstall (a @RequiresApi(31)
        // object) so Android 11 ART never resolves setRequireUserAction
        // or USER_ACTION_NOT_REQUIRED at class-load time — this is the
        // fix for the v1.0.4 VerifyError crash on Android 11. The check
        // here is a runtime guard; the class isolation is the ART guard.
        val isDeviceOwner = AdminReceiver.isDeviceOwner(ctx)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && isDeviceOwner) {
            Api31SilentInstall.configure(params)
            Log.i(TAG, "Silent install enabled (API ${Build.VERSION.SDK_INT}, DEVICE_OWNER)")
        }

        val sessionId = try {
            installer.createSession(params)
        } catch (e: Exception) {
            Log.e(TAG, "createSession failed: ${e.message}", e)
            return
        }

        Log.i(TAG, "OTA install starting — sessionId=$sessionId target=$targetPackage deviceOwner=$isDeviceOwner size=${apkFile.length()}b")

        try {
            val session = installer.openSession(sessionId)
            session.use { s ->
                apkFile.inputStream().use { input ->
                    s.openWrite("base.apk", 0, apkFile.length()).use { output ->
                        input.copyTo(output)
                        s.fsync(output)
                    }
                }
                val resultIntent = Intent(ctx, OtaInstallReceiver::class.java).apply {
                    action = ACTION_INSTALL_RESULT
                    putExtra(EXTRA_SESSION_ID, sessionId)
                    putExtra(EXTRA_TARGET_PACKAGE, targetPackage)
                }
                val statusPi = PendingIntent.getBroadcast(
                    ctx,
                    sessionId,
                    resultIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                s.commit(statusPi.intentSender)
            }
            Log.i(TAG, "session committed (sessionId=$sessionId) — awaiting OtaInstallReceiver callback")
        } catch (e: Exception) {
            Log.e(TAG, "install session failed: ${e.message}", e)
            try {
                installer.abandonSession(sessionId)
            } catch (_: Exception) { /* best-effort */ }
        }
    }

    const val ACTION_INSTALL_RESULT = "com.educms.manager.OTA_INSTALL_RESULT"
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_TARGET_PACKAGE = "targetPackage"
}
