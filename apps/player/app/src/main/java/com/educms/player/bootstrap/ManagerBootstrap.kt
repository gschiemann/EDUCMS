package com.educms.player.bootstrap

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
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
 * including the Manager companion APK. Operator sideloads Player as
 * normal; Player on first launch fetches Manager from our API and
 * installs it via PackageInstaller.
 *
 * On signage hardware (Goodview/NovaStar/TCL etc.) that pre-grants
 * INSTALL_PACKAGES or has a permissive vendor installer, the
 * Manager install is silent. On stock AOSP it shows the system
 * "Install" prompt — same UX as the existing OTA install path.
 *
 * Idempotent — Player checks if Manager is already installed before
 * fetching, so subsequent launches are a no-op.
 *
 * Network failure tolerant — if the Manager download fails (no
 * internet at first boot, etc.) we just retry on the next Player
 * boot. No state to corrupt; Manager install is purely additive.
 */
object ManagerBootstrap {
    private const val TAG = "ManagerBootstrap"
    private const val MANAGER_PKG = "com.educms.manager"
    private const val MANAGER_PKG_DEBUG = "com.educms.manager.debug"

    /**
     * Async entry point — fires the bootstrap on a background scope
     * so app startup isn't blocked. Caller doesn't await.
     */
    fun bootstrapIfNeeded(ctx: Context) {
        // Background scope; no need to tie it to any lifecycle —
        // bootstrap is fire-and-forget. SupervisorJob means an
        // exception in here doesn't propagate to other coroutines.
        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                bootstrapInternal(ctx)
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "ManagerBootstrap failed (will retry next boot): ${e.message}")
                Log.w(TAG, "bootstrap failed", e)
            }
        }
    }

    private fun bootstrapInternal(ctx: Context) {
        // Check if Manager is already installed. If yes, nothing to do.
        if (isManagerInstalled(ctx)) {
            PlayerLogger.i(TAG, "Manager already installed — skipping bootstrap")
            return
        }

        PlayerLogger.i(TAG, "Manager not installed — fetching latest from API")

        // Resolve API root same way the heartbeat does (PLAYER_BASE_URL
        // minus /player). The /api/v1/player/manager-apk/latest
        // endpoint redirects to the GitHub Release asset URL.
        val apiRoot = BuildConfig.PLAYER_BASE_URL.trimEnd('/').removeSuffix("/player")
        val managerApkUrl = "$apiRoot/api/v1/player/manager-apk/latest"

        // Download (follows redirects automatically by HttpURLConnection
        // when instructed). The endpoint returns a 302 to GitHub
        // Releases; we follow to the final asset URL.
        val outDir = File(ctx.getExternalFilesDir(null), "bootstrap").apply { mkdirs() }
        val outFile = File(outDir, "edu-cms-manager.apk")

        try {
            val conn = (URL(managerApkUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 20_000
                readTimeout = 60_000
            }
            if (conn.responseCode !in 200..299) {
                PlayerLogger.w(TAG, "Manager APK fetch HTTP ${conn.responseCode} — bailing")
                return
            }
            outFile.outputStream().use { out ->
                conn.inputStream.use { inp -> inp.copyTo(out) }
            }
            PlayerLogger.i(TAG, "Manager APK downloaded: ${outFile.length()}b")
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager download failed: ${e.message}")
            outFile.delete()
            return
        }

        // Install via PackageInstaller.Session. Same path Player's
        // own OtaUpdateWorker uses — silent on signage hardware that
        // pre-grants INSTALL_PACKAGES (Goodview, NovaStar, TCL etc.),
        // prompts on stock AOSP otherwise.
        installViaPackageInstaller(ctx, outFile)
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

    private fun installViaPackageInstaller(ctx: Context, apk: File) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            // We don't pin setAppPackageName — the bundled APK's own
            // package name (com.educms.manager or .debug) is what
            // PackageInstaller sees. If we hardcoded the prod
            // package id, debug builds would fail.
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                // We don't need a result receiver for the bootstrap
                // path — if it succeeds, ManagerApp.onCreate fires
                // and starts the watchdog. If it fails, we'll retry
                // on Player's next launch.
                val resultIntent = Intent("com.educms.player.MANAGER_BOOTSTRAP_RESULT").apply {
                    setPackage(ctx.packageName)
                }
                val statusPi = PendingIntent.getBroadcast(
                    ctx,
                    sessionId,
                    resultIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(statusPi.intentSender)
                PlayerLogger.i(TAG, "Manager install session committed (id=$sessionId)")
            }
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager install failed: ${e.message}", e)
        }
    }
}
