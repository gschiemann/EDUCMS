package com.educms.player.heartbeat

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.educms.player.BuildConfig
import com.educms.player.MainActivity
import com.educms.player.PlayerApp
import com.educms.player.R
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Foreground service that keeps the player "alive" + visible to the
 * dashboard. Two responsibilities:
 *
 * 1) HEARTBEAT — every 30s, POST to /api/v1/screens/status/{fp} so the
 *    dashboard's auto-refreshing screen list flips the row to ONLINE
 *    (the API derives status from lastPingAt < 2min; see screens
 *    controller). Without an active ping the row goes OFFLINE within
 *    minutes of the player going idle, even when it's actually
 *    playing.
 *
 * 2) UPTIME — runs as a STARTED foreground service with the
 *    FOREGROUND_SERVICE permission. Android will not kill foreground
 *    services to reclaim memory the way it kills background ones,
 *    even on aggressive OEM forks (Xiaomi, Samsung, Vivo). Combined
 *    with the wake lock + restart-from-watchdog fallback, this gets
 *    us as close to '100% uptime' as Android lets you on real
 *    hardware.
 *
 * Failure handling:
 *   - Coroutine wrapped in try/catch; one failed ping never kills the
 *     loop. Failures are logged + counted; backoff doubles up to 5min
 *     after 3 consecutive failures so we don't hammer a down API.
 *   - Service.onTaskRemoved + onDestroy reschedule themselves via
 *     AlarmManager so even if the system or user kills the process
 *     it comes back within 60s.
 *   - PartialWakeLock is held only during the network call so we don't
 *     drain battery on tablets / phones running this.
 */
class HeartbeatService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var loopJob: Job? = null
    private var consecutiveFailures = 0

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "HeartbeatService.onCreate")
        PlayerLogger.i(TAG, "HeartbeatService started (register loop beginning)")
        startForegroundCompat()
        loopJob?.cancel()
        loopJob = scope.launch { runLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // v1.0.62 — post-install activity-launch trampoline.
        //
        // When MY_PACKAGE_REPLACED fires after an OTA install, the
        // system grants BAL EXEMPTION FOR FGS STARTS ONLY, not for
        // activity starts. BootReceiver therefore can't directly
        // startActivity(MainActivity) — Android 14 BAL rejects it
        // with `result code=102` (verified on emulator post-v1.0.61
        // install: activity start from BootReceiver was blocked 80 ms
        // after this FGS started successfully).
        //
        // BUT: this FGS received the 20-second BAL grant from the
        // MY_PACKAGE_REPLACED broadcast (logged as `tempAllowListReason:
        // MY_PACKAGE_REPLACED ... duration:20000`). Activity launches
        // from a FGS-in-foreground-state inside that window ARE allowed.
        //
        // So BootReceiver passes EXTRA_LAUNCH_MAIN=true when starting
        // this service after MY_PACKAGE_REPLACED. We honor it here on
        // the very first onStartCommand after process spawn (guarded
        // with hasAutoLaunchedMain so the regular periodic restarts
        // don't yank focus from the operator).
        if (!hasAutoLaunchedMain && intent?.getBooleanExtra(EXTRA_LAUNCH_MAIN, false) == true) {
            hasAutoLaunchedMain = true
            try {
                val launch = Intent(this, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                }
                startActivity(launch)
                PlayerLogger.i(TAG, "launched MainActivity from FGS BAL grant (post-MY_PACKAGE_REPLACED)")
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "MainActivity launch from FGS failed: ${e.message}")
            }
        }
        // START_STICKY — Android restarts us with a null intent if the
        // process gets killed. Combined with PendingIntent rescheduling
        // in onTaskRemoved/onDestroy, this is belt-and-suspenders.
        return START_STICKY
    }

    /** v1.0.62 — track first auto-launch so periodic restarts don't yank
     *  focus from the operator. Process-scoped; resets on every fresh
     *  Player process (which is the only time we WANT to auto-launch). */
    private var hasAutoLaunchedMain = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        // User swiped the recent-apps card. Schedule ourselves to come
        // back in 60s — Android 12+ disallows direct startService from
        // background, so AlarmManager + a broadcast receiver is the
        // canonical workaround.
        rescheduleSelf(60_000)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Log.w(TAG, "HeartbeatService.onDestroy — scheduling restart")
        PlayerLogger.w(TAG, "HeartbeatService destroyed — rescheduling in 30s")
        rescheduleSelf(30_000)
        loopJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun rescheduleSelf(delayMs: Long) {
        try {
            val intent = Intent(this, HeartbeatService::class.java)
            val pi = PendingIntent.getForegroundService(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val triggerAt = SystemClock.elapsedRealtime() + delayMs
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to reschedule HeartbeatService", e)
        }
    }

    private fun startForegroundCompat() {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif: Notification = NotificationCompat.Builder(this, PlayerApp.CHANNEL_HEARTBEAT)
            .setSmallIcon(android.R.drawable.presence_online)
            .setContentTitle("Player connected")
            .setContentText("EduCMS Player ${BuildConfig.VERSION_NAME}")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        startForeground(NOTIF_ID, notif)
    }

    private suspend fun runLoop() {
        val ctx = applicationContext
        val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        while (scope.isActive) {
            val fp = prefs.getString("device_fingerprint", null)
            val apiRoot = prefs.getString("api_root", null)
            if (!fp.isNullOrBlank() && !apiRoot.isNullOrBlank()) {
                tickWithWakeLock(apiRoot, fp, prefs)
            }
            // Backoff if we're failing — 30s baseline doubles to a 5min cap.
            val delayMs = if (consecutiveFailures > 3)
                minOf(30_000L * (1L shl minOf(consecutiveFailures - 3, 4)), 300_000L)
            else 30_000L
            delay(delayMs)
        }
    }

    private suspend fun tickWithWakeLock(apiRoot: String, fp: String, prefs: SharedPreferences) {
        val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edu:heartbeat")
        try {
            wl.acquire(8_000)
            withContext(Dispatchers.IO) {
                // Pass app version on every heartbeat so the dashboard
                // sees the kiosk's current build within ~30s instead of
                // waiting on the 6h /update-check cycle. Operator
                // (2026-04-27): "we shouldnt have to wait 6 hours to
                // see an updated version, why not grab that everytime
                // the screen checks in?"
                val vn = java.net.URLEncoder.encode(BuildConfig.VERSION_NAME, "UTF-8")
                val vc = BuildConfig.VERSION_CODE
                val url = URL("$apiRoot/api/v1/screens/status/$fp?v=$vn&vc=$vc")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 6_000
                    readTimeout = 6_000
                }
                val code = conn.responseCode
                if (code in 200..299) {
                    consecutiveFailures = 0
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    handleHeartbeatResponse(body, prefs)
                } else {
                    consecutiveFailures += 1
                    Log.w(TAG, "Heartbeat returned HTTP $code (consecutive=$consecutiveFailures)")
                    PlayerLogger.w(TAG, "Heartbeat tick failed: HTTP $code (consecutive=$consecutiveFailures)")
                }
            }
        } catch (e: Exception) {
            consecutiveFailures += 1
            Log.w(TAG, "Heartbeat failed (consecutive=$consecutiveFailures): ${e.message}")
            PlayerLogger.w(TAG, "Heartbeat tick exception (consecutive=$consecutiveFailures): ${e.message}")
        } finally {
            try { if (wl.isHeld) wl.release() } catch (_: Exception) {}
        }
    }

    private fun handleHeartbeatResponse(body: String, prefs: SharedPreferences) {
        if (body.isBlank()) return
        try {
            val json = JSONObject(body)
            if (!json.optBoolean("forceUpdatePending", false)) return

            val pendingAt = json.optString("forceUpdatePendingAt", "").trim()
            val now = System.currentTimeMillis()
            val lastKey = prefs.getString(KEY_LAST_FORCE_OTA_KEY, null)
            val lastAt = prefs.getLong(KEY_LAST_FORCE_OTA_AT, 0L)

            if (pendingAt.isNotBlank()) {
                if (pendingAt == lastKey) return
            } else if (now - lastAt < FORCE_OTA_MIN_INTERVAL_MS) {
                return
            }

            prefs.edit()
                .putString(KEY_LAST_FORCE_OTA_KEY, pendingAt.ifBlank { "legacy-$now" })
                .putLong(KEY_LAST_FORCE_OTA_AT, now)
                .apply()

            PlayerLogger.i(TAG, "Heartbeat detected forceUpdatePending; firing OTA check")
            PlayerApp.fireOtaCheckNow(applicationContext)
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Heartbeat response parse failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "HeartbeatService"
        private const val NOTIF_ID = 1001
        private const val KEY_LAST_FORCE_OTA_KEY = "last_force_ota_key"
        private const val KEY_LAST_FORCE_OTA_AT = "last_force_ota_at"
        private const val FORCE_OTA_MIN_INTERVAL_MS = 60_000L

        /**
         * v1.0.62 — when BootReceiver handled MY_PACKAGE_REPLACED, it
         * starts this FGS with EXTRA_LAUNCH_MAIN=true so the service
         * (which inherits the FGS BAL grant) can launch MainActivity
         * on behalf of the receiver (which can't). See onStartCommand.
         */
        const val EXTRA_LAUNCH_MAIN = "edu.educms.player.LAUNCH_MAIN_AFTER_START"

        /**
         * Convenience entrypoint — call from PlayerApp.onCreate and
         * BootReceiver to ensure the service is running. Idempotent.
         */
        fun ensureRunning(ctx: Context) {
            val intent = Intent(ctx, HeartbeatService::class.java)
            try {
                ContextCompat.startForegroundService(ctx, intent)
            } catch (e: Exception) {
                Log.w(TAG, "ensureRunning failed", e)
            }
        }

        /**
         * Same as ensureRunning but tags the start intent so onStartCommand
         * also brings the MainActivity to the foreground. Use from
         * BootReceiver when it handled MY_PACKAGE_REPLACED — the BAL
         * grant flows from the receiver to the FGS, and the FGS can then
         * launch the activity that the receiver itself cannot.
         */
        fun ensureRunningAndLaunchMain(ctx: Context) {
            val intent = Intent(ctx, HeartbeatService::class.java).apply {
                putExtra(EXTRA_LAUNCH_MAIN, true)
            }
            try {
                ContextCompat.startForegroundService(ctx, intent)
            } catch (e: Exception) {
                Log.w(TAG, "ensureRunningAndLaunchMain failed", e)
            }
        }
    }
}
