package com.educms.player.display

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.educms.player.logging.PlayerLogger

/**
 * The dead-man switch. This is what makes it safe for an operator to
 * press "blank" on a screen bolted eleven feet up a hallway wall.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE SEQUENCE (order is the whole point)
 * ─────────────────────────────────────────────────────────────────────
 *   1. snapshot the state we are about to leave
 *   2. `commit()` the [PendingRevert] record — SYNCHRONOUSLY
 *   3. **only then** let the provider apply the action
 *   4. arm an alarm for the due time
 *
 * If step 2 fails we REFUSE the action outright ([ArmResult.Refused]) —
 * an un-revertable remote blank is worse than no blank at all.
 *
 * If the process dies anywhere after step 2 — OOM kill, OEM battery
 * reaper, OTA self-update, power cut — [replayPending] runs on the next
 * process start (MainActivity.onCreate) and on the next boot
 * (BootReceiver) and restores the screen. A record whose due time has
 * already passed reverts immediately; one still in the future re-arms.
 *
 * REBOOT never arms a guard: there is no prior state to restore, only a
 * box that comes back or does not.
 */
object DisplayGuard {

    private const val TAG = "DisplayGuard"

    const val ACTION_REVERT = "com.educms.player.DISPLAY_REVERT"
    private const val REQUEST_CODE = 0xED7DEA

    sealed class ArmResult {
        object Armed : ArmResult()

        /** This action type takes no revert (REBOOT). */
        object NotApplicable : ArmResult()

        /** The record could not be persisted — caller must NOT apply. */
        data class Refused(val reason: String) : ArmResult()
    }

    /**
     * Snapshot + persist, BEFORE the action is applied. Never call this
     * after an apply: the snapshot would capture the new state and the
     * revert would be a no-op.
     */
    fun arm(ctx: Context, action: DisplayAction, revertAfterMs: Long): ArmResult {
        if (action is DisplayAction.Reboot) {
            PlayerLogger.i(TAG, "reboot carries no dead-man revert — nothing to restore")
            return ArmResult.NotApplicable
        }
        val app = ctx.applicationContext
        val delay = DisplayLimits.clampRevertMs(revertAfterMs)
        val record = PendingRevert(
            capability = action.capability,
            priorPercent = when (action.capability) {
                Capability.VOLUME -> DisplayPrefs.volumePercent(app)
                else -> DisplayPrefs.brightnessPercent(app)
            },
            priorBlanked = DisplayPrefs.blanked(app),
            dueAtEpochMs = System.currentTimeMillis() + delay,
        )
        if (!DisplayPrefs.commitPendingRevert(app, record)) {
            return ArmResult.Refused("SharedPreferences.commit() failed")
        }
        PlayerLogger.i(
            TAG,
            "armed dead-man revert for ${action.describe()} — restores " +
                "${record.capability}=${record.priorPercent}% blanked=${record.priorBlanked} in ${delay}ms",
        )
        return ArmResult.Armed
    }

    /**
     * Re-assert whatever record is on disk: revert now if due, otherwise
     * arm the alarm. Idempotent, cheap, and safe to call on every
     * process start — which is exactly how it is wired (MainActivity's
     * onCreate covers cold starts, OOM restarts and OTA restarts;
     * BootReceiver covers a power cycle where the Activity is slow to
     * come up).
     */
    fun replayPending(ctx: Context) {
        val app = ctx.applicationContext
        val record = DisplayPrefs.pendingRevert(app) ?: return
        val now = System.currentTimeMillis()
        if (record.isDue(now)) {
            PlayerLogger.i(TAG, "replaying OVERDUE dead-man revert (due ${now - record.dueAtEpochMs}ms ago)")
            fireDue(app)
        } else {
            PlayerLogger.i(TAG, "re-arming dead-man revert — due in ${record.dueAtEpochMs - now}ms")
            scheduleRevertAlarm(app)
        }
    }

    /**
     * Restore the snapshotted state and clear the record. Called by the
     * alarm receiver and by [replayPending] for an overdue record.
     *
     * The record is cleared FIRST so a revert that itself fails cannot
     * loop forever; the restore action goes through the registry with no
     * revert of its own.
     */
    fun fireDue(ctx: Context) {
        val app = ctx.applicationContext
        val record = DisplayPrefs.pendingRevert(app) ?: return
        DisplayPrefs.clearPendingRevert(app)
        val action = record.revertAction()
        PlayerLogger.i(TAG, "DEAD-MAN REVERT firing → ${action.describe()}")
        val result = DisplayControlRegistry.apply(app, action, revertAfterMs = null)
        if (!result.ok) {
            PlayerLogger.e(TAG, "dead-man revert did NOT take: $result")
        }
    }

    /** Cancel a pending revert (the operator explicitly kept the change). */
    fun cancel(ctx: Context) {
        val app = ctx.applicationContext
        DisplayPrefs.clearPendingRevert(app)
        runCatching {
            alarmManager(app)?.cancel(pendingIntent(app))
        }.onFailure { PlayerLogger.w(TAG, "cancel alarm failed: ${it.message}") }
        PlayerLogger.i(TAG, "dead-man revert cancelled — the change is now permanent")
    }

    fun peek(ctx: Context): PendingRevert? = DisplayPrefs.pendingRevert(ctx.applicationContext)

    /**
     * Arm the wall-clock alarm for whatever record is on disk. Exact
     * where the OS permits it, inexact-but-guaranteed otherwise — a
     * revert a few minutes late is fine; one that never fires is not,
     * which is why this never simply gives up.
     */
    fun scheduleRevertAlarm(ctx: Context) {
        val app = ctx.applicationContext
        val record = DisplayPrefs.pendingRevert(app) ?: return
        val am = alarmManager(app) ?: return
        val pi = pendingIntent(app)
        ExactAlarms.set(am, record.dueAtEpochMs, pi, TAG)
    }

    private fun alarmManager(ctx: Context): AlarmManager? =
        ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    private fun pendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, DisplayScheduleReceiver::class.java).setAction(ACTION_REVERT)
        return PendingIntent.getBroadcast(
            ctx,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
