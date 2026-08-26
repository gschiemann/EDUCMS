package com.educms.player.setup

import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule that decides whether a PUBLIC wall panel opens a setup card.
 *
 * Every case below is a thing a passer-by actually does to a screen — a tap,
 * a swipe, a two-handed lean, a drag that starts in the corner — and the
 * assertion is that none of them arm the hold. Cheap to run, no emulator,
 * and it is the only place the "not found by accident" claim in
 * SetupCornerGesture's header is actually checked.
 */
class SetupCornerGestureTest {

    /** 2.0 density → 128 px corner box, 48 px slop. */
    private fun gesture() = SetupCornerGesture(
        cornerPx = SetupCornerGesture.cornerPxFor(2f),
        slopPx = SetupCornerGesture.slopPxFor(2f),
    )

    @Test
    fun `a press inside the top-left corner arms the hold`() {
        val g = gesture()
        assertEquals(
            SetupCornerGesture.Decision.ARM,
            g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f),
        )
        assertTrue(g.isArmed)
    }

    @Test
    fun `a press anywhere else does nothing`() {
        val g = gesture()
        // Just outside the box on each axis, plus the middle of the glass and
        // the other three corners of a 1920x1080 panel.
        listOf(
            200f to 10f,
            10f to 200f,
            960f to 540f,
            1900f to 10f,
            10f to 1060f,
            1900f to 1060f,
        ).forEach { (x, y) ->
            assertEquals(
                "($x,$y) must not arm",
                SetupCornerGesture.Decision.NONE,
                g.onTouch(MotionEvent.ACTION_DOWN, x, y),
            )
            assertFalse(g.isArmed)
        }
    }

    @Test
    fun `lifting a finger disarms — a tap can never reach the timer`() {
        val g = gesture()
        g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f)
        assertEquals(
            SetupCornerGesture.Decision.DISARM,
            g.onTouch(MotionEvent.ACTION_UP, 10f, 10f),
        )
        assertFalse(g.isArmed)
    }

    @Test
    fun `a swipe out of the corner disarms`() {
        val g = gesture()
        g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f)
        // Inside the slop — still a hold.
        assertEquals(
            SetupCornerGesture.Decision.NONE,
            g.onTouch(MotionEvent.ACTION_MOVE, 30f, 20f),
        )
        assertTrue(g.isArmed)
        // Past the slop — a drag, not a hold.
        assertEquals(
            SetupCornerGesture.Decision.DISARM,
            g.onTouch(MotionEvent.ACTION_MOVE, 90f, 20f),
        )
        assertFalse(g.isArmed)
    }

    @Test
    fun `a second finger disarms — a two-handed lean is not this gesture`() {
        val g = gesture()
        g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f)
        assertEquals(
            SetupCornerGesture.Decision.DISARM,
            g.onTouch(MotionEvent.ACTION_POINTER_DOWN, 500f, 500f, pointerCount = 2),
        )
        assertFalse(g.isArmed)
    }

    @Test
    fun `a multi-touch DOWN never arms even when it lands in the corner`() {
        val g = gesture()
        assertEquals(
            SetupCornerGesture.Decision.NONE,
            g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f, pointerCount = 3),
        )
        assertFalse(g.isArmed)
    }

    @Test
    fun `a cancelled gesture disarms — the WebView taking the stream ends it`() {
        val g = gesture()
        g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f)
        assertEquals(
            SetupCornerGesture.Decision.DISARM,
            g.onTouch(MotionEvent.ACTION_CANCEL, 10f, 10f),
        )
        assertFalse(g.isArmed)
    }

    @Test
    fun `reset drops an armed hold and is a no-op when nothing is armed`() {
        val g = gesture()
        assertEquals(SetupCornerGesture.Decision.NONE, g.reset())
        g.onTouch(MotionEvent.ACTION_DOWN, 10f, 10f)
        assertEquals(SetupCornerGesture.Decision.DISARM, g.reset())
        assertFalse(g.isArmed)
    }

    @Test
    fun `the hold is long enough that no ordinary touch reaches it`() {
        // A tap is ~100 ms and a system long-press is 500 ms. If this ever
        // drops near either, the "not found by accident" property is gone.
        assertTrue(
            "the corner hold must stay far above a system long-press",
            SetupCornerGesture.HOLD_MS >= 5_000L,
        )
    }

    @Test
    fun `the copy the operator reads names the duration this code enforces`() {
        // SetupCeremonyMath.REENTRY_LINE tells the operator "6 seconds" and
        // "TOP-LEFT". Copy that names a gesture the code does not honour is
        // worse than no copy at all.
        assertEquals(6_000L, SetupCornerGesture.HOLD_MS)
        assertTrue(SetupCeremonyMath.REENTRY_LINE.contains("6 seconds"))
        assertTrue(SetupCeremonyMath.REENTRY_LINE.contains("TOP-LEFT"))
    }
}
