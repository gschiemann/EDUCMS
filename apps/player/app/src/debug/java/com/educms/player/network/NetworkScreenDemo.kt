package com.educms.player.network

import android.content.Context
import android.provider.Settings
import com.educms.player.settings.DeviceSettingCodes
import com.educms.player.settings.DeviceSettingsWire
import com.educms.player.settings.NetworkStatusPolicy
import com.educms.player.settings.WifiScanPolicy

/**
 * DEBUG BUILDS ONLY (src/debug — the release twin returns null): scripted
 * networks so every state of the Network screen can be reviewed on an
 * emulator. Switch one on, then open the screen:
 *
 *   adb shell settings put global venueos_network_demo <name>
 *   adb shell settings delete global venueos_network_demo     # back to real
 *
 * Names: home · offline · unreachable · ethernet · scanning · empty ·
 * location-off · wifi-off · permission · wrong · nojoin · noserver · alert ·
 * saved · approval · dialog. Network names are generic — the repository is
 * public.
 */
internal object NetworkScreenDemo {

    private const val SETTING = "venueos_network_demo"

    private const val HOME = "VenueOS Lobby"

    private fun wifi(ssid: String, ip: String?, validated: Boolean = true, rssi: Int = -50) = DeviceSettingsWire.NetStatus(
        transport = NetworkStatusPolicy.T_WIFI,
        validated = validated,
        ssid = ssid,
        rssi = rssi,
        bars = WifiScanPolicy.bars(rssi),
        ip = ip,
        auto = true,
        ethernetLink = false,
    )

    private val OFFLINE = DeviceSettingsWire.NetStatus(transport = NetworkStatusPolicy.T_NONE, ethernetLink = false)

    private val ETHERNET = DeviceSettingsWire.NetStatus(
        transport = NetworkStatusPolicy.T_ETHERNET,
        validated = true,
        ip = "10.20.0.15",
        auto = true,
        ethernetLink = true,
    )

    private fun nearby(connected: String?) = listOf(
        NetworkDemo.network(HOME, -47, WifiScanPolicy.SEC_WPA2, connected = connected == HOME, saved = true),
        NetworkDemo.network("Staff-5G", -53, WifiScanPolicy.SEC_WPA3),
        NetworkDemo.network("Guest WiFi", -58, WifiScanPolicy.SEC_OPEN),
        NetworkDemo.network("Front Desk", -64, WifiScanPolicy.SEC_WPA2),
        NetworkDemo.network("Corporate", -61, WifiScanPolicy.SEC_ENTERPRISE),
        NetworkDemo.network("Media-Players", -71, WifiScanPolicy.SEC_WPA2),
        NetworkDemo.network("Conference Room", -79, WifiScanPolicy.SEC_WPA2),
        NetworkDemo.network("Printer-Setup", -88, WifiScanPolicy.SEC_OPEN),
    )

    /** A join Android takes at once and moves onto: stages walk to VenueOS, then success. */
    private val joins: (String) -> List<NetworkDemo.Beat> = { target ->
        listOf(
            NetworkDemo.Beat(700L, result = "applied" to DeviceSettingCodes.WIFI_SAVED),
            NetworkDemo.Beat(1_900L, status = wifi(target, ip = null)),
            NetworkDemo.Beat(3_300L, status = wifi(target, ip = "192.168.10.57"), venueos = true),
        )
    }

    fun scenario(ctx: Context): NetworkDemo? {
        val name = runCatching { Settings.Global.getString(ctx.contentResolver, SETTING) }.getOrNull()
            ?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val home = wifi(HOME, "192.168.10.42")
        return when (name) {
            "home" -> NetworkDemo(home, WifiScanPolicy.Access.GRANTED, nearby(HOME), true, joins)
            "offline" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, nearby(null), false, joins)
            // An "alert" takes the screen away 15 s after it opens (switch to "offline" before reopening).
            "alert" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, nearby(null), false, joins, alertAfterMs = 15_000L)
            "unreachable" -> NetworkDemo(wifi(HOME, "192.168.10.42", validated = false), WifiScanPolicy.Access.GRANTED, nearby(HOME), false, joins)
            "ethernet" -> NetworkDemo(ETHERNET, WifiScanPolicy.Access.GRANTED, nearby(null), true, joins)
            "scanning" -> NetworkDemo(OFFLINE, null, emptyList(), false, joins)
            "empty" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, emptyList(), false, joins)
            "location-off" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.LOCATION_OFF, emptyList(), false, joins)
            "wifi-off" -> NetworkDemo(ETHERNET, WifiScanPolicy.Access.WIFI_OFF, emptyList(), true, joins)
            "permission" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.NEEDS_PERMISSION, emptyList(), false, joins)
            "wrong" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, nearby(null), false, { _ ->
                listOf(NetworkDemo.Beat(2_400L, result = "failed" to DeviceSettingCodes.WIFI_INVALID))
            })
            "nojoin" -> NetworkDemo(home, WifiScanPolicy.Access.GRANTED, nearby(HOME), true, { _ ->
                listOf(
                    NetworkDemo.Beat(600L, result = "pending" to DeviceSettingCodes.WIFI_SWITCHING),
                    NetworkDemo.Beat(4_200L, result = "failed" to DeviceSettingCodes.WIFI_NO_CONNECT),
                )
            })
            "noserver" -> NetworkDemo(home, WifiScanPolicy.Access.GRANTED, nearby(HOME), true, { target ->
                listOf(
                    NetworkDemo.Beat(600L, result = "pending" to DeviceSettingCodes.WIFI_SWITCHING),
                    NetworkDemo.Beat(1_800L, status = wifi(target, ip = null)),
                    NetworkDemo.Beat(3_000L, status = wifi(target, ip = "172.16.4.20"), venueos = false),
                    NetworkDemo.Beat(5_800L, status = home, venueos = true, result = "failed" to DeviceSettingCodes.WIFI_UNREACHABLE),
                )
            })
            "saved" -> NetworkDemo(home, WifiScanPolicy.Access.GRANTED, nearby(HOME), true, { _ ->
                listOf(NetworkDemo.Beat(800L, result = "applied" to DeviceSettingCodes.WIFI_SAVED))
            })
            "approval" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, nearby(null), false, { _ ->
                listOf(NetworkDemo.Beat(800L, result = "waiting" to DeviceSettingCodes.WIFI_APPROVAL))
            })
            "dialog" -> NetworkDemo(OFFLINE, WifiScanPolicy.Access.GRANTED, nearby(null), false, { _ ->
                listOf(NetworkDemo.Beat(800L, result = "waiting" to DeviceSettingCodes.WIFI_DIALOG))
            })
            else -> null
        }
    }
}
