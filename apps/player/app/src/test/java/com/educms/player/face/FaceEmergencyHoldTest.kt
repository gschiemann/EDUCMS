package com.educms.player.face

import com.educms.player.display.DisplayEmergency
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️⚠️ THE SHARPEST LIFE-SAFETY BUG THE DOUBLE-SIDED WORK HAD TO CLOSE.
 *
 * The native emergency hold was ONE process-wide persisted boolean, while
 * the web side's dedup latch (`emergencyHold.ts` `lastSent`) is
 * per-JS-context. A second face is a second JS realm — so two latches wrote
 * one boolean, and side B's ROUTINE all-clear (it polls its own manifest,
 * sees no emergency, and reports `false` every poll) would RELEASE SIDE A'S
 * LIVE LOCKDOWN. The front could be in a real lockdown and the interlock —
 * the thing that refuses every blank, dim and reboot — would drop within
 * seconds of the back's next poll.
 *
 * The hold is now a refcount over the set of holding faces: engaged while
 * ANY face holds, released only when the last one stands down.
 *
 * These are pure JVM tests for the same reason
 * `DisplayEmergency.refusalReasonFor` has pure tests: a life-safety rule
 * whose test can be skipped for want of an emulator is not a safety rule.
 * They exercise the DECISION; the persistence half (`commit()` on
 * `SharedPreferences`) needs an instrumented test and is not faked here.
 */
class FaceEmergencyHoldTest {

    private val front = DisplayEmergency.PRIMARY_FACE // 0
    private val back = 1

    // ─── THE BUG ──────────────────────────────────────────────────────

    @Test
    fun `the back's all-clear does NOT release the front's live lockdown`() {
        // Front raises. Back, showing the lunch menu, polls and reports clear.
        val afterFrontRaise = DisplayEmergency.nextHoldFaces(emptySet(), front, active = true)
        assertEquals(setOf(front), afterFrontRaise)

        val afterBackClear = DisplayEmergency.nextHoldFaces(afterFrontRaise, back, active = false)

        assertTrue(
            "THE BUG: the back reporting all-clear must not empty a set the FRONT is in",
            afterBackClear.contains(front),
        )
        assertTrue(
            "the hold must still be engaged",
            DisplayEmergency.heldFrom(afterBackClear, legacyHold = true),
        )
    }

    @Test
    fun `the back's repeated polling never wears the front's hold down`() {
        // emergencyHold.ts re-reports on EVERY manifest poll, so this is the
        // real traffic pattern, not a contrived one.
        var faces = DisplayEmergency.nextHoldFaces(emptySet(), front, active = true)
        repeat(50) { faces = DisplayEmergency.nextHoldFaces(faces, back, active = false) }
        assertEquals(setOf(front), faces)
    }

    // ─── held while ANY face holds ────────────────────────────────────

    @Test
    fun `either face raising engages the whole unit`() {
        // Contract §4: an alert on EITHER face takes BOTH faces. Life-safety
        // beats "different content".
        assertTrue(
            DisplayEmergency.heldFrom(
                DisplayEmergency.nextHoldFaces(emptySet(), back, active = true),
                legacyHold = false,
            ),
        )
        assertTrue(
            DisplayEmergency.heldFrom(
                DisplayEmergency.nextHoldFaces(emptySet(), front, active = true),
                legacyHold = false,
            ),
        )
    }

    @Test
    fun `the hold releases only when the set empties`() {
        var faces = DisplayEmergency.nextHoldFaces(emptySet(), front, active = true)
        faces = DisplayEmergency.nextHoldFaces(faces, back, active = true)
        assertEquals(setOf(front, back), faces)

        faces = DisplayEmergency.nextHoldFaces(faces, front, active = false)
        assertEquals("the back is still in an alert", setOf(back), faces)
        assertTrue(DisplayEmergency.heldFrom(faces, legacyHold = true))

        faces = DisplayEmergency.nextHoldFaces(faces, back, active = false)
        assertTrue("last one out", faces.isEmpty())
        assertFalse(DisplayEmergency.heldFrom(faces, legacyHold = false))
    }

    @Test
    fun `a face raising twice is idempotent`() {
        // The web player re-raises on every emergency poll by design, so
        // that must not accumulate anything.
        var faces = DisplayEmergency.nextHoldFaces(emptySet(), back, active = true)
        faces = DisplayEmergency.nextHoldFaces(faces, back, active = true)
        assertEquals(setOf(back), faces)
    }

    @Test
    fun `releasing a face that never raised changes nothing`() {
        val faces = DisplayEmergency.nextHoldFaces(setOf(front), 2, active = false)
        assertEquals(setOf(front), faces)
    }

    // ─── fail-safe: unreadable state reads HELD ───────────────────────

    @Test
    fun `an unreadable face set with the legacy boolean true reads as HELD`() {
        // FAIL-SAFE DIRECTION. A hold that is wrongly kept costs
        // electricity; a hold that is wrongly dropped can hide a lockdown.
        assertNull("garbage must not parse", DisplayEmergency.parseHoldFaces("nonsense"))
        assertNull(DisplayEmergency.parseHoldFaces("0,,1"))
        assertNull(DisplayEmergency.parseHoldFaces("0,999"))
        assertNull(DisplayEmergency.parseHoldFaces("-1"))

        assertTrue(
            "unparsable + legacy true must be HELD",
            DisplayEmergency.heldFrom(DisplayEmergency.parseHoldFaces("nonsense"), legacyHold = true),
        )
    }

    @Test
    fun `a face set that is present but empty with the boolean true is still HELD`() {
        assertEquals(emptySet<Int>(), DisplayEmergency.parseHoldFaces(""))
        assertTrue(DisplayEmergency.heldFrom(emptySet(), legacyHold = true))
    }

    @Test
    fun `absent state with the boolean false is not held`() {
        assertNull(DisplayEmergency.parseHoldFaces(null))
        assertFalse(DisplayEmergency.heldFrom(null, legacyHold = false))
        assertFalse(DisplayEmergency.heldFrom(emptySet(), legacyHold = false))
    }

    // ─── the upgrade window ───────────────────────────────────────────

    @Test
    fun `an APK that upgraded MID-ALERT attributes the hold to the primary`() {
        // The pre-face world had exactly one holder. A device that takes
        // 1.1.18 while an alert is up has `display_emergency_hold = true`
        // and NO face set at all. Reading that as "nobody is holding" would
        // let the NEW face's very first routine all-clear clear a live
        // lockdown the primary raised — the bug, re-entering through the
        // upgrade path.
        val current = DisplayEmergency.currentHoldFaces(parsed = null, legacyHold = true)
        assertEquals(setOf(front), current)

        val afterBackClear = DisplayEmergency.nextHoldFaces(current, back, active = false)
        assertEquals("the primary's hold survives the new face's first poll", setOf(front), afterBackClear)
    }

    @Test
    fun `an upgraded device with no alert is not held`() {
        assertEquals(emptySet<Int>(), DisplayEmergency.currentHoldFaces(parsed = null, legacyHold = false))
    }

    @Test
    fun `a readable non-empty set wins over the legacy boolean`() {
        assertEquals(
            setOf(back),
            DisplayEmergency.currentHoldFaces(parsed = setOf(back), legacyHold = true),
        )
    }

    // ─── a torn-down face does not strand the hold ────────────────────

    @Test
    fun `a face removed while holding does not strand the hold on a dead display`() {
        // HDMI unplugged mid-alert while the back was the only holder. The
        // controller reports that face's stand-down; if the set empties the
        // release runs exactly as it does today, schedule re-evaluation and
        // all. A hold pinned to a display that no longer exists would be
        // unreleasable by anything short of wiping app data.
        val onlyBack = DisplayEmergency.nextHoldFaces(emptySet(), back, active = true)
        val afterTeardown = DisplayEmergency.nextHoldFaces(onlyBack, back, active = false)
        assertTrue(afterTeardown.isEmpty())
        assertFalse(DisplayEmergency.heldFrom(afterTeardown, legacyHold = false))
    }

    // ─── encoding is stable ───────────────────────────────────────────

    @Test
    fun `encoding round-trips and never churns the persisted value`() {
        val faces = setOf(1, 0)
        val raw = DisplayEmergency.encodeHoldFaces(faces)
        assertEquals("sorted, so the same membership always writes the same bytes", "0,1", raw)
        assertEquals(setOf(0, 1), DisplayEmergency.parseHoldFaces(raw))
        assertEquals("", DisplayEmergency.encodeHoldFaces(emptySet()))
    }

    @Test
    fun `whitespace in a hand-edited value is tolerated`() {
        assertEquals(setOf(0, 1), DisplayEmergency.parseHoldFaces(" 0 , 1 "))
    }

    // ─────────────────────────────────────────────────────────────
    // 2026-09-19 — A MEMBER MUST BE A FACE THIS BOX IS HOSTING
    //
    // The 1.1.18 verifier's finding 1 (high): an index nothing hosts could be
    // recorded as a holder, and then nothing could ever release it. These are
    // the two pure rules that close it; `setHold` applies them under one lock.
    // ─────────────────────────────────────────────────────────────

    private val singleSided = setOf(DisplayEmergency.PRIMARY_FACE)
    private val doubleSided = setOf(DisplayEmergency.PRIMARY_FACE, 1)

    @Test
    fun `THE ATTACK - a hold credited to a face that does not exist round-trips on a single-sided box`() {
        // Verbatim from the verifier: displayEmergencyHold(true, 1) on a box with
        // no face 1 committed {0,1}; the page's all-clear narrowed it to {1},
        // and the hold stayed engaged forever. Replayed against the fix:
        val phantom = DisplayEmergency.creditedFace(1, singleSided)
        assertEquals("a face nobody hosts must be credited to the primary", 0, phantom)

        var faces = DisplayEmergency.nextHoldFaces(emptySet(), phantom, active = true)
        assertEquals(setOf(0), faces)
        assertTrue("the RAISE must not be dropped", DisplayEmergency.heldFrom(faces, legacyHold = true))

        // The primary's ordinary all-clear now lifts it, exactly as before faces existed.
        faces = DisplayEmergency.nextHoldFaces(faces, DisplayEmergency.creditedFace(0, singleSided), active = false)
        assertTrue("the hold could not be released — this is the permanent pin", faces.isEmpty())
    }

    @Test
    fun `no index at all can create a member outside the hosted set`() {
        for (hosted in listOf(singleSided, doubleSided, setOf(0, 1, 2))) {
            for (index in listOf(-5, -1, 0, 1, 2, 3, 7, 8, 9, 100, Int.MAX_VALUE, Int.MIN_VALUE)) {
                val credited = DisplayEmergency.creditedFace(index, hosted)
                assertTrue("index $index was credited to $credited, which $hosted does not host", credited in hosted)
            }
        }
    }

    @Test
    fun `a hosted face is credited as itself`() {
        assertEquals(1, DisplayEmergency.creditedFace(1, doubleSided))
        assertEquals(0, DisplayEmergency.creditedFace(0, doubleSided))
    }

    @Test
    fun `a face that vanishes while holding keeps the box HELD - and liftable`() {
        // HDMI pulled mid-lockdown; the back was the only holder so far.
        val before = setOf(1)
        val after = DisplayEmergency.reconcileHoldFaces(before, singleSided)
        assertEquals("the departed face's membership must move to the primary", setOf(0), after)
        assertTrue("pulling a cable must never release a live hold", DisplayEmergency.heldFrom(after, legacyHold = true))
        // …and it is not stranded: the primary's all-clear empties the set.
        assertTrue(DisplayEmergency.nextHoldFaces(after, 0, active = false).isEmpty())
    }

    @Test
    fun `reconciling never drops a holder and never invents one`() {
        assertEquals(setOf(0), DisplayEmergency.reconcileHoldFaces(setOf(0, 1), singleSided))
        assertEquals(setOf(0, 1), DisplayEmergency.reconcileHoldFaces(setOf(0, 1), doubleSided))
        assertEquals(setOf(0), DisplayEmergency.reconcileHoldFaces(setOf(3, 7), singleSided))
        assertTrue(
            "an empty holding set must stay empty — reconciling must not raise a hold",
            DisplayEmergency.reconcileHoldFaces(emptySet(), doubleSided).isEmpty(),
        )
    }

    @Test
    fun `the back's all-clear still cannot release the front once both are hosted`() {
        // The refcount's original purpose must survive the new rules.
        var faces = DisplayEmergency.nextHoldFaces(emptySet(), DisplayEmergency.creditedFace(0, doubleSided), true)
        repeat(20) {
            faces = DisplayEmergency.nextHoldFaces(faces, DisplayEmergency.creditedFace(1, doubleSided), false)
        }
        assertEquals(setOf(0), faces)
    }
}
