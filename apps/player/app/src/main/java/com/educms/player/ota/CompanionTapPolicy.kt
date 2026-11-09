package com.educms.player.ota

/**
 * CompanionTapPolicy — the Install tap for a pending COMPANION (Manager)
 * upgrade, on the glass (Manager wave 3, #12).
 *
 * On Android 11 and below (owner: never device owner) the bundled Manager
 * upgrade ends at Android's "Install?" dialog. The Player already holds
 * content behind the companion gate and raises that dialog from the
 * foreground; what was missing is the case the dialog does NOT come up
 * (Android refused the launch) or nobody answers — the screen then stayed
 * behind with only a notification no one sees, and the dashboard said nothing.
 *
 * Same shape as [UpdatePromptPolicy] (the Player's own update), same card
 * ([UpdateReadyCard], parked focus + visible highlight + Back escapes):
 *  1. a raise that did not take (the Activity was never paused) puts the
 *     remote-focused card up — never over an alert, never in standby;
 *  2. OK raises the staged confirmation again; Not now / Back declines and
 *     goes quiet for [DECLINE_COOLDOWN_MS] (a person said no — do not nag);
 *  3. whatever ends the attempt unanswered (declined, card window elapsed,
 *     the gate's hold released) is reported to the dashboard as NEEDS_TAP,
 *     with a message that says "Companion" so the server never mistakes it
 *     for the Player's own pending push.
 * Copy claims only what the evidence proves: "waiting for a tap", never
 * "failed" or "installed".
 *
 * Pure Kotlin, JVM-tested.
 */
object CompanionTapPolicy {

    /** After a person says Not now / Back, stay quiet this long (6 h). */
    const val DECLINE_COOLDOWN_MS = 6L * 60L * 60L * 1000L

    /** The card shows at most this many times per process. */
    const val MAX_CARDS_PER_PROCESS = 2

    /** Prefix the server keys on (player-ota/companion-tap-report.ts). */
    const val REPORT_PREFIX = "Companion service"

    data class Facts(
        /** A staged confirmation for the companion package exists and is still usable. */
        val stagedForCompanion: Boolean,
        /** Our raise paused the Activity, i.e. Android showed the dialog. */
        val dialogAppeared: Boolean,
        val foreground: Boolean,
        /** An alert is live (PendingInstallStore.emergencyHeldNow). */
        val emergencyHeld: Boolean,
        val standbyActive: Boolean,
        /** Elapsed time since a person last declined; null = never. */
        val sinceDeclineMs: Long?,
        val cardsShownThisProcess: Int,
    )

    fun shouldShowCard(f: Facts): Boolean =
        f.stagedForCompanion &&
            !f.dialogAppeared &&
            f.foreground &&
            !f.emergencyHeld &&
            !f.standbyActive &&
            (f.sinceDeclineMs == null || f.sinceDeclineMs < 0L || f.sinceDeclineMs >= DECLINE_COOLDOWN_MS) &&
            f.cardsShownThisProcess < MAX_CARDS_PER_PROCESS

    /** The dashboard sentence for NEEDS_TAP; versionLabel may be blank. */
    fun reportMessage(versionLabel: String?): String {
        val v = versionLabel?.trim()?.takeIf { it.isNotEmpty() }?.let { " ($it)" } ?: ""
        return "$REPORT_PREFIX update$v is waiting for an Install tap on the screen."
    }

    /**
     * Should the NEEDS_TAP report go out now? Only when a companion upgrade is
     * genuinely pending (bundled newer than installed) and the screen is not in
     * an alert. The caller de-dupes per (versionCode, process).
     */
    fun shouldReport(bundledVersionCode: Int, installedVersionCode: Int?, emergencyHeld: Boolean): Boolean =
        !emergencyHeld && bundledVersionCode > 0 && (installedVersionCode ?: 0) < bundledVersionCode
}
