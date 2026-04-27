package com.educms.player.heartbeat

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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
        // START_STICKY — Android restarts us with a null intent if the
        // process gets killed. Combined with PendingIntent rescheduling
        // in onTaskRemoved/onDestroy, this is belt-and-suspenders.
        return START_STICKY
    }

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
                tickWithWakeLock(apiRoot, fp)
            }
            // Backoff if we're failing — 30s baseline doubles to a 5min cap.
            val delayMs = if (consecutiveFailures > 3)
                minOf(30_000L * (1L shl minOf(consecutiveFailures - 3, 4)), 300_000L)
            else 30_000L
            delay(delayMs)
        }
    }

    private suspend fun tickWithWakeLock(apiRoot: String, fp: String) {
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
                    // Drain body so connection can be pooled.
                    conn.inputStream.use { it.readBytes() }
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

    companion object {
        private const val TAG = "HeartbeatService"
        private const val NOTIF_ID = 1001

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
    }
}
