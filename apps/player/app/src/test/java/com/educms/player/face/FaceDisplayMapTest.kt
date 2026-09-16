package com.educms.player.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * §1 of the double-sided contract: which physical panel is face N.
 *
 * These run on a plain JVM because [FaceDisplayMap] is deliberately pure.
 * A rule that decides WHICH PIECE OF GLASS shows WHICH content must have a
 * test that cannot be skipped for want of an emulator — the same reason
 * `DisplayEmergency.refusalReasonFor` and `resolveNativeToken` are pure.
 *
 * ⚠️ These tests prove the MAPPING. They prove nothing about whether
 * `android.app.Presentation` works on the Goodview DH43's ROM, whether
 * FLAG_PRESENTATION survives a reboot there, or whether display-id
 * ordering is stable across power cycles. Those are hardware facts and
 * `apps/player/HARDWARE-QUALIFICATION.md` is where they get answered.
 */
class FaceDisplayMapTest {

    // The production evidence, read off the real unit (one rk3288 board,
    // Android 7.1.2): display 0 is the built-in portrait panel and is NOT a
    // presentation display; display 1 is the HDMI landscape panel and is.
    private val dh43BuiltIn = FaceDisplay(
        displayId = 0,
        name = "Built-in Screen",
        widthPx = 1080,
        heightPx = 1920,
        isPresentation = false,
        isPrivate = false,
    )
    private val dh43Hdmi = FaceDisplay(
        displayId = 1,
        name = "HDMI Screen",
        widthPx = 1920,
        heightPx = 1080,
        isPresentation = true,
        isPrivate = false,
    )
    private val dh43 = listOf(dh43BuiltIn, dh43Hdmi)

    // ─── the DH43, which is the whole reason this exists ──────────────

    @Test
    fun `on the DH43 face 1 is the HDMI panel`() {
        val panel = FaceDisplayMap.displayForFace(dh43, 1)
        assertEquals("face 1 must land on display 1, the HDMI panel", 1, panel?.displayId)
        assertEquals(1920, panel?.widthPx)
        assertEquals(1080, panel?.heightPx)
    }

    @Test
    fun `face 0 is never looked up in the eligible list`() {
        // Face 0 is the Activity's own display. Answering "the first
        // eligible panel" here would put the FRONT's content on the BACK
        // and hide the caller's bug.
        assertNull(FaceDisplayMap.displayForFace(dh43, 0))
        assertNull(FaceDisplayMap.displayForFace(dh43, -1))
    }

    @Test
    fun `the built-in panel is not eligible and that is correct`() {
        // It carries no FLAG_PRESENTATION. It is still face 0 — it is just
        // not reached through this map.
        assertFalse(FaceDisplayMap.isEligible(dh43BuiltIn))
        assertTrue(FaceDisplayMap.isEligible(dh43Hdmi))
    }

    // ─── deterministic ordering ───────────────────────────────────────

    @Test
    fun `eligible panels are ordered by displayId ascending regardless of input order`() {
        // Display ids are not stable across reboots on every OEM, but their
        // relative order is — so an operator's "Back = the street-facing
        // menu" must not swap after a power cut.
        val scrambled = listOf(
            FaceDisplay(displayId = 7, isPresentation = true),
            FaceDisplay(displayId = 2, isPresentation = true),
            dh43BuiltIn,
            FaceDisplay(displayId = 5, isPresentation = true),
        )
        assertEquals(
            listOf(2, 5, 7),
            FaceDisplayMap.eligibleInOrder(scrambled).map { it.displayId },
        )
        assertEquals(2, FaceDisplayMap.displayForFace(scrambled, 1)?.displayId)
        assertEquals(5, FaceDisplayMap.displayForFace(scrambled, 2)?.displayId)
        assertEquals(7, FaceDisplayMap.displayForFace(scrambled, 3)?.displayId)
    }

    // ─── a mirror / virtual surface is NOT a second side ──────────────

    @Test
    fun `a FLAG_PRIVATE overlay display is never eligible`() {
        // A screen recorder, a vendor software mirror, a cast surface. This
        // is exactly the distinction the 2026-09-02 capability probe was
        // added to make, and offering one as "the back of the display"
        // would put a face on a surface nobody can see.
        val recorder = FaceDisplay(displayId = 3, isPresentation = true, isPrivate = true)
        assertFalse(FaceDisplayMap.isEligible(recorder))
        assertNull(FaceDisplayMap.displayForFace(listOf(dh43BuiltIn, recorder), 1))
    }

    @Test
    fun `flag derivation matches the platform masks the probe uses`() {
        // The ONE place the bitmask is applied. If this drifts from
        // DisplayCapabilityProbe's derivation, the device and the
        // dashboard disagree about whether a second panel exists — the
        // single thing §1 of the contract forbids.
        assertEquals(
            "FLAG_PRESENTATION must equal the platform constant",
            android.view.Display.FLAG_PRESENTATION,
            FaceDisplayMap.FLAG_PRESENTATION,
        )
        assertEquals(
            "FLAG_PRIVATE must equal the platform constant",
            android.view.Display.FLAG_PRIVATE,
            FaceDisplayMap.FLAG_PRIVATE,
        )
        assertTrue(FaceDisplayMap.eligibleFromFlags(FaceDisplayMap.FLAG_PRESENTATION))
        assertFalse(
            FaceDisplayMap.eligibleFromFlags(
                FaceDisplayMap.FLAG_PRESENTATION or FaceDisplayMap.FLAG_PRIVATE,
            ),
        )
        assertFalse(FaceDisplayMap.eligibleFromFlags(0))
    }

    // ─── shortfall: report it, never silently reassign ────────────────

    @Test
    fun `face 2 with only one eligible panel is a shortfall and never steals face 1's panel`() {
        // THE no-silent-reassignment assertion. Sliding face 2 onto display
        // 1 would put the wrong content on a piece of glass and tell nobody.
        assertNull(FaceDisplayMap.displayForFace(dh43, 2))
        assertEquals(listOf(2), FaceDisplayMap.shortfall(dh43, listOf(1, 2)))
        assertEquals(FaceDisplayMap.REASON_FEWER_PANELS, FaceDisplayMap.shortfallReason(dh43))
    }

    @Test
    fun `a single-sided box reports no-eligible-second-display`() {
        val singleSided = listOf(dh43BuiltIn)
        assertEquals(listOf(1), FaceDisplayMap.shortfall(singleSided, listOf(1)))
        assertEquals(
            FaceDisplayMap.REASON_NO_SECOND_DISPLAY,
            FaceDisplayMap.shortfallReason(singleSided),
        )
        assertEquals(
            FaceDisplayMap.REASON_NO_SECOND_DISPLAY,
            FaceDisplayMap.shortfallReason(emptyList()),
        )
    }

    @Test
    fun `a hosted face is not reported as a shortfall`() {
        assertTrue(FaceDisplayMap.shortfall(dh43, listOf(1)).isEmpty())
        assertTrue(FaceDisplayMap.shortfall(dh43, emptyList()).isEmpty())
    }

    @Test
    fun `shortfall output is sorted and de-duplicated so it is stable across ticks`() {
        // A shortfall that reorders itself on every hot-plug reads as a
        // changing fault to whoever is looking at it.
        assertEquals(
            listOf(2, 3),
            FaceDisplayMap.shortfall(dh43, listOf(3, 2, 2, 1, 0, -4)),
        )
    }

    @Test
    fun `a face index at or beyond the ceiling is refused rather than hosted`() {
        val many = (1..6).map { FaceDisplay(displayId = it, isPresentation = true) }
        assertNull(FaceDisplayMap.displayForFace(many, FaceDisplayMap.MAX_FACES))
        assertTrue(FaceDisplayMap.shortfall(many, listOf(FaceDisplayMap.MAX_FACES)).isEmpty())
    }

    // ─── a display that is asleep is still that face's display ────────

    @Test
    fun `state OFF does not change eligibility`() {
        // If "asleep" meant "not there", blanking a panel would hand its
        // content to the next face — silent reassignment through the back
        // door, and the emergency interlock's whole job is to wake a panel
        // rather than write it off.
        val asleep = dh43Hdmi.copy(stateOn = false)
        assertTrue(FaceDisplayMap.isEligible(asleep))
        assertEquals(1, FaceDisplayMap.displayForFace(listOf(dh43BuiltIn, asleep), 1)?.displayId)
    }
}
