package com.educms.player.usb

/**
 * What the USB import is doing, what the card on the glass says about it, and
 * what the dashboard is told — pure, JVM-tested (UsbImportModelTest).
 *
 * ── WHY THIS EXISTS (2026-10-26, M43 on site) ─────────────────────────
 *
 * The owner plugged a stick into M43 (Amlogic t982, Android 13, 1.1.54) and
 * "nothing happens, no new program loads". Production held zero
 * `usb_ingest_events` rows: the APK reported only REJECTED / ACCEPTED, and
 * everything before verification — no access, no package found, no key — went
 * to the local log alone. Proven on an Android 14 emulator with a real public
 * volume, inside the player's own process:
 *
 *   • Android 11+ serves a stick through MediaProvider's FUSE. Without "All
 *     files access" a listing of the drive SUCCEEDS but holds only folders —
 *     the downloaded .zip is not in it, and a folder's manifest.json stats as
 *     a file yet cannot be opened.
 *   • The old code asked for access only when every listing returned null —
 *     which FUSE never does — so the screen never asked, never found the zip,
 *     and returned silently on every scan.
 *   • A second Safari download unpacks as `edu-cms-content 2`, a name the old
 *     finder did not accept.
 *
 * Now every state is a card a person can see and act on, and every state is
 * reported ([report]) so we can see it too.
 */

/** What started a scan. */
enum class UsbTrigger {
    /** The first scan of this process, or a drive that mounted while the device was still booting. */
    BOOT,
    /** A drive appeared while the screen was running (a mount broadcast, or a new drive on a scan). */
    INSERTED,
    /** The once-a-minute scan with the same drives as before. */
    PERIODIC,
    /** A person chose "Import from USB" in the Back menu (or "Look again" on the card). */
    MANUAL,
    /** A person came back from Android's file-access page. */
    RETURNED,
    ;

    /** A person (or a fresh insertion) asked for this — a same package plays again. */
    val deliberate: Boolean get() = this == INSERTED || this == MANUAL || this == RETURNED

    /** A person asked on the screen itself (Import from USB, Look again, back from Android's page) — every state shows. */
    val requested: Boolean get() = this == MANUAL || this == RETURNED
}

/** Everything the card can say. One stage per thing a person can see or act on. */
enum class UsbStage {
    /** "Import from USB" pressed: looking for a drive. */
    LOOKING,
    /** "Import from USB" pressed and no drive is plugged in. */
    NO_DRIVE,
    /** "USB drive found — reading…" */
    READING,
    /** Verified; copying files to the screen. */
    COPYING,
    /** "Playing <playlist> from USB" — closes by itself. */
    IMPORTED,
    /** "VenueOS needs permission to read USB drives" + Allow. */
    NEEDS_ACCESS,
    /** Android on this screen has no page that grants file access. */
    NO_ACCESS_PAGE,
    /** "No VenueOS playlist on this drive". */
    NO_PACKAGE,
    /** "Connect this screen to the internet once to enable USB playlists". */
    WAITING_KEY,
    /** "This playlist belongs to a different organization". */
    OTHER_ORG,
    /** "Couldn't verify the files on this drive". */
    UNVERIFIED,
    /** Not enough free space on this screen. */
    NO_SPACE,
    /** The drive was pulled out or stopped answering. */
    READ_FAILED,
    ;

    /** Still working — the card shows progress and never closes by itself. */
    val working: Boolean get() = this == LOOKING || this == READING || this == COPYING

    /** A problem a person may need to fix. */
    val problem: Boolean get() = !working && this != IMPORTED
}

/** What the card shows. */
data class UsbCardState(
    val stage: UsbStage,
    /** The playlist's name as the dashboard labelled the download; null = "this playlist". */
    val playlist: String? = null,
    val filesDone: Int = 0,
    val filesTotal: Int = 0,
    val bytesDone: Long = 0L,
    val bytesTotal: Long = 0L,
    /** NO_SPACE: bytes the package needs free on the screen. */
    val neededBytes: Long = 0L,
    /** IMPORTED: the same package was already on the screen and plays again. */
    val sameVersion: Boolean = false,
    /** NEEDS_ACCESS: the name Android's settings use for this app ("VenueOS Player"). */
    val appLabel: String? = null,
)

/** What one press on the card does. */
enum class UsbAction { ALLOW, LOOK_AGAIN, NETWORK, CLOSE }

/** What a scan does next, from what it found on the drives. */
enum class UsbNext {
    /** A person asked and no drive is in. */
    NO_DRIVE,
    /** No drive and nobody asked: nothing to say. */
    QUIET,
    NEEDS_ACCESS,
    NO_PACKAGE,
    WAITING_KEY,
    /** Read every package's manifest + signature. */
    VERIFY,
}

object UsbImportPolicy {

    /**
     * The scan's decision before anything is verified. ORDER IS THE POINT:
     * access is judged from the permission, and a drive whose packages this
     * process cannot read is NEEDS_ACCESS — never "no package" (on Android
     * 11+ a listing without access simply leaves the files out).
     *
     * @param usableCandidates candidates this process can actually read
     *        (all of them with access; on an old world-readable mount, those
     *        whose manifest opens without it).
     */
    fun next(
        drivePresent: Boolean,
        requested: Boolean,
        access: Boolean,
        usableCandidates: Int,
        hasKey: Boolean,
        driveJustRemoved: Boolean = false,
    ): UsbNext = when {
        // 1.1.56 — removing a stick never puts anything up, not even under a
        // person's open "Import from USB" card (the card is taken down instead).
        !drivePresent -> if (requested && !driveJustRemoved) UsbNext.NO_DRIVE else UsbNext.QUIET
        usableCandidates == 0 -> if (access) UsbNext.NO_PACKAGE else UsbNext.NEEDS_ACCESS
        !hasKey -> UsbNext.WAITING_KEY
        else -> UsbNext.VERIFY
    }

    /**
     * After every package was read: the card's stage when nothing verified
     * (null = everything here was read before and nothing changed — say
     * nothing). A verified package goes on to the copy instead.
     */
    fun afterVerify(verified: Boolean, refused: Collection<UsbImporter.Reject>, openedAny: Boolean): UsbStage? = when {
        verified -> UsbStage.COPYING
        refused.isNotEmpty() -> stageOf(worst(refused)!!)
        !openedAny -> UsbStage.NO_PACKAGE
        else -> null
    }

    /**
     * Is the player coming back from Android's file-access page? A focus or
     * resume sooner than [RETURN_MIN_MS] after Allow is the page still opening.
     */
    fun returnedFromAccessPage(awaitingSinceMs: Long, nowMs: Long): Boolean =
        awaitingSinceMs > 0L && nowMs - awaitingSinceMs >= RETURN_MIN_MS

    /** See [returnedFromAccessPage]. */
    const val RETURN_MIN_MS = 800L

    /** "Playing … from USB" closes by itself after this. */
    const val IMPORTED_CLOSE_MS = 8_000L

    /**
     * A problem card closes by itself after this, so a screen nobody is
     * standing at goes back to its content. A key press restarts the wait.
     */
    const val PROBLEM_CLOSE_MS = 90_000L

    /** How often an open card re-reads the emergency hold, besides its change listener. */
    const val EMERGENCY_POLL_MS = 250L

    /**
     * A drive that mounts this soon after the device booted was in it when it
     * was switched on: a stick left in is not a person plugging one in, so it
     * never replays a package the server has since replaced.
     */
    const val BOOT_GRACE_MS = 180_000L

    /** The same report again within this window is left out (a stick left in is scanned every minute). */
    const val REPORT_REPEAT_MS = 30 * 60_000L

    /** Why a scan ran: the first of the process, a new drive, or the minute tick. */
    fun classify(
        firstScan: Boolean,
        mountSignal: Boolean,
        newDrive: Boolean,
        elapsedSinceBootMs: Long,
    ): UsbTrigger = when {
        firstScan -> UsbTrigger.BOOT
        mountSignal || newDrive -> if (elapsedSinceBootMs < BOOT_GRACE_MS) UsbTrigger.BOOT else UsbTrigger.INSERTED
        else -> UsbTrigger.PERIODIC
    }

    /**
     * Does this state go on the glass?
     *
     *  • A person's request or a fresh insertion: always.
     *  • A stick that was already in (boot) or the minute scan: a NEW playlist
     *    copying in always shows; a problem shows once per drive + problem
     *    ([shownBefore] = the last stage shown for this drive), so a stick left
     *    in a port does not put the same card up after every nightly reboot;
     *    reading a drive that changes nothing never shows.
     */
    fun shows(trigger: UsbTrigger, stage: UsbStage, shownBefore: UsbStage?, packageSeen: Boolean): Boolean = when {
        // 1.1.56 (owner) — a stick that holds no VenueOS package puts NOTHING
        // over the signage: no "reading", no "needs permission", no "no
        // playlist". Only a person's own request on the screen sees those.
        trigger.requested -> true
        !packageSeen -> false
        trigger.deliberate -> true
        stage == UsbStage.COPYING || stage == UsbStage.IMPORTED -> true
        stage.working -> false
        stage == UsbStage.NO_DRIVE -> false
        else -> shownBefore != stage
    }

    /**
     * Is this state sent to the dashboard? A person's request or a drive that
     * holds a VenueOS package: always. Any other stick: only NEEDS_ACCESS (an
     * Android 11+ screen cannot see an exported .zip without "All files
     * access", and the dashboard is where an admin learns that) — never
     * "no package" for every unrelated stick plugged into a venue's screen.
     */
    fun reports(trigger: UsbTrigger, stage: UsbStage, packageSeen: Boolean): Boolean =
        trigger.requested || packageSeen || stage == UsbStage.NEEDS_ACCESS

    /** Never over an alert: the card does not open while a hold is in force, and leaves when one starts. */
    fun mayShow(emergencyHeld: Boolean): Boolean = !emergencyHeld

    /** How long the card stays up by itself; null = until the work moves on or a person acts. */
    fun closesAfterMs(stage: UsbStage): Long? = when {
        stage == UsbStage.IMPORTED -> IMPORTED_CLOSE_MS
        stage.working -> null
        else -> PROBLEM_CLOSE_MS
    }

    /** The buttons, the fix first — it is where the remote lands. */
    fun actions(stage: UsbStage): List<UsbAction> = when (stage) {
        UsbStage.LOOKING, UsbStage.READING, UsbStage.COPYING -> listOf(UsbAction.CLOSE)
        UsbStage.NO_DRIVE -> listOf(UsbAction.LOOK_AGAIN, UsbAction.CLOSE)
        UsbStage.IMPORTED -> listOf(UsbAction.CLOSE)
        UsbStage.NEEDS_ACCESS -> listOf(UsbAction.ALLOW, UsbAction.CLOSE)
        UsbStage.NO_ACCESS_PAGE -> listOf(UsbAction.CLOSE)
        UsbStage.NO_PACKAGE -> listOf(UsbAction.LOOK_AGAIN, UsbAction.CLOSE)
        UsbStage.WAITING_KEY -> listOf(UsbAction.NETWORK, UsbAction.CLOSE)
        UsbStage.OTHER_ORG -> listOf(UsbAction.LOOK_AGAIN, UsbAction.CLOSE)
        UsbStage.UNVERIFIED -> listOf(UsbAction.LOOK_AGAIN, UsbAction.CLOSE)
        UsbStage.NO_SPACE -> listOf(UsbAction.CLOSE)
        UsbStage.READ_FAILED -> listOf(UsbAction.LOOK_AGAIN, UsbAction.CLOSE)
    }

    /** What the card says for a refused package. */
    fun stageOf(kind: UsbImporter.Reject): UsbStage = when (kind) {
        UsbImporter.Reject.OTHER_ORG -> UsbStage.OTHER_ORG
        UsbImporter.Reject.UNVERIFIED -> UsbStage.UNVERIFIED
        UsbImporter.Reject.UNREADABLE -> UsbStage.READ_FAILED
        UsbImporter.Reject.NO_SPACE -> UsbStage.NO_SPACE
        UsbImporter.Reject.DEVICE -> UsbStage.READ_FAILED
    }

    /**
     * When several packages are refused, the one the card names: ours with a
     * bad file beats another organization's, which beats an unreadable one.
     */
    fun worst(kinds: Collection<UsbImporter.Reject>): UsbImporter.Reject? =
        kinds.minByOrNull {
            when (it) {
                UsbImporter.Reject.UNVERIFIED -> 0
                UsbImporter.Reject.OTHER_ORG -> 1
                UsbImporter.Reject.NO_SPACE -> 2
                UsbImporter.Reject.DEVICE -> 3
                UsbImporter.Reject.UNREADABLE -> 4
            }
        }

    // ── what the dashboard is told ─────────────────────────────────────

    /** `POST /tenants/me/usb-ingest/screens/:id/event` outcomes (free text server-side; this is the vocabulary). */
    const val OUT_DETECTED = "DETECTED"
    const val OUT_NEEDS_ACCESS = "NEEDS_ACCESS"
    const val OUT_NO_PACKAGE = "NO_PACKAGE"
    const val OUT_WAITING_KEY = "WAITING_KEY"
    const val OUT_REJECTED = "REJECTED"
    const val OUT_IMPORTED = "IMPORTED"

    /**
     * The report for a stage: an outcome and a short reason whose first word
     * is a stable code (the dashboard keys its words off it). Null = nothing
     * to report (looking, no drive, copying).
     */
    fun report(stage: UsbStage, detail: String? = null): Pair<String, String>? = when (stage) {
        UsbStage.READING -> OUT_DETECTED to "drive: a USB drive was found"
        UsbStage.NEEDS_ACCESS -> OUT_NEEDS_ACCESS to "no-file-access: All files access is not granted"
        UsbStage.NO_ACCESS_PAGE -> OUT_NEEDS_ACCESS to "no-settings-page: this screen has no page to grant file access"
        UsbStage.NO_PACKAGE -> OUT_NO_PACKAGE to "no-package: no VenueOS playlist on the drive"
        UsbStage.WAITING_KEY -> OUT_WAITING_KEY to "no-key: this screen has not fetched its USB key yet"
        UsbStage.OTHER_ORG -> OUT_REJECTED to "other-organization: ${detail ?: "package is for another organization"}"
        UsbStage.UNVERIFIED -> OUT_REJECTED to "unverified: ${detail ?: "signature or checksum does not match"}"
        UsbStage.NO_SPACE -> OUT_REJECTED to "no-space: ${detail ?: "not enough free space"}"
        UsbStage.READ_FAILED -> OUT_REJECTED to "unreadable: ${detail ?: "the drive could not be read"}"
        UsbStage.IMPORTED -> OUT_IMPORTED to (if (detail != null) "imported: $detail" else "imported")
        UsbStage.LOOKING, UsbStage.NO_DRIVE, UsbStage.COPYING -> null
    }

    /** Reasons are capped on the way out (the server caps them too). */
    fun clampReason(reason: String): String = if (reason.length <= 300) reason else reason.take(299) + "…"

    // ── the drive and the permission ───────────────────────────────────

    /** Can this process read a stick? Android 11+: "All files access"; older: the storage permission. */
    fun hasFileAccess(sdk: Int, externalStorageManager: Boolean, readPermissionGranted: Boolean): Boolean =
        if (sdk >= 30) externalStorageManager else readPermissionGranted

    /** Which drives are in, as one stable key (a FAT volume's name is its serial). */
    fun driveKey(volumeNames: Collection<String>): String = volumeNames.sorted().joinToString(",")

    /** A drive in [now] that was not in [before]. */
    fun newDrive(before: String?, now: String): Boolean {
        if (now.isEmpty()) return false
        val old = before?.split(',')?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()
        return now.split(',').any { it.isNotEmpty() && it !in old }
    }
}
