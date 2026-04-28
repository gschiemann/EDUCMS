package com.educms.manager

import android.content.Context
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manager self-update worker — the missing piece that makes Manager
 * upgradeable without a sideload.
 *
 * Operator (2026-04-28): "i dont want to side load any fucking thing
 * after this next build". This worker is the contract. Once Manager
 * v1.0.2 is sideloaded once, every subsequent manager-v* GitHub
 * Release auto-installs silently in the background.
 *
 * v1.0.3 hardening (Plan + Kotlin reviewer punch list):
 *   - Skips entirely when !isDeviceOwner so we don't stack 48
 *     install prompts in 24h on unattended kiosks (P1-G).
 *   - Posts state=INSTALLING to the dashboard BEFORE installApk
 *     so we have telemetry even if the OS kills the process
 *     mid-commit (P1-H).
 *   - Marks InstallTracker.markInstallInFlight() before commit so
 *     the next periodic tick can detect a stalled install and not
 *     loop on the same APK forever (P0-B).
 *   - Reads the APK's actual package id from disk via
 *     InstallTracker.readApkPackageId() before passing to
 *     OtaInstaller, so debug-variant installs work (P0-C / P1-2).
 *   - Uses Player's fingerprint (read from PlayerHealthProvider
 *     via WatchdogService) when reporting state — Manager and
 *     Player share the same screen row on the dashboard, not two
 *     ghost rows (P1-F).
 */
class ManagerSelfUpdateWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val isOwner = AdminReceiver.isDeviceOwner(applicationContext)
        Log.i(TAG, "Manager self-update worker starting (deviceOwner=$isOwner)")

        // P1-G — skip entirely when not DEVICE_OWNER. Without it the
        // install prompts the operator every 30 min, queueing dozens
        // of unanswered system dialogs and eventually ANR'ing. The
        // kiosk wasn't going to silently update anyway; let the
        // dashboard show "Manager not provisioned" and have the
        // operator run `dpm set-device-owner` once.
        if (!isOwner) {
            Log.i(TAG, "skipping self-update — Manager is not DEVICE_OWNER. ADB-provision via: " +
                "adb shell dpm set-device-owner com.educms.manager/.AdminReceiver")
            return@withContext Result.success()
        }

        try {
            val apiRoot = BuildConfig.API_ROOT
            val fp = derivePlayerFingerprint() ?: deriveOwnFingerprint()
            val (currentVc, currentVn) = readMyVersion()
            Log.i(TAG, "current Manager: $currentVn (vc=$currentVc) fp=${fp.take(20)}…")

            // P0-B — short-circuit if a previous install is in flight.
            // The marker auto-stales after 4h so we don't loop forever
            // on a permanently-failing install.
            val pendingVc = InstallTracker.getPendingVc(applicationContext)
            if (pendingVc != null) {
                if (pendingVc <= currentVc) {
                    // Install actually landed — clear the marker and
                    // proceed. PackageReplacedReceiver SHOULD have
                    // cleared this already; we're a fallback for ROMs
                    // that drop the broadcast.
                    Log.i(TAG, "in-flight marker=$pendingVc satisfied by current=$currentVc; clearing")
                    InstallTracker.clearPending(applicationContext)
                } else {
                    Log.i(TAG, "skip — install of vc=$pendingVc already in flight (current=$currentVc)")
                    return@withContext Result.success()
                }
            }

            val payload = JSONObject().apply {
                put("fingerprint", fp)
                put("versionCode", currentVc)
                put("versionName", currentVn)
                put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("sdk", Build.VERSION.SDK_INT)
                put("source", "manager-self")
            }

            val resp = httpPostJson(
                URL("$apiRoot/api/v1/player/manager-update-check"),
                payload,
                timeoutMs = 15_000,
            )
            if (resp == null) {
                Log.w(TAG, "manager-update-check failed (no response)")
                return@withContext Result.retry()
            }
            val latest = resp.optJSONObject("latest")
            if (latest == null) {
                Log.i(TAG, "Manager up to date (no latest in response)")
                return@withContext Result.success()
            }

            val latestVc = latest.optInt("versionCode")
            if (latestVc <= currentVc) {
                Log.i(TAG, "Manager up to date (current=$currentVc latest=$latestVc)")
                return@withContext Result.success()
            }

            val apkUrl = latest.optString("apkUrl")
            if (apkUrl.isEmpty()) {
                Log.w(TAG, "no apkUrl in manager-update-check response — server config issue?")
                return@withContext Result.success()
            }
            val expectedSha = latest.optString("sha256")
            val latestVn = latest.optString("versionName", "$latestVc")
            Log.i(TAG, "Manager update available: $latestVn (vc=$latestVc) — downloading from $apkUrl")

            // P1-H — report INSTALLING state to the dashboard BEFORE
            // we begin the network fetch. Plain best-effort; failure
            // here should never block the install.
            reportOtaState(apiRoot, fp, "DOWNLOADING", null, "Manager v$latestVn")

            val outDir = File(applicationContext.getExternalFilesDir(null), "manager-updates").apply { mkdirs() }
            val outFile = File(outDir, "edu-manager-$latestVc.apk")
            outDir.listFiles()?.forEach { f ->
                if (f.name != outFile.name) {
                    runCatching { f.delete() }
                }
            }

            if (!download(apkUrl, outFile)) {
                outFile.delete()
                reportOtaState(apiRoot, fp, "ERROR", null, "Manager download failed")
                return@withContext Result.retry()
            }

            // P0-E — SHA verification when the server provided a hash.
            // Now that v1.0.3 server pins SHA in the manager-update-check
            // response, this is the primary integrity gate that closes
            // the "compromised release" attack surface (since the
            // committed debug keystore alone isn't enough to verify a
            // legitimate update).
            if (expectedSha.isNotEmpty()) {
                reportOtaState(apiRoot, fp, "VERIFYING", null, "Manager v$latestVn")
                val actualSha = sha256(outFile)
                if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                    Log.e(TAG, "SHA256 mismatch — discarding " +
                        "(expected=${expectedSha.take(16)}… got=${actualSha.take(16)}…)")
                    reportOtaState(apiRoot, fp, "ERROR", null,
                        "Manager SHA256 mismatch (expected ${expectedSha.take(12)}…)")
                    outFile.delete()
                    return@withContext Result.retry()
                }
            }

            // P0-C — read the APK's actual package id from disk before
            // pinning setAppPackageName. Hardcoded ids fail on debug
            // variants (com.educms.manager.debug) and any release/
            // debug crossover. PackageInstaller silently rejects the
            // session with STATUS_FAILURE_INVALID otherwise.
            val apkPackageId = InstallTracker.readApkPackageId(applicationContext, outFile)
                ?: applicationContext.packageName
            Log.i(TAG, "APK package-id (read from manifest) = $apkPackageId")

            // P0-B — write the in-flight marker BEFORE commit. If the
            // OS kills us between commit and Result.success(), the
            // marker survives and the next worker run won't loop.
            InstallTracker.markInstallInFlight(applicationContext, latestVc)

            // P1-H — final state report before commit. After commit
            // our process may not survive long enough to report
            // anything; the dashboard sees "INSTALLING" until either
            // the next heartbeat reports a higher versionCode or the
            // 5-min timeout marks the push as failed.
            reportOtaState(apiRoot, fp, "INSTALLING", null,
                "Manager self-install vc=$latestVc")

            Log.i(TAG, "Installing Manager v$latestVn over self " +
                "(vc=$currentVc → $latestVc, target=$apkPackageId)")
            OtaInstaller.installApk(applicationContext, outFile, apkPackageId)

            // Best-effort. Process may already be dead.
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Manager self-update worker failed", e)
            try {
                val fp = derivePlayerFingerprint() ?: deriveOwnFingerprint()
                reportOtaState(BuildConfig.API_ROOT, fp, "ERROR", null,
                    "Manager self-update: ${e.message?.take(200)}")
            } catch (_: Exception) { /* best-effort */ }
            Result.retry()
        }
    }

    /**
     * Read Manager's own versionCode + versionName via PackageManager.
     * Different from BuildConfig.* because we want what's CURRENTLY
     * INSTALLED — guards against the edge case where a worker run
     * survives across an install (it shouldn't, but if it does, we'd
     * report a stale BuildConfig value and loop on the same install).
     */
    @Suppress("DEPRECATION")
    private fun readMyVersion(): Pair<Int, String> {
        val pm = applicationContext.packageManager
        val pkg = applicationContext.packageName
        return try {
            val info: PackageInfo = pm.getPackageInfo(pkg, 0)
            val vc = info.versionCode
            val vn = info.versionName ?: "$vc"
            vc to vn
        } catch (e: Exception) {
            Log.w(TAG, "PackageManager.getPackageInfo failed: ${e.message}")
            BuildConfig.VERSION_CODE to (BuildConfig.VERSION_NAME ?: "0.0.0")
        }
    }

    /**
     * P1-F — read Player's fingerprint via the cross-process
     * PlayerHealthProvider so Manager and Player share the same
     * server-side screen row. Without this, debug variants of
     * Manager + Player (different applicationIds, hence different
     * Settings.Secure.ANDROID_ID values per Android 8+ scoping) end
     * up as separate ghost rows on the dashboard.
     *
     * Returns null if Player isn't paired yet OR the heartbeat
     * provider isn't reachable; caller falls back to Manager's own
     * fingerprint, which is correct for fresh installs (no Player
     * row exists yet anyway).
     */
    private fun derivePlayerFingerprint(): String? {
        return try {
            val uri = Uri.parse("content://${PlayerHealthProvider.AUTHORITY}/heartbeat")
            applicationContext.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return null
                val idx = c.getColumnIndex("device_fingerprint")
                if (idx < 0) return null
                val fp = c.getString(idx)
                if (fp.isNullOrBlank()) null else fp
            }
        } catch (e: Exception) {
            Log.w(TAG, "derivePlayerFingerprint failed: ${e.message}")
            null
        }
    }

    /**
     * Same fingerprint Player + OtaWorker derive — Settings.Secure.ANDROID_ID.
     * Used as a fallback when we can't read Player's heartbeat (fresh
     * install where Player hasn't paired yet).
     */
    @Suppress("DEPRECATION")
    private fun deriveOwnFingerprint(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                applicationContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }
        return if (androidId.isNotBlank()) "android-$androidId" else "android-unknown"
    }

    private fun download(apkUrl: String, outFile: File): Boolean {
        return try {
            val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 60_000
                instanceFollowRedirects = true
            }
            outFile.outputStream().use { out ->
                conn.inputStream.use { inp -> inp.copyTo(out) }
            }
            outFile.length() > 0
        } catch (e: Exception) {
            Log.e(TAG, "download failed: ${e.message}", e)
            false
        }
    }

    private fun sha256(f: File): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        f.inputStream().use { inp ->
            val buf = ByteArray(8192)
            while (true) {
                val n = inp.read(buf); if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun httpPostJson(url: URL, body: JSONObject, timeoutMs: Int): JSONObject? {
        return try {
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) {
                Log.w(TAG, "POST ${url.path} → HTTP ${conn.responseCode}")
                return null
            }
            val respBody = conn.inputStream.bufferedReader().use { it.readText() }
            JSONObject(respBody)
        } catch (e: Exception) {
            Log.w(TAG, "POST ${url.path} threw: ${e.message}")
            null
        }
    }

    /** P1-H — report current OTA state to the API for dashboard
     *  visibility. Best-effort; never blocks the install path. */
    private fun reportOtaState(
        apiRoot: String,
        fp: String,
        state: String,
        progress: Int?,
        message: String?,
    ) {
        try {
            val payload = JSONObject().apply {
                put("state", state)
                if (progress != null) put("progress", progress)
                if (message != null) put("message", message)
            }
            val url = URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            val rc = conn.responseCode
            if (rc !in 200..299) {
                Log.w(TAG, "ota-state report HTTP $rc (state=$state)")
            } else {
                Log.i(TAG, "ota-state → $state${progress?.let { " ($it%)" } ?: ""}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "ota-state report failed (state=$state): ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ManagerSelfUpdate"
    }
}
