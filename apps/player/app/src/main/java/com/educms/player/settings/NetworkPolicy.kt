package com.educms.player.settings

/**
 * NEARBY NETWORKS AND CONNECTION STATUS — the pure rules (2026-10-23), so
 * every verdict has a JVM test (`NetworkPolicyTest`). The Android halves are
 * [WifiScan] and [NetworkStatus]; VenueOS's on-screen Network screen and the
 * heartbeat report read them.
 *
 * ── WHAT ANDROID REQUIRES TO LIST NEARBY NETWORKS ─────────────────────
 * `WifiManager.getScanResults()` returns real results only to an app that
 * holds a LOCATION permission AND while Location is switched on — on every
 * Android this fleet runs. Android 10+ requires FINE location (an app that
 * targets Android 10+); Android 9 and older accept COARSE or FINE. The
 * API-34 platform documentation for `getScanResults` names
 * ACCESS_FINE_LOCATION, not NEARBY_WIFI_DEVICES: on Android 13+ that newer
 * permission covers Wi-Fi Direct, Aware, local-only hotspots and channel
 * data, not the scan list. So VenueOS asks for location on every version and
 * says so; it never asks for a permission that would not unlock the list.
 *
 * Location OFF is its own state, never an empty list: Android returns
 * nothing then, and "no networks nearby" would be a lie.
 */
object WifiScanPolicy {

    const val PERMISSION_FINE = "android.permission.ACCESS_FINE_LOCATION"
    const val PERMISSION_COARSE = "android.permission.ACCESS_COARSE_LOCATION"

    /** Android 10: an app that targets 10+ needs FINE location for the scan list. */
    const val FINE_ONLY_SDK = 29

    /**
     * Android 9+ allows a foreground app 4 scan requests per 2 minutes — one
     * per 30 s keeps VenueOS inside it. A request inside the gap reads the
     * results Android already has instead of asking again.
     */
    const val MIN_SCAN_GAP_MS = 30_000L

    /** How long a scan may take before the list Android has is read anyway. */
    const val SCAN_TIMEOUT_MS = 10_000L

    /** The most networks ever listed. */
    const val MAX_NETWORKS = 40

    enum class Access {
        /** The list can be read. */
        GRANTED,

        /** VenueOS has not been allowed location (Android asks once, on the screen). */
        NEEDS_PERMISSION,

        /** Location was declined with "don't ask again": only Android's settings can allow it now. */
        DENIED,

        /** Location is switched off on this screen. */
        LOCATION_OFF,

        /** Wi-Fi is turned off. VenueOS never turns it on. */
        WIFI_OFF,

        /** No Wi-Fi on this unit. */
        NO_WIFI,

        /** An alert is on this screen: nothing starts. */
        EMERGENCY,
    }

    /** Both location permissions, asked together (Android 12+ requires COARSE beside FINE). */
    fun permissions(): List<String> = listOf(PERMISSION_FINE, PERMISSION_COARSE)

    /**
     * Ask for location at first launch only (2026-10-26): once it is asked, or
     * granted, a join never raises Android's dialog. A refusal is not asked again.
     */
    fun shouldAskAtLaunch(granted: Set<String>, askedBefore: Boolean): Boolean =
        !askedBefore && PERMISSION_FINE !in granted

    fun hasPermission(sdk: Int, granted: Set<String>): Boolean =
        if (sdk >= FINE_ONLY_SDK) PERMISSION_FINE in granted
        else PERMISSION_FINE in granted || PERMISSION_COARSE in granted

    /**
     * @param askedBefore VenueOS has asked on this unit before.
     * @param rationale Android's `shouldShowRequestPermissionRationale` —
     *        false after a "don't ask again" (and before the first ask).
     */
    fun access(
        sdk: Int,
        hasWifi: Boolean,
        radioOn: Boolean?,
        granted: Set<String>,
        locationOn: Boolean?,
        emergencyHeld: Boolean,
        askedBefore: Boolean,
        rationale: Boolean,
    ): Access = when {
        !hasWifi -> Access.NO_WIFI
        emergencyHeld -> Access.EMERGENCY
        radioOn == false -> Access.WIFI_OFF
        !hasPermission(sdk, granted) -> if (askedBefore && !rationale) Access.DENIED else Access.NEEDS_PERMISSION
        locationOn == false -> Access.LOCATION_OFF
        else -> Access.GRANTED
    }

    /** Ask Android for a fresh scan, or read what it already has? */
    fun shouldStartScan(lastStartElapsedMs: Long, nowElapsedMs: Long): Boolean =
        lastStartElapsedMs <= 0L || nowElapsedMs < lastStartElapsedMs || nowElapsedMs - lastStartElapsedMs >= MIN_SCAN_GAP_MS

    /** Never during an alert, never in a pinned task (Android refuses the dialog there anyway). */
    fun mayRequestPermission(emergencyHeld: Boolean, lockTask: Boolean): Boolean = !emergencyHeld && !lockTask

    /**
     * The security of a network from Android's capability string
     * (`[WPA2-PSK-CCMP][ESS]`, `[RSN-SAE-CCMP]`, `[WEP]`, …). A WPA2/WPA3
     * transition network reads WPA2 — the one every screen can join.
     */
    fun security(capabilities: String?): String {
        val c = capabilities?.uppercase() ?: return SEC_OPEN
        return when {
            "EAP" in c -> SEC_ENTERPRISE
            "PSK" in c -> SEC_WPA2
            "SAE" in c -> SEC_WPA3
            "WEP" in c -> SEC_WEP
            "OWE" in c -> SEC_OTHER
            else -> SEC_OPEN
        }
    }

    const val SEC_OPEN = "open"
    const val SEC_WPA2 = "wpa2"
    const val SEC_WPA3 = "wpa3"
    const val SEC_WEP = "wep"
    const val SEC_ENTERPRISE = "enterprise"
    const val SEC_OTHER = "other"

    /** Can VenueOS join this kind of network? (Enterprise, WEP and OWE need more than a password.) */
    fun joinable(security: String): Boolean = security == SEC_OPEN || security == SEC_WPA2 || security == SEC_WPA3

    /** Signal as 0–4 bars: Android's own five-level scale (−100 dBm … −55 dBm). */
    fun bars(rssi: Int): Int = when {
        rssi <= -100 -> 0
        rssi >= -55 -> 4
        else -> ((rssi + 100) * 4) / 45
    }

    /** One scan result as Android gives it (no secret is ever part of one). */
    data class Raw(val ssid: String?, val rssi: Int, val capabilities: String?)

    data class Network(
        val ssid: String,
        val bars: Int,
        val rssi: Int,
        val security: String,
        /** `venueos` (VenueOS saved it), `other` (a person or the vendor did), null (not saved, or Android will not say). */
        val savedBy: String?,
        val connected: Boolean,
    )

    const val SAVED_VENUEOS = "venueos"
    const val SAVED_OTHER = "other"

    /**
     * The list a person sees: hidden (nameless) networks dropped, one row per
     * name and security (the strongest access point), the one in use first,
     * then saved ones, then by signal; at most [MAX_NETWORKS].
     */
    fun networks(
        raw: List<Raw>,
        ours: Set<String>,
        othersSaved: Set<String>,
        connectedSsid: String?,
    ): List<Network> {
        val best = LinkedHashMap<Pair<String, String>, Raw>()
        for (r in raw) {
            val ssid = r.ssid?.takeIf { it.isNotBlank() && DeviceSettingDomains.validSsid(it) } ?: continue
            val key = ssid to security(r.capabilities)
            val held = best[key]
            if (held == null || r.rssi > held.rssi) best[key] = r
        }
        return best.map { (key, r) ->
            Network(
                ssid = key.first,
                bars = bars(r.rssi),
                rssi = r.rssi,
                security = key.second,
                savedBy = when (key.first) {
                    in ours -> SAVED_VENUEOS
                    in othersSaved -> SAVED_OTHER
                    else -> null
                },
                connected = connectedSsid != null && key.first == connectedSsid,
            )
        }.sortedWith(
            compareByDescending<Network> { it.connected }
                .thenByDescending { it.savedBy != null }
                .thenByDescending { it.rssi }
                .thenBy { it.ssid },
        ).take(MAX_NETWORKS)
    }
}

/** The connection as a person (and the dashboard) should see it — pure rules. */
object NetworkStatusPolicy {

    const val T_WIFI = "wifi"
    const val T_ETHERNET = "ethernet"
    const val T_OTHER = "other"
    const val T_NONE = "none"

    /** Android 11: LinkProperties says which DHCP server gave the address. */
    const val DHCP_SDK = 30

    fun transport(activeWifi: Boolean, activeEthernet: Boolean, hasActive: Boolean): String = when {
        activeEthernet -> T_ETHERNET
        activeWifi -> T_WIFI
        hasActive -> T_OTHER
        else -> T_NONE
    }

    /** The address a person would type: IPv4 first, then a global IPv6; never loopback or link-local. */
    fun pickIp(addresses: List<String>): String? {
        val clean = addresses.map { it.substringBefore('%') }.filter { it.isNotBlank() }
        clean.firstOrNull { isIpv4(it) && !it.startsWith("127.") && !it.startsWith("169.254.") }?.let { return it }
        return clean.firstOrNull { it.contains(':') && !it.startsWith("fe80", ignoreCase = true) && it != "::1" }
            ?.take(45)
    }

    fun isIpv4(a: String): Boolean =
        Regex("^(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$").matches(a)

    /**
     * Automatic (DHCP) or fixed? Only Android 11+ says: a DHCP server address
     * means automatic; an IPv4 address with none means fixed. Below 11 —
     * unknown, never guessed.
     */
    fun automatic(sdk: Int, hasIpv4: Boolean, dhcpServer: String?): Boolean? = when {
        sdk < DHCP_SDK -> null
        dhcpServer != null -> true
        hasIpv4 -> false
        else -> null
    }

    /** `WifiInfo.getSSID()` as a name: quotes stripped; Android's placeholder or a hex name = unknown. */
    fun ssid(raw: String?): String? {
        if (raw.isNullOrBlank() || raw == "<unknown ssid>" || raw == "0x") return null
        if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
            return raw.substring(1, raw.length - 1).takeIf { it.isNotEmpty() && DeviceSettingDomains.validSsid(it) }
        }
        return null
    }

    /** Android reports an RSSI it does not have as −127 (or anything absurd). */
    fun rssi(raw: Int?): Int? = raw?.takeIf { it in -126..0 }
}
