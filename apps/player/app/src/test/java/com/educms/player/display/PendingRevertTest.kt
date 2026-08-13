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
        val brightness = PendingRevert(Capability.BRIGHTNESS, 80, false, 1L).revertAction()
        assertTrue(brightness is DisplayAction.SetBrightness)
        assertEquals(80, (brightness as DisplayAction.SetBrightness).percent)

        val volume = PendingRevert(Capability.VOLUME, 35, false, 1L).revertAction()
        assertEquals(DisplayAction.SetVolume(35), volume)

        // A test that BLANKED a previously-lit screen reverts to Wake…
        assertEquals(DisplayAction.Wake, PendingRevert(Capability.BLANK, 100, false, 1L).revertAction())
        // …and one that WOKE a deliberately-dark screen reverts to Blank.
        assertEquals(DisplayAction.Blank, PendingRevert(Capability.WAKE, 100, true, 1L).revertAction())
    }

    @Test
    fun `restoring a prior brightness is allowed below the safe floor`() {
        // The prior state is by definition one the screen was already
        // in — e.g. an overnight 0% poster the operator tested a
        // brightness bump against. Clamping the RESTORE would leave the
        // screen permanently 5% brighter than the operator set it.
        val action = PendingRevert(Capability.BRIGHTNESS, 0, false, 1L).revertAction()
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
            assertEquals("exactly five fields", 5, encoded.split("|").size)
            assertFalse(capability.name.contains("|"))
        }
    }
}
