package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE NOVASTAR SKELETON'S SAFETY CONTRACT (2026-09-02, player 1.1.15).
 *
 * [NovaStarTaurusProvider] now sits at the HEAD of the BRIGHTNESS, BLANK
 * and WAKE chains — the position the real client will need, because on a
 * Taurus it is the only mechanism that can reach the LED at all. A head-of-
 * chain provider that mis-declares support is the single most dangerous
 * shape in this package: one declarative `supports()` on `VendorRecipe` is
 * what disabled WAKE across a whole SKU with every layer reporting success.
 *
 * So this file pins the three facts that make the position harmless today:
 *   • the client is NOT built, by a compile-time constant;
 *   • therefore availability can never be READY on any device;
 *   • therefore `supports()` is empty and the chains resolve exactly as
 *     they did in 1.1.14.
 *
 * Plus the security boundary: the destructive vendor calls that share the
 * SAME authenticated session as brightness are absent from the code, not
 * merely unreached.
 */
class NovaStarTaurusProviderTest {

    // ── the id, which the server enum must already accept ────────────────

    @Test
    fun `the provider id is the contract's novastar-sdk`() {
        // Pinned against `display-mechanism-drift.spec.ts`, which parses
        // this same constant out of the Kotlin and asserts the server
        // accepts it. A rename here without one there is the P0-2 outage.
        assertEquals("novastar-sdk", NovaStarTaurusProvider.id)
    }

    // ── the availability rule ────────────────────────────────────────────

    @Test
    fun `availability reports the most actionable reason first`() {
        // A Goodview panel is told it is the wrong hardware, not that a
        // vendor library is missing — the reason an operator reads has to be
        // the one they could act on.
        assertEquals(
            NovaStarTaurusProvider.Availability.NOT_POSTER_CLASS,
            NovaStarTaurusProvider.availability(
                posterClass = false, flagOn = true, libraryPresent = true, clientLinked = true,
            ),
        )
        assertEquals(
            NovaStarTaurusProvider.Availability.DISABLED_BY_FLAG,
            NovaStarTaurusProvider.availability(
                posterClass = true, flagOn = false, libraryPresent = true, clientLinked = true,
            ),
        )
        assertEquals(
            NovaStarTaurusProvider.Availability.LIBRARY_MISSING,
            NovaStarTaurusProvider.availability(
                posterClass = true, flagOn = true, libraryPresent = false, clientLinked = true,
            ),
        )
        assertEquals(
            NovaStarTaurusProvider.Availability.CLIENT_NOT_BUILT,
            NovaStarTaurusProvider.availability(
                posterClass = true, flagOn = true, libraryPresent = true, clientLinked = false,
            ),
        )
        assertEquals(
            NovaStarTaurusProvider.Availability.READY,
            NovaStarTaurusProvider.availability(
                posterClass = true, flagOn = true, libraryPresent = true, clientLinked = true,
            ),
        )
    }

    @Test
    fun `every availability state has copy that states what is true`() {
        for (state in NovaStarTaurusProvider.Availability.values()) {
            val line = NovaStarTaurusProvider.describe(state)
            assertTrue("empty copy for $state", line.isNotBlank())
        }
        // The one an operator will actually meet on a poster today. It says
        // the layer is known and the client is not built — never "no
        // brightness control", which would be false.
        assertTrue(
            NovaStarTaurusProvider
                .describe(NovaStarTaurusProvider.Availability.CLIENT_NOT_BUILT)
                .contains("not built into this player yet"),
        )
    }

    // ── the security boundary ────────────────────────────────────────────

    @Test
    fun `the allowlist is brightness, screen power and the session, and nothing else`() {
        val allowed = NovaStarTaurusProvider.ALLOWED_SDK_CALLS
        assertTrue(allowed.contains("nvSetScreenBrightnessAsync"))
        assertTrue(allowed.contains("nvSetScreenPowerStateAsync"))
        assertTrue(allowed.contains("nvLogoutAsync"))
        for (forbidden in FORBIDDEN_CALLS) {
            assertFalse(
                "$forbidden reached the allowlist — it shares the same authenticated " +
                    "session as brightness",
                allowed.any { it.contains(forbidden) },
            )
        }
    }

    @Test
    fun `no destructive vendor call appears in the executable source`() {
        // Named in the drop-in checklist (a comment) so a future author
        // knows what NOT to add; absent from the code, which is where the
        // boundary actually lives. Comments are stripped before the check
        // so documenting the rule cannot break the rule.
        val code = stripComments(require(PROVIDER_PATH))
        for (forbidden in FORBIDDEN_CALLS) {
            assertFalse(
                "$forbidden is present in executable code",
                code.contains(forbidden),
            )
        }
        assertFalse(
            "loginType 1 is the vendor's system-settings back door — it stays out",
            code.contains("loginType"),
        )
    }

    // ── the no-op guarantee ──────────────────────────────────────────────

    @Test
    fun `the client is NOT linked in this build, so the provider can never resolve`() {
        val code = stripComments(require(PROVIDER_PATH))
        assertTrue(
            "CLIENT_LINKED is no longer a hardcoded false — this provider heads three chains " +
                "and would start winning them without an implementation behind it",
            Regex("const\\s+val\\s+CLIENT_LINKED\\s*(:\\s*Boolean\\s*)?=\\s*false").containsMatchIn(code),
        )
        assertFalse(
            "the skeleton must not load native code",
            code.contains("System.loadLibrary"),
        )
    }

    @Test
    fun `it heads the brightness, blank and wake chains`() {
        val registry = require(
            "src/main/java/com/educms/player/display/DisplayControlRegistry.kt",
        )
        for (capability in listOf("BRIGHTNESS", "BLANK", "WAKE")) {
            val chain = Regex(
                "Capability\\.$capability\\s+to\\s+listOf\\(([\\s\\S]*?)\\)",
            ).find(registry)?.groupValues?.get(1)
            assertTrue("no CHAINS entry for $capability", chain != null)
            val first = chain!!.split(",").map { it.trim() }.first { it.isNotEmpty() }
            assertEquals(
                "$capability must try NovaStar first — it is the only layer that reaches a " +
                    "Taurus LED",
                "NovaStarTaurusProvider",
                first,
            )
        }
    }

    // ── the probe's honest poster verdict ────────────────────────────────

    @Test
    fun `the probe reports novastar-sdk-pending on a poster, ahead of the registry answer`() {
        val probe = require("src/main/java/com/educms/player/display/DisplayCapabilityProbe.kt")
        assertTrue(
            "the pending verdict string is gone — display-control.ts still accepts it",
            probe.contains("\"novastar-sdk-pending\""),
        )
        val code = stripComments(probe)
        assertTrue(
            "the probe no longer reads posterClass",
            code.contains("optBoolean(\"posterClass\")"),
        )
        // ORDER IS THE POINT. The registry resolves `software-dim` on a
        // poster, and since 2026-09-02 that mechanism is PROVEN — reporting
        // it would route SET_BRIGHTNESS hard and claim our window dimmer
        // owns an LED wall it cannot reach. So the poster branch has to be
        // read BEFORE the resolved provider, inside `verdict()` itself.
        val verdictAt = code.indexOf("fun verdict(")
        assertTrue("verdict() not found", verdictAt > 0)
        val body = code.substring(verdictAt)
        val poster = body.indexOf("if (posterClass)")
        val resolvedRead = body.indexOf("optString(\"BRIGHTNESS\")")
        assertTrue("the poster brightness branch is gone", poster > 0)
        assertTrue("the registry-resolved brightness read is gone", resolvedRead > 0)
        assertTrue(
            "the poster branch must be evaluated BEFORE the registry's resolved provider",
            poster < resolvedRead,
        )
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private companion object {
        const val PROVIDER_PATH =
            "src/main/java/com/educms/player/display/NovaStarTaurusProvider.kt"

        /**
         * Reachable over the SAME authenticated TCP session as brightness.
         * `nvSetReBootTask` is included because immediate reboot needs the
         * `loginType:1` system-settings login, which is out of scope until
         * it gets a release and a review of its own.
         */
        val FORBIDDEN_CALLS = listOf(
            "nvFactoryReset",
            "nvClearAllMedia",
            "nvInstallApp",
            "nvUninstallApp",
            "nvUpgradeSystem",
            "nvSetReBootTask",
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

    /** Block comments, KDoc and line comments removed — code only. */
    private fun stripComments(src: String): String = src
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
        .replace(Regex("//[^\\n]*"), "")
}
