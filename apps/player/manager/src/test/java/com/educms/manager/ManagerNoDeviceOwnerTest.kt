package com.educms.manager

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * NO DEVICE OWNER, EVER (owner rule, 2026-10-17). The Manager used to carry a
 * `DeviceAdminReceiver`, a HOME pin and a lock-task allowlist that only ran as
 * device owner — which no screen is. They are gone (2026-11-08); this pins that
 * nothing in the module grows a device-policy call back, and that the manifest
 * keeps no device-admin receiver (so no screen's install changes shape).
 *
 * Source-shape guards are Assume-based like the Player's wiring tests: they
 * skip, never lie, when the working directory is not the module.
 */
class ManagerNoDeviceOwnerTest {

    private fun moduleDir(): File? =
        listOf(File("."), File("manager"), File("apps/player/manager"))
            .firstOrNull { File(it, "src/main/AndroidManifest.xml").exists() }

    private fun kotlinSources(dir: File): List<File> =
        File(dir, "src/main/java").walkTopDown().filter { it.extension == "kt" }.toList()

    @Test
    fun `no Manager source calls a device-policy API`() {
        val dir = moduleDir(); assumeTrue(dir != null)
        val banned = listOf(
            "DevicePolicyManager", "DeviceAdminReceiver", "isDeviceOwnerApp",
            "setLockTaskPackages", "addPersistentPreferredActivity", "AdminReceiver",
            "pinPlayerAsHome", "allowPlayerLockTask",
        )
        val code = kotlinSources(dir!!)
        assertTrue("Manager sources found", code.isNotEmpty())
        for (f in code) {
            // Comments may explain what was removed; code may not use it.
            val body = f.readLines().joinToString("\n") { it.substringBefore("//") }
                .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            for (b in banned) assertFalse("${f.name} uses $b", body.contains(b))
        }
    }

    @Test
    fun `the manifest declares no device-admin receiver and no device-admin resource exists`() {
        val dir = moduleDir(); assumeTrue(dir != null)
        val manifest = File(dir!!, "src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("BIND_DEVICE_ADMIN"))
        assertFalse(manifest.contains("android.app.device_admin"))
        assertFalse(manifest.contains("DEVICE_ADMIN_ENABLED"))
        assertFalse(File(dir, "src/main/res/xml/device_admin.xml").exists())
    }

    @Test
    fun `the Manager keeps every non-device-owner install path`() {
        val dir = moduleDir(); assumeTrue(dir != null)
        val manifest = File(dir!!, "src/main/AndroidManifest.xml").readText()
        // The permissions the one-tap Install path and the silent-where-earned
        // path (Android 12+, installer of record) use.
        assertTrue(manifest.contains("REQUEST_INSTALL_PACKAGES"))
        assertTrue(manifest.contains("UPDATE_PACKAGES_WITHOUT_USER_ACTION"))
        assertTrue(manifest.contains(".InstallPromptActivity"))
        assertTrue(manifest.contains(".WatchdogService"))
    }
}
