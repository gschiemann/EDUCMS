package com.educms.player.ota

import com.educms.player.ota.OtaAttemptPolicy.Attempt
import com.educms.player.ota.OtaAttemptPolicy.Facts
import com.educms.player.ota.OtaAttemptPolicy.Outcome
import com.educms.player.ota.OtaAttemptPolicy.Route
import com.educms.player.ota.OtaAttemptPolicy.Trigger
import com.educms.player.ota.OtaAttemptPolicy.UpToDateMeaning
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── ONE DOWNLOAD AND ONE PROMPT PER BUILD, NOT 48 ────────────────────────
 *
 * THE FIELD FAILURE (M24, Android 9, 2026-10-15/16): after one dashboard push
 * the panel downloaded v1.1.29 forty-eight times in 24 hours. Every check
 * re-ran download → verify → commit, every commit ended at Android's
 * "Install?" dialog with nobody at the panel, and the next check threw the
 * file away and started again. VenueOS will not be the device owner (owner
 * decision 2026-10-17), so on Android 11 and below a person IS required —
 * the fix is to stop pretending otherwise, not to retry harder.
 *
 * WHAT THIS SUITE PINS (OtaAttemptPolicy):
 *  1. a verified build is re-used, never downloaded again;
 *  2. the dialog is raised ONCE by an unattended trigger, then NEEDS_TAP;
 *  3. a person pressing Update on the panel always gets the prompt;
 *  4. a silent install (Android 12+, our own installer of record) is not held;
 *  5. a terminal failure is not retried by a timer;
 *  6. the server's needs-a-tap answer keeps the file; only "nothing offered" drops it;
 *  7. the WIRING — the worker, the receiver and the store actually use it.
 */
class OtaAttemptPolicyTest {

    private val sha = "a".repeat(64)
    private fun attempt(
        commits: Int = 0,
        outcome: Outcome = Outcome.NONE,
        verified: Boolean = true,
        vc: Int = 10129,
    ) = Attempt(versionCode = vc, versionName = "1.1.29", sha256 = sha, verified = verified, commits = commits, outcome = outcome)

    private fun route(a: Attempt?, trigger: Trigger = Trigger.UNATTENDED, selfSilent: Boolean = false) =
        OtaAttemptPolicy.route(Facts(trigger = trigger, selfSilent = selfSilent, attempt = a))

    // ─── 1. never download the same verified build twice ─────────────────

    @Test
    fun `a verified build for the offered versionCode and digest is re-used`() {
        assertTrue(OtaAttemptPolicy.canReuse(attempt(), 10129, sha, fileExists = true, fileLength = 31_000_000L))
        // Digest comparison is case-insensitive (the server sends lowercase hex).
        assertTrue(OtaAttemptPolicy.canReuse(attempt(), 10129, sha.uppercase(), true, 1L))
    }

    @Test
    fun `nothing that is not proven the same build is re-used`() {
        assertFalse("no record", OtaAttemptPolicy.canReuse(null, 10129, sha, true, 1L))
        assertFalse("never verified", OtaAttemptPolicy.canReuse(attempt(verified = false), 10129, sha, true, 1L))
        assertFalse("another build", OtaAttemptPolicy.canReuse(attempt(), 10130, sha, true, 1L))
        assertFalse("another digest", OtaAttemptPolicy.canReuse(attempt(), 10129, "b".repeat(64), true, 1L))
        assertFalse("file gone", OtaAttemptPolicy.canReuse(attempt(), 10129, sha, false, 1L))
        assertFalse("file empty", OtaAttemptPolicy.canReuse(attempt(), 10129, sha, true, 0L))
    }

    // ─── 2. one unattended prompt, then NEEDS_TAP ─────────────────────────

    @Test
    fun `M24 SHAPE - the first unattended check raises the dialog once`() {
        assertEquals(Route.COMMIT, route(null))
        assertEquals(Route.COMMIT, route(attempt(commits = 0, outcome = Outcome.NONE)))
    }

    @Test
    fun `M24 SHAPE - every later unattended check holds instead of committing again`() {
        // The 30-minute / 6-hour / push / boot checks after the first commit.
        assertEquals(Route.HOLD_NEEDS_TAP, route(attempt(commits = 1, outcome = Outcome.NEEDS_TAP)))
        // No status ever came back (process killed mid-dialog): still held.
        assertEquals(Route.HOLD_NEEDS_TAP, route(attempt(commits = 1, outcome = Outcome.COMMITTED)))
        // A re-downloaded file keeps the record of what was done with the build.
        assertEquals(Route.HOLD_NEEDS_TAP, route(attempt(commits = 1, outcome = Outcome.NONE)))
    }

    @Test
    fun `48 unattended checks after a push produce exactly one commit`() {
        var a: Attempt? = null
        var commits = 0
        repeat(48) {
            when (route(a)) {
                Route.COMMIT -> {
                    commits++
                    a = (a ?: attempt()).copy(commits = (a?.commits ?: 0) + 1, outcome = Outcome.COMMITTED)
                    // …and Android answered PENDING_USER_ACTION (nobody tapped).
                    a = a!!.copy(outcome = Outcome.NEEDS_TAP)
                }
                Route.HOLD_NEEDS_TAP -> Unit
                Route.HOLD_FAILED, Route.HOLD_EXPIRED -> error("no failure in this shape")
            }
        }
        assertEquals(1, commits)
    }

    // ─── 3. a person at the panel always gets the prompt ──────────────────

    @Test
    fun `a person pressing Update re-commits the kept build`() {
        assertEquals(Route.COMMIT, route(attempt(commits = 3, outcome = Outcome.NEEDS_TAP), Trigger.USER))
        // Even after a failure — a person may retry what a timer must not.
        assertEquals(Route.COMMIT, route(attempt(commits = 1, outcome = Outcome.FAILED), Trigger.USER))
    }

    // ─── 4. silent installs are never held ────────────────────────────────

    @Test
    fun `Android 12 plus as our own installer of record commits silently every time`() {
        assertEquals(Route.COMMIT, route(attempt(commits = 2, outcome = Outcome.COMMITTED), selfSilent = true))
        assertEquals(Route.COMMIT, route(attempt(commits = 2, outcome = Outcome.NEEDS_TAP), selfSilent = true))
    }

    // ─── 5. a terminal failure is not retried by a timer ──────────────────

    @Test
    fun `a failed install is held for unattended triggers, silent or not`() {
        assertEquals(Route.HOLD_FAILED, route(attempt(commits = 1, outcome = Outcome.FAILED)))
        assertEquals(Route.HOLD_FAILED, route(attempt(commits = 1, outcome = Outcome.FAILED), selfSilent = true))
    }

    // ─── 6. the server's uptoDate answers ────────────────────────────────

    @Test
    fun `a push the server holds for a tap keeps the file and reports NEEDS_TAP`() {
        assertEquals(UpToDateMeaning.HELD_NEEDS_TAP, OtaAttemptPolicy.readUpToDate(needsTap = true))
    }

    @Test
    fun `a plain up-to-date answer drops the kept build (push gone, already current)`() {
        assertEquals(UpToDateMeaning.DROP, OtaAttemptPolicy.readUpToDate(needsTap = false))
    }

    // ─── the dashboard's states ───────────────────────────────────────────

    @Test
    fun `PackageInstaller failures become FAILED_CODE in the server's vocabulary`() {
        val serverPattern = Regex("^FAILED_[A-Z0-9_]{1,40}$")
        for (status in listOf(1, 2, 3, 4, 5, 6, 7, -999, 42)) {
            val state = OtaAttemptPolicy.failedState(OtaAttemptPolicy.failureCode(status))
            assertTrue("$status → $state", serverPattern.matches(state))
        }
        assertEquals("FAILED_ABORTED", OtaAttemptPolicy.failedState(OtaAttemptPolicy.failureCode(OtaAttemptPolicy.Status.FAILURE_ABORTED)))
        assertEquals("FAILED_INCOMPATIBLE", OtaAttemptPolicy.failedState(OtaAttemptPolicy.failureCode(OtaAttemptPolicy.Status.FAILURE_INCOMPATIBLE)))
        assertEquals("FAILED_UNKNOWN", OtaAttemptPolicy.failedState(null))
        assertEquals("FAILED_X_Y", OtaAttemptPolicy.failedState("x;y"))
    }

    @Test
    fun `the mirrored status constants match the platform`() {
        // PackageInstaller.STATUS_* (stable public API since 21).
        assertEquals(0, OtaAttemptPolicy.Status.SUCCESS)
        assertEquals(-1, OtaAttemptPolicy.Status.PENDING_USER_ACTION)
        assertEquals(3, OtaAttemptPolicy.Status.FAILURE_ABORTED)
        assertEquals(7, OtaAttemptPolicy.Status.FAILURE_INCOMPATIBLE)
    }

    // ─── 7. the wiring ────────────────────────────────────────────────────

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun source(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `the worker re-uses a verified build before downloading`() {
        val src = source("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt")
        val reuse = src.indexOf("OtaAttemptPolicy.canReuse(")
        val download = src.indexOf("URL(apkUrl).openConnection()")
        assertTrue("the worker must consult canReuse", reuse > 0)
        assertTrue("…before it opens the download", download > reuse)
        assertTrue("…and re-hash the kept file", src.contains("sha256(outFile).equals(expectedSha, ignoreCase = true)"))
    }

    @Test
    fun `the worker commits only on the route the policy picks`() {
        val src = source("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt")
        assertTrue(src.contains("OtaAttemptPolicy.route("))
        val commit = src.indexOf("OtaAttemptPolicy.Route.COMMIT ->")
        val install = src.indexOf("triggerInstall(outFile, forced, apiRoot, deviceFingerprint, latestVc, pushKey)")
        assertTrue("triggerInstall must live inside the COMMIT branch", commit in 1 until install)
        assertEquals("exactly one install call", 1, Regex("triggerInstall\\(outFile").findAll(src).count())
        assertTrue("held builds report NEEDS_TAP", src.contains("Route.HOLD_NEEDS_TAP ->"))
    }

    @Test
    fun `the install receiver records our own outcome and only ours`() {
        val receiver = source("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")
        assertTrue(receiver.contains("intent.getIntExtra(EXTRA_SELF_OTA_VERSION_CODE, 0)"))
        assertTrue(receiver.contains("recordSelfOtaOutcome(context, selfOtaVc, status)"))
        assertTrue("NEEDS_TAP comes from PENDING_USER_ACTION", receiver.contains("OtaAttemptPolicy.Outcome.NEEDS_TAP to \"NEEDS_TAP\""))
        val worker = source("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt")
        assertTrue(
            "the worker's own session names the build it installs",
            worker.contains("putExtra(OtaInstallReceiver.EXTRA_SELF_OTA_VERSION_CODE, versionCode)"),
        )
    }

    @Test
    fun `the Manager's own 30-minute lane no longer installs an installed Player`() {
        // The M24's 48 downloads came from this lane (Manager 1.0.24 polls
        // every 30 minutes). Only the bootstrap — no Player on the device yet —
        // may still go on to the update check.
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root!!.parentFile, "manager/src/main/java/com/educms/manager/OtaWorker.kt")
        Assume.assumeTrue("Manager source not on disk", f.isFile)
        val src = f.readText()
        val skip = src.indexOf("if (!isBootstrap) {")
        val check = src.indexOf("put(\"source\", \"manager\")")
        assertTrue("the lane must stop for an installed Player", skip > 0)
        assertTrue("…before it builds the update-check request", check > skip)
        assertTrue(src.substring(skip, check).contains("return@withContext Result.success()"))
    }

    @Test
    fun `the receiver reports off the main thread`() {
        val receiver = source("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")
        val start = receiver.indexOf("private fun recordSelfOtaOutcome")
        val body = receiver.substring(start, receiver.indexOf("private fun reportOtaError", start))
        assertTrue(body.contains("goAsync()"))
        assertTrue(body.contains("Thread {"))
    }
}
