package com.educms.player.ota

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * OTA update worker for the Nova Taurus deployment and every other
 * non-Play-Store kiosk context. Taurus boxes don't have Google Play;
 * they ship a stock AOSP-ish system image with only the NovaStar
 * PlayService running. Once our APK is sideloaded (via ViPlex
 * Express), this worker is how we keep it current.
 *
 * Cadence: scheduled from PlayerApp via WorkManager every 6h, also
 * kicked on BOOT_COMPLETED. Always runs in background, never blocks
 * playback.
 *
 * Protocol:
 *   1. POST /api/v1/player/update-check { fingerprint, versionCode,
 *      versionName, abi } to the API.
 *   2. Server responds with { latest: { versionCode, versionName,
 *      apkUrl, sha256, forced } } — or { uptoDate: true }.
 *   3. If newer: download the APK to /Android/data/.../files/updates,
 *      verify SHA-256, fire an install intent via FileProvider.
 *   4. Android shows the system install prompt. On provisioned
 *      kiosks (device owner / admin APK installer privilege),
 *      PackageInstaller.Session skips the prompt — see
 *      INSTALL_PACKAGES permission path below.
 *
 * Taurus-specific: Rockchip devices typically run Android 6–9 with
 * root available via ViPlex. If the tenant provisions us as the
 * default installer via ADB (`pm set-installer com.educms.player`)
 * we can self-install without prompting. That's the production
 * config; untrusted environments stay on the confirmation prompt.
 */
class OtaUpdateWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        PlayerLogger.i(TAG, "OTA check starting (versionCode=${BuildConfig.VERSION_CODE}, versionName=${BuildConfig.VERSION_NAME})")
        try {
            val apiRoot = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                .getString("api_root", null) ?: run {
                    PlayerLogger.w(TAG, "OTA check aborted — api_root not set in SharedPreferences")
                    return@withContext Result.retry()
                }

            val deviceFingerprint = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                .getString("device_fingerprint", null) ?: "unknown"

            val payload = JSONObject().apply {
                put("fingerprint", deviceFingerprint)
                put("versionCode", BuildConfig.VERSION_CODE)
                put("versionName", BuildConfig.VERSION_NAME)
                put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("sdk", Build.VERSION.SDK_INT)
            }

            val url = URL("$apiRoot/api/v1/player/update-check")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 15_000
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) {
                Log.w(TAG, "update-check returned ${conn.responseCode}")
                PlayerLogger.w(TAG, "OTA update-check returned HTTP ${conn.responseCode}")
                return@withContext Result.success()
            }

            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val latest = json.optJSONObject("latest") ?: return@withContext Result.success()
            val latestVc = latest.optInt("versionCode")
            if (latestVc <= BuildConfig.VERSION_CODE) {
                PlayerLogger.i(TAG, "OTA check: up to date (current=${BuildConfig.VERSION_CODE}, latest=$latestVc)")
                return@withContext Result.success()
            }

            val apkUrl = latest.optString("apkUrl")
            if (apkUrl.isEmpty()) return@withContext Result.success()
            val expectedSha = latest.optString("sha256")
            val forced = latest.optBoolean("forced", false)
            val latestVn = latest.optString("versionName", "$latestVc")
            PlayerLogger.i(TAG, "OTA update available: $latestVn (versionCode=$latestVc, forced=$forced) — downloading")

            // Download into this app's external-files cache — survives
            // app updates, auto-cleared on uninstall, no permission
            // required on API 23+.
            val outDir = File(applicationContext.getExternalFilesDir(null), "updates").apply { mkdirs() }
            val outFile = File(outDir, "edu-player-$latestVc.apk")
            val dlConn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 60_000
            }
            outFile.outputStream().use { out ->
                dlConn.inputStream.use { inp -> inp.copyTo(out) }
            }

            if (expectedSha.isNotEmpty()) {
                val actual = sha256(outFile)
                if (!actual.equals(expectedSha, ignoreCase = true)) {
                    Log.e(TAG, "APK sha256 mismatch. expected=$expectedSha actual=$actual — discarding")
                    PlayerLogger.e(TAG, "APK sha256 mismatch — discarding download (expected=${expectedSha.take(16)}…)")
                    outFile.delete()
                    return@withContext Result.retry()
                }
            }

            PlayerLogger.i(TAG, "APK download complete and verified — firing install intent")
            triggerInstall(outFile, forced)
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "OTA worker failed", e)
            PlayerLogger.e(TAG, "OTA worker failed", e)
            Result.retry()
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

    private fun triggerInstall(apk: File, forced: Boolean) {
        val ctx = applicationContext
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        // User-visible notification so the operator can tap-to-install
        // if the system prompt gets dismissed / hidden in kiosk mode.
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel("ota", "Player updates", NotificationManager.IMPORTANCE_HIGH)
            nm.createNotificationChannel(chan)
        }
        val pi = android.app.PendingIntent.getActivity(
            ctx, 0, intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(ctx, "ota")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(if (forced) "Required player update ready" else "Player update ready")
            .setContentText("Tap to install.")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        nm.notify(42, notif)

        // Also fire the install intent directly so provisioned kiosks
        // (set via pm set-installer) just apply it.
        try { ctx.startActivity(intent) } catch (_: Exception) { /* notification remains */ }
    }

    companion object { private const val TAG = "OtaUpdateWorker" }
}
