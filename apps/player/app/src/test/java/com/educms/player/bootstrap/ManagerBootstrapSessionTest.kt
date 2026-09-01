package com.educms.player.bootstrap

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── THE COMPANION INSTALL SESSION HAS TO BE A REAL ONE ───────────────────
 *
 * TC22 (2026-09-01): the bundled-companion upgrade could never complete
 * without a human tapping Install — on ANY device, however the fleet was
 * provisioned. `ManagerBootstrap.installViaPackageInstaller` committed a
 * bare `SessionParams(MODE_FULL_INSTALL)`: no `setAppPackageName`, no
 * silent-install hint, no update-ownership request. Every other installer
 * in this repo sets all three (`OtaUpdateWorker.triggerInstall`, Manager's
 * `OtaInstaller.installApk`).
 *
 * That is why a system dialog sat on the glass for the whole 60 s window in
 * which the post-install relaunch actors fire — the dialog the operator saw
 * and the update that never happened are the same fact.
 *
 * Where Player IS installer-of-record for the companion (i.e. anywhere
 * Player bootstrapped it), the hint makes the upgrade silent and the race
 * disappears entirely rather than being merely survivable.
 *
 * Source-reading, like `RelaunchEscalationTest`'s wiring block: these are
 * PackageInstaller calls against a live PackageManager, so there is nothing
 * to unit-test behaviourally — but "did anyone delete the line" is exactly
 * the regression that already happened once, and it is cheap to pin.
 */
class ManagerBootstrapSessionTest {

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
        val f = File(root!!, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private val bootstrap: String get() = require("src/main/java/com/educms/player/bootstrap/ManagerBootstrap.kt")

    @Test
    fun `the session names the package it is installing`() {
        assertTrue(
            "an unpinned session can be redirected to install a different APK if the staging " +
                "file is swapped — and the platform only populates EXTRA_PACKAGE_NAME on the " +
                "status broadcast for sessions that name their target, which is what the " +
                "relaunch hold uses to know the install landed",
            bootstrap.contains("params.setAppPackageName("),
        )
        assertTrue(
            "the name must come from the APK itself, not a hardcoded guess",
            bootstrap.contains("readApkPackageName(") && bootstrap.contains("getPackageArchiveInfo("),
        )
    }

    @Test
    fun `the session asks for a silent install and update ownership`() {
        assertTrue(
            "without the hint the companion upgrade ALWAYS needs a human tap, even on a panel " +
                "where Player is installer-of-record for it",
            bootstrap.contains("Api31SilentInstall.configure(params)"),
        )
        assertTrue(
            "and the API-31 symbol stays behind a runtime version check (the v1.0.20 VerifyError)",
            bootstrap.contains("Build.VERSION.SDK_INT >= Build.VERSION_CODES.S"),
        )
        assertTrue(
            "Android 14+: stop a vendor store silently regressing the companion",
            bootstrap.contains("Api34UpdateOwnership.configure(params)"),
        )
    }

    @Test
    fun `an unreadable archive degrades to the old behaviour instead of failing`() {
        assertTrue(
            "a null package id must commit UNPINNED — exactly what this code did before — " +
                "never throw and never skip the install",
            bootstrap.contains("committing unpinned"),
        )
        assertFalse(
            "a non-null assertion here would turn a dev build with a malformed asset into a " +
                "crash on every boot",
            bootstrap.contains("readApkPackageName(ctx, apk)!!"),
        )
    }

    @Test
    fun `it mirrors the installers it is supposed to mirror`() {
        // If OtaUpdateWorker ever gains a fourth thing, this test is where
        // the next person notices the bootstrap did not get it.
        val worker = require("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt")
        listOf("setAppPackageName(", "Api31SilentInstall.configure(", "Api34UpdateOwnership.configure(")
            .forEach { call ->
                assertTrue("OtaUpdateWorker is the reference implementation for $call", worker.contains(call))
                assertTrue("ManagerBootstrap must match it on $call", bootstrap.contains(call))
            }
    }
}
