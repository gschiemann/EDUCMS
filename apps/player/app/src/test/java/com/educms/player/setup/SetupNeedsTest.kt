package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.STEP_ALL_FILES
import com.educms.player.setup.SetupCeremonyMath.STEP_BATTERY_EXEMPT
import com.educms.player.setup.SetupCeremonyMath.STEP_DEVICE_ADMIN
import com.educms.player.setup.SetupCeremonyMath.STEP_HOME
import com.educms.player.setup.SetupCeremonyMath.STEP_INSTALL_UNKNOWN
import com.educms.player.setup.SetupCeremonyMath.STEP_OVERLAY
import com.educms.player.setup.SetupCeremonyMath.STEP_RUNTIME
import com.educms.player.setup.SetupCeremonyMath.STEP_SLEEP_HELPER
import com.educms.player.setup.SetupCeremonyMath.STEP_WRITE_SETTINGS
import com.educms.player.setup.SetupNeeds.Device
import com.educms.player.setup.SetupNeeds.PERM_COARSE_LOCATION
import com.educms.player.setup.SetupNeeds.PERM_FINE_LOCATION
import com.educms.player.setup.SetupNeeds.PERM_NOTIFICATIONS
import com.educms.player.setup.SetupNeeds.PERM_READ_STORAGE
import com.educms.player.setup.SetupNeeds.VendorSleep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 1.1.59 — the needs matrix (device × Android version → required list) and skip-if-granted. */
class SetupNeedsTest {

    // ── the matrix ───────────────────────────────────────────────────

    @Test fun `Android 9 Wi-Fi box asks location and storage, no all-files, no notifications`() {
        val d = Device(sdk = 28, hasWifi = true)
        assertEquals(listOf(PERM_FINE_LOCATION, PERM_COARSE_LOCATION, PERM_READ_STORAGE), SetupNeeds.runtimePermissions(d))
        assertEquals(
            listOf(STEP_RUNTIME, STEP_INSTALL_UNKNOWN, STEP_WRITE_SETTINGS, STEP_BATTERY_EXEMPT, STEP_OVERLAY, STEP_HOME),
            SetupNeeds.required(d),
        )
    }

    @Test fun `Android 11 box swaps the storage permission for all files access`() {
        val d = Device(sdk = 30, hasWifi = true)
        assertEquals(listOf(PERM_FINE_LOCATION, PERM_COARSE_LOCATION), SetupNeeds.runtimePermissions(d))
        assertTrue(STEP_ALL_FILES in SetupNeeds.required(d))
        assertFalse(STEP_ALL_FILES in SetupNeeds.required(Device(sdk = 29, hasWifi = true)))
    }

    @Test fun `Android 13 adds notifications to the one dialog`() {
        val d = Device(sdk = 33, hasWifi = true)
        assertEquals(listOf(PERM_FINE_LOCATION, PERM_COARSE_LOCATION, PERM_NOTIFICATIONS), SetupNeeds.runtimePermissions(d))
    }

    @Test fun `no Wi-Fi hardware means no location question`() {
        assertEquals(listOf(PERM_NOTIFICATIONS), SetupNeeds.runtimePermissions(Device(sdk = 34, hasWifi = false)))
        // Ethernet-only Android 11/12 box: nothing at runtime → no dialog row at all.
        val d = Device(sdk = 31, hasWifi = false)
        assertTrue(SetupNeeds.runtimePermissions(d).isEmpty())
        assertFalse(STEP_RUNTIME in SetupNeeds.required(d))
        assertEquals(false, SetupNeeds.applies(STEP_RUNTIME, d))
    }

    @Test fun `sleep helper only where the vendor sleep refuses us, Android 9+`() {
        // EP6N whose sdkapi service refuses our uid.
        assertTrue(STEP_SLEEP_HELPER in SetupNeeds.required(Device(sdk = 33, hasWifi = true, vendorSleep = VendorSleep.REFUSED)))
        // Vendor sleep works (GUQ MCU / sdkapi accepted): nothing asked.
        assertFalse(STEP_SLEEP_HELPER in SetupNeeds.required(Device(sdk = 33, hasWifi = true, vendorSleep = VendorSleep.WORKS)))
        // Generic box with no vendor service, and a probe still running: nothing asked.
        assertFalse(SetupNeeds.sleepHelperApplies(Device(sdk = 33, hasWifi = true, vendorSleep = VendorSleep.NONE)))
        assertFalse(SetupNeeds.sleepHelperApplies(Device(sdk = 33, hasWifi = true, vendorSleep = VendorSleep.PROBING)))
        // Below Android 9 the accessibility lock action does not exist.
        assertFalse(SetupNeeds.sleepHelperApplies(Device(sdk = 27, hasWifi = true, vendorSleep = VendorSleep.REFUSED)))
    }

    @Test fun `device admin is hidden where vendor sleep works, kept elsewhere`() {
        assertEquals(false, SetupNeeds.applies(STEP_DEVICE_ADMIN, Device(30, true, VendorSleep.WORKS)))
        assertEquals(true, SetupNeeds.applies(STEP_DEVICE_ADMIN, Device(30, true, VendorSleep.NONE)))
        assertEquals(true, SetupNeeds.applies(STEP_DEVICE_ADMIN, Device(30, true, VendorSleep.REFUSED)))
        // Device admin is never CORE — it is never on the required list.
        VendorSleep.values().forEach { v ->
            assertFalse(STEP_DEVICE_ADMIN in SetupNeeds.required(Device(33, true, v)))
        }
    }

    @Test fun `matrix leaves the legacy steps to their own rules`() {
        assertEquals(null, SetupNeeds.applies(STEP_INSTALL_UNKNOWN, Device(33, true)))
        assertEquals(null, SetupNeeds.applies(STEP_HOME, Device(33, true)))
        assertFalse(STEP_HOME in SetupNeeds.required(Device(33, true), managerIsOwner = true))
        assertFalse(STEP_OVERLAY in SetupNeeds.required(Device(33, true), overlayPage = false))
    }

    @Test fun `vendor wire words map to sleep facts, unknown waits`() {
        assertEquals(VendorSleep.NONE, SetupNeeds.vendorSleepFromWire(null))
        assertEquals(VendorSleep.NONE, SetupNeeds.vendorSleepFromWire("absent"))
        assertEquals(VendorSleep.WORKS, SetupNeeds.vendorSleepFromWire("available"))
        assertEquals(VendorSleep.REFUSED, SetupNeeds.vendorSleepFromWire("unsupported"))
        assertEquals(VendorSleep.REFUSED, SetupNeeds.vendorSleepFromWire("unreachable"))
        assertEquals(VendorSleep.PROBING, SetupNeeds.vendorSleepFromWire("probing"))
        assertEquals(VendorSleep.PROBING, SetupNeeds.vendorSleepFromWire("something-new"))
    }

    // ── skip-if-granted ──────────────────────────────────────────────

    @Test fun `granted runtime permissions are not asked again`() {
        val d = Device(sdk = 33, hasWifi = true)
        val all = setOf(PERM_FINE_LOCATION, PERM_COARSE_LOCATION, PERM_NOTIFICATIONS)
        assertTrue(SetupNeeds.missingRuntime(d, all).isEmpty())
        assertEquals(listOf(PERM_NOTIFICATIONS), SetupNeeds.missingRuntime(d, setOf(PERM_FINE_LOCATION, PERM_COARSE_LOCATION)))
    }

    @Test fun `approximate location alone does not satisfy the Wi-Fi list, and fine is asked with coarse`() {
        val d = Device(sdk = 33, hasWifi = true)
        assertEquals(
            listOf(PERM_FINE_LOCATION),
            SetupNeeds.missingRuntime(d, setOf(PERM_COARSE_LOCATION, PERM_NOTIFICATIONS)),
        )
        // Coarse refused but fine held (cannot happen on 12+, can below): satisfied.
        assertTrue(SetupNeeds.missingRuntime(d, setOf(PERM_FINE_LOCATION, PERM_NOTIFICATIONS)).isEmpty())
    }

    @Test fun `outstanding keeps order and drops what is held`() {
        val required = SetupNeeds.required(Device(sdk = 33, hasWifi = true, vendorSleep = VendorSleep.REFUSED))
        val out = SetupNeeds.outstanding(required, setOf(STEP_RUNTIME, STEP_WRITE_SETTINGS, STEP_HOME))
        assertEquals(listOf(STEP_INSTALL_UNKNOWN, STEP_BATTERY_EXEMPT, STEP_ALL_FILES, STEP_SLEEP_HELPER, STEP_OVERLAY), out)
        assertTrue(SetupNeeds.outstanding(required, required.toSet()).isEmpty())
    }

    @Test fun `the dialog first, the app page once Android stops asking`() {
        assertEquals(SetupNeeds.RuntimeFire.DIALOG, SetupNeeds.runtimeFire(askedBefore = false, rationale = false))
        assertEquals(SetupNeeds.RuntimeFire.DIALOG, SetupNeeds.runtimeFire(askedBefore = true, rationale = true))
        assertEquals(SetupNeeds.RuntimeFire.APP_PAGE, SetupNeeds.runtimeFire(askedBefore = true, rationale = false))
    }

    // ── nothing mid-use ──────────────────────────────────────────────

    @Test fun `a fresh install opens by itself, an upgrade of a screen in service never does`() {
        assertFalse(SetupNeeds.firstRunClosed(storedClosed = null, legacyMarkers = false))
        assertTrue(SetupNeeds.firstRunClosed(storedClosed = null, legacyMarkers = true))
        assertTrue(SetupNeeds.firstRunClosed(storedClosed = true, legacyMarkers = false))
        assertFalse(SetupNeeds.firstRunClosed(storedClosed = false, legacyMarkers = true))
    }

    @Test fun `after first run only a person opens the list`() {
        assertTrue(SetupNeeds.mayAutoOpen(forced = false, alreadyUp = false, firstRunClosed = false))
        assertFalse(SetupNeeds.mayAutoOpen(forced = false, alreadyUp = false, firstRunClosed = true))
        assertTrue(SetupNeeds.mayAutoOpen(forced = true, alreadyUp = false, firstRunClosed = true))
        // A card already on glass (a person is mid-list, back from Settings) keeps updating.
        assertTrue(SetupNeeds.mayAutoOpen(forced = false, alreadyUp = true, firstRunClosed = true))
    }

    @Test fun `every step has a feature name for needs setup`() {
        listOf(STEP_RUNTIME, STEP_INSTALL_UNKNOWN, STEP_WRITE_SETTINGS, STEP_BATTERY_EXEMPT, STEP_ALL_FILES,
            STEP_SLEEP_HELPER, STEP_DEVICE_ADMIN, STEP_OVERLAY, STEP_HOME).forEach {
            assertFalse("feature for $it", SetupNeeds.featureFor(it) == it)
        }
    }

    // ── source guards: nothing asks mid-use ──────────────────────────

    private fun src(path: String): String {
        val f = listOf(File(path), File("app/$path")).firstOrNull { it.exists() } ?: error("missing $path")
        return f.readText()
    }

    @Test fun `MainActivity no longer raises the location dialog at launch or a storage page from the USB card`() {
        val main = src("src/main/java/com/educms/player/MainActivity.kt")
        assertFalse(main.contains("WifiScan.requestAtFirstLaunch(this)"))
        assertFalse(main.contains("ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION"))
        assertFalse(main.contains("Manifest.permission.READ_EXTERNAL_STORAGE)"))
        assertTrue(main.contains("openSetupChecklistNow(\"usb card\")"))
    }

    @Test fun `the new rows are on the setup list`() {
        val ceremony = src("src/main/java/com/educms/player/setup/SetupCeremony.kt")
        listOf("STEP_RUNTIME", "STEP_ALL_FILES", "STEP_SLEEP_HELPER").forEach {
            assertTrue(it, ceremony.contains("prefKey = SetupCeremonyMath.$it"))
        }
    }
}
