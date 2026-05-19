package com.educms.player.ota

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
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

        // v1.0.53 — OPERATOR-REPORTED REGRESSION: "remote upgrade has
        // never worked. We are on version 52 motherfucker, and no
        // update workflow."
        //
        // Root cause: TWO compounding bugs.
        //
        //   (1) Player's OTA worker bailed out with `return success()`
        //       whenever Manager was installed, deferring ALL install
        //       work to Manager's "silent install" path. Manager's
        //       silent install requires EITHER DEVICE_OWNER (which
        //       only ADB factory provisioning grants) OR installer-of-
        //       record for Player (which Manager never was, since the
        //       user sideloaded Player directly). So Manager commits
        //       returned STATUS_PENDING_USER_ACTION → notification
        //       posted → OEM battery-saver ate the notification →
        //       install never happened.
        //
        //   (2) Player's PackageInstaller session params were missing
        //       the silent-install hint AND Player's manifest was
        //       missing UPDATE_PACKAGES_WITHOUT_USER_ACTION (stripped
        //       in v1.0.21 during an unrelated crash debug). Even on
        //       devices where Player WAS installer-of-record (any
        //       second-onwards self-install), every commit returned
        //       STATUS_PENDING_USER_ACTION because the silent-install
        //       gate wasn't even attempted.
        //
        // Fix: Player ALWAYS runs the OTA flow (no more bailing when
        // Manager is installed). Player's install path declares
        // UPDATE_PACKAGES_WITHOUT_USER_ACTION and sets USER_ACTION_
        // NOT_REQUIRED on the session (Api31SilentInstall.configure).
        //
        // The result for the user's specific .52 → .53 transition:
        //   - .52 has neither permission nor silent hint, so the
        //     .52 → .53 install is a one-tap install via MainActivity
        //     trampoline (OtaInstallReceiver routes the PENDING_USER_
        //     ACTION intent through Player's already-foregrounded
        //     MainActivity — reliable on every OEM, no notification
        //     dependency).
        //   - That ONE tap makes Player the installer-of-record for
        //     itself (PackageInstaller records the caller).
        //   - .53 → .54 onwards: SILENT. Player has the permission,
        //     sets the hint, IS installer-of-record. Android skips
        //     the dialog entirely. Zero taps forever.
        //
        // Concurrent install safety: Manager's worker still fires on
        // the same trigger. If Manager wins the install race
        // (DEVICE_OWNER kiosks where Manager actually goes silent),
        // Player's commit sees "already installed" and exits cleanly.
        // PackageInstaller serializes per target package.
        PlayerLogger.i(
            TAG,
            "Player handles OTA (Manager parallel attempt OK). " +
                "Silent install gate: install_perm declared=v1.0.53+, " +
                "installer-of-record=${getInstallerOfRecord(applicationContext)}",
        )
        try {
            val apiRoot = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                .getString("api_root", null) ?: run {
                    // Was Result.retry() — caused WorkManager to burn
                    // exponential-backoff retries forever on a fresh
                    // install where the WebView hasn't persisted
                    // `api_root` yet. That drained battery on unpaired
                    // devices + filled the retry queue with no-op
                    // work. Result.success() exits cleanly; the next
                    // 6h periodic tick will re-check once the WebView
                    // has had a chance to set api_root.
                    PlayerLogger.i(
                        TAG,
                        "OTA check skipped — api_root not set yet (device likely not paired). " +
                            "Will retry on next scheduled tick."
                    )
                    return@withContext Result.success()
                }

            val deviceFingerprint = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                .getString("device_fingerprint", null) ?: "unknown"

            // v1.0.12 — per-phase OTA progress reporting. The dashboard
            // and on-device overlay both subscribe to lastOtaState so
            // operators see real progress instead of stopwatch theater.
            // Best-effort — failure to report state shouldn't block the
            // OTA itself.
            reportOtaState(apiRoot, deviceFingerprint, "CHECKING", null, null)

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
                // v1.0.68 — make the bail VISIBLE. Without this report the
                // operator taps "Update now", the worker silently exits,
                // and the dashboard shows nothing at all.
                reportOtaState(
                    apiRoot, deviceFingerprint, "ERROR", null,
                    "Update check failed — server returned HTTP ${conn.responseCode}",
                )
                return@withContext Result.success()
            }

            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val latest = json.optJSONObject("latest") ?: run {
                PlayerLogger.i(TAG, "OTA check: server returned no newer release — Player is current")
                return@withContext Result.success()
            }
            val latestVc = latest.optInt("versionCode")
            if (latestVc <= BuildConfig.VERSION_CODE) {
                PlayerLogger.i(TAG, "OTA check: up to date (current=${BuildConfig.VERSION_CODE}, latest=$latestVc)")
                return@withContext Result.success()
            }

            val apkUrl = latest.optString("apkUrl")
            if (apkUrl.isEmpty()) {
                PlayerLogger.w(TAG, "OTA aborted — update offered but apkUrl was empty (server config issue)")
                reportOtaState(
                    apiRoot, deviceFingerprint, "ERROR", null,
                    "Update available but the server returned no download URL",
                )
                return@withContext Result.success()
            }
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

            // Report progress periodically during download. Reports are
            // throttled to once every ~3 seconds to avoid hammering the
            // API on a fast network. State="DOWNLOADING", progress=0..100.
            reportOtaState(apiRoot, deviceFingerprint, "DOWNLOADING", 0, "v$latestVn")
            val totalBytes = dlConn.contentLengthLong.takeIf { it > 0 } ?: -1L
            var downloaded = 0L
            var lastReportAt = System.currentTimeMillis()
            outFile.outputStream().use { out ->
                dlConn.inputStream.use { inp ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        downloaded += n
                        val now = System.currentTimeMillis()
                        if (now - lastReportAt >= 3_000) {
                            val pct = if (totalBytes > 0) {
                                ((downloaded * 100) / totalBytes).toInt().coerceIn(0, 99)
                            } else {
                                ((downloaded / (512 * 1024)).toInt() + 1).coerceIn(1, 95)
                            }
                            val msg = if (totalBytes > 0) {
                                "v$latestVn"
                            } else {
                                "v$latestVn (${String.format("%.1f", downloaded / 1048576.0)} MB)"
                            }
                            reportOtaState(apiRoot, deviceFingerprint, "DOWNLOADING", pct, msg)
                            lastReportAt = now
                        }
                    }
                }
            }
            reportOtaState(apiRoot, deviceFingerprint, "DOWNLOADING", 100, "v$latestVn")

            if (expectedSha.isNotEmpty()) {
                reportOtaState(apiRoot, deviceFingerprint, "VERIFYING", null, "v$latestVn")
                val actual = sha256(outFile)
                if (!actual.equals(expectedSha, ignoreCase = true)) {
                    Log.e(TAG, "APK sha256 mismatch. expected=$expectedSha actual=$actual — discarding")
                    PlayerLogger.e(TAG, "APK sha256 mismatch — discarding download (expected=${expectedSha.take(16)}…)")
                    outFile.delete()
                    reportOtaState(
                        apiRoot,
                        deviceFingerprint,
                        "ERROR",
                        null,
                        "SHA256 mismatch (expected ${expectedSha.take(12)}…, got ${actual.take(12)}…)",
                    )
                    return@withContext Result.retry()
                }
            }

            PlayerLogger.i(TAG, "APK download complete and verified")

            // v1.0.53 — fire Player's install path immediately.
            //
            // Previously bailed out when Manager was installed, deferring
            // ALL install work to Manager. That hid a never-working OTA
            // pipeline (Manager's notification BAL-bypass gets eaten by
            // every signage OEM's battery-saver layer). With the
            // silent-install hint (Api31SilentInstall + UPDATE_PACKAGES_
            // WITHOUT_USER_ACTION) plus Player's MainActivity trampoline
            // for the user-tap case, Player's own install path is the
            // reliable one — first install needs ONE tap, every install
            // after is silent.
            //
            // Manager still attempts in parallel (its own worker fires
            // off the same dashboard trigger). If Manager somehow lands
            // first (DEVICE_OWNER kiosks), Player's PackageInstaller
            // commit sees "already installed at this version" and
            // exits cleanly. No double-prompt risk because Manager's
            // notification path doesn't actually surface in practice.
            reportOtaState(apiRoot, deviceFingerprint, "INSTALLING", null, "v$latestVn")
            triggerInstall(outFile, forced, apiRoot, deviceFingerprint)
            // Success state is reported on next boot via the heartbeat
            // (new versionName lands in playerVersion, dashboard infers
            // INSTALLED from a version change). We don't report
            // 'INSTALLED' here because the install hasn't actually
            // completed yet — Android may still show the system prompt
            // or the install may fail silently. The next-boot heartbeat
            // is the only authoritative signal.
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "OTA worker failed", e)
            PlayerLogger.e(TAG, "OTA worker failed", e)
            // Best-effort error report — survives transient API outages.
            try {
                val apiRoot = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                    .getString("api_root", null)
                val fp = applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                    .getString("device_fingerprint", null)
                if (apiRoot != null && fp != null) {
                    reportOtaState(apiRoot, fp, "ERROR", null, e.message?.take(400) ?: "unknown error")
                }
            } catch (_: Exception) { /* best-effort */ }
            Result.retry()
        }
    }

    /**
     * Best-effort POST to /api/v1/screens/status/:fp/ota-state. Failure
     * is logged but never throws — state reporting is observability,
     * not load-bearing for the install itself.
     */
    private fun reportOtaState(
        apiRoot: String,
        fingerprint: String,
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
            val url = URL("$apiRoot/api/v1/screens/status/$fingerprint/ota-state")
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
                PlayerLogger.w(TAG, "OTA state report HTTP $rc (state=$state)")
            } else {
                PlayerLogger.i(TAG, "OTA state report → $state${progress?.let { " ($it%)" } ?: ""}")
            }
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "OTA state report failed (state=$state): ${e.message}")
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

    /**
     * Install the downloaded APK via Android's PackageInstaller.Session.
     *
     * Why rewritten 2026-04-23: the previous implementation fired
     * Intent.ACTION_INSTALL_PACKAGE + ctx.startActivity. That intent
     * has been deprecated since Android 8 and silently no-ops without
     * user interaction. On a kiosk with nobody in front of it, the
     * system install prompt sits forever and the update never lands.
     *
     * PackageInstaller.Session is the supported path and behaves
     * correctly in three deployment modes:
     *   1. Device-owner kiosk (pm set-installer com.educms.player)
     *      → silent install, no prompt.
     *   2. Signed installer on A12+ (Play Protect trusted)
     *      → silent install for same-signature upgrades.
     *   3. Regular sideload
     *      → PackageInstaller posts STATUS_PENDING_USER_ACTION with
     *        a follow-up Intent the OtaInstallReceiver launches to
     *        show the consent prompt. Operator taps "Install".
     *
     * The notification remains as a user-visible fallback for case 3
     * if the prompt gets dismissed.
     */
    private fun triggerInstall(apk: File, forced: Boolean, apiRoot: String, deviceFingerprint: String) {
        val ctx = applicationContext

        // v1.0.55 — Schedule a post-install relaunch safety net BEFORE
        // we commit the install. WorkManager persists the work request
        // to disk, so it survives the package replace; the new Player's
        // WorkManager picks it up and runs it. If Manager's
        // PackageReplacedReceiver succeeds at relaunching first, this
        // worker's launch is a no-op (singleTask MainActivity).
        //
        // Operator (2026-05-12): "wasnt silent, didnt relaunch the app
        // after i clicked install... i launched the app manually".
        // Manager's primary relaunch path was BAL-blocked. This is the
        // safety net so the kiosk wakes up by itself.
        try {
            val req = androidx.work.OneTimeWorkRequestBuilder<PostInstallRelaunchWorker>()
                .setInitialDelay(60, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            androidx.work.WorkManager.getInstance(ctx).enqueueUniqueWork(
                "edu-post-install-relaunch",
                androidx.work.ExistingWorkPolicy.REPLACE,
                req,
            )
            PlayerLogger.i(TAG, "post-install relaunch safety-net enqueued (+60s)")
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "could not enqueue post-install relaunch safety-net: ${e.message}")
        }

        // Primary path: PackageInstaller.Session.
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            // Only set the package name when we know it matches ours —
            // guards against an attacker swapping a different APK into
            // the updates dir and using this session to replace us.
            params.setAppPackageName(ctx.packageName)

            // v1.0.53 — silent-install hint. Tells the system "this
            // doesn't need a user prompt". The system honors the hint
            // when the caller holds UPDATE_PACKAGES_WITHOUT_USER_ACTION
            // (declared in manifest as of v1.0.53) AND is installer-
            // of-record for the target package. On a freshly sideloaded
            // kiosk Player is NOT installer-of-record yet, so the very
            // first call will return STATUS_PENDING_USER_ACTION and
            // surface the install dialog via the MainActivity
            // trampoline in OtaInstallReceiver. After the user taps
            // Install once, Player IS installer-of-record for itself —
            // every subsequent OTA call hits this same code path and
            // goes SILENT. Zero taps from v1.0.54 onwards.
            //
            // Symbol isolation: setRequireUserAction is API 31+, so
            // the actual call is gated behind a runtime version check
            // and lives in Api31SilentInstall (@RequiresApi-isolated)
            // so Android 11 ART never tries to resolve it at class
            // load time.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Api31SilentInstall.configure(params)
                PlayerLogger.i(
                    TAG,
                    "Silent-install hint applied (API ${Build.VERSION.SDK_INT}). " +
                        "System will skip the user prompt if Player is installer-of-record for itself.",
                )
            }

            // v1.0.53 — also request update-ownership lock on Android
            // 14+ so other installers (vendor stores, OEM update apps)
            // can't silently regress Player to an older build.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                try {
                    Api34UpdateOwnership.configure(params)
                } catch (e: Exception) {
                    PlayerLogger.w(TAG, "update-ownership lock failed (continuing): ${e.message}")
                }
            }

            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            try {
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val resultIntent = Intent(ctx, OtaInstallReceiver::class.java).apply {
                    action = "com.educms.player.OTA_INSTALL_RESULT"
                }
                val statusPi = PendingIntent.getBroadcast(
                    ctx,
                    sessionId,
                    resultIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(statusPi.intentSender)
                PlayerLogger.i(TAG, "OTA install committed via PackageInstaller.Session (sessionId=$sessionId)")
            } finally {
                session.close()
            }
        } catch (ex: Exception) {
            Log.w(TAG, "PackageInstaller.Session path failed — operator can use notification to install", ex)
            PlayerLogger.w(TAG, "PackageInstaller.Session install failed; tap-to-install notification posted", ex)
            // v1.0.68 — surface the install failure to the dashboard.
            // Previously this fell through to a notification the OEM
            // battery-saver often eats, leaving the operator no signal.
            reportOtaState(
                apiRoot, deviceFingerprint, "ERROR", null,
                "Install could not start automatically: ${ex.message?.take(160) ?: "unknown error"}",
            )
            postFallbackInstallNotification(ctx, apk, forced)
        }
    }

    private fun postFallbackInstallNotification(ctx: Context, apk: File, forced: Boolean) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel("ota", "Player updates", NotificationManager.IMPORTANCE_HIGH)
            nm.createNotificationChannel(chan)
        }
        val fallbackUri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apk)
        val fallbackIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(fallbackUri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val fallbackPi = PendingIntent.getActivity(
            ctx, 0, fallbackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(ctx, "ota")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(if (forced) "Required player update ready" else "Player update ready")
            .setContentText("Tap to install.")
            .setContentIntent(fallbackPi)
            .setAutoCancel(true)
            .build()
        nm.notify(42, notif)
    }

    /**
     * Detect whether the Manager APK (production OR debug variant)
     * is currently installed. Retained for telemetry / future use
     * even though Player no longer yields its OTA path to Manager
     * (which historically never worked — see doWork comments).
     */
    private fun isManagerInstalled(ctx: Context): Boolean {
        val pm = ctx.packageManager
        for (pkg in listOf("com.educms.manager", "com.educms.manager.debug")) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true
            } catch (_: Exception) { /* not installed */ }
        }
        return false
    }

    /**
     * v1.0.53 — diagnostic helper. Returns the package id that
     * Android records as installer-of-record for Player. Used in OTA
     * telemetry so the dashboard can answer the question "will the
     * next install be silent?" without having to push and observe.
     *
     * Possible values:
     *   - "com.educms.player"  → Player self-installed previously,
     *                             next OTA goes silent (target state).
     *   - "com.educms.manager" → Manager installed Player, Manager
     *                             can silent-install future updates.
     *   - "com.google.android.packageinstaller" → user sideloaded.
     *     First OTA will need ONE tap.
     *   - null → ADB sideload OR Android 11- (deprecated lookup),
     *     first OTA will need one tap.
     */
    private fun getInstallerOfRecord(ctx: Context): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                ctx.packageManager.getInstallerPackageName(ctx.packageName)
            }
        } catch (_: Exception) { null }
    }

    companion object { private const val TAG = "OtaUpdateWorker" }
}
