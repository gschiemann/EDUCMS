package com.educms.player.display

/**
 * PURE state machine for the device-admin enrolment prompt.
 *
 * Deliberately free of any `android.*` reference so the rules that decide
 * whether a system SECURITY dialog appears on a wall-mounted screen have
 * tests that cannot be skipped for want of an emulator — the same
 * discipline [DisplayLimits] and [DisplayScheduleMath] follow.
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE TWO RULES THIS ENCODES (both are product requirements, not
 * defensive programming)
 * ═════════════════════════════════════════════════════════════════════
 *
 *  1. **Never enrol silently or automatically, and never prompt on
 *     boot.** Enforced structurally, not here: nothing on the boot,
 *     schedule, manifest or watchdog path calls
 *     `DeviceAdminEnrollment.requestEnrollment`, and it requires an
 *     `Activity` plus an explicit named source. This file's job is the
 *     second rule.
 *
 *  2. **Once declined, do not nag.** A signage box that re-pops an
 *     Android security dialog in front of customers is worse than a
 *     screen that dims in software. So a decline is REMEMBERED and a
 *     re-prompt is refused for [DECLINE_COOLDOWN_MS]. That is a real
 *     cap on any caller stuck in a loop — including a hostile board
 *     iframe reaching the every-frame bridge — while never permanently
 *     stranding an operator who mis-tapped: Settings → Security →
 *     Device admin apps is always available (which is exactly why
 *     `player_device_admin.xml` sets `android:visible="true"`).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY A SETTLE STEP AND NOT `startActivityForResult`
 * ═════════════════════════════════════════════════════════════════════
 * `ACTION_ADD_DEVICE_ADMIN` does return RESULT_OK/RESULT_CANCELED, but
 * routing that through MainActivity would add a deprecated
 * `onActivityResult` override whose result can be lost to a process
 * death while the dialog is up (which on a low-RAM signage box is a real
 * outcome). Instead the prompt writes a `promptedAt` marker and the NEXT
 * `onResume` — the hook that already re-resolves the provider chain —
 * asks the OS the only question that actually matters: *are we an active
 * admin now?* That is durable across a process death, needs no new
 * lifecycle plumbing, and is the same "re-ask on resume" pattern the
 * WRITE_SETTINGS appop already uses.
 */
enum class AdminEnrollmentState {
    /** We are an active device admin. `lockNow()` is available. */
    ENROLLED,

    /** A prompt was fired and we have not yet seen how it ended. */
    PROMPT_PENDING,

    /** A prompt was fired and the operator did not activate it. */
    DECLINED,

    /** Never prompted, never enrolled. The out-of-box state. */
    NOT_ENROLLED,
}

/**
 * Everything the state machine needs, in one value.
 *
 * [isActiveAdmin] is the OS's answer (`DevicePolicyManager.isAdminActive`)
 * and is ALWAYS authoritative — the three timestamps are our own bookkeeping
 * and can be stale, wrong, or wiped by a clear-data. Any rule that would
 * contradict [isActiveAdmin] is a bug.
 */
data class AdminEnrollmentRecord(
    val isActiveAdmin: Boolean,
    /** When we last fired the system dialog. 0 = never / already settled. */
    val promptedAtMs: Long = 0L,
    /** When a fired prompt was last observed to have NOT enrolled us. 0 = never. */
    val declinedAtMs: Long = 0L,
    /** When we first observed ourselves active. 0 = never. */
    val enrolledAtMs: Long = 0L,
)

/** Outcome of asking "may we show the system dialog right now?" */
sealed class PromptDecision {
    object Prompt : PromptDecision()

    /** [code] is machine-readable and stable; the dashboard/log keys off it. */
    data class Refuse(val code: String, val reason: String) : PromptDecision()
}

object DeviceAdminEnrollmentMath {

    /**
     * A second prompt within this window is refused unconditionally —
     * even an operator-initiated one. It is shorter than the time it
     * takes to read the dialog, so a human double-tap is absorbed while
     * a caller in a tight loop is capped hard.
     */
    const val PROMPT_DEBOUNCE_MS = 10_000L

    /**
     * A prompt older than this with no resolution is READ as declined,
     * even before a settle has written that down. Keeps the probe honest
     * on a screen whose Activity never came back (the operator wandered
     * off, the box slept, the process died) — otherwise a single
     * unresolved prompt would report PROMPT_PENDING forever.
     */
    const val PROMPT_STALE_MS = 10 * 60_000L

    /**
     * Settle grace. `onResume` can fire before the system dialog has
     * taken focus (and does, on some ROMs), so a settle inside this
     * window would record a decline the operator never made. Erring
     * toward "still pending" only DELAYS the decline to the next resume;
     * it can never lose it, because `promptedAtMs` stays set.
     */
    const val SETTLE_GRACE_MS = 1_500L

    /** How long a decline suppresses re-prompting. See rule 2 above. */
    const val DECLINE_COOLDOWN_MS = 5 * 60_000L

    /** Refusal codes. Stable strings — logs and the bridge reply carry them. */
    const val CODE_ALREADY_ENROLLED = "already-enrolled"
    const val CODE_PROMPT_PENDING = "prompt-pending"
    const val CODE_RECENTLY_DECLINED = "recently-declined"

    /**
     * Read-only view of where enrolment stands.
     *
     * [isActiveAdmin] wins over every timestamp: an operator who enabled
     * us straight from Settings has no `promptedAtMs` at all, and a
     * `declinedAtMs` left over from a previous refusal must not make a
     * genuinely-enrolled screen report DECLINED.
     */
    fun state(record: AdminEnrollmentRecord, nowMs: Long): AdminEnrollmentState {
        if (record.isActiveAdmin) return AdminEnrollmentState.ENROLLED
        if (record.promptedAtMs > 0L) {
            // A NEGATIVE elapsed (the box's wall clock stepped backwards,
            // which Android does on first NTP sync) is treated as "still
            // pending" rather than "stale": leniency here only delays the
            // decline record, and it self-heals as soon as the clock moves
            // forward again.
            val elapsed = nowMs - record.promptedAtMs
            if (elapsed < PROMPT_STALE_MS) return AdminEnrollmentState.PROMPT_PENDING
            return AdminEnrollmentState.DECLINED
        }
        if (record.declinedAtMs > 0L) return AdminEnrollmentState.DECLINED
        return AdminEnrollmentState.NOT_ENROLLED
    }

    /**
     * What `onResume` should PERSIST, or null when there is nothing to
     * write.
     *
     * Returning null for the common case is the point: `onResume` runs on
     * every foreground transition of a kiosk that runs for months, and a
     * SharedPreferences write per resume is a write we do not need.
     */
    fun settle(record: AdminEnrollmentRecord, nowMs: Long): AdminEnrollmentRecord? {
        if (record.promptedAtMs <= 0L) return null   // nothing outstanding
        val elapsed = nowMs - record.promptedAtMs
        if (record.isActiveAdmin) {
            return record.copy(
                promptedAtMs = 0L,
                declinedAtMs = 0L,
                // Keep the FIRST enrolment time; re-enrolling should not
                // rewrite history the ops report reads.
                enrolledAtMs = if (record.enrolledAtMs > 0L) record.enrolledAtMs else nowMs,
            )
        }
        // Not admin, and the dialog may still be on screen. Wait one more
        // resume rather than inventing a decline.
        if (elapsed in 0 until SETTLE_GRACE_MS) return null
        return record.copy(promptedAtMs = 0L, declinedAtMs = nowMs)
    }

    /**
     * May we show the system dialog right now?
     *
     * Note there is NO "operator override" parameter. Every call site is
     * already operator-initiated, so a bypass flag would be set by all of
     * them and the cooldown would be decoration. The cooldown is only
     * meaningful if it binds the callers we actually have.
     */
    fun decide(record: AdminEnrollmentRecord, nowMs: Long): PromptDecision {
        if (record.isActiveAdmin) {
            return PromptDecision.Refuse(
                CODE_ALREADY_ENROLLED,
                "this screen is already a device admin — blank already uses lockNow()",
            )
        }
        if (record.promptedAtMs > 0L) {
            val sincePrompt = nowMs - record.promptedAtMs
            if (sincePrompt < PROMPT_DEBOUNCE_MS) {
                return PromptDecision.Refuse(
                    CODE_PROMPT_PENDING,
                    "the setup dialog was just shown — finish or dismiss it first",
                )
            }
        }
        if (record.declinedAtMs > 0L) {
            val sinceDecline = nowMs - record.declinedAtMs
            if (sinceDecline in 0 until DECLINE_COOLDOWN_MS) {
                return PromptDecision.Refuse(
                    CODE_RECENTLY_DECLINED,
                    "setup was declined a moment ago — not re-prompting; " +
                        "Settings > Security > Device admin apps can turn it on directly",
                )
            }
        }
        return PromptDecision.Prompt
    }

    /** Lowercase wire form for the probe / bridge reply. */
    fun wireName(state: AdminEnrollmentState): String = when (state) {
        AdminEnrollmentState.ENROLLED -> "enrolled"
        AdminEnrollmentState.PROMPT_PENDING -> "prompt-pending"
        AdminEnrollmentState.DECLINED -> "declined"
        AdminEnrollmentState.NOT_ENROLLED -> "not-enrolled"
    }
}
