package com.educms.manager

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.educms.manager.rollback.InstallState
import com.educms.manager.rollback.RollbackInstaller

/**
 * The actual watchdog — polls PlayerHealthProvider every 30s and
 * restarts Player if heartbeat goes stale.
 *
 * State machine:
 *   - "fresh" — heartbeat row's timestamp is < 90s old → ok
 *   - "stale" — timestamp ≥ 90s; counter increments
 *   - 3 consecutive stale ticks → force-restart Player
 *
 * Why 90s and 3 ticks? Each Player heartbeat is 30s apart. One
 * missed heartbeat (60s old) is normal jitter. Two missed (90s)
 * starts to look concerning. Three consecutive 90s+ readings = 3
 * minutes of silence, which is way past anything explainable by
 * GC pause or transient network glitch — Player is genuinely dead.
 *
 * Recovery action: launch the Player MainActivity via a regular
 * `startActivity` intent. Android handles the rest:
 *   - If the process is alive but UI hung → relaunches activity
 *   - If process is dead → spawns a new one
 *   - If app uninstalled → fails silently; we'll try again next tick
 *
 * Foreground service is REQUIRED on Android 8+. Without the
 * notification, the OS kills us within minutes. The notification is
 * intentionally low-priority and uninformative — the operator
 * doesn't need to see it on a kiosk-mounted display.
 */
class WatchdogService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var staleStreak: Int = 0
    private var lastSeenTimestamp: Long = 0L
    private var lastSeenVersion: String? = null

    private val tick = object : Runnable {
        override fun run() {
            try {
                checkHeartbeat()
            } catch (e: Exception) {
                Log.w(TAG, "watchdog tick threw: ${e.message}", e)
            }
            handler.postDelayed(this, TICK_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "WatchdogService.onCreate")
        startForegroundWithNotification()
        // Kick the loop on the main looper. Heartbeat checks are
        // ContentProvider reads + occasional startActivity calls,
        // both fast — no need for a separate thread.
        handler.postDelayed(tick, FIRST_TICK_DELAY_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // STICKY → if Android kills us for memory, restart on
        // pressure relief. The whole point of Manager is "always
        // running"; we accept the OS overhead.
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(tick)
        Log.w(TAG, "WatchdogService.onDestroy — Manager will restart via STICKY")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun checkHeartbeat() {
        val (ts, version) = readHeartbeat()

        // Phase 2 — post-install grace window check. If we have a
        // pending install and the grace window expired with no fresh
        // heartbeat from the NEW version, trigger rollback. We check
        // BEFORE the regular liveness check so a bad first-boot
        // doesn't get classified as "missed heartbeats → force restart"
        // (forcing restart of a broken APK doesn't help; rollback does).
        val pendingVc = InstallState.pendingVc(applicationContext)
        if (pendingVc > 0) {
            val playerVersionCode = readInstalledPlayerVersionCode()
            val sawNewBoot = (ts > 0L) &&
                (System.currentTimeMillis() - ts <= STALE_THRESHOLD_MS) &&
                (playerVersionCode == pendingVc)
            if (sawNewBoot) {
                // Fresh heartbeat from the NEW versionCode → first-boot
                // healthy. Promote to last-known-good and prune.
                Log.i(TAG, "post-install: heartbeat from new vc=$pendingVc detected → promoting to last-known-good")
                InstallState.promoteToGood(applicationContext, pendingVc)
                com.educms.manager.rollback.ApkArchive.pruneOld(applicationContext)
            } else if (InstallState.isPendingExpired(applicationContext)) {
                // Grace window expired with no healthy heartbeat from
                // the new version — bad install. Roll back.
                val prevVc = InstallState.pendingPrevVc(applicationContext)
                Log.e(TAG, "post-install: grace window expired (pending=$pendingVc prev=$prevVc) — rolling back")
                RollbackInstaller.rollback(
                    applicationContext,
                    badVc = pendingVc,
                    previousVc = prevVc,
                    reason = "no heartbeat in ${InstallState.GRACE_WINDOW_MS / 1000}s post-install (current vc=$playerVersionCode)",
                )
                // Reset streak so the next-tick force-restart logic
                // doesn't pile on top of a rollback already in flight.
                staleStreak = 0
                return
            }
            // If still inside grace window, fall through to the regular
            // liveness check — it's fine to count missed heartbeats
            // here; they'll be irrelevant once the grace check fires.
        }

        if (ts == 0L) {
            // No heartbeat ever recorded. Either Player isn't
            // installed, or it hasn't called us yet. Treat as stale
            // but don't crash-restart Player on first tick after our
            // own boot — give it 90s of grace before the streak
            // starts counting.
            Log.i(TAG, "no heartbeat recorded yet (Player may not be running or not yet upgraded)")
            staleStreak += 1
        } else {
            val ageMs = System.currentTimeMillis() - ts
            if (ageMs <= STALE_THRESHOLD_MS) {
                if (staleStreak > 0) {
                    Log.i(TAG, "heartbeat fresh again (age=${ageMs}ms version=$version) — clearing streak")
                }
                staleStreak = 0
                lastSeenTimestamp = ts
                lastSeenVersion = version
            } else {
                staleStreak += 1
                Log.w(TAG, "heartbeat STALE (age=${ageMs}ms version=$version streak=$staleStreak)")
            }
        }

        if (staleStreak >= STREAK_LIMIT) {
            Log.e(TAG, "Player has missed $staleStreak consecutive heartbeats — force-restart")
            staleStreak = 0
            forceRestartPlayer()
        }
    }

    /**
     * Read the INSTALLED Player APK's versionCode via PackageManager.
     * Used to detect "did first-boot of the new version succeed" —
     * comparing this to InstallState.pendingVc tells us whether
     * the new APK actually got loaded by the system.
     */
    @Suppress("DEPRECATION")
    private fun readInstalledPlayerVersionCode(): Int {
        return try {
            val pkg = pickPlayerPackage(packageManager) ?: return 0
            packageManager.getPackageInfo(pkg, 0).versionCode
        } catch (e: Exception) {
            0
        }
    }

    private fun readHeartbeat(): Pair<Long, String?> {
        return try {
            val cursor = contentResolver.query(
                PlayerHealthProvider.URI_HEARTBEAT,
                null, null, null, null,
            ) ?: return 0L to null
            cursor.use { c ->
                if (!c.moveToFirst()) return 0L to null
                val ts = c.getLong(c.getColumnIndexOrThrow(PlayerHealthProvider.COL_TIMESTAMP))
                val version = c.getString(c.getColumnIndexOrThrow(PlayerHealthProvider.COL_VERSION_NAME))
                ts to version
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "no permission to read PlayerHealthProvider — Player + Manager signed with different keys?")
            0L to null
        } catch (e: Exception) {
            Log.w(TAG, "readHeartbeat failed: ${e.message}")
            0L to null
        }
    }

    /**
     * Boot the Player MainActivity. We don't try to be clever about
     * "is it already running?" — just launch the intent. Android
     * deduplicates via the activity's launchMode=singleTask
     * (Player declares this), so a duplicate launch on a healthy
     * Player is a no-op.
     */
    private fun forceRestartPlayer() {
        val pm = packageManager
        val pkg = pickPlayerPackage(pm)
        if (pkg == null) {
            Log.e(TAG, "no Player package found — install com.educms.player or com.educms.player.debug")
            return
        }
        val launchIntent = pm.getLaunchIntentForPackage(pkg)
        if (launchIntent == null) {
            Log.e(TAG, "$pkg has no launcher activity — broken install?")
            return
        }
        launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        try {
            startActivity(launchIntent)
            Log.i(TAG, "launched $pkg (recovery)")
        } catch (e: Exception) {
            Log.e(TAG, "startActivity threw: ${e.message}", e)
        }
    }

    /**
     * Player has TWO possible package ids: production
     * (com.educms.player) and debug (com.educms.player.debug). On
     * a real kiosk only one is installed; pick whichever is there.
     * Falls back to production if both somehow exist.
     */
    private fun pickPlayerPackage(pm: PackageManager): String? {
        val candidates = listOf(BuildConfig.PLAYER_PACKAGE, "${BuildConfig.PLAYER_PACKAGE}.debug")
        for (c in candidates) {
            try {
                pm.getPackageInfo(c, 0)
                return c
            } catch (_: PackageManager.NameNotFoundException) { /* try next */ }
        }
        return null
    }

    private fun startForegroundWithNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.watchdog_notif_channel),
                NotificationManager.IMPORTANCE_LOW,
            )
            nm.createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(getString(R.string.watchdog_notif_title))
            .setContentText(getString(R.string.watchdog_notif_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        startForeground(NOTIF_ID, notification)
    }

    companion object {
        private const val TAG = "WatchdogService"
        private const val CHANNEL_ID = "manager-watchdog"
        private const val NOTIF_ID = 1001

        // 30s aligns with Player's heartbeat cadence
        private const val TICK_INTERVAL_MS = 30_000L
        // First tick is short — don't make the operator wait a full
        // 30s to see anything happen.
        private const val FIRST_TICK_DELAY_MS = 5_000L
        // 90s = "missed 3 heartbeats" tolerance per tick
        private const val STALE_THRESHOLD_MS = 90_000L
        // 3 stale ticks in a row → action (3 × 30s = 90s of pure
        // silence, on top of the 90s tolerance per check, so total
        // patience is ~3 minutes of confirmed Player downtime)
        private const val STREAK_LIMIT = 3
    }
}
