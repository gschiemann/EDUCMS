package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ADVERSARIAL tests for the vendor-recipe allowlist.
 *
 * The premise of every case below is that the recipe was written by an
 * attacker — a compromised control plane, a stale prefs blob from an
 * older build, or JavaScript in an operator-authored board iframe that
 * reached the every-frame legacy bridge. A recipe tells the player to
 * fire broadcasts and write sysfs on a device-owner kiosk, so this
 * allowlist is the security boundary of the whole display-control
 * feature and it is tested as one.
 *
 * ⚠️ CONVENTION: every "unsafe character" case is built from a
 * CODEPOINT (`code.toChar()`), never typed literally. A raw control byte
 * in a source file is invisible in review and behaves differently across
 * toolchains — which is not hypothetical here: the first version of the
 * production check was `it == ' ' || it == '\n' || it == '\r'` and the
 * space literal reached disk as a NUL byte, silently disarming the
 * check. See `every whitespace and control codepoint is treated as
 * unsafe` below.
 *
 * All of it is pure Kotlin — no android.* — so these run on a plain JVM
 * and can never be skipped for want of an emulator.
 */
class RecipeValidatorTest {

    /**
     * Codepoints that must never appear in a path, an intent action or a
     * literal value: NUL, tab, LF, VT, FF, CR, ASCII space, DEL,
     * non-breaking space, and the Unicode line separator.
     */
    private val UNSAFE_CODES = listOf(0x00, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x7F, 0xA0, 0x2028)

    // ─── sysfs: path traversal ──────────────────────────────────────

    @Test
    fun `sysfs path escaping the root with dot-dot is rejected`() {
        val hostile = listOf(
            "/sys/class/backlight/../../../etc/passwd",
            "/sys/class/backlight/../../kernel/uevent_helper",
            "/sys/class/leds/../../../../data/data/com.educms.player/shared_prefs/edu_player.xml",
            "/sys/class/backlight/panel0/../../../../proc/sys/kernel/core_pattern",
            "/sys/class/leds/..",
            "/sys/class/backlight/./../../dev/kmsg",
        )
        hostile.forEach { path ->
            assertNull("path traversal must be rejected: $path", RecipeAllowlist.canonicalSysfsPath(path))
            assertTrue(
                "recipe carrying $path must be rejected whole",
                validateSysfsPath(path) is RecipeCheck.Rejected,
            )
        }
    }

    @Test
    fun `sysfs path outside the allowlisted roots is rejected`() {
        val hostile = listOf(
            "/data/data/com.educms.player/files/x",
            "/proc/sys/kernel/core_pattern",
            "/sys/kernel/uevent_helper",
            "/sys/class/net/wlan0/flags",
            "/dev/kmsg",
            "/system/bin/sh",
            "/sdcard/payload",
            // Prefix-adjacent: the trailing slash in the allowlisted
            // root is what stops these.
            "/sys/class/backlightEVIL/brightness",
            "/sys/class/ledsEVIL/brightness",
            // The root directory itself is not a writable node.
            "/sys/class/backlight",
            "/sys/class/leds",
        )
        hostile.forEach { path ->
            assertNull("must be rejected: $path", RecipeAllowlist.canonicalSysfsPath(path))
        }
    }

    @Test
    fun `sysfs path carrying any whitespace or control byte is rejected`() {
        val base = "/sys/class/backlight/panel0/bright"
        UNSAFE_CODES.forEach { code ->
            val path = base + code.toChar() + "ness"
            assertNull(
                "codepoint 0x${code.toString(16)} must be rejected inside a path",
                RecipeAllowlist.canonicalSysfsPath(path),
            )
            assertTrue(
                "a recipe carrying codepoint 0x${code.toString(16)} must be rejected whole",
                validateSysfsPath(path) is RecipeCheck.Rejected,
            )
        }
    }

    @Test
    fun `sysfs path that is relative, empty or over-long is rejected`() {
        listOf(
            "sys/class/backlight/panel0/brightness", // not absolute
            "",
            "   ",
            "/sys/class/backlight/" + "a".repeat(300), // over-length
        ).forEach { path ->
            assertNull("must be rejected: '${path.take(40)}'", RecipeAllowlist.canonicalSysfsPath(path))
        }
    }

    /**
     * REGRESSION GUARD, 2026-08-13 — do not delete.
     *
     * The unsafe-character check was originally three char literals,
     * `it == ' ' || it == '\n' || it == '\r'`. The space literal reached
     * disk as a raw NUL byte, so the COMPILED predicate tested
     * `it == <NUL>` and `/sys/class/backlight/panel0/bright ness`
     * sailed through an allowlist whose entire job is refusing exactly
     * that. It compiled clean, `Read` rendered the source as correct,
     * and only this suite caught it — the disassembly showed `ifeq`
     * (compare-to-zero) where a `bipush 32` should have been.
     *
     * Same failure class as the 2026-05-09 Safari bug in CLAUDE.md,
     * where a literal LF byte inside a regex literal killed the whole
     * holiday bridge in WebKit for two months.
     *
     * `RecipeAllowlist.hasUnsafeChar` is now codepoint-based with no
     * character literals at all. This test is what keeps it that way.
     */
    @Test
    fun `every whitespace and control codepoint is treated as unsafe`() {
        // Every C0 control byte plus the space that started this.
        (0x00..0x20).forEach { code ->
            assertTrue(
                "codepoint 0x${code.toString(16)} must be unsafe",
                RecipeAllowlist.hasUnsafeChar("ok" + code.toChar() + "ok"),
            )
        }
        UNSAFE_CODES.forEach { code ->
            assertTrue(
                "codepoint 0x${code.toString(16)} must be unsafe",
                RecipeAllowlist.hasUnsafeChar("ok" + code.toChar() + "ok"),
            )
        }
        assertFalse(RecipeAllowlist.hasUnsafeChar("/sys/class/backlight/panel0/brightness"))
        assertFalse(RecipeAllowlist.hasUnsafeChar("com.gv.display.SET_POWER"))
        assertFalse(RecipeAllowlist.hasUnsafeChar(""))
    }

    @Test
    fun `a legitimate backlight path is accepted`() {
        listOf(
            "/sys/class/backlight/panel0/brightness",
            "/sys/class/leds/lcd-backlight/brightness",
            "/sys/class/leds/backlight/bl_power",
        ).forEach { path ->
            assertNotNull("must be accepted: $path", RecipeAllowlist.canonicalSysfsPath(path))
            assertTrue(validateSysfsPath(path).valid)
        }
    }

    // ─── broadcast: namespace allowlist ─────────────────────────────

    @Test
    fun `broadcast action outside an allowlisted vendor namespace is rejected`() {
        val hostile = listOf(
            // The reason `android.` is not on the allowlist.
            "android.intent.action.MASTER_CLEAR",
            "android.intent.action.FACTORY_RESET",
            "android.intent.action.ACTION_SHUTDOWN",
            "android.intent.action.REBOOT",
            "android.provider.Telephony.SECRET_CODE",
            "com.android.internal.intent.action.SOMETHING",
            // Our own OTA trigger — a recipe must not be able to drive
            // Manager's install path.
            "com.educms.manager.TRIGGER_OTA_CHECK",
            "com.educms.player.OTA_INSTALL_RESULT",
            "com.educms.player.DISPLAY_REVERT",
            // Prefix-adjacent: allowlist entries end in a dot on purpose.
            "com.tclEVIL.SET_POWER",
            "com.novastarEVIL.brightness",
            "com.gvEVIL.SET_BACKLIGHT",
            "",
            "SET_POWER",
        )
        hostile.forEach { action ->
            assertTrue("must be rejected: '$action'", validateBroadcast(action) is RecipeCheck.Rejected)
        }
    }

    @Test
    fun `broadcast action with illegal characters is rejected`() {
        listOf(
            "com.gv.display/SET_POWER", // slash — component-ish
            "com.gv.display;rm -rf /",
            "com.gv.../SET_POWER",
            "com.gv." + "a".repeat(200), // over-length
        ).forEach { action ->
            assertTrue("must be rejected: '${action.take(40)}'", validateBroadcast(action) is RecipeCheck.Rejected)
        }
        UNSAFE_CODES.forEach { code ->
            val action = "com.gv.display." + code.toChar() + "SET_POWER"
            assertTrue(
                "codepoint 0x${code.toString(16)} must be rejected in an action",
                validateBroadcast(action) is RecipeCheck.Rejected,
            )
        }
    }

    @Test
    fun `a legitimate vendor broadcast is accepted`() {
        listOf(
            "com.gv.display.SET_BACKLIGHT",
            "com.goodview.SET_POWER",
            "com.novastar.display.BRIGHTNESS",
            "com.tcl.signage.SET_POWER",
            "com.educms.display.TEST",
        ).forEach { action ->
            assertTrue("must be accepted: $action", validateBroadcast(action).valid)
        }
    }

    @Test
    fun `broadcast extras are bounded and typed`() {
        val base = "com.gv.display.SET_BACKLIGHT"

        // Too many extras.
        val tooMany = (0..20).map {
            RecipeExtra("k$it", RecipeExtraType.INT, RecipeValueSource.LITERAL, "1")
        }
        assertTrue(validateBroadcast(base, tooMany) is RecipeCheck.Rejected)

        // Illegal extra key.
        assertTrue(
            validateBroadcast(
                base,
                listOf(RecipeExtra("bad key", RecipeExtraType.INT, RecipeValueSource.LITERAL, "1")),
            ) is RecipeCheck.Rejected,
        )

        // Duplicate keys.
        assertTrue(
            validateBroadcast(
                base,
                listOf(
                    RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, "1"),
                    RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, "0"),
                ),
            ) is RecipeCheck.Rejected,
        )

        // Literal that does not match its declared type.
        assertTrue(
            validateBroadcast(
                base,
                listOf(RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, "not-a-number")),
            ) is RecipeCheck.Rejected,
        )
        assertTrue(
            validateBroadcast(
                base,
                listOf(RecipeExtra("on", RecipeExtraType.BOOL, RecipeValueSource.LITERAL, "yes")),
            ) is RecipeCheck.Rejected,
        )

        // A percent cannot be a boolean — silently coercing it is how
        // "set 0% brightness" becomes "power off".
        assertTrue(
            validateBroadcast(
                base,
                listOf(RecipeExtra("on", RecipeExtraType.BOOL, RecipeValueSource.PERCENT)),
            ) is RecipeCheck.Rejected,
        )

        // A literal extra with no value at all.
        assertTrue(
            validateBroadcast(
                base,
                listOf(RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, null)),
            ) is RecipeCheck.Rejected,
        )

        // A literal carrying a control byte.
        UNSAFE_CODES.forEach { code ->
            assertTrue(
                "extra literal with codepoint 0x${code.toString(16)} must be rejected",
                validateBroadcast(
                    base,
                    listOf(
                        RecipeExtra(
                            "mode",
                            RecipeExtraType.STRING,
                            RecipeValueSource.LITERAL,
                            "man" + code.toChar() + "ual",
                        ),
                    ),
                ) is RecipeCheck.Rejected,
            )
        }

        // Well-formed extras pass.
        assertTrue(
            validateBroadcast(
                base,
                listOf(
                    RecipeExtra("state", RecipeExtraType.INT, RecipeValueSource.LITERAL, "1"),
                    RecipeExtra("level", RecipeExtraType.INT, RecipeValueSource.PERCENT, scale = RecipeScale(0, 255)),
                    RecipeExtra("mode", RecipeExtraType.STRING, RecipeValueSource.LITERAL, "manual"),
                ),
            ).valid,
        )
    }

    // ─── settings namespace ─────────────────────────────────────────

    @Test
    fun `settings keys are restricted to safe identifiers`() {
        listOf(
            "screen brightness", // space
            "screen/brightness", // path-ish
            "screen.brightness", // dots are for actions, not settings keys
            "",
            "a".repeat(100),
        ).forEach { key ->
            assertTrue("must be rejected: '${key.take(32)}'", validateSettings(key) is RecipeCheck.Rejected)
        }
        UNSAFE_CODES.forEach { code ->
            assertTrue(
                "settings key with codepoint 0x${code.toString(16)} must be rejected",
                validateSettings("screen" + code.toChar() + "brightness") is RecipeCheck.Rejected,
            )
        }
        assertTrue(validateSettings("screen_brightness").valid)
        assertTrue(validateSettings("hdmi_backlight_level").valid)
    }

    // ─── scales ─────────────────────────────────────────────────────

    @Test
    fun `invalid scales are rejected`() {
        assertFalse(RecipeAllowlist.isScale(RecipeScale(10, 10))) // min == max
        assertFalse(RecipeAllowlist.isScale(RecipeScale(200, 10))) // inverted
        assertFalse(RecipeAllowlist.isScale(RecipeScale(-5, 100))) // negative min
        assertFalse(RecipeAllowlist.isScale(RecipeScale(0, 99_999_999))) // absurd max
        assertTrue(RecipeAllowlist.isScale(RecipeScale(0, 255)))
        assertTrue(RecipeAllowlist.isScale(null)) // absent = default
    }

    // ─── whole-recipe posture ───────────────────────────────────────

    @Test
    fun `one bad step rejects the WHOLE recipe`() {
        // A recipe whose blank step is fine but whose wake step points
        // outside the allowlist must be rejected entirely — keeping the
        // "good half" is a screen that turns off and never comes back.
        val recipe = VendorRecipe(
            vendorId = "half-evil",
            match = RecipeMatch(manufacturer = "Goodview"),
            blank = RecipeStep.Broadcast("com.gv.display.SET_POWER", emptyList()),
            wake = RecipeStep.Sysfs("/etc/passwd", null, true, null),
        )
        val check = RecipeValidator.validate(recipe)
        assertTrue(check is RecipeCheck.Rejected)
        assertNull(check.recipeOrNull())
    }

    @Test
    fun `a recipe with no steps at all is rejected`() {
        assertTrue(
            RecipeValidator.validate(VendorRecipe(vendorId = "empty", match = RecipeMatch())) is RecipeCheck.Rejected,
        )
    }

    @Test
    fun `vendorId and match tokens must be safe`() {
        val step = RecipeStep.Broadcast("com.gv.display.SET_POWER", emptyList())
        assertTrue(
            RecipeValidator.validate(
                VendorRecipe("../../etc/passwd", RecipeMatch(), blank = step),
            ) is RecipeCheck.Rejected,
        )
        // Match tokens are compared with equals(ignoreCase) against
        // Build.MANUFACTURER / MODEL / BOARD — they never become a path
        // or an intent action — so an ASCII SPACE is legitimate and
        // required ("NovaStar Taurus TB60", "Good View"). Everything
        // else in the unsafe set is still refused.
        UNSAFE_CODES.filter { it != 0x20 }.forEach { code ->
            assertTrue(
                "match token with codepoint 0x${code.toString(16)} must be rejected",
                RecipeValidator.validate(
                    VendorRecipe("ok", RecipeMatch(manufacturer = "Good" + code.toChar() + "view"), blank = step),
                ) is RecipeCheck.Rejected,
            )
        }
        assertTrue(
            "a real vendor string with a space must be accepted",
            RecipeValidator.validate(
                VendorRecipe("ok", RecipeMatch(manufacturer = "NovaStar", model = "Taurus TB60"), blank = step),
            ).valid,
        )
        // A vendorId, by contrast, is an identifier — no spaces.
        assertTrue(
            RecipeValidator.validate(
                VendorRecipe("good view", RecipeMatch(), blank = step),
            ) is RecipeCheck.Rejected,
        )
        assertTrue(RecipeValidator.validate(VendorRecipe("goodview-ecbox", RecipeMatch(), blank = step)).valid)
    }

    @Test
    fun `match is case-insensitive and an absent field matches anything`() {
        val m = RecipeMatch(manufacturer = "Goodview", model = "ECBox3576")
        assertTrue(m.matches("GOODVIEW", "ecbox3576", "rk3568"))
        assertFalse(m.matches("NovaStar", "ecbox3576", "rk3568"))
        assertFalse(m.matches("Goodview", "TB60", "rk3568"))
        // All-null matches every device.
        assertTrue(RecipeMatch().matches("anything", "at", "all"))
    }

    // ─── percent → device scale ─────────────────────────────────────

    @Test
    fun `percent maps onto a device scale with exact endpoints`() {
        assertEquals(0, DisplayLimits.scale(0, 0, 255))
        assertEquals(255, DisplayLimits.scale(100, 0, 255))
        assertEquals(128, DisplayLimits.scale(50, 0, 255))
        assertEquals(1, DisplayLimits.scale(0, 1, 255))
        // Out-of-range percents are bounded, never extrapolated.
        assertEquals(0, DisplayLimits.scale(-50, 0, 255))
        assertEquals(255, DisplayLimits.scale(500, 0, 255))
        // A degenerate scale collapses to min instead of dividing by zero.
        assertEquals(7, DisplayLimits.scale(50, 7, 7))
    }

    // ─── helpers ────────────────────────────────────────────────────

    private fun validateSysfsPath(path: String): RecipeCheck = RecipeValidator.validate(
        VendorRecipe(
            vendorId = "t",
            match = RecipeMatch(),
            brightness = RecipeStep.Sysfs(path, null, fromPercent = true, scale = RecipeScale(0, 255)),
        ),
    )

    private fun validateBroadcast(action: String, extras: List<RecipeExtra> = emptyList()): RecipeCheck =
        RecipeValidator.validate(
            VendorRecipe(
                vendorId = "t",
                match = RecipeMatch(),
                blank = RecipeStep.Broadcast(action, extras),
            ),
        )

    private fun validateSettings(key: String): RecipeCheck = RecipeValidator.validate(
        VendorRecipe(
            vendorId = "t",
            match = RecipeMatch(),
            brightness = RecipeStep.SettingsWrite(key, RecipeScale(0, 255)),
        ),
    )
}
