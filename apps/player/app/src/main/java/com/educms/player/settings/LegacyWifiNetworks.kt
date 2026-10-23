package com.educms.player.settings

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import com.educms.player.security.HostAllowlist
import java.net.HttpURLConnection
import java.net.URL

/**
 * The real [LegacyWifiPort] — Android 9 and older ONLY (2026-10-23).
 *
 * ⚠️ DEPRECATED CALLS, ON PURPOSE. `addNetwork`, `enableNetwork`,
 * `saveConfiguration`, `getConfiguredNetworks` and `WifiConfiguration` are
 * deprecated from Android 10, and for an app that TARGETS Android 10 they
 * fail ON Android 10+. This player targets 34 — but below Android 10 the
 * platform has no such rule, so these are the documented, silent way a normal
 * app saves a Wi-Fi network there. `WifiSetup` constructs this class only
 * when `SDK_INT < 29`; every symbol used here exists since API 1–23, so it
 * also loads safely anywhere (there is no `VerifyError` to fear). The
 * deprecation is suppressed per call, not per file, so a new one stands out.
 *
 * What it never does: turn Wi-Fi on, read a saved password (Android masks
 * them anyway), or touch a network VenueOS did not add — [LegacyWifiEngine]
 * passes only VenueOS's own network ids to [update], [remove], [disable] and
 * a connecting [enable] (Android itself refuses the rest since Android 6).
 */
internal class LegacyWifiNetworks(private val app: Context) : LegacyWifiPort {

    private fun wm(): WifiManager? = app.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private fun cm(): ConnectivityManager? =
        app.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    override fun radioOn(): Boolean? = runCatching { wm()?.isWifiEnabled }.getOrNull()

    @Suppress("DEPRECATION")
    override fun configured(): List<WifiSetupPolicy.SavedNetwork>? = runCatching {
        val list = wm()?.configuredNetworks ?: return null
        list.map { c ->
            WifiSetupPolicy.SavedNetwork(
                networkId = c.networkId,
                key = keyOf(c),
                enabled = c.status != WifiConfiguration.Status.DISABLED,
                current = c.status == WifiConfiguration.Status.CURRENT,
            )
        }
    }.getOrNull()

    @Suppress("DEPRECATION")
    override fun add(value: DesiredValue.WifiValue): Int = runCatching { wm()?.addNetwork(config(value)) }.getOrNull() ?: -1

    @Suppress("DEPRECATION")
    override fun update(networkId: Int, value: DesiredValue.WifiValue): Int = runCatching {
        wm()?.updateNetwork(config(value).apply { this.networkId = networkId })
    }.getOrNull() ?: -1

    @Suppress("DEPRECATION")
    override fun enable(networkId: Int, connect: Boolean): Boolean =
        runCatching { wm()?.enableNetwork(networkId, connect) }.getOrNull() == true

    @Suppress("DEPRECATION")
    override fun remove(networkId: Int): Boolean = runCatching { wm()?.removeNetwork(networkId) }.getOrNull() == true

    @Suppress("DEPRECATION")
    override fun disable(networkId: Int): Boolean = runCatching { wm()?.disableNetwork(networkId) }.getOrNull() == true

    @Suppress("DEPRECATION")
    override fun saveConfiguration(): Boolean = runCatching { wm()?.saveConfiguration() }.getOrNull() == true

    @Suppress("DEPRECATION")
    override fun reconnect(): Boolean = runCatching { wm()?.reconnect() }.getOrNull() == true

    override fun defaultIsWifi(): Boolean? = runCatching {
        val m = cm() ?: return null
        val caps = m.getNetworkCapabilities(m.activeNetwork ?: return false) ?: return null
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }.getOrNull()

    /**
     * VenueOS's own server, over the WIFI network specifically (bound to it,
     * so a cable cannot answer for it): the public liveness route, which
     * always answers 200. Only the allow-listed API host the player already
     * talks to; a few seconds at most.
     */
    @Suppress("DEPRECATION") // getAllNetworks: Android 9 and older only, where it is the API.
    override fun reachesServerOverWifi(): Boolean = runCatching {
        val root = app.applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            .getString("api_root", null)?.trimEnd('/')
        if (root.isNullOrBlank() || !HostAllowlist.isApiHost(root)) return false
        val m = cm() ?: return false
        val wifi = m.allNetworks.firstOrNull { n ->
            m.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        } ?: return false
        val conn = wifi.openConnection(URL("$root/api/v1/health")) as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = PROBE_TIMEOUT_MS
            conn.readTimeout = PROBE_TIMEOUT_MS
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }.getOrDefault(false)

    /** The network as Android stores it. The passphrase goes in here and nowhere else, never logged. */
    @Suppress("DEPRECATION")
    private fun config(value: DesiredValue.WifiValue): WifiConfiguration = WifiConfiguration().apply {
        SSID = "\"${value.ssid}\""
        hiddenSSID = value.hidden
        when (value.security) {
            "wpa2" -> {
                allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK)
                preSharedKey = "\"${value.passphrase.orEmpty()}\""
            }
            else -> allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
        }
    }

    /** Name + security of a saved network — null for anything VenueOS could never have written. */
    @Suppress("DEPRECATION")
    private fun keyOf(c: WifiConfiguration): WifiSetupPolicy.NetKey? {
        val raw = c.SSID ?: return null
        // Quoted = a UTF-8 name. A hex name is never one VenueOS wrote.
        if (raw.length < 2 || !raw.startsWith("\"") || !raw.endsWith("\"")) return null
        val ssid = raw.substring(1, raw.length - 1)
        val km = c.allowedKeyManagement
        val wep = c.wepKeys?.any { it != null } == true
        val security = when {
            km.get(WifiConfiguration.KeyMgmt.WPA_PSK) -> "wpa2"
            km.get(WifiConfiguration.KeyMgmt.NONE) && !wep -> "open"
            else -> return null
        }
        return WifiSetupPolicy.NetKey(ssid, security)
    }

    private companion object {
        const val PROBE_TIMEOUT_MS = 5_000
    }
}

/** [WifiStateStore] in its own private prefs file — no secret ever goes in it. */
internal class PrefsWifiStateStore(ctx: Context) : WifiStateStore {
    private val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun ledger(): Set<WifiSetupPolicy.NetKey> = WifiSetupPolicy.decodeLedger(prefs.getString(KEY_LEDGER, null))

    override fun putLedger(keys: Set<WifiSetupPolicy.NetKey>): Boolean =
        prefs.edit().putString(KEY_LEDGER, WifiSetupPolicy.encodeLedger(keys)).commit()

    override fun journal(): WifiSetupPolicy.Journal? = WifiSetupPolicy.decodeJournal(prefs.getString(KEY_JOURNAL, null))

    override fun putJournal(journal: WifiSetupPolicy.Journal?): Boolean =
        if (journal == null) {
            prefs.edit().remove(KEY_JOURNAL).commit()
        } else {
            prefs.edit().putString(KEY_JOURNAL, WifiSetupPolicy.encodeJournal(journal)).commit()
        }

    companion object {
        const val PREFS = "edu_wifi_setup"
        private const val KEY_LEDGER = "legacy.ours"
        private const val KEY_JOURNAL = "legacy.switch"
    }
}
