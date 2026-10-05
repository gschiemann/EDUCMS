package com.educms.player.watchdog

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.educms.player.MainActivity
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.standby.RelaunchMode
import com.educms.player.standby.UserStandby

/**
 * AlarmManager-backed watchdog that nudges MainActivity + HeartbeatService
 * back to life every 15 minutes. Fires on EXACT clock time so it survives
 * Doze and App Standby on Android 6+.
 *
 * Why we need it on top of START_STICKY + foreground service:
 *  - Some OEM forks (Xiaomi MIUI, Realme Color OS, certain Vivo and
 *    Oppo SKUs sold internationally on Taurus boards) implement
 *    aggressive "battery optimization" that ignores foreground-service
 *    promises and kills our process anyway.
 *  - On hard kernel panics or OOM events the process gets reaped without
 *    ever calling onDestroy, so AlarmManager.setRepeating is the only
 *    surviving way to bring us back.
 *
 * No work is done here directly — the alarm just fires a broadcast that
 * starts the foreground service, which on cold start brings up the
 * activity if it isn't already foreground.
 */
object Watchdog {
    private const val INTERVAL_MS = 15L * 60 * 1000  // 15 minutes
    private const val REQUEST_CODE = 0xED70CC
    private const val TAG = "Watchdog"

    fun arm(ctx: Context) {
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(ctx, WatchdogReceiver::class.java).setAction(ACTION_TICK)
            val pi = PendingIntent.getBroadcast(
                ctx, REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS
            // setInexactRepeating buys us OS-friendly batching but on
            // older Androids that still gives a 15min cadence with low
            // battery impact.
            am.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                triggerAt,
                INTERVAL_MS,
                pi,
            )
            Log.i(TAG, "Watchdog armed (every ${INTERVAL_MS / 60_000}m)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to arm watchdog", e)
        }
    }

    const val ACTION_TICK = "com.educms.player.WATCHDOG_TICK"
}

/**
 * Fires every ~15 min via AlarmManager. Re-launches HeartbeatService
 * (idempotent) and, if the activity has been killed, brings it back.
 */
class WatchdogReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Watchdog.ACTION_TICK) return
        Log.i("Watchdog", "Tick — ensuring services + activity are alive")
        HeartbeatService.ensureRunning(ctx)
        // ── USER STANDBY (2026-10-03, player 1.1.21) ──────────────────
        // THIS TICK WAS THE BUG: it started MainActivity every 15 minutes,
        // and an Activity that carries turn-screen-on turns the panel on when
        // it is started, so a person's remote power-off lasted at most 15
        // minutes. Now, while a person has the panel off:
        //   • the tick keeps the standby CPU lock fresh (the page must stay
        //     reachable by an alert) and catches a schedule ON trigger an
        //     alarm missed;
        //   • an ALIVE Activity is left alone — nothing to recover;
        //   • a DEAD one is still started, dark: its onCreate leaves the wake
        //     flags disarmed, so the page runs and can take an alert while the
        //     panel stays off.
        val app = ctx.applicationContext
        runCatching { UserStandby.onWatchdogTick(app) }
            .onFailure { Log.w("Watchdog", "user-standby tick failed: ${it.message}") }
        // 1.1.22 — this alarm is the one thing here that can wake a suspended
        // CPU, so it also puts the native alert watch back if its loop is not
        // running behind a dark panel. Idempotent, never throws. BEFORE the
        // standby SKIP below: a panel in standby is exactly the one to watch.
        com.educms.player.alertwatch.NativeAlertWatch.kick(app, "watchdog tick")
        val mode = UserStandby.relaunchMode(app)
        if (mode == RelaunchMode.SKIP) {
            PlayerLogger.i("Watchdog", "Tick — a person has this panel off and the player is alive; not relaunching")
            return
        }
        if (mode == RelaunchMode.DARK) {
            PlayerLogger.i("Watchdog", "Tick — panel off by a person and the player is gone; relaunching it dark")
        }
        // Only re-launch the activity if it's been idle for a while; otherwise
        // we'd steal focus. Best-effort — Android 10+ background launch
        // restrictions might block this, but on rooted Taurus / Device-Owner
        // kiosks it's allowed.
        try {
            val launch = Intent(ctx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
            ctx.startActivity(launch)
        } catch (e: Exception) {
            // Background-launch restrictions hit — that's fine, the
            // foreground service stays alive and the next time the
            // user touches the screen the activity comes up.
            Log.d("Watchdog", "Activity re-launch suppressed: ${e.message}")
        }
    }
}
