package com.educms.player.setup

/**
 * THE NEEDS MATRIX (player 1.1.59) — which grants THIS screen needs, from
 * facts about the box alone. Pure: no `android.*`, so every row of the
 * matrix is a unit test (SetupNeedsTest).
 *
 * Owner rule (2026-10-26, restated for 1.1.59): every permission the player
 * needs is asked for ONCE, on the first-launch "Set up this screen" list,
 * and NEVER mid-use. A feature that finds a grant missing later reports
 * "needs setup" to the dashboard and waits; the Back menu's "Finish screen
 * setup" (and the dashboard's "Open setup on this panel") re-open the list.
 *
 * Three steps joined the list in 1.1.59, each asked only where it is needed:
 *
 *  • [SetupCeremonyMath.STEP_RUNTIME] — Android's own in-app permission
 *    dialog, ONE request for everything below that this box lacks:
 *      - location (fine + coarse) where the box has Wi-Fi: Android lists
 *        nearby networks and names the connected one only to an app holding
 *        it (the Network screen; nothing ever reads a location);
 *      - notifications on Android 13+ (the foreground heartbeat service and
 *        the post-update relaunch notification);
 *      - "read storage" below Android 11 (USB playlist sticks).
 *  • [SetupCeremonyMath.STEP_ALL_FILES] — "All files access", Android 11+
 *    only (USB playlist sticks; below 11 the storage permission above does it).
 *  • [SetupCeremonyMath.STEP_SLEEP_HELPER] — the "VenueOS sleep"
 *    accessibility service, asked ONLY when this box's own vendor sleep
 *    service is installed but refuses us (an EP6N whose sdkapi service will
 *    not take our calls, a GUQ whose MCU service never answers). Where the
 *    vendor service works, or no vendor service exists (the screen-timeout
 *    path covers a generic box), nobody is asked. Android 9+ only: the
 *    service's lock action is API 28.
 *
 * Device ADMIN stays an advanced (never-armed) row, and is hidden outright
 * where the vendor sleep service works — there is nothing for it to add.
 * Never device OWNER (binding rule).
 */
object SetupNeeds {

    const val PERM_FINE_LOCATION = "android.permission.ACCESS_FINE_LOCATION"
    const val PERM_COARSE_LOCATION = "android.permission.ACCESS_COARSE_LOCATION"
    const val PERM_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
    const val PERM_READ_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

    /** Android 9 — `GLOBAL_ACTION_LOCK_SCREEN`. */
    const val SDK_SLEEP_HELPER = 28

    /** Android 11 — "All files access" replaces the storage permission. */
    const val SDK_ALL_FILES = 30

    /** Android 13 — notifications become a runtime permission. */
    const val SDK_NOTIFICATIONS = 33

    /** What this box's own vendor sleep service did when we asked it. */
    enum class VendorSleep {
        /** No vendor sleep service on this box — most of the fleet. */
        NONE,

        /** Installed; the probe has not answered yet. Ask nothing until it does. */
        PROBING,

        /** Installed and it took our call — the box sleeps the vendor's way. */
        WORKS,

        /** Installed, but it refuses us or never answers. */
        REFUSED,
    }

    /** Map `VendorBacklightPolicy.Detection.wire` onto [VendorSleep]. Unknown = PROBING (ask nothing yet). */
    fun vendorSleepFromWire(wire: String?): VendorSleep = when (wire) {
        null, "absent" -> VendorSleep.NONE
        "available" -> VendorSleep.WORKS
        "unsupported", "unreachable" -> VendorSleep.REFUSED
        else -> VendorSleep.PROBING
    }

    /** The facts the matrix is computed from. */
    data class Device(
        val sdk: Int,
        val hasWifi: Boolean,
        val vendorSleep: VendorSleep = VendorSleep.NONE,
    )

    /** The runtime permissions this box asks for in ONE in-app dialog, in request order. */
    fun runtimePermissions(d: Device): List<String> = buildList {
        if (d.hasWifi) {
            add(PERM_FINE_LOCATION)
            add(PERM_COARSE_LOCATION)
        }
        if (d.sdk >= SDK_NOTIFICATIONS) add(PERM_NOTIFICATIONS)
        if (d.sdk < SDK_ALL_FILES) add(PERM_READ_STORAGE)
    }

    /**
     * The runtime permissions that count toward "granted". Coarse location is
     * requested with fine (Android 12+ insists on the pair) but a person may
     * pick "approximate" — the scan list needs FINE, so only FINE decides.
     */
    fun requiredRuntime(d: Device): List<String> = runtimePermissions(d) - PERM_COARSE_LOCATION

    /** SKIP-IF-GRANTED: what the dialog must still ask for. Empty = the step is satisfied. */
    fun missingRuntime(d: Device, granted: Set<String>): List<String> {
        val missing = requiredRuntime(d).filterNot { it in granted }
        if (missing.isEmpty()) return emptyList()
        // Ask for the whole bundle that is not held, coarse included with fine.
        return runtimePermissions(d).filterNot { it in granted }
    }

    fun allFilesApplies(d: Device): Boolean = d.sdk >= SDK_ALL_FILES

    fun sleepHelperApplies(d: Device): Boolean =
        d.sdk >= SDK_SLEEP_HELPER && d.vendorSleep == VendorSleep.REFUSED

    /** Device admin (advanced) is pointless where the vendor's own sleep works. */
    fun deviceAdminApplies(d: Device): Boolean = d.vendorSleep != VendorSleep.WORKS

    /**
     * Does the matrix decide [key] for this box? Null = not a matrix step
     * (the step's own SDK / companion rules decide, unchanged).
     */
    fun applies(key: String, d: Device): Boolean? = when (key) {
        SetupCeremonyMath.STEP_RUNTIME -> runtimePermissions(d).isNotEmpty()
        SetupCeremonyMath.STEP_ALL_FILES -> allFilesApplies(d)
        SetupCeremonyMath.STEP_SLEEP_HELPER -> sleepHelperApplies(d)
        SetupCeremonyMath.STEP_DEVICE_ADMIN -> deviceAdminApplies(d)
        else -> null
    }

    /**
     * Every CORE step this box needs (device × Android version), in list
     * order. `managerInstalled` / `managerIsOwner` come from the box too.
     */
    fun required(d: Device, managerIsOwner: Boolean = false, overlayPage: Boolean = true): List<String> = buildList {
        if (runtimePermissions(d).isNotEmpty()) add(SetupCeremonyMath.STEP_RUNTIME)
        if (d.sdk >= 26) add(SetupCeremonyMath.STEP_INSTALL_UNKNOWN)
        if (d.sdk >= 23) add(SetupCeremonyMath.STEP_WRITE_SETTINGS)
        if (d.sdk >= 23) add(SetupCeremonyMath.STEP_BATTERY_EXEMPT)
        if (allFilesApplies(d)) add(SetupCeremonyMath.STEP_ALL_FILES)
        if (sleepHelperApplies(d)) add(SetupCeremonyMath.STEP_SLEEP_HELPER)
        if (overlayPage) add(SetupCeremonyMath.STEP_OVERLAY)
        if (!managerIsOwner) add(SetupCeremonyMath.STEP_HOME)
    }

    /** SKIP-IF-GRANTED over the whole list: what is still to do, in order. */
    fun outstanding(required: List<String>, satisfied: Set<String>): List<String> =
        required.filterNot { it in satisfied }

    // ── how the runtime step is fired ────────────────────────────────

    enum class RuntimeFire {
        /** Android's own in-app dialog. */
        DIALOG,

        /**
         * Android will not show the dialog again ("don't ask again", or a
         * second refusal on Android 11+): open this app's own page in
         * Settings instead, where the permissions can be switched on.
         */
        APP_PAGE,
    }

    /**
     * First press: the dialog. A later press, after Android has answered
     * once and is no longer willing to explain itself (no rationale), means
     * the dialog would return at once with no UI — the app page instead.
     */
    fun runtimeFire(askedBefore: Boolean, rationale: Boolean): RuntimeFire =
        if (!askedBefore || rationale) RuntimeFire.DIALOG else RuntimeFire.APP_PAGE

    // ── first run vs normal use ──────────────────────────────────────

    /**
     * Has this install's FIRST-RUN window closed? Once it has, the setup list
     * never opens by itself again — only a person (Back menu, dashboard,
     * corner hold, a feature's "Finish screen setup" button) can open it.
     *
     * @param storedClosed the persisted answer, or null when never written.
     * @param legacyMarkers any pre-1.1.59 setup marker exists: this is an
     *        UPGRADE of a screen already in service, not a first install — its
     *        first run is long over, so the new rows are reported, not asked.
     */
    fun firstRunClosed(storedClosed: Boolean?, legacyMarkers: Boolean): Boolean =
        storedClosed ?: legacyMarkers

    /** The list may open by itself only inside the first-run window. */
    fun mayAutoOpen(forced: Boolean, alreadyUp: Boolean, firstRunClosed: Boolean): Boolean =
        forced || alreadyUp || !firstRunClosed

    /** The feature each step serves, for the dashboard's "needs setup". */
    fun featureFor(key: String): String = when (key) {
        SetupCeremonyMath.STEP_RUNTIME -> "wifi-and-notifications"
        SetupCeremonyMath.STEP_INSTALL_UNKNOWN -> "updates"
        SetupCeremonyMath.STEP_MANAGER_INSTALL -> "background-updates"
        SetupCeremonyMath.STEP_WRITE_SETTINGS -> "brightness-and-screen-off"
        SetupCeremonyMath.STEP_BATTERY_EXEMPT -> "stay-running"
        SetupCeremonyMath.STEP_ALL_FILES -> "usb-import"
        SetupCeremonyMath.STEP_SLEEP_HELPER -> "sleep"
        SetupCeremonyMath.STEP_DEVICE_ADMIN -> "sleep"
        SetupCeremonyMath.STEP_OVERLAY -> "relaunch-after-update"
        SetupCeremonyMath.STEP_HOME -> "relaunch-after-update"
        else -> key
    }
}
