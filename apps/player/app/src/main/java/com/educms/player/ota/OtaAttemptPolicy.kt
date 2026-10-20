package com.educms.player.ota

/**
 * OtaAttemptPolicy — what the update worker does with ONE offered build, as a
 * pure decision (2026-10-17, unattended-updates program).
 *
 * ── THE FIELD FAILURE ─────────────────────────────────────────────────────
 *
 * After an operator pushed v1.1.29 on 2026-10-15, an Android 9 panel (M24)
 * downloaded the full APK 48 times in 24 hours. Every check re-ran the whole
 * pipeline — download, verify, commit — and every commit ended at Android's
 * "Install?" dialog, which on Android 11 and below always needs a person
 * (owner decision 2026-10-17: VenueOS will not be the device owner, so there
 * is no unattended install on those panels). Nobody was at the panel. The
 * work was thrown away and redone on the next check while the dashboard said
 * "Updating…".
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 *  1. A build that was downloaded AND matched its SHA-256 for the offered
 *     versionCode is KEPT and re-used — never downloaded again. (Re-hashed
 *     before use: the kept bytes are re-verified, not trusted.)
 *  2. Where Android lets us install silently (Android 12+ and the Player is
 *     its own installer of record — UPDATE_PACKAGES_WITHOUT_USER_ACTION), the
 *     worker commits as it always did.
 *  3. Everywhere else the dialog is raised ONCE per offered build by an
 *     unattended trigger (the 6-hour check, a dashboard push, a boot) —
 *     exactly the path that existed before this file. After that the worker
 *     reports NEEDS_TAP and stops: it re-commits only when a PERSON presses
 *     Update on the panel.
 *  4. A terminal install failure is not retried by a timer either.
 *
 * Pure Kotlin, no Android imports — the same shape as [InstallPromptGate] and
 * [OtaDigestPolicy], so every branch is a JVM unit test.
 */
object OtaAttemptPolicy {

    /** What happened to the last attempt at the stored build. */
    enum class Outcome {
        /** Nothing tried yet (just downloaded, or a fresh offer). */
        NONE,
        /** Our own session was committed; no status has come back yet. */
        COMMITTED,
        /** Android asked for a person to tap Install (PENDING_USER_ACTION). */
        NEEDS_TAP,
        /** A terminal PackageInstaller failure (see [Attempt.failureCode]). */
        FAILED,
        /**
         * 1.1.46 — the confirmation was launched and nobody tapped it inside
         * [PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS]; the session was
         * abandoned. Held until the next operator push.
         */
        EXPIRED,
    }

    /** What was offered, and what we did with it. Persisted by [OtaAttemptStore]. */
    data class Attempt(
        val versionCode: Int,
        val versionName: String,
        val sha256: String,
        /** True only after the bytes on disk matched [sha256]. */
        val verified: Boolean,
        /** Our own commits for THIS build. */
        val commits: Int = 0,
        val outcome: Outcome = Outcome.NONE,
        /** PackageInstaller failure code (ABORTED, INCOMPATIBLE, …) when FAILED. */
        val failureCode: String? = null,
    ) {
        fun isFor(versionCode: Int, sha256: String): Boolean =
            this.versionCode == versionCode && this.sha256.equals(sha256, ignoreCase = true)
    }

    // ── rule 1: never download the same verified build twice ─────────────

    /**
     * May the file on disk stand in for a fresh download of this offer?
     * Only a VERIFIED attempt for the same versionCode AND digest, whose file
     * still exists and is not empty. The caller re-hashes it before use.
     */
    fun canReuse(stored: Attempt?, offerVc: Int, offerSha: String, fileExists: Boolean, fileLength: Long): Boolean =
        stored != null && stored.verified && stored.isFor(offerVc, offerSha) && fileExists && fileLength > 0L

    // ── rules 2–4: whether to commit ─────────────────────────────────────

    enum class Trigger {
        /** A person pressed Update on this panel (source=user). */
        USER,
        /** The 6-hour check, the web relay, a boot. */
        UNATTENDED,
        /**
         * 1.1.46 — a NEW operator push identity (the heartbeat's
         * `forceUpdatePendingAt`) that this screen has not committed for yet.
         * An operator deliberately asked again: re-open the dialog. Not a
         * timer, so it does not re-create the M24 download loop (the kept,
         * verified file is re-used).
         */
        PUSH,
    }

    enum class Route {
        /** Commit our own session (silent where Android allows, else the dialog). */
        COMMIT,
        /** Do not commit; report NEEDS_TAP and keep the file for a person. */
        HOLD_NEEDS_TAP,
        /** Do not commit; the last attempt failed terminally. */
        HOLD_FAILED,
        /** Do not commit; the last confirmation expired unanswered (1.1.46). */
        HOLD_EXPIRED,
    }

    data class Facts(
        val trigger: Trigger,
        /** Android 12+ and we are our own installer of record. */
        val selfSilent: Boolean,
        /** The stored attempt for THIS build, or null if there is none yet. */
        val attempt: Attempt?,
    )

    fun route(f: Facts): Route {
        val a = f.attempt
        // A terminal failure (a bad signature, no storage) is not retried by
        // a timer — silently or otherwise. A person can still ask.
        if (f.trigger == Trigger.UNATTENDED && a?.outcome == Outcome.FAILED) return Route.HOLD_FAILED
        // Our own session is silent here: nothing to protect anyone from.
        if (f.selfSilent) return Route.COMMIT
        // A person at the panel asked for it: raise the dialog for them.
        if (f.trigger == Trigger.USER) return Route.COMMIT
        // 1.1.46 — an operator pushed again: raise it again.
        if (f.trigger == Trigger.PUSH) return Route.COMMIT
        if (a == null) return Route.COMMIT
        return when (a.outcome) {
            // The first unattended attempt raises the dialog once (the path
            // that existed before this file); after that, never again on our
            // own.
            Outcome.NONE -> if (a.commits == 0) Route.COMMIT else Route.HOLD_NEEDS_TAP
            Outcome.COMMITTED, Outcome.NEEDS_TAP -> Route.HOLD_NEEDS_TAP
            Outcome.FAILED -> Route.HOLD_FAILED
            Outcome.EXPIRED -> Route.HOLD_EXPIRED
        }
    }

    // ── the server's `uptoDate` answers, read once in one place ──────────

    /** What an `uptoDate` answer means for a stored attempt. */
    enum class UpToDateMeaning {
        /**
         * The server is holding the push until a person taps Install on the
         * glass (`needsTap: true`): keep the file, report NEEDS_TAP.
         */
        HELD_NEEDS_TAP,
        /** Nothing is being offered any more: drop the attempt and its file. */
        DROP,
    }

    fun readUpToDate(needsTap: Boolean): UpToDateMeaning =
        if (needsTap) UpToDateMeaning.HELD_NEEDS_TAP else UpToDateMeaning.DROP

    // ── PackageInstaller statuses → the states the dashboard shows ───────

    /**
     * `FAILED_<CODE>` for a terminal PackageInstaller status. Mirrors the
     * server's `FAILED_STATE` (`^FAILED_[A-Z0-9_]{1,40}$`).
     */
    fun failedState(code: String?): String {
        val clean = (code ?: "").uppercase().replace(Regex("[^A-Z0-9_]"), "_").trim('_').take(40)
        return if (clean.isEmpty()) "FAILED_UNKNOWN" else "FAILED_$clean"
    }

    /** PackageInstaller.STATUS_* constants, mirrored so this file stays pure. */
    object Status {
        const val SUCCESS = 0
        const val FAILURE = 1
        const val FAILURE_BLOCKED = 2
        const val FAILURE_ABORTED = 3
        const val FAILURE_INVALID = 4
        const val FAILURE_CONFLICT = 5
        const val FAILURE_STORAGE = 6
        const val FAILURE_INCOMPATIBLE = 7
        const val PENDING_USER_ACTION = -1
    }

    fun failureCode(status: Int): String = when (status) {
        Status.FAILURE -> "GENERIC"
        Status.FAILURE_BLOCKED -> "BLOCKED"
        Status.FAILURE_ABORTED -> "ABORTED"
        Status.FAILURE_INVALID -> "INVALID"
        Status.FAILURE_CONFLICT -> "CONFLICT"
        Status.FAILURE_STORAGE -> "STORAGE"
        Status.FAILURE_INCOMPATIBLE -> "INCOMPATIBLE"
        else -> if (status < 0) "STATUS_M${-status}" else "STATUS_$status"
    }
}
