package com.educms.player.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── HOLD CONTENT, UPGRADE THE COMPANION, AUTO-RESUME ─────────────────────
 *
 * THE FIELD FAILURE (TC22, 2026-09-01). The operator ran the update: the
 * Player upgraded, the Manager did not. Their own diagnosis was right:
 * *"the screen keeps trying to play the existing content before it gets to
 * finish the updating process — it needs to put the content on hold, do the
 * upgrade, and then auto start the content again."*
 *
 * `MainActivity.onCreate` gated on `readManagerVersion() != null` — BINARY.
 * A stale companion is installed, so the upgrade took the happy path:
 * `loadPlayer()` first, `ManagerBootstrap` (and the system install dialog it
 * raises) second, from the same `onCreate`, with nothing holding anything. A
 * hold mechanism already existed — `showManagerGate()` — but only the
 * companion being MISSING could ever reach it.
 *
 * WHAT THIS SUITE PINS:
 *
 *  1. THE DECISION — including the two refusals that matter more than the
 *     feature: an active emergency, and "once per target per process" so a
 *     repeating CHECK_FOR_UPDATES cannot re-hold a screen forever.
 *  2. THE BOUNDARIES — equal versions, a newer installed build, a missing
 *     companion, a dev build with no bundled asset. Every one of those must
 *     resolve to "carry on playing".
 *  3. THE WIRING — one implementation, two triggers (boot and update check),
 *     a version-aware poller, a Back escape, a bounded self-release. A hold
 *     with no way out is a brick; that is the failure mode this file is
 *     most afraid of.
 */
class ManagerUpgradeMathTest {

    /** The shape of the TC22 panel: companion two releases behind. */
    private fun probe(
        bundled: Int = 10024,
        installed: Int? = 10022,
        skipped: Boolean = false,
    ) = ManagerUpgradeProbe(
        bundledVersionCode = bundled,
        installedVersionCode = installed,
        bootstrapSkipped = skipped,
    )

    private fun decide(
        probe: ManagerUpgradeProbe = probe(),
        emergencyHeld: Boolean = false,
        gateAlreadyShown: Boolean = false,
        holdAlreadyAttemptedForVc: Int = 0,
    ) = ManagerUpgradeMath.decide(probe, emergencyHeld, gateAlreadyShown, holdAlreadyAttemptedForVc)

    // ─── 1. the decision ────────────────────────────────────────────

    @Test
    fun `a stale companion holds content and upgrades`() {
        // THE FIX, in one line. This is the exact state TC22 was in.
        assertEquals(ManagerUpgradeDecision.HOLD_AND_UPGRADE, decide())
    }

    @Test
    fun `an active emergency outranks every upgrade`() {
        // ⚠️ A full-screen "Updating companion service…" overlay on top of a
        // live lockdown alert is the worst thing this feature could do.
        assertEquals(
            ManagerUpgradeDecision.SKIP_EMERGENCY_HELD,
            decide(emergencyHeld = true),
        )
    }

    @Test
    fun `one hold per target version per process`() {
        // The update-check trigger can arrive repeatedly (dashboard push,
        // relay, the panel's Update button). Without this a screen whose
        // companion install keeps failing would re-hold content on every
        // single one of them.
        assertEquals(
            ManagerUpgradeDecision.SKIP_ALREADY_ATTEMPTED,
            decide(holdAlreadyAttemptedForVc = 10024),
        )
        // A NEWER bundled companion is a new fact and gets its own attempt —
        // otherwise a screen that failed once could never be upgraded again
        // without a reboot.
        assertEquals(
            ManagerUpgradeDecision.HOLD_AND_UPGRADE,
            decide(probe = probe(bundled = 10025), holdAlreadyAttemptedForVc = 10024),
        )
    }

    @Test
    fun `a second trigger while the gate is up is a no-op`() {
        // Idempotency: boot and an update check can land within seconds of
        // each other.
        assertEquals(
            ManagerUpgradeDecision.SKIP_GATE_ALREADY_UP,
            decide(gateAlreadyShown = true),
        )
    }

    @Test
    fun `the operator opt-out still wins`() {
        // /sdcard/edu-cms/skip-manager.txt — an operator running without the
        // companion on purpose (LED poster, ViPlex-managed box) must not be
        // handed a gate they never asked for.
        assertEquals(
            ManagerUpgradeDecision.SKIP_BOOTSTRAP_DISABLED,
            decide(probe = probe(skipped = true)),
        )
    }

    // ─── 2. the boundaries ──────────────────────────────────────────

    @Test
    fun `every not-actually-stale shape carries on playing`() {
        // Equal — the overwhelmingly common case, every boot of a
        // fully-updated screen. If this ever held, the whole fleet would
        // gate itself on every restart.
        assertEquals(
            ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE,
            decide(probe = probe(bundled = 10024, installed = 10024)),
        )
        // Installed is NEWER — a companion updated by its own lane, or a
        // Player rolled back. Never downgrade the companion under a gate.
        assertEquals(
            ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE,
            decide(probe = probe(bundled = 10024, installed = 10031)),
        )
        // Companion missing entirely — that is the FIRST-INSTALL gate's job
        // (it already holds, and it withholds the pairing code on purpose).
        assertEquals(
            ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE,
            decide(probe = probe(installed = null)),
        )
        // No bundled asset / unparseable manifest — a dev build before
        // `:app:bundleManagerApk` runs. Unknown is never a reason to hold.
        assertEquals(
            ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE,
            decide(probe = probe(bundled = 0)),
        )
    }

    @Test
    fun `one version behind is enough — the comparison is strict`() {
        assertEquals(
            ManagerUpgradeDecision.HOLD_AND_UPGRADE,
            decide(probe = probe(bundled = 10024, installed = 10023)),
        )
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
    fun `both triggers route through the one hold`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertEquals(
            "boot and update-check must share one implementation — two copies of 'should we " +
                "hold' is two places that can drift back to the binary check",
            2,
            Regex("evaluateManagerUpgradeHold\\(").findAll(main).count() - 1, // minus the declaration
        )
        assertTrue(
            "the boot path must ask before it plays",
            main.contains("evaluateManagerUpgradeHold(\"boot\")"),
        )
        assertTrue(
            "the dashboard's CHECK_FOR_UPDATES is the only way to reach a screen whose PLAYER " +
                "is already current — the operator's 'no way to push the updated manager'",
            main.contains("update-check-user") && main.contains("update-check-push"),
        )
    }

    @Test
    fun `the gate poller compares version codes, not mere presence`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "a stale companion IS installed — an is-it-installed poll would release the " +
                "upgrade gate on its very first tick",
            main.contains("managerGateTargetSatisfied()"),
        )
        assertTrue(
            "the satisfied test must actually read the installed versionCode",
            main.contains("readInstalledManagerVersionCode()") && main.contains("managerGateTargetVc"),
        )
    }

    @Test
    fun `the hold can always be escaped — remote, emergency, or timeout`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "rule 15: the remote's Back must reach an actionable escape from every surface " +
                "that can be on glass",
            main.contains("managerGateShown && managerGateReleasable"),
        )
        assertTrue(
            "an alert must never sit behind an update overlay",
            main.contains("DisplayEmergency.isHeld(applicationContext)") &&
                main.contains("content outranks the upgrade"),
        )
        assertTrue(
            "a screen whose operator walked away must put itself back on the air",
            main.contains("MANAGER_UPGRADE_HOLD_MAX_MS"),
        )
        assertTrue(
            "and the probe itself must be bounded, or local IO can hostage a boot",
            main.contains("MANAGER_PROBE_BUDGET_MS"),
        )
    }

    @Test
    fun `the setup ceremony cannot paint over the gate`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "the upgrade gate breaks the old implication 'gate up => Manager missing', so the " +
                "ceremony's onResume driver would now render its checklist over it — two " +
                "remote-focus surfaces fighting for one D-pad",
            main.contains("readManagerVersion() != null && !managerGateShown"),
        )
    }
}
