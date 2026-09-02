package com.educms.player.boot

/**
 * BOOT + REGISTRATION WATCHDOG — the pure half (2026-09-02, P0-2).
 *
 * ============================================================
 * THE FAILURE
 * ============================================================
 *
 * Real OEM Android-9 Goodview units loaded the player URL, got an HTTP
 * 200, fired `onPageFinished`, and were then treated by the APK as
 * healthy. They were dead: the WebView had rendered the SERVER-RENDERED
 * shell (whose splash reads "Connecting to your CMS…") and the client
 * bundle never ran, so registration never started. The installer saw a
 * sentence that was a lie, with no diagnostic and no escape.
 *
 * ============================================================
 * WHAT THIS FILE IS
 * ============================================================
 *
 * The decision logic, with no Android in it, so every deadline and every
 * latch is unit-testable without a device. [BootDiagnostics] owns the
 * Android side (probes, the view, telemetry) and consults this.
 *
 * ⚠️ THREE FACTS, THREE DEADLINES (player rule 5 — never equate signals).
 * A boot does not imply an attempt; an attempt does not imply a result.
 * One combined "is it alive" timer could be satisfied by the weakest of
 * the three, which is precisely the mistake that shipped.
 *
 * ⚠️ EVERY TIMESTAMP IS `SystemClock.elapsedRealtime`, NEVER WALL CLOCK.
 * Signage boxes step their clock minutes on first NTP sync; a wall-clock
 * deadline would fire instantly or never. This class takes `nowMs` from
 * its caller and only ever SUBTRACTS two of them.
 */

/**
 * How a registration failed, in the web player's vocabulary.
 *
 * [isTransport] is the subset that means "this screen cannot reach the
 * server at all" — the classes where waiting out the full result deadline
 * buys the installer nothing, because two of them in a row already prove
 * the network is the problem. An `http` failure is deliberately NOT in
 * that subset: a 429 or a 503 means we reached the API and it answered,
 * which the retry loop handles and which is not a boot fault. `storage`
 * is out for a different reason — it is a device fault the reachability
 * probes cannot explain, so it is reported but never escalated on its own.
 */
enum class RegisterFailureClass {
    DNS,
    TLS,
    HTTP,
    TIMEOUT,
    NETWORK,
    STORAGE,
    UNKNOWN;

    val isTransport: Boolean
        get() = this == DNS || this == TLS || this == TIMEOUT || this == NETWORK

    /** Lower-case wire form, as the web side sends it. */
    val wire: String get() = name.lowercase()

    companion object {
        /** Total: anything unrecognised is [UNKNOWN], never an exception. */
        fun parse(raw: String?): RegisterFailureClass {
            val key = raw?.trim()?.uppercase() ?: return UNKNOWN
            return values().firstOrNull { it.name == key } ?: UNKNOWN
        }
    }
}

/** Why the diagnostic screen was raised. One reason, always nameable. */
enum class BootFailureReason {
    /** The page never reported that its client JS ran. */
    NO_CLIENT_BOOT,

    /** JS booted, but no registration request was ever issued. */
    NO_REGISTER_ATTEMPT,

    /** A registration was issued and never answered. */
    NO_REGISTER_RESULT,

    /** Two consecutive transport-class failures — the network is the fault. */
    REPEATED_TRANSPORT_FAILURE,
}

/** Deadlines, in one place, so a test can assert them by name. */
object BootDeadlines {
    /**
     * How long after a navigation STARTS the page has to say its client JS
     * ran. 30 s. Sized above a cold 4K bundle's parse on a Chromium-83
     * Taurus but far below the 2-minute staleness watchdog, because the
     * whole point is to tell an installer something while they are still
     * standing there.
     */
    const val CLIENT_BOOT_MS = 30_000L

    /**
     * How long after a navigation starts a registration must have been
     * ATTEMPTED. 60 s — boot, hydration, credential resolution and the
     * first effect pass, doubled.
     */
    const val REGISTER_ATTEMPT_MS = 60_000L

    /**
     * How long after a navigation starts a registration must have been
     * ANSWERED. 120 s. Above the web side's own 20 s bounded fetch plus
     * its 6 s floor backoff and a second attempt, so an ordinary slow
     * first try never raises the screen.
     */
    const val REGISTER_RESULT_MS = 120_000L

    /**
     * Consecutive transport-class failures that raise the screen without
     * waiting out [REGISTER_RESULT_MS]. TWO, not one: a single DNS miss on
     * a box whose Wi-Fi has just associated is normal and self-heals.
     */
    const val CONSECUTIVE_TRANSPORT_FAILURES = 2
}

/**
 * Everything the diagnostic screen and the telemetry report need to know
 * about how this boot went. Immutable snapshot; [BootProgressTracker]
 * hands one out rather than exposing its own mutable fields.
 */
data class BootFacts(
    val loadStartedAtMs: Long,
    val clientBootedAtMs: Long,
    val registerAttemptedAtMs: Long,
    val registerResultAtMs: Long,
    val satisfied: Boolean,
    val lastFailureClass: RegisterFailureClass?,
    val lastFailureStatus: Int?,
    val lastFailureMessage: String?,
    val consecutiveTransportFailures: Int,
    val raisedReason: BootFailureReason?,
) {
    val clientBooted: Boolean get() = clientBootedAtMs != 0L
    val registerAttempted: Boolean get() = registerAttemptedAtMs != 0L
}

/**
 * The state machine.
 *
 * NOT thread-safe by construction and it does not need to be: every
 * mutator is posted to the main looper by [BootDiagnostics], the same
 * thread [evaluate] runs on. Making it `synchronized` would only hide a
 * threading mistake rather than prevent one.
 */
class BootProgressTracker {

    /**
     * Has a navigation ever begun? A separate flag rather than
     * `loadStartedAtMs != 0L`: `elapsedRealtime` CAN legitimately be 0 (or
     * near it) on a box that boots straight into the player, and a sentinel
     * that collides with a real value is the kind of bug that only shows up
     * on the slowest hardware in the field.
     */
    private var armed: Boolean = false

    private var loadStartedAtMs: Long = 0L
    private var clientBootedAtMs: Long = 0L
    private var registerAttemptedAtMs: Long = 0L
    private var registerResultAtMs: Long = 0L

    /**
     * A registration has SUCCEEDED since the last navigation began. Once
     * true this tracker raises nothing until [onLoadStarted] re-arms it —
     * the screen is a BOOT watchdog, and a diagnostic over live content is
     * a worse outcome than no diagnostic at all.
     */
    private var satisfied: Boolean = false

    /**
     * The verdict already raised for THIS navigation, if any. Latched so a
     * screen that is still failing does not re-raise (and re-report)
     * every tick; cleared by the next [onLoadStarted] or by a success.
     */
    private var raisedReason: BootFailureReason? = null

    private var lastFailureClass: RegisterFailureClass? = null
    private var lastFailureStatus: Int? = null
    private var lastFailureMessage: String? = null
    private var consecutiveTransportFailures: Int = 0

    /**
     * Wall-clock time of the last SUCCESSFUL registration, or 0.
     * Deliberately wall clock and deliberately separate from every other
     * stamp here: it is the one value a human reads ("last registered
     * 14:02"), it is persisted across process death, and it is never used
     * in a deadline comparison.
     */
    var lastRegisterOkWallMs: Long = 0L
        private set

    /** A new navigation began. Re-arms everything. */
    fun onLoadStarted(nowMs: Long) {
        armed = true
        loadStartedAtMs = nowMs
        clientBootedAtMs = 0L
        registerAttemptedAtMs = 0L
        registerResultAtMs = 0L
        satisfied = false
        raisedReason = null
        // Transport failures deliberately SURVIVE a reload: the reload is
        // usually OUR OWN recovery attempt, and resetting the counter on it
        // would mean a screen with no uplink alternates reload/reset forever
        // and never reaches the escalation. Only a success clears it.
    }

    /** FACT 1. */
    fun onClientBooted(nowMs: Long) {
        if (clientBootedAtMs == 0L) clientBootedAtMs = nowMs
    }

    /**
     * FACT 2. Overwrites: the deadline that matters is the LATEST attempt's,
     * so a screen that retries every 6 s is judged on its newest request.
     */
    fun onRegisterAttempt(nowMs: Long) {
        registerAttemptedAtMs = nowMs
        // An attempt is also proof the bundle is running — a page cannot
        // issue one otherwise. On the legacy bridge, or with a dropped
        // bootProof, this is the fallback evidence for fact 1.
        if (clientBootedAtMs == 0L) clientBootedAtMs = nowMs
    }

    /** FACT 3. */
    fun onRegisterResult(
        nowMs: Long,
        wallMs: Long,
        ok: Boolean,
        failureClass: RegisterFailureClass?,
        httpStatus: Int?,
        message: String?,
    ) {
        registerResultAtMs = nowMs
        if (registerAttemptedAtMs == 0L) registerAttemptedAtMs = nowMs
        if (clientBootedAtMs == 0L) clientBootedAtMs = nowMs
        if (ok) {
            satisfied = true
            raisedReason = null
            consecutiveTransportFailures = 0
            lastFailureClass = null
            lastFailureStatus = null
            lastFailureMessage = null
            lastRegisterOkWallMs = wallMs
            return
        }
        val cls = failureClass ?: RegisterFailureClass.UNKNOWN
        lastFailureClass = cls
        lastFailureStatus = httpStatus
        lastFailureMessage = message
        consecutiveTransportFailures =
            if (cls.isTransport) consecutiveTransportFailures + 1 else 0
    }

    /** Seed the persisted value on process start. Never moves it backwards. */
    fun seedLastRegisterOk(wallMs: Long) {
        if (wallMs > lastRegisterOkWallMs) lastRegisterOkWallMs = wallMs
    }

    fun facts(): BootFacts = BootFacts(
        loadStartedAtMs = loadStartedAtMs,
        clientBootedAtMs = clientBootedAtMs,
        registerAttemptedAtMs = registerAttemptedAtMs,
        registerResultAtMs = registerResultAtMs,
        satisfied = satisfied,
        lastFailureClass = lastFailureClass,
        lastFailureStatus = lastFailureStatus,
        lastFailureMessage = lastFailureMessage,
        consecutiveTransportFailures = consecutiveTransportFailures,
        raisedReason = raisedReason,
    )

    /**
     * Should the diagnostic screen go up right now?
     *
     * Returns the reason on the tick that CROSSES a threshold, and null on
     * every tick after that (the latch) — so the caller raises and reports
     * exactly once per navigation, per cause.
     *
     * Order is most-specific-first: a repeated transport failure is a
     * better explanation than "no result yet", and "JS never ran" is a
     * better explanation than "no registration was attempted" (the second
     * is merely a consequence of the first).
     */
    fun evaluate(nowMs: Long): BootFailureReason? {
        if (satisfied) return null
        if (raisedReason != null) return null
        if (!armed) return null
        val sinceLoad = nowMs - loadStartedAtMs

        if (consecutiveTransportFailures >= BootDeadlines.CONSECUTIVE_TRANSPORT_FAILURES) {
            raisedReason = BootFailureReason.REPEATED_TRANSPORT_FAILURE
            return raisedReason
        }
        if (clientBootedAtMs == 0L) {
            if (sinceLoad >= BootDeadlines.CLIENT_BOOT_MS) {
                raisedReason = BootFailureReason.NO_CLIENT_BOOT
                return raisedReason
            }
            return null
        }
        if (registerAttemptedAtMs == 0L) {
            if (sinceLoad >= BootDeadlines.REGISTER_ATTEMPT_MS) {
                raisedReason = BootFailureReason.NO_REGISTER_ATTEMPT
                return raisedReason
            }
            return null
        }
        if (sinceLoad >= BootDeadlines.REGISTER_RESULT_MS) {
            raisedReason = BootFailureReason.NO_REGISTER_RESULT
            return raisedReason
        }
        return null
    }

    /** The operator pressed Retry — treat it as a fresh navigation. */
    fun onManualRetry(nowMs: Long) = onLoadStarted(nowMs)
}

/**
 * MAY the diagnostic screen be raised at all?
 *
 * Kept pure and separate from [BootProgressTracker.evaluate] because the
 * two answer different questions: the tracker says "this boot has failed",
 * this says "and nothing more important is on the glass". Returns the
 * suppression reason (for the log) or null when the screen may go up.
 *
 * ⚠️ EVERY ONE OF THESE IS A REAL FIELD SCAR, NOT A HYPOTHETICAL.
 *  • An emergency hold means a lockdown/evacuate alert is on the wall. A
 *    diagnostic card over it would be the single worst thing this feature
 *    could do (CLAUDE.md: emergency logic first, always).
 *  • An install/upgrade confirmation is a SYSTEM dialog the operator is
 *    mid-way through; covering it strands the companion upgrade that the
 *    relaunch program exists to finish.
 *  • The setup ceremony and the manager-install gate are the surfaces an
 *    installer is actively working, and both legitimately run with no
 *    registration at all — raising here would fight the ceremony for
 *    focus on a panel whose only input is a D-pad (rule 15).
 *  • In lock task the OS refuses to launch Settings, so this screen's
 *    "Network settings" button would dead-end.
 */
fun bootDiagnosticSuppression(
    emergencyHeld: Boolean,
    installPromptOutstanding: Boolean,
    managerGateShown: Boolean,
    setupCeremonyShowing: Boolean,
    lockTaskActive: Boolean,
): String? = when {
    emergencyHeld -> "an emergency hold is active"
    installPromptOutstanding -> "a system install confirmation is on screen"
    managerGateShown -> "the manager-install gate owns the screen"
    setupCeremonyShowing -> "the setup ceremony is on screen"
    lockTaskActive -> "lock task is active"
    else -> null
}
