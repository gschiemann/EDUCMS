package com.educms.player.ota

import com.educms.player.ota.PendingInstallConfirmation.CheckAction
import com.educms.player.ota.PendingInstallConfirmation.Record
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * 1.1.46 — never bury a pending install dialog; a re-push re-opens it.
 *
 * Field failure (Android 11 GUQ, 1.1.44 → 1.1.45): ~10 min after the dialog
 * came up, a recovery actor resumed our Activity over it, and every later
 * push only re-reported NEEDS_TAP for the buried session.
 */
class PendingInstallConfirmationTest {

    private val minute = 60_000L
    private val wall0 = 1_800_000_000_000L
    private val el0 = 5_000_000L

    private fun rec(pushKey: String? = "push-A", sessionId: Int = 41) = Record(
        sessionId = sessionId,
        versionCode = 10146,
        versionName = "1.1.46",
        pushKey = pushKey,
        launchedAtWallMs = wall0,
        launchedAtElapsedMs = el0,
    )

    // ── 1.1.51 — the bounded wait is a TIMER, and NEEDS_TAP says what is on the glass ──

    @Test
    fun `the expiry check lands just past the window, never inside it`() {
        assertTrue(PendingInstallConfirmation.EXPIRY_CHECK_DELAY_MS > PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS)
        assertTrue(PendingInstallConfirmation.EXPIRY_CHECK_DELAY_MS - PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS <= minute)
        // At that moment onCheck expires the record (no new push).
        val at = el0 + PendingInstallConfirmation.EXPIRY_CHECK_DELAY_MS
        assertEquals(CheckAction.EXPIRE, PendingInstallConfirmation.onCheck(rec(), null, wall0 + PendingInstallConfirmation.EXPIRY_CHECK_DELAY_MS, at))
    }

    @Test
    fun `launching a confirmation schedules the expiry check, and the receiver's message names staged vs raised`() {
        val store = source("src/main/java/com/educms/player/ota/PendingInstallStore.kt")
        val launched = store.substring(store.indexOf("fun noteLaunched("), store.indexOf("private fun scheduleExpiryCheck("))
        assertTrue("every launch arms the timer", launched.contains("scheduleExpiryCheck(ctx)"))
        val schedule = store.substring(store.indexOf("private fun scheduleExpiryCheck("))
        assertTrue(schedule.contains("PendingInstallConfirmation.EXPIRY_CHECK_DELAY_MS"))
        assertTrue("one timer, replaced by a newer launch", schedule.contains("ExistingWorkPolicy.REPLACE"))
        val receiver = source("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")
        assertTrue(receiver.contains("recordSelfOtaOutcome(context, selfOtaVc, status, intent.getBooleanExtra(EXTRA_SELF_OTA_USER, false))"))
        val msg = receiver.substring(receiver.indexOf("internal fun needsTapMessage("), receiver.indexOf("private fun reportOtaError("))
        assertTrue("a raised dialog is named", msg.contains("Install dialog"))
        assertTrue("a staged commit points at the Back menu", msg.contains("press Back"))
    }

    private fun source(relative: String): String {
        var dir: java.io.File? = java.io.File("").absoluteFile
        var root: java.io.File? = null
        while (dir != null) {
            if (java.io.File(dir, "src/main/AndroidManifest.xml").isFile) { root = dir; break }
            if (java.io.File(dir, "app/src/main/AndroidManifest.xml").isFile) { root = java.io.File(dir, "app"); break }
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not on disk", root != null)
        val f = java.io.File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }
    }

    // ── recovery is suppressed while pending ─────────────────────────────

    @Test
    fun `recovery is held off while the confirmation is pending - including past the old 10 minute gate`() {
        for (m in listOf(0L, 1L, 9L, 10L, 11L, 15L, 29L)) {
            assertTrue(
                "minute $m: no recovery actor may resurface the Activity over the dialog",
                PendingInstallConfirmation.holdsRecovery(rec(), false, wall0 + m * minute, el0 + m * minute),
            )
        }
    }

    @Test
    fun `an emergency always overrides the hold`() {
        assertFalse(PendingInstallConfirmation.holdsRecovery(rec(), true, wall0 + minute, el0 + minute))
    }

    @Test
    fun `nothing pending holds nothing`() {
        assertFalse(PendingInstallConfirmation.holdsRecovery(null, false, wall0, el0))
        assertEquals(CheckAction.NONE, PendingInstallConfirmation.onCheck(null, "push-B", wall0, el0))
    }

    @Test
    fun `the hold is bounded - it ends at the NEEDS_TAP window`() {
        val w = PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS
        assertFalse(PendingInstallConfirmation.holdsRecovery(rec(), false, wall0 + w, el0 + w))
    }

    @Test
    fun `a record from before a reboot holds no recovery - the dialog did not survive it`() {
        assertFalse(PendingInstallConfirmation.holdsRecovery(rec(), false, wall0 + minute, 1_000L))
    }

    // ── re-push re-launches ──────────────────────────────────────────────

    @Test
    fun `a new push identity re-opens the dialog`() {
        assertEquals(
            CheckAction.REOPEN,
            PendingInstallConfirmation.onCheck(rec(), "push-B", wall0 + 12 * minute, el0 + 12 * minute),
        )
    }

    @Test
    fun `the same push arriving by a second route moments later does not tear the dialog down`() {
        assertEquals(CheckAction.KEEP_NEEDS_TAP, PendingInstallConfirmation.onCheck(rec(), "push-A", wall0 + 5 * minute, el0 + 5 * minute))
        assertEquals(CheckAction.KEEP_NEEDS_TAP, PendingInstallConfirmation.onCheck(rec(), "push-B", wall0 + 30_000L, el0 + 30_000L))
        assertEquals(CheckAction.KEEP_NEEDS_TAP, PendingInstallConfirmation.onCheck(rec(), null, wall0 + 5 * minute, el0 + 5 * minute))
    }

    @Test
    fun `a push routes to COMMIT even after NEEDS_TAP, while a timer still holds`() {
        val a = OtaAttemptPolicy.Attempt(10146, "1.1.46", "ab", verified = true, commits = 1, outcome = OtaAttemptPolicy.Outcome.NEEDS_TAP)
        assertEquals(
            OtaAttemptPolicy.Route.COMMIT,
            OtaAttemptPolicy.route(OtaAttemptPolicy.Facts(OtaAttemptPolicy.Trigger.PUSH, selfSilent = false, attempt = a)),
        )
        assertEquals(
            OtaAttemptPolicy.Route.HOLD_NEEDS_TAP,
            OtaAttemptPolicy.route(OtaAttemptPolicy.Facts(OtaAttemptPolicy.Trigger.UNATTENDED, selfSilent = false, attempt = a)),
        )
    }

    // ── timeout abandons + EXPIRED ───────────────────────────────────────

    @Test
    fun `after the window an unattended check expires the session`() {
        val w = PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS
        assertEquals(CheckAction.EXPIRE, PendingInstallConfirmation.onCheck(rec(), null, wall0 + w, el0 + w))
        assertEquals(CheckAction.EXPIRE, PendingInstallConfirmation.onCheck(rec(), "push-A", wall0 + w, el0 + w))
    }

    @Test
    fun `after the window a NEW push starts fresh`() {
        val w = PendingInstallConfirmation.NEEDS_TAP_WINDOW_MS
        assertEquals(CheckAction.REOPEN, PendingInstallConfirmation.onCheck(rec(), "push-C", wall0 + w, el0 + w))
    }

    @Test
    fun `an expired attempt is held on a timer and re-raised only by a push or a person`() {
        val a = OtaAttemptPolicy.Attempt(10146, "1.1.46", "ab", verified = true, commits = 1, outcome = OtaAttemptPolicy.Outcome.EXPIRED)
        fun r(t: OtaAttemptPolicy.Trigger) = OtaAttemptPolicy.route(OtaAttemptPolicy.Facts(t, selfSilent = false, attempt = a))
        assertEquals(OtaAttemptPolicy.Route.HOLD_EXPIRED, r(OtaAttemptPolicy.Trigger.UNATTENDED))
        assertEquals(OtaAttemptPolicy.Route.COMMIT, r(OtaAttemptPolicy.Trigger.PUSH))
        assertEquals(OtaAttemptPolicy.Route.COMMIT, r(OtaAttemptPolicy.Trigger.USER))
    }

    @Test
    fun `the expired state is one the server accepts (FAILED_ pattern)`() {
        assertTrue(Regex("^FAILED_[A-Z0-9_]{1,40}$").matches(PendingInstallConfirmation.EXPIRED_STATE))
    }

    @Test
    fun `a reboot with a young record and no new push expires it - nothing is on the glass to tap`() {
        assertEquals(CheckAction.EXPIRE, PendingInstallConfirmation.onCheck(rec(), null, wall0 + 3 * minute, 1_000L))
    }

    @Test
    fun `a wall clock stepped backwards across a reboot reads as expired, never latched`() {
        assertEquals(CheckAction.EXPIRE, PendingInstallConfirmation.onCheck(rec(), null, wall0 - minute, 1_000L))
    }

    // ── success clears ───────────────────────────────────────────────────

    @Test
    fun `the install landing clears the record`() {
        assertTrue(PendingInstallConfirmation.landed(rec(), 10146))
        assertTrue(PendingInstallConfirmation.landed(rec(), 10150))
        assertFalse(PendingInstallConfirmation.landed(rec(), 10145))
        assertFalse(PendingInstallConfirmation.landed(null, 10146))
    }

    @Test
    fun `a late status for a session we abandoned does not settle the fresh one`() {
        assertTrue(PendingInstallConfirmation.settledBy(rec(sessionId = 41), 41))
        assertFalse(PendingInstallConfirmation.settledBy(rec(sessionId = 41), 40))
        assertFalse(PendingInstallConfirmation.settledBy(rec(sessionId = 41), 0))
    }

    // ── wiring (source-read, skipped when sources are absent) ────────────

    private fun src(relative: String): String {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, "src/main/java/com/educms/player/$relative")
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `the watchdog tick consults the install hold before relaunching`() {
        val s = src("watchdog/Watchdog.kt")
        val hold = s.indexOf("MainActivity.installPromptOutstanding")
        val launch = s.indexOf("ctx.startActivity(launch)")
        assertTrue("the watchdog must read the hold", hold > 0)
        assertTrue("…before its startActivity", hold < launch)
    }

    @Test
    fun `the shared hold reads the persisted record and yields to an emergency`() {
        val s = src("MainActivity.kt")
        val getter = s.substringAfter("val installPromptOutstanding: Boolean").substringBefore("@JvmStatic")
        assertTrue(getter.contains("PendingInstallStore.holdsRecoveryNow()"))
        assertTrue(getter.contains("emergencyHeldNow()"))
    }

    @Test
    fun `the launch is persisted before the trampoline goes up`() {
        val s = src("ota/OtaInstallReceiver.kt")
        val note = s.indexOf("PendingInstallStore.noteLaunched(")
        val start = s.indexOf("context.startActivity(trampoline)")
        assertTrue(note in 1 until start)
    }

    @Test
    fun `the worker reports NEEDS_TAP only for a fresh dialog and reports expiry`() {
        val s = src("ota/OtaUpdateWorker.kt")
        assertTrue(s.contains("PendingInstallConfirmation.EXPIRED_STATE"))
        assertTrue(s.contains("abandonOwnSessions"))
        assertEquals(
            "every NEEDS_TAP report in the worker must be gated on a fresh dialog",
            Regex("""reportOtaState\(apiRoot, deviceFingerprint, "NEEDS_TAP"""").findAll(s).count(),
            Regex("""CheckAction\.KEEP_NEEDS_TAP\) \{\s+(PlayerLogger[^\n]+\n\s+)?reportOtaState\(apiRoot, deviceFingerprint, "NEEDS_TAP"""").findAll(s).count(),
        )
    }
}
