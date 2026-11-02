package com.educms.player.display

import com.educms.player.display.VendorBacklightEngine.Call
import com.educms.player.display.VendorBacklightEngine.Connect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * THE EP6N WAKE LOOP (field, 2026-11-02, player 1.1.58) as a sequence test.
 *
 * On the Goodview RK3576 box the wake setter brings the panel back by
 * REBOOTING it. 1.1.58 wrote `blanked=false` after the provider returned,
 * asynchronously; the reboot came first, the new boot re-applied the OFF, and
 * each heartbeat power-on retry rebooted it again. These tests drive the same
 * steps the registry and `onWindowAttached` run — [PowerIntentPolicy] around
 * the real [VendorBacklightEngine] — over a box that reboots on a wake from
 * shallow-off, with a disk that keeps only what was committed.
 */
class PowerIntentSequenceTest {

    /** What survives a reboot: only committed writes. */
    private class Disk {
        var blanked = false
        var held = false
        var preHoldBlanked: Boolean? = null
        var wakeCommandDuringHold = false
    }

    private class Rebooted : RuntimeException("the box rebooted")

    /** An RK3576 box: the setter sets; a wake from OFF reboots it (it comes up ON). */
    private class Box : VendorBacklightEngine.Ports {
        var on = true
        var reboots = 0
        val sets = mutableListOf<Boolean>()
        override fun nowMs() = 0L
        override fun servicePackageInstalled() = true
        override fun connect(budgetMs: Long) = Connect.Ready
        override fun disconnect() = Unit
        override fun idempotentCommands() = true
        override fun send(requestJson: String, budgetMs: Long): Call = when (val op = RkSdkApiPolicy.opFor(requestJson)) {
            RkSdkApiPolicy.Op.Read -> Call.Reply(RkSdkApiPolicy.readReply(on))
            is RkSdkApiPolicy.Op.Set -> {
                sets += op.on
                if (op.on && !on) { on = true; reboots++; throw Rebooted() }
                on = op.on
                Call.Reply(RkSdkApiPolicy.setReply())
            }
            null -> Call.Failed("unmapped")
        }
        override fun submit(work: () -> Unit) = true.also { work() }
        override fun schedule(delayMs: Long, work: () -> Unit) = true
        override fun darkChanged(dark: Boolean) = Unit
        override fun seen() = Unit
        override fun log(level: VendorBacklightEngine.Level, message: String) = Unit
    }

    /** One process: the registry's steps around the engine. A reboot ends it mid-call. */
    private class Device(val disk: Disk, val box: Box) {
        var engine = VendorBacklightEngine(box).also { it.probe() }

        /** DisplayControlRegistry.apply, the parts that touch the intent. */
        fun apply(action: DisplayAction): Boolean {
            if (disk.held && action == DisplayAction.Blank) return false // the emergency gate
            val prior = disk.blanked
            disk.blanked = PowerIntentPolicy.beforeApply(action, prior) // commit() BEFORE the provider
            val ok = try {
                when (action) {
                    DisplayAction.Blank -> engine.blank() is VendorBacklightEngine.Step.Ok
                    DisplayAction.Wake -> engine.wake() is VendorBacklightEngine.Step.Ok
                    else -> true
                }
            } catch (r: Rebooted) {
                restart()
                return true
            }
            disk.blanked = PowerIntentPolicy.afterApply(action, ok, prior, disk.blanked)
            return ok
        }

        /** A new process: a fresh engine, then onWindowAttached. */
        fun restart() {
            engine = VendorBacklightEngine(box).also { it.probe() }
            when (PowerIntentPolicy.atWindowAttached(disk.held, disk.blanked)) {
                PowerIntentPolicy.Restore.ENFORCE_EMERGENCY -> enforce()
                PowerIntentPolicy.Restore.REBLANK -> apply(DisplayAction.Blank)
                PowerIntentPolicy.Restore.NOTHING -> Unit
            }
        }

        fun alert() {
            if (!disk.held) disk.preHoldBlanked = disk.blanked
            disk.held = true
            enforce()
        }

        private fun enforce() {
            apply(DisplayAction.Wake)
            disk.blanked = false
        }

        fun allClear() {
            disk.held = false
            val d = RestoreBlankAfterAlertPolicy.decide(
                preHoldBlanked = disk.preHoldBlanked,
                blankedNow = disk.blanked,
                hardScheduleDesiredOn = null,
                wakeCommandDuringAlert = disk.wakeCommandDuringHold,
                stillHeld = false,
            )
            disk.preHoldBlanked = null
            disk.wakeCommandDuringHold = false
            if (d == RestoreBlankAfterAlertPolicy.Decision.RESTORE_BLANK) apply(DisplayAction.Blank)
        }
    }

    private fun device() = Device(Disk(), Box())

    @Test
    fun `off, on, restart — stays on, and the wake's own reboot does not re-apply the off`() {
        val d = device()
        d.apply(DisplayAction.Blank)
        assertFalse(d.box.on)
        d.apply(DisplayAction.Wake) // reboots the box mid-call
        assertTrue(d.box.on)
        assertEquals(1, d.box.reboots)
        assertFalse(d.disk.blanked)
        d.restart()
        assertTrue(d.box.on)
        assertEquals(listOf(false, true), d.box.sets)
    }

    @Test
    fun `heartbeat power-on retries after the reboot never reboot the box again`() {
        val d = device()
        d.apply(DisplayAction.Blank)
        d.apply(DisplayAction.Wake)
        repeat(NativePowerOnRetries) { d.apply(DisplayAction.Wake) }
        assertEquals(1, d.box.reboots)
        assertTrue(d.box.on)
    }

    @Test
    fun `off, restart — stays off`() {
        val d = device()
        d.apply(DisplayAction.Blank)
        d.restart()
        assertFalse(d.box.on)
        assertTrue(d.disk.blanked)
    }

    @Test
    fun `alert during off wakes, survives the wake's reboot, and the all-clear puts the off back`() {
        val d = device()
        d.apply(DisplayAction.Blank)
        d.alert() // reboots; the hold is on disk, the new process enforces
        assertTrue(d.box.on)
        assertEquals(1, d.box.reboots)
        d.restart() // another process start under the hold: no second reboot
        assertTrue(d.box.on)
        assertEquals(1, d.box.reboots)
        d.allClear()
        assertFalse(d.box.on)
        assertTrue(d.disk.blanked)
    }

    @Test
    fun `a blank never lands under a held alert`() {
        val d = device()
        d.alert()
        assertFalse(d.apply(DisplayAction.Blank))
        assertTrue(d.box.on)
    }

    @Test
    fun `the 1_1_58 order (intent written after the provider) loops — the regression this closes`() {
        val disk = Disk()
        val box = Box()
        var engine = VendorBacklightEngine(box).also { it.probe() }
        engine.blank(); disk.blanked = true
        // three heartbeat attempts, each: wake → reboot → restore re-applies the OFF
        repeat(3) {
            try { engine.wake(); disk.blanked = false } catch (_: Rebooted) {
                engine = VendorBacklightEngine(box).also { it.probe() }
                if (disk.blanked) engine.blank()
            }
        }
        assertEquals(3, box.reboots)
        assertFalse(box.on)
    }

    @Test
    fun `the registry commits the intent before the provider, and the prefs write is synchronous`() {
        val roots = listOf(File("src/main"), File("app/src/main"))
        val root = roots.first { File(it, "AndroidManifest.xml").exists() }
        val registry = File(root, "java/com/educms/player/display/DisplayControlRegistry.kt").readText()
        val intent = registry.indexOf("PowerIntentPolicy.beforeApply(action, priorBlanked)")
        val dispatch = registry.indexOf("provider.apply(app, action)")
        assertTrue(intent in 1 until dispatch)
        val prefs = File(root, "java/com/educms/player/display/DisplayPrefs.kt").readText()
        assertTrue(prefs.contains("putBoolean(KEY_BLANKED, value).commit()"))
        val api = File(root, "java/com/educms/player/display/DisplayControlApi.kt").readText()
        assertTrue(api.contains("PowerIntentPolicy.atWindowAttached("))
    }

    private companion object {
        const val NativePowerOnRetries = 2
    }
}
