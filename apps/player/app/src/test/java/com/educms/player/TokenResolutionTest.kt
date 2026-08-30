package com.educms.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-08-30 player reliability program, W2-1 — the decision table for
 * "which native token does this screen actually use, and when does the
 * legacy store get emptied."
 *
 * The production bug these lock down: a stale token in the legacy
 * DataStore outliving APK updates and being re-injected into the player
 * URL on every native reload, downgrading a credential the web player had
 * already rotated.
 */
class TokenResolutionTest {

    /** Records what the resolver did to each store. */
    private class Spy(
        var prefs: String? = null,
        var legacy: String? = null,
    ) {
        var prefsWrites = mutableListOf<String>()
        var legacyCleared = false

        fun resolve(): String? = resolveNativeToken(
            getPrefsToken = { prefs },
            getLegacyToken = { legacy },
            writePrefsToken = { prefsWrites += it; prefs = it },
            clearLegacyToken = { legacyCleared = true; legacy = null },
        )
    }

    @Test
    fun `prefs token wins and the legacy store is left alone`() {
        val spy = Spy(prefs = "prefs-token", legacy = null)
        assertEquals("prefs-token", spy.resolve())
        assertTrue("no write needed when prefs already holds it", spy.prefsWrites.isEmpty())
        assertFalse(spy.legacyCleared)
    }

    @Test
    fun `legacy token migrates forward and is then cleared`() {
        val spy = Spy(prefs = null, legacy = "legacy-token")
        assertEquals("legacy-token", spy.resolve())
        assertEquals(listOf("legacy-token"), spy.prefsWrites)
        assertTrue("legacy MUST be cleared or it resurrects after unpair", spy.legacyCleared)
    }

    @Test
    fun `migration is one-way — a second resolve reads prefs and touches nothing`() {
        val spy = Spy(prefs = null, legacy = "legacy-token")
        spy.resolve()
        spy.legacyCleared = false
        spy.prefsWrites.clear()

        assertEquals("legacy-token", spy.resolve())
        assertTrue(spy.prefsWrites.isEmpty())
        assertFalse(spy.legacyCleared)
    }

    @Test
    fun `both stores empty resolves to null`() {
        val spy = Spy(prefs = null, legacy = null)
        assertNull(spy.resolve())
        assertTrue(spy.prefsWrites.isEmpty())
        assertFalse(spy.legacyCleared)
    }

    @Test
    fun `blank strings are treated as empty in both stores`() {
        val bothBlank = Spy(prefs = "   ", legacy = "")
        assertNull(bothBlank.resolve())
        assertFalse(bothBlank.legacyCleared)

        // A blank prefs value must not shadow a real legacy token.
        val blankPrefs = Spy(prefs = "", legacy = "legacy-token")
        assertEquals("legacy-token", blankPrefs.resolve())
        assertEquals(listOf("legacy-token"), blankPrefs.prefsWrites)
        assertTrue(blankPrefs.legacyCleared)

        // A blank legacy value is not a migration candidate.
        val blankLegacy = Spy(prefs = null, legacy = "  ")
        assertNull(blankLegacy.resolve())
        assertFalse(blankLegacy.legacyCleared)
    }

    @Test
    fun `prefs wins over legacy and migration does NOT fire`() {
        val spy = Spy(prefs = "prefs-token", legacy = "stale-legacy-token")
        assertEquals("prefs-token", spy.resolve())
        assertTrue(spy.prefsWrites.isEmpty())
        assertFalse(
            "migration only fires when prefs is empty — otherwise it would " +
                "be a pointless second write on the boot path",
            spy.legacyCleared,
        )
        assertEquals("stale-legacy-token", spy.legacy)
    }

    @Test
    fun `the resolved token is never the stale legacy one once prefs is populated`() {
        // The regression this whole work item exists to prevent.
        val spy = Spy(prefs = "fresh-rotated-token", legacy = "expired-2024-token")
        assertEquals("fresh-rotated-token", spy.resolve())
    }
}
