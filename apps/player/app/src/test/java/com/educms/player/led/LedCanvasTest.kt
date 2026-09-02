package com.educms.player.led

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The native LED canvas rule, held to the WEB rule it mirrors
 * (apps/web/src/app/player/posterCanvas.ts). Every case below has a twin
 * in posterCanvas's own tests; if one moves, both move.
 */
class LedCanvasTest {

    // ── detection ────────────────────────────────────────────────────

    @Test
    fun `rockchip reference board names are the poster class`() {
        assertTrue(LedCanvas.isPosterClass("rk356x_box"))
        assertTrue(LedCanvas.isPosterClass("RK3568"))
        assertTrue(LedCanvas.isPosterClass(null, "rk356x_box", null))
    }

    @Test
    fun `an explicit vendor marker still counts`() {
        assertTrue(LedCanvas.isPosterClass("NovaStar TB60"))
        assertTrue(LedCanvas.isPosterClass("Taurus"))
        assertTrue(LedCanvas.isPosterClass("nova-star"))
    }

    @Test
    fun `every other box in the fleet is not poster class`() {
        assertFalse(LedCanvas.isPosterClass("Goodview LCD", "gv43", "android"))
        assertFalse(LedCanvas.isPosterClass("Raspberry Pi 4"))
        assertFalse(LedCanvas.isPosterClass("TC22", "sm8250", "Qualcomm"))
        assertFalse(LedCanvas.isPosterClass(null, null, ""))
    }

    // ── the derivation ───────────────────────────────────────────────

    @Test
    fun `a non-poster device gets no canvas — the OS resolution governs`() {
        assertNull(LedCanvas.derive(posterClass = false, osW = 1920, osH = 1080))
    }

    @Test
    fun `an explicit canvas always wins`() {
        val c = LedCanvas.derive(
            posterClass = true,
            osW = 1920,
            osH = 1080,
            explicitW = 640,
            explicitH = 1920,
        )!!
        assertEquals(640, c.w)
        assertEquals(1920, c.h)
        assertEquals(LedCanvas.Source.EXPLICIT, c.source)
    }

    @Test
    fun `a factory 1920 poster is a SINGLE panel, never a six-panel chain`() {
        val c = LedCanvas.derive(posterClass = true, osW = 1920, osH = 1080)!!
        assertEquals(320, c.w)
        assertEquals(1080, c.h)
        assertEquals(LedCanvas.Source.STANDARD, c.source)
        assertEquals(1, c.panels)
    }

    @Test
    fun `3840 is the other factory width and is also a single panel`() {
        val c = LedCanvas.derive(posterClass = true, osW = 3840, osH = 2160)!!
        assertEquals(320, c.w)
        assertEquals(LedCanvas.Source.STANDARD, c.source)
    }

    @Test
    fun `a clean multiple the operator set in ViPlex is a chain`() {
        val two = LedCanvas.derive(posterClass = true, osW = 640, osH = 1080)!!
        assertEquals(640, two.w)
        assertEquals(1080, two.h)
        assertEquals(LedCanvas.Source.CHAIN, two.source)
        assertEquals(2, two.panels)

        val five = LedCanvas.derive(posterClass = true, osW = 1600, osH = 1080)!!
        assertEquals(5, five.panels)
    }

    @Test
    fun `more than six panels is not a chain we offer`() {
        // 7 x 320 = 2240
        val c = LedCanvas.derive(posterClass = true, osW = 2240, osH = 1080)!!
        assertEquals(LedCanvas.Source.STANDARD, c.source)
        assertEquals(320, c.w)
    }

    @Test
    fun `the controller's 600px floor falls back to the standard`() {
        val c = LedCanvas.derive(posterClass = true, osW = 600, osH = 1080)!!
        assertEquals(320, c.w)
        assertEquals(LedCanvas.Source.STANDARD, c.source)
    }

    @Test
    fun `a tenant standard of another pitch is honoured, chain included`() {
        val single = LedCanvas.derive(
            posterClass = true,
            osW = 1920,
            osH = 1080,
            standardW = 360,
            standardH = 1200,
        )!!
        assertEquals(360, single.w)
        assertEquals(1200, single.h)

        val chain = LedCanvas.derive(
            posterClass = true,
            osW = 720,
            osH = 1080,
            standardW = 360,
            standardH = 1200,
        )!!
        assertEquals(720, chain.w)
        assertEquals(1200, chain.h)
        assertEquals(2, chain.panels)
    }

    @Test
    fun `a nonsense standard falls back to the fleet default`() {
        assertEquals(Pair(320, 1080), LedCanvas.normalizeStandard(null, null))
        assertEquals(Pair(320, 1080), LedCanvas.normalizeStandard(0, 0))
        assertEquals(Pair(320, 1080), LedCanvas.normalizeStandard(9, 9))
        assertEquals(Pair(320, 1080), LedCanvas.normalizeStandard(99999, 99999))
        assertEquals(Pair(360, 1200), LedCanvas.normalizeStandard(360, 1200))
    }

    // ── the native no-op guarantee ───────────────────────────────────

    @Test
    fun `nativeCanvas is a NO-OP on every non-poster device`() {
        // The whole 1.1.14 wave rides on this: an LCD, a Pi, a Goodview
        // panel and a TC22 must render byte-identically to 1.1.13.
        assertNull(LedCanvas.nativeCanvas(posterClass = false, osW = 1920, osH = 1080))
        assertNull(LedCanvas.nativeCanvas(posterClass = false, osW = 3840, osH = 2160))
        assertNull(LedCanvas.nativeCanvas(posterClass = false, osW = 1080, osH = 1920))
    }

    @Test
    fun `nativeCanvas ignores an explicit canvas on a non-poster device`() {
        // Deliberately STRICTER than the web rule: an explicit LED canvas is
        // an LED concept, and must never shrink an LCD's install gate to a
        // column because a stale value was left in prefs.
        assertNull(
            LedCanvas.nativeCanvas(
                posterClass = false,
                osW = 1920,
                osH = 1080,
                explicitW = 320,
                explicitH = 1080,
            ),
        )
    }

    @Test
    fun `nativeCanvas matches derive on a poster`() {
        val a = LedCanvas.nativeCanvas(posterClass = true, osW = 1920, osH = 1080)
        val b = LedCanvas.derive(posterClass = true, osW = 1920, osH = 1080)
        assertEquals(b, a)
    }

    // ── the pinned height ────────────────────────────────────────────

    @Test
    fun `a pinned surface is never taller than the window it lives in`() {
        // Emulator / a ROM that keeps a nav bar: window shorter than the LED.
        assertEquals(774, LedCanvas.pinnedHeight(canvasH = 1080, windowH = 774))
        // The field shape: they agree.
        assertEquals(1080, LedCanvas.pinnedHeight(canvasH = 1080, windowH = 1080))
        // A window taller than the LED still gets the LED's height — the
        // glass only shows the top of it.
        assertEquals(1080, LedCanvas.pinnedHeight(canvasH = 1080, windowH = 1920))
        // Nothing measured yet: fall back to the canvas rather than 0.
        assertEquals(1080, LedCanvas.pinnedHeight(canvasH = 1080, windowH = 0))
    }

    // ── the narrow-column scale ──────────────────────────────────────

    @Test
    fun `narrowScale never grows type and shrinks a 320 column`() {
        assertEquals(1f, LedCanvas.narrowScale(1920), 0.0001f)
        assertEquals(1f, LedCanvas.narrowScale(720), 0.0001f)
        assertEquals(1f, LedCanvas.narrowScale(0), 0.0001f)
        assertEquals(320f / 720f, LedCanvas.narrowScale(320), 0.0001f)
        assertTrue(LedCanvas.narrowScale(320) < 1f)
    }
}
