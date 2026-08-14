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
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️  MULTIPLE OUTSTANDING REVERTS — READ [PendingRevert]'S HEADER
 * ─────────────────────────────────────────────────────────────────────
 * v1 kept ONE record. Arming a second action overwrote the first and
 * snapshotted the ALREADY-TESTED state as "prior", which made the first
 * action permanent with no record and no alarm — a dark screen and a
 * truck roll. Records are now a SET keyed by capability, and re-arming a
 * capability that already has one PRESERVES the original snapshot and
 * only pushes the due time out. See [arm].
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
     *
     * RE-ARM SEMANTICS. When a record for this capability is already
     * outstanding we KEEP its snapshot and move only the due time, to
     * `max(existing, new)`:
     *
     *   * keeping the snapshot is mandatory — the first one is the only
     *     one taken before we changed anything, so it is the only true
     *     "prior". Re-snapshotting is precisely the v1 bug (press Blank
     *     twice → priorBlanked=true → the revert re-applies Blank
     *     forever);
     *   * `max` on the due time never cuts short a dead-man window the
     *     operator explicitly asked for. The guard always eventually
     *     restores, so erring long is a delay; erring short would undo
     *     an action the operator is still looking at.
     */
    fun arm(ctx: Context, action: DisplayAction, revertAfterMs: Long): ArmResult {
        if (action is DisplayAction.Reboot) {
            PlayerLogger.i(TAG, "reboot carries no dead-man revert — nothing to restore")
            return ArmResult.NotApplicable
        }
        val app = ctx.applicationContext
        val delay = DisplayLimits.clampRevertMs(revertAfterMs)
        val due = System.currentTimeMillis() + delay
        val outstanding = DisplayPrefs.pendingReverts(app)

        val merged = mergeArm(
            outstanding = outstanding,
            capability = action.capability,
            priorPercent = when (action.capability) {
                Capability.VOLUME -> DisplayPrefs.volumePercent(app)
                else -> DisplayPrefs.brightnessPercent(app)
            },
            priorBlanked = DisplayPrefs.blanked(app),
            dueAtEpochMs = due,
        )
        if (!DisplayPrefs.commitPendingReverts(app, merged)) {
            return ArmResult.Refused("SharedPreferences.commit() failed")
        }
        val record = merged.first { it.capability == action.capability }
        PlayerLogger.i(
            TAG,
            "armed dead-man revert for ${action.describe()} — restores " +
                "${record.capability}=${record.priorPercent}% blanked=${record.priorBlanked} " +
                "(ownsBlank=${record.ownsBlankState}) in ${record.dueAtEpochMs - System.currentTimeMillis()}ms; " +
                "${merged.size} record(s) outstanding",
        )
        return ArmResult.Armed
    }

    /**
     * The merge policy, as pure math — no `android.*`, no clock, no
     * prefs — so the rule that a permanently-dark screen depends on has
     * a test that cannot be skipped for want of an emulator. Same
     * discipline as [DisplayLimits] and [DisplayScheduleMath].
     *
     * Returns the full new record set. See [arm]'s KDoc for why the
     * existing snapshot is kept and the due time takes the max.
     */
    internal fun mergeArm(
        outstanding: List<PendingRevert>,
        capability: Capability,
        priorPercent: Int,
        priorBlanked: Boolean,
        dueAtEpochMs: Long,
    ): List<PendingRevert> {
        val existing = outstanding.firstOrNull { it.capability == capability }
        val record = existing?.copy(dueAtEpochMs = maxOf(existing.dueAtEpochMs, dueAtEpochMs))
            ?: PendingRevert(
                capability = capability,
                priorPercent = priorPercent,
                priorBlanked = priorBlanked,
                dueAtEpochMs = dueAtEpochMs,
                // Only ONE outstanding record may drive on/off state.
                // BLANK/WAKE always owns it; BRIGHTNESS owns it only when
                // nothing else is in flight, because otherwise its
                // priorBlanked was captured AFTER another action already
                // moved the screen. VOLUME never owns it.
                ownsBlankState = when (capability) {
                    Capability.BLANK, Capability.WAKE -> true
                    Capability.BRIGHTNESS -> outstanding.isEmpty()
                    else -> false
                },
            )
        return outstanding.filter { it.capability != capability } + record
    }

    /**
     * Re-assert whatever records are on disk: revert the due ones now,
     * re-arm the alarm for the rest. Idempotent, cheap, and safe to call
     * on every process start — which is exactly how it is wired
     * (MainActivity's onCreate covers cold starts, OOM restarts and OTA
     * restarts; BootReceiver covers a power cycle where the Activity is
     * slow to come up).
     */
    fun replayPending(ctx: Context) {
        val app = ctx.applicationContext
        val records = DisplayPrefs.pendingReverts(app)
        if (records.isEmpty()) return
        // While an alert is up, an overdue revert is DEFERRED, not fired
        // (see fireDue). Re-arming an alarm for its already-past due time
        // would spin, so nothing is armed until the all-clear replays.
        if (DisplayEmergency.isHeld(app)) {
            fireDue(app)
            return
        }
        val now = System.currentTimeMillis()
        if (records.any { it.isDue(now) }) {
            PlayerLogger.i(TAG, "replaying ${records.count { it.isDue(now) }} OVERDUE dead-man revert(s)")
            fireDue(app)
        } else {
            val next = records.minByOrNull { it.dueAtEpochMs }!!
            PlayerLogger.i(TAG, "re-arming ${records.size} dead-man revert(s) — next in ${next.dueAtEpochMs - now}ms")
            scheduleRevertAlarm(app)
        }
    }

    /**
     * Restore every snapshot whose time has come and clear those
     * records. Called by the alarm receiver and by [replayPending].
     *
     * Due records are cleared FIRST so a revert that itself fails cannot
     * loop forever; each restore action goes through the registry with
     * no revert of its own. Records that are NOT yet due survive and the
     * alarm is re-armed for the earliest of them.
     *
     * ORDER: records that do NOT own blank state run first, so the one
     * record allowed to decide on/off has the last word on what the
     * screen looks like when this returns.
     */
    fun fireDue(ctx: Context) {
        val app = ctx.applicationContext
        val all = DisplayPrefs.pendingReverts(app)
        if (all.isEmpty()) return

        // ⚠️ LIFE SAFETY. A revert restores the state the screen was in
        // BEFORE an operator test — which may be "blanked" or "dimmed to
        // 20%". Both are refused at the registry while an alert is up, so
        // firing here would burn the records for nothing and leave the
        // screen stuck at the emergency level after the all-clear.
        //
        // So: DEFER. The records stay on disk and NO alarm is armed
        // (arming one for an already-past due time would loop). They fire
        // on all-clear, because [DisplayEmergency] calls [replayPending]
        // on release. If the process dies mid-alert, the boot-path
        // replayPending lands right back here and defers again.
        if (DisplayEmergency.isHeld(app)) {
            PlayerLogger.e(
                TAG,
                "${all.size} dead-man revert(s) DEFERRED — an emergency alert is active; " +
                    "they will fire on all-clear",
            )
            return
        }

        val now = System.currentTimeMillis()
        val due = all.filter { it.isDue(now) }
        val remaining = all.filter { !it.isDue(now) }
        if (due.isEmpty()) {
            scheduleRevertAlarm(app)
            return
        }
        DisplayPrefs.commitPendingReverts(app, remaining)

        due.sortedBy { if (it.ownsBlankState) 1 else 0 }.forEach { record ->
            record.revertActions().forEach { action ->
                PlayerLogger.i(TAG, "DEAD-MAN REVERT firing → ${action.describe()} (${record.capability})")
                val result = DisplayControlRegistry.apply(app, action, revertAfterMs = null)
                if (!result.ok) {
                    PlayerLogger.e(TAG, "dead-man revert did NOT take: ${action.describe()} → $result")
                }
            }
        }
        if (remaining.isNotEmpty()) scheduleRevertAlarm(app)
    }

    /**
     * Cancel every pending revert (the operator explicitly kept the
     * change). Deliberately all-or-nothing: "Keep" in the dashboard
     * means "this is the new normal", and leaving one capability armed
     * would silently undo half of what they just kept.
     */
    fun cancel(ctx: Context) {
        val app = ctx.applicationContext
        DisplayPrefs.clearPendingReverts(app)
        runCatching {
            alarmManager(app)?.cancel(pendingIntent(app))
        }.onFailure { PlayerLogger.w(TAG, "cancel alarm failed: ${it.message}") }
        PlayerLogger.i(TAG, "dead-man revert(s) cancelled — the change is now permanent")
    }

    /** The record that fires soonest, for the "reverting in Ns" readout. */
    fun peek(ctx: Context): PendingRevert? = DisplayPrefs.nextPendingRevert(ctx.applicationContext)

    /** Every outstanding record. */
    fun peekAll(ctx: Context): List<PendingRevert> = DisplayPrefs.pendingReverts(ctx.applicationContext)

    /**
     * Arm the wall-clock alarm for the EARLIEST record on disk. Exact
     * where the OS permits it, inexact-but-guaranteed otherwise — a
     * revert a few minutes late is fine; one that never fires is not,
     * which is why this never simply gives up.
     *
     * One alarm covers the whole set: [fireDue] restores everything that
     * is due and re-arms for whatever is left.
     */
    fun scheduleRevertAlarm(ctx: Context) {
        val app = ctx.applicationContext
        val record = DisplayPrefs.nextPendingRevert(app) ?: return
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
