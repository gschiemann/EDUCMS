package com.educms.player.display

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.webkit.WebViewFeature
import com.educms.player.MainActivity
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.RelaunchEscalation
import com.educms.player.ota.RelaunchPurpose
import org.json.JSONObject

/**
 * AppRestart — the Android glue of the remote "restart the app" command
 * (2026-11-09). Every decision is in [AppRestartPolicy]; read its header for
 * the gap, the failure direction and the limits.
 *
 * Flow:
 *  1. the dashboard (or the scheduled-restart worker) sends APP_RESTART; it
 *     reaches [requestJson] over `displayApply` on the TRUSTED bridge only;
 *  2. a refusal is answered and recorded by value (`{id, o:"refused", r}`);
 *  3. an accept is persisted FIRST (`o:"restarting"`, this pid, the rate
 *     history), the relaunch alarm is armed, the answer goes back to the
 *     page, and [AppRestartPolicy.KILL_DELAY_MS] later — after one more look
 *     at the emergency hold — the process ends itself;
 *  4. the alarm starts a fresh process in [AppRestartReceiver], which starts
 *     the heartbeat service (and with it the native alert watch), kicks the
 *     alert watch, and relaunches the Activity through the ONE relaunch
 *     ladder ([RelaunchEscalation.attempt], purpose APP_RESTART);
 *  5. [AppRestartPolicy.LANDING_CHECK_MS] later the new process records
 *     `landed` / `started` / `not-landed`; `not-landed` latches the device
 *     out of app restarts for a week, so the capability it reports turns
 *     `none` and the server refuses the action with its existing 409.
 *  The heartbeat carries the record ([reportJson]) in the native runtime
 *  report, so the server proves the restart by the action id it sent.
 */
object AppRestart {
    private const val TAG = "AppRestart"
    private const val PREFS = "app_restart"
    private const val K_ID = "id"
    private const val K_OUTCOME = "o"
    private const val K_REASON = "r"
    private const val K_AT = "at"
    private const val K_PID = "pid"
    private const val K_HISTORY = "history"
    private const val K_FAILED_AT = "failed_at"
    private const val REQUEST_CODE = 0xA9_95_11

    const val ACTION_RELAUNCH = "com.educms.player.APP_RESTART_RELAUNCH"

    private val main = Handler(Looper.getMainLooper())

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The probe's verdict value: [AppRestartPolicy.MECHANISM] or [AppRestartPolicy.NONE]. Never throws. */
    fun capability(ctx: Context): String = runCatching {
        val app = ctx.applicationContext
        val (value, why) = AppRestartPolicy.capability(
            AppRestartPolicy.CapabilityFacts(
                sdkInt = android.os.Build.VERSION.SDK_INT,
                canDrawOverlays = RelaunchEscalation.canDrawOverlays(app),
                isHomeApp = RelaunchEscalation.isHomeApp(app),
                trustedBridge = runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
                    .getOrDefault(false),
                lastFailedLandingWallMs = prefs(app).getLong(K_FAILED_AT, 0L),
                nowWallMs = System.currentTimeMillis(),
            ),
        )
        if (value != AppRestartPolicy.MECHANISM) PlayerLogger.i(TAG, "app restart not offered: $why")
        value
    }.getOrDefault(AppRestartPolicy.NONE)

    /** `displayApply({"action":"APP_RESTART","actionId":…})`. Returns the bridge's JSON answer. */
    fun requestJson(ctx: Context, obj: JSONObject, trusted: Boolean): String {
        val app = ctx.applicationContext
        val p = prefs(app)
        val actionId = obj.optString("actionId", "").trim().takeIf { it.isNotEmpty() }
        val now = System.currentTimeMillis()
        val refusal = runCatching {
            AppRestartPolicy.refusal(
                AppRestartPolicy.RequestFacts(
                    actionId = actionId,
                    trusted = trusted,
                    capable = capability(app) == AppRestartPolicy.MECHANISM,
                    emergencyHeld = DisplayEmergency.isHeld(app),
                    otaInFlight = com.educms.player.ota.OtaCheck.busy() || MainActivity.installPromptOutstanding,
                    pairing = app.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                        .getString("device_token", null).isNullOrBlank(),
                    setupInProgress = com.educms.player.setup.SetupCeremony.relaunchShouldYield(app),
                    userStandby = com.educms.player.standby.UserStandby.isActive(app),
                    processAgeMs = SystemClock.elapsedRealtime() - android.os.Process.getStartElapsedRealtime(),
                    history = history(p),
                    lastActionId = p.getString(K_ID, null),
                    nowWallMs = now,
                ),
            )
        }.getOrElse { "error" }

        if (refusal != null) {
            // A replay keeps the record it answered: overwriting a `landed`
            // with `refused` would erase the proof the server reads.
            if (refusal != AppRestartPolicy.Reason.DUPLICATE && actionId != null) {
                record(p, actionId, AppRestartPolicy.Outcome.REFUSED, refusal, now)
            }
            PlayerLogger.w(TAG, "APP_RESTART id=$actionId refused: $refusal")
            return JSONObject().put("ok", false).put("action", "APP_RESTART")
                .put("error", "refused").put("reason", refusal).toString()
        }

        // Persist BEFORE touching anything: a crash between here and the kill
        // must still count against the rate limit and still be provable.
        val written = p.edit()
            .putString(K_ID, actionId).putString(K_OUTCOME, AppRestartPolicy.Outcome.RESTARTING)
            .remove(K_REASON).putLong(K_AT, now).putInt(K_PID, android.os.Process.myPid())
            .putString(K_HISTORY, AppRestartPolicy.historyAfterAccept(history(p), now).joinToString(","))
            .commit()
        if (!written || !armRelaunch(app, now + AppRestartPolicy.RELAUNCH_ALARM_DELAY_MS)) {
            if (actionId != null) record(p, actionId, AppRestartPolicy.Outcome.REFUSED, "not-persisted", now)
            return JSONObject().put("ok", false).put("action", "APP_RESTART")
                .put("error", "refused").put("reason", "not-persisted").toString()
        }
        PlayerLogger.w(
            TAG,
            "APP_RESTART id=$actionId accepted — process ends in ${AppRestartPolicy.KILL_DELAY_MS} ms, " +
                "relaunch alarm in ${AppRestartPolicy.RELAUNCH_ALARM_DELAY_MS} ms",
        )
        main.postDelayed({ endProcess(app, actionId!!) }, AppRestartPolicy.KILL_DELAY_MS)
        return JSONObject().put("ok", true).put("action", "APP_RESTART")
            .put("mechanism", AppRestartPolicy.MECHANISM).toString()
    }

    /** The last look before the process ends. An alert that arrived in the delay wins. */
    private fun endProcess(app: Context, actionId: String) {
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) {
            cancelRelaunch(app)
            record(prefs(app), actionId, AppRestartPolicy.Outcome.REFUSED, AppRestartPolicy.Reason.EMERGENCY, System.currentTimeMillis())
            PlayerLogger.w(TAG, "APP_RESTART id=$actionId withdrawn — an emergency hold arrived before the restart")
            return
        }
        PlayerLogger.w(TAG, "APP_RESTART id=$actionId — ending the player process now")
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    /** The relaunch alarm. Exact where allowed; the shared ladder falls back to inexact. */
    private fun armRelaunch(app: Context, atWallMs: Long): Boolean = runCatching {
        val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        ExactAlarms.set(am, atWallMs, relaunchIntent(app), TAG)
        true
    }.getOrElse {
        PlayerLogger.w(TAG, "relaunch alarm could not be armed: ${it.message}")
        false
    }

    private fun cancelRelaunch(app: Context) {
        runCatching { (app.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(relaunchIntent(app)) }
    }

    private fun relaunchIntent(app: Context): PendingIntent = PendingIntent.getBroadcast(
        app,
        REQUEST_CODE,
        Intent(app, AppRestartReceiver::class.java).setAction(ACTION_RELAUNCH),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** In the NEW process: bring everything back, then judge the landing. */
    internal fun onRelaunchAlarm(ctx: Context) {
        val app = ctx.applicationContext
        val p = prefs(app)
        val id = p.getString(K_ID, null)
        // The heartbeat service hosts the native alert watch: first, always.
        runCatching { HeartbeatService.ensureRunning(app) }
        runCatching { com.educms.player.alertwatch.NativeAlertWatch.kick(app, "app restart") }
        if (id == null || p.getString(K_OUTCOME, null) != AppRestartPolicy.Outcome.RESTARTING) {
            PlayerLogger.i(TAG, "relaunch alarm with no restart outstanding — services ensured, nothing else")
            return
        }
        PlayerLogger.i(TAG, "APP_RESTART id=$id — new process, relaunching the player")
        runCatching { RelaunchEscalation.attempt(app, "app-restart", RelaunchPurpose.APP_RESTART) }
            .onFailure { PlayerLogger.w(TAG, "relaunch attempt threw: ${it.message}") }
        main.postDelayed({ judgeLanding(app, id) }, AppRestartPolicy.LANDING_CHECK_MS)
    }

    private fun judgeLanding(app: Context, id: String) {
        runCatching {
            val p = prefs(app)
            if (p.getString(K_ID, null) != id) return
            val interactive = runCatching {
                (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
            }.getOrNull()
            val outcome = AppRestartPolicy.landingOutcome(
                MainActivity.isInForeground, interactive, MainActivity.installPromptOutstanding,
            )
            val now = System.currentTimeMillis()
            val edit = p.edit().putString(K_OUTCOME, outcome).putLong(K_AT, now).putInt(K_PID, android.os.Process.myPid())
            if (outcome == AppRestartPolicy.Outcome.NOT_LANDED) edit.putLong(K_FAILED_AT, now)
            edit.commit()
            PlayerLogger.i(TAG, "APP_RESTART id=$id landing: $outcome")
        }.onFailure { PlayerLogger.w(TAG, "landing check failed: ${it.message}") }
    }

    /** The `appRestart` block of the native runtime report, or null when there is none. Never throws. */
    fun reportJson(ctx: Context): JSONObject? = runCatching {
        val p = prefs(ctx)
        val id = p.getString(K_ID, null) ?: return null
        val outcome = AppRestartPolicy.reportedOutcome(
            p.getString(K_OUTCOME, null) ?: return null,
            p.getInt(K_PID, 0),
            android.os.Process.myPid(),
        )
        JSONObject().put("id", id).put("o", outcome).apply {
            p.getString(K_REASON, null)?.let { put("r", it.take(40)) }
            p.getLong(K_AT, 0L).takeIf { it > 0 }?.let { put("at", it) }
        }
    }.getOrNull()

    private fun record(p: android.content.SharedPreferences, id: String, outcome: String, reason: String?, at: Long) {
        p.edit().putString(K_ID, id).putString(K_OUTCOME, outcome).putLong(K_AT, at)
            .putInt(K_PID, android.os.Process.myPid())
            .apply { if (reason != null) putString(K_REASON, reason) else remove(K_REASON) }
            .commit()
    }

    private fun history(p: android.content.SharedPreferences): List<Long> =
        p.getString(K_HISTORY, "").orEmpty().split(',').mapNotNull { it.trim().toLongOrNull() }
}

/**
 * The relaunch alarm's receiver. exported=false: only our own PendingIntent
 * reaches it; the action is still checked (a same-UID component can reach an
 * unexported receiver).
 */
class AppRestartReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != AppRestart.ACTION_RELAUNCH) return
        AppRestart.onRelaunchAlarm(ctx)
    }
}
