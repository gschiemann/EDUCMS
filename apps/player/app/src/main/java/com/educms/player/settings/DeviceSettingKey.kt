package com.educms.player.settings

/**
 * The basic Android settings VenueOS may manage on a unit (2026-10-18), by
 * the names the API and the dashboard use for them.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT THIS PACKAGE IS
 * ─────────────────────────────────────────────────────────────────────
 * The owner asked for the app to set the everyday Android settings itself on
 * the Android 13+ fleet, so an installer no longer walks the Settings menus
 * on every panel — and WITHOUT device owner (owner decision 2026-10-17: the
 * Manager is never device owner). The inventory of what a normal, sideloaded
 * app can reach is `docs/research/2026-10-17-player-rock-solid/
 * 05-android-settings-without-device-owner.md`.
 *
 * An operator stores a DESIRED value per setting on the screen's row
 * (`PUT /screens/:id/device-settings`). The native heartbeat carries the
 * desired set down and this unit's report back up (CLAUDE.md player rule 6:
 * a command that must survive a dead push channel rides the heartbeat). No
 * bridge method is involved (rule 9).
 *
 * ⚠️ THE RULES, enforced in [DeviceSettingsPolicy], not in comments:
 *   • nothing is applied without a stored operator intent;
 *   • a setting is applied only when [DeviceSettingsProbe] says this unit can;
 *   • nothing changes while an emergency is held, while the panel is off or
 *     blanked, or in the first minute after it came on;
 *   • every attempt is persisted BEFORE it touches the setting, and bounded;
 *   • what is reported back is the value Android READS BACK, never the one
 *     that was requested.
 *
 * [recheckAfterBoot] — after a reboot an applied setting is READ AGAIN and,
 * when its read-back no longer matches, RECORDED as `changed-elsewhere` —
 * never set again (2026-10-24, owner rule: VenueOS never fights the vendor
 * app; before that date a drift at boot was re-applied, which on a Goodview
 * panel meant two apps taking turns on the same value). A value is written
 * exactly once per identity: when the operator changes it in the dashboard.
 * Wi-Fi is not re-checked: Android keeps a saved network and a suggestion
 * across reboots, and its passphrase is never stored on this unit.
 *
 * Wi-Fi is the one setting offered BELOW Android 13 (2026-10-23): every class
 * from Android 7 up gets the best mechanism its Android gives a normal app —
 * see [WifiSetupPolicy]. The other settings keep the Android 13 floor.
 */
enum class DeviceSettingKey(val wire: String, val recheckAfterBoot: Boolean) {
    BRIGHTNESS("brightness", true),
    VOLUME("volume", true),
    SCREEN_OFF_TIMEOUT("screenOffTimeoutMs", true),
    /**
     * Android TV's inactivity sleep (`Settings.Secure` `attentive_timeout`):
     * the box goes to sleep after this long with no remote or touch input,
     * WHATEVER wake lock the player holds — what turned a test box off after
     * hours. Needs WRITE_SECURE_SETTINGS. -1 = never.
     */
    ATTENTIVE_TIMEOUT("attentiveTimeoutMs", true),
    ROTATION_LOCK("rotationLock", true),
    AUTO_TIME("autoTime", true),
    AUTO_TIME_ZONE("autoTimeZone", true),
    NTP_SERVER("ntpServer", true),
    WIFI("wifi", false);

    companion object {
        fun fromWire(name: String?): DeviceSettingKey? = values().firstOrNull { it.wire == name }
    }
}

/** One desired value, already parsed off the wire. Pure data — no `android.*`. */
sealed class DesiredValue {
    /** A value of the wrong type for its key. Reported as `invalid-value`, never applied. */
    object Invalid : DesiredValue()

    data class IntValue(val value: Int) : DesiredValue()
    data class BoolValue(val value: Boolean) : DesiredValue()
    data class TextValue(val value: String) : DesiredValue()

    /**
     * One Wi-Fi network. [passphrase] is present only on the reply that
     * carries it; it is NEVER persisted on this unit (see
     * [DeviceSettingsStore]) and never logged.
     *
     * [permanent] (2026-10-23): the operator wants the network SAVED on the
     * screen rather than suggested — Android's own "save network" dialog, which
     * a person at the screen confirms once. Only offered where the unit reports
     * that dialog; below Android 10 every network is saved anyway.
     */
    data class WifiValue(
        val ssid: String,
        val security: String,
        val hidden: Boolean,
        val passphrase: String?,
        val permanent: Boolean = false,
    ) : DesiredValue() {
        /** Same network, same security — the passphrase is deliberately left out. */
        fun withoutSecret(): WifiValue = copy(passphrase = null)

        override fun toString(): String =
            "WifiValue(ssid=$ssid, security=$security, hidden=$hidden, permanent=$permanent, " +
                "passphrase=${if (passphrase == null) "none" else "***"})"
    }
}

/** One desired setting: what, which identity, which value. */
data class DesiredItem(
    val key: DeviceSettingKey,
    /** The server's identity for THIS value (`r<revision>`), compared by equality only. */
    val id: String,
    val value: DesiredValue,
)

/**
 * The closed vocabularies this unit reports. Mirrored in
 * `packages/api-types/src/device-settings.ts`; the API's drift spec parses
 * this file, so a new code must be added there in the same commit.
 */
object DeviceSettingCodes {
    /** The capability verdict for a setting that CAN be set right now. */
    const val OK = "ok"

    // ── Why a setting cannot be set on this unit right now ─────────────
    /** Needs Android 13 (API 33) or newer — the qualified floor for every setting but Wi-Fi. */
    const val API_LEVEL = "api-level"
    /** The WRITE_SETTINGS app-op ("Modify system settings") is not allowed. */
    const val NO_WRITE_SETTINGS = "no-write-settings"
    /** WRITE_SECURE_SETTINGS was not granted by the one-time install command. */
    const val NO_SECURE_SETTINGS = "no-secure-settings"
    /** The panel's brightness belongs to a vendor / LED controller mechanism. */
    const val VENDOR_BRIGHTNESS = "vendor-brightness"
    /** Nothing reaches the backlight — only our own picture can be dimmed. */
    const val PICTURE_ONLY = "picture-only"
    /** Android reports the volume as fixed (HDMI-out box; the TV owns it). */
    const val VOLUME_FIXED = "volume-fixed"
    /** No Wi-Fi on this unit. */
    const val NO_WIFI = "no-wifi"
    /** Someone declined VenueOS's Wi-Fi suggestions on this unit. */
    const val WIFI_DISALLOWED = "wifi-disallowed"
    /** This unit does not offer the setting at all. */
    const val UNSUPPORTED = "unsupported"

    val CAPABILITY_REASONS = setOf(
        API_LEVEL, NO_WRITE_SETTINGS, NO_SECURE_SETTINGS, VENDOR_BRIGHTNESS, PICTURE_ONLY,
        VOLUME_FIXED, NO_WIFI, WIFI_DISALLOWED, UNSUPPORTED,
    )

    // ── Why an item is waiting (no attempt is spent) ──────────────────
    const val WAIT_EMERGENCY = "emergency"
    const val WAIT_SCREEN_OFF = "screen-off"
    const val WAIT_BLANKED = "blanked"
    const val WAIT_SETTLING = "settling"

    // ── Why an attempt did not land ─────────────────────────────────────
    /** The write returned, but Android reads back a different value. */
    const val NOT_TAKEN = "not-taken"
    /** Android refused the write (returned false / SecurityException). */
    const val WRITE_REFUSED = "write-refused"
    /** The stored value is not one this unit accepts. Never retried. */
    const val INVALID_VALUE = "invalid-value"
    /** Anything else that threw. */
    const val ERROR = "error"
    /** The Wi-Fi passphrase has not reached this unit yet (it asks again). */
    const val NEEDS_SECRET = "needs-secret"
    /** The value is already in place; nothing was written. */
    const val ALREADY_SET = "already-set"
    /** Applied, but Android offers no way to read it back. */
    const val UNVERIFIED = "unverified"
    /**
     * Applied once, and since then something ELSE on the unit changed it —
     * the vendor's own app (Goodview's CloudSign / GvSettings), a person at
     * the panel, a firmware reset at boot. Recorded, NEVER re-applied
     * (2026-10-24, owner rule: VenueOS never fights the vendor app). The
     * status stays `applied`; the observed value sits beside it in the report.
     */
    const val CHANGED_ELSEWHERE = "changed-elsewhere"
    const val WIFI_REJECTED = "wifi-rejected"
    const val WIFI_LIMIT = "wifi-limit"
    const val WIFI_INVALID = "wifi-invalid"
    const val WIFI_RESTRICTED = "wifi-restricted"
    const val WIFI_ERROR = "wifi-error"

    // ── Wi-Fi: what actually happened (2026-10-23, every Android class) ──
    /** On this network now. On Android 9 and older VenueOS reached its own server over it before keeping it. */
    const val WIFI_JOINED = "wifi-joined"
    /** Saved on the screen: Android keeps it and joins it when it is the network to use. */
    const val WIFI_SAVED = "wifi-saved"
    /** Offered to Android; Android 10 and 11 never tell an app whether someone allowed its networks. */
    const val WIFI_SUGGESTED = "wifi-suggested"
    /** Waiting for the one-time "allow" Android itself asks for on the screen. */
    const val WIFI_APPROVAL = "wifi-approval"
    /** Waiting for a person at the screen to confirm Android's save-network dialog. */
    const val WIFI_DIALOG = "wifi-dialog"
    /** Joining it now; it is kept only once VenueOS reaches its server over it. */
    const val WIFI_SWITCHING = "wifi-switching"
    /** Wi-Fi is turned off on the screen. VenueOS never turns it on. */
    const val WIFI_OFF = "wifi-off"
    /** Someone at the screen pressed Not now, Cancel or Back. */
    const val WIFI_DECLINED = "wifi-declined"
    /** Nobody confirmed it on the screen in time. */
    const val WIFI_NO_ANSWER = "wifi-no-answer"
    /** This screen has no usable save-network dialog, or Android would not open it. */
    const val WIFI_NO_DIALOG = "wifi-no-dialog"
    /** It joined, but VenueOS could not reach its server over it: switched back. */
    const val WIFI_UNREACHABLE = "wifi-unreachable"
    /** It could not join in time (password, range): switched back. */
    const val WIFI_NO_CONNECT = "wifi-no-connect"
    /** A network with this name is already saved on the screen by someone else; VenueOS never changes it. */
    const val WIFI_EXISTS = "wifi-exists"
    /** This screen's Android cannot join this kind of network (WPA3 needs Android 10). */
    const val WIFI_SECURITY = "wifi-security"

    /**
     * An attempt that failed with one of these is never retried, not even
     * after a reboot. For Wi-Fi that is the never-strand rule's other half: a
     * switch that could not be proved is never tried again on its own (each
     * try costs the screen its connection for up to a minute), and a person's
     * "no" is never asked again. Saving the network again in the dashboard is
     * a new identity, and tries again.
     */
    val NEVER_RETRIED = setOf(
        INVALID_VALUE, WIFI_INVALID, WIFI_REJECTED, WIFI_DECLINED, WIFI_NO_ANSWER, WIFI_NO_DIALOG,
        WIFI_UNREACHABLE, WIFI_NO_CONNECT, WIFI_EXISTS, WIFI_SECURITY,
    )
}

/**
 * The value rules, applied on THIS side too: the setting is written into the
 * system, so a value the API should never have sent must be refused here,
 * not trusted. Pure — `DeviceSettingDomainsTest` covers every edge.
 */
object DeviceSettingDomains {
    /** Same floor as [com.educms.player.display.DisplayLimits.MIN_SAFE_BRIGHTNESS]. */
    const val MIN_BRIGHTNESS = 5

    /**
     * "Never" as Android signage ROMs store it. No shorter than a minute: the
     * timeout only governs a panel the player is NOT holding on (the OEM
     * launcher after a crash, Android's own screens), and the screen-off
     * blank sets its own 15 s value and puts this one back.
     */
    const val TIMEOUT_NEVER = Int.MAX_VALUE
    val TIMEOUTS_MS: Set<Int> = setOf(60_000, 300_000, 600_000, 1_800_000, 3_600_000, TIMEOUT_NEVER)

    /** "Never" as Android's PowerManager reads `attentive_timeout` (any value ≤ 0 disables it). */
    const val ATTENTIVE_NEVER = -1
    /** Never, or hours — never anything short enough to surprise a venue. */
    val ATTENTIVE_TIMEOUTS_MS: Set<Int> = setOf(ATTENTIVE_NEVER, 14_400_000, 28_800_000, 43_200_000, 86_400_000)

    val WIFI_SECURITY: Set<String> = setOf("open", "wpa2", "wpa3")

    private val HOST_LABEL = Regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
    private val IPV4 = Regex("^(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")

    /** `""` = remove the override (Android's own time server). */
    fun validNtpServer(value: String): Boolean {
        if (value.isEmpty()) return true
        if (value.length > 253) return false
        if (IPV4.matches(value)) return true
        val labels = value.split('.')
        // A bare number is not a host name; the last label must have a letter.
        if (labels.last().all { it.isDigit() }) return false
        return labels.all { HOST_LABEL.matches(it) }
    }

    fun validSsid(ssid: String): Boolean {
        val bytes = ssid.toByteArray(Charsets.UTF_8).size
        return bytes in 1..32 && ssid.none { it.code < 0x20 || it.code == 0x7f }
    }

    /** WPA2/WPA3 personal: 8..63 printable ASCII. Open networks carry none. */
    fun validPassphrase(security: String, passphrase: String?): Boolean = when (security) {
        "open" -> passphrase.isNullOrEmpty()
        "wpa2", "wpa3" -> passphrase == null ||
            (passphrase.length in 8..63 && passphrase.all { it.code in 0x20..0x7e })
        else -> false
    }

    /** Is [value] one this unit accepts for [key]? A missing Wi-Fi passphrase is valid here — [DeviceSettingsPolicy] asks for it. */
    fun valid(key: DeviceSettingKey, value: DesiredValue): Boolean = value !is DesiredValue.Invalid && when (key) {
        DeviceSettingKey.BRIGHTNESS ->
            value is DesiredValue.IntValue && value.value in MIN_BRIGHTNESS..100
        DeviceSettingKey.VOLUME ->
            value is DesiredValue.IntValue && value.value in 0..100
        DeviceSettingKey.SCREEN_OFF_TIMEOUT ->
            value is DesiredValue.IntValue && value.value in TIMEOUTS_MS
        DeviceSettingKey.ATTENTIVE_TIMEOUT ->
            value is DesiredValue.IntValue && value.value in ATTENTIVE_TIMEOUTS_MS
        DeviceSettingKey.ROTATION_LOCK, DeviceSettingKey.AUTO_TIME, DeviceSettingKey.AUTO_TIME_ZONE ->
            value is DesiredValue.BoolValue
        DeviceSettingKey.NTP_SERVER ->
            value is DesiredValue.TextValue && validNtpServer(value.value)
        DeviceSettingKey.WIFI ->
            value is DesiredValue.WifiValue && validSsid(value.ssid) &&
                value.security in WIFI_SECURITY && validPassphrase(value.security, value.passphrase)
    }
}
