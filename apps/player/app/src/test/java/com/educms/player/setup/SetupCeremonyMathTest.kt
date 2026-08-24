package com.educms.player.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The setup sequence's rules.
 *
 * Two failure modes are being pinned here, and they pull in OPPOSITE
 * directions — which is why the "offering advances the sequence" rule needs
 * a test rather than a comment:
 *
 *   NAG   — re-asking a step the operator already declined, on every
 *           resume, forever.
 *   STALL — stopping at the first declined step so the remaining grants are
 *           never reached.
 *
 * Plus the one that is invisible in the field until an operator asks why
 * their screen says "3 of 5" and only ever shows four dialogs.
 */
class SetupCeremonyMathTest {

    private fun step(
        key: String,
        applies: Boolean = true,
        satisfied: Boolean = false,
        offered: Boolean = false,
    ) = StepState(key, applies, satisfied, offered)

    @Test
    fun `offers the first outstanding step in list order`() {
        val states = listOf(step("a"), step("b"), step("c"))
        assertEquals("a", SetupCeremonyMath.nextKey(states))
    }

    @Test
    fun `a satisfied step is skipped even when it was never offered`() {
        // The live grant always wins: granted by hand, by adb, or in a
        // previous install — we must not ask again.
        val states = listOf(step("a", satisfied = true), step("b"))
        assertEquals("b", SetupCeremonyMath.nextKey(states))
    }

    @Test
    fun `an offered-but-declined step does NOT block the ones after it`() {
        // THE STALL. Declining "a" must not strand "b" and "c" forever.
        val states = listOf(step("a", offered = true), step("b"), step("c"))
        assertEquals("b", SetupCeremonyMath.nextKey(states))
    }

    @Test
    fun `an offered-but-declined step is never re-offered`() {
        // THE NAG. Same state, evaluated repeatedly (every onResume) —
        // "a" must stay silent, and once everything has been offered the
        // ceremony goes quiet instead of cycling.
        var states = listOf(step("a", offered = true), step("b"))
        assertEquals("b", SetupCeremonyMath.nextKey(states))

        states = listOf(step("a", offered = true), step("b", offered = true))
        assertNull(SetupCeremonyMath.nextKey(states))
        assertTrue(SetupCeremonyMath.isComplete(states))
        // …and it stays quiet no matter how many resumes happen.
        repeat(10) { assertNull(SetupCeremonyMath.nextKey(states)) }
    }

    @Test
    fun `a step that does not apply to this box is never offered or counted`() {
        val states = listOf(
            step("a", applies = false),
            step("b"),
            step("c", applies = false),
        )
        assertEquals("b", SetupCeremonyMath.nextKey(states))
        assertEquals(listOf("b"), SetupCeremonyMath.applicable(states).map { it.key })
        // "1 of 1" — never "2 of 3" for a box that will only ever see one.
        assertEquals(1, SetupCeremonyMath.positionOf(states, "b"))
        assertEquals(0 to 1, SetupCeremonyMath.progress(states))
    }

    @Test
    fun `position is 1-based over applicable steps and 0 for one that does not apply`() {
        val states = listOf(
            step("install"),
            step("manager", applies = false), // companion not installed
            step("write-settings"),
            step("home"),
        )
        assertEquals(1, SetupCeremonyMath.positionOf(states, "install"))
        assertEquals(2, SetupCeremonyMath.positionOf(states, "write-settings"))
        assertEquals(3, SetupCeremonyMath.positionOf(states, "home"))
        assertEquals(0, SetupCeremonyMath.positionOf(states, "manager"))
        assertEquals(0, SetupCeremonyMath.positionOf(states, "no-such-step"))
    }

    @Test
    fun `progress counts granted over applicable, not over the whole list`() {
        val states = listOf(
            step("a", satisfied = true),
            step("b", satisfied = true),
            step("c"),
            step("d", applies = false, satisfied = false),
        )
        assertEquals(2 to 3, SetupCeremonyMath.progress(states))
        assertFalse(SetupCeremonyMath.isComplete(states))
    }

    @Test
    fun `a fully granted screen is complete even with nothing ever offered`() {
        // The OTA case: a screen set up long before the ceremony shipped.
        // Every grant is already held and no marker exists — it must go
        // straight to silent, never walk the operator through six dialogs.
        val states = listOf(
            step("a", satisfied = true),
            step("b", satisfied = true),
            step("c", satisfied = true),
        )
        assertNull(SetupCeremonyMath.nextKey(states))
        assertTrue(SetupCeremonyMath.isComplete(states))
        assertEquals(3 to 3, SetupCeremonyMath.progress(states))
    }

    @Test
    fun `walks the whole sequence exactly once — the field flow, start to finish`() {
        // Simulates the real loop: offer → operator acts → onResume →
        // offer next. Grants land for some steps, declines for others; the
        // ceremony must visit each step once and then stop.
        val keys = listOf("install", "manager", "write-settings", "battery", "admin", "home")
        val granted = setOf("install", "write-settings", "admin")   // the rest declined
        val offered = mutableSetOf<String>()
        val visited = mutableListOf<String>()

        repeat(50) {
            val states = keys.map {
                step(it, satisfied = it in granted && it in offered, offered = it in offered)
            }
            val next = SetupCeremonyMath.nextKey(states) ?: return@repeat
            visited += next
            offered += next
        }

        assertEquals(keys, visited)                       // each step, in order
        assertEquals(keys.size, visited.toSet().size)     // and exactly once
        val finalStates = keys.map {
            step(it, satisfied = it in granted, offered = true)
        }
        assertTrue(SetupCeremonyMath.isComplete(finalStates))
        assertEquals(3 to 6, SetupCeremonyMath.progress(finalStates))
    }

    @Test
    fun `empty and all-inapplicable lists are complete, not crashes`() {
        assertNull(SetupCeremonyMath.nextKey(emptyList()))
        assertTrue(SetupCeremonyMath.isComplete(emptyList()))
        assertEquals(0 to 0, SetupCeremonyMath.progress(emptyList()))

        val none = listOf(step("a", applies = false), step("b", applies = false))
        assertNull(SetupCeremonyMath.nextKey(none))
        assertTrue(SetupCeremonyMath.isComplete(none))
        assertEquals(0 to 0, SetupCeremonyMath.progress(none))
    }
}
