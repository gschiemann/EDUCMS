package com.educms.player.display

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger
import com.educms.player.standby.UserStandby
import com.educms.player.standby.UserStandbyPolicy

/**
 * On-device execution of the display schedule.
 *
 * ⚠️ THIS RUNS WITHOUT THE NETWORK, BY DESIGN. A screen whose Wi-Fi died
 * on Friday afternoon MUST still blank at 22:00 and wake at 07:00. The
 * schedule rows arrive in the manifest, are validated and persisted
 * natively ([DisplayConfigStore]), and from then on AlarmManager on the
 * box is the only thing that matters. Server push is for immediate /
 * manual actions ONLY.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY NOT Watchdog's setInexactRepeating, AND WHY NOT WorkManager
 * ─────────────────────────────────────────────────────────────────────
 * `Watchdog.arm` uses `setInexactRepeating(ELAPSED_REALTIME_WAKEUP, …)`,
 * which is right for "poke the service every ~15 min" and WRONG here on
 * two counts: it is boot-relative rather than wall-clock (so it knows
 * nothing about 22:00 in the screen's timezone) and it drifts by
 * minutes. WorkManager is worse — a 15-minute floor and no exactness at
 * all. So: ONE `setExactAndAllowWhileIdle(RTC_WAKEUP, …)` at a time,
 * re-armed from the receiver after every fire.
 *
 * Re-armed from THREE places, deliberately redundantly, because OEM
 * signage ROMs drop receivers:
 *   * BOOT_COMPLETED / MY_PACKAGE_REPLACED (BootReceiver)
 *   * MainActivity.onCreate (covers every process start, including the
 *     OEM ROMs where BootReceiver never fires)
 *   * whenever the manifest's `display` block changes
 */
object DisplayScheduler {

    private const val TAG = "DisplaySchedule"

    const val ACTION_TICK = "com.educms.player.DISPLAY_SCHEDULE_TICK"
    private const val REQUEST_CODE = 0xED75CD

    /**
     * Evaluate the schedule for "now", apply it, and arm the next
     * boundary. The single call every entry point uses.
     */
    fun armAndApply(ctx: Context) {
        val app = ctx.applicationContext
        applyDesiredNow(app)
        arm(app)
    }

    /**
     * Put the screen into whatever state the schedule says it should be
     * in right now. A no-op when there are no schedules — "nothing
     * configured" must never be read as "blank it".
     *
     * Scheduled actions carry NO dead-man revert: they are the intended
     * steady state, not a test.
     */
    fun applyDesiredNow(ctx: Context) {
        val app = ctx.applicationContext
        val config = DisplayConfigStore.load(app)
        // USER STANDBY (2026-10-03) — a person's remote-off yields to the
        // schedule's ON trigger, but only to one that came AFTER it. Checked
        // first, and over BOTH arrays: on most of the fleet the windows are
        // the page's soft ones, which this device may never blank but must
        // still answer at their ON trigger.
        endStandbyIfScheduleTriggered(app, config)
        val schedules = config.schedules
        val desiredOn = DisplayScheduleMath.desiredOnAt(schedules, System.currentTimeMillis())
        if (desiredOn == null) {
            PlayerLogger.i(TAG, "no hard schedules — leaving the screen alone")
            return
        }
        val currentlyBlanked = DisplayPrefs.blanked(app)
        if (desiredOn == !currentlyBlanked) {
            PlayerLogger.i(TAG, "schedule already satisfied (on=$desiredOn)")
            return
        }
        // 1.1.23 — a person's standby that the all-clear PUT BACK is held by
        // our blank, so an ON window that was already running when they
        // pressed power would read as "should be on" and wake it on the next
        // re-evaluation (a manifest poll, a process start). Their off came
        // after that window opened — it wins, exactly as for the standby
        // itself. A schedule ON that fired AFTER their off was already handled
        // by endStandbyIfScheduleTriggered above, which ended the standby.
        if (desiredOn && UserStandby.isActive(app)) {
            PlayerLogger.i(
                TAG,
                "schedule says on, but a person turned this panel off after that window opened — leaving it off",
            )
            return
        }
        val action = if (desiredOn) DisplayAction.Wake else DisplayAction.Blank
        // ⚠️ The registry is the single gate and it will refuse this
        // anyway; the explicit check is here so the log says WHY a
        // 22:00 blank did not happen, instead of an unexplained refusal
        // buried under a provider id. [DisplayEmergency.setHold]'s
        // release path calls armAndApply(), which re-enters here — so a
        // window suppressed by an alert takes effect the moment the
        // all-clear lands, rather than being skipped until tomorrow.
        if (!desiredOn && DisplayEmergency.isHeld(app)) {
            PlayerLogger.e(
                TAG,
                "schedule wants the screen OFF but an EMERGENCY ALERT is active — " +
                    "suppressed; it will be re-evaluated on all-clear",
            )
            return
        }
        PlayerLogger.i(TAG, "schedule says on=$desiredOn — applying ${action.describe()}")
        DisplayControlRegistry.apply(app, action, revertAfterMs = null)
    }

    /**
     * USER STANDBY (2026-10-03, player 1.1.21) — "respect the remote, but a
     * schedule overrides it when it hits its on or off trigger".
     *
     * A person turned the panel off with the remote. Last command wins: if the
     * schedule's latest real transition is an ON that fired AFTER that off,
     * the schedule spoke last — end the standby and WAKE the panel. An ON
     * window that was already running when the person pressed power changes
     * nothing (see [UserStandbyPolicy.scheduleEndsStandby]).
     *
     * Comparing timestamps rather than reacting to "the alarm fired" is what
     * makes this hold up on a real box: a late alarm, a missed alarm (the
     * Watchdog tick re-asks) and a process that died across the trigger all
     * reach the same answer.
     *
     * Both arrays count. `wakeOnlySchedules` are the page's soft windows,
     * forwarded so this device can answer their ON trigger — it never blanks
     * for them (the soft path never drives panel power; see DisplayConfig).
     *
     * @return true when this call ended a standby and woke the panel.
     */
    fun endStandbyIfScheduleTriggered(
        ctx: Context,
        config: DisplayConfig = DisplayConfigStore.load(ctx.applicationContext),
    ): Boolean {
        val app = ctx.applicationContext
        val record = UserStandby.activeRecord(app) ?: return false
        val windows = config.schedules + config.wakeOnlySchedules
        val last = DisplayScheduleMath.lastTransitionAtOrBefore(windows, System.currentTimeMillis())
        if (!UserStandbyPolicy.scheduleEndsStandby(record, last)) return false
        PlayerLogger.w(
            TAG,
            "the on/off schedule's ON trigger (${(System.currentTimeMillis() - last!!.atMs) / 1000}s ago) " +
                "came after the remote turned this panel off — the schedule wins, waking it",
        )
        UserStandby.end(app, "the on/off schedule's ON trigger")
        DisplayControlRegistry.apply(app, DisplayAction.Wake, revertAfterMs = null)
        return true
    }

    /** Arm exactly one alarm, at the next schedule boundary. */
    fun arm(ctx: Context) {
        val app = ctx.applicationContext
        val am = app.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val pi = tickIntent(app)
        val config = DisplayConfigStore.load(app)
        // Wake-only windows arm the alarm too: their ON trigger is the moment
        // a remote-slept panel must come back (endStandbyIfScheduleTriggered).
        val schedules = config.schedules + config.wakeOnlySchedules
        if (schedules.isEmpty()) {
            runCatching { am.cancel(pi) }
            PlayerLogger.i(TAG, "no schedules — alarm cancelled")
            return
        }
        val next = DisplayScheduleMath.nextTransitionAfter(schedules, System.currentTimeMillis())
        if (next == null) {
            runCatching { am.cancel(pi) }
            PlayerLogger.w(TAG, "schedules present but no transition inside the horizon — alarm cancelled")
            return
        }
        ExactAlarms.set(am, next.atMs, pi, TAG)
        PlayerLogger.i(
            TAG,
            "next transition in ${next.atMs - System.currentTimeMillis()}ms → screen ${if (next.on) "ON" else "OFF"}",
        )
    }

    private fun tickIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, DisplayScheduleReceiver::class.java).setAction(ACTION_TICK)
        return PendingIntent.getBroadcast(
            ctx,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

/**
 * Wall-clock alarm setter with a graceful ladder.
 *
 * API 31 raised `setExactAndAllowWhileIdle` behind `SCHEDULE_EXACT_ALARM`
 * / `USE_EXACT_ALARM`. When neither is granted we fall back to
 * `setAndAllowWhileIdle`, which is inexact (Doze may batch it by
 * minutes) but ALWAYS fires. A screen that blanks at 22:04 is a cosmetic
 * problem; a screen that never wakes is a truck roll — so this never
 * simply gives up, and never throws.
 */
internal object ExactAlarms {

    fun set(am: AlarmManager, triggerAtEpochMs: Long, pi: PendingIntent, tag: String) {
        val exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            Api31ExactAlarms.canScheduleExact(am)
        try {
            if (exactAllowed) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtEpochMs, pi)
            } else {
                PlayerLogger.w(tag, "exact alarms not permitted — falling back to inexact (may drift by minutes)")
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtEpochMs, pi)
            }
        } catch (t: Throwable) {
            // SecurityException on a ROM that revoked the appop between
            // the check and the call. Inexact still beats nothing.
            PlayerLogger.w(tag, "exact alarm set failed (${t.message}) — retrying inexact")
            runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtEpochMs, pi) }
                .onFailure { PlayerLogger.e(tag, "alarm could not be set at all", it) }
        }
    }
}

/**
 * API-31 symbol isolation. `AlarmManager.canScheduleExactAlarms()` does
 * not exist below S; referencing it from a class ART loads on an
 * Android-11 Taurus is exactly the shape that produced this repo's two
 * class-load `VerifyError` incidents. Keeping it in its own
 * `@RequiresApi` object means the verifier never has to resolve the
 * symbol on a device that lacks it.
 */
@RequiresApi(Build.VERSION_CODES.S)
private object Api31ExactAlarms {
    fun canScheduleExact(am: AlarmManager): Boolean = try {
        am.canScheduleExactAlarms()
    } catch (t: Throwable) {
        false
    }
}

/**
 * Receives both the schedule tick and the dead-man revert. Declared
 * `exported="false"` — it is only ever targeted by PendingIntents we
 * minted ourselves.
 */
class DisplayScheduleReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        // Explicit action check. The sibling UsbAttachReceiver shipped a
        // fix for exactly this omission; an exported=false receiver
        // still receives whatever a same-UID component sends it.
        when (intent.action) {
            DisplayScheduler.ACTION_TICK -> {
                PlayerLogger.i("DisplaySchedule", "alarm tick")
                runCatching { DisplayScheduler.armAndApply(ctx.applicationContext) }
                    .onFailure { PlayerLogger.e("DisplaySchedule", "tick failed", it) }
            }
            DisplayGuard.ACTION_REVERT -> {
                PlayerLogger.i("DisplayGuard", "revert alarm")
                runCatching { DisplayGuard.fireDue(ctx.applicationContext) }
                    .onFailure { PlayerLogger.e("DisplayGuard", "revert failed", it) }
            }
            else -> PlayerLogger.w("DisplaySchedule", "ignoring unexpected action ${intent.action}")
        }
    }
}
