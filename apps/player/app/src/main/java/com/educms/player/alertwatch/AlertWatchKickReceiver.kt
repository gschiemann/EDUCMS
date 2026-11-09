package com.educms.player.alertwatch

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger

/**
 * THE MANAGER'S KICK (2026-11-08, Manager wave 5; life safety, CHANGE class).
 *
 * The companion Manager's `AlertWatchWatchdog` sends ONE explicit, signature-
 * permission broadcast here when the native alert watch has not stamped for
 * minutes while the panel is dark. Two steps, both of which can only START
 * the watch:
 *
 *   • `rearm`        — [NativeAlertWatch.ensureStarted]: register the screen
 *                      on/off receiver if it is missing and kick the loop.
 *                      Idempotent; one binder call when the panel is on.
 *   • `restart-host` — the same, after [HeartbeatService.ensureRunning]: the
 *                      foreground service that hosts the watch (its onCreate
 *                      runs ensureStarted). A service already running is
 *                      re-delivered an intent and nothing else happens.
 *
 * ⚠️ NEVER the Activity. `MainActivity`'s manifest `turnScreenOn` would light a
 * scheduled-dark panel for a non-alert reason; the owner's sleep rules forbid
 * that, and a dead Player PROCESS is the liveness watchdog's job, not this
 * receiver's. ⚠️ NEVER the hold: nothing here can raise, lower or delay an
 * alert — it only makes sure the thing that may RAISE is running.
 *
 * Manifest: exported, `android:permission="com.educms.manager.HEALTH_PERMISSION"`
 * (signature), so only a package signed with our key can reach it.
 */
class AlertWatchKickReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val app = context.applicationContext
        val step = intent.getStringExtra(EXTRA_STEP)?.takeIf { it == STEP_REARM || it == STEP_RESTART_HOST } ?: STEP_REARM
        val sentAt = intent.getLongExtra(EXTRA_SENT_AT_ELAPSED_MS, 0L)
        val lagMs = if (sentAt > 0L) (android.os.SystemClock.elapsedRealtime() - sentAt).coerceAtLeast(0L) else -1L
        PlayerLogger.e(
            TAG,
            "PLAYER_ALERT_WATCH_KICK step=$step lagMs=$lagMs — the companion Manager found the native alert watch " +
                "silent while the panel is dark; starting it again (the hold is untouched)",
        )
        AlertWatchStamp.noteKick(step)
        if (step == STEP_RESTART_HOST) {
            runCatching { HeartbeatService.ensureRunning(app) }
                .onFailure { PlayerLogger.w(TAG, "could not start the heartbeat service: ${it.javaClass.simpleName}") }
        }
        runCatching { NativeAlertWatch.ensureStarted(app) }
            .onFailure { PlayerLogger.e(TAG, "the native alert watch could not be started from the Manager's kick", it) }
    }

    companion object {
        private const val TAG = "AlertWatchKick"

        /** Mirror of the Manager's `AlertWatchWatchdog` constants; change both or neither. */
        const val ACTION = "com.educms.player.ALERT_WATCH_KICK"
        const val EXTRA_STEP = "step"
        const val EXTRA_SENT_AT_ELAPSED_MS = "sent_at_elapsed_ms"
        const val STEP_REARM = "rearm"
        const val STEP_RESTART_HOST = "restart-host"
    }
}
