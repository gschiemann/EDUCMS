package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️ THE CHECK-THEN-ACT RACE IN THE LIFE-SAFETY INTERLOCK.
 *
 * `DisplayControlRegistry.apply` reads `DisplayEmergency.isHeld()` on one
 * thread and the panel is driven on another, so a scheduled 22:00 blank
 * can pass the gate and land its effect AFTER a 02:14 lockdown OVERRIDE
 * engages the hold on the bridge worker thread. Before 2026-08-14 that
 * left the screen BLACK for the whole alert: nothing re-asserted, because
 * the only recovery path (a re-raise) short-circuited on
 * `if (alreadyHeld) return true`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT THIS TEST IS, AND WHAT IT IS NOT
 * ─────────────────────────────────────────────────────────────────────
 * It is NOT an integration test — there is no Activity, no Looper and no
 * SharedPreferences on a plain JVM, and a life-safety rule whose test
 * needs an emulator is a rule that does not get tested.
 *
 * It IS a faithful transcription of the ORDERING CONTRACT, driven by the
 * REAL predicates the production code calls
 * ([DisplayEmergency.blocksBlackout], [DisplayEmergency.blocksWindowDim],
 * [DisplayEmergency.isDarkeningAction], [DisplayEmergency.refusalReasonFor]).
 * Change any of them and this goes red. The three facts it models are
 * exactly the three the production code guarantees:
 *
 *   1. every window mutation is posted to ONE serial queue (MainActivity
 *      marshals all four hooks through `runOnUiThread`);
 *   2. the hold is `commit()`ed — synchronously, before any enforce work
 *      is posted (`DisplayEmergency.engage`);
 *   3. a darkening action re-checks the hold after its provider returns
 *      (`DisplayControlRegistry.apply`) and a re-raise re-enforces
 *      (`DisplayEmergency.engage`).
 *
 * The invariant asserted for EVERY interleaving: once the hold is
 * engaged, the screen ends VISIBLE.
 */
class DisplayEmergencyRaceTest {

    /** The serialized main looper: FIFO, one runnable at a time. */
    private class Looper {
        private val queue = ArrayDeque<() -> Unit>()
        fun post(block: () -> Unit) = queue.addLast(block)
        fun drain() {
            while (queue.isNotEmpty()) queue.removeFirst().invoke()
        }
    }

    /**
     * The device: the persisted hold flag plus what is actually on the
     * glass. `blackout` is MainActivity's overlay View; `brightness` is
     * `window.attributes.screenBrightness`.
     */
    private class Device {
        val looper = Looper()

        /** DisplayPrefs KEY_EMERGENCY_HOLD — written with commit(). */
        var hold = false

        /** DisplayPrefs KEY_BLANKED — the mirror. */
        var blankedMirror = false
        var brightnessMirror = 100

        var blackout = false
        var windowBrightness = 1f

        /** FLAG_KEEP_SCREEN_ON — cleared, the OS may sleep the panel. */
        var keepScreenOn = true

        /**
         * Is the alert actually readable, and will it STAY readable?
         * `keepScreenOn` is part of the answer: a lit panel that the OS
         * is free to sleep in 15 s is not a visible alert.
         */
        val alertVisible: Boolean get() = !blackout && windowBrightness >= 1f && keepScreenOn

        // ── MainActivity's hooks. Each marshals to the looper and
        // re-checks the hold ON that looper — the guard being tested.
        fun postBlackout(visible: Boolean) = looper.post {
            if (!DisplayEmergency.blocksBlackout(hold, visible)) blackout = visible
        }

        fun postWindowBrightness(fraction: Float) = looper.post {
            if (!DisplayEmergency.blocksWindowDim(hold, fraction)) windowBrightness = fraction
        }

        fun postKeepScreenOn(on: Boolean) = looper.post {
            if (!DisplayEmergency.blocksKeepScreenOff(hold, on)) keepScreenOn = on
        }

        /**
         * SoftwareDimProvider.Blank driven through
         * DisplayControlRegistry.apply, minus the parts that need a
         * Context. Returns false when the life-safety gate refused it.
         */
        fun applyBlank(): Boolean {
            val before = brightnessMirror
            // ── the gate, read on THIS thread ──
            if (DisplayEmergency.refusalReasonFor(hold, before, DisplayAction.Blank) != null) return false
            // ── the provider. KEEP_SCREEN_ON goes first, exactly as
            // SoftwareDimProvider.Blank does it. ──
            postKeepScreenOn(false)
            postWindowBrightness(0f)
            postBlackout(true)
            // ── recordState ──
            blankedMirror = true
            // ── the post-apply re-assert ──
            if (DisplayEmergency.isDarkeningAction(before, DisplayAction.Blank) && hold) enforceNow()
            return true
        }

        /**
         * DisplayEmergency.setHold(true) → engage(). The commit is
         * synchronous and happens BEFORE any enforce work is posted —
         * that ordering is what makes the UI-thread guard sound.
         */
        fun engage() {
            hold = true
            // ALWAYS, including on a re-raise (2026-08-14). The old
            // `if (alreadyHeld) return true` is the short-circuit that
            // made a raced blank permanent for the length of the alert.
            enforceNow()
        }

        /** DisplayEmergency.enforceNow(). */
        fun enforceNow() {
            postBlackout(false)
            postWindowBrightness(1f)
            postKeepScreenOn(true)
            blankedMirror = false
            brightnessMirror = 100
        }
    }

    // ─── the four interleavings ──────────────────────────────────────

    @Test
    fun `blank posts first, then the alert lands — the enforce wins because it is posted last`() {
        val d = Device()
        d.applyBlank()          // gate read while unheld; posts P1,P2
        d.looper.drain()        // screen goes black — correct, no alert yet
        assertTrue("a blank with no alert must take", d.blackout)

        d.engage()              // commit + enforce posts
        d.looper.drain()
        assertTrue("the alert must be visible after the hold engages", d.alertVisible)
    }

    @Test
    fun `THE BUG - the alert lands between the gate read and the provider posts`() {
        // This is the exact interleaving from the 2026-08-13 review:
        // the scheduler reads isHeld()==false, the OVERRIDE engages and
        // fully enforces, and only THEN does the scheduler's blank reach
        // the window. Before the UI-thread guard the panel ended black
        // with the hold engaged and nothing left to lift it.
        val d = Device()
        val before = d.brightnessMirror
        assertFalse("precondition: the gate sees no hold", d.hold)
        // Gate read happens here, in the scheduler, and passes.

        // …the OVERRIDE lands on the bridge worker thread and completes.
        d.engage()
        d.looper.drain()
        assertTrue(d.alertVisible)

        // …and only now does the scheduler's provider post its blank.
        d.postKeepScreenOn(false)
        d.postWindowBrightness(0f)
        d.postBlackout(true)
        d.looper.drain()

        assertTrue(
            "the blackout must be refused ON THE UI THREAD — it was posted after the hold was committed",
            d.alertVisible,
        )
        assertTrue(
            "…and KEEP_SCREEN_ON must survive too, or the OS sleeps the panel mid-alert",
            d.keepScreenOn,
        )
        assertTrue("the darkening action must be recognised as such", DisplayEmergency.isDarkeningAction(before, DisplayAction.Blank))
    }

    @Test
    fun `the alert lands after the blank is posted but before the looper runs it`() {
        val d = Device()
        d.postKeepScreenOn(false)
        d.postWindowBrightness(0f)
        d.postBlackout(true)     // enqueued, not yet run
        d.engage()               // commit + enforce enqueued behind them
        d.looper.drain()
        assertTrue("both the guard and the trailing enforce cover this", d.alertVisible)
    }

    @Test
    fun `KEEP_SCREEN_ON cannot be dropped while an alert is up`() {
        // The half of the race the overlay guard alone does not cover: a
        // blank clears the flag FIRST, so on a box whose blank mechanism
        // is the OS screen-off timeout (or a vendor power broadcast) the
        // panel goes dark ~15 s later even though the overlay never
        // appeared. Nothing legitimate drops the flag during a hold —
        // every caller that would is already refused at the registry.
        val d = Device()
        d.engage()
        d.looper.drain()
        d.postKeepScreenOn(false)
        d.looper.drain()
        assertTrue("the flag must survive", d.keepScreenOn)
        assertTrue(d.alertVisible)
        assertTrue(DisplayEmergency.blocksKeepScreenOff(held = true, on = false))
        // Re-asserting it is the recovery direction and is never blocked.
        assertFalse(DisplayEmergency.blocksKeepScreenOff(held = true, on = true))
        assertFalse(DisplayEmergency.blocksKeepScreenOff(held = false, on = false))
    }

    @Test
    fun `a blank that raced the hold is re-asserted even when the window is detached`() {
        // The UI-thread guard cannot help a mechanism that is not a window
        // mutation — a device-admin lockNow(), a shortened screen-off
        // timeout, a vendor power broadcast. The post-apply re-assert is
        // what covers those, and it fires off the mirror, not off the
        // window. Here the hold engages DURING the provider's work.
        val d = Device()
        val before = d.brightnessMirror
        assertFalse(d.hold)
        // gate read passes…
        d.hold = true                      // …the OVERRIDE commits mid-apply
        d.blankedMirror = true             // …the provider's recordState lands

        assertTrue(
            "the post-apply re-check must fire for a darkening action once the hold is held",
            DisplayEmergency.isDarkeningAction(before, DisplayAction.Blank) && d.hold,
        )
        d.enforceNow()
        d.looper.drain()
        assertFalse("the mirror must be corrected back to un-blanked", d.blankedMirror)
        assertTrue(d.alertVisible)
    }

    // ─── the re-raise is no longer a no-op ───────────────────────────

    @Test
    fun `a forced re-raise of an already-held hold re-enforces instead of short-circuiting`() {
        // The web player re-reports the hold on every emergency poll
        // precisely so a native process that missed the transition
        // re-arms. `if (alreadyHeld) return true` quietly broke that
        // promise, which is why a raced blank stayed on the glass for the
        // WHOLE alert instead of one poll interval.
        val d = Device()
        d.engage()
        d.looper.drain()

        // Something dark got through anyway (a mechanism outside the
        // looper, or an older APK's provider).
        d.blackout = true
        d.blankedMirror = true

        d.engage()               // the re-raise
        d.looper.drain()
        assertTrue("a re-raise must recover the screen", d.alertVisible)
        assertFalse(d.blankedMirror)
    }

    // ─── the pure predicates the guards are built from ───────────────

    @Test
    fun `blocksBlackout refuses only the raise, and only while held`() {
        assertTrue(DisplayEmergency.blocksBlackout(held = true, visible = true))
        // Hiding the overlay is the recovery direction — never blocked.
        assertFalse(DisplayEmergency.blocksBlackout(held = true, visible = false))
        assertFalse(DisplayEmergency.blocksBlackout(held = false, visible = true))
        assertFalse(DisplayEmergency.blocksBlackout(held = false, visible = false))
    }

    @Test
    fun `blocksWindowDim refuses anything below full, including hand-back-to-system`() {
        listOf(0f, 0.01f, 0.5f, 0.99f).forEach {
            assertTrue("dimming to $it must be refused while held", DisplayEmergency.blocksWindowDim(true, it))
        }
        // BRIGHTNESS_OVERRIDE_NONE hands the panel to whatever the ROM
        // last set, which on a signage box can be very low.
        assertTrue(DisplayEmergency.blocksWindowDim(true, -1f))
        // enforceNow()'s own write must pass, or engaging a hold would be
        // a no-op.
        assertFalse("enforceNow drives 1f and must not block itself", DisplayEmergency.blocksWindowDim(true, 1f))
        assertFalse(DisplayEmergency.blocksWindowDim(false, 0f))
    }

    @Test
    fun `isDarkeningAction is exactly the inverse of the gate, so the two cannot drift`() {
        val darkening = listOf(
            DisplayAction.Blank,
            DisplayAction.Reboot,
            DisplayAction.SetBrightness(20),
            DisplayAction.SetBrightness(100, allowBlack = true),
        )
        val recovery = listOf(
            DisplayAction.Wake,
            DisplayAction.SetBrightness(100),
            DisplayAction.SetVolume(0),
        )
        darkening.forEach {
            assertTrue(it.describe(), DisplayEmergency.isDarkeningAction(currentPercent = 100, action = it))
            assertEquals(
                "isDarkeningAction must agree with refusalReasonFor for ${it.describe()}",
                DisplayEmergency.refusalReasonFor(true, 100, it) != null,
                DisplayEmergency.isDarkeningAction(100, it),
            )
        }
        recovery.forEach {
            assertFalse(it.describe(), DisplayEmergency.isDarkeningAction(currentPercent = 100, action = it))
        }
    }

    @Test
    fun `the post-apply re-check uses the PRE-apply mirror, not the post-apply one`() {
        // DisplayControlRegistry snapshots brightness BEFORE the provider
        // runs. If it used the mirror AFTER recordState, a SetBrightness(20)
        // would compare 20 < 20 and read as "not darkening" — the re-assert
        // would never fire for the one action class most likely to hide an
        // alert without blanking it.
        val dim = DisplayAction.SetBrightness(20)
        assertTrue("pre-apply mirror (100%)", DisplayEmergency.isDarkeningAction(100, dim))
        assertFalse("post-apply mirror (20%) — the bug this guards against", DisplayEmergency.isDarkeningAction(20, dim))
    }
}
