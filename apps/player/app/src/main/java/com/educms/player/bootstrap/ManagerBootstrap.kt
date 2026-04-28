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
            }
        }
    }

    private fun bootstrapInternal(ctx: Context) {
        if (isManagerInstalled(ctx)) {
            PlayerLogger.i(TAG, "Manager already installed — skipping bootstrap")
            return
        }

        PlayerLogger.i(TAG, "Manager not installed — attempting bootstrap")
        showToast(ctx, "Installing companion (EduCMS Manager)…")

        // Try bundled asset first (no network needed).
        val bundledFile = extractBundledManagerApk(ctx)
        if (bundledFile != null) {
            PlayerLogger.i(TAG, "Installing Manager from bundled assets (${bundledFile.length()}b)")
            installViaPackageInstaller(ctx, bundledFile, "bundled")
            return
        }

        PlayerLogger.w(TAG, "No bundled Manager APK in assets — falling back to network fetch")
        showToast(ctx, "Installing companion — downloading…")
        val downloaded = downloadManagerApk(ctx)
        if (downloaded != null) {
            installViaPackageInstaller(ctx, downloaded, "network")
        } else {
            PlayerLogger.w(TAG, "Network fallback also failed — bootstrap will retry next boot")
            showToast(ctx, "Manager install failed (no network) — will retry")
        }
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
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
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
                PlayerLogger.i(TAG, "Manager install session committed (id=$sessionId source=$source)")
                showToast(ctx, "Companion install committed (Android may prompt to confirm)")
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
