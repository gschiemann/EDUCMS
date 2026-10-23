package com.educms.player.network

import com.educms.player.settings.DeviceSettingCodes

/**
 * The built-in on-screen keyboard (2026-10-23) — pure, so every key has a JVM
 * test (`NetworkScreenModelTest`).
 *
 * WHY VenueOS DRAWS ITS OWN: these panels are driven by a D-pad remote, and
 * whether the system keyboard opens, takes focus and can be typed on with
 * only arrows and OK differs per ROM (some signage builds ship none at all,
 * some a touch-only one). A password must be typeable on every class, so the
 * Network screen never depends on it. A hardware keyboard still types.
 *
 * Three layouts of printable ASCII (the only characters a WPA password may
 * hold): lower case, upper case, symbols. Every row is the same width so the
 * D-pad moves in a straight grid.
 */
data class KeyboardModel(
    val text: String = "",
    val layout: Layout = Layout.LOWER,
    val maxLength: Int = 63,
) {
    enum class Layout { LOWER, UPPER, SYMBOLS }

    sealed class Key {
        data class Char(val c: kotlin.Char) : Key()
        object Shift : Key()
        object Symbols : Key()
        object Space : Key()
        object Delete : Key()
        object Clear : Key()
    }

    fun rows(): List<List<Key>> {
        val chars = when (layout) {
            Layout.LOWER -> LOWER
            Layout.UPPER -> LOWER.map { it.uppercase() }
            Layout.SYMBOLS -> SYMBOLS
        }
        val grid: List<List<Key>> = chars.map { row -> row.map { Key.Char(it) } }
        return grid + listOf(listOf(Key.Shift, Key.Symbols, Key.Space, Key.Delete, Key.Clear))
    }

    fun press(key: Key): KeyboardModel = when (key) {
        is Key.Char -> type(key.c)
        Key.Shift -> copy(layout = if (layout == Layout.UPPER) Layout.LOWER else Layout.UPPER)
        Key.Symbols -> copy(layout = if (layout == Layout.SYMBOLS) Layout.LOWER else Layout.SYMBOLS)
        Key.Space -> type(' ')
        Key.Delete -> copy(text = text.dropLast(1))
        Key.Clear -> copy(text = "")
    }

    /** Printable ASCII only, never past [maxLength] — a hardware keyboard goes through here too. */
    fun type(c: kotlin.Char): KeyboardModel =
        if (c.code in 0x20..0x7e && text.length < maxLength) copy(text = text + c) else this

    companion object {
        private val LOWER = listOf("1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm_.@")
        private val SYMBOLS = listOf("!\"#$%&'()*", "+,/:;<=>?[", "\\]^`{|}~-_", "0123456789")
    }
}

/**
 * When the Network screen may be on the glass, and what it says about a
 * connection — pure (`NetworkScreenModelTest`).
 *
 * ⚠️ AN ALERT OUTRANKS IT, ALWAYS: it never opens while an emergency hold is
 * in force, and it leaves the glass the moment one starts — the alert renders
 * in the page underneath, and nothing of VenueOS's own may sit over it.
 */
object NetworkScreenPolicy {

    /** How often the open screen re-reads the hold, besides its change listener. */
    const val EMERGENCY_POLL_MS = 250L

    /** How often the open screen refreshes the connection line. */
    const val STATUS_REFRESH_MS = 5_000L

    fun mayOpen(emergencyHeld: Boolean, lockTask: Boolean): Boolean = !emergencyHeld && !lockTask

    fun mustClose(emergencyHeld: Boolean): Boolean = emergencyHeld

    /** A password field is needed for this security (open networks have none). */
    fun needsPassword(security: String): Boolean = security == "wpa2" || security == "wpa3"

    /** A WPA password: 8–63 printable characters. */
    fun passwordOk(password: String): Boolean = password.length in 8..63 && password.all { it.code in 0x20..0x7e }

    /** The plain-words line for a connection result, as a string-resource name. */
    enum class Words {
        CONNECTED,
        SAVED,
        SUGGESTED,
        WAITING_APPROVAL,
        WAITING_DIALOG,
        JOINING,
        WRONG_PASSWORD,
        COULD_NOT_JOIN,
        NO_SERVER,
        DECLINED,
        ALERT,
        WIFI_OFF,
        NAME_TAKEN,
        NOT_SUPPORTED,
        FAILED,
    }

    /**
     * The engine's status + code ([com.educms.player.settings.WifiConnect.Result])
     * as what a person standing at the screen needs to read. "Could not join"
     * always comes with the network the screen stayed on — the never-strand
     * rule, said out loud.
     */
    fun words(status: String, code: String?): Words = when (code) {
        DeviceSettingCodes.WIFI_JOINED -> Words.CONNECTED
        DeviceSettingCodes.WIFI_SAVED -> Words.SAVED
        DeviceSettingCodes.WIFI_SUGGESTED -> Words.SUGGESTED
        DeviceSettingCodes.WIFI_APPROVAL -> Words.WAITING_APPROVAL
        DeviceSettingCodes.WIFI_DIALOG -> Words.WAITING_DIALOG
        DeviceSettingCodes.WIFI_SWITCHING -> Words.JOINING
        // Below Android 8 a wrong password shows up as "Android disabled the network".
        DeviceSettingCodes.WIFI_NO_CONNECT -> Words.COULD_NOT_JOIN
        DeviceSettingCodes.WIFI_UNREACHABLE -> Words.NO_SERVER
        DeviceSettingCodes.WIFI_INVALID, DeviceSettingCodes.NEEDS_SECRET -> Words.WRONG_PASSWORD
        DeviceSettingCodes.WIFI_DECLINED, DeviceSettingCodes.WIFI_NO_ANSWER -> Words.DECLINED
        DeviceSettingCodes.WAIT_EMERGENCY -> Words.ALERT
        DeviceSettingCodes.WIFI_OFF -> Words.WIFI_OFF
        DeviceSettingCodes.WIFI_EXISTS -> Words.NAME_TAKEN
        DeviceSettingCodes.WIFI_SECURITY, DeviceSettingCodes.WIFI_NO_DIALOG, DeviceSettingCodes.NO_WIFI,
        DeviceSettingCodes.UNSUPPORTED, DeviceSettingCodes.WIFI_REJECTED, DeviceSettingCodes.WIFI_RESTRICTED,
        -> Words.NOT_SUPPORTED
        null -> if (status == "applied") Words.SAVED else Words.FAILED
        else -> Words.FAILED
    }

    /** Signal as a glyph the screen can draw without an icon font. */
    fun signal(bars: Int): String = "▂▄▆█".take(bars.coerceIn(0, 4)).padEnd(4, '·')
}
