package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Dead-man revert persistence.
 *
 * This record is what un-blanks a screen after the process that blanked
 * it died. It is written with `commit()` BEFORE the action is applied
 * and replayed on the next process start, so its encode/decode round
 * trip has to survive a reboot with no parser and no dependencies —
 * which is exactly why it is a fixed pipe-delimited line rather than
 * JSON (org.json is stubbed in JVM unit tests, so a JSON record could
 * not have this test at all without pulling a parser into the APK).
 */
class PendingRevertTest {

    @Test
    fun `round-trips through the persisted form`() {
        listOf(
            PendingRevert(Capability.BRIGHTNESS, 80, false, 1_760_000_000_000L),
            PendingRevert(Capability.VOLUME, 0, false, 1L),
            PendingRevert(Capability.BLANK, 100, true, Long.MAX_VALUE),
            PendingRevert(Capability.WAKE, 55, false, 42L),
            PendingRevert(Capability.REBOOT, 100, false, 99L),
        ).forEach { original ->
            val decoded = PendingRevert.decode(original.encode())
            assertEquals("round trip must be lossless for $original", original, decoded)
        }
    }

    @Test
    fun `unreadable records decode to null so nothing is acted on`() {
        // A record we cannot fully understand must never drive the
        // screen somewhere — "nothing pending" is the safe reading.
        listOf(
            null,
            "",
            "   ",
            "v1|BRIGHTNESS|80|0",                       // too few fields
            "v1|BRIGHTNESS|80|0|123|extra",             // too many
            "v2|BRIGHTNESS|80|0|123",                   // future version
            "v1|NOT_A_CAPABILITY|80|0|123",             // unknown capability
            "v1|BRIGHTNESS|abc|0|123",                  // percent NaN
            "v1|BRIGHTNESS|101|0|123",                  // percent out of range
            "v1|BRIGHTNESS|-1|0|123",
            "v1|BRIGHTNESS|80|maybe|123",               // blanked not 0/1
            "v1|BRIGHTNESS|80|0|abc",                   // due NaN
            "v1|BRIGHTNESS|80|0|0",                     // due epoch 0
            "v1|BRIGHTNESS|80|0|-5",
            """{"capability":"BRIGHTNESS"}""",           // someone switched to JSON
        ).forEach { raw ->
            assertNull("must decode to null: '$raw'", PendingRevert.decode(raw))
        }
    }

    @Test
    fun `surrounding whitespace is tolerated`() {
        val record = PendingRevert(Capability.BRIGHTNESS, 80, false, 12345L)
        assertEquals(record, PendingRevert.decode("  ${record.encode()}\n"))
    }

    @Test
    fun `due-ness is a plain wall-clock comparison`() {
        val record = PendingRevert(Capability.BRIGHTNESS, 80, false, 1000L)
        assertFalse(record.isDue(999L))
        assertTrue("exactly at the due instant counts", record.isDue(1000L))
        assertTrue(record.isDue(5000L))
    }

    @Test
    fun `the revert action restores the snapshotted state`() {
        // NOTE (2026-08-13): `revertAction()` became `revertActions()`
        // — a LIST — because a brightness revert on a box whose blank is
        // a vendor power broadcast has to wake the panel too, not just
        // write a sysfs value into a display that is still powered off.
        // The assertions below are the same ones, over the list.
        val brightness = PendingRevert(Capability.BRIGHTNESS, 80, false, 1L).revertActions()
        assertEquals(DisplayAction.SetBrightness(80, allowBlack = true), brightness.first())

        val volume = PendingRevert(Capability.VOLUME, 35, false, 1L).revertActions()
        assertEquals(listOf(DisplayAction.SetVolume(35)), volume)

        // A test that BLANKED a previously-lit screen reverts to Wake…
        assertEquals(
            listOf(DisplayAction.Wake),
            PendingRevert(Capability.BLANK, 100, false, 1L).revertActions(),
        )
        // …and one that WOKE a deliberately-dark screen reverts to Blank.
        assertEquals(
            listOf(DisplayAction.Blank),
            PendingRevert(Capability.WAKE, 100, true, 1L).revertActions(),
        )
    }

    @Test
    fun `restoring a prior brightness is allowed below the safe floor`() {
        // The prior state is by definition one the screen was already
        // in — e.g. an overnight 0% poster the operator tested a
        // brightness bump against. Clamping the RESTORE would leave the
        // screen permanently 5% brighter than the operator set it.
        val action = PendingRevert(Capability.BRIGHTNESS, 0, false, 1L).revertActions().first()
        assertTrue(action is DisplayAction.SetBrightness)
        assertTrue("the revert must be allowed to reach 0", (action as DisplayAction.SetBrightness).allowBlack)
        assertEquals(0, (DisplayLimits.normalize(action) as DisplayAction.SetBrightness).percent)
    }

    @Test
    fun `the encoded form has no separator collisions`() {
        // The delimiter is '|' and no encoded field can contain one:
        // capability names are enum identifiers, the rest are numbers.
        Capability.values().forEach { capability ->
            val encoded = PendingRevert(capability, 50, true, 123L).encode()
            assertEquals("exactly six fields", 6, encoded.split("|").size)
            assertFalse(capability.name.contains("|"))
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // P0 (2026-08-13) — the single-slot dead-man revert bug.
    //
    // v1 stored ONE record. A second armed action overwrote the first
    // AND snapshotted the already-applied state as "prior", so the first
    // action became permanent with no record and no alarm — a
    // permanently dark wall-mounted screen. These tests pin the record
    // half of the fix; DisplayGuardMergeTest pins the merge policy.
    // ─────────────────────────────────────────────────────────────────

    @Test
    fun `a set round-trips and keeps one record per capability`() {
        val records = listOf(
            PendingRevert(Capability.BLANK, 100, false, 1_000L, ownsBlankState = true),
            PendingRevert(Capability.BRIGHTNESS, 80, true, 2_000L, ownsBlankState = false),
            PendingRevert(Capability.VOLUME, 35, false, 3_000L, ownsBlankState = false),
        )
        assertEquals(records, PendingRevert.decodeAll(PendingRevert.encodeAll(records)))
    }

    @Test
    fun `a corrupt line cannot cost the screen the other outstanding reverts`() {
        val good = PendingRevert(Capability.BLANK, 100, false, 1_000L, ownsBlankState = true)
        val raw = listOf("v9|GARBAGE|x|y|z", good.encode(), "").joinToString("\n")
        assertEquals(listOf(good), PendingRevert.decodeAll(raw))
    }

    @Test
    fun `v1 records still decode, with v1's exact blank-state semantics`() {
        // A device that took this APK while a v1 record was on disk must
        // still get its screen back. v1 only ever drove on/off from a
        // BLANK/WAKE record, so that is what ownsBlankState derives to.
        val blank = PendingRevert.decode("v1|BLANK|100|0|1234")
        assertEquals(
            PendingRevert(Capability.BLANK, 100, false, 1234L, ownsBlankState = true),
            blank,
        )
        val brightness = PendingRevert.decode("v1|BRIGHTNESS|80|1|1234")
        assertEquals(
            PendingRevert(Capability.BRIGHTNESS, 80, true, 1234L, ownsBlankState = false),
            brightness,
        )
        // …and a v1 BRIGHTNESS record must NOT emit a blank action, which
        // is exactly what v1 did.
        assertEquals(
            listOf(DisplayAction.SetBrightness(80, allowBlack = true)),
            brightness!!.revertActions(),
        )
    }

    @Test
    fun `only the record that owns blank state may drive on-off`() {
        // THE BUG: with two records in flight, restoring on/off from BOTH
        // re-creates the dark screen in a new order — the BLANK revert
        // wakes the panel, then the BRIGHTNESS revert's stale
        // priorBlanked=true blacks it out again with nothing left to
        // undo it.
        val notOwner = PendingRevert(Capability.BRIGHTNESS, 40, true, 1L, ownsBlankState = false)
        assertEquals(
            "a non-owner must emit the value restore and nothing else",
            listOf(DisplayAction.SetBrightness(40, allowBlack = true)),
            notOwner.revertActions(),
        )

        val owner = PendingRevert(Capability.BRIGHTNESS, 40, true, 1L, ownsBlankState = true)
        assertEquals(
            listOf(DisplayAction.SetBrightness(40, allowBlack = true), DisplayAction.Blank),
            owner.revertActions(),
        )
    }

    @Test
    fun `a sole brightness revert wakes the panel it may have been applied behind`() {
        // On a vendor box brightness (sysfs) and blank (power broadcast)
        // are unrelated mechanisms: writing a brightness value to a panel
        // that is powered OFF changes nothing visible. The owner record
        // must emit the Wake as well.
        val record = PendingRevert(Capability.BRIGHTNESS, 60, false, 1L, ownsBlankState = true)
        assertEquals(
            listOf(DisplayAction.SetBrightness(60, allowBlack = true), DisplayAction.Wake),
            record.revertActions(),
        )
    }

    @Test
    fun `restoring a deliberate 0 percent does not force a wake`() {
        // priorPercent == 0 with priorBlanked == false is an overnight
        // "dark by intent" poster. Waking it would fight the operator's
        // own setting, so the trailing Wake is skipped.
        val record = PendingRevert(Capability.BRIGHTNESS, 0, false, 1L, ownsBlankState = true)
        assertEquals(
            listOf(DisplayAction.SetBrightness(0, allowBlack = true)),
            record.revertActions(),
        )
    }

    @Test
    fun `a reboot record can never drive the screen anywhere`() {
        // The guard refuses to arm one; this keeps the type total.
        assertTrue(PendingRevert(Capability.REBOOT, 100, true, 1L).revertActions().isEmpty())
    }

    @Test
    fun `an empty set encodes and decodes to nothing pending`() {
        assertEquals("", PendingRevert.encodeAll(emptyList()))
        assertTrue(PendingRevert.decodeAll("").isEmpty())
        assertTrue(PendingRevert.decodeAll(null).isEmpty())
        assertTrue(PendingRevert.decodeAll("   ").isEmpty())
    }
}
