package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️ P1 (2026-08-13) — MIN_SAFE_BRIGHTNESS WAS BYPASSABLE BY A RECIPE.
 *
 * `DisplayLimits.MIN_SAFE_BRIGHTNESS` is the rule that stops a remote
 * request from taking a wall-mounted screen to black. It clamps the
 * PERCENT — so a vendor recipe step that ignores the percent walks
 * straight past it:
 *
 *   * `{kind:"sysfs", path:".../bl_power", value:"4"}` — FB_BLANK_
 *     POWERDOWN, a genuine vendor pattern. The percent is discarded, so
 *     EVERY SetBrightness including SetBrightness(100) powers the
 *     backlight off. Worse, the dead-man revert emits
 *     SetBrightness(prior, allowBlack=true), which routes through the
 *     same step and writes "4" again — the guard actively re-applies
 *     the failure, so the panel is unrecoverable.
 *   * the same shape for `kind:"broadcast"` with all-literal extras
 *     (`state=0` on a vendor SET_POWER action).
 *   * a percent-driven step could ALSO reach zero: on `scale:[0,9]`,
 *     the MIN_SAFE 5% maps to `round(9 * 0.05)` = `round(0.45)` = 0.
 *
 * `VendorRecipe.kt`'s own header declares the recipe UNTRUSTED INPUT and
 * the allowlist the security boundary of the whole feature, so "the
 * operator configured it" is not an answer under the stated threat
 * model.
 */
class BrightnessFloorBypassTest {

    private fun brightness(step: RecipeStep) =
        RecipeValidator.validate(VendorRecipe("v", RecipeMatch(), brightness = step))

    private fun blank(step: RecipeStep) =
        RecipeValidator.validate(VendorRecipe("v", RecipeMatch(), blank = step))

    private val goodPath = "/sys/class/backlight/panel0/brightness"

    // ─── literals are banned on a BRIGHTNESS step ────────────────────

    @Test
    fun `a literal-valued sysfs brightness step is rejected`() {
        val step = RecipeStep.Sysfs(
            path = "/sys/class/backlight/panel0/bl_power",
            literal = "4",              // FB_BLANK_POWERDOWN
            fromPercent = false,
            scale = null,
        )
        val check = brightness(step)
        assertFalse("a literal brightness step bypasses the MIN_SAFE floor", check.valid)
        assertTrue(
            (check as RecipeCheck.Rejected).reason.contains("percent-derived"),
        )
    }

    @Test
    fun `the same literal step is still fine for BLANK`() {
        // Blank is SUPPOSED to reach the extreme — that is what it means.
        // The rule is capability-scoped, not a blanket ban on literals.
        val step = RecipeStep.Sysfs(
            path = "/sys/class/backlight/panel0/bl_power",
            literal = "4",
            fromPercent = false,
            scale = null,
        )
        assertTrue(blank(step).valid)
    }

    @Test
    fun `an all-literal broadcast brightness step is rejected`() {
        val step = RecipeStep.Broadcast(
            action = "com.gv.display.SET_POWER",
            extras = listOf(
                RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, literal = "0"),
            ),
        )
        val check = brightness(step)
        assertFalse(check.valid)
        assertTrue((check as RecipeCheck.Rejected).reason.contains("percent-derived"))
    }

    @Test
    fun `a percent-driven broadcast brightness step is accepted, literals alongside are fine`() {
        // A constant channel id next to a percent value is legitimate.
        val step = RecipeStep.Broadcast(
            action = "com.gv.display.SET_BRIGHTNESS",
            extras = listOf(
                RecipeExtra("channel", RecipeExtraType.INT, RecipeValueSource.LITERAL, literal = "0"),
                RecipeExtra(
                    "level",
                    RecipeExtraType.INT,
                    RecipeValueSource.PERCENT,
                    scale = RecipeScale(0, 255),
                ),
            ),
        )
        assertTrue(brightness(step).valid)
    }

    @Test
    fun `a percent-driven sysfs brightness step is accepted`() {
        val step = RecipeStep.Sysfs(goodPath, literal = null, fromPercent = true, scale = RecipeScale(0, 255))
        assertTrue(brightness(step).valid)
    }

    // ─── the scale-span rule ─────────────────────────────────────────

    @Test
    fun `a scale too narrow for the MIN_SAFE floor to survive rounding is rejected`() {
        // scale(5, 0, 9) = 0 + round(9 * 0.05) = round(0.45) = 0.
        // The floor exists precisely so a remote request cannot produce
        // a 0 on a real backlight.
        assertEquals(
            "the arithmetic this rule exists for",
            0,
            DisplayLimits.scale(DisplayLimits.MIN_SAFE_BRIGHTNESS, 0, 9),
        )
        val step = RecipeStep.Sysfs(goodPath, literal = null, fromPercent = true, scale = RecipeScale(0, 9))
        val check = brightness(step)
        assertFalse(check.valid)
        assertTrue((check as RecipeCheck.Rejected).reason.contains("too narrow"))
    }

    @Test
    fun `the narrowest accepted scale still keeps the floor off the minimum`() {
        val span = RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN
        assertTrue(
            "a span of $span must map MIN_SAFE above the scale minimum",
            DisplayLimits.scale(DisplayLimits.MIN_SAFE_BRIGHTNESS, 0, span) > 0,
        )
        val step = RecipeStep.Sysfs(goodPath, literal = null, fromPercent = true, scale = RecipeScale(0, span))
        assertTrue(brightness(step).valid)
    }

    @Test
    fun `a narrow scale is still fine for a blank step`() {
        val step = RecipeStep.Sysfs(
            "/sys/class/backlight/panel0/bl_power",
            literal = null,
            fromPercent = true,
            scale = RecipeScale(0, 4),
        )
        assertTrue(blank(step).valid)
    }

    @Test
    fun `a narrow percent extra on a brightness broadcast is rejected`() {
        val step = RecipeStep.Broadcast(
            action = "com.gv.display.SET_BRIGHTNESS",
            extras = listOf(
                RecipeExtra("level", RecipeExtraType.INT, RecipeValueSource.PERCENT, scale = RecipeScale(0, 9)),
            ),
        )
        assertFalse(brightness(step).valid)
    }

    // ─── the point-of-use re-check carries the capability ────────────

    @Test
    fun `the execution-time re-check is capability-aware, or the gate is decorative`() {
        // VendorRecipeProvider re-validates every step immediately before
        // executing it, so a blob persisted by an OLDER build with weaker
        // rules cannot be honoured. That re-check MUST pass the
        // capability — without it, the literal-brightness rule exists
        // only at parse time and a stale prefs blob walks straight
        // through it.
        val literalStep = RecipeStep.Sysfs(
            path = "/sys/class/backlight/panel0/bl_power",
            literal = "4",
            fromPercent = false,
            scale = null,
        )
        assertNull(
            "shape-only validation cannot see the problem",
            RecipeValidator.validateStep(literalStep),
        )
        assertNotNull(
            "capability-aware validation must reject it",
            RecipeValidator.validateStep(literalStep, Capability.BRIGHTNESS),
        )
        assertNull(
            "…and must still allow it for blank",
            RecipeValidator.validateStep(literalStep, Capability.BLANK),
        )
    }

    // ─── the executor floor (defence in depth) ───────────────────────

    @Test
    fun `the MIN_SAFE percent never maps onto the scale minimum on an accepted scale`() {
        // Every scale that survives validation must keep the clamped
        // floor strictly above the minimum — the value that on many
        // panels means OFF rather than "very dim".
        listOf(
            RecipeScale(0, 255),
            RecipeScale(0, 100),
            RecipeScale(1, 255),
            RecipeScale(0, RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN),
            RecipeScale(10, 30),
        ).forEach { scale ->
            val clamped = DisplayLimits.clampBrightness(0, allowBlack = false)
            assertEquals(DisplayLimits.MIN_SAFE_BRIGHTNESS, clamped)
            assertTrue(
                "scale $scale must map $clamped% above ${scale.min}",
                DisplayLimits.scale(clamped, scale.min, scale.max) > scale.min,
            )
        }
    }

    @Test
    fun `allowBlack is the only way a recipe percent can reach the scale minimum`() {
        // The percent clamp is what the executor's floor backs up: with
        // allowBlack the request is permitted to reach 0 (an operator's
        // deliberate "turn this poster off overnight"), without it the
        // clamp lifts it to MIN_SAFE first.
        assertEquals(0, DisplayLimits.clampBrightness(0, allowBlack = true))
        assertEquals(
            DisplayLimits.MIN_SAFE_BRIGHTNESS,
            DisplayLimits.clampBrightness(0, allowBlack = false),
        )
    }
}
