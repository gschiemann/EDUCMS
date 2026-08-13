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
}
