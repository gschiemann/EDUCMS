package com.educms.player.wake

/**
 * AFTER A WAKE, IS THE PLAYER ON THE GLASS? — the rules (2026-10-11).
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE FIELD FAILURE THIS ANSWERS
 * ═════════════════════════════════════════════════════════════════════
 * Three trials on MAXHUB L55VEC / M43 (Android 13, player 1.1.26, device
 * admin enrolled) took 60–120 s from a wake — the dead-man revert, an
 * operator Turn on, a native alert raise — to content on the glass, and
 * the native runtime report's `interactive` lagged the panel by minutes.
 * `docs/research/2026-10-11-sleep-wake/02-slow-wake-fix.md` has the
 * timelines.
 *
 * Until now a wake was ONE act: the panel is poked awake (a wake lock, the
 * window's turn-screen-on flags) and whatever Android then puts on top is
 * what shows. Only the native alert watch ever asked afterwards whether the
 * player was in front — and only for an alert, 5–60 s later. Every other
 * wake path (the dead-man revert, Turn on, the schedule's ON, the end of a
 * standby) never checked at all.
 *
 * This policy makes every wake a short, bounded sequence:
 *   t+1 s, t+3 s, t+6 s — is MainActivity resumed? If the panel is on and
 *   it is not, bring the EXISTING Activity forward (singleTask: no recreate,
 *   no page reload), at most [MAX_LAUNCHES_PER_WAKE] times, and write what
 *   was seen as a marker the server can read.
 *
 * RULES (every one has a JVM test, WakePolicyTest):
 *  1. ON THE GLASS ENDS IT. A resumed MainActivity is the only proof of a
 *     landed wake (the same fact `RelaunchEscalation` trusts).
 *  2. NEVER LIGHT A PANEL THAT IS MEANT TO BE DARK. While the panel is not
 *     interactive nothing is launched — a launch carries turn-screen-on.
 *     A person's standby in force stops the sequence outright; only an
 *     active emergency hold outranks it (the alert already ended the
 *     standby on its way in).
 *  3. YIELD TO A PERSON. A system install confirmation of ours, or a person
 *     working in a Settings screen opened from the setup card, is not a
 *     stranded player (the TC22 / X80 lessons) — stop, never launch over it.
 *  4. BOUNDED. At most [MAX_LAUNCHES_PER_WAKE] launches per wake, and no
 *     launch within [LAUNCH_RATE_WINDOW_MS] of a previous wake's launches —
 *     a panel that will not come forward is reported, not hammered.
 *  5. The page is NEVER reloaded and the Activity NEVER recreated here; the
 *     alert watch's confirm-or-reload stays the only thing that reloads, and
 *     only for an unconfirmed alert.
 *
 * No android.*, no clock reads, no I/O.
 */
object WakePolicy {

    /** When, after the wake was requested, the foreground is checked (`elapsedRealtime` deltas). */
    val CHECK_DELAYS_MS: LongArray = longArrayOf(1_000L, 3_000L, 6_000L)

    /** Launches of the existing Activity one wake may spend. */
    const val MAX_LAUNCHES_PER_WAKE = 2

    /** No launch within this of the previous wake's launches: bounded fleet-wide, not per wake. */
    const val LAUNCH_RATE_WINDOW_MS = 60_000L

    /**
     * A wake that reached onResume inside this window is "complete" (its
     * `resAt - reqAt` is the number the dashboard shows); later resumes are
     * recorded too, but the wake is already reported as not landed.
     */
    const val SETTLE_WINDOW_MS = 15_000L

    /**
     * A process that starts while a wake requested less than this ago has no
     * resume on record was restarted BY that wake (or by whatever the wake
     * did to the box) — the one fact the 2026-10-11 drill could not show.
     */
    const val RESTART_ATTRIBUTION_WINDOW_MS = 10L * 60_000L

    /** What the sequence may do at one check. */
    enum class Step {
        /** MainActivity is resumed — the wake landed. */
        DONE_ON_GLASS,

        /** Bring the existing Activity forward now. */
        LAUNCH,

        /** Nothing yet — look again at the next check. */
        WAIT,

        /** The panel is (still) not interactive at the last check. Never launch into the dark. */
        STOP_PANEL_DARK,

        /** A person's standby is in force and no alert outranks it. */
        STOP_STANDBY,

        /** One of our system install confirmations is on the glass. */
        STOP_INSTALL_PROMPT,

        /** A person is in a system screen opened from the setup card. */
        STOP_SETUP,

        /** The launch budget for this wake, or the rate window, is spent. */
        STOP_BUDGET,
    }

    /** Everything the decision may use, and nothing it may not. */
    data class Facts(
        /** `PowerManager.isInteractive`; null = unreadable (treated as dark — rule 2). */
        val interactive: Boolean?,
        /** `MainActivity.isInForeground` — the only proof (rule 1). */
        val foreground: Boolean,
        /** `UserStandby.isActive`. */
        val standbyActive: Boolean,
        /** `DisplayEmergency.isHeld` — the one thing that outranks a standby. */
        val emergencyHeld: Boolean,
        /** `MainActivity.installPromptOutstanding`. */
        val installPromptOutstanding: Boolean,
        /** `SetupCeremony.relaunchShouldYield`. */
        val setupYield: Boolean,
        /** Launches already spent on THIS wake. */
        val launchesThisWake: Int,
        /** `elapsedRealtime` of the last launch any wake made in this process; 0 = none. */
        val lastLaunchAtMs: Long,
        /** `elapsedRealtime` now. */
        val nowMs: Long,
        /** Is this the last scheduled check for this wake? */
        val lastCheck: Boolean,
    )

    /**
     * A wake asked for while the panel is on AND the player is already in
     * front has nothing to do: no sequence, no timeline (the report's
     * `interactive` / `foreground` already say so). This matters most for
     * the emergency path, which re-asserts a wake on EVERY manifest poll
     * while an alert is up — a sequence per poll would be a marker, two
     * prefs commits and a prompt heartbeat every 30 s for the whole alert.
     */
    fun alreadyOnGlass(interactive: Boolean?, foreground: Boolean): Boolean = interactive == true && foreground

    /**
     * Whether an already-on-glass wake still pulls the heartbeat forward:
     * a command wants its acknowledgement promptly (`power-on`, `command`,
     * the revert); the alert's per-poll re-assert does not.
     */
    fun promptWhenAlreadyOnGlass(source: String): Boolean = source != "emergency"

    fun step(f: Facts): Step {
        if (f.foreground) return Step.DONE_ON_GLASS
        if (f.standbyActive && !f.emergencyHeld) return Step.STOP_STANDBY
        // 1.1.46 — an install dialog never keeps an alert off the glass.
        if (f.installPromptOutstanding && !f.emergencyHeld) return Step.STOP_INSTALL_PROMPT
        if (f.setupYield) return Step.STOP_SETUP
        if (f.interactive != true) return if (f.lastCheck) Step.STOP_PANEL_DARK else Step.WAIT
        if (f.launchesThisWake >= MAX_LAUNCHES_PER_WAKE) return if (f.lastCheck) Step.STOP_BUDGET else Step.WAIT
        if (f.launchesThisWake == 0 && f.lastLaunchAtMs > 0L) {
            val since = f.nowMs - f.lastLaunchAtMs
            if (since in 0 until LAUNCH_RATE_WINDOW_MS) return if (f.lastCheck) Step.STOP_BUDGET else Step.WAIT
        }
        return Step.LAUNCH
    }

    /** Is a process start attributable to a wake that never reached onResume? */
    fun restartAttributableToWake(
        requestedAtWallMs: Long,
        resumedAtWallMs: Long,
        processStartedAtWallMs: Long,
    ): Boolean {
        if (requestedAtWallMs <= 0L) return false
        if (resumedAtWallMs >= requestedAtWallMs) return false
        val age = processStartedAtWallMs - requestedAtWallMs
        return age in 0..RESTART_ATTRIBUTION_WINDOW_MS
    }

    /** The `out` field of the report — what the sequence concluded. Short, server-validated tokens. */
    fun outcomeOf(step: Step): String = when (step) {
        Step.DONE_ON_GLASS -> "on-glass"
        Step.LAUNCH, Step.WAIT -> "pending"
        Step.STOP_PANEL_DARK -> "dark"
        Step.STOP_STANDBY -> "standby"
        Step.STOP_INSTALL_PROMPT -> "install-prompt"
        Step.STOP_SETUP -> "setup"
        Step.STOP_BUDGET -> "not-on-glass"
    }
}
