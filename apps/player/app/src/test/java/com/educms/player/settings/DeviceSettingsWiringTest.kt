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
        // 2026-10-23 — Wi-Fi on every Android class, and the network engine.
        "Api29WifiSuggestions.kt", "Api30WifiAddNetworks.kt", "Api31WifiApproval.kt", "WifiSetupPolicy.kt",
        "LegacyWifiEngine.kt", "LegacyWifiNetworks.kt", "WifiSetup.kt", "WifiSavePrompt.kt", "WifiConnect.kt",
        "WifiScan.kt", "NetworkStatus.kt", "NetworkPolicy.kt",
    )
    private val all get() = settingsFiles.associateWith { code(read("$pkg/settings/$it")) }
    private val networkFiles get() = listOf("NetworkScreen.kt", "NetworkScreenModel.kt")
        .associateWith { code(read("$pkg/network/$it")) }

    @Test fun theHeartbeatIsTheOnlyCallerAndCarriesItsOwnHeader() {
        val hb = code(read("$pkg/heartbeat/HeartbeatService.kt"))
        assertTrue(hb.contains("setRequestProperty(DeviceSettings.HEADER, DeviceSettings.report(applicationContext))"))
        assertTrue(hb.contains("DeviceSettings.accept(applicationContext, prefs, JSONObject(body))"))
        // Both gated on the same allow-listed, credentialed path as the power command.
        assertEquals(2, Regex("if \\(nativeAllowed\\) runCatching \\{\\s*(setRequestProperty\\(DeviceSettings|DeviceSettings\\.accept)").findAll(hb).count())
        // 2026-10-23 — the switch recovery runs every LOOP, before (and whether or not) the server answers.
        val loop = hb.substring(hb.indexOf("private suspend fun runLoop("))
        assertTrue(loop.indexOf("DeviceSettings.maintain(ctx)") in 0 until loop.indexOf("tickWithWakeLock("))
    }

    @Test fun noBridgeMethodReachesTheSettingsPackage() {
        val bridge = code(read("$pkg/WebAppBridge.kt"))
        assertFalse(bridge.contains("DeviceSettings"))
        assertFalse(bridge.contains("com.educms.player.settings"))
        val main = code(read("$pkg/MainActivity.kt"))
        assertFalse("MainActivity never drives device settings", main.contains("DeviceSettings."))
        // It only HOSTS the Wi-Fi save dialog (a person's press) and the Network screen.
        assertFalse(main.contains("WifiSetup."))
        assertFalse(main.contains("WifiConnect.connect("))
        assertTrue(main.contains("registerForActivityResult("))
        assertTrue(main.contains("WifiSavePrompt.onResult("))
        assertTrue(main.contains("WifiSavePrompt.personPresent(this)"))
    }

    @Test fun theDashboardAndAPersonAtTheScreenShareOneWifiEngine() {
        assertTrue(all.getValue("DeviceSettingsAppliers.kt").contains("WifiSetup.connect(app, item.id, item.value as DesiredValue.WifiValue)"))
        val connect = all.getValue("WifiConnect.kt")
        assertTrue(connect.contains("WifiSetup.connect(app, id, value)"))
        // ⚠️ an alert is checked before the engine is touched
        assertTrue(connect.indexOf("DisplayEmergency.isHeld(app)") in 0 until connect.indexOf("WifiSetup.connect(app, id, value)"))
        // The screen connects only through it.
        val screen = networkFiles.getValue("NetworkScreen.kt")
        assertTrue(screen.contains("WifiConnect.connect("))
        assertFalse(screen.contains("addNetwork") || screen.contains("addNetworkSuggestions") || screen.contains("WifiSetup."))
    }

    @Test fun theLegacyPathClaimsSavesAndWritesTheWayBackBeforeItSwitches() {
        val engine = all.getValue("LegacyWifiEngine.kt")
        val apply = engine.substring(engine.indexOf("fun apply("), engine.indexOf("private fun switchTo("))
        assertTrue("claimed before it is added", apply.indexOf("store.putLedger(ours + key)") in 0 until apply.indexOf("port.add(value)"))
        assertTrue("persisted before any switch", apply.indexOf("port.saveConfiguration()") in 0 until apply.indexOf("switchTo("))
        val switch = engine.substring(engine.indexOf("private fun switchTo("), engine.indexOf("fun observe("))
        assertTrue("the journal precedes the connect request", switch.indexOf("store.putJournal(journal)") in 0 until switch.indexOf("port.enable(networkId, connect = true)"))
        assertEquals("nothing saves after a connect request", 1, Regex("port\\.saveConfiguration\\(\\)").findAll(engine).count())
        val rollBack = engine.substring(engine.indexOf("fun rollBack("), engine.indexOf("private fun restoreOthers("))
        assertTrue("Android 7: the others come back before the removal saves", rollBack.indexOf("restoreOthers(journal)") in 0 until rollBack.indexOf("port.remove(journal.networkId)"))
    }

    @Test fun theNetworkScreenNeverOpensOverAnAlertAndLeavesTheMomentOneStarts() {
        val screen = networkFiles.getValue("NetworkScreen.kt")
        val open = screen.substring(screen.indexOf("fun open("), screen.indexOf("fun back("))
        assertTrue(open.indexOf("NetworkScreenPolicy.mayOpen(held, pinned)") in 0 until open.indexOf("root.addView("))
        assertTrue(screen.contains("registerOnSharedPreferenceChangeListener(holdListener)"))
        assertTrue(screen.contains("key.startsWith(\"display_emergency_hold\")"))
        assertTrue(screen.contains("main.postDelayed(holdPoll, NetworkScreenPolicy.EMERGENCY_POLL_MS)"))
        assertTrue(screen.contains("NetworkScreenPolicy.mustClose(held)"))
        // Back is always one step back, from every control.
        assertTrue(screen.contains("if (event.action == KeyEvent.ACTION_UP) back()"))
        val main = code(read("$pkg/MainActivity.kt"))
        assertTrue(main.contains("NetworkScreen.back()"))
        assertTrue(main.contains("com.educms.player.network.NetworkScreen.isShowing()"))
        // The Wi-Fi save card leaves on the hold's own write too, and is offered only to a person.
        val prompt = all.getValue("WifiSavePrompt.kt")
        assertTrue(prompt.contains("registerOnSharedPreferenceChangeListener(listener)"))
        assertTrue(prompt.contains("emergencyHeld = heldNow(app)"))
        val offer = prompt.substring(prompt.indexOf("fun personPresent("), prompt.indexOf("private fun show("))
        assertTrue(offer.contains("WifiSetupPolicy.mayOfferCard("))
        // The boot card never pulls the remote away from the Network screen above it.
        assertTrue(code(read("$pkg/boot/BootDiagnosticsView.kt")).contains("!com.educms.player.network.NetworkScreen.isShowing()) parkFocus()"))
    }

    @Test fun standardAndroidApisOnlyNothingHiddenNoVendorNoDeviceOwnerNoRadioSwitching() {
        for ((name, src) in all + networkFiles) {
            for (banned in listOf(
                "Class.forName", "getDeclaredMethod", "getMethod(", "setAccessible", "android:change_wifi_state",
                "setWifiEnabled", "DevicePolicyManager", "EthernetManager", "sendBroadcast(", "bindService(",
            )) {
                assertFalse("$name uses $banned", src.contains(banned))
            }
        }
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
        // The only files allowed to handle it: the value, the wire, the policy's
        // "ask for it" rule, and the three places it goes INTO Android.
        val handlers = setOf(
            "DeviceSettingKey.kt", "DeviceSettingsWire.kt", "DeviceSettingsPolicy.kt",
            "Api29WifiSuggestions.kt", "LegacyWifiNetworks.kt", "LegacyWifiEngine.kt", "WifiConnect.kt",
        )
        for ((name, src) in all) {
            if (name in handlers) continue
            assertFalse("$name touches the passphrase", src.contains("passphrase"))
        }
        val wire = all.getValue("DeviceSettingsWire.kt")
        val encodeItems = wire.substring(wire.indexOf("fun encodeItems("), wire.indexOf("fun decodeItems("))
        assertFalse("the stored set has no passphrase field", encodeItems.contains("passphrase"))
        for ((name, src) in all + networkFiles) {
            assertFalse(
                "$name logs a secret",
                Regex("PlayerLogger\\.[a-z]+\\([^)]*(passphrase|password|keyboard\\.text)").containsMatchIn(src),
            )
        }
        // Nothing the legacy path or the dialog keeps on disk carries it.
        val prefsStore = all.getValue("LegacyWifiNetworks.kt").substringAfter("class PrefsWifiStateStore")
        assertFalse(prefsStore.contains("passphrase"))
        val prompt = all.getValue("WifiSavePrompt.kt")
        assertFalse("the staged request stays in memory", Regex("putString\\([^)]*request").containsMatchIn(prompt))
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
