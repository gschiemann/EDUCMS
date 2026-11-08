package com.educms.manager

/**
 * ONE RELEASE UNIT (2026-11-08) — how the Manager is updated, as pure rules.
 *
 * THE FIELD FAILURE. Manager 1.0.24 pulled the newest `manager-v*` GitHub
 * release on its own every 30 minutes (ManagerSelfUpdateWorker). Publishing
 * a Manager tag was therefore a FLEET-WIDE push within half an hour: no field
 * window, no tracked push, no canary, no hardware class, no off-hours — none
 * of the ladder every Player build has to climb. And the version was typed by
 * hand in build.gradle.kts, so the Manager bundled inside every Player since
 * 2026-09-01 was the same 1.0.24: the Player's own bundled-upgrade path
 * (ManagerBootstrap / ManagerUpgradeMath) had nothing newer to install, and
 * two fixes sat unreleased on master for a month.
 *
 * THE RULE. The Manager has exactly ONE path to a screen: inside the Player
 * APK, which carries it in its assets (`:app:bundleManagerApk`) and installs it
 * on the device only when the bundled versionCode is newer than the installed
 * one. The Player reaches the screen through its own ladder (field window →
 * tracked push → canary → fleet, per screen and per hardware class), so the
 * Manager inherits every gate. This object is what the Manager itself obeys:
 *
 *   • [selfUpdateRetired] — the Manager never downloads or installs itself.
 *     The legacy worker is kept only so WorkManager can cancel the periodic job
 *     the old build persisted; if it ever runs, it does nothing.
 *   • [shouldInstallBundled] — the one install rule, shared in spirit with the
 *     Player's ManagerUpgradeMath: install only a STRICTLY newer versionCode,
 *     never the same, never older. Kept here (and tested here) so a reader of
 *     the Manager module sees the rule the Player applies to it.
 *   • [legacyLaneAnswerIsSafe] — what the old 1.0.24 worker does with the
 *     server's answer. The API now answers `{ uptoDate: true, installVia:
 *     "player" }` unless the legacy lane is deliberately re-enabled; 1.0.24
 *     reads "no `latest`" as up to date and exits — no download, no loop.
 *
 * No Android imports: unit-testable on the JVM.
 */
object ManagerUpdatePolicy {

    /** The Manager never updates itself. The Player carries and installs it. */
    const val selfUpdateRetired: Boolean = true

    /** The unique WorkManager names Manager ≤ 1.0.24 enqueued for its own lane — cancelled on every boot of this build. */
    val LEGACY_SELF_UPDATE_WORK_NAMES: List<String> = listOf(
        "edu-manager-self-update-periodic",
        "edu-manager-self-update-oneshot",
    )

    /**
     * Install the bundled Manager over the installed one?
     *
     * @param installedVersionCode the versionCode on the device, or null when no Manager is installed
     *   (that is the Player's first-install gate's case — this function says "yes" for it).
     * @param bundledVersionCode the versionCode of the APK inside the Player; 0 = no asset / unreadable.
     */
    fun shouldInstallBundled(installedVersionCode: Int?, bundledVersionCode: Int): Boolean {
        if (bundledVersionCode <= 0) return false
        if (installedVersionCode == null) return true
        return bundledVersionCode > installedVersionCode
    }

    /**
     * Is the server's `manager-update-check` answer one the legacy 1.0.24
     * worker handles without downloading anything? True when the answer
     * carries no `latest` block, or a `latest.versionCode` that is not above
     * the caller's — both exit the worker before any network fetch.
     */
    fun legacyLaneAnswerIsSafe(callerVersionCode: Int, latestVersionCode: Int?): Boolean =
        latestVersionCode == null || latestVersionCode <= callerVersionCode
}
