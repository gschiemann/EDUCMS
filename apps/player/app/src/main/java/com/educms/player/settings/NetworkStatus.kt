package com.educms.player.settings

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build

/**
 * THE CONNECTION RIGHT NOW (2026-10-23): Wi-Fi (name, signal, address),
 * Ethernet (cable, address, automatic or fixed) or offline — read through
 * `ConnectivityManager` / `LinkProperties`, nothing else. Read-only; never
 * throws. Feeds the heartbeat report (`net`) and VenueOS's on-screen Network
 * screen. The rules are [NetworkStatusPolicy].
 *
 * What Android will not tell a normal app is left out, never guessed:
 *  • the Wi-Fi network's NAME on Android 9+ needs location (allowed and on);
 *    on Android 9 and older VenueOS reads it from the saved list instead;
 *  • automatic vs fixed address exists only from Android 11.
 */
object NetworkStatus {

    @Suppress("DEPRECATION") // getAllNetworks / connectionInfo: the only reads below Android 12; read-only.
    fun read(ctx: Context): DeviceSettingsWire.NetStatus {
        val app = ctx.applicationContext
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return DeviceSettingsWire.NetStatus(NetworkStatusPolicy.T_NONE)
        val active = runCatching { cm.activeNetwork }.getOrNull()
        val caps = active?.let { runCatching { cm.getNetworkCapabilities(it) }.getOrNull() }
        val wifiActive = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        val ethernetActive = caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true
        val transport = NetworkStatusPolicy.transport(wifiActive, ethernetActive, active != null && caps != null)

        // A cable that is up, even while Wi-Fi carries the traffic.
        val ethernetLink = ethernetActive || runCatching {
            cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true }
        }.getOrDefault(false)

        val lp: LinkProperties? = active?.let { runCatching { cm.getLinkProperties(it) }.getOrNull() }
        val addresses = lp?.linkAddresses?.mapNotNull { runCatching { it.address.hostAddress }.getOrNull() }.orEmpty()
        val ip = NetworkStatusPolicy.pickIp(addresses)
        val dhcp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching { lp?.dhcpServerAddress?.hostAddress }.getOrNull()
        } else {
            null
        }
        val auto = NetworkStatusPolicy.automatic(Build.VERSION.SDK_INT, addresses.any { NetworkStatusPolicy.isIpv4(it) }, dhcp)

        var ssid: String? = null
        var rssi: Int? = null
        if (wifiActive) {
            val wm = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val info = runCatching { wm?.connectionInfo }.getOrNull()
            rssi = NetworkStatusPolicy.rssi(info?.rssi)
            ssid = NetworkStatusPolicy.ssid(info?.ssid)
            if (ssid == null && Build.VERSION.SDK_INT < WifiSetupPolicy.SUGGESTION_SDK) {
                // Android 9 and older: the saved list says which one is CURRENT, no location needed.
                ssid = runCatching { LegacyWifiNetworks(app).configured()?.firstOrNull { it.current }?.key?.ssid }.getOrNull()
            }
        }
        return DeviceSettingsWire.NetStatus(
            transport = transport,
            validated = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            ssid = ssid,
            rssi = rssi,
            bars = rssi?.let { WifiScanPolicy.bars(it) },
            ip = if (transport == NetworkStatusPolicy.T_NONE) null else ip,
            auto = if (transport == NetworkStatusPolicy.T_NONE) null else auto,
            ethernetLink = ethernetLink,
        )
    }
}
