package com.educms.manager

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.educms.manager.crash.CrashUploader
import java.util.concurrent.TimeUnit

/**
 * Manager APK Application class. Two boot-time jobs:
 *
 *   1. Start WatchdogService — foreground service that polls Player's
 *      heartbeat every 30s and force-restarts Player if dead.
 *   2. Schedule periodic OtaWorker (every 6h) — backup path for OTA
 *      installs when the dashboard's "Push update" WebSocket
 *      doesn't reach us. Same cadence as Player's existing worker;
 *      both are idempotent when the API returns "uptoDate".
 *
 * Manager is a daemon, NOT a user-facing app. There's no MainActivity;
 * the only way Manager runs is:
 *   1. Receivers (BootReceiver, OtaTriggerReceiver) firing on system
 *      or cross-app events
 *   2. WatchdogService kept alive by foreground notification
 *   3. Cross-process content provider reads from Player
 *   4. WorkManager periodic schedule for OtaWorker
 */
class ManagerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "ManagerApp.onCreate — starting watchdog + scheduling OTA worker")
        // Crash handler FIRST so we capture errors during the rest of
        // app startup if anything throws.
        try { CrashUploader.install(this) } catch (e: Exception) {
            Log.w(TAG, "CrashUploader.install failed: ${e.message}")
        }
        startWatchdogService(this)
        scheduleOtaWorker(this)
    }

    companion object {
        private const val TAG = "ManagerApp"
        private const val PERIODIC_OTA_NAME = "edu-manager-ota-periodic"

        /**
         * Launches WatchdogService as a foreground service. Called
         * from onCreate, BootReceiver, and AdminReceiver.onEnabled.
         * Idempotent — re-calls just bump the existing service.
         */
        fun startWatchdogService(ctx: Context) {
            val intent = Intent(ctx, WatchdogService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "startWatchdogService failed: ${e.message}", e)
            }
        }

        /**
         * Schedule a 6-hour periodic OTA check. KEEP policy means
         * onCreate-on-app-restart doesn't reset the timer; the
         * existing schedule keeps running.
         */
        fun scheduleOtaWorker(ctx: Context) {
            try {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val req = PeriodicWorkRequestBuilder<OtaWorker>(6, TimeUnit.HOURS)
                    .setConstraints(constraints)
                    .setInitialDelay(5, TimeUnit.MINUTES)  // never block first boot
                    .build()
                WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                    PERIODIC_OTA_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    req,
                )
                Log.i(TAG, "Manager OTA worker scheduled (every 6h, network required)")
            } catch (e: Exception) {
                Log.w(TAG, "scheduleOtaWorker failed: ${e.message}", e)
            }
        }
    }
}
