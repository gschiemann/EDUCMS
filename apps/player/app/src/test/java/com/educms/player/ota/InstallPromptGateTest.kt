package com.educms.player.ota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── NEVER RELAUNCH OVER A LIVE INSTALL CONFIRMATION ──────────────────────
 *
 * THE FIELD FAILURE (TC22, 2026-09-01). The operator ran the update: *"it
 * updated the player and at least asked to update the manager but it did
 * not update it."*
 *
 * The "ask" was the system PackageInstaller confirmation for
 * `com.educms.manager`. While it owns the screen, MainActivity is PAUSED —
 * and every relaunch actor in the APK read `isInForeground == false` as
 * "the player is gone" and launched MainActivity `NEW_TASK|CLEAR_TOP` over
 * the dialog. The +60 s `PostInstallRelaunchWorker` rung lands squarely in
 * the window in which a human is reading it. The guard shipped in
 * `319974bd` covered the ALREADY-foreground case; this is the inverse case
 * it left open.
 *
 * WHAT THIS SUITE PINS:
 *
 *  1. THE DECISION. A raise suppresses relaunches; real evidence clears it;
 *     and — the part that keeps this from being worse than the bug — it
 *     EXPIRES on its own, so no dropped signal can latch a screen into a
 *     state where it may never be relaunched again.
 *  2. OUR OWN RESUME IS NOT THE OPERATOR'S. The trampoline foregrounds
 *     MainActivity and then starts the confirmation, so a resume lands
 *     milliseconds after every raise. A gate that cleared on that would
 *     suppress nothing at all.
 *  3. THE WIRING — the `DeviceAdminWiringTest` lesson: a decision function
 *     nothing calls passes its tests perfectly. Every relaunch actor inside
 *     the Player APK must actually read the fact, and the trampoline must
 *     record it BEFORE `startActivity`.
 *
 * Timestamps below are realistic `elapsedRealtime()` values — a panel four
 * days into an uptime, not `0`, `1`, `2` (reliability rule 8).
 */
class InstallPromptGateTest {

    /** A wall panel that has been up for four days. */
    private val uptime = 4L * 24L * 60L * 60L * 1000L

    private fun facts(
        raisedAtMs: Long? = uptime,
        nowMs: Long = uptime + 1_000L,
        targetVersionChanged: Boolean = false,
        terminalStatusSeen: Boolean = false,
        activityResumed: Boolean = false,
    ) = InstallPromptGate.Facts(
        raisedAtMs = raisedAtMs,
        nowMs = nowMs,
        targetVersionChanged = targetVersionChanged,
        terminalStatusSeen = terminalStatusSeen,
        activityResumed = activityResumed,
    )

    // ─── 1. the decision ────────────────────────────────────────────

    @Test
    fun `nothing raised is not a hold`() {
        // The default state of every process that never prompts for
        // anything. If this were ever OUTSTANDING, the post-OTA relaunch
        // ladder would be dead fleet-wide.
        assertEquals(InstallPromptGate.Verdict.NONE, InstallPromptGate.verdict(facts(raisedAtMs = null)))
        assertFalse(InstallPromptGate.isOutstanding(facts(raisedAtMs = null)))
    }

    @Test
    fun `a freshly raised confirmation holds off every relaunch actor`() {
        // THE FIX. 1 second after the trampoline fired, the +60s worker,
        // OtaInstallReceiver's 8x loop and the escalation ladder must all
        // see this and stand down.
        assertEquals(InstallPromptGate.Verdict.OUTSTANDING, InstallPromptGate.verdict(facts()))
        assertTrue(InstallPromptGate.isOutstanding(facts()))
        // ...and it is STILL outstanding a minute in, which is exactly when
        // the post-install rung fires.
        assertTrue(InstallPromptGate.isOutstanding(facts(nowMs = uptime + 60_000L)))
    }

    @Test
    fun `our own trampoline resume does not clear the hold`() {
        // The trampoline brings MainActivity to the front and THEN starts
        // the confirmation, so `activityResumed` is true within
        // milliseconds of every single raise. Without the on-screen floor
        // the gate would clear itself instantly and suppress nothing —
        // the bug would be back with a test proving it fixed.
        assertEquals(
            InstallPromptGate.Verdict.OUTSTANDING,
            InstallPromptGate.verdict(
                facts(
                    nowMs = uptime + 250L,
                    terminalStatusSeen = true,
                    activityResumed = true,
                ),
            ),
        )
    }

    @Test
    fun `a terminal status plus the operator coming back settles it`() {
        // Dialog dismissed / install failed, and we are back on the glass a
        // few seconds later. Nothing is on top of us any more, so a genuine
        // recovery must not stay suppressed.
        assertEquals(
            InstallPromptGate.Verdict.CLEARED_SETTLED,
            InstallPromptGate.verdict(
                facts(
                    nowMs = uptime + 9_000L,
                    terminalStatusSeen = true,
                    activityResumed = true,
                ),
            ),
        )
        // A terminal status while we are still NOT on glass is not enough —
        // on some ROMs it lands while the dialog is being torn down.
        assertEquals(
            InstallPromptGate.Verdict.OUTSTANDING,
            InstallPromptGate.verdict(facts(nowMs = uptime + 9_000L, terminalStatusSeen = true)),
        )
    }

    @Test
    fun `the target package changing clears it immediately and from anywhere`() {
        // The strongest evidence there is: the package the dialog was
        // asking about is now a different version. Outranks everything,
        // including "we are not foregrounded" — the very next thing that
        // happens after a companion install is the player being relaunched.
        assertEquals(
            InstallPromptGate.Verdict.CLEARED_VERSION_CHANGED,
            InstallPromptGate.verdict(facts(targetVersionChanged = true)),
        )
        assertFalse(InstallPromptGate.isOutstanding(facts(targetVersionChanged = true)))
    }

    @Test
    fun `the hold expires on its own so it can never brick a screen`() {
        // ⚠️ THE SAFETY VALVE. Every clearing signal here is best-effort: a
        // status broadcast can be dropped, PACKAGE_ADDED can be missed on
        // an OEM ROM. If "no signal" meant "hold forever", one buried
        // dialog would leave a panel that no relaunch path may ever touch
        // again — strictly worse than the bug being fixed.
        val justBefore = uptime + InstallPromptGate.MAX_OUTSTANDING_MS - 1_000L
        assertEquals(InstallPromptGate.Verdict.OUTSTANDING, InstallPromptGate.verdict(facts(nowMs = justBefore)))

        val atTheBoundary = uptime + InstallPromptGate.MAX_OUTSTANDING_MS
        assertEquals(
            InstallPromptGate.Verdict.CLEARED_EXPIRED,
            InstallPromptGate.verdict(facts(nowMs = atTheBoundary)),
        )
        // Hours later — a panel nobody ever walked to — it is long clear.
        assertFalse(InstallPromptGate.isOutstanding(facts(nowMs = uptime + 3L * 60L * 60L * 1000L)))
    }

    @Test
    fun `an impossible timestamp resolves to clear, never to a permanent hold`() {
        // `elapsedRealtime` does not go backwards, so this should be
        // unreachable — which is exactly why it needs a defined answer.
        // Anything unusable must fall to the side that can still recover a
        // screen.
        assertEquals(
            InstallPromptGate.Verdict.CLEARED_EXPIRED,
            InstallPromptGate.verdict(facts(nowMs = uptime - 5_000L)),
        )
    }

    @Test
    fun `the escalation ladder stands down instead of retrying or reporting`() {
        val held = RelaunchFacts(
            foreground = false,
            canDrawOverlays = true,
            isHomeApp = true,
            deviceOwnerIsOurs = false,
            overlayRetryUsed = false,
            installPromptOutstanding = true,
        )
        // Not SETTLED (we have no proof of a landing — rule 10), not
        // ESCALATE (nothing is wrong), and specifically NOT the overlay
        // retry: on a panel that holds the overlay grant, that retry is
        // precisely the launch that would bury the dialog.
        assertEquals(RelaunchStage.HOLD_FOR_INSTALL_PROMPT, RelaunchEscalationMath.next(held))
        // A player that IS on glass still reads as landed — the older,
        // cheaper fact keeps priority.
        assertEquals(
            RelaunchStage.SETTLED,
            RelaunchEscalationMath.next(held.copy(foreground = true)),
        )
        // And with no prompt outstanding the ladder is byte-for-byte what
        // it was: this change must not alter the two-Goodview-panels path.
        assertEquals(
            RelaunchStage.RETRY_WITH_OVERLAY,
            RelaunchEscalationMath.next(held.copy(installPromptOutstanding = false)),
        )
    }

    // ─── 2. re-issue budget (F4) ────────────────────────────────────

    @Test
    fun `a dropped prompt can be re-shown, but only while we are holding content`() {
        // A covered dialog on a PLAYING screen is not worth putting a
        // system prompt back over content unasked; while the gate is up we
        // are already holding for exactly this.
        assertFalse(
            InstallPromptGate.shouldReissue(
                holdingContentForUpgrade = false,
                hasStagedPrompt = true,
                outstanding = false,
                reissuesUsed = 0,
                lastRaisedAtMs = uptime,
                nowMs = uptime + 30_000L,
            ),
        )
        assertTrue(
            InstallPromptGate.shouldReissue(
                holdingContentForUpgrade = true,
                hasStagedPrompt = true,
                outstanding = false,
                reissuesUsed = 0,
                lastRaisedAtMs = uptime,
                nowMs = uptime + 30_000L,
            ),
        )
    }

    @Test
    fun `re-issue never fires over a live prompt, or in the same breath as one`() {
        assertFalse(
            "re-raising over a dialog that is already up is the loop this must not become",
            InstallPromptGate.shouldReissue(
                holdingContentForUpgrade = true,
                hasStagedPrompt = true,
                outstanding = true,
                reissuesUsed = 0,
                lastRaisedAtMs = uptime,
                nowMs = uptime + 1_000L,
            ),
        )
        assertFalse(
            "half a second after the raise, the resume we are reacting to is our own",
            InstallPromptGate.shouldReissue(
                holdingContentForUpgrade = true,
                hasStagedPrompt = true,
                outstanding = false,
                reissuesUsed = 0,
                lastRaisedAtMs = uptime,
                nowMs = uptime + 500L,
            ),
        )
    }

    @Test
    fun `the re-issue budget runs out — a dialog a person cannot dismiss is a brick`() {
        val args = { used: Int ->
            InstallPromptGate.shouldReissue(
                holdingContentForUpgrade = true,
                hasStagedPrompt = true,
                outstanding = false,
                reissuesUsed = used,
                lastRaisedAtMs = uptime,
                nowMs = uptime + 30_000L,
            )
        }
        assertTrue(args(0))
        assertTrue(args(InstallPromptGate.MAX_REISSUES - 1))
        assertFalse(args(InstallPromptGate.MAX_REISSUES))
        assertFalse(args(InstallPromptGate.MAX_REISSUES + 5))
    }

    @Test
    fun `a staged prompt survives a dropped launch but not the install landing`() {
        // F4: `takePendingInstallPrompt` used to be single-use, so a
        // BAL-dropped launch consumed the only copy and the bundled-Manager
        // upgrade could then only be retried by a COLD onCreate.
        assertTrue(
            InstallPromptGate.stagedPromptStillUsable(
                stagedAtMs = uptime,
                nowMs = uptime + 45_000L,
                targetVersionChanged = false,
            ),
        )
        assertFalse(
            "once the companion actually updated, re-showing its install dialog is nonsense",
            InstallPromptGate.stagedPromptStillUsable(
                stagedAtMs = uptime,
                nowMs = uptime + 45_000L,
                targetVersionChanged = true,
            ),
        )
        assertFalse(
            "a confirmation Intent minted 20 minutes ago is for a session that is long gone",
            InstallPromptGate.stagedPromptStillUsable(
                stagedAtMs = uptime,
                nowMs = uptime + 20L * 60L * 1000L,
                targetVersionChanged = false,
            ),
        )
        assertFalse(InstallPromptGate.stagedPromptStillUsable(null, uptime, false))
    }

    // ─── 3. the wiring ──────────────────────────────────────────────

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

    private fun require(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root!!, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `MainActivity records the raise BEFORE starting the confirmation`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue("no publisher, no hold", main.contains("val installPromptOutstanding"))
        val note = main.indexOf("noteInstallPromptRaised(staged.targetPackage)")
        val start = main.indexOf("startActivity(staged.intent)")
        assertTrue("the raise must be recorded in raiseInstallPrompt", note > 0)
        assertTrue("the prompt must be launched from raiseInstallPrompt", start > 0)
        assertTrue(
            "recording AFTER startActivity leaves a window in which another thread reads " +
                "'paused, no prompt' — which is the entire bug",
            note < start,
        )
    }

    @Test
    fun `every relaunch actor in the Player APK reads the hold`() {
        // The four Player-side `startActivity` relaunch paths. (Manager's
        // own actors — PackageReplacedReceiver, its OtaInstallReceiver and
        // WatchdogService — live in the other APK and need a cross-process
        // signal; no Manager release is in this wave, so they stay
        // unguarded and are called out in the handoff.)
        val escalation = require("src/main/java/com/educms/player/ota/RelaunchEscalation.kt")
        val worker = require("src/main/java/com/educms/player/ota/PostInstallRelaunchWorker.kt")
        val receiver = require("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")

        assertTrue(
            "attempt() must bail before it launches",
            escalation.contains("MainActivity.installPromptOutstanding"),
        )
        assertTrue(
            "readFacts must carry the fact into the ladder, or firstCheck can still escalate " +
                "and post a false RELAUNCH_BLOCKED for a player that is merely behind a dialog",
            escalation.contains("installPromptOutstanding = MainActivity.installPromptOutstanding"),
        )
        assertTrue(
            "the +60s rung is the one that buried the TC22 dialog",
            worker.contains("MainActivity.installPromptOutstanding"),
        )
        assertTrue(
            "relaunchSelf fires eight times in eight seconds — it must re-read the fact",
            receiver.contains("MainActivity.installPromptOutstanding"),
        )
    }

    @Test
    fun `the install receiver reports both outcomes back to the gate`() {
        val receiver = require("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")
        assertTrue(
            "STATUS_SUCCESS is the proof the dialog is gone; without it the hold would run " +
                "its full 10-minute window after every successful companion install",
            receiver.contains("noteInstallLanded("),
        )
        assertTrue(
            "a terminal failure must be reported too, or a declined dialog holds for 10 minutes",
            receiver.contains("noteInstallStatusTerminal("),
        )
    }
}
