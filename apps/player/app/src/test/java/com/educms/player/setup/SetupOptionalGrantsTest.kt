package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.ChecklistInput
import com.educms.player.setup.SetupCeremonyMath.ChecklistMode
import com.educms.player.setup.SetupCeremonyMath.RowStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── THE ADVANCED TIER (2026-08-25, v1.1.5) ────────────────────────────
 *
 * WHY IT EXISTS. v1.1.5 is the last build before the operator installs
 * MANY panels across MANY sites, so every remaining first-boot tap is
 * multiplied by every panel. Two of the six grants were re-audited against
 * what they can actually REACH on a 2026-08-25 build and demoted:
 *
 *   * `deviceAdminPromptShown` — its only consumer is
 *     `DeviceAdminBlankProvider.lockNow()`, and both operator-facing routes
 *     to it are shut (BLANK/WAKE became a web overlay that is never
 *     forwarded to the bridge; POWER_OFF refuses `device-admin` by name as
 *     an UNPROVEN mechanism). It does not enable lock-task or reboot —
 *     both need device OWNER.
 *   * `managerInstallPromptShown` — no Player-side consumer at all, AND
 *     its `isSatisfied` is a hard `false` (no unprivileged API reads
 *     another package's appop), so it pinned every fully-provisioned panel
 *     at "5 of 6" forever.
 *
 * WHAT THIS SUITE PINS, in both directions:
 *
 *   1. DEMOTED IS NOT REMOVED. An advanced row still renders, still says
 *      why, still carries its "can't find it?" path, and is still
 *      tappable. A demotion that quietly made a grant unreachable would be
 *      strictly worse than the taps it saved — a panel that genuinely
 *      needs one must have a route.
 *   2. DEMOTED CANNOT DEMAND. It is never armed, never the primary button,
 *      and never counted — so it can neither nag nor hold a finished panel
 *      at less than 100%.
 *   3. THE GRANT SET ITSELF. A source-level check that exactly these two
 *      steps are `optional`, so a future edit that silently re-demotes a
 *      load-bearing grant (or re-promotes one of these) has to argue with
 *      a red test instead of sliding through review.
 */
class SetupOptionalGrantsTest {

    private val core = listOf(
        "installPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "homeSetupPromptShown",
    )
    private val advanced = listOf("managerInstallPromptShown", "deviceAdminPromptShown")

    private fun input(
        key: String,
        applies: Boolean = true,
        satisfied: Boolean = false,
        offered: Boolean = false,
        optional: Boolean = key in advanced,
    ) = ChecklistInput(
        state = StepState(key, applies, satisfied, offered, optional),
        name = "name-$key",
        why = "why-$key",
        hint = "hint-$key",
    )

    /** The real six, in the real order, with the real optional flags. */
    private fun fleet(
        satisfied: Set<String> = emptySet(),
        offered: Set<String> = emptySet(),
    ) = listOf(
        "installPromptShown",
        "managerInstallPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "deviceAdminPromptShown",
        "homeSetupPromptShown",
    ).map { input(it, satisfied = it in satisfied, offered = it in offered) }

    // ─── 1. demoted cannot demand ───────────────────────────────────

    @Test
    fun `an optional step is never armed as next`() {
        // Nothing granted, nothing offered: the armed step must be the
        // first CORE one, skipping the advanced row that sits at index 1.
        val armed = SetupCeremonyMath.nextKey(fleet().map { it.state })
        assertEquals("installPromptShown", armed)
    }

    @Test
    fun `optional steps cannot hold the ceremony open`() {
        // Every CORE grant held, both advanced ones outstanding and never
        // offered. This is the wide-rollout steady state — a panel the adb
        // provisioning script set up — and it MUST read complete, or every
        // healthy screen grows a setup panel over its signage on boot.
        val states = fleet(satisfied = core.toSet()).map { it.state }
        assertNull(
            "an advanced grant must never arm — it would nag every provisioned panel forever",
            SetupCeremonyMath.nextKey(states),
        )
        assertTrue(SetupCeremonyMath.isComplete(states))
    }

    @Test
    fun `progress counts only the core grants`() {
        val (done, total) = SetupCeremonyMath.progress(fleet(satisfied = core.toSet()).map { it.state })
        assertEquals(4, total)
        assertEquals(4, done)
    }

    @Test
    fun `a fully provisioned panel reads COMPLETE, not five of six`() {
        // THE BUG THIS KILLS: `managerInstallPromptShown` can never report
        // satisfied, so while it was counted the best any panel could ever
        // show was "5 of 6" — a count that cannot reach its total.
        val model = SetupCeremonyMath.buildModel(fleet(satisfied = core.toSet()))
        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_COMPLETE, model.heading)
        assertEquals("4 of 4 done", model.progress)
        assertNull(model.primaryLabel)
    }

    @Test
    fun `the primary button never points at an advanced row`() {
        // Both advanced rows un-granted and un-offered while a core one is
        // outstanding — the primary must still name the core step.
        val model = SetupCeremonyMath.buildModel(
            fleet(satisfied = setOf("installPromptShown", "writeSettingsPromptShown")),
        )
        assertEquals("batteryExemptPromptShown", model.primaryKey)
        assertTrue(model.primaryLabel!!.contains("name-batteryExemptPromptShown"))
    }

    // ─── 2. demoted is not removed ──────────────────────────────────

    @Test
    fun `advanced rows are rendered in their own section and stay tappable`() {
        val model = SetupCeremonyMath.buildModel(fleet())
        assertEquals(core, model.rows.map { it.key })
        assertEquals(advanced, model.optionalRows.map { it.key })
        assertTrue(
            "an operator must always be able to run a demoted grant by tapping its row",
            model.optionalRows.all { it.actionable },
        )
        assertTrue(
            "a demoted row must never be shown as the armed one",
            model.optionalRows.none { it.status == RowStatus.CURRENT },
        )
    }

    @Test
    fun `an advanced row carries its cant-find-it directions whenever it is outstanding`() {
        // Core rows only get the hint while ARMED (six paragraphs at once
        // is wallpaper). An advanced row is never armed, so without this it
        // would be the one row with NO directions — read by exactly the
        // person who went looking for it.
        val model = SetupCeremonyMath.buildModel(fleet())
        assertTrue(model.optionalRows.all { it.hint != null })
        assertNull(
            "a granted advanced row needs no directions",
            SetupCeremonyMath.buildModel(fleet(satisfied = advanced.toSet()))
                .optionalRows.first().hint,
        )
    }

    @Test
    fun `a granted advanced row still reports GRANTED`() {
        val model = SetupCeremonyMath.buildModel(fleet(satisfied = setOf("deviceAdminPromptShown")))
        val row = model.optionalRows.first { it.key == "deviceAdminPromptShown" }
        assertEquals(RowStatus.GRANTED, row.status)
        assertFalse(row.actionable)
    }

    @Test
    fun `a box where an advanced step does not apply simply omits it`() {
        val states = fleet().map {
            if (it.state.key == "managerInstallPromptShown") {
                it.copy(state = it.state.copy(applies = false))
            } else {
                it
            }
        }
        val model = SetupCeremonyMath.buildModel(states)
        assertEquals(listOf("deviceAdminPromptShown"), model.optionalRows.map { it.key })
    }

    // ─── 3. the grant set itself ────────────────────────────────────

    private fun ceremonySource(): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val direct = File(dir, "src/main/java/com/educms/player/setup/SetupCeremony.kt")
            if (direct.isFile) return direct.readText()
            val nested = File(dir, "app/src/main/java/com/educms/player/setup/SetupCeremony.kt")
            if (nested.isFile) return nested.readText()
            dir = dir.parentFile
        }
        return null
    }

    @Test
    fun `exactly the two audited grants are marked optional in the ceremony`() {
        val src = ceremonySource()
        Assume.assumeTrue("SetupCeremony.kt not on disk", src != null)
        val body = src!!

        // Slice each Step block by its prefKey and look for the flag inside
        // it. Crude on purpose: it reads what a reviewer reads.
        fun blockFor(key: String): String {
            val start = body.indexOf("prefKey = \"$key\"")
            assertTrue("no Step for $key", start > 0)
            val next = listOf(
                "installPromptShown",
                "managerInstallPromptShown",
                "writeSettingsPromptShown",
                "batteryExemptPromptShown",
                "deviceAdminPromptShown",
                "homeSetupPromptShown",
            ).mapNotNull { k ->
                body.indexOf("prefKey = \"$k\"", start + 1).takeIf { it > start }
            }.minOrNull() ?: body.indexOf("\n    // ────", start).takeIf { it > start } ?: body.length
            return body.substring(start, next)
        }

        advanced.forEach { key ->
            assertTrue(
                "$key was demoted to ADVANCED on evidence (see the per-grant table in " +
                    "SetupCeremony's header). If it is back on a live path, PROMOTE it " +
                    "deliberately and update that table — do not let this drift.",
                blockFor(key).contains("optional = true"),
            )
        }
        core.forEach { key ->
            assertFalse(
                "$key is LOAD-BEARING: install-packages backs the OTA self-install, " +
                    "WRITE_SETTINGS backs the only proven power path plus the " +
                    "screen-timeout blank, battery exemption keeps the heartbeat and the " +
                    "on/off alarms alive, and HOME is what brings the player back after an " +
                    "update. Demoting one hides a real capability from every install.",
                blockFor(key).contains("optional = true"),
            )
        }
    }

    @Test
    fun `the ceremony header still carries the per-grant evidence table`() {
        val src = ceremonySource()
        Assume.assumeTrue("SetupCeremony.kt not on disk", src != null)
        assertNotNull(src)
        assertTrue(
            "the demotions are only defensible with their evidence attached — keep the table",
            src!!.contains("| grant") && src.contains("ADVANCED"),
        )
    }
}
