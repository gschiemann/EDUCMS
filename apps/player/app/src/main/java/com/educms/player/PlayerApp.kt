package com.educms.player

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.educms.player.crash.CrashUploader
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
        installCrashHandler()
        maybeEnableKioskHomeAlias()
        // v1.0.23 — Manager bootstrap now fires from MainActivity.onCreate
        // (foregrounded) instead of here. Reason: Android 11+ Background
        // Activity Launch (BAL) on Goodview's stripped TaurusOS silently
        // drops startActivity() calls from non-foregrounded contexts.
        // PackageInstaller's STATUS_PENDING_USER_ACTION → system Install
        // dialog requires a foregrounded Activity to launch on those
        // ROMs, so we moved the fire-site to MainActivity which IS the
        // foregrounded Activity.
        //
        // We intentionally do NOT fire it from PlayerApp anymore —
        // doing so causes a race where the bootstrap runs before
        // MainActivity comes up, the Install dialog gets dropped by
        // BAL, no error logged, no install happens.
        //
        // See MainActivity.onCreate's "Manager-install gate" block.
        PlayerLogger.i("PlayerApp", "All background services started successfully")
    }

    /**
     * v1.0.64 — enable the KioskHomeAlias (declared disabled in the
     * manifest) so the OS treats this Player as the HOME launcher.
     *
     * This is THE fix for "the OTA upgrade never fully works": once
     * Player is the home app, the OS itself returns to it after any
     * process death — including its own OTA self-update — as a
     * system-initiated launch that Android 14 BAL never blocks. No
     * receiver / FGS / watchdog activity-launch trick is needed (all
     * three were tried in v1.0.61/62 and all were BAL-blocked).
     *
     * GATED on device owner. We enable the HOME alias ONLY when the
     * Manager companion is the device owner — i.e. only on a
     * deliberately-provisioned EduCMS kiosk. On an OEM-CMS signage
     * box (Goodview / NovaStar / TCL) where we're a guest, Manager is
     * not device owner, the alias stays disabled, and we never
     * register as a launcher or risk displacing the vendor's CMS.
     * See the long comment in AndroidManifest.xml.
     *
     * Toggling our OWN component is always permitted; no permission
     * needed. isDeviceOwnerApp() for another package is also
     * unrestricted. Idempotent — safe to call on every process start.
     */
    private fun maybeEnableKioskHomeAlias() {
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE)
                as? android.app.admin.DevicePolicyManager ?: return
            val managerIsDeviceOwner =
                dpm.isDeviceOwnerApp("com.educms.manager") ||
                    dpm.isDeviceOwnerApp("com.educms.manager.debug")

            // The alias CLASS name is namespace-relative
            // (com.educms.player.KioskHomeAlias) — it does NOT pick up
            // the `.debug` applicationIdSuffix. The PACKAGE, though, is
            // the runtime applicationId (com.educms.player[.debug]).
            // Build the ComponentName from those two explicitly.
            val alias = android.content.ComponentName(
                packageName,
                "com.educms.player.KioskHomeAlias",
            )
            val pm = packageManager
            val current = pm.getComponentEnabledSetting(alias)

            if (managerIsDeviceOwner) {
                if (current != android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                    pm.setComponentEnabledSetting(
                        alias,
                        android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        android.content.pm.PackageManager.DONT_KILL_APP,
                    )
                    PlayerLogger.i("PlayerApp", "KioskHomeAlias ENABLED — Manager is device owner, Player is now a HOME candidate")
                }
            } else {
                // Defensive: if a device was de-provisioned (device
                // owner removed) we turn the alias back off so we
                // don't linger as an orphan launcher candidate.
                if (current == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                    pm.setComponentEnabledSetting(
                        alias,
                        android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        android.content.pm.PackageManager.DONT_KILL_APP,
                    )
                    PlayerLogger.i("PlayerApp", "KioskHomeAlias disabled — Manager is not device owner")
                }
            }
        } catch (e: Exception) {
            PlayerLogger.w("PlayerApp", "maybeEnableKioskHomeAlias failed: ${e.message}")
        }
    }

    /**
     * Capture fatal Kotlin/Java exceptions and POST them to the
     * /screens/:fp/crash-report endpoint so the dashboard surfaces
     * crashes without an operator having to upload diagnostics
     * manually. Best-effort; never blocks process death longer than
     * 5s. Fingerprint + apiRoot are read at crash-time (lazy) so we
     * don't have a stale snapshot from app boot.
     */
    private fun installCrashHandler() {
        try {
            CrashUploader.install(
                this,
                getApiRoot = { resolveApiRoot() },
                getFingerprint = { resolveFingerprint() },
            )
        } catch (e: Exception) {
            PlayerLogger.w("PlayerApp", "CrashUploader.install failed: ${e.message}")
        }
    }

    /**
     * Best-effort fingerprint resolution at crash-time. Mirrors the
     * web-side getDeviceFingerprint() — uses Settings.Secure.ANDROID_ID
     * with the "android-" prefix, falls back to "android-unknown".
     */
    @Suppress("DEPRECATION")
    private fun resolveFingerprint(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }
        return if (androidId.isNotBlank()) "android-$androidId" else "android-unknown"
    }

    /**
     * Read the api root the WebView is using (saved by the web
     * player into SharedPreferences via the setBootstrap bridge).
     * Falls back to BuildConfig.PLAYER_BASE_URL minus /player so
     * the crash uploader has SOMETHING to hit even on a fresh install
     * before the WebView has bootstrapped.
     */
    private fun resolveApiRoot(): String {
        val saved = applicationContext
            .getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            .getString("api_root", null)
        if (!saved.isNullOrBlank()) return saved.trimEnd('/').removeSuffix("/api/v1")
        return BuildConfig.PLAYER_BASE_URL
            .trimEnd('/')
            .removeSuffix("/player")
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
            // ALSO notify Manager APK if installed. Manager runs the
            // silent-install path (DEVICE_OWNER granted PackageInstaller
            // permission). On kiosks where Manager isn't installed
            // these broadcasts go nowhere — totally safe.
            triggerManagerOtaCheck(ctx)
        }

        /**
         * Cross-app broadcast to wake up Manager's OtaWorker on a
         * dashboard-driven update push. Tries both the production
         * (com.educms.manager) and debug (.debug) package suffixes
         * so dev kiosks running the debug Manager build still get
         * triggered.
         *
         * The receiver is permission-gated by HEALTH_PERMISSION
         * (signature-protected, same key only) so this can't be
         * spoofed by a third-party app on the device.
         *
         * Safe when Manager isn't installed — setPackage on a
         * non-existent package is a no-op delivery.
         */
        private fun triggerManagerOtaCheck(ctx: Context) {
            for (pkg in listOf("com.educms.manager", "com.educms.manager.debug")) {
                try {
                    val intent = Intent("com.educms.manager.TRIGGER_OTA_CHECK")
                        .setPackage(pkg)
                    ctx.sendBroadcast(intent, "com.educms.manager.HEALTH_PERMISSION")
                } catch (e: Exception) {
                    // SecurityException possible if Manager isn't installed
                    // and the permission isn't held — silent.
                    PlayerLogger.i("PlayerApp", "Manager OTA broadcast to $pkg skipped: ${e.message}")
                }
            }
        }
    }
}
