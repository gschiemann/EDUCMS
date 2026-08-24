package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The MIN_SAFE_BRIGHTNESS floor.
 *
 * A remote 0% on a screen bolted to a hallway wall is a truck roll. The
 * clamp lives in Kotlin — NOT in React — precisely because the value
 * arrives over a JS bridge that is reachable from every frame the
 * WebView loads. These tests are the proof that the floor holds no
 * matter what the caller sends.
 */
class BrightnessClampTest {

    @Test
    fun `remote zero is clamped up to the safe floor`() {
        assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, DisplayLimits.clampBrightness(0, allowBlack = false))
        assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, DisplayLimits.clampBrightness(1, allowBlack = false))
        assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, DisplayLimits.clampBrightness(4, allowBlack = false))
    }

    @Test
    fun `negative and absurd values are bounded, never extrapolated`() {
        assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, DisplayLimits.clampBrightness(-100, allowBlack = false))
        assertEquals(0, DisplayLimits.clampBrightness(-100, allowBlack = true))
        assertEquals(100, DisplayLimits.clampBrightness(9999, allowBlack = false))
        assertEquals(100, DisplayLimits.clampBrightness(Int.MAX_VALUE, allowBlack = true))
        assertEquals(0, DisplayLimits.clampBrightness(Int.MIN_VALUE, allowBlack = true))
    }

    @Test
    fun `values at or above the floor pass through untouched`() {
        (DisplayLimits.MIN_SAFE_BRIGHTNESS..100).forEach { pct ->
            assertEquals(pct, DisplayLimits.clampBrightness(pct, allowBlack = false))
        }
    }

    @Test
    fun `allowBlack is the ONLY way to reach zero`() {
        assertEquals(0, DisplayLimits.clampBrightness(0, allowBlack = true))
        assertEquals(3, DisplayLimits.clampBrightness(3, allowBlack = true))
        assertTrue(
            "without allowBlack nothing may land below the floor",
            (-500..500).none { DisplayLimits.clampBrightness(it, false) < DisplayLimits.MIN_SAFE_BRIGHTNESS },
        )
    }

    @Test
    fun `normalize applies the clamp to the action itself`() {
        val clamped = DisplayLimits.normalize(DisplayAction.SetBrightness(0)) as DisplayAction.SetBrightness
        assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, clamped.percent)

        val black = DisplayLimits.normalize(
            DisplayAction.SetBrightness(0, allowBlack = true),
        ) as DisplayAction.SetBrightness
        assertEquals(0, black.percent)

        val vol = DisplayLimits.normalize(DisplayAction.SetVolume(999)) as DisplayAction.SetVolume
        assertEquals(100, vol.percent)

        // Non-percent actions are untouched.
        assertEquals(DisplayAction.Blank, DisplayLimits.normalize(DisplayAction.Blank))
        assertEquals(DisplayAction.Reboot, DisplayLimits.normalize(DisplayAction.Reboot))
    }

    @Test
    fun `volume is bounded to 0-100`() {
        assertEquals(0, DisplayLimits.clampVolume(-1))
        assertEquals(0, DisplayLimits.clampVolume(Int.MIN_VALUE))
        assertEquals(100, DisplayLimits.clampVolume(101))
        assertEquals(37, DisplayLimits.clampVolume(37))
    }

    @Test
    fun `revert windows are bounded so a hostile caller cannot disable the dead-man switch`() {
        // 0 / negative would mean "revert immediately"; Long.MAX_VALUE
        // would mean "never revert", which is the interesting attack.
        assertEquals(DisplayLimits.MIN_REVERT_MS, DisplayLimits.clampRevertMs(0))
        assertEquals(DisplayLimits.MIN_REVERT_MS, DisplayLimits.clampRevertMs(-5000))
        assertEquals(DisplayLimits.MAX_REVERT_MS, DisplayLimits.clampRevertMs(Long.MAX_VALUE))
        assertEquals(DisplayLimits.MAX_REVERT_MS, DisplayLimits.clampRevertMs(86_400_000))
        assertEquals(30_000L, DisplayLimits.clampRevertMs(30_000))
    }

    @Test
    fun `each action reports the capability it needs a provider for`() {
        assertEquals(Capability.BRIGHTNESS, DisplayAction.SetBrightness(50).capability)
        assertEquals(Capability.VOLUME, DisplayAction.SetVolume(50).capability)
        assertEquals(Capability.BLANK, DisplayAction.Blank.capability)
        assertEquals(Capability.WAKE, DisplayAction.Wake.capability)
        assertEquals(Capability.REBOOT, DisplayAction.Reboot.capability)
    }

    // ─── Perceptual (gamma) brightness map — 2026-08-25 ─────────────
    // Field report: "i go down to 5% but it still seems brighter than
    // that to me". Linear duty was the cause; the map below is the fix.
    // These tests pin the CONTRACT (endpoints, monotonicity, floors,
    // and the low-end actually being LOW) without pinning every rounded
    // value to the current gamma constant.

    @Test
    fun `perceptual duty holds its endpoints exactly`() {
        assertEquals(0.0, DisplayLimits.perceptualBrightnessDuty(0), 0.0)
        assertEquals(1.0, DisplayLimits.perceptualBrightnessDuty(100), 0.0)
        // Out-of-range input is bounded, never extrapolated.
        assertEquals(0.0, DisplayLimits.perceptualBrightnessDuty(-50), 0.0)
        assertEquals(1.0, DisplayLimits.perceptualBrightnessDuty(9999), 0.0)
    }

    @Test
    fun `perceptual duty is strictly monotonic across the slider`() {
        var prev = -1.0
        (0..100).forEach { p ->
            val d = DisplayLimits.perceptualBrightnessDuty(p)
            assertTrue("duty($p)=$d must exceed duty(${p - 1})=$prev", d > prev)
            prev = d
        }
    }

    @Test
    fun `the bottom half of the slider is genuinely dim now`() {
        // The whole point of the change: 5% must be a LOT less than 5%
        // linear duty, and 50% must sit well under half duty.
        assertTrue(DisplayLimits.perceptualBrightnessDuty(5) < 0.01)
        assertTrue(DisplayLimits.perceptualBrightnessDuty(25) < 0.10)
        assertTrue(DisplayLimits.perceptualBrightnessDuty(50) < 0.30)
        // And the top end still reaches real brightness.
        assertTrue(DisplayLimits.perceptualBrightnessDuty(90) > 0.75)
    }

    @Test
    fun `perceptual scale holds endpoints and never rounds a live percent onto min`() {
        assertEquals(0, DisplayLimits.scaleBrightnessPerceptual(0, 0, 255))
        assertEquals(255, DisplayLimits.scaleBrightnessPerceptual(100, 0, 255))
        // 1%..99% must land strictly ABOVE min — the low end of the
        // slider stays distinguishable from "off" on every scale.
        (1..99).forEach { p ->
            assertTrue(
                "$p% must be > min on a 0..255 scale",
                DisplayLimits.scaleBrightnessPerceptual(p, 0, 255) > 0,
            )
        }
        // Degenerate scale collapses to min, exactly like scale().
        assertEquals(7, DisplayLimits.scaleBrightnessPerceptual(50, 7, 7))
        assertEquals(7, DisplayLimits.scaleBrightnessPerceptual(50, 7, 3))
    }

    @Test
    fun `perceptual scale is monotonic non-decreasing on a real backlight range`() {
        var prev = -1
        (0..100).forEach { p ->
            val v = DisplayLimits.scaleBrightnessPerceptual(p, 0, 255)
            assertTrue("scale($p)=$v must be >= scale(${p - 1})=$prev", v >= prev)
            prev = v
        }
    }

    @Test
    fun `perceptual scale sits at or below the old linear map everywhere`() {
        // Gamma > 1 can only DARKEN a given percent relative to linear —
        // if this ever fails the curve inverted and "50%" got brighter,
        // which is the one direction operators did not ask for.
        (0..100).forEach { p ->
            assertTrue(
                "perceptual($p) must not exceed linear($p)",
                DisplayLimits.scaleBrightnessPerceptual(p, 0, 255) <= DisplayLimits.scale(p, 0, 255),
            )
        }
    }
}
