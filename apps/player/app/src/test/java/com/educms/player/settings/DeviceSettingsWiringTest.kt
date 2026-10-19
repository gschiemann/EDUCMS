package com.educms.player.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * DEVICE SETTINGS — THE WIRING, as source facts (2026-10-18). The policy
 * tests prove the rules; these prove the rules sit in front of the only
 * caller, and that the package keeps its promises structurally:
 *
 *  • the heartbeat is the ONLY transport (no bridge method — player rule 9);
 *  • a reply is checked against this screen's own credential first;
 *  • brightness and volume go through `DisplayControlRegistry.apply` (the
 *    emergency gate, the floor, the mirror), never a direct write;
 *  • the screen-off timeout is written only through the blank provider's
 *    lock-held helper;
 *  • the attempt is persisted synchronously BEFORE the write;
 *  • no passphrase is stored or logged.
 *
 * Skipped, not failed, when the sources are not on disk (same shape as
 * `NativeAlertWatchWiringTest`) — and `check-player-test-execution.cjs`
 * requires this class to have EXECUTED, so a skip cannot pass silently.
 */
class DeviceSettingsWiringTest {

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

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    private val pkg = "src/main/java/com/educms/player"
    private val settingsFiles = listOf(
        "DeviceSettingKey.kt", "DeviceSettingsPolicy.kt", "DeviceSettingsWire.kt", "DeviceSettingsFacts.kt",
        "DeviceSettingsProbe.kt", "DeviceSettingsAppliers.kt", "Api33WifiSuggestions.kt", "DeviceSettings.kt",
        "DeviceLoad.kt",
    )
    private val all get() = settingsFiles.associateWith { code(read("$pkg/settings/$it")) }

    @Test fun theHeartbeatIsTheOnlyCallerAndCarriesItsOwnHeader() {
        val hb = code(read("$pkg/heartbeat/HeartbeatService.kt"))
        assertTrue(hb.contains("setRequestProperty(DeviceSettings.HEADER, DeviceSettings.report(applicationContext))"))
        assertTrue(hb.contains("DeviceSettings.accept(applicationContext, prefs, JSONObject(body))"))
        // Both gated on the same allow-listed, credentialed path as the power command.
        assertEquals(2, Regex("if \\(nativeAllowed\\) runCatching \\{\\s*(setRequestProperty\\(DeviceSettings|DeviceSettings\\.accept)").findAll(hb).count())
    }

    @Test fun noBridgeMethodReachesTheSettingsPackage() {
        val bridge = code(read("$pkg/WebAppBridge.kt"))
        assertFalse(bridge.contains("DeviceSettings"))
        assertFalse(bridge.contains("com.educms.player.settings"))
        val main = code(read("$pkg/MainActivity.kt"))
        assertFalse("MainActivity never drives device settings", main.contains("DeviceSettings."))
    }

    @Test fun aReplyIsCheckedAgainstThisScreensOwnCredentialFirst() {
        val src = all.getValue("DeviceSettings.kt")
        val accept = src.substring(src.indexOf("fun accept("))
        val idCheck = accept.indexOf("reply.optString(\"screenId\") != expected")
        val firstApply = accept.indexOf("evaluate(")
        assertTrue(idCheck in 0 until firstApply)
        assertTrue(accept.contains("NativeAlertWatchPolicy.screenIdOf(playerPrefs.getString(\"device_token\", null))"))
    }

    @Test fun brightnessAndVolumeGoThroughTheRegistryAndNothingWritesThemDirectly() {
        val appliers = all.getValue("DeviceSettingsAppliers.kt")
        assertTrue(appliers.contains("DisplayAction.SetBrightness("))
        assertTrue(appliers.contains("allowProvider = { it in DeviceSettingsFacts.READABLE_BRIGHTNESS }"))
        assertTrue(appliers.contains("DisplayAction.SetVolume(int(item), showUi = false)"))
        for ((name, src) in all) {
            assertFalse("$name writes SCREEN_BRIGHTNESS directly", Regex("putInt\\([^)]*SCREEN_BRIGHTNESS").containsMatchIn(src))
            assertFalse("$name sets a stream volume directly", src.contains("setStreamVolume"))
            assertFalse("$name writes the backlight node", src.contains("writeText"))
        }
    }

    @Test fun theScreenOffTimeoutIsWrittenOnlyThroughTheBlankProvidersLockedHelper() {
        for ((name, src) in all) {
            assertFalse("$name writes SCREEN_OFF_TIMEOUT directly", Regex("putInt\\([^)]*SCREEN_OFF_TIMEOUT").containsMatchIn(src))
        }
        assertTrue(all.getValue("DeviceSettingsAppliers.kt").contains("ScreenTimeoutBlankProvider.writeBaselineTimeout(app, int(item))"))
        val provider = code(read("$pkg/display/ScreenTimeoutBlankProvider.kt"))
        // blank, restore and the baseline write share ONE lock.
        assertEquals(3, Regex("synchronized\\(timeoutLock\\)").findAll(provider).count())
        assertTrue(provider.contains("DisplayPrefs.priorScreenOffTimeoutMs(app) != null) return BaselineWrite.BLANK_IN_FORCE"))
    }

    @Test fun theAttemptIsOnDiskBeforeTheWrite() {
        val src = all.getValue("DeviceSettings.kt")
        val commit = src.indexOf("store.commitAck(item.key, decision.attempt)")
        val write = src.indexOf("DeviceSettingsAppliers.apply(app, item)")
        assertTrue(commit in 0 until write)
        assertTrue(src.contains(".commit()"))
    }

    @Test fun noPassphraseIsStoredOrLogged() {
        for ((name, src) in all) {
            if (name == "Api33WifiSuggestions.kt" || name == "DeviceSettingKey.kt" || name == "DeviceSettingsWire.kt" ||
                name == "DeviceSettingsPolicy.kt"
            ) continue
            assertFalse("$name touches the passphrase", src.contains("passphrase"))
        }
        val wire = all.getValue("DeviceSettingsWire.kt")
        val encodeItems = wire.substring(wire.indexOf("fun encodeItems("), wire.indexOf("fun decodeItems("))
        assertFalse("the stored set has no passphrase field", encodeItems.contains("passphrase"))
        val wifi = all.getValue("Api33WifiSuggestions.kt")
        assertFalse("the passphrase is never logged", Regex("PlayerLogger\\.[a-z]+\\([^)]*passphrase").containsMatchIn(wifi))
    }

    @Test fun nothingInThePackageReadsADeviceStringIntoTheLoadReport() {
        val load = all.getValue("DeviceLoad.kt")
        assertFalse("thermal zone names are never read", load.contains("/type"))
        assertTrue(load.contains("thermal_zone\$i/temp"))
    }

    @Test fun theManifestDeclaresTheTwoPermissionsAndNoDeviceOwnerReceiver() {
        val manifest = read("src/main/AndroidManifest.xml")
        assertTrue(manifest.contains("android.permission.WRITE_SECURE_SETTINGS"))
        assertTrue(manifest.contains("android.permission.CHANGE_WIFI_STATE"))
        assertFalse("settings never needs device owner", all.values.any { it.contains("DevicePolicyManager") })
    }
}
