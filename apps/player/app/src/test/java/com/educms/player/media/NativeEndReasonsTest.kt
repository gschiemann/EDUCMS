package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE CLOSED SET OF NATIVE END REASONS (design §3.4) — the table stream C
 * parses to generate the page's, so it must stay a plain declaration, and it
 * must never disagree with 1.1.43's phase-0 `NativeEndGrade` about a code
 * both know. The drift between two tables is the latent defect of §1.2 (an
 * offline boot blocked native for a day); this is the guard against the next.
 */
class NativeEndReasonsTest {

    private val sets = mapOf(
        "TRANSIENT" to NativeEndReasons.TRANSIENT,
        "NOT_READY" to NativeEndReasons.NOT_READY,
        "FAULT" to NativeEndReasons.FAULT,
        "REFUSED" to NativeEndReasons.REFUSED,
    )

    @Test
    fun `the four sets are disjoint and every code is a bounded wire token`() {
        val all = sets.values.flatten()
        assertEquals("a code belongs to exactly one set", all.size, all.toSet().size)
        assertEquals(all.toSet(), NativeEndReasons.ALL)
        for (code in all) assertTrue(code, Regex("[a-z0-9-]{1,64}").matches(code))
    }

    @Test
    fun `every code both tables know has the same grade as 1_1_43's NativeEndGrade`() {
        val known = NativeEndGrade.TRANSIENT + NativeEndGrade.NOT_READY + NativeEndGrade.BOX + NativeEndGrade.FAULT
        val expected = mapOf(
            "TRANSIENT" to NativeEndGrade.Grade.TRANSIENT,
            "NOT_READY" to NativeEndGrade.Grade.NOT_READY,
            "FAULT" to NativeEndGrade.Grade.FAULT,
            "REFUSED" to NativeEndGrade.Grade.BOX,
        )
        for ((name, set) in sets) for (code in set) {
            val explicit = code in known || NativeEndGrade.NOT_READY_PREFIXES.any { code.startsWith(it) }
            if (explicit) assertEquals("$code ($name)", expected.getValue(name), NativeEndGrade.grade(code))
        }
    }

    @Test
    fun `every raw code NativeEndGrade lists folds onto a member with the same block and retry verdict`() {
        val raw = NativeEndGrade.TRANSIENT + NativeEndGrade.NOT_READY + NativeEndGrade.BOX + NativeEndGrade.FAULT +
            listOf("manifest-http-503", "manifest-http-401", "media-http-404", "descriptor-version", "descriptor-format")
        for (code in raw) {
            val folded = NativeEndReasons.normalize(code)
            assertTrue("$code → $folded is a member", folded in NativeEndReasons.ALL)
            assertEquals("$code → $folded: the 24 h block verdict", NativeEndGrade.blocks(code), NativeEndReasons.isFault(folded))
            assertEquals("$code → $folded: the retry verdict", NativeEndGrade.retries(code),
                NativeEndReasons.isTransient(folded) || NativeEndReasons.isNotReady(folded))
        }
    }

    @Test
    fun `the latent defect - an offline boot, a 5xx, a short download are never a verdict on the file`() {
        for (code in listOf("authorization-failed", "timeout", "manifest-http-503", "media-incomplete", "source-failed",
            "media-missing", "media-cache-quota", "api-root", "credential-missing")) {
            val folded = NativeEndReasons.normalize(code)
            assertFalse("$code → $folded must never block native", NativeEndReasons.isFault(folded))
            assertEquals("$code → $folded", NativeEndReasons.NEXT_WAIT, NativeEndReasons.next(folded))
        }
        // …and nothing outside the table ever reaches the page.
        assertEquals("native-prepare", NativeEndReasons.normalize("Some Exception Text"))
        assertEquals("native-prepare", NativeEndReasons.normalize("something-brand-new"))
        assertEquals("codec-failed", NativeEndReasons.normalize("something-brand-new", fallback = "codec-failed"))
    }

    @Test
    fun `the split of page-stopped and the v4 codes are members, and deliberate ends never settle`() {
        for (code in listOf("page-requested", "lifecycle-not-ready", "operator-ui", "released", "page-stopped")) {
            assertTrue(code, NativeEndReasons.isTransient(code))
        }
        for (code in listOf("native-first-off", "lease-retired")) assertTrue(code, NativeEndReasons.isRefused(code))
        assertTrue(NativeEndReasons.isFault("blocked"))
        val tracker = TransientEndTracker()
        val key = TransientEndTracker.key(0, "a".repeat(64))
        // The engine never feeds a deliberate end (an alert drill, the operator, the page) to the tracker.
        for (code in PlaybackSessionPolicy.DELIBERATE) assertTrue("$code is transient", NativeEndReasons.isTransient(code))
        // An unstable box: more than five ends in ten minutes settle the content.
        repeat(TransientEndTracker.MAX_IN_WINDOW) { assertFalse(tracker.ended(key, "output-detached", it * 1_000L)) }
        assertTrue(tracker.ended(key, "output-detached", 6_000L))
        assertTrue(tracker.settled(key))
        tracker.reset(key)
        assertFalse("the content changed", tracker.settled(key))
        // Spread over more than the window, the same count never settles.
        repeat(20) { assertFalse(tracker.ended(key, "decoder-unavailable", it * (TransientEndTracker.WINDOW_MS / 4))) }
        // A fault is never counted as a transient end.
        assertFalse(tracker.ended(TransientEndTracker.key(1, "b".repeat(64)), "codec-failed", 0L))
    }

    /** The parser stream C uses, in Kotlin: `val NAME: Set<String> = setOf(` … `)`, one quoted literal per line. */
    @Test
    fun `the table is a plain parseable declaration and the parse equals the runtime sets`() {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not on disk", root != null)
        val file = File(root, "src/main/java/com/educms/player/media/NativeEndReasons.kt")
        Assume.assumeTrue("source not on disk", file.isFile)
        val parsed = HashMap<String, MutableSet<String>>()
        var current: String? = null
        for (line in file.readLines()) {
            val t = line.trim()
            val open = Regex("^val ([A-Z_]+): Set<String> = setOf\\($").find(t)
            when {
                open != null -> { current = open.groupValues[1]; parsed[current!!] = HashSet() }
                current != null && t == ")" -> current = null
                current != null && t.startsWith("//") -> Unit
                current != null -> {
                    val m = Regex("^\"([a-z0-9-]{1,64})\",$").find(t)
                    assertTrue("line `$t` in $current is not one quoted literal", m != null)
                    parsed.getValue(current!!).add(m!!.groupValues[1])
                }
            }
        }
        assertEquals(sets.keys, parsed.keys)
        for ((name, set) in sets) assertEquals(name, set, parsed.getValue(name))
    }
}
