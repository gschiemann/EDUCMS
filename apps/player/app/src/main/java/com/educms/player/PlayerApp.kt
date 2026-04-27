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
import com.educms.player.heartbeat.ManagerHeartbeatPublisher
import com.educms.player.logging.PlayerLogger
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
        // Callers that invoke PlayerLogger.uploadRecent(...) pass the screen
        // fingerprint explicitly — no need for a static Context holder.
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
        startManagerHeartbeat()
        PlayerLogger.i("PlayerApp", "All background services started successfully")
    }

    /**
     * Starts the cross-app heartbeat publisher. Writes a row to the
     * Manager APK's ContentProvider every 30s so Manager's watchdog
     * can detect a dead Player and force-restart it.
     *
     * Safe even when Manager isn't installed yet — the publisher
     * silently no-ops in that case (the day Manager IS installed,
     * heartbeats start flowing without needing a Player update).
     *
     * Stored on the Application instance so the publisher's Handler
     * is rooted in the app process and survives Activity destruction.
     */
    private var managerHeartbeat: ManagerHeartbeatPublisher? = null
    private fun startManagerHeartbeat() {
        try {
            val pub = ManagerHeartbeatPublisher(applicationContext)
            pub.start()
            managerHeartbeat = pub
            PlayerLogger.i("PlayerApp", "Manager heartbeat publisher started")
        } catch (e: Exception) {
            PlayerLogger.w("PlayerApp", "Manager heartbeat publisher failed to start", e)
        }
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
