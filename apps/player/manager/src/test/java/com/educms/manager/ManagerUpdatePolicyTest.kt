package com.educms.manager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * ONE RELEASE UNIT (2026-11-08) — the Manager never ships except inside the
 * Player APK, through the Player's ladder. The behavioural half pins the
 * install rule and the legacy-lane answer; the source-shape half (Assume-based,
 * like the Player's wiring guards) pins that nothing in this module schedules
 * the retired self-update lane again.
 */
class ManagerUpdatePolicyTest {

    // ── the install rule: only a STRICTLY newer companion, never a downgrade ──

    @Test
    fun `no bundled asset never installs`() {
        assertFalse(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = null, bundledVersionCode = 0))
        assertFalse(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = 10024, bundledVersionCode = 0))
        assertFalse(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = 10024, bundledVersionCode = -1))
    }

    @Test
    fun `a missing companion is installed from the bundle`() {
        assertTrue(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = null, bundledVersionCode = 10129))
    }

    @Test
    fun `the deployed 1_0_24 takes the first unified Manager`() {
        // 1.0.24 = 10024; the first unified Manager is the unit version (≥ 1.1.29 = 10129).
        assertTrue(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = 10024, bundledVersionCode = 10129))
    }

    @Test
    fun `an unchanged companion is never reinstalled`() {
        assertFalse(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = 10129, bundledVersionCode = 10129))
    }

    @Test
    fun `a newer installed companion is never downgraded`() {
        assertFalse(ManagerUpdatePolicy.shouldInstallBundled(installedVersionCode = 10166, bundledVersionCode = 10129))
    }

    // ── the legacy 1.0.24 lane: the server's answer never starts a download ──

    @Test
    fun `no latest block is up to date for 1_0_24`() {
        assertTrue(ManagerUpdatePolicy.legacyLaneAnswerIsSafe(callerVersionCode = 10024, latestVersionCode = null))
    }

    @Test
    fun `a latest at or below the caller is up to date for 1_0_24`() {
        assertTrue(ManagerUpdatePolicy.legacyLaneAnswerIsSafe(10024, 10024))
        assertTrue(ManagerUpdatePolicy.legacyLaneAnswerIsSafe(10024, 10023))
    }

    @Test
    fun `only a newer latest would make 1_0_24 download`() {
        assertFalse(ManagerUpdatePolicy.legacyLaneAnswerIsSafe(10024, 10025))
    }

    @Test
    fun `self update is retired`() {
        assertTrue(ManagerUpdatePolicy.selfUpdateRetired)
        assertEquals(
            listOf("edu-manager-self-update-periodic", "edu-manager-self-update-oneshot"),
            ManagerUpdatePolicy.LEGACY_SELF_UPDATE_WORK_NAMES,
        )
    }

    // ── source-shape guards: nothing schedules the retired lane ─────────────

    private fun managerSource(name: String): String? {
        val candidates = listOf(
            File("src/main/java/com/educms/manager/$name"),
            File("manager/src/main/java/com/educms/manager/$name"),
            File("apps/player/manager/src/main/java/com/educms/manager/$name"),
        )
        return candidates.firstOrNull { it.isFile }?.readText()
    }

    @Test
    fun `ManagerApp schedules no self update and cancels the legacy jobs`() {
        val src = managerSource("ManagerApp.kt")
        assumeTrue("ManagerApp.kt not found from ${File(".").absolutePath}", src != null)
        val body = src!!
        assertFalse(
            "ManagerApp must not enqueue ManagerSelfUpdateWorker",
            Regex("""(OneTimeWorkRequestBuilder|PeriodicWorkRequestBuilder)<ManagerSelfUpdateWorker>""").containsMatchIn(body),
        )
        assertTrue(
            "ManagerApp must cancel the legacy self-update work names on boot",
            body.contains("LEGACY_SELF_UPDATE_WORK_NAMES") && body.contains("cancelUniqueWork"),
        )
    }

    @Test
    fun `no receiver re-arms the self update lane`() {
        for (name in listOf("BootReceiver.kt", "PackageReplacedReceiver.kt", "OtaTriggerReceiver.kt")) {
            val src = managerSource(name)
            assumeTrue("$name not found", src != null)
            assertFalse(
                "$name must not trigger the retired self-update lane",
                src!!.contains("triggerImmediateManagerSelfUpdate") || src.contains("scheduleManagerSelfUpdateWorker"),
            )
        }
    }

    @Test
    fun `the legacy worker never downloads or installs`() {
        val src = managerSource("ManagerSelfUpdateWorker.kt")
        assumeTrue("ManagerSelfUpdateWorker.kt not found", src != null)
        val body = src!!
        assertFalse("the retired worker must not open a URL connection", body.contains("openConnection()"))
        assertFalse("the retired worker must not commit an install", body.contains("OtaInstaller.installApk"))
        assertTrue("the retired worker must consult ManagerUpdatePolicy", body.contains("ManagerUpdatePolicy.selfUpdateRetired"))
    }
}
