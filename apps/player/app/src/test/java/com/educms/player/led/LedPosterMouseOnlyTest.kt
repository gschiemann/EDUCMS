package com.educms.player.led

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * A NOVASTAR LED POSTER HAS NO REMOTE (operator, 2026-09-02 — player
 * 1.1.15).
 *
 * The only input on those controllers is a USB mouse, and the pointer is
 * invisible outside the 320 px the LED shows. Everything below follows from
 * that one hardware fact, and each assertion here corresponds to a way the
 * 1.1.14 build was wrong on this hardware:
 *
 *  • Key copy ("Press OK", "Back to skip") is not merely unhelpful, it is
 *    FALSE — those keys do not exist. `LedSystemPromptBanner` no longer
 *    accepts key copy at all, and no caller may pass it.
 *  • A mouse cannot click a dialog Android drew at x≈960 on a screen whose
 *    glass ends at x=320. So the column must carry a real CLICKABLE escape,
 *    and a self-return for an operator who already walked away.
 *  • Every button we draw in the column has to be reachable by pointer —
 *    a focus-driven control with no click listener would be dead here.
 *
 * Source-parsing, deliberately: these are Android View/Activity paths that a
 * JVM test cannot instantiate, and the claim being pinned is about the CODE
 * ("no key copy exists on this path"), which a parse can prove and a mock
 * cannot.
 */
class LedPosterMouseOnlyTest {

    // ── 1. no key instructions anywhere on the poster path ───────────────

    @Test
    fun `the poster banner never tells anyone to press a key`() {
        val code = stripComments(require(BANNER))
        for (phrase in KEY_PHRASES) {
            assertFalse(
                "the LED banner still says \"$phrase\" — a poster has no remote",
                code.contains(phrase, ignoreCase = true),
            )
        }
    }

    @Test
    fun `no caller hands key copy to the poster banner`() {
        // The banner is poster-only, so ANY key copy reaching it is wrong.
        // The two files that raise it are checked as a whole rather than
        // argument-by-argument: neither has a legitimate reason to carry
        // "press OK" copy at all now that the D-pad dialogs are gone from
        // this path.
        for (path in listOf(MAIN, CEREMONY)) {
            val src = require(path)
            val announceArgs = Regex(
                "LedSystemPromptBanner\\.announce\\(([\\s\\S]{0,400}?)\\)",
            ).findAll(src).map { it.groupValues[1] }.toList()
            assertTrue("no announce() call found in $path", announceArgs.isNotEmpty())
            for (args in announceArgs) {
                for (phrase in KEY_PHRASES) {
                    assertFalse(
                        "$path announces with key copy (\"$phrase\") — a poster has no remote",
                        args.contains(phrase, ignoreCase = true),
                    )
                }
            }
        }
    }

    @Test
    fun `the ceremony no longer carries per-step key copy at all`() {
        val src = require(CEREMONY)
        assertFalse(
            "promptKeys is back — it fed remote-key copy to a mouse-only banner",
            Regex("val\\s+promptKeys\\s*:").containsMatchIn(src),
        )
    }

    // ── 2. the clickable escape from an off-glass Android page ───────────

    @Test
    fun `the banner carries a clickable way back, not a focusable one`() {
        val code = stripComments(require(BANNER))
        assertTrue(
            "the escape button is gone — a mouse cannot reach an off-glass page without it",
            code.contains("BRING_BACK_LABEL"),
        )
        assertTrue(
            "the escape must be clickable: a pointer, not a D-pad, is the input here",
            code.contains("isClickable = true"),
        )
        assertTrue(
            "the escape must NOT be focusable — it would take the selection from the " +
                "checklist button on the remote-driven panels this banner also compiles for",
            code.contains("isFocusable = false"),
        )
        assertTrue("no click listener on the escape", code.contains("setOnClickListener"))
        assertTrue(
            "the escape needs a minHeight the narrow-column fit cannot shrink — fitNarrow " +
                "scales padding by ~0.44 on a 320 px poster and would leave a ~19 px target",
            code.contains("minHeight = dp(44)"),
        )
    }

    @Test
    fun `coming back reorders our own task and never starts a second one`() {
        val code = stripComments(require(BANNER))
        assertTrue(
            "FLAG_ACTIVITY_REORDER_TO_FRONT is what raises the EXISTING activity over the " +
                "foreign one — without it we are not covering anything",
            code.contains("FLAG_ACTIVITY_REORDER_TO_FRONT"),
        )
        assertTrue(code.contains("FLAG_ACTIVITY_SINGLE_TOP"))
        assertFalse(
            "NEW_TASK from an Activity context makes a SECOND task instead of raising this one",
            code.contains("FLAG_ACTIVITY_NEW_TASK"),
        )
        assertFalse(
            "CLEAR_TOP cannot be combined with REORDER_TO_FRONT, and would reload content",
            code.contains("FLAG_ACTIVITY_CLEAR_TOP"),
        )
    }

    @Test
    fun `an unanswered page gets a sixty-second self-return`() {
        assertEquals(60_000L, LedSystemPromptBanner.AUTO_RETURN_MS)
        val code = stripComments(require(BANNER))
        assertTrue("the auto-return is not armed", code.contains("postDelayed(autoReturn"))
        assertTrue(
            "the auto-return must be cancelled when the banner goes away, or a dismissed " +
                "banner still yanks the task forward a minute later",
            code.contains("removeCallbacks(autoReturn)"),
        )
        assertTrue(
            "the auto-return must not fire while VenueOS is already in front",
            code.contains("hasWindowFocus()"),
        )
    }

    @Test
    fun `the return is reported as REQUESTED, never as achieved`() {
        // Android 10+ drops a background startActivity silently — no
        // exception, no result code. Claiming we came back would be a claim
        // this process cannot check (player rule 10).
        val code = stripComments(require(BANNER))
        assertTrue(
            "the log must say the return was requested, not that it happened",
            code.contains("requested a return to VenueOS"),
        )
    }

    // ── 3. everything we draw in the column is pointer-operable ──────────

    @Test
    fun `every control the column can show has a click listener`() {
        // A control that only answers a D-pad is dead on this hardware. The
        // three surfaces that can be the ONLY thing on a poster's glass:
        // the setup checklist, the boot diagnostic, and the companion
        // install gate.
        val checklist = require("src/main/java/com/educms/player/setup/SetupChecklistView.kt")
        assertTrue(
            "the checklist's primary button has no click listener",
            checklist.contains("setOnClickListener { primaryKey?.let(onGrant) }"),
        )
        assertTrue(
            "the checklist's secondary button has no click listener",
            checklist.contains("setOnClickListener { onSecondary() }"),
        )
        assertTrue(
            "checklist rows must be tappable — they are the only route to a declined grant",
            checklist.contains("setOnClickListener { onGrant(row.key) }"),
        )

        val diagnostics = require("src/main/java/com/educms/player/boot/BootDiagnosticsView.kt")
        for (action in listOf("onRetry()", "onNetworkSettings()", "onExit()")) {
            assertTrue(
                "the boot diagnostic's $action button has no click listener",
                diagnostics.contains("setOnClickListener { $action }"),
            )
        }

        val gate = require("src/main/res/layout/activity_main.xml")
        assertTrue(
            "the companion install gate's retry control must be a real Button",
            gate.contains("android:id=\"@+id/managerGateRetry\""),
        )
    }

    @Test
    fun `no poster surface swallows pointer events before its buttons see them`() {
        // The scrim roots are deliberately clickable (they must not let a
        // tap fall through to the live WebView underneath). That is safe —
        // a parent's onTouchEvent only runs when no child consumed the
        // event — but an onTouchListener ON THE ROOT would intercept first
        // and is how a card becomes unclickable.
        for (path in listOf(
            "src/main/java/com/educms/player/setup/SetupChecklistView.kt",
            "src/main/java/com/educms/player/boot/BootDiagnosticsView.kt",
            BANNER,
        )) {
            val code = stripComments(require(path))
            assertFalse(
                "$path installs a touch interceptor — verify it cannot eat a mouse click " +
                    "meant for a button before removing this guard",
                code.contains("setOnTouchListener") || code.contains("onInterceptTouchEvent"),
            )
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private companion object {
        const val BANNER = "src/main/java/com/educms/player/led/LedSystemPromptBanner.kt"
        const val MAIN = "src/main/java/com/educms/player/MainActivity.kt"
        const val CEREMONY = "src/main/java/com/educms/player/setup/SetupCeremony.kt"

        /** Copy that presumes a remote. None of it is true on a poster. */
        val KEY_PHRASES = listOf(
            "press ok",
            "back to skip",
            "with ok",
            "use the remote",
            "back returns",
        )
    }

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun require(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private fun stripComments(src: String): String = src
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
        .replace(Regex("//[^\\n]*"), "")
}
