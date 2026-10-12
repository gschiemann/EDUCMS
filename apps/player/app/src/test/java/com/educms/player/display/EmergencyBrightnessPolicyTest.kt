package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE ALERT'S HARDWARE BRIGHTNESS WRITE WAITS FOR A SETTLED PANEL
 * (2026-10-12, the L55VEC reboot ≈13 s after an emergency wake from
 * device-admin lockNow()). Rules on a virtual clock, then the wiring as
 * source facts.
 */
class EmergencyBrightnessPolicyTest {

    private val settle = EmergencyBrightnessPolicy.SETTLE_MS

    /**
     * Drive the policy the way EmergencyBrightness's tick does: observe the
     * power state, fold it into "interactive since", ask for timing — until it
     * says Ready or Drop. Returns the virtual time of the verdict.
     */
    private fun run(
        requestedAt: Long,
        lastWakeAt: Long?,
        interactiveAt: (Long) -> Boolean?,
        held: (Long) -> Boolean = { true },
        startSince: Long? = null,
    ): Pair<Long, EmergencyBrightnessPolicy.Timing> {
        var now = requestedAt
        var since = startSince
        repeat(10_000) {
            val i = interactiveAt(now)
            since = EmergencyBrightnessPolicy.trackInteractive(since, i, now)
            val t = EmergencyBrightnessPolicy.timing(
                EmergencyBrightnessPolicy.Facts(now, requestedAt, held(now), i, since, lastWakeAt),
            )
            when (t) {
                is EmergencyBrightnessPolicy.Timing.Wait -> now += t.ms
                else -> return now to t
            }
        }
        error("never settled")
    }

    @Test
    fun `the field case - an alert wakes a lockNow-slept panel - the write waits until it has been on for the settle window`() {
        // t=0: the native raise pokes a dark panel; it reports interactive at
        // t=1200 (the L55VEC's wake landed ~2 s after the raise).
        val (at, verdict) = run(requestedAt = 0L, lastWakeAt = 0L, interactiveAt = { it >= 1_200L })
        assertEquals(EmergencyBrightnessPolicy.Timing.Ready, verdict)
        assertTrue("never inside the settle window (wrote at $at)", at >= 1_200L + settle)
        assertTrue("but not much later either (wrote at $at)", at <= 1_200L + settle + EmergencyBrightnessPolicy.TICK_MS)
    }

    @Test
    fun `never writes while the panel is not interactive, however long it has been`() {
        val (at, verdict) = run(requestedAt = 0L, lastWakeAt = 0L, interactiveAt = { false })
        assertTrue(verdict is EmergencyBrightnessPolicy.Timing.Drop)
        assertTrue(at >= EmergencyBrightnessPolicy.GIVE_UP_MS)
    }

    @Test
    fun `an unknown power state is not interactive`() {
        val t = EmergencyBrightnessPolicy.timing(EmergencyBrightnessPolicy.Facts(50_000L, 0L, true, null, 1L, null))
        assertTrue(t is EmergencyBrightnessPolicy.Timing.Wait)
    }

    @Test
    fun `a flicker off restarts the settle window`() {
        // On at 1000, off at 3000-3499, on again from 3500.
        val (at, verdict) = run(
            requestedAt = 0L,
            lastWakeAt = 0L,
            interactiveAt = { it in 1_000L until 3_000L || it >= 3_500L },
        )
        assertEquals(EmergencyBrightnessPolicy.Timing.Ready, verdict)
        assertTrue("settle restarts at 3500 (wrote at $at)", at >= 3_500L + settle)
    }

    @Test
    fun `a panel that has been on for a long time is written after one settle of observation, never before`() {
        // Process start / a re-raise on an awake panel: no wake known, first
        // observation of interactive is the request itself.
        val (at, verdict) = run(requestedAt = 100_000L, lastWakeAt = null, interactiveAt = { true })
        assertEquals(EmergencyBrightnessPolicy.Timing.Ready, verdict)
        assertEquals(100_000L + settle, at)
    }

    @Test
    fun `an already-settled panel with a known long interactive stretch is written at once`() {
        val t = EmergencyBrightnessPolicy.timing(
            EmergencyBrightnessPolicy.Facts(nowMs = 100_000L, requestedAtMs = 100_000L, held = true, interactive = true, interactiveSinceMs = 10_000L, lastWakeAtMs = 10_000L),
        )
        assertEquals(EmergencyBrightnessPolicy.Timing.Ready, t)
    }

    @Test
    fun `a recent wake holds the write even when interactivity was seen earlier`() {
        val t = EmergencyBrightnessPolicy.timing(
            EmergencyBrightnessPolicy.Facts(nowMs = 20_000L, requestedAtMs = 20_000L, held = true, interactive = true, interactiveSinceMs = 1_000L, lastWakeAtMs = 18_000L),
        )
        assertTrue(t is EmergencyBrightnessPolicy.Timing.Wait)
        // Waits in observable ticks, never one jump across the window.
        assertEquals(EmergencyBrightnessPolicy.TICK_MS, (t as EmergencyBrightnessPolicy.Timing.Wait).ms)
        val nearlyDone = EmergencyBrightnessPolicy.timing(
            EmergencyBrightnessPolicy.Facts(nowMs = 22_900L, requestedAtMs = 20_000L, held = true, interactive = true, interactiveSinceMs = 1_000L, lastWakeAtMs = 18_000L),
        )
        assertEquals(100L, (nearlyDone as EmergencyBrightnessPolicy.Timing.Wait).ms)
    }

    @Test
    fun `a released hold drops the request - the release path restores the operator's level`() {
        val (_, verdict) = run(requestedAt = 0L, lastWakeAt = 0L, interactiveAt = { true }, held = { it < 2_000L })
        assertTrue(verdict is EmergencyBrightnessPolicy.Timing.Drop)
    }

    @Test
    fun `skip only when the node PROVABLY reads at the target`() {
        assertEquals(EmergencyBrightnessPolicy.Write.SkipAlreadyAtTarget, EmergencyBrightnessPolicy.afterRead(255, 255))
        assertEquals(EmergencyBrightnessPolicy.Write.SkipAlreadyAtTarget, EmergencyBrightnessPolicy.afterRead(4095, 255))
        assertEquals(EmergencyBrightnessPolicy.Write.Now, EmergencyBrightnessPolicy.afterRead(100, 255))
        assertEquals(EmergencyBrightnessPolicy.Write.Now, EmergencyBrightnessPolicy.afterRead(null, 255))
        assertEquals(EmergencyBrightnessPolicy.Write.Now, EmergencyBrightnessPolicy.afterRead(255, null))
    }

    @Test
    fun `only the software floor is immediate`() {
        assertFalse(EmergencyBrightnessPolicy.providerDefers("software-dim"))
        assertFalse(EmergencyBrightnessPolicy.providerDefers(null))
        assertTrue(EmergencyBrightnessPolicy.providerDefers("sysfs-backlight"))
        assertTrue(EmergencyBrightnessPolicy.providerDefers("settings-brightness"))
        assertTrue(EmergencyBrightnessPolicy.providerDefers("vendor-recipe"))
        assertEquals(SoftwareDimProvider.id, EmergencyBrightnessPolicy.SOFTWARE_PROVIDER_ID)
    }

    @Test
    fun `trackInteractive keeps the first observation and breaks on off or unknown`() {
        assertEquals(5L, EmergencyBrightnessPolicy.trackInteractive(5L, true, 9L))
        assertEquals(9L, EmergencyBrightnessPolicy.trackInteractive(null, true, 9L))
        assertNull(EmergencyBrightnessPolicy.trackInteractive(5L, false, 9L))
        assertNull(EmergencyBrightnessPolicy.trackInteractive(5L, null, 9L))
    }

    @Test
    fun `step markers - loud enforces always, quiet ones only near a wake`() {
        assertTrue(EmergencyBrightnessPolicy.logSteps(quiet = false, sinceWakeMs = null))
        assertTrue(EmergencyBrightnessPolicy.logSteps(quiet = true, sinceWakeMs = 3_000L))
        assertFalse(EmergencyBrightnessPolicy.logSteps(quiet = true, sinceWakeMs = null))
        assertFalse(EmergencyBrightnessPolicy.logSteps(quiet = true, sinceWakeMs = EmergencyBrightnessPolicy.STEP_LOG_WINDOW_MS))
    }

    // ─── the wiring, as source facts ─────────────────────────────────

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

    private fun code(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("(?m)//.*$"), "")
    }

    private fun enforceBody(): String {
        val src = code("src/main/java/com/educms/player/display/DisplayEmergency.kt")
        val at = src.indexOf("fun enforceNow(")
        assertTrue(at >= 0)
        val end = src.indexOf("fun enforceIfHeld(", at)
        return src.substring(at, end)
    }

    @Test
    fun `enforceNow still makes the alert visible at once - blackout off, window brightness 1, keep-screen-on, wake`() {
        val b = enforceBody()
        assertTrue(b.contains("h.setBlackout(false)"))
        assertTrue(b.contains("h.setWindowBrightness(1f)"))
        assertTrue(b.contains("h.setKeepScreenOn(true)"))
        assertTrue(b.contains("h.requestWake()"))
        assertTrue(b.contains("ScreenWakeLock.pokeScreen(app)"))
        assertTrue(b.contains("DisplayAction.Wake"))
    }

    @Test
    fun `enforceNow writes hardware brightness only through the settle gate, and moves the mirror to full at once`() {
        val b = enforceBody()
        val immediate = b.indexOf("DisplayAction.SetBrightness(EMERGENCY_BRIGHTNESS)")
        assertTrue(immediate >= 0)
        assertTrue(
            "the immediate SetBrightness must be inside the software-floor branch",
            b.lastIndexOf("if (!deferHardware)", immediate) in 0 until immediate,
        )
        assertTrue(b.contains("EmergencyBrightness.request(app"))
        assertTrue(b.contains("DisplayPrefs.setBrightnessPercent(app, EMERGENCY_BRIGHTNESS)"))
    }

    @Test
    fun `the deferred write goes through the registry - the gate and the audit are not bypassed`() {
        val src = code("src/main/java/com/educms/player/display/EmergencyBrightness.kt")
        assertTrue(src.contains("DisplayControlRegistry.apply(app, DisplayAction.SetBrightness(TARGET_PERCENT)"))
        assertFalse("never a direct sysfs write", src.contains("writeText("))
        val write = src.indexOf("\"hw-brightness-write\"")
        val apply = src.indexOf("DisplayControlRegistry.apply(")
        assertTrue("the durable marker precedes the write", write in 0 until apply)
        assertTrue(src.contains("HandlerThread("))
    }

    @Test
    fun `screen on and off feed the settle clock`() {
        val src = code("src/main/java/com/educms/player/standby/UserStandby.kt")
        assertTrue(src.contains("EmergencyBrightness.noteScreenOn()"))
        assertTrue(src.contains("EmergencyBrightness.noteScreenOff()"))
    }
}
