package com.educms.manager

import android.content.Context
import android.content.pm.PackageInfo
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
 * Schedule:
 *   - Periodic 30 min (kicked from ManagerApp.onCreate). 30 min
 *     instead of 6h so a published Manager release reaches kiosks
 *     within an hour worst-case, not within a day.
 *   - On boot via BootReceiver — first check fires immediately with
 *     a 90s network-settle delay.
 *   - On dashboard "Push update" via OtaTriggerReceiver — same
 *     CHECK_FOR_UPDATES signal that triggers Player OTA also kicks
 *     this worker.
 *
 * Install path:
 *   - Downloads to Manager's own external-files/updates dir
 *   - SHA-256 verified IF the server provides a hash (optional —
 *     server skips Manager SHAs to avoid an extra GitHub API hit)
 *   - PackageInstaller.Session commit with targetPackage =
 *     BuildConfig.APPLICATION_ID. Silent if Manager is DEVICE_OWNER,
 *     prompt-fallback otherwise (same as Player install path).
 *   - When the install commits, the system kills THIS process. The
 *     new Manager APK starts on next ACTION_PACKAGE_REPLACED. Any
 *     download/install state mid-flight is OK to lose — the next
 *     periodic tick re-checks the version and skips if already at
 *     latest.
 *
 * Why a separate class from OtaWorker (which handles Player updates):
 *   - Different endpoint (/manager-update-check vs /update-check)
 *   - Different version reporting (Manager's own version, not
 *     Player's installed version)
 *   - Different target package (this app vs Player)
 *   - Different periodic schedule (30 min vs 6h to match the
 *     "Manager keeps itself current" promise)
 *
 * Same wire format + install path as OtaWorker so we share zero
 * accidental coupling beyond OtaInstaller (which is generic by
 * design — it's package-id-pinned).
 */
class ManagerSelfUpdateWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.i(TAG, "Manager self-update worker starting (deviceOwner=${AdminReceiver.isDeviceOwner(applicationContext)})")
        try {
            val apiRoot = BuildConfig.API_ROOT
            val fp = deriveFingerprint()
            val (currentVc, currentVn) = readMyVersion()
            Log.i(TAG, "current Manager: $currentVn (vc=$currentVc) fp=${fp.take(20)}…")

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

            val outDir = File(applicationContext.getExternalFilesDir(null), "manager-updates").apply { mkdirs() }
            val outFile = File(outDir, "edu-manager-$latestVc.apk")
            // Best-effort cleanup of any older staged APK so the dir
            // doesn't accumulate stale builds across upgrades.
            outDir.listFiles()?.forEach { f ->
                if (f.name != outFile.name) {
                    runCatching { f.delete() }
                }
            }

            if (!download(apkUrl, outFile)) {
                outFile.delete()
                return@withContext Result.retry()
            }

            // SHA verification — same security boundary OtaWorker uses.
            // If the server provided a hash, refuse to install on
            // mismatch. If not provided, the signature check at
            // install time is the only remaining gate (acceptable for
            // Manager because its release flow is GitHub-Releases-only,
            // pinned to the same signing key as Player).
            if (expectedSha.isNotEmpty()) {
                val actualSha = sha256(outFile)
                if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                    Log.e(TAG, "SHA256 mismatch — discarding (expected=${expectedSha.take(16)}… got=${actualSha.take(16)}…)")
                    outFile.delete()
                    return@withContext Result.retry()
                }
            }

            // Self-install. PackageInstaller will kill THIS process
            // when the commit lands. Any code after this line may not
            // run — assume nothing.
            Log.i(TAG, "Installing Manager v$latestVn over self (vc=$currentVc → $latestVc)")
            OtaInstaller.installApk(applicationContext, outFile, applicationContext.packageName)

            // Best-effort. Process may already be dead.
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Manager self-update worker failed", e)
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
            // Falls back to BuildConfig values if PackageManager hiccups
            Log.w(TAG, "PackageManager.getPackageInfo failed: ${e.message}")
            BuildConfig.VERSION_CODE to (BuildConfig.VERSION_NAME ?: "0.0.0")
        }
    }

    /** Same fingerprint Player + OtaWorker derive — Settings.Secure.ANDROID_ID. */
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

    companion object {
        private const val TAG = "ManagerSelfUpdate"
    }
}
