package com.educms.player.network

import com.educms.player.settings.DeviceSettingCodes
import com.educms.player.settings.NetworkStatusPolicy
import com.educms.player.settings.WifiScanPolicy

/**
 * The built-in on-screen keyboard (2026-10-23; redesigned 2026-10-24) — pure,
 * so every key has a JVM test (`NetworkScreenModelTest`, `NetworkScreenFlowTest`).
 *
 * WHY VenueOS DRAWS ITS OWN: these panels are driven by a D-pad remote, and
 * whether the system keyboard opens, takes focus and can be typed on with
 * only arrows and OK differs per ROM (some signage builds ship none at all,
 * some a touch-only one). A password must be typeable on every class, so the
 * Network screen never depends on it. A hardware keyboard still types.
 *
 * Three layouts of printable ASCII (the only characters a WPA password may
 * hold): lower case, upper case, symbols. Every character row is the same
 * width so the D-pad moves in a straight grid ([KeyboardNav]).
 *
 * The phone conventions, because that is the keyboard people already know:
 *  • Shift is for ONE letter, then the keyboard drops back to lower case;
 *    Shift twice is caps lock; a third press turns it off ([ShiftState]).
 *  • There is a CURSOR: a typo in the middle of a 20-character password is
 *    fixed where it is, never by retyping the tail.
 *  • The step's own action (Connect / Next) is a key on the bottom row,
 *    so nobody has to leave the keyboard to finish.
 */
data class KeyboardModel(
    val text: String = "",
    val layout: Layout = Layout.LOWER,
    val maxLength: Int = 63,
    /** Caps lock: [Layout.UPPER] stays after a letter. Without it Shift lasts one letter. */
    val capsLock: Boolean = false,
    /** Where the next character goes, 0..[text].length (clamped on every read). */
    val cursor: Int = text.length,
) {
    enum class Layout { LOWER, UPPER, SYMBOLS }

    enum class ShiftState { OFF, ONCE, LOCKED }

    sealed class Key {
        data class Char(val c: kotlin.Char) : Key()
        object Shift : Key()
        object Symbols : Key()
        object Space : Key()
        object Delete : Key()
        object Clear : Key()

        /** The step's action — Connect (password) or Next (hidden network name). */
        object Done : Key()
    }

    val shift: ShiftState
        get() = when {
            layout != Layout.UPPER -> ShiftState.OFF
            capsLock -> ShiftState.LOCKED
            else -> ShiftState.ONCE
        }

    /** The cursor, never outside the text. */
    val caret: Int get() = cursor.coerceIn(0, text.length)

    fun rows(): List<List<Key>> {
        val chars = when (layout) {
            Layout.LOWER -> LOWER
            Layout.UPPER -> LOWER.map { it.uppercase() }
            Layout.SYMBOLS -> SYMBOLS
        }
        val grid: List<List<Key>> = chars.map { row -> row.map { Key.Char(it) } }
        return grid + listOf(listOf(Key.Shift, Key.Symbols, Key.Space, Key.Delete, Key.Done))
    }

    fun press(key: Key): KeyboardModel = when (key) {
        is Key.Char -> type(key.c)
        Key.Shift -> when (shift) {
            ShiftState.OFF -> copy(layout = Layout.UPPER, capsLock = false)
            ShiftState.ONCE -> copy(layout = Layout.UPPER, capsLock = true)
            ShiftState.LOCKED -> copy(layout = Layout.LOWER, capsLock = false)
        }
        Key.Symbols -> copy(layout = if (layout == Layout.SYMBOLS) Layout.LOWER else Layout.SYMBOLS, capsLock = false)
        Key.Space -> type(' ')
        Key.Delete -> deleteBack()
        Key.Clear -> copy(text = "", cursor = 0)
        Key.Done -> this
    }

    /**
     * Printable ASCII only, never past [maxLength], inserted at the cursor —
     * a hardware keyboard goes through here too. A one-letter Shift ends here.
     */
    fun type(c: kotlin.Char): KeyboardModel {
        if (c.code !in 0x20..0x7e || text.length >= maxLength) return this
        val at = caret
        val typed = copy(text = text.substring(0, at) + c + text.substring(at), cursor = at + 1)
        return if (layout == Layout.UPPER && !capsLock) typed.copy(layout = Layout.LOWER) else typed
    }

    /** The character BEFORE the cursor goes (the cursor sits at the end unless a person moved it). */
    fun deleteBack(): KeyboardModel {
        val at = caret
        if (at == 0) return copy(cursor = 0)
        return copy(text = text.removeRange(at - 1, at), cursor = at - 1)
    }

    fun moveCursor(delta: Int): KeyboardModel = copy(cursor = (caret + delta).coerceIn(0, text.length))

    fun cursorToEnd(): KeyboardModel = copy(cursor = text.length)

    companion object {
        private val LOWER = listOf("1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm_.@")
        private val SYMBOLS = listOf("!\"#$%&'()*", "+,/:;<=>?[", "\\]^`{|}~-_", "0123456789")
    }
}

/**
 * D-pad movement on [KeyboardModel.rows] — pure, so the grid has a test.
 *
 * Every row is laid on the same [GRID]-unit ruler: a character key is 2
 * units, the bottom row's keys are wider ([BOTTOM_SPANS] — Shift, symbols,
 * a wide Space, Delete, a wide Connect). Left/Right WRAP around the row's
 * edges; Up/Down land on the key under the column the person started from
 * (the anchor), so going down through the wide Space bar and back up returns
 * to the same letter.
 */
object KeyboardNav {

    const val GRID = 20
    val CHAR_SPANS: List<Int> = List(10) { 2 }
    val BOTTOM_SPANS: List<Int> = listOf(3, 3, 6, 3, 5)

    enum class Dir { LEFT, RIGHT, UP, DOWN }

    data class Pos(val row: Int, val col: Int)

    fun spans(row: Int, rowCount: Int): List<Int> = if (row == rowCount - 1) BOTTOM_SPANS else CHAR_SPANS

    /** The unit at the centre of [pos] (twice the real centre, so it stays an integer). */
    fun centreUnit2(pos: Pos, rowCount: Int): Int {
        val s = spans(pos.row, rowCount)
        val col = pos.col.coerceIn(0, s.size - 1)
        val start = s.take(col).sum()
        return start * 2 + s[col]
    }

    /** The key of [row] whose span holds [unit2] (a doubled unit). */
    fun colAt(row: Int, rowCount: Int, unit2: Int): Int {
        val s = spans(row, rowCount)
        var start = 0
        s.forEachIndexed { i, w ->
            if (unit2 < (start + w) * 2) return i
            start += w
        }
        return s.size - 1
    }

    /**
     * Where [dir] goes from [pos]. Null = out of the keyboard upward (the
     * field above it). [anchor2] is the doubled unit the vertical travel
     * started from, or null to use [pos]'s own centre.
     */
    fun move(pos: Pos, dir: Dir, rowCount: Int, anchor2: Int? = null): Pos? {
        val width = spans(pos.row, rowCount).size
        return when (dir) {
            Dir.LEFT -> Pos(pos.row, if (pos.col <= 0) width - 1 else pos.col - 1)
            Dir.RIGHT -> Pos(pos.row, if (pos.col >= width - 1) 0 else pos.col + 1)
            Dir.UP -> if (pos.row == 0) null else {
                val target = pos.row - 1
                Pos(target, colAt(target, rowCount, anchor2 ?: centreUnit2(pos, rowCount)))
            }
            Dir.DOWN -> if (pos.row >= rowCount - 1) pos else {
                val target = pos.row + 1
                Pos(target, colAt(target, rowCount, anchor2 ?: centreUnit2(pos, rowCount)))
            }
        }
    }

    /**
     * The row above the keyboard (the field and its buttons) on the same
     * ruler. [spans] e.g. 14/3/3 for field, Show, Clear. Up from the top key
     * row lands on the item over the anchor; Down from an item lands on the
     * top key row under it.
     */
    fun fieldItemAt(spans: List<Int>, unit2: Int): Int {
        var start = 0
        spans.forEachIndexed { i, w ->
            if (unit2 < (start + w) * 2) return i
            start += w
        }
        return spans.size - 1
    }

    fun fieldItemCentre2(spans: List<Int>, index: Int): Int {
        val i = index.coerceIn(0, spans.size - 1)
        return spans.take(i).sum() * 2 + spans[i]
    }
}

/** What the password field shows: masked, except — like a phone — the character just typed. */
object PasswordMask {
    const val BULLET = '•'

    /** How long the character just typed stays readable before it is masked. */
    const val REVEAL_MS = 1_000L

    fun render(text: String, show: Boolean, revealIndex: Int?): String =
        if (show) text else buildString(text.length) {
            text.forEachIndexed { i, c -> append(if (i == revealIndex) c else BULLET) }
        }
}

/**
 * The screen's size rules — pure. ONE design unit is 1/1080 of the panel's
 * short side, so a 1920×1080 and a 3840×2160 panel show the SAME layout at
 * the same physical size whatever density the ROM reports (a 4K box at
 * xhdpi made the dp-sized 1.1.53 screen tiny). A narrow LED column never
 * shrinks below [MIN_UNIT] px per unit, so its type stays legible; it gets
 * the single-column layout instead.
 */
object NetworkLayout {
    const val REFERENCE_SHORT_SIDE = 1080f
    const val MIN_UNIT = 0.42f

    /** Wide enough for the two-column home (status + Ethernet | Wi-Fi). */
    const val WIDE_MIN_DU = 1320f

    data class Metrics(val unit: Float, val widthDu: Float, val heightDu: Float) {
        val wide: Boolean get() = widthDu >= WIDE_MIN_DU
    }

    fun metrics(widthPx: Int, heightPx: Int): Metrics {
        val w = widthPx.coerceAtLeast(1)
        val h = heightPx.coerceAtLeast(1)
        val unit = maxOf(minOf(w, h) / REFERENCE_SHORT_SIDE, MIN_UNIT)
        return Metrics(unit, w / unit, h / unit)
    }
}

/**
 * When the Network screen may be on the glass, what it says about a
 * connection, and where the remote lands — pure (`NetworkScreenModelTest`,
 * `NetworkScreenFlowTest`).
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

    /** How often, while it is open, the screen asks VenueOS's server whether it answers. */
    const val PROBE_REFRESH_MS = 30_000L

    /** While joining, how often the stages re-read the connection. */
    const val STAGE_POLL_MS = 1_000L

    /**
     * After Android accepted a network (saved / suggested) the screen watches
     * this long for it to actually move onto it before saying so — "Not
     * connected yet", with Android's own Wi-Fi list as the next press
     * (2026-10-26; it used to say "Saved", which the owner read as done).
     * Android's own page connects within seconds; a suggestion is Android's
     * call, and this is as long as a person is asked to stand and watch.
     */
    const val WATCH_JOIN_MS = 25_000L

    /** A success returns to where the person came from after this long; OK returns at once. */
    const val SUCCESS_RETURN_MS = 3_000L

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

        /**
         * THE SCREEN'S OWN VERDICTS (2026-10-26) — never an engine code.
         * Android took the network but has not moved onto it: the screen says
         * so and hands over to Android's Wi-Fi list, where one press on the
         * saved network connects. "Saved" was never a success and is no
         * longer shown as one.
         */
        NOT_YET,

        /** On the network, with an address, and VenueOS's server has not answered over it. The screen stays on it. */
        NO_SERVER_YET,
    }

    /** Why Android has not moved onto the network — the first sentence of "Not connected yet". */
    enum class NotYetReason {
        /** The watch ran out. */
        TIMEOUT,

        /** Android's save page found it already saved, so it connected to nothing. */
        ALREADY_SAVED,

        /** The screen is on ANOTHER Wi-Fi network Android considers good enough; a suggestion never displaces that. */
        ON_OTHER_WIFI,
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

    /** Signal as a glyph — the text form of the four levels the icons draw (the screen's log line). */
    fun signal(bars: Int): String = "▂▄▆█".take(bars.coerceIn(0, 4)).padEnd(4, '·')

    // ── what the screen SAYS ───────────────────────────────────────────

    /** Signal in words (primary), never in dBm. */
    enum class Signal { NONE, WEAK, FAIR, GOOD, EXCELLENT }

    fun signalOf(bars: Int): Signal = when (bars.coerceIn(0, 4)) {
        0 -> Signal.NONE
        1 -> Signal.WEAK
        2 -> Signal.FAIR
        3 -> Signal.GOOD
        else -> Signal.EXCELLENT
    }

    /** Plain words first: "Secured" / "Open"; the protocol is small secondary text. */
    enum class Lock { OPEN, SECURED, UNSUPPORTED }

    fun lockOf(security: String): Lock = when {
        security == WifiScanPolicy.SEC_OPEN -> Lock.OPEN
        WifiScanPolicy.joinable(security) -> Lock.SECURED
        else -> Lock.UNSUPPORTED
    }

    /** The protocol for the small secondary label, or null (open). No SSID / PSK jargon anywhere. */
    fun protocolOf(security: String): String? = when (security) {
        WifiScanPolicy.SEC_WPA2 -> "WPA2"
        WifiScanPolicy.SEC_WPA3 -> "WPA3"
        WifiScanPolicy.SEC_WEP -> "WEP"
        WifiScanPolicy.SEC_ENTERPRISE -> "802.1X"
        WifiScanPolicy.SEC_OTHER -> "OWE"
        else -> null
    }

    /**
     * The health line. Only what the screen can prove (player rule 10):
     * "Connected to VenueOS" needs VenueOS's own server to have answered,
     * not just Android's internet check.
     */
    enum class Health { VENUEOS, NO_VENUEOS, CHECKING, OFFLINE }

    /** @param transport null = not read yet. @param venueos null = not asked yet / asking. */
    fun health(transport: String?, venueos: Boolean?): Health = when {
        transport == null -> Health.CHECKING
        transport == NetworkStatusPolicy.T_NONE -> Health.OFFLINE
        venueos == null -> Health.CHECKING
        venueos -> Health.VENUEOS
        else -> Health.NO_VENUEOS
    }

    /** The list a person reads: the connected network first, then saved ones, then by signal. */
    fun ordered(networks: List<WifiScanPolicy.Network>): List<WifiScanPolicy.Network> =
        networks.sortedWith(
            compareByDescending<WifiScanPolicy.Network> { it.connected }
                .thenByDescending { it.savedBy != null }
                .thenByDescending { it.rssi }
                .thenBy { it.ssid },
        )

    /**
     * A scan is a snapshot; the connection is re-read every few seconds. The
     * row the screen is on NOW is the connected one (a scan taken the moment
     * Wi-Fi came up still says "not connected"). Where Android hides the
     * name (Wi-Fi, no location), the scan's own word stands.
     */
    fun withLive(networks: List<WifiScanPolicy.Network>, transport: String?, connectedSsid: String?): List<WifiScanPolicy.Network> {
        if (transport == null) return networks
        if (transport == NetworkStatusPolicy.T_WIFI && connectedSsid == null) return networks
        val live = if (transport == NetworkStatusPolicy.T_WIFI) connectedSsid else null
        return networks.map { n ->
            val on = live != null && n.ssid == live
            if (on == n.connected) n else n.copy(connected = on)
        }
    }

    /** The most likely next pick: the strongest SECURED network not yet connected, else the strongest open one. */
    fun bestCandidate(networks: List<WifiScanPolicy.Network>): WifiScanPolicy.Network? {
        val joinable = networks.filter { !it.connected && WifiScanPolicy.joinable(it.security) }
        return joinable.filter { it.security != WifiScanPolicy.SEC_OPEN }.maxByOrNull { it.rssi }
            ?: joinable.maxByOrNull { it.rssi }
    }

    /** Where the remote lands on the home step — never an empty focus. */
    sealed class HomeFocus {
        data class Network(val ssid: String, val security: String) : HomeFocus()

        /** "Scan again" — also the parked control while the first scan runs. */
        object ScanAgain : HomeFocus()

        /** The one button that fixes why the list is empty (Allow / Turn on Location / …). */
        object AccessFix : HomeFocus()

        /** No Wi-Fi to offer at all: Android's own network settings. */
        object AndroidSettings : HomeFocus()
    }

    /** @param access null = the first scan has not answered yet. */
    fun homeFocus(access: WifiScanPolicy.Access?, networks: List<WifiScanPolicy.Network>): HomeFocus = when {
        access == null -> bestCandidate(networks)?.let { HomeFocus.Network(it.ssid, it.security) } ?: HomeFocus.ScanAgain
        access != WifiScanPolicy.Access.GRANTED ->
            if (accessFix(access) != null) HomeFocus.AccessFix else HomeFocus.AndroidSettings
        else -> bestCandidate(networks)?.let { HomeFocus.Network(it.ssid, it.security) } ?: HomeFocus.ScanAgain
    }

    /** Every next step the screen can offer, as the button that does it. */
    enum class Fix {
        /**
         * Location access is asked ONCE, at setup, with every other grant
         * (2026-10-26 — the owner: "make sure we have all permissions allowed
         * right at the install … and don't be asking for more"). The Network
         * screen never raises Android's permission dialog itself any more; a
         * missing or declined grant is a row on the setup checklist, and this
         * opens it.
         */
        OPEN_SETUP,
        LOCATION_ON,
        WIFI_ON,
        EDIT_PASSWORD,
        TRY_AGAIN,

        /** Ask VenueOS's server again over the network the screen is on (no reconnect). */
        CHECK_AGAIN,
        SCAN_AGAIN,
        CHOOSE_ANOTHER,
        ANDROID_SETTINGS,

        /** Android's own Wi-Fi list, where one press on the saved network connects NOW. */
        CONNECT_IN_ANDROID,
        DONE,
    }

    /** Why the list is empty → the one button that fixes it (null: nothing on this screen can). */
    fun accessFix(access: WifiScanPolicy.Access): Fix? = when (access) {
        WifiScanPolicy.Access.NEEDS_PERMISSION, WifiScanPolicy.Access.DENIED -> Fix.OPEN_SETUP
        WifiScanPolicy.Access.LOCATION_OFF -> Fix.LOCATION_ON
        WifiScanPolicy.Access.WIFI_OFF -> Fix.WIFI_ON
        WifiScanPolicy.Access.NO_WIFI, WifiScanPolicy.Access.EMERGENCY, WifiScanPolicy.Access.GRANTED -> null
    }

    /** Where a join stands, from what the screen can SEE. */
    enum class Stage { JOINING, ADDRESS, CHECKING, DONE }

    /**
     * @param onNetwork the screen is on the chosen network (null: Android
     *        will not say which — no location — so the engine's word decides).
     * @param hasAddress it has an IP address on it.
     * @param venueos VenueOS's server answered over it (null: not asked yet).
     */
    fun stage(onNetwork: Boolean?, hasAddress: Boolean, venueos: Boolean?): Stage = when {
        onNetwork != true -> Stage.JOINING
        !hasAddress -> Stage.ADDRESS
        venueos != true -> Stage.CHECKING
        else -> Stage.DONE
    }

    /** Is the screen on [ssid]? null = it is on Wi-Fi but Android hides the name. */
    fun onNetwork(transport: String?, connectedSsid: String?, ssid: String): Boolean? = when {
        transport != NetworkStatusPolicy.T_WIFI -> false
        connectedSsid == null -> null
        else -> connectedSsid == ssid
    }

    /** What the screen's own eyes add to the engine's word while a join is open. */
    enum class Promotion { NONE, SUCCESS, NOT_YET, NO_SERVER_YET }

    /** The engine's words after which the screen WATCHES — Android took the network; whether it moves is Android's call. */
    fun watched(words: Words?): Boolean =
        words == Words.SAVED || words == Words.SUGGESTED || words == Words.WAITING_APPROVAL

    /**
     * The engine says "saved" / "suggested" / "waiting for Android's
     * approval" and goes quiet; whether the screen MOVES is Android's call.
     * So the screen watches: on the network, an address, VenueOS answered →
     * success (what the evidence proves — player rule 10). Never under a
     * system dialog (Android's approval or save prompt still on top of the
     * screen), never for a switch the engine is still proving
     * ([Words.JOINING] ends with the engine's own word).
     *
     * When the watch runs out the screen says what it SEES (2026-10-26): on
     * the network with an address but no answer from VenueOS → "on it, but
     * VenueOS can't be reached"; anything else → "not connected yet", with
     * Android's own Wi-Fi list as the next press. Nothing waits forever any
     * more — an approval Android never asks for on a signage ROM used to.
     */
    fun promote(words: Words?, stage: Stage, systemDialogUp: Boolean, watchExpired: Boolean): Promotion = when {
        !watched(words) -> Promotion.NONE
        stage == Stage.DONE && !systemDialogUp -> Promotion.SUCCESS
        !watchExpired -> Promotion.NONE
        stage == Stage.CHECKING -> Promotion.NO_SERVER_YET
        else -> Promotion.NOT_YET
    }

    /**
     * Must the screen hand over to Android's Wi-Fi list RIGHT NOW, without
     * watching? Two cases where waiting is a lie (2026-10-26):
     *
     *  • [alreadySaved] — Android's save page found the network already saved
     *    and connected to nothing (it calls `connect()` only for a network it
     *    saved just now).
     *  • a SUGGESTION while the screen is on another named Wi-Fi network —
     *    Android keeps a network it considers sufficient; a suggestion never
     *    displaces it. Not for the dialog route ([viaDialog]): there Android
     *    itself is switching, and being on the old network for a second is
     *    normal.
     *
     * Null when the screen should watch (or is already on the network).
     */
    fun handoffNow(
        words: Words?,
        viaDialog: Boolean,
        alreadySaved: Boolean,
        onNetwork: Boolean?,
        transport: String?,
    ): NotYetReason? = when {
        !watched(words) -> null
        onNetwork == true -> null
        alreadySaved -> NotYetReason.ALREADY_SAVED
        !viaDialog && transport == NetworkStatusPolicy.T_WIFI && onNetwork == false -> NotYetReason.ON_OTHER_WIFI
        else -> null
    }

    /**
     * Ask Android for one scan right after a SUGGESTION (never after the
     * dialog — Settings is already connecting), so network selection runs now
     * instead of on Android's own backed-off schedule.
     */
    fun shouldNudgeScan(words: Words?, viaDialog: Boolean): Boolean = watched(words) && !viaDialog

    /** What a result does to the screen. */
    enum class Outcome {
        /** The big check — VenueOS answered over the new network. */
        SUCCESS,

        /** Android took the network but has not moved onto it (yet): watch, then say which. */
        SAVED,

        /** Still in progress (Android's dialog, Android's approval, the switch being proved). */
        WAITING,

        /** Straight back to the password, everything typed kept. */
        PASSWORD,

        FAILURE,
    }

    fun outcome(words: Words): Outcome = when (words) {
        Words.CONNECTED -> Outcome.SUCCESS
        Words.SAVED, Words.SUGGESTED -> Outcome.SAVED
        Words.WAITING_APPROVAL, Words.WAITING_DIALOG, Words.JOINING -> Outcome.WAITING
        Words.WRONG_PASSWORD -> Outcome.PASSWORD
        else -> Outcome.FAILURE
    }

    /** The next step for a result: the focused button, and at most one more. */
    data class Plan(val primary: Fix, val secondary: Fix?)

    fun plan(words: Words, secured: Boolean): Plan = when (words) {
        Words.CONNECTED -> Plan(Fix.DONE, null)
        // Watched words reach a result only through promote(): as NOT_YET / NO_SERVER_YET.
        Words.SAVED, Words.SUGGESTED -> Plan(Fix.CONNECT_IN_ANDROID, Fix.CHOOSE_ANOTHER)
        // Still in progress: the screen's own "Stop waiting" is the first button; the second
        // is Android's own Wi-Fi list, where one press on the network connects.
        Words.WAITING_APPROVAL -> Plan(Fix.CHOOSE_ANOTHER, Fix.CONNECT_IN_ANDROID)
        Words.WAITING_DIALOG, Words.JOINING -> Plan(Fix.CHOOSE_ANOTHER, null)
        // An open network has no password to fix: a rejection there is a plain retry.
        Words.WRONG_PASSWORD -> if (secured) Plan(Fix.EDIT_PASSWORD, null) else Plan(Fix.TRY_AGAIN, Fix.CHOOSE_ANOTHER)
        Words.COULD_NOT_JOIN -> if (secured) Plan(Fix.EDIT_PASSWORD, Fix.SCAN_AGAIN) else Plan(Fix.TRY_AGAIN, Fix.SCAN_AGAIN)
        Words.NO_SERVER -> Plan(Fix.SCAN_AGAIN, Fix.TRY_AGAIN)
        Words.DECLINED -> Plan(Fix.TRY_AGAIN, Fix.CHOOSE_ANOTHER)
        Words.WIFI_OFF -> Plan(Fix.WIFI_ON, Fix.CHOOSE_ANOTHER)
        Words.NAME_TAKEN, Words.NOT_SUPPORTED -> Plan(Fix.ANDROID_SETTINGS, Fix.CHOOSE_ANOTHER)
        Words.ALERT -> Plan(Fix.DONE, null)
        Words.FAILED -> Plan(Fix.TRY_AGAIN, Fix.CHOOSE_ANOTHER)
        // Not connected yet: Android's Wi-Fi list is the press that connects; a wrong
        // password is the other likely cause on a secured network.
        Words.NOT_YET -> if (secured) Plan(Fix.CONNECT_IN_ANDROID, Fix.EDIT_PASSWORD) else Plan(Fix.CONNECT_IN_ANDROID, Fix.TRY_AGAIN)
        // On it, no VenueOS: ask the server again (the hotspot may just have come up) — never a
        // reconnect, the screen IS on the network — or pick another.
        Words.NO_SERVER_YET -> Plan(Fix.CHECK_AGAIN, Fix.CHOOSE_ANOTHER)
    }
}

/**
 * Picking up where a person was when an ALERT took the screen away
 * (2026-10-24): the network and the step, for a few minutes — NEVER the
 * password (there is no field for one; `NetworkScreenFlowTest` checks).
 * Kept in memory only, so it dies with the process.
 */
object NetworkResume {

    const val WINDOW_MS = 5 * 60_000L

    enum class Step { PASSWORD, HIDDEN_NAME, HIDDEN_SECURITY }

    data class Snapshot(
        val step: Step,
        /** The network's name (for HIDDEN_NAME, what was typed of it — a name, not a secret). */
        val ssid: String,
        val security: String,
        val hidden: Boolean,
        val savedAtElapsedMs: Long,
    )

    /** The snapshot if it is still fresh, else null. A clock that went backwards is not fresh. */
    fun restore(snapshot: Snapshot?, nowElapsedMs: Long): Snapshot? = snapshot?.takeIf {
        nowElapsedMs >= it.savedAtElapsedMs && nowElapsedMs - it.savedAtElapsedMs <= WINDOW_MS
    }
}
