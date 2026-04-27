package com.educms.manager

import android.content.Context
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
 * Manager-side OTA worker. Periodic + on-demand check that hits the
 * existing API surface (`/api/v1/player/update-check`,
 * `/api/v1/screens/status/:fp/ota-state`) just like Player's own
 * OtaUpdateWorker — but installs via OtaInstaller, which goes silent
 * when Manager is provisioned as DEVICE_OWNER.
 *
 * Why both Player and Manager have an OTA worker:
 *   - Player's worker still runs (defense in depth). On non-provisioned
 *     kiosks where Manager isn't device owner, Player is the path that
 *     at least surfaces the system "Install" prompt.
 *   - Manager's worker is the only one that can install silently. When
 *     present + provisioned, it's the primary path; Player's worker
 *     becomes a fallback that no-ops most of the time (the same APK
 *     install attempt fires AFTER Manager already installed it; the
 *     update-check returns "uptoDate" so Player exits cleanly).
 *
 * Schedule:
 *   - Periodic 6h, kicked from ManagerApp.onCreate via WorkManager
 *   - On-demand from OtaTriggerReceiver when Player forwards a
 *     dashboard "Push update" WebSocket signal
 *   - Also fires once on boot via BootReceiver (5min initial delay
 *     so the device's network has settled)
 *
 * Identity:
 *   - Uses the SAME `android-<ANDROID_ID>` fingerprint Player uses,
 *     so `/player/update-check` returns the same release info to
 *     either caller. Settings.Secure.ANDROID_ID is per-(signing-key
 *     + package + user) on Android 8+; both Player and Manager are
 *     signed with the same key, so they derive the same value.
 *   - Reports versionCode/versionName from the INSTALLED Player
 *     (queried via PackageManager), not from Manager itself. The
 *     server makes its OTA decision based on what's running on the
 *     screen, which is Player.
 */
class OtaWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.i(TAG, "Manager OTA worker starting (deviceOwner=${AdminReceiver.isDeviceOwner(applicationContext)})")
        try {
            val apiRoot = BuildConfig.API_ROOT
            val fp = deriveFingerprint()
            val playerVersion = readInstalledPlayerVersion()
            if (playerVersion == null) {
                Log.w(TAG, "Player not installed (${BuildConfig.PLAYER_PACKAGE}) — nothing to update")
                return@withContext Result.success()
            }
            val (currentVc, currentVn) = playerVersion
            Log.i(TAG, "current Player: $currentVn (vc=$currentVc) fp=${fp.take(20)}…")

            // Report CHECKING — so dashboard sees "we're looking" even
            // before the API request lands.
            reportOtaState(apiRoot, fp, "CHECKING", null, "v$currentVn → checking")

            val payload = JSONObject().apply {
                put("fingerprint", fp)
                put("versionCode", currentVc)
                put("versionName", currentVn)
                put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("sdk", Build.VERSION.SDK_INT)
                // Tag the request so server-side logs can distinguish
                // Manager-driven checks from Player-driven ones — same
                // endpoint, but useful for diagnostics.
                put("source", "manager")
            }

            val updateCheckUrl = URL("$apiRoot/api/v1/player/update-check")
            val resp = httpPostJson(updateCheckUrl, payload, timeoutMs = 15_000)
            if (resp == null) {
                Log.w(TAG, "update-check failed (no response)")
                reportOtaState(apiRoot, fp, "ERROR", null, "update-check no response")
                return@withContext Result.retry()
            }
            val latest = resp.optJSONObject("latest")
            if (latest == null) {
                Log.i(TAG, "Player up to date (no latest in response)")
                return@withContext Result.success()
            }

            val latestVc = latest.optInt("versionCode")
            if (latestVc <= currentVc) {
                Log.i(TAG, "Player up to date (current=$currentVc latest=$latestVc)")
                return@withContext Result.success()
            }

            val apkUrl = latest.optString("apkUrl")
            if (apkUrl.isEmpty()) {
                Log.w(TAG, "no apkUrl in update response — server config issue?")
                reportOtaState(apiRoot, fp, "ERROR", null, "no apkUrl in response")
                return@withContext Result.success()
            }
            val expectedSha = latest.optString("sha256")
            val latestVn = latest.optString("versionName", "$latestVc")
            Log.i(TAG, "OTA update available: $latestVn (vc=$latestVc) — downloading from $apkUrl")

            // Download
            reportOtaState(apiRoot, fp, "DOWNLOADING", 0, "v$latestVn")
            val outDir = File(applicationContext.getExternalFilesDir(null), "updates").apply { mkdirs() }
            val outFile = File(outDir, "edu-player-$latestVc.apk")
            val downloadOk = downloadWithProgress(apkUrl, outFile, apiRoot, fp, latestVn)
            if (!downloadOk) {
                outFile.delete()
                return@withContext Result.retry()
            }
            reportOtaState(apiRoot, fp, "DOWNLOADING", 100, "v$latestVn")

            // Verify SHA — security boundary; refuse to install
            // tampered/truncated APKs even if "from our own GitHub".
            if (expectedSha.isNotEmpty()) {
                reportOtaState(apiRoot, fp, "VERIFYING", null, "v$latestVn")
                val actualSha = sha256(outFile)
                if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                    Log.e(TAG, "SHA256 mismatch — discarding (expected=${expectedSha.take(16)}… got=${actualSha.take(16)}…)")
                    reportOtaState(
                        apiRoot, fp, "ERROR", null,
                        "SHA256 mismatch (expected ${expectedSha.take(12)}…)",
                    )
                    outFile.delete()
                    return@withContext Result.retry()
                }
            }

            // Install — silent if DEVICE_OWNER, prompt-fallback otherwise.
            reportOtaState(apiRoot, fp, "INSTALLING", null, "v$latestVn")
            OtaInstaller.installApk(applicationContext, outFile, BuildConfig.PLAYER_PACKAGE)
            // INSTALLED state is reported implicitly by Player's NEXT
            // heartbeat after restart (server compares prior !=
            // current versionName). Don't report INSTALLED here — the
            // PackageInstaller commit may still be in flight.
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "OTA worker failed", e)
            try {
                val fp = deriveFingerprint()
                reportOtaState(BuildConfig.API_ROOT, fp, "ERROR", null, e.message?.take(400) ?: "unknown error")
            } catch (_: Exception) { /* best-effort */ }
            Result.retry()
        }
    }

    /**
     * Read the INSTALLED Player APK's versionCode + versionName via
     * PackageManager. Falls back to the .debug variant if the
     * production package isn't installed.
     */
    private fun readInstalledPlayerVersion(): Pair<Int, String>? {
        val pm = applicationContext.packageManager
        val candidates = listOf(BuildConfig.PLAYER_PACKAGE, "${BuildConfig.PLAYER_PACKAGE}.debug")
        for (pkg in candidates) {
            try {
                val info = pm.getPackageInfo(pkg, 0)
                @Suppress("DEPRECATION")
                val vc = info.versionCode
                val vn = info.versionName ?: "$vc"
                return vc to vn
            } catch (_: Exception) { /* try next */ }
        }
        return null
    }

    /**
     * Same fingerprint Player uses (`android-<ANDROID_ID>`). Both
     * apps signed with the same key → same ANDROID_ID per Android 8+
     * scoping rules.
     */
    @Suppress("DEPRECATION")
    private fun deriveFingerprint(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                applicationContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }
        return if (androidId.isNotBlank()) "android-$androidId" else "android-unknown"
    }

    private fun downloadWithProgress(
        apkUrl: String,
        outFile: File,
        apiRoot: String,
        fp: String,
        versionLabel: String,
    ): Boolean {
        return try {
            val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 60_000
            }
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: -1L
            var downloaded = 0L
            var lastReport = System.currentTimeMillis()
            outFile.outputStream().use { out ->
                conn.inputStream.use { inp ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        downloaded += n
                        val now = System.currentTimeMillis()
                        if (total > 0 && now - lastReport >= 3_000) {
                            val pct = ((downloaded * 100) / total).toInt().coerceIn(0, 99)
                            reportOtaState(apiRoot, fp, "DOWNLOADING", pct, "v$versionLabel")
                            lastReport = now
                        }
                    }
                }
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "download failed: ${e.message}", e)
            reportOtaState(apiRoot, fp, "ERROR", null, "Download failed: ${e.message?.take(200)}")
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
        private const val TAG = "ManagerOtaWorker"
    }
}
