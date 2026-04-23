package com.educms.player

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.logging.PlayerLoggerCtx
import com.educms.player.ota.OtaUpdateWorker
import com.educms.player.usb.UsbCacheIndex
import com.educms.player.watchdog.Watchdog
import java.util.concurrent.TimeUnit

/**
 * Boot-time wiring for every long-running player background job.
 *
 * Lifecycle on cold start:
 *   1. ensureHeartbeatChannel — notification channels for the foreground
 *      services. Must exist before startForegroundService is called.
 *   2. UsbCacheIndex.reload — hydrates the USB-cache lookup so the
 *      WebView starts intercepting asset GETs immediately, even on a
 *      kiosk that powered up offline mid-emergency.
 *   3. HeartbeatService.ensureRunning — starts the foreground heartbeat
 *      so the dashboard sees ONLINE within seconds.
 *   4. Watchdog.arm — alarm-manager fallback in case the system kills us
 *      anyway (Doze, OOM, OEM battery saver).
 *   5. WorkManager.enqueueUniquePeriodicWork — OtaUpdateWorker every 6h.
 *      `KEEP` policy means re-running this method on every Application
 *      onCreate is safe — the schedule isn't reset.
 */
class PlayerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialise the file logger FIRST so every subsequent call can write.
        // PlayerLoggerCtx holds a reference so the logger can resolve the
        // screen fingerprint for upload URLs without a constructor Context.
        PlayerLoggerCtx.appCtx = applicationContext
        PlayerLogger.init(applicationContext)

        PlayerLogger.i(
            "PlayerApp",
            "EduCMS Player ${BuildConfig.VERSION_NAME} booting " +
            "(SDK ${Build.VERSION.SDK_INT}, ${Build.MANUFACTURER} ${Build.MODEL})",
        )
        Log.i(
            "PlayerApp",
            "EduCMS Player ${BuildConfig.VERSION_NAME} starting (SDK ${Build.VERSION.SDK_INT}, ${Build.MANUFACTURER} ${Build.MODEL})",
        )
        ensureNotificationChannels()
        UsbCacheIndex.reload(this)
        HeartbeatService.ensureRunning(this)
        Watchdog.arm(this)
        scheduleOtaWorker()
        PlayerLogger.i("PlayerApp", "All background services started successfully")
    }

    private fun ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_HEARTBEAT, "Player heartbeat", NotificationManager.IMPORTANCE_MIN).apply {
                    description = "Keeps the EduCMS player connected to the server."
                    setShowBadge(false)
                },
            )
            nm.createNotificationChannel(
                NotificationChannel("ota", "Player updates", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Notifies when a new player version is ready to install."
                },
            )
        }
    }

    private fun scheduleOtaWorker() {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val req = PeriodicWorkRequestBuilder<OtaUpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setInitialDelay(2, TimeUnit.MINUTES)  // never block first boot
                .build()
            WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "edu-ota-check",
                ExistingPeriodicWorkPolicy.KEEP,
                req,
            )
            PlayerLogger.i("PlayerApp", "OTA worker scheduled (every 6h, requires network)")
            Log.i("PlayerApp", "OTA worker scheduled (every 6h, requires network)")
        } catch (e: Exception) {
            PlayerLogger.w("PlayerApp", "Failed to schedule OTA worker", e)
            Log.w("PlayerApp", "Failed to schedule OTA worker", e)
        }
    }

    companion object {
        const val CHANNEL_HEARTBEAT = "edu_cms_player_heartbeat"

        /**
         * Fire a one-time OTA check NOW, out of band from the 6h periodic
         * worker. Used by the "Push APK update" button in the dashboard,
         * which publishes a CHECK_FOR_UPDATES WebSocket message the web
         * player receives + relays through the JS bridge
         * (WebAppBridge.checkForUpdates → this call).
         * REPLACE policy means repeated button clicks don't pile up queued
         * checks — only the most recent request runs.
         */
        fun fireOtaCheckNow(ctx: Context) {
            try {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val req = OneTimeWorkRequestBuilder<OtaUpdateWorker>()
                    .setConstraints(constraints)
                    .build()
                WorkManager.getInstance(ctx).enqueueUniqueWork(
                    "edu-ota-check-oneshot",
                    ExistingWorkPolicy.REPLACE,
                    req,
                )
                PlayerLogger.i("PlayerApp", "OTA one-shot check enqueued (manual trigger via dashboard)")
                Log.i("PlayerApp", "OTA one-shot check enqueued (manual trigger)")
            } catch (e: Exception) {
                PlayerLogger.w("PlayerApp", "fireOtaCheckNow failed", e)
                Log.w("PlayerApp", "fireOtaCheckNow failed", e)
            }
        }
    }
}
