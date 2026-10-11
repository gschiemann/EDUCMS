package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * DID THE PANEL ACTUALLY GO TO SLEEP? (2026-10-11)
 *
 * The 1.1.23 drill on VisionCore's X80: an alert woke a panel a person had
 * turned off; after the all-clear the restore blank reported Ok (screen-off
 * timeout 15 s) and the screen stayed on. Nothing checked. These pin the
 * rules of the check, the screensaver demotion and — first — that none of it
 * can darken a screen during an alert.
 */
class SleepProofTest {

    // ─── the outcome ─────────────────────────────────────────────────────

    @Test
    fun `only a non-interactive panel counts as off`() {
        assertEquals(SleepProofPolicy.OUTCOME_OFF, SleepProofPolicy.outcome(interactive = false, dreamSeen = false))
        assertEquals(SleepProofPolicy.OUTCOME_ON, SleepProofPolicy.outcome(interactive = true, dreamSeen = false))
        // An unreadable power state is never reported as off.
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, SleepProofPolicy.outcome(interactive = null, dreamSeen = false))
    }

    @Test
    fun `a screensaver is a dream, not an off — even though Android calls it interactive`() {
        assertEquals(SleepProofPolicy.OUTCOME_DREAM, SleepProofPolicy.outcome(interactive = true, dreamSeen = true))
        assertEquals(SleepProofPolicy.OUTCOME_DREAM, SleepProofPolicy.outcome(interactive = null, dreamSeen = true))
    }

    @Test
    fun `the settle window covers the 15 s timeout plus the alert's own 30 s wake lock`() {
        val settle = SleepProofPolicy.settleMsFor("screen-timeout")!!
        assertTrue(settle >= ScreenTimeoutBlankProvider.BLANK_TIMEOUT_MS + 30_000L)
        // A lock sleeps at once.
        assertEquals(SleepProofPolicy.IMMEDIATE_SETTLE_MS, SleepProofPolicy.settleMsFor("device-admin"))
        assertEquals(SleepProofPolicy.IMMEDIATE_SETTLE_MS, SleepProofPolicy.settleMsFor("accessibility-lock"))
        // The software floor never sleeps anything: nothing to wait for.
        assertNull(SleepProofPolicy.settleMsFor("software-dim"))
        assertEquals(SleepProofPolicy.OUTCOME_BLACK, SleepProofPolicy.immediateOutcomeFor("software-dim"))
    }

    @Test
    fun `a vendor backlight command keeps Android awake by design — never reported as stayed on`() {
        // e.g. rk3288 bl_power=4: the backlight is off, Android is interactive.
        assertNull(SleepProofPolicy.settleMsFor("vendor-recipe"))
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, SleepProofPolicy.immediateOutcomeFor("vendor-recipe"))
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, SleepProofPolicy.immediateOutcomeFor("novastar-sdk"))
        // Android sleeps are checked, not assumed.
        assertNull(SleepProofPolicy.immediateOutcomeFor("device-admin"))
        assertNull(SleepProofPolicy.immediateOutcomeFor("screen-timeout"))
    }

    // ─── after the all-clear ─────────────────────────────────────────────

    @Test
    fun `a restore that did not turn the panel off is covered with black`() {
        for (o in listOf(SleepProofPolicy.OUTCOME_ON, SleepProofPolicy.OUTCOME_DREAM)) {
            assertTrue(SleepProofPolicy.coverAfterRestore(o, restoredStandbyActive = true, held = false, blanked = true))
        }
    }

    @Test
    fun `never covers during an alert`() {
        assertFalse(
            SleepProofPolicy.coverAfterRestore(
                SleepProofPolicy.OUTCOME_ON,
                restoredStandbyActive = true,
                held = true,
                blanked = true,
            ),
        )
    }

    @Test
    fun `a person who turned it back on in the meantime wins`() {
        // The power key / a WAKE / the schedule ended the restored standby.
        assertFalse(SleepProofPolicy.coverAfterRestore(SleepProofPolicy.OUTCOME_ON, false, held = false, blanked = true))
        // …or our blank is no longer in force.
        assertFalse(SleepProofPolicy.coverAfterRestore(SleepProofPolicy.OUTCOME_ON, true, held = false, blanked = false))
    }

    @Test
    fun `a panel that really went off is left alone`() {
        assertFalse(SleepProofPolicy.coverAfterRestore(SleepProofPolicy.OUTCOME_OFF, true, held = false, blanked = true))
        assertFalse(SleepProofPolicy.coverAfterRestore(SleepProofPolicy.OUTCOME_UNKNOWN, true, held = false, blanked = true))
    }

    // ─── the screensaver demotes the screen-timeout blank ────────────────

    @Test
    fun `a screensaver during OUR screen-timeout blank proves it cannot sleep the box`() {
        assertTrue(SleepProofPolicy.dreamProvesTimeoutCannotSleep(true, "screen-timeout", null))
        assertTrue(SleepProofPolicy.dreamProvesTimeoutCannotSleep(true, "software-dim", "screen-timeout"))
        // Not our blank, or not that mechanism: proves nothing.
        assertFalse(SleepProofPolicy.dreamProvesTimeoutCannotSleep(false, "screen-timeout", "screen-timeout"))
        assertFalse(SleepProofPolicy.dreamProvesTimeoutCannotSleep(true, "device-admin", "device-admin"))
    }

    @Test
    fun `the demotion needs evidence and lifts when the screensaver is switched off`() {
        assertFalse(SleepProofPolicy.timeoutBlankDeclined(0L, 1, 1))
        assertTrue(SleepProofPolicy.timeoutBlankDeclined(1L, 1, 1))
        // Unreadable settings keep the observation decisive.
        assertTrue(SleepProofPolicy.timeoutBlankDeclined(1L, null, null))
        assertFalse(SleepProofPolicy.timeoutBlankDeclined(1L, 0, 1))
        assertFalse(SleepProofPolicy.timeoutBlankDeclined(1L, 1, 0))
    }

    // ─── wiring ──────────────────────────────────────────────────────────

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

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private val sleepProof get() = read("src/main/java/com/educms/player/display/SleepProof.kt")
    private val registry get() = read("src/main/java/com/educms/player/display/DisplayControlRegistry.kt")
    private val standby get() = read("src/main/java/com/educms/player/standby/UserStandby.kt")
    private val timeout get() = read("src/main/java/com/educms/player/display/ScreenTimeoutBlankProvider.kt")

    @Test
    fun `the black cover checks the hold and never touches the window brightness`() {
        val body = Regex("private fun cover\\([\\s\\S]*?\\n    }").find(sleepProof)?.value
        Assume.assumeTrue("cover() not found", body != null)
        assertTrue(body!!.contains("DisplayEmergency.isHeld(app)"))
        assertTrue(body.contains("setBlackout(true)"))
        // A dimmed window would outlive the WAKE backstop, which restores the
        // overlay but not the window level.
        assertFalse(body.contains("setWindowBrightness"))
    }

    @Test
    fun `a screensaver during an alert is ended — raise direction only`() {
        val body = Regex("fun onDreamingStarted\\([\\s\\S]*?\\n    }").find(sleepProof)?.value
        Assume.assumeTrue("onDreamingStarted() not found", body != null)
        val held = body!!.indexOf("DisplayEmergency.isHeld(app)")
        val enforce = body.indexOf("DisplayEmergency.enforceNow(app)")
        val cover = body.indexOf("cover(app")
        assertTrue(held in 0 until enforce)
        // The held branch returns before anything that could darken.
        assertTrue(enforce < cover)
        assertTrue(body.substring(enforce, cover).contains("return"))
        // It never asks for, or changes, the hold's state.
        assertFalse(body.contains("setHold"))
    }

    @Test
    fun `the screensaver path puts the screen-off timeout back before demoting`() {
        val body = Regex("fun onDreamingStarted\\([\\s\\S]*?\\n    }").find(sleepProof)?.value!!
        assertTrue(body.indexOf("restoreTimeout(app)") in 0 until body.indexOf("DisplayControlRegistry.invalidate()"))
        // …and the provider restores any still-shortened timeout when it declines.
        assertTrue(timeout.contains("SleepProof.timeoutBlankDeclined(ctx) -> {"))
        assertTrue(timeout.contains("if (DisplayPrefs.priorScreenOffTimeoutMs(ctx) != null) restoreTimeout(ctx)"))
    }

    @Test
    fun `every successful native blank is checked, after the mirror is recorded`() {
        val record = registry.indexOf("if (result.ok) recordState(app, action)")
        val expect = registry.indexOf("SleepProof.expect(app, blankedVia)")
        assertTrue(record in 0 until expect)
    }

    @Test
    fun `a wake inside the settle window judges the blank first, and never covers`() {
        val wake = registry.indexOf("SleepProof.beforeWake(app)")
        val end = registry.indexOf("UserStandby.end(app, \"a WAKE command\")")
        assertTrue(wake in 0 until end)
        val body = Regex("fun beforeWake\\([\\s\\S]*?\\n    }").find(sleepProof)?.value
        Assume.assumeTrue("beforeWake() not found", body != null)
        assertFalse(body!!.contains("cover("))
    }

    @Test
    fun `the restore is checked, and the screen-saver broadcast is received`() {
        assertTrue(standby.contains("Intent.ACTION_DREAMING_STARTED -> runCatching"))
        assertTrue(standby.contains("addAction(Intent.ACTION_DREAMING_STARTED)"))
        val enter = standby.indexOf("enterRestored(app, interrupted.record)")
        val mark = standby.indexOf("SleepProof.markForRestore(")
        assertTrue(enter in 0 until mark)
    }

    @Test
    fun `a person's standby records how idle the box was — evidence only`() {
        val main = read("src/main/java/com/educms/player/MainActivity.kt")
        val interaction = Regex("override fun onUserInteraction\\(\\)[\\s\\S]*?\\n    }").find(main)?.value
        Assume.assumeTrue("onUserInteraction() not found", interaction != null)
        assertTrue(interaction!!.contains("lastInputAtElapsedMs = lastLocalInputAtMs"))
        val enter = Regex("private fun enter\\([\\s\\S]*?\\n    }").find(standby)?.value
        Assume.assumeTrue("enter() not found", enter != null)
        assertTrue(enter!!.contains(".putLong(KEY_LAST_OFF_IDLE_MS, idleMs)"))
        // Never read by any decision: only the report reads it.
        val decisions = standby.replace(enter, "")
        assertFalse(decisions.contains("getLong(KEY_LAST_OFF_IDLE_MS"))
        assertTrue(sleepProof.contains("UserStandby.KEY_LAST_OFF_IDLE_MS"))
    }

    @Test
    fun `the accessibility sleep tier sits after device admin and before the screen-off timeout`() {
        val chains = Regex(
            "DeviceAdminBlankProvider,\\s*AccessibilityLockProvider,\\s*ScreenTimeoutBlankProvider,\\s*SoftwareDimProvider",
        ).findAll(registry).count()
        assertEquals("both BLANK and WAKE chains", 2, chains)
    }
}
