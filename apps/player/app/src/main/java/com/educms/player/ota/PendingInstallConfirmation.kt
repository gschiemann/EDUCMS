package com.educms.player.ota

/**
 * PendingInstallConfirmation — the Player's OWN update is waiting on the
 * system "Install?" dialog, as a persisted, bounded fact (1.1.46).
 *
 * ── THE FIELD FAILURE (Android 11 GUQ units, 1.1.44 → 1.1.45) ─────────────
 *
 * The push raised the PackageInstaller confirmation (our Activity paused:
 * `PLAYER_NATIVE_VIDEO_STOP reason=activity-paused`). About ten minutes later
 * the in-memory [InstallPromptGate] window ran out and a recovery actor (the
 * 15-minute watchdog tick does not consult the gate at all) brought our
 * Activity back IN FRONT of the still-pending dialog. Every later dashboard
 * push only re-reported NEEDS_TAP for that buried session, so the owner
 * standing at the screen never saw a prompt.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 *  1. When the confirmation for our own session is launched, the session id,
 *     build and launch time are PERSISTED ([PendingInstallStore]); success,
 *     a terminal failure, an abandon or the window below clears it.
 *  2. While it is fresh and on this boot, no recovery path may bring the
 *     Activity to the front — except an emergency hold, which always wins.
 *  3. A NEW push identity re-opens the dialog: the old session is abandoned
 *     and a fresh one committed (on API 30 a fresh commit is the one path
 *     proven to put the dialog in front again; a buried confirm Activity
 *     cannot be raised reliably from the background).
 *  4. NEEDS_TAP is reported only inside [NEEDS_TAP_WINDOW_MS] of the launch.
 *     After it the session is abandoned and reported expired, and the next
 *     push starts fresh.
 *
 * Pure Kotlin (no Android imports) so every branch is a JVM test, like
 * [InstallPromptGate] and [OtaAttemptPolicy].
 */
object PendingInstallConfirmation {

    /** How long a launched confirmation counts as "a person may be reading it". */
    const val NEEDS_TAP_WINDOW_MS = 30L * 60L * 1000L

    /**
     * A push identity that arrives this soon after the launch is the SAME
     * operator push reaching us by a second route (the heartbeat and the web
     * relay both fire on one push): it must not tear down the dialog it just
     * raised.
     */
    const val REPUSH_MIN_AGE_MS = 2L * 60L * 1000L

    /** The dashboard state written when a launched confirmation aged out. */
    const val EXPIRED_STATE = "FAILED_TAP_EXPIRED"

    /**
     * 1.1.51 (Fix 9, item 4) — the wait is bounded by a TIMER, not by the next
     * check. [onCheck] expired a confirmation only when a check happened to
     * run (the 6-hour tick, a push, a boot), so a dialog nobody answered sat
     * reported NEEDS_TAP for up to six hours. A one-shot check is scheduled
     * when the confirmation is launched, just past the window, so the
     * EXPIRE branch runs at 30 minutes and reports [EXPIRED_STATE].
     */
    const val EXPIRY_CHECK_DELAY_MS = NEEDS_TAP_WINDOW_MS + 15_000L

    data class Record(
        val sessionId: Int,
        val versionCode: Int,
        val versionName: String,
        /** The push identity that raised it (`forceUpdatePendingAt`), if known. */
        val pushKey: String?,
        /** `System.currentTimeMillis()` at launch — survives a reboot. */
        val launchedAtWallMs: Long,
        /** `SystemClock.elapsedRealtime()` at launch — exact within one boot. */
        val launchedAtElapsedMs: Long,
    )

    /** Was the record written on THIS boot? (elapsedRealtime restarts at 0.) */
    fun sameBoot(r: Record, nowElapsedMs: Long): Boolean = nowElapsedMs >= r.launchedAtElapsedMs

    /**
     * Age of the launch. Within one boot the monotonic clock is exact; across
     * a reboot only the wall clock is left, and a negative wall age (a clock
     * step backwards) reads as EXPIRED — never latch on nonsense.
     */
    fun ageMs(r: Record, nowWallMs: Long, nowElapsedMs: Long): Long {
        if (sameBoot(r, nowElapsedMs)) return nowElapsedMs - r.launchedAtElapsedMs
        val wall = nowWallMs - r.launchedAtWallMs
        return if (wall < 0L) Long.MAX_VALUE else wall
    }

    fun isFresh(r: Record, nowWallMs: Long, nowElapsedMs: Long): Boolean =
        ageMs(r, nowWallMs, nowElapsedMs) < NEEDS_TAP_WINDOW_MS

    /**
     * Rule 2 — may a recovery actor bring the Activity to the front?
     * Returns true when it must NOT. An emergency always wins; a record from
     * a previous boot holds nothing (the dialog did not survive the reboot).
     */
    fun holdsRecovery(r: Record?, emergencyHeld: Boolean, nowWallMs: Long, nowElapsedMs: Long): Boolean {
        if (r == null || emergencyHeld) return false
        if (!sameBoot(r, nowElapsedMs)) return false
        return isFresh(r, nowWallMs, nowElapsedMs)
    }

    enum class CheckAction {
        /** Nothing pending. */
        NONE,
        /** Pending and fresh, same push: keep it, report NEEDS_TAP. */
        KEEP_NEEDS_TAP,
        /** A new push: abandon the session and commit a fresh one (re-opens the dialog). */
        REOPEN,
        /** Aged out: abandon the session, report expired, hold until the next push. */
        EXPIRE,
    }

    /**
     * Rules 3–4 — what an update check does with a pending confirmation.
     *
     * @param pushKey the push identity of THIS check; null for the 6-hour
     *                tick, a boot check or the web relay (they are not a new
     *                operator push).
     */
    fun onCheck(r: Record?, pushKey: String?, nowWallMs: Long, nowElapsedMs: Long): CheckAction {
        if (r == null) return CheckAction.NONE
        val age = ageMs(r, nowWallMs, nowElapsedMs)
        val newPush = !pushKey.isNullOrBlank() && pushKey != r.pushKey
        if (newPush && age >= REPUSH_MIN_AGE_MS) return CheckAction.REOPEN
        if (age >= NEEDS_TAP_WINDOW_MS) return CheckAction.EXPIRE
        // A record from before a reboot: its dialog is gone even if the wall
        // clock says it is young. A new push re-opens it (above); otherwise
        // nothing a person could tap exists, so it is not NEEDS_TAP.
        if (!sameBoot(r, nowElapsedMs)) return CheckAction.EXPIRE
        return CheckAction.KEEP_NEEDS_TAP
    }

    /** The installed build reached the pending one: the install landed. */
    fun landed(r: Record?, installedVersionCode: Int): Boolean =
        r != null && installedVersionCode >= r.versionCode

    /**
     * A terminal status for [sessionId] — does it settle THIS record? A late
     * status for a session we abandoned ourselves (rule 3) must not clear the
     * fresh one that replaced it.
     */
    fun settledBy(r: Record?, sessionId: Int): Boolean = r != null && sessionId > 0 && r.sessionId == sessionId
}
