package com.educms.manager

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
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
        Log.i(TAG, "ManagerApp.onCreate — starting watchdog + scheduling OTA workers")
        // Crash handler FIRST so we capture errors during the rest of
        // app startup if anything throws.
        try { CrashUploader.install(this) } catch (e: Exception) {
            Log.w(TAG, "CrashUploader.install failed: ${e.message}")
        }
        startWatchdogService(this)

        // Two periodic workers: Player OTA (existing) + Manager self-
        // update (NEW in v1.0.2). Both run on independent schedules,
        // both gracefully no-op when there's nothing to install.
        scheduleOtaWorker(this)
        scheduleManagerSelfUpdateWorker(this)

        // Bootstrap-fire BOTH workers on cold launch — covers two
        // cases the periodic schedule alone misses:
        //   1. Fresh install (Manager just sideloaded). The periodic
        //      worker has its initial delay; we need an immediate
        //      check so Player auto-installs without waiting.
        //   2. Post-install warm boot (Manager just self-updated to a
        //      new version). The new version's onCreate fires this,
        //      which immediately probes for ANOTHER update — closes
        //      the loop on multi-step upgrades within a single boot.
        triggerImmediateOtaCheck(this)
        triggerImmediateManagerSelfUpdate(this)

        if (!isPlayerInstalled()) {
            // Single-sideload UX (matches Yodeck's pattern): the
            // bootstrap-fire above already kicks the Player install,
            // this log is just diagnostic.
            Log.i(TAG, "Player not installed yet — bootstrap OTA fired (above)")
        }
    }

    private fun isPlayerInstalled(): Boolean {
        val pm = packageManager
        for (pkg in listOf(BuildConfig.PLAYER_PACKAGE, "${BuildConfig.PLAYER_PACKAGE}.debug")) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true
            } catch (_: Exception) { /* not installed */ }
        }
        return false
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
         * One-shot OtaWorker fire for the bootstrap case (Player not
         * installed yet on a freshly-sideloaded Manager). REPLACE
         * policy is fine — if a previous bootstrap is somehow still
         * running, fold into a new one.
         */
        fun triggerImmediateOtaCheck(ctx: Context) {
            try {
                val constraints = androidx.work.Constraints.Builder()
                    .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                    .build()
                val req = OneTimeWorkRequestBuilder<OtaWorker>()
                    .setConstraints(constraints)
                    .build()
                WorkManager.getInstance(ctx).enqueueUniqueWork(
                    "edu-manager-ota-bootstrap",
                    ExistingWorkPolicy.REPLACE,
                    req,
                )
                Log.i(TAG, "bootstrap OtaWorker enqueued (one-shot)")
            } catch (e: Exception) {
                Log.w(TAG, "triggerImmediateOtaCheck failed: ${e.message}", e)
            }
        }

        /**
         * Schedule the Player OTA periodic worker.
         *
         * 2026-04-28 — dropped from 6h → 30 min so a published Player
         * release reaches kiosks within an hour worst-case.
         * Operator's lived experience with 16 sideloads says the 6h
         * cadence was effectively never (since the WS push-trigger
         * has been unreliable; the periodic was the real backbone
         * but ran too rarely).
         *
         * Use REPLACE policy on upgrade so the cadence change
         * actually takes effect for kiosks that already had the 6h
         * KEEP-pinned schedule — without REPLACE, ManagerApp.onCreate
         * sees the existing job and leaves the old cadence in place
         * forever. The trade-off: REPLACE bumps the next-run time
         * out by the new initial delay (90s), which is acceptable.
         */
        fun scheduleOtaWorker(ctx: Context) {
            try {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val req = PeriodicWorkRequestBuilder<OtaWorker>(30, TimeUnit.MINUTES)
                    .setConstraints(constraints)
                    .setInitialDelay(90, TimeUnit.SECONDS)
                    .build()
                WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                    PERIODIC_OTA_NAME,
                    ExistingPeriodicWorkPolicy.REPLACE,
                    req,
                )
                Log.i(TAG, "Manager Player-OTA worker scheduled (every 30min, network required)")
            } catch (e: Exception) {
                Log.w(TAG, "scheduleOtaWorker failed: ${e.message}", e)
            }
        }

        /**
         * Schedule the Manager-self-update periodic worker.
         *
         * Operator (2026-04-28): "i dont want to side load any
         * fucking thing after this next build". 30-min cadence
         * matches the Player schedule so both stay current at
         * roughly the same speed.
         *
         * REPLACE policy so future cadence changes propagate without
         * needing to wait for the existing schedule to expire.
         */
        fun scheduleManagerSelfUpdateWorker(ctx: Context) {
            try {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val req = PeriodicWorkRequestBuilder<ManagerSelfUpdateWorker>(30, TimeUnit.MINUTES)
                    .setConstraints(constraints)
                    .setInitialDelay(120, TimeUnit.SECONDS)  // staggered 30s after Player OTA
                    .build()
                WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                    PERIODIC_MGR_SELF_NAME,
                    ExistingPeriodicWorkPolicy.REPLACE,
                    req,
                )
                Log.i(TAG, "Manager self-update worker scheduled (every 30min, network required)")
            } catch (e: Exception) {
                Log.w(TAG, "scheduleManagerSelfUpdateWorker failed: ${e.message}", e)
            }
        }

        /**
         * One-shot Manager self-update fire — used on cold launch +
         * boot + dashboard push. REPLACE policy so repeated triggers
         * fold into a single in-flight check.
         */
        fun triggerImmediateManagerSelfUpdate(ctx: Context) {
            try {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val req = OneTimeWorkRequestBuilder<ManagerSelfUpdateWorker>()
                    .setConstraints(constraints)
                    .build()
                WorkManager.getInstance(ctx).enqueueUniqueWork(
                    "edu-manager-self-update-oneshot",
                    ExistingWorkPolicy.REPLACE,
                    req,
                )
                Log.i(TAG, "Manager self-update oneshot enqueued")
            } catch (e: Exception) {
                Log.w(TAG, "triggerImmediateManagerSelfUpdate failed: ${e.message}", e)
            }
        }

        private const val PERIODIC_MGR_SELF_NAME = "edu-manager-self-update-periodic"
    }
}
