package com.educms.player.led

/**
 * THE NATIVE LED CANVAS RULE (2026-09-02, player 1.1.14).
 *
 * ============================================================
 * THE PROBLEM THIS EXISTS FOR
 * ============================================================
 *
 * A NovaStar TB LED poster (Rockchip rk356x_box, Android 11, Chromium 83)
 * runs an Android OS canvas of 1920×1080 — the controller's frame buffer —
 * while the physical LED shows ONLY the TOP-LEFT column of it, point to
 * point. The fleet standard module is 320×1080 (1.86 mm pitch); other
 * pitches are ~360×1200, and a 2–6 panel chain is N × the standard width.
 * Nothing on the controller can report the LED size to the app.
 *
 * The WEB player already solves this for everything the page draws
 * (apps/web/src/app/player/layout.tsx's pin script + posterCanvas.ts).
 * Every NATIVE surface did not: the companion-install gate, the setup
 * ceremony card, the boot diagnostic screen and the reconnect overlay are
 * laid out CENTRED in a 1920-wide window, i.e. around x≈960 — a metre off
 * the right-hand edge of the LED. On a fresh install of 1.1.13 on "LED
 * Poster 3" the glass stayed black while a button waited off-screen.
 *
 * ============================================================
 * THE RULE (a mirror of posterCanvas.ts)
 * ============================================================
 *
 *   1. An explicit canvas (dashboard LED canvas / on-device resize) always
 *      wins. This module does not source it — the caller passes it.
 *   2. Not a poster-class box → null: the OS resolution governs, exactly as
 *      it always has for every LCD and every other player. NOTHING about a
 *      non-poster device changes in this wave.
 *   3. Poster class, OS width a clean multiple of the standard width,
 *      larger than it, ≤ 6 panels, and NOT a factory width → a chain:
 *      { osWidth × standard height }. The operator set that width in
 *      ViPlex Express on purpose.
 *   4. Poster class, anything else (600 = the controller's floor, 1920 =
 *      the factory default, or an unrelated width) → a single poster at
 *      the standard size.
 *
 * Pure Kotlin on purpose — no android.* imports, so it is JVM-testable the
 * way DisplayScheduleMath is. Anything needing a Context lives in
 * [LedCanvasHost].
 */
object LedCanvas {

    /** The fleet standard: a 1.86 mm single-panel poster. */
    const val DEFAULT_STANDARD_W = 320
    const val DEFAULT_STANDARD_H = 1080

    /** The widest chain the dashboard offers (6 panels). */
    const val MAX_PANELS = 6

    /**
     * OS widths a controller ships with. A fresh box at 1920×1080 is a
     * SINGLE poster until someone says otherwise — 6 × 320 = 1920 is the one
     * ambiguous width, and defaulting it to a 6-panel chain would cut every
     * new poster's layout to a sixth of the glass.
     */
    val FACTORY_OS_WIDTHS: Set<Int> = setOf(1920, 3840)

    /** Sanity bounds shared by the standard and the explicit canvas. */
    private const val MIN_EDGE = 32
    private const val MAX_EDGE = 8192

    enum class Source { EXPLICIT, CHAIN, STANDARD }

    data class Canvas(val w: Int, val h: Int, val source: Source, val panels: Int)

    /**
     * True for the NovaStar TB poster class. NovaStar leaves the Rockchip
     * reference strings in place and ships no "Taurus"/"NovaStar" marker on
     * most firmware, so the Rockchip board names are the load-bearing part —
     * this mirrors `isPosterClassUserAgent` in posterCanvas.ts and the
     * server-side apps/api/src/screens/hardware-detect.ts.
     *
     * Callers pass Build.MODEL / Build.DEVICE / Build.PRODUCT /
     * Build.HARDWARE / Build.MANUFACTURER; any one matching is enough.
     */
    fun isPosterClass(vararg buildStrings: String?): Boolean {
        for (raw in buildStrings) {
            val s = (raw ?: "").lowercase()
            if (s.isEmpty()) continue
            if (s.contains("rk356x_box") ||
                s.contains("rk3568") ||
                s.contains("taurus") ||
                s.contains("novastar") ||
                s.contains("nova-star")
            ) {
                return true
            }
        }
        return false
    }

    /** Normalize a candidate standard: sane positive integers, else the default. */
    fun normalizeStandard(w: Int?, h: Int?): Pair<Int, Int> {
        if (w != null && h != null &&
            w in MIN_EDGE..MAX_EDGE && h in MIN_EDGE..MAX_EDGE
        ) {
            return Pair(w, h)
        }
        return Pair(DEFAULT_STANDARD_W, DEFAULT_STANDARD_H)
    }

    /**
     * The web-identical derivation. Explicit first, then poster class.
     * Returns null when the OS resolution should govern.
     */
    @Suppress("UNUSED_PARAMETER") // osH: see the note at the end of the body.
    fun derive(
        posterClass: Boolean,
        osW: Int?,
        osH: Int?,
        explicitW: Int? = null,
        explicitH: Int? = null,
        standardW: Int? = null,
        standardH: Int? = null,
    ): Canvas? {
        if (explicitW != null && explicitH != null && explicitW > 0 && explicitH > 0) {
            return Canvas(explicitW, explicitH, Source.EXPLICIT, 0)
        }
        if (!posterClass) return null
        val (stdW, stdH) = normalizeStandard(standardW, standardH)
        if (osW != null &&
            osW > stdW &&
            osW % stdW == 0 &&
            osW / stdW <= MAX_PANELS &&
            !FACTORY_OS_WIDTHS.contains(osW)
        ) {
            return Canvas(osW, stdH, Source.CHAIN, osW / stdW)
        }
        // osH is deliberately unused: the LED's height is the module's, not
        // the frame buffer's. Kept in the signature so a caller reads the
        // same shape the web rule takes.
        return Canvas(stdW, stdH, Source.STANDARD, 1)
    }

    /**
     * What the NATIVE surfaces use. The one deliberate difference from
     * [derive]: a non-poster device is answered null BEFORE the explicit
     * canvas is consulted, so this wave is a provable no-op on every LCD,
     * Pi, Goodview and generic Android box in the fleet — an explicit LED
     * canvas is an LED concept and must never shrink a normal display's
     * install gate.
     */
    fun nativeCanvas(
        posterClass: Boolean,
        osW: Int?,
        osH: Int?,
        explicitW: Int? = null,
        explicitH: Int? = null,
        standardW: Int? = null,
        standardH: Int? = null,
    ): Canvas? {
        if (!posterClass) return null
        return derive(true, osW, osH, explicitW, explicitH, standardW, standardH)
    }

    /**
     * How tall a pinned surface may actually be drawn.
     *
     * The LED's height is the module's (1080), NOT the app window's. A ROM
     * that keeps a navigation bar — or an emulator, where the window came
     * back 774 px tall inside a 1080 px screen — gives us a window SHORTER
     * than the canvas, and a box taller than its parent centres its content
     * BELOW the visible area: the same class of bug this whole wave is
     * fixing, one axis over. So a pinned surface is never taller than the
     * window it lives in. A window TALLER than the LED still gets the LED's
     * height, because the glass only shows the top [canvasH] pixels.
     */
    fun pinnedHeight(canvasH: Int, windowH: Int): Int {
        if (windowH <= 0) return canvasH
        return if (canvasH < windowH) canvasH else windowH
    }

    /**
     * The width a narrow-column layout is designed against. Everything
     * inside the canvas is scaled by canvasWidth / [REFERENCE_COLUMN_PX],
     * capped at 1 — a column NEVER grows type, it only shrinks it to fit.
     */
    const val REFERENCE_COLUMN_PX = 720

    /** Never shrink text below this many pixels; illegible is not a fit. */
    const val MIN_TEXT_PX = 9f

    /** The scale factor for a canvas of [canvasWidthPx]. 1f means "no change". */
    fun narrowScale(canvasWidthPx: Int): Float {
        if (canvasWidthPx <= 0) return 1f
        val f = canvasWidthPx.toFloat() / REFERENCE_COLUMN_PX
        return if (f >= 1f) 1f else f
    }
}
