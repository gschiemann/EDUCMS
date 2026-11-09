package com.educms.manager.alertwatch

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.educms.manager.OtaInstaller
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Action

/**
 * THE ALERT-WATCH WATCHDOG — the Android half (2026-11-08, Manager wave 5).
 *
 * The rules are [AlertWatchWatchdogPolicy]; this file is only what they
 * cannot be: the clock, the power state, the two stores and the one
 * broadcast. Called once per `WatchdogService` tick (30 s), inside a
 * `runCatching` there, so a fault here can never cost the liveness watchdog
 * its tick.
 *
 * ⚠️ ADD ONLY. The only thing this file sends to the Player is
 * [ACTION_KICK] — a signature-permission broadcast into the Player's
 * `AlertWatchKickReceiver`, which starts the Player's native alert watch (and,
 * on the second rung, the foreground service that hosts it). It never launches
 * an Activity (the Player's `turnScreenOn` would light a scheduled-dark
 * panel), never touches the emergency hold, never reboots, and posts nothing
 * to the server: the verdict is a row the PLAYER carries on its own signed
 * heartbeat.
 */
object AlertWatchWatchdog {

    private const val TAG = "AlertWatchWatchdog"

    /** The Player's receiver and the action it listens for. Mirror of `AlertWatchKickReceiver` in the Player. */
    const val PLAYER_RECEIVER_CLASS = "com.educms.player.alertwatch.AlertWatchKickReceiver"
    const val ACTION_KICK = "com.educms.player.ALERT_WATCH_KICK"
    const val EXTRA_STEP = "step"
    const val EXTRA_SENT_AT_ELAPSED_MS = "sent_at_elapsed_ms"
    const val STEP_REARM = "rearm"
    const val STEP_RESTART_HOST = "restart-host"

    /** The permission both packages define/hold; the receiver requires it of the sender. */
    const val HEALTH_PERMISSION = "com.educms.manager.HEALTH_PERMISSION"

    /** The liveness heartbeat row's prefs — the same file `PlayerHealthProvider` persists to (read only here). */
    private const val HEALTH_PREFS = "edu_player_health"
    private const val HEALTH_KEY_TS = "hb_ts"

    @Volatile private var lastLoggedVerdict: String? = null

    /** One tick. Never throws. */
    fun tick(ctx: Context) {
        val app = ctx.applicationContext
        val now = SystemClock.elapsedRealtime()
        val mem = AlertWatchStore.readMemory(app)
        val facts = AlertWatchWatchdogPolicy.Facts(
            nowElapsedMs = now,
            managerInteractive = runCatching {
                (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
            }.getOrNull(),
            stamp = AlertWatchStore.readStamp(app),
            playerHeartbeatAgeMs = playerHeartbeatAgeMs(app),
        )
        val step = AlertWatchWatchdogPolicy.tick(mem, facts)
        AlertWatchStore.writeMemory(app, step.memory)

        val record = step.record
        if (record == null) {
            // Mode off (or unset): the Player carries nothing. Any other null is "no change".
            if (facts.stamp == null || facts.stamp.mode == AlertWatchWatchdogPolicy.Mode.OFF) AlertWatchStore.clearRecord(app)
        } else if (AlertWatchStore.writeRecord(app, record, now)) {
            val line = AlertWatchStore.describe(record)
            if (line != lastLoggedVerdict) {
                lastLoggedVerdict = line
                when (record.verdict) {
                    AlertWatchWatchdogPolicy.Verdict.REARM_SENT,
                    AlertWatchWatchdogPolicy.Verdict.RESTART_SENT,
                    AlertWatchWatchdogPolicy.Verdict.UNRECOVERED,
                    AlertWatchWatchdogPolicy.Verdict.SILENT_OBSERVED,
                    AlertWatchWatchdogPolicy.Verdict.SILENT_BACKOFF,
                    AlertWatchWatchdogPolicy.Verdict.SILENT_CAPPED -> Log.e(TAG, "MANAGER_ALERT_WATCH $line")
                    else -> Log.i(TAG, "MANAGER_ALERT_WATCH $line")
                }
            }
        }

        when (step.action) {
            Action.NONE -> Unit
            Action.REARM -> kick(app, STEP_REARM, now)
            Action.RESTART_HOST -> kick(app, STEP_RESTART_HOST, now)
        }
    }

    /** Age of the Player's liveness heartbeat (wall clock, as it is written); null when none. */
    private fun playerHeartbeatAgeMs(app: Context): Long? = runCatching {
        val ts = app.getSharedPreferences(HEALTH_PREFS, Context.MODE_PRIVATE).getLong(HEALTH_KEY_TS, 0L)
        if (ts <= 0L) null else System.currentTimeMillis() - ts
    }.getOrNull()

    /**
     * The one broadcast. Explicit component (a manifest receiver on Android 8+
     * is reached only by an explicit intent), signature permission on both
     * ends. A refusal — no Player installed, a different signing key — is
     * logged and bounded by the policy's ladder; nothing retries here.
     */
    private fun kick(app: Context, step: String, nowElapsedMs: Long) {
        runCatching {
            val pkg = OtaInstaller.pickInstalledPlayerPackage(app.packageManager)
            if (pkg == null) {
                Log.e(TAG, "MANAGER_ALERT_WATCH_KICK step=$step refused: no Player package installed")
                return
            }
            val intent = Intent(ACTION_KICK)
                .setComponent(ComponentName(pkg, PLAYER_RECEIVER_CLASS))
                .putExtra(EXTRA_STEP, step)
                .putExtra(EXTRA_SENT_AT_ELAPSED_MS, nowElapsedMs)
                .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
            app.sendBroadcast(intent, HEALTH_PERMISSION)
            Log.e(TAG, "MANAGER_ALERT_WATCH_KICK step=$step sent to $pkg — the native alert watch has not stamped while the panel is dark")
        }.onFailure { Log.e(TAG, "MANAGER_ALERT_WATCH_KICK step=$step failed: ${it.javaClass.simpleName}") }
    }
}
