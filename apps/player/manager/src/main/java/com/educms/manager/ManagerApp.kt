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

        // v1.0.7 — Proactive install-permission prompt. Operator
        // (2026-04-29): "it did not ask me fo rthe unkown
        // permissions for the manager only for the player when i
        // installed". Without this, the FIRST install attempt
        // hits InstallPromptActivity's permission gate, deep-
        // links to Settings mid-flow — the operator's "push
        // update from dashboard" UX needs an extra round-trip
        // and a confused "why is Settings opening?" moment.
        //
        // Posting the prompt notification on cold boot lets the
        // operator grant Manager's install-unknown-apps perm
        // upfront, BEFORE any install fires. Once granted,
        // every future Push from the dashboard goes notification
        // → Install dialog → tap → installed. One tap per update,
        // no Settings detour.
        //
        // Skipped when the permission is already granted.
        maybePromptForInstallPermission(this)

        // ONE RELEASE UNIT (2026-11-08): the Manager no longer updates itself.
        // It ships inside the Player APK and the Player installs it when the
        // bundled versionCode is newer (ManagerUpdatePolicy). The periodic
        // self-update job Manager ≤ 1.0.24 persisted in WorkManager survives
        // the upgrade to this build, so it is CANCELLED here, on every boot —
        // otherwise it would keep polling /manager-update-check every 30 min
        // for the rest of the panel's life.
        cancelLegacySelfUpdate(this)

        // The one periodic worker left: the Player lane, which only
        // bootstraps a Player onto a kiosk that has none (OtaWorker).
        scheduleOtaWorker(this)

        // Bootstrap-fire the Player lane on cold launch — a fresh sideload of
        // the Manager onto a kiosk with no Player should not wait out the
        // periodic initial delay. A no-op once a Player is installed.
        triggerImmediateOtaCheck(this)

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

    /**
     * v1.0.7 — Post a high-priority notification deep-linking to
     * Manager's "Install unknown apps" Settings page if the perm
     * isn't already granted. Idempotent — Android dedupes by
     * INSTALL_PROMPT_NOTIF_ID + INSTALL_PROMPT_CHANNEL.
     *
     * Why this exists: the Player has its own install-unknown-apps
     * dialog gate built into MainActivity (v1.0.23+). Manager has
     * NO Activity equivalent — so until v1.0.7 the operator never
     * got asked to grant Manager the permission, and the first
     * install attempt would mysteriously deep-link to Settings
     * mid-push. This notification surfaces the request the moment
     * Manager boots so it gets handled before any push fires.
     */
    private fun maybePromptForInstallPermission(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (ctx.packageManager.canRequestPackageInstalls()) return

        try {
            // Channel must exist; OtaInstallReceiver creates it too —
            // calling createNotificationChannel twice is idempotent.
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
                as android.app.NotificationManager
            val channel = android.app.NotificationChannel(
                PERMISSION_NOTIF_CHANNEL,
                ctx.getString(R.string.updates_notif_channel),
                android.app.NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = ctx.getString(R.string.permission_notif_channel_description)
            }
            nm.createNotificationChannel(channel)

            val settingsIntent = android.content.Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(android.net.Uri.parse("package:${ctx.packageName}"))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            val pi = android.app.PendingIntent.getActivity(
                ctx,
                PERMISSION_NOTIF_ID,
                settingsIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                    android.app.PendingIntent.FLAG_IMMUTABLE,
            )

            val notification = androidx.core.app.NotificationCompat.Builder(ctx, PERMISSION_NOTIF_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle(ctx.getString(R.string.permission_notif_title))
                .setContentText(ctx.getString(R.string.permission_notif_text))
                .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(
                    ctx.getString(R.string.permission_notif_big_text)
                ))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_RECOMMENDATION)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setOngoing(true)  // can't dismiss until granted
                .build()
            nm.notify(PERMISSION_NOTIF_ID, notification)
            Log.i(TAG, "posted proactive install-permission prompt notification")
        } catch (e: Exception) {
            Log.w(TAG, "maybePromptForInstallPermission failed: ${e.message}", e)
        }
    }

    companion object {
        private const val TAG = "ManagerApp"
        private const val PERIODIC_OTA_NAME = "edu-manager-ota-periodic"
        // v1.0.7 — proactive install-permission notification ids.
        // Channel matches OtaInstallReceiver's so both notifications
        // are grouped under one "VenueOS Updates" category in Settings.
        private const val PERMISSION_NOTIF_CHANNEL = "edu_install_prompt"
        private const val PERMISSION_NOTIF_ID = 92482

        /**
         * Launches WatchdogService as a foreground service. Called
         * from onCreate and BootReceiver.
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
         * ONE RELEASE UNIT (2026-11-08) — cancel the self-update lane Manager
         * ≤ 1.0.24 persisted in WorkManager (`edu-manager-self-update-periodic`
         * every 30 min, plus its one-shot). Idempotent; a name that is not
         * enqueued is a no-op. The worker class stays as a landing pad so an
         * already-scheduled tick that fires before this cancel does nothing
         * (ManagerSelfUpdateWorker).
         */
        fun cancelLegacySelfUpdate(ctx: Context) {
            try {
                val wm = WorkManager.getInstance(ctx)
                for (name in ManagerUpdatePolicy.LEGACY_SELF_UPDATE_WORK_NAMES) {
                    wm.cancelUniqueWork(name)
                }
                Log.i(TAG, "legacy Manager self-update work cancelled (${ManagerUpdatePolicy.LEGACY_SELF_UPDATE_WORK_NAMES.joinToString()}) — the Player carries the Manager")
            } catch (e: Exception) {
                Log.w(TAG, "cancelLegacySelfUpdate failed: ${e.message}", e)
            }
        }
    }
}
