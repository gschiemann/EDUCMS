package com.educms.player.display

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths

/**
 * ⚠️ THE SYSFS GATE, EXERCISED AGAINST A REAL SYMLINK FARM.
 *
 * `RecipeValidatorTest` asserts the gate's rules on literal strings, but
 * on the BUILD HOST `/sys` does not exist, so `File.getCanonicalPath`
 * degrades to lexical normalization and the symlink half of the gate is
 * never exercised at all. That is exactly how the 2026-08-13 bug shipped
 * green:
 *
 *   v1 canonicalized first and then required the CANONICAL path to sit
 *   under `/sys/class/backlight/`. But every real sysfs class entry is a
 *   symlink into the device tree —
 *   `/sys/class/backlight/panel0 -> ../../devices/platform/soc/backlight/panel0`
 *   — so on hardware canonicalPath resolved OUT of the class tree and
 *   the containment test failed. Every real backlight path was rejected:
 *   the sysfs provider found no node on ANY device and every
 *   `kind:"sysfs"` recipe was refused whole, so BRIGHTNESS fell to
 *   software dim fleet-wide while the dashboard reported success.
 *
 * These tests build an actual sysfs-shaped tree with actual symlinks
 * under a temp dir and point the root-injectable gate at it, so both
 * halves are proven: a class symlink that resolves into the device tree
 * is ACCEPTED, and one that resolves anywhere else is REFUSED.
 */
class SysfsGateSymlinkTest {

    private var tmpRoot: File? = null

    private lateinit var root: String
    private lateinit var roots: List<String>
    private lateinit var resolvedRoots: List<String>

    @After
    fun tearDown() {
        tmpRoot?.deleteRecursively()
        tmpRoot = null
    }

    private fun setUpFarm() {
        // macOS puts temp dirs under /var, which is itself a symlink to
        // /private/var — so the ROOT has to be canonicalized before it can
        // be used to build the expected containment prefixes.
        val dir = Files.createTempDirectory("educms-sysfs-gate").toFile()
        tmpRoot = dir
        root = dir.canonicalFile.absolutePath
        roots = listOf("$root/class/backlight/", "$root/class/leds/")
        resolvedRoots = listOf("$root/devices/")

        File("$root/devices/platform/soc/backlight/panel0").mkdirs()
        File("$root/devices/platform/soc/backlight/panel0/brightness").writeText("128")
        File("$root/devices/platform/soc/backlight/panel0/max_brightness").writeText("255")
        File("$root/class/backlight").mkdirs()
        File("$root/class/leds").mkdirs()

        // The real kernel layout: a RELATIVE symlink out of the class
        // tree and into the device tree.
        Files.createSymbolicLink(
            Paths.get("$root/class/backlight/panel0"),
            Paths.get("../../devices/platform/soc/backlight/panel0"),
        )
    }

    private fun gate(path: String) = RecipeAllowlist.canonicalSysfsPath(path, roots, resolvedRoots)

    // ─── the regression: real hardware must be ACCEPTED ──────────────

    @Test
    fun `a class symlink resolving into the device tree is accepted`() {
        setUpFarm()
        val resolved = gate("$root/class/backlight/panel0/brightness")
        assertNotNull(
            "THE 2026-08-13 REGRESSION: every real backlight path was rejected here",
            resolved,
        )
        assertEquals(
            "$root/devices/platform/soc/backlight/panel0/brightness",
            resolved,
        )
        // …and the resolved node is the real file, so a write lands on
        // the panel rather than on a dangling path.
        assertEquals("128", File(resolved!!).readText())
    }

    @Test
    fun `the resolved path is what gets opened, and it is a real node`() {
        setUpFarm()
        val resolved = gate("$root/class/backlight/panel0/max_brightness")!!
        assertTrue(File(resolved).isFile)
        assertEquals("255", File(resolved).readText())
    }

    // ─── the security half: hostile symlinks must be REFUSED ─────────

    @Test
    fun `a class symlink pointing outside the device tree is refused`() {
        setUpFarm()
        // A compromised control plane, a hostile filesystem layout, or a
        // symlink swapped in between discovery and use.
        File("$root/elsewhere/secrets").mkdirs()
        File("$root/elsewhere/secrets/brightness").writeText("x")
        Files.createSymbolicLink(
            Paths.get("$root/class/backlight/evil"),
            Paths.get("../../elsewhere/secrets"),
        )
        assertNull(
            "a symlink that escapes both the class roots and the device tree must be refused",
            gate("$root/class/backlight/evil/brightness"),
        )
    }

    @Test
    fun `a symlink escaping the fake sysfs root entirely is refused`() {
        setUpFarm()
        val outside = Files.createTempDirectory("educms-outside").toFile().canonicalFile
        try {
            File(outside, "brightness").writeText("x")
            Files.createSymbolicLink(
                Paths.get("$root/class/leds/pwned"),
                outside.toPath(),
            )
            assertNull(gate("$root/class/leds/pwned/brightness"))
        } finally {
            outside.deleteRecursively()
        }
    }

    @Test
    fun `traversal is refused textually, before anything is resolved`() {
        setUpFarm()
        // Belt and braces: even with a farm present, a `..` segment never
        // reaches canonicalization.
        listOf(
            "$root/class/backlight/../../devices/platform/soc/backlight/panel0/brightness",
            "$root/class/backlight/panel0/../../../etc/passwd",
            "$root/class/backlight/./../../dev/kmsg",
        ).forEach { assertNull("traversal must be refused: $it", gate(it)) }
    }

    @Test
    fun `the class root directory itself is not writable`() {
        setUpFarm()
        listOf(
            "$root/class/backlight",
            "$root/class/backlight/",
            "$root/class/backlight/panel0",          // the device dir, not an attribute
            "$root/class",
        ).forEach { assertNull("must be refused: $it", gate(it)) }
    }

    @Test
    fun `a nested path deeper than device-slash-attribute is refused`() {
        setUpFarm()
        // `device/` back-links inside a class entry are how you walk out
        // of the class tree without ever writing `..`. Bounding the
        // shape at exactly two segments makes that unrepresentable.
        File("$root/devices/platform/soc/backlight/panel0/subsystem").mkdirs()
        File("$root/devices/platform/soc/backlight/panel0/subsystem/uevent").writeText("x")
        assertNull(gate("$root/class/backlight/panel0/subsystem/uevent"))
    }

    @Test
    fun `a sibling root with a shared prefix is refused`() {
        setUpFarm()
        File("$root/class/backlightEVIL/panel0").mkdirs()
        File("$root/class/backlightEVIL/panel0/brightness").writeText("x")
        assertNull(
            "the trailing slash on each root is load-bearing",
            gate("$root/class/backlightEVIL/panel0/brightness"),
        )
    }

    // ─── the production roots, on this host ──────────────────────────

    @Test
    fun `the production gate still accepts the canonical vendor paths`() {
        // On the build host /sys does not exist, so canonicalPath is
        // lexical and these land back under the class roots — which the
        // gate accepts as the "nothing resolved" case. On hardware they
        // resolve into /sys/devices, which the symlink tests above cover.
        listOf(
            "/sys/class/backlight/panel0/brightness",
            "/sys/class/leds/lcd-backlight/brightness",
            "/sys/class/leds/backlight/bl_power",
        ).forEach { assertNotNull("must be accepted: $it", RecipeAllowlist.canonicalSysfsPath(it)) }
    }

    @Test
    fun `the production gate still refuses everything outside the roots`() {
        listOf(
            "/sys/class/backlight",
            "/sys/class/backlightEVIL/brightness",
            "/etc/passwd",
            "/proc/sys/kernel/core_pattern",
            "/sys/devices/platform/soc/backlight/panel0/brightness", // must arrive as a CLASS path
            "sys/class/backlight/panel0/brightness",                 // not absolute
            "/sys/class/backlight/panel0/../../../etc/passwd",
        ).forEach { assertNull("must be refused: $it", RecipeAllowlist.canonicalSysfsPath(it)) }
    }
}
