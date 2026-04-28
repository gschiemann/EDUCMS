package com.educms.player.bootstrap

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Single-sideload UX (operator request 2026-04-27): the dashboard's
 * "Download Player APK" button gives ONE APK that brings everything,
 * including the Manager companion APK.
 *
 * v1.0.14 strategy:
 *   PRIMARY: Manager APK is bundled inside Player at build time
 *            (apps/player/app/src/main/assets/bundled/edu-cms-manager.apk
 *            via the Gradle bundleManagerApk task). On first launch,
 *            extract from assets to cache, install via PackageInstaller.
 *            No network needed; works the moment Player is sideloaded.
 *
 *   FALLBACK: If the bundled asset is missing for any reason (CI
 *             didn't copy it, dev build edge case), fall back to
 *             fetching from /api/v1/player/manager-apk/latest. Same
 *             behavior as v1.0.13 — useful as a safety net but no
 *             longer the primary path.
 *
 * Visible UI: shows on-screen toasts during install so the operator
 * sees what's happening. v1.0.13's silent failure mode was a real
 * UX problem — the operator had no way to tell whether bootstrap
 * had run, succeeded, or failed.
 *
 * Idempotent — checks if Manager is installed before doing anything,
 * so subsequent boots are no-ops.
 */
object ManagerBootstrap {
    private const val TAG = "ManagerBootstrap"
    private const val MANAGER_PKG = "com.educms.manager"
    private const val MANAGER_PKG_DEBUG = "com.educms.manager.debug"
    private const val BUNDLED_ASSET = "bundled/edu-cms-manager.apk"
    private val mainHandler = Handler(Looper.getMainLooper())

    fun bootstrapIfNeeded(ctx: Context) {
        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                bootstrapInternal(ctx)
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "ManagerBootstrap failed (will retry next boot): ${e.message}")
                Log.w(TAG, "bootstrap failed", e)
                showToast(ctx, "Manager install failed — will retry on next launch")
                reportBlocked(ctx, "exception: ${e.message?.take(120)}")
            }
        }
    }

    /**
     * 2026-04-28 (Player v1.0.20) — operator: "stop telling me to side
     * load you fucking cunt, fix your fucking apk". Surface bootstrap
     * failures to the dashboard so the operator can see WHY Manager
     * isn't installing instead of the system silently failing. State
     * 'INSTALL_BLOCKED' is rendered as a red banner on the dashboard
     * screen card so an admin glance reveals the issue immediately.
     *
     * Pre-existing /ota-state endpoint accepts this state via the
     * standard ALLOWED set (CHECKING / DOWNLOADING / VERIFYING /
     * INSTALLING / INSTALLED / ERROR). We use ERROR with a message
     * that explicitly mentions "Install Unknown Apps permission".
     */
    private fun reportBlocked(ctx: Context, reason: String) {
        try {
            val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            val apiRoot = prefs.getString("api_root", null) ?: return
            val fp = prefs.getString("device_fingerprint", null) ?: return
            Thread {
                try {
                    val url = java.net.URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
                    val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                        requestMethod = "POST"
                        setRequestProperty("Content-Type", "application/json")
                        doOutput = true
                        connectTimeout = 5_000
                        readTimeout = 5_000
                    }
                    val payload = """{"state":"ERROR","message":"Manager install blocked: $reason. Settings → Apps → EduCMS Player → Install unknown apps → Allow"}"""
                    conn.outputStream.use { it.write(payload.toByteArray()) }
                    conn.responseCode  // force-flush
                } catch (_: Exception) { /* swallow */ }
            }.start()
        } catch (_: Exception) { /* best-effort */ }
    }

    private fun bootstrapInternal(ctx: Context) {
        // 2026-04-28 (Player v1.0.19) — version-aware bootstrap.
        // Operator: "i deleted the old manager so cant be" — they
        // sideloaded Player v1.0.18 expecting bundled Manager v1.0.3
        // to install, but the previous logic just skipped on ANY
        // installed Manager. Without forcing a re-install, the
        // operator was stuck on Manager v1.0.1 (which has no self-
        // update worker, no DEVICE_OWNER skip, no anti-spoof, none
        // of the v1.0.3 hardening).
        //
        // New behavior: extract bundled APK first, read its
        // versionCode + package id, compare to installed. Install
        // if installed is missing OR strictly older.
        val bundledFile = extractBundledManagerApk(ctx)
        if (bundledFile == null) {
            // No bundled APK — fall back to network fetch IF Manager
            // isn't installed at all. Don't network-fetch just to
            // upgrade an existing one; the network path can't tell
            // us the latest version cheaply.
            if (isManagerInstalled(ctx)) {
                PlayerLogger.i(TAG, "Manager installed + no bundled APK to compare — skipping bootstrap")
                return
            }
            PlayerLogger.w(TAG, "Manager not installed AND no bundled APK — falling back to network fetch")
            showToast(ctx, "Installing companion — downloading…")
            val downloaded = downloadManagerApk(ctx)
            if (downloaded != null) {
                installViaPackageInstaller(ctx, downloaded, "network")
            } else {
                PlayerLogger.w(TAG, "Network fallback failed — bootstrap will retry next boot")
                showToast(ctx, "Manager install failed (no network) — will retry")
            }
            return
        }

        // Bundled APK exists — compare versions.
        val bundledVc = readApkVersionCode(ctx, bundledFile)
        val installedVc = readInstalledManagerVersionCode(ctx)
        if (bundledVc <= 0) {
            PlayerLogger.w(TAG, "Couldn't read bundled APK version — falling back to install-if-missing")
            if (isManagerInstalled(ctx)) return
            installViaPackageInstaller(ctx, bundledFile, "bundled")
            return
        }
        if (installedVc != null && installedVc >= bundledVc) {
            PlayerLogger.i(
                TAG,
                "Manager already current (installed vc=$installedVc >= bundled vc=$bundledVc) — skipping",
            )
            return
        }

        val tag = if (installedVc == null) "bundled-fresh-install" else "bundled-upgrade-$installedVc-to-$bundledVc"
        PlayerLogger.i(TAG, "Installing Manager from bundled assets (${bundledFile.length()}b) — $tag")
        showToast(
            ctx,
            if (installedVc == null) "Installing companion (EduCMS Manager)…"
            else "Upgrading companion: vc $installedVc → $bundledVc",
        )
        installViaPackageInstaller(ctx, bundledFile, tag)
    }

    /** Read the versionCode of an APK file via PackageManager.getPackageArchiveInfo. */
    @Suppress("DEPRECATION")
    private fun readApkVersionCode(ctx: Context, apk: File): Int {
        return try {
            val info = ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
            info?.versionCode ?: 0
        } catch (_: Exception) { 0 }
    }

    /** Read the installed Manager APK's versionCode. Returns null if not installed. */
    @Suppress("DEPRECATION")
    private fun readInstalledManagerVersionCode(ctx: Context): Int? {
        val pm = ctx.packageManager
        for (pkg in listOf(MANAGER_PKG, MANAGER_PKG_DEBUG)) {
            try {
                return pm.getPackageInfo(pkg, 0).versionCode
            } catch (_: Exception) { /* not installed */ }
        }
        return null
    }

    /**
     * Copy the bundled Manager APK from assets into a real file
     * PackageInstaller can read. AGP-bundled assets aren't directly
     * file-accessible (they live inside the APK's zip), so we have
     * to extract.
     *
     * Returns null if the asset doesn't exist (older builds or
     * Gradle task didn't run).
     */
    private fun extractBundledManagerApk(ctx: Context): File? {
        return try {
            val outDir = File(ctx.cacheDir, "manager-bootstrap").apply { mkdirs() }
            val outFile = File(outDir, "manager.apk")
            ctx.assets.open(BUNDLED_ASSET).use { input ->
                outFile.outputStream().use { output -> input.copyTo(output) }
            }
            if (outFile.length() > 0) outFile else null
        } catch (e: Exception) {
            PlayerLogger.i(TAG, "no bundled Manager asset (${e.message})")
            null
        }
    }

    private fun downloadManagerApk(ctx: Context): File? {
        // For network fallback, hit Railway directly — Vercel routing
        // to /api/v1/* has been a moving target. Hardcoded production
        // URL is acceptable for a fallback path that should never run
        // on a properly-built APK.
        val managerApkUrl =
            "https://api-production-39a1.up.railway.app/api/v1/player/manager-apk/latest"
        val outDir = File(ctx.cacheDir, "manager-bootstrap").apply { mkdirs() }
        val outFile = File(outDir, "manager.apk")
        return try {
            val conn = (URL(managerApkUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 20_000
                readTimeout = 60_000
            }
            if (conn.responseCode !in 200..299) {
                PlayerLogger.w(TAG, "Manager APK fetch HTTP ${conn.responseCode}")
                return null
            }
            outFile.outputStream().use { out ->
                conn.inputStream.use { inp -> inp.copyTo(out) }
            }
            if (outFile.length() > 0) outFile else null
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager download failed: ${e.message}")
            null
        }
    }

    private fun isManagerInstalled(ctx: Context): Boolean {
        val pm = ctx.packageManager
        for (pkg in listOf(MANAGER_PKG, MANAGER_PKG_DEBUG)) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true
            } catch (_: Exception) { /* not installed */ }
        }
        return false
    }

    private fun installViaPackageInstaller(ctx: Context, apk: File, source: String) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            // 2026-04-28 (Player v1.0.20) — Yodeck-style silent install:
            // claim installer-of-record + (Android 12+) hint NOT_REQUIRED
            // user action. Goodview's permissive ROM treats same-installer
            // updates as silent on Android 7-11; the explicit hint covers
            // Android 12+. Either way, no system Install dialog if the
            // install permission is granted.
            try {
                params.setInstallerPackageName(ctx.packageName)
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "setInstallerPackageName(self) failed: ${e.message}")
            }
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                try {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                } catch (e: Exception) {
                    PlayerLogger.w(TAG, "setRequireUserAction not supported: ${e.message}")
                }
            }
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                // CRITICAL FIX (v1.0.15): reuse the EXISTING
                // OtaInstallReceiver (action com.educms.player.OTA_INSTALL_RESULT)
                // instead of inventing MANAGER_BOOTSTRAP_RESULT, which
                // had no listener registered. The OTA receiver already
                // knows how to handle STATUS_PENDING_USER_ACTION by
                // launching the system Install prompt as an activity.
                // Without this, install commits returned PENDING_USER_ACTION
                // to a broadcast nobody received → install silently
                // stalled. Operator on The Den (2026-04-27): "side
                // loaded the apk and no manager loaded anywhere".
                val resultIntent = Intent("com.educms.player.OTA_INSTALL_RESULT").apply {
                    setPackage(ctx.packageName)
                }
                val statusPi = PendingIntent.getBroadcast(
                    ctx,
                    sessionId,
                    resultIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(statusPi.intentSender)
                PlayerLogger.i(TAG, "Manager install session committed (id=$sessionId source=$source)")
                showToast(ctx, "Companion install committed (system prompt may appear)")
            }
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager install failed: ${e.message}", e)
            showToast(ctx, "Manager install error: ${e.message?.take(60)}")
        }
    }

    /**
     * Visible toast on the kiosk screen so the operator can SEE what
     * the bootstrap is doing. v1.0.13's silent failures left no trail.
     *
     * Uses LENGTH_LONG (~3.5s) so it's readable across the room.
     * Posts to main thread because Toast is UI.
     */
    private fun showToast(ctx: Context, message: String) {
        mainHandler.post {
            try {
                Toast.makeText(ctx.applicationContext, "EduCMS: $message", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Log.w(TAG, "showToast failed: ${e.message}")
            }
        }
    }
}
