package com.educms.player.usb

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

/**
 * The USB import's state machine (2026-10-26, M43 on site: "inserted a USB …
 * nothing happens"): every state a scan can reach → the card that says it →
 * the report the dashboard gets. Before this, everything ahead of
 * verification was a local log line only.
 */
class UsbImportModelTest {

    // ── what started the scan ──────────────────────────────────────────

    @Test
    fun `the first scan is boot — a drive that mounts while the device boots is boot too`() {
        assertEquals(UsbTrigger.BOOT, UsbImportPolicy.classify(firstScan = true, mountSignal = true, newDrive = true, elapsedSinceBootMs = 3_600_000L))
        assertEquals(UsbTrigger.BOOT, UsbImportPolicy.classify(firstScan = false, mountSignal = true, newDrive = true, elapsedSinceBootMs = 20_000L))
    }

    @Test
    fun `a drive plugged into a running screen is an insertion, by broadcast or by a new drive on a scan`() {
        assertEquals(UsbTrigger.INSERTED, UsbImportPolicy.classify(false, mountSignal = true, newDrive = false, elapsedSinceBootMs = 3_600_000L))
        // Some signage ROMs mount without telling anyone: the minute scan sees a new drive.
        assertEquals(UsbTrigger.INSERTED, UsbImportPolicy.classify(false, mountSignal = false, newDrive = true, elapsedSinceBootMs = 3_600_000L))
        assertEquals(UsbTrigger.PERIODIC, UsbImportPolicy.classify(false, mountSignal = false, newDrive = false, elapsedSinceBootMs = 3_600_000L))
    }

    @Test
    fun `only a person or a fresh insertion is deliberate`() {
        assertTrue(UsbTrigger.INSERTED.deliberate)
        assertTrue(UsbTrigger.MANUAL.deliberate)
        assertTrue(UsbTrigger.RETURNED.deliberate)
        assertFalse(UsbTrigger.BOOT.deliberate)
        assertFalse(UsbTrigger.PERIODIC.deliberate)
    }

    @Test
    fun `which drives are in, and whether one is new`() {
        assertEquals("7771-1122,A1B2-C3D4", UsbImportPolicy.driveKey(listOf("A1B2-C3D4", "7771-1122")))
        assertTrue(UsbImportPolicy.newDrive(null, "7771-1122"))
        assertTrue(UsbImportPolicy.newDrive("", "7771-1122"))
        assertTrue(UsbImportPolicy.newDrive("7771-1122", "7771-1122,A1B2-C3D4"))
        assertFalse(UsbImportPolicy.newDrive("7771-1122", "7771-1122"))
        assertFalse(UsbImportPolicy.newDrive("7771-1122,A1B2-C3D4", "7771-1122"))
        assertFalse(UsbImportPolicy.newDrive("7771-1122", ""))
    }

    // ── what the scan does next ────────────────────────────────────────

    @Test
    fun `no drive — said only when a person asked`() {
        assertEquals(UsbNext.NO_DRIVE, UsbImportPolicy.next(drivePresent = false, requested = true, access = true, usableCandidates = 0, hasKey = true))
        assertEquals(UsbNext.QUIET, UsbImportPolicy.next(drivePresent = false, requested = false, access = true, usableCandidates = 0, hasKey = true))
    }

    /**
     * THE M43 BUG. Without "All files access" Android 11+ lists a stick's
     * folders but not its files, so a finder sees nothing (or sees a folder it
     * cannot open). That is NEEDS_ACCESS — never "no package", and never silence.
     */
    @Test
    fun `a drive this app may not read is NEEDS_ACCESS, never no-package`() {
        assertEquals(UsbNext.NEEDS_ACCESS, UsbImportPolicy.next(drivePresent = true, requested = false, access = false, usableCandidates = 0, hasKey = true))
        assertEquals(UsbNext.NEEDS_ACCESS, UsbImportPolicy.next(drivePresent = true, requested = false, access = false, usableCandidates = 0, hasKey = false))
        assertEquals(UsbNext.NO_PACKAGE, UsbImportPolicy.next(drivePresent = true, requested = false, access = true, usableCandidates = 0, hasKey = true))
    }

    @Test
    fun `a package and no key yet is WAITING_KEY — with a key, verify`() {
        assertEquals(UsbNext.WAITING_KEY, UsbImportPolicy.next(drivePresent = true, requested = false, access = true, usableCandidates = 1, hasKey = false))
        assertEquals(UsbNext.VERIFY, UsbImportPolicy.next(drivePresent = true, requested = false, access = true, usableCandidates = 2, hasKey = true))
        // An old ROM that mounts sticks world-readable needs no grant.
        assertEquals(UsbNext.VERIFY, UsbImportPolicy.next(drivePresent = true, requested = false, access = false, usableCandidates = 1, hasKey = true))
    }

    @Test
    fun `after verification — a refusal is named, the worst first`() {
        assertEquals(UsbStage.COPYING, UsbImportPolicy.afterVerify(true, listOf(UsbImporter.Reject.OTHER_ORG), openedAny = true))
        assertEquals(UsbStage.OTHER_ORG, UsbImportPolicy.afterVerify(false, listOf(UsbImporter.Reject.OTHER_ORG), openedAny = true))
        assertEquals(
            UsbStage.UNVERIFIED,
            UsbImportPolicy.afterVerify(false, listOf(UsbImporter.Reject.UNREADABLE, UsbImporter.Reject.OTHER_ORG, UsbImporter.Reject.UNVERIFIED), openedAny = true),
        )
        assertEquals(UsbStage.READ_FAILED, UsbImportPolicy.afterVerify(false, listOf(UsbImporter.Reject.UNREADABLE), openedAny = true))
        assertEquals(UsbStage.NO_PACKAGE, UsbImportPolicy.afterVerify(false, emptyList(), openedAny = false))
        assertNull(UsbImportPolicy.afterVerify(false, emptyList(), openedAny = true))
    }

    // ── every outcome → the card and the report ────────────────────────

    @Test
    fun `every stage reports what the dashboard needs, except the moments in between`() {
        val expected = mapOf(
            UsbStage.READING to "DETECTED",
            UsbStage.NEEDS_ACCESS to "NEEDS_ACCESS",
            UsbStage.NO_ACCESS_PAGE to "NEEDS_ACCESS",
            UsbStage.NO_PACKAGE to "NO_PACKAGE",
            UsbStage.WAITING_KEY to "WAITING_KEY",
            UsbStage.OTHER_ORG to "REJECTED",
            UsbStage.UNVERIFIED to "REJECTED",
            UsbStage.NO_SPACE to "REJECTED",
            UsbStage.READ_FAILED to "REJECTED",
            UsbStage.IMPORTED to "IMPORTED",
        )
        for (stage in UsbStage.values()) {
            val r = UsbImportPolicy.report(stage, "why")
            if (stage in expected) {
                assertEquals("$stage outcome", expected[stage], r!!.first)
                assertTrue("$stage reason has a stable code: ${r.second}", Regex("^[a-z-]+(:|$)").containsMatchIn(r.second))
            } else {
                assertNull("$stage is not reported", r)
            }
        }
        assertEquals("other-organization: why", UsbImportPolicy.report(UsbStage.OTHER_ORG, "why")!!.second)
        assertEquals("no-file-access", UsbImportPolicy.report(UsbStage.NEEDS_ACCESS)!!.second.substringBefore(':'))
    }

    @Test
    fun `every problem puts its fix first, where the remote lands — Close is always there`() {
        assertEquals(UsbAction.ALLOW, UsbImportPolicy.actions(UsbStage.NEEDS_ACCESS).first())
        assertEquals(UsbAction.NETWORK, UsbImportPolicy.actions(UsbStage.WAITING_KEY).first())
        assertEquals(UsbAction.LOOK_AGAIN, UsbImportPolicy.actions(UsbStage.NO_PACKAGE).first())
        assertEquals(UsbAction.LOOK_AGAIN, UsbImportPolicy.actions(UsbStage.NO_DRIVE).first())
        assertEquals(UsbAction.LOOK_AGAIN, UsbImportPolicy.actions(UsbStage.READ_FAILED).first())
        assertEquals(UsbAction.LOOK_AGAIN, UsbImportPolicy.actions(UsbStage.OTHER_ORG).first())
        assertEquals(UsbAction.LOOK_AGAIN, UsbImportPolicy.actions(UsbStage.UNVERIFIED).first())
        for (stage in UsbStage.values()) {
            assertTrue("$stage can always be closed", UsbAction.CLOSE in UsbImportPolicy.actions(stage))
        }
    }

    @Test
    fun `done closes by itself in seconds, a problem in a minute and a half, work never`() {
        assertEquals(8_000L, UsbImportPolicy.closesAfterMs(UsbStage.IMPORTED))
        for (stage in listOf(UsbStage.LOOKING, UsbStage.READING, UsbStage.COPYING)) assertNull(UsbImportPolicy.closesAfterMs(stage))
        for (stage in UsbStage.values().filter { it.problem }) assertEquals(UsbImportPolicy.PROBLEM_CLOSE_MS, UsbImportPolicy.closesAfterMs(stage))
    }

    @Test
    fun `a refusal kind maps to its card`() {
        assertEquals(UsbStage.OTHER_ORG, UsbImportPolicy.stageOf(UsbImporter.Reject.OTHER_ORG))
        assertEquals(UsbStage.UNVERIFIED, UsbImportPolicy.stageOf(UsbImporter.Reject.UNVERIFIED))
        assertEquals(UsbStage.READ_FAILED, UsbImportPolicy.stageOf(UsbImporter.Reject.UNREADABLE))
        assertEquals(UsbStage.NO_SPACE, UsbImportPolicy.stageOf(UsbImporter.Reject.NO_SPACE))
        assertEquals(UsbStage.READ_FAILED, UsbImportPolicy.stageOf(UsbImporter.Reject.DEVICE))
    }

    // ── when the card goes on the glass ────────────────────────────────

    @Test
    fun `a person's own request on the screen sees every state, package or not`() {
        for (t in listOf(UsbTrigger.MANUAL, UsbTrigger.RETURNED)) {
            for (s in UsbStage.values()) {
                assertTrue("$t $s", UsbImportPolicy.shows(t, s, shownBefore = s, packageSeen = false))
                assertTrue("$t $s", UsbImportPolicy.shows(t, s, shownBefore = s, packageSeen = true))
            }
        }
    }

    @Test
    fun `a fresh insertion of a VenueOS stick sees every state`() {
        for (s in UsbStage.values()) assertTrue("$s", UsbImportPolicy.shows(UsbTrigger.INSERTED, s, shownBefore = s, packageSeen = true))
    }

    /** 1.1.56 (owner) — a random stick at a venue must never put anything over the signage. */
    @Test
    fun `a stick with no VenueOS package never puts anything on the glass`() {
        for (t in listOf(UsbTrigger.INSERTED, UsbTrigger.BOOT, UsbTrigger.PERIODIC)) {
            for (s in UsbStage.values()) {
                assertFalse("$t $s", UsbImportPolicy.shows(t, s, shownBefore = null, packageSeen = false))
            }
        }
        // Not reported either — except NEEDS_ACCESS, which is how an admin learns
        // an Android 11+ screen cannot see an exported .zip without the grant.
        assertFalse(UsbImportPolicy.reports(UsbTrigger.INSERTED, UsbStage.NO_PACKAGE, packageSeen = false))
        assertFalse(UsbImportPolicy.reports(UsbTrigger.PERIODIC, UsbStage.READING, packageSeen = false))
        assertTrue(UsbImportPolicy.reports(UsbTrigger.INSERTED, UsbStage.NEEDS_ACCESS, packageSeen = false))
        assertTrue(UsbImportPolicy.reports(UsbTrigger.MANUAL, UsbStage.NO_PACKAGE, packageSeen = false))
        assertTrue(UsbImportPolicy.reports(UsbTrigger.PERIODIC, UsbStage.OTHER_ORG, packageSeen = true))
    }

    @Test
    fun `removing a stick never shows anything, even under a person's open card`() {
        assertEquals(UsbNext.QUIET, UsbImportPolicy.next(drivePresent = false, requested = false, access = true, usableCandidates = 0, hasKey = true, driveJustRemoved = true))
        assertEquals(UsbNext.QUIET, UsbImportPolicy.next(drivePresent = false, requested = true, access = true, usableCandidates = 0, hasKey = true, driveJustRemoved = true))
        // A person asking with nothing ever plugged in is still told.
        assertEquals(UsbNext.NO_DRIVE, UsbImportPolicy.next(drivePresent = false, requested = true, access = true, usableCandidates = 0, hasKey = true, driveJustRemoved = false))
    }

    @Test
    fun `a VenueOS stick left in says each problem once per drive, and a new playlist always`() {
        // Reading a drive that changes nothing never shows.
        assertFalse(UsbImportPolicy.shows(UsbTrigger.BOOT, UsbStage.READING, null, packageSeen = true))
        assertFalse(UsbImportPolicy.shows(UsbTrigger.PERIODIC, UsbStage.READING, null, packageSeen = true))
        // A new playlist copying in always shows, even after a reboot.
        assertTrue(UsbImportPolicy.shows(UsbTrigger.BOOT, UsbStage.COPYING, UsbStage.COPYING, packageSeen = true))
        assertTrue(UsbImportPolicy.shows(UsbTrigger.PERIODIC, UsbStage.IMPORTED, UsbStage.IMPORTED, packageSeen = true))
        // A problem: the first time for this drive, then not after every nightly reboot.
        assertTrue(UsbImportPolicy.shows(UsbTrigger.BOOT, UsbStage.NEEDS_ACCESS, null, packageSeen = true))
        assertFalse(UsbImportPolicy.shows(UsbTrigger.BOOT, UsbStage.NEEDS_ACCESS, UsbStage.NEEDS_ACCESS, packageSeen = true))
        assertTrue(UsbImportPolicy.shows(UsbTrigger.PERIODIC, UsbStage.WAITING_KEY, UsbStage.NEEDS_ACCESS, packageSeen = true))
        assertFalse(UsbImportPolicy.shows(UsbTrigger.PERIODIC, UsbStage.NO_PACKAGE, UsbStage.NO_PACKAGE, packageSeen = true))
    }

    @Test
    fun `never over an alert`() {
        assertFalse(UsbImportPolicy.mayShow(emergencyHeld = true))
        assertTrue(UsbImportPolicy.mayShow(emergencyHeld = false))
    }

    // ── the permission ─────────────────────────────────────────────────

    @Test
    fun `access is the permission itself — All files access on Android 11+, the storage permission before`() {
        assertTrue(UsbImportPolicy.hasFileAccess(sdk = 33, externalStorageManager = true, readPermissionGranted = false))
        assertFalse(UsbImportPolicy.hasFileAccess(sdk = 33, externalStorageManager = false, readPermissionGranted = true))
        assertTrue(UsbImportPolicy.hasFileAccess(sdk = 29, externalStorageManager = false, readPermissionGranted = true))
        assertFalse(UsbImportPolicy.hasFileAccess(sdk = 28, externalStorageManager = false, readPermissionGranted = false))
    }

    @Test
    fun `coming back from Android's page is a return — the page still opening is not`() {
        assertFalse(UsbImportPolicy.returnedFromAccessPage(awaitingSinceMs = 0L, nowMs = 50_000L))
        assertFalse(UsbImportPolicy.returnedFromAccessPage(awaitingSinceMs = 10_000L, nowMs = 10_300L))
        assertTrue(UsbImportPolicy.returnedFromAccessPage(awaitingSinceMs = 10_000L, nowMs = 25_000L))
    }

    /**
     * The whole M43 story, end to end on real files: the stick is in, the app
     * may not read it → NEEDS_ACCESS (card + report); the person presses Allow,
     * grants it and comes back → the RETURNED scan reads the drive again →
     * verified → copied → IMPORTED, "Playing GGP from USB".
     */
    @Test
    fun `permission granted then back — the drive is read again and the playlist plays`() {
        val key = (0 until 32).joinToString("") { "%02x".format(it * 13 % 256) }
        val tenant = "tenant-1"
        val stick = Files.createTempDirectory("stick").toFile()
        val device = Files.createTempDirectory("device").toFile()
        val pkg = File(stick, UsbPackage.FOLDER).apply { mkdirs() }
        val bytes = "a slide".toByteArray()
        val h = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        File(pkg, "assets").mkdirs()
        File(pkg, "assets/$h.png").writeBytes(bytes)
        val manifest = JSONObject()
            .put("schema", UsbPackage.SCHEMA).put("bundleVersion", "1761495599000").put("tenantId", tenant).put("bundleLabel", "GGP")
            .put("assets", JSONArray().put(JSONObject().put("url", "https://cdn.test/a").put("sha256", h).put("localPath", "assets/$h.png").put("sizeBytes", bytes.size)))
            .put("playlists", JSONArray().put(JSONObject().put("id", "pl").put("items", JSONArray())))
            .toString().toByteArray()
        File(pkg, UsbPackage.MANIFEST).writeBytes(manifest)
        File(pkg, UsbPackage.SIGNATURE).writeText(UsbPackage.hmacHex(key, manifest))

        // 1. In, but not readable by this app (Android 11+ without the grant): nothing is usable.
        val candidates = UsbPackageFinder.candidates(listOf(stick))
        val before = UsbImportPolicy.next(drivePresent = true, requested = false, access = false, usableCandidates = 0, hasKey = true)
        assertEquals(UsbNext.NEEDS_ACCESS, before)
        assertEquals("NEEDS_ACCESS", UsbImportPolicy.report(UsbStage.NEEDS_ACCESS)!!.first)
        assertTrue(UsbPackageFinder.looksLikePackage(candidates.single()))
        assertTrue(UsbImportPolicy.shows(UsbTrigger.INSERTED, UsbStage.NEEDS_ACCESS, null, packageSeen = true))
        assertEquals(UsbAction.ALLOW, UsbImportPolicy.actions(UsbStage.NEEDS_ACCESS).first())

        // 2. Allow → Android's page → back: a return, and a deliberate scan (the card shows it).
        assertTrue(UsbImportPolicy.returnedFromAccessPage(awaitingSinceMs = 1_000L, nowMs = 9_000L))
        assertTrue(UsbTrigger.RETURNED.deliberate)

        // 3. Now readable: verify, copy, play.
        val after = UsbImportPolicy.next(drivePresent = true, requested = true, access = true, usableCandidates = candidates.size, hasKey = true)
        assertEquals(UsbNext.VERIFY, after)
        val importer = UsbImporter(device) { Long.MAX_VALUE }
        val round = UsbSelection.verifyAll(candidates, importer, key, tenant)
        assertEquals(UsbStage.COPYING, UsbImportPolicy.afterVerify(round.best != null, emptyList(), round.openedAny))
        val progress = mutableListOf<Int>()
        val out = UsbBundleSource.open(round.best!!.first)!!.use {
            importer.import(it, key, tenant) { done, _, _, _ -> progress += done }
        } as UsbImporter.Outcome.Imported
        assertEquals("GGP", out.label)
        assertEquals(listOf(0, 1), progress)
        assertEquals("IMPORTED", UsbImportPolicy.report(UsbStage.IMPORTED)!!.first)
        assertTrue(UsbImportPolicy.shows(UsbTrigger.RETURNED, UsbStage.IMPORTED, UsbStage.NEEDS_ACCESS, packageSeen = true))
    }

    @Test
    fun `a long reason is clamped before it leaves the screen`() {
        val long = "x".repeat(500)
        assertEquals(300, UsbImportPolicy.clampReason(long).length)
        assertEquals("short", UsbImportPolicy.clampReason("short"))
    }
}
