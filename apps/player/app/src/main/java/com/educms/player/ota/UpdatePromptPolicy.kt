package com.educms.player.ota

/**
 * UpdatePromptPolicy — the PLAYER puts its own update's confirmation on the
 * glass, never the background worker (1.1.46, field root cause).
 *
 * On Android 11 the worker reported NEEDS_TAP ("Press Install now on the
 * screen…") while no system dialog was showing: a confirmation Activity
 * cannot be started from the background, and the only way to raise it was
 * Back → the stop menu → "Install now", which nobody at a wall panel finds.
 *
 * Owner decision (binding): the video is NEVER interrupted. An unattended
 * commit is staged and reported NEEDS_TAP; the Back menu shows "Install
 * <target version>" and a PERSON's press raises the dialog from the
 * foreground. Then:
 *  1. (removed — no auto-surfacing over content);
 *  2. a raise is VERIFIED — if the Activity was not paused within
 *     [VERIFY_AFTER_MS], Android refused the dialog, and a full-screen,
 *     remote-focused "Update ready — press OK to install" card goes up;
 *  3. OK raises the staged confirmation from that user gesture, or, with
 *     nothing staged, asks for a person-initiated check (which commits the
 *     kept file and stages a fresh one);
 *  4. an emergency always wins — the card never shows during a hold and is
 *     taken down the moment one starts; it is bounded by the same window as
 *     NEEDS_TAP.
 *
 * Pure Kotlin, JVM-tested.
 */
object UpdatePromptPolicy {

    /** How long a raised confirmation has to pause the Activity before we call it refused. */
    const val VERIFY_AFTER_MS = 6_000L

    /** The card's own bound (the same window NEEDS_TAP is reported for). */
    const val SHOW_WINDOW_MS = PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS

    /** Did the confirmation come up? Raising it pauses the Activity. */
    fun dialogAppeared(raisedAtMs: Long, lastPausedAtMs: Long): Boolean =
        raisedAtMs > 0L && lastPausedAtMs >= raisedAtMs

    /** Rule 2 — put the card up after a raise that did not take? */
    fun shouldShowCard(
        selfOta: Boolean,
        dialogAppeared: Boolean,
        foreground: Boolean,
        emergencyHeld: Boolean,
        standbyActive: Boolean,
    ): Boolean = selfOta && !dialogAppeared && foreground && !emergencyHeld && !standbyActive

    /** Rule 4 — keep the card up? */
    fun keepCard(emergencyHeld: Boolean, shownForMs: Long): Boolean =
        !emergencyHeld && shownForMs in 0L until SHOW_WINDOW_MS

    enum class OkAction {
        /** Raise the staged confirmation from the OK press. */
        RAISE_STAGED,
        /** Nothing staged: ask for a person-initiated check (commits the kept file). */
        REQUEST_USER_CHECK,
    }

    /**
     * The card's version label: the build this screen was OFFERED (the push
     * target, e.g. 1.1.45-field.1), never the stable release.
     */
    fun versionLabel(offeredVersionName: String?): String =
        offeredVersionName?.trim()?.takeIf { it.isNotEmpty() }?.let { "v${it.removePrefix("v")}" } ?: "update"

    /** Rule 3. */
    fun onOk(stagedUsable: Boolean): OkAction =
        if (stagedUsable) OkAction.RAISE_STAGED else OkAction.REQUEST_USER_CHECK
}
