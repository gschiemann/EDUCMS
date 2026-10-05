package com.educms.player.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * PERMISSIONS AS THE SYSTEM MENU SHOWS THEM (v1.1.23).
 *
 * The X80 owner: "some of the items not checked are actually already enabled
 * when you pop up the menu … I think you're not mapped correctly". Two causes
 * in code: the Manager's install row was a hard `false`, and grants made on
 * the Manager's line of a Settings list (it sorts right above the Player's)
 * left the Player's row unchecked with nothing on the card saying why.
 */
class PermissionFactsTest {

    // ─── how a Settings toggle reads an appop ────────────────────────────

    @Test
    fun `an allowed appop is on, whatever the permission says`() {
        assertEquals(true, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_ALLOWED, null))
        assertEquals(true, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_ALLOWED, false))
    }

    @Test
    fun `default falls back to the install-time permission, and unknown stays unknown`() {
        assertEquals(true, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_DEFAULT, true))
        assertEquals(false, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_DEFAULT, false))
        assertNull(PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_DEFAULT, null))
    }

    @Test
    fun `ignored, errored and anything else is off`() {
        assertEquals(false, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_IGNORED, true))
        assertEquals(false, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_ERRORED, true))
        assertEquals(false, PermissionFactsMath.shownAsAllowed(PermissionFactsMath.MODE_FOREGROUND, true))
        assertEquals(false, PermissionFactsMath.shownAsAllowed(99, true))
    }

    @Test
    fun `modes are named for the report`() {
        assertEquals("allowed", PermissionFactsMath.modeName(PermissionFactsMath.MODE_ALLOWED))
        assertEquals("default", PermissionFactsMath.modeName(PermissionFactsMath.MODE_DEFAULT))
        assertEquals("errored", PermissionFactsMath.modeName(PermissionFactsMath.MODE_ERRORED))
        assertEquals("mode-42", PermissionFactsMath.modeName(42))
    }

    // ─── the row says when the Manager holds what the Player needs ──────

    private fun row(player: Boolean?, manager: Boolean?) = PermissionRow(
        id = "batteryUnrestricted",
        stepKey = SetupCeremonyMath.STEP_BATTERY_EXEMPT,
        player = GrantRead(player, null, "test"),
        manager = GrantRead(manager, null, "test"),
    )

    @Test
    fun `granted to the Manager and not the Player — the row says so, naming both apps`() {
        val note = PermissionFactsMath.managerHoldsNote(row(false, true), "VenueOS Player", "VenueOS Manager")
        assertTrue(note!!.contains("VenueOS Manager"))
        assertTrue(note.contains("VenueOS Player"))
        assertTrue(note.contains("switch on VenueOS Player too"))
    }

    @Test
    fun `no note when the Player holds it, the Manager does not, or either is unknown`() {
        assertNull(PermissionFactsMath.managerHoldsNote(row(true, true), "P", "M"))
        assertNull(PermissionFactsMath.managerHoldsNote(row(false, false), "P", "M"))
        assertNull(PermissionFactsMath.managerHoldsNote(row(null, true), "P", "M"))
        assertNull(PermissionFactsMath.managerHoldsNote(row(false, null), "P", "M"))
        val noManager = row(false, true).copy(manager = null)
        assertNull(PermissionFactsMath.managerHoldsNote(noManager, "P", "M"))
    }

    // ─── wiring ───────────────────────────────────────────────────────────

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
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            .replace(Regex("//[^\\n]*"), "")
    }

    @Test
    fun `the Manager's install row is read, not hard-coded false`() {
        val src = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        val start = src.indexOf("prefKey = \"managerInstallPromptShown\"")
        val end = src.indexOf("prefKey = \"writeSettingsPromptShown\"")
        assertTrue(start in 0 until end)
        val block = src.substring(start, end)
        assertFalse("isSatisfied = { false } is back", block.contains("isSatisfied = { false }"))
        assertTrue(block.contains("PermissionFactsReader.managerInstallAllowed("))
    }

    @Test
    fun `every row names the app by its real label, never a hard-coded spelling`() {
        val src = require("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        assertFalse(
            "the 1.1.22 hints said \"Venue OS Player\" while every Settings list said \"VenueOS Player\"",
            src.contains("→ Venue OS Player"),
        )
        assertTrue(src.contains("SetupFactsReader.appLabel(app, app.packageName)"))
        assertTrue(src.contains(".replace(PLAYER_TOKEN, playerLabel)"))
        assertTrue("the Manager-held note reaches the row", src.contains("PermissionFactsMath.managerHoldsNote("))
    }

    @Test
    fun `the reader asks the system for the Manager's toggles, read-only`() {
        val src = require("src/main/java/com/educms/player/setup/PermissionFacts.kt")
        assertTrue(src.contains("checkOpNoThrow(op, uid, pkg)"))
        assertTrue(src.contains("isIgnoringBatteryOptimizations(pkg)"))
        assertTrue(src.contains("isAdminActive(component)"))
        // Never a write, never a note, never a prompt.
        for (forbidden in listOf("setMode(", "noteOp(", "noteOpNoThrow(", "startActivity(", "putInt(", "edit()")) {
            assertFalse("PermissionFacts must only read — found $forbidden", src.contains(forbidden))
        }
    }

    @Test
    fun `the capability report carries the raw facts under their own key`() {
        val probe = require("src/main/java/com/educms/player/display/DisplayCapabilityProbe.kt")
        assertTrue(probe.contains("section(root, \"permissions\")"))
        assertTrue(probe.contains("SetupCeremony.permissionsJson(ctx)"))
    }
}
