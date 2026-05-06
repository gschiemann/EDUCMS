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
    fun installApk(
        ctx: Context,
        apkFile: File,
        targetPackage: String,
        pendingNewVc: Int? = null,
        pendingPrevVc: Int? = null,
    ) {
        if (!apkFile.exists() || apkFile.length() == 0L) {
            Log.e(TAG, "APK file missing or empty: ${apkFile.absolutePath}")
            return
        }

        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        // Pin the target package so a session can't be redirected
        // to install something else.
        params.setAppPackageName(targetPackage)

        // Silent install (v1.0.16): try USER_ACTION_NOT_REQUIRED on
        // every API 31+ install — not just DEVICE_OWNER. The system
        // honors USER_ACTION_NOT_REQUIRED when:
        //   (a) the caller is DEVICE_OWNER, OR
        //   (b) the caller holds UPDATE_PACKAGES_WITHOUT_USER_ACTION
        //       AND is the installer-of-record for the target package.
        // Manager v1.0.7+ declares UPDATE_PACKAGES_WITHOUT_USER_ACTION.
        // If Manager bootstrapped Player initially (or a future
        // re-install routes through Manager), case (b) gives us
        // silent install on plain Android 12+ kiosks WITHOUT the ADB
        // DEVICE_OWNER provisioning step that's blocked operators
        // from getting silent OTAs.
        // If neither (a) nor (b) applies, the system FALLS BACK to
        // STATUS_PENDING_USER_ACTION (notification path) — same
        // behavior as the previous code, no regression.
        // The API-31 symbol stays isolated in Api31SilentInstall
        // (@RequiresApi(31) object) so Android 11 ART never resolves
        // setRequireUserAction at class-load time — that was the
        // v1.0.4 VerifyError crash.
        val isDeviceOwner = AdminReceiver.isDeviceOwner(ctx)
        val installerOfRecord: String? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ctx.packageManager.getInstallSourceInfo(targetPackage).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                ctx.packageManager.getInstallerPackageName(targetPackage)
            }
        } catch (_: Exception) { null }
        val weAreInstaller = installerOfRecord == ctx.packageName
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Always try — no gate. If the system rejects the silent
            // hint, it just falls back to user-confirmation. Net win:
            // silent install when eligible, no regression when not.
            Api31SilentInstall.configure(params)
            Log.i(
                TAG,
                "Silent install hint applied (API ${Build.VERSION.SDK_INT}, " +
                "deviceOwner=$isDeviceOwner installerOfRecord=$installerOfRecord " +
                "weAreInstaller=$weAreInstaller) — system will silent-install if " +
                "eligible, fall back to user-action prompt otherwise"
            )
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
                    if (pendingNewVc != null) putExtra(EXTRA_PENDING_NEW_VC, pendingNewVc)
                    if (pendingPrevVc != null) putExtra(EXTRA_PENDING_PREV_VC, pendingPrevVc)
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
    const val EXTRA_PENDING_NEW_VC = "pendingNewVc"
    const val EXTRA_PENDING_PREV_VC = "pendingPrevVc"

    /**
     * Discover which Player variant is actually installed on this device.
     *
     * Manager's [BuildConfig.PLAYER_PACKAGE] is the production id
     * ("com.educms.player"). Debug Manager builds manage debug Player builds
     * whose package id is "com.educms.player.debug". This helper checks both
     * and returns whichever is installed. If both are somehow present (unusual),
     * production wins because it is tried first.
     *
     * Returns null if neither variant is installed — caller should handle
     * gracefully (bootstrap scenario or Player was uninstalled).
     */
    fun pickInstalledPlayerPackage(pm: android.content.pm.PackageManager): String? {
        val candidates = listOf(BuildConfig.PLAYER_PACKAGE, "${BuildConfig.PLAYER_PACKAGE}.debug")
        for (pkg in candidates) {
            try {
                pm.getPackageInfo(pkg, 0)
                return pkg
            } catch (_: android.content.pm.PackageManager.NameNotFoundException) { /* try next */ }
        }
        return null
    }
}
