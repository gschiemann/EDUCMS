package com.educms.player.ota

/**
 * InstallPromptGate — "is a system install confirmation on the glass right
 * now?", as a fact the relaunch machinery can read.
 *
 * ── THE FIELD FAILURE (TC22, 2026-09-01) ─────────────────────────────────
 *
 * Operator: *"it updated the player and at least asked to update the manager
 * but it did not update it."*
 *
 * The "ask" is the system PackageInstaller confirmation Activity for
 * `com.educms.manager`, raised by [OtaInstallReceiver]'s
 * STATUS_PENDING_USER_ACTION trampoline through `MainActivity`. While that
 * dialog owns the screen **MainActivity is PAUSED** — so
 * `MainActivity.isInForeground` reads FALSE, and every relaunch actor that
 * treats "not foreground" as "the player is gone" fires INTO the dialog:
 * `RelaunchEscalation.attempt` (the +60 s post-install rung) pulls
 * MainActivity back to the front with `CLEAR_TOP|RESET_TASK_IF_NEEDED`, the
 * confirmation is buried/aborted, and the companion never updates. The guard
 * added in `319974bd` (`if (MainActivity.isInForeground) return`) fixed the
 * already-foreground case and left this one wide open — the guard is
 * INVERTED for exactly the state that matters.
 *
 * ⚠️ NEVER EQUATE SIGNALS (player-reliability rule 5). "MainActivity is not
 * resumed" has at least two causes and they need opposite responses:
 *   • the post-OTA relaunch never landed  → relaunch, escalate, report.
 *   • WE put a system dialog on top of it → do nothing, let the human read
 *     it. Relaunching here is not recovery, it is sabotage.
 * This file is the second fact, so the two stop being one flag.
 *
 * ── WHAT COUNTS AS PROOF, AND WHAT DOES NOT ──────────────────────────────
 *
 * We cannot see the glass and Android never tells us "that dialog is still
 * up". What we CAN observe honestly:
 *   • we called `startActivity(confirmIntent)` at a known moment;
 *   • the target package's installed version code changed (the install
 *     landed — the dialog is provably gone);
 *   • the PackageInstaller session reported a terminal status;
 *   • MainActivity resumed again.
 *
 * So the hold is deliberately bounded on all sides: it clears on real
 * evidence, and it EXPIRES on its own. A suppression flag that could latch
 * forever would convert one buried dialog into a screen that can never be
 * relaunched again — a worse failure than the one being fixed.
 *
 * Pure Kotlin on purpose (no Android imports): the decision is the part
 * worth testing without an emulator, exactly like `RelaunchEscalationMath`
 * and `SetupCeremonyMath`. `MainActivity` owns the mutable facts; this owns
 * what they mean.
 */
object InstallPromptGate {

    /**
     * How long a raised confirmation may suppress relaunches before we stop
     * believing in it. 10 minutes.
     *
     * Sized as "longer than any plausible read-and-tap by a person who
     * walked to the panel, shorter than a shift". Past it we have no
     * evidence either way — and 'no evidence' must resolve to the state
     * that can still recover a screen, never to a permanent hold.
     */
    const val MAX_OUTSTANDING_MS = 10L * 60L * 1000L

    /**
     * How long the prompt must have been up before a resume of MainActivity
     * is allowed to mean "the operator came back".
     *
     * ⚠️ Not decoration. The trampoline itself brings MainActivity to the
     * front (that is the whole BAL bypass) and THEN calls startActivity on
     * the confirmation — so a resume lands within milliseconds of the raise
     * on every single install. Without this floor the gate would clear
     * itself on its own trampoline and suppress nothing.
     */
    const val MIN_ON_SCREEN_MS = 3_000L

    /**
     * How many times one staged confirmation may be RE-shown after the
     * first raise (F4). Bounded because the honest failure mode of a
     * re-issuable prompt is a dialog loop: operator dismisses → we resume →
     * we re-raise → they dismiss… A wall panel that cannot be dismissed is
     * a brick with better manners. After the cap, the gate's "Retry install"
     * button (remote-focused) and its Back escape are the way forward.
     */
    const val MAX_REISSUES = 2

    /**
     * Minimum gap between raising the same confirmation twice. Same reason
     * as [MIN_ON_SCREEN_MS]: our own resume must never be read as the
     * operator's.
     */
    const val REISSUE_MIN_GAP_MS = 5_000L

    /**
     * Every fact the verdict may use, and nothing it may not.
     *
     * @param raisedAtMs           `SystemClock.elapsedRealtime()` when we called
     *                             `startActivity(confirmIntent)`; null = no
     *                             confirmation has been raised in this process.
     * @param nowMs                same clock, read now. `elapsedRealtime`, never
     *                             `currentTimeMillis` — signage boxes step the
     *                             wall clock on first NTP sync and a backwards
     *                             step would make a stale raise look fresh.
     * @param targetVersionChanged the target package's installed version code
     *                             changed since the raise (PACKAGE_ADDED /
     *                             PACKAGE_REPLACED observed, the gate poller saw
     *                             the new version, or the session reported
     *                             SUCCESS). The install landed: the dialog is
     *                             gone.
     * @param terminalStatusSeen   the PackageInstaller session reported a
     *                             terminal FAILURE/ABORTED for this prompt.
     * @param activityResumed      MainActivity is resumed right now.
     */
    data class Facts(
        val raisedAtMs: Long?,
        val nowMs: Long,
        val targetVersionChanged: Boolean = false,
        val terminalStatusSeen: Boolean = false,
        val activityResumed: Boolean = false,
    )

    /** What the facts add up to. */
    enum class Verdict {
        /** Nothing was ever raised in this process. */
        NONE,

        /**
         * As far as anything we can observe, a confirmation is on the glass.
         * DO NOT relaunch, do not escalate, do not report RELAUNCH_BLOCKED.
         */
        OUTSTANDING,

        /** The target package's version changed — the install landed. */
        CLEARED_VERSION_CHANGED,

        /** Terminal status reported and we are back on the glass. */
        CLEARED_SETTLED,

        /** The bounded window elapsed with no evidence either way. */
        CLEARED_EXPIRED,
    }

    /**
     * The whole decision. Order matters and is deliberate:
     *
     *  1. nothing raised            → NONE
     *  2. an unusable timestamp     → EXPIRED (never latch on nonsense)
     *  3. version changed           → the strongest evidence there is
     *  4. window elapsed            → the safety valve; it outranks the
     *                                 terminal-status clause so a status
     *                                 broadcast that never arrives cannot
     *                                 hold a screen hostage
     *  5. terminal status + resumed + past the floor → settled
     *  6. otherwise                 → OUTSTANDING
     */
    fun verdict(facts: Facts): Verdict {
        val raisedAt = facts.raisedAtMs ?: return Verdict.NONE
        val ageMs = facts.nowMs - raisedAt
        if (ageMs < 0L) return Verdict.CLEARED_EXPIRED
        if (facts.targetVersionChanged) return Verdict.CLEARED_VERSION_CHANGED
        if (ageMs >= MAX_OUTSTANDING_MS) return Verdict.CLEARED_EXPIRED
        if (facts.terminalStatusSeen && facts.activityResumed && ageMs >= MIN_ON_SCREEN_MS) {
            return Verdict.CLEARED_SETTLED
        }
        return Verdict.OUTSTANDING
    }

    /** Convenience for every caller that only wants the yes/no. */
    fun isOutstanding(facts: Facts): Boolean = verdict(facts) == Verdict.OUTSTANDING

    /**
     * F4 — may we RE-show a staged confirmation that is no longer
     * outstanding? Only under all of:
     *
     *  • we are deliberately HOLDING content for it (the manager gate is up).
     *    On a screen that is playing, a covered dialog is not worth putting a
     *    system prompt back over the content unasked.
     *  • the staged intent is still there.
     *  • the previous raise has settled/expired, and long enough ago that we
     *    are not reacting to our own trampoline's resume.
     *  • we have not already spent the re-issue budget.
     */
    fun shouldReissue(
        holdingContentForUpgrade: Boolean,
        hasStagedPrompt: Boolean,
        outstanding: Boolean,
        reissuesUsed: Int,
        lastRaisedAtMs: Long?,
        nowMs: Long,
    ): Boolean {
        if (!holdingContentForUpgrade || !hasStagedPrompt || outstanding) return false
        if (reissuesUsed >= MAX_REISSUES) return false
        val since = lastRaisedAtMs?.let { nowMs - it } ?: return true
        return since >= REISSUE_MIN_GAP_MS
    }

    /**
     * F4 — is a staged confirmation still worth keeping?
     *
     * `takePendingInstallPrompt` used to be single-use: one reader, which
     * nulled it. A BAL-dropped launch, or a dialog the operator covered,
     * consumed the only copy and nothing re-staged it — the bundled-Manager
     * upgrade could then only be retried by a COLD `onCreate`. Staging now
     * survives until the install actually lands or the intent goes stale.
     */
    fun stagedPromptStillUsable(
        stagedAtMs: Long?,
        nowMs: Long,
        targetVersionChanged: Boolean,
    ): Boolean {
        val stagedAt = stagedAtMs ?: return false
        if (targetVersionChanged) return false
        val ageMs = nowMs - stagedAt
        return ageMs in 0L until MAX_OUTSTANDING_MS
    }
}
