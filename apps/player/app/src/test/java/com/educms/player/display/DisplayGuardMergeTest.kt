package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️ P0 (2026-08-13) — THE SINGLE-SLOT DEAD-MAN REVERT BUG.
 *
 * v1's `DisplayGuard.arm` wrote ONE SharedPreferences slot. A second
 * armed action overwrote the first record AND snapshotted the state the
 * first action had already produced as "prior". The first action then
 * became permanent, with no record and no alarm.
 *
 * THE FIELD FAILURE, exactly as reviewed:
 *
 *   1. Operator presses Blank with a 60 s dead-man. Record = {BLANK,
 *      priorBlanked=false}. Panel powers off.
 *   2. Ten seconds later they drag the brightness slider — the natural
 *      "is it just dim?" reflex — with its own 60 s dead-man. v1
 *      DESTROYED the BLANK record and wrote {BRIGHTNESS,
 *      priorBlanked=true}.
 *   3. At T+70 the brightness revert fires. v1's revert for BRIGHTNESS
 *      ignored priorBlanked entirely, so no wake was ever sent. Panel
 *      stays off, no record remains, no alarm is armed. Truck roll.
 *
 * The trivially-reachable variant needed no second capability: pressing
 * Blank TWICE made the second arm snapshot priorBlanked=true, so the
 * revert re-applied Blank forever.
 *
 * [DisplayGuard.mergeArm] is pure so this can be pinned on a plain JVM.
 */
class DisplayGuardMergeTest {

    private fun arm(
        outstanding: List<PendingRevert>,
        capability: Capability,
        priorPercent: Int = 100,
        priorBlanked: Boolean = false,
        dueAtEpochMs: Long = 1_000L,
    ) = DisplayGuard.mergeArm(outstanding, capability, priorPercent, priorBlanked, dueAtEpochMs)

    // ─── the reviewed failure, end to end ────────────────────────────

    @Test
    fun `arming brightness after blank does NOT destroy the blank record`() {
        val afterBlank = arm(emptyList(), Capability.BLANK, priorBlanked = false, dueAtEpochMs = 1_060L)
        assertEquals(1, afterBlank.size)

        // The screen is now blanked, so the mirror says blanked=true —
        // which is what v1 snapshotted as the brightness record's
        // "prior".
        val afterBoth = arm(afterBlank, Capability.BRIGHTNESS, priorBlanked = true, dueAtEpochMs = 1_070L)

        assertEquals("both records must survive", 2, afterBoth.size)
        val blank = afterBoth.first { it.capability == Capability.BLANK }
        assertEquals("the BLANK record must be untouched", 1_060L, blank.dueAtEpochMs)
        assertEquals(false, blank.priorBlanked)
        assertTrue("BLANK still owns on/off state", blank.ownsBlankState)

        // …and the brightness record must NOT be allowed to act on its
        // stale priorBlanked=true, or it would black the panel out again
        // at T+70 after the BLANK revert had just woken it at T+60.
        val brightness = afterBoth.first { it.capability == Capability.BRIGHTNESS }
        assertEquals(
            "a second-in record must not drive on/off",
            false,
            brightness.ownsBlankState,
        )
        assertEquals(
            listOf(DisplayAction.SetBrightness(100, allowBlack = true)),
            brightness.revertActions(),
        )
    }

    @Test
    fun `pressing blank twice never turns the revert into a permanent blank`() {
        // v1: the second arm snapshotted priorBlanked=true (the state the
        // FIRST blank produced), so the revert re-applied Blank — a
        // permanently black screen from two taps of one button.
        val first = arm(emptyList(), Capability.BLANK, priorBlanked = false, dueAtEpochMs = 1_060L)
        val second = arm(first, Capability.BLANK, priorBlanked = true, dueAtEpochMs = 1_070L)

        assertEquals(1, second.size)
        val record = second.single()
        assertEquals(
            "the ORIGINAL snapshot must be kept — it is the only one taken before we changed anything",
            false,
            record.priorBlanked,
        )
        assertEquals(
            "and the revert therefore WAKES the screen",
            listOf(DisplayAction.Wake),
            record.revertActions(),
        )
    }

    // ─── the merge policy itself ─────────────────────────────────────

    @Test
    fun `re-arming keeps the original snapshot and pushes the due time out`() {
        val first = arm(emptyList(), Capability.BRIGHTNESS, priorPercent = 80, dueAtEpochMs = 1_000L)
        val second = arm(first, Capability.BRIGHTNESS, priorPercent = 20, dueAtEpochMs = 5_000L)

        val record = second.single()
        assertEquals("the first snapshot is the only true prior", 80, record.priorPercent)
        assertEquals(5_000L, record.dueAtEpochMs)
    }

    @Test
    fun `re-arming never pulls a dead-man window IN`() {
        // max(), not min(): shortening a window the operator explicitly
        // asked for would undo an action they are still looking at. The
        // guard always eventually restores, so erring long is a delay.
        val first = arm(emptyList(), Capability.BRIGHTNESS, dueAtEpochMs = 9_000L)
        val second = arm(first, Capability.BRIGHTNESS, dueAtEpochMs = 2_000L)
        assertEquals(9_000L, second.single().dueAtEpochMs)
    }

    @Test
    fun `three capabilities can be outstanding at once, one record each`() {
        var records = arm(emptyList(), Capability.BLANK, dueAtEpochMs = 1_000L)
        records = arm(records, Capability.BRIGHTNESS, dueAtEpochMs = 2_000L)
        records = arm(records, Capability.VOLUME, dueAtEpochMs = 3_000L)

        assertEquals(3, records.size)
        assertEquals(
            "one record per capability, no duplicates",
            3,
            records.map { it.capability }.toSet().size,
        )
        // …and the alarm arms for the EARLIEST, which is what
        // DisplayGuard.scheduleRevertAlarm selects.
        assertEquals(1_000L, records.minOf { it.dueAtEpochMs })
    }

    // ─── blank-state ownership ───────────────────────────────────────

    @Test
    fun `a sole brightness arm owns blank state, a later one does not`() {
        val sole = arm(emptyList(), Capability.BRIGHTNESS).single()
        assertTrue(
            "with nothing else in flight its priorBlanked was captured before anything moved",
            sole.ownsBlankState,
        )

        val afterVolume = arm(
            arm(emptyList(), Capability.VOLUME),
            Capability.BRIGHTNESS,
        ).first { it.capability == Capability.BRIGHTNESS }
        assertEquals(false, afterVolume.ownsBlankState)
    }

    @Test
    fun `blank and wake always own blank state, volume never does`() {
        val busy = arm(emptyList(), Capability.BRIGHTNESS, dueAtEpochMs = 1L)
        assertTrue(arm(busy, Capability.BLANK).first { it.capability == Capability.BLANK }.ownsBlankState)
        assertTrue(arm(busy, Capability.WAKE).first { it.capability == Capability.WAKE }.ownsBlankState)
        assertEquals(
            false,
            arm(emptyList(), Capability.VOLUME).single().ownsBlankState,
        )
    }

    @Test
    fun `a volume revert never touches the screen's on-off state`() {
        // Muting a screen and blanking it are unrelated; a volume revert
        // that emitted a Wake or a Blank would be driving the panel on a
        // capability it has no snapshot authority over.
        val record = arm(emptyList(), Capability.VOLUME, priorPercent = 35).single()
        assertEquals(listOf(DisplayAction.SetVolume(35)), record.revertActions())
    }

    // ─── the merged set survives the round trip to disk ──────────────

    @Test
    fun `a merged set persists and reloads intact`() {
        var records = arm(emptyList(), Capability.BLANK, priorBlanked = false, dueAtEpochMs = 1_060L)
        records = arm(records, Capability.BRIGHTNESS, priorPercent = 80, priorBlanked = true, dueAtEpochMs = 1_070L)
        val reloaded = PendingRevert.decodeAll(PendingRevert.encodeAll(records))
        assertEquals(records, reloaded)
        // The ownership flag is the thing that must not be lost across a
        // process death — it is what stops the stale priorBlanked from
        // being acted on.
        assertNotNull(reloaded.firstOrNull { it.capability == Capability.BLANK && it.ownsBlankState })
        assertNotNull(reloaded.firstOrNull { it.capability == Capability.BRIGHTNESS && !it.ownsBlankState })
    }
}
