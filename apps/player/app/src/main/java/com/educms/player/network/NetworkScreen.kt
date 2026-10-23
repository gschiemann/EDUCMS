package com.educms.player.network

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.educms.player.R
import com.educms.player.display.DisplayEmergency
import com.educms.player.led.LedCanvasHost
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.LockTaskController
import com.educms.player.settings.DeviceSettingsWire
import com.educms.player.settings.NetworkStatus
import com.educms.player.settings.NetworkStatusPolicy
import com.educms.player.settings.WifiConnect
import com.educms.player.settings.WifiScan
import com.educms.player.settings.WifiScanPolicy
import com.educms.player.setup.PageDecision
import com.educms.player.setup.SettingsPagePolicy
import com.educms.player.setup.SetupFactsReader
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * VenueOS's ON-SCREEN NETWORK SCREEN (2026-10-23) — the one settings screen
 * the owner asked for first: "Wi-Fi and Ethernet being number 1".
 *
 *  • Wi-Fi: the nearby networks ([WifiScan]) with signal, a lock for a
 *    password, "connected" / "saved"; choose one with the D-pad, type the
 *    password on VenueOS's own keyboard ([KeyboardModel]), Connect. The
 *    result is said in plain words. It runs [WifiConnect] — the SAME engine
 *    and never-strand rule as a dashboard push. Plus "Add a hidden network".
 *  • Ethernet: read-only ([NetworkStatus]): cable, address, automatic or
 *    fixed. A fixed address is not something a normal app may set, so the
 *    one way there is "Advanced: Android network settings" (MainActivity's
 *    existing fallback chain).
 *
 * REMOTE-ONLY (player rule 15): focus is always PARKED on a real control with
 * the Activity's visible highlight; Back goes back one step (password →
 * list → closed, the previous surface's control focused again) and never
 * traps; the password needs nothing but arrows and OK.
 *
 * ⚠️ AN ALERT OUTRANKS IT: it does not open during an emergency hold, and it
 * leaves the glass the instant one starts (a change listener on the hold, and
 * a [NetworkScreenPolicy.EMERGENCY_POLL_MS] poll behind it) — the alert
 * renders in the page underneath and nothing of ours may cover it.
 *
 * Entry points: the boot diagnostic's "Network settings" button and the
 * player's Back-menu "Network" entry (the `openNetworkScreen` bridge method).
 */
object NetworkScreen {

    private const val TAG = "NetworkScreen"

    private var screen: NetworkScreenView? = null
    private var restoreFocus: WeakReference<View>? = null

    fun isShowing(): Boolean = screen != null

    /**
     * Put the screen up. Main thread. False when it may not open (an alert,
     * a pinned task) — the caller keeps whatever it had on the glass.
     */
    fun open(activity: Activity, decorate: (View) -> Unit, onAndroidSettings: () -> Unit, source: String): Boolean {
        if (screen != null) return true
        val app = activity.applicationContext
        val held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
        val pinned = runCatching { LockTaskController.isActive(activity) }.getOrDefault(false)
        if (!NetworkScreenPolicy.mayOpen(held, pinned)) {
            PlayerLogger.i(TAG, "not opened ($source) — ${if (held) "an alert is held" else "lock task is active"}")
            return false
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
        restoreFocus = activity.currentFocus?.let { WeakReference(it) }
        val view = NetworkScreenView(activity, decorate, onAndroidSettings) { reason -> close(reason) }
        root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.bringToFront()
        screen = view
        view.start()
        PlayerLogger.i(TAG, "opened ($source)")
        return true
    }

    /** Back reached the Activity while the screen is up: one step back. True = handled. */
    fun back(): Boolean {
        val view = screen ?: return false
        view.back()
        return true
    }

    /** Take it down and give the remote back to the surface it came from. */
    fun close(reason: String) {
        val view = screen ?: return
        screen = null
        view.stop()
        runCatching { (view.parent as? ViewGroup)?.removeView(view) }
        PlayerLogger.i(TAG, "closed ($reason)")
        restoreFocus?.get()?.let { previous -> if (previous.isAttachedToWindow) previous.requestFocus() }
        restoreFocus = null
    }
}

/** The screen's views. One instance per open; nothing outlives [stop]. */
internal class NetworkScreenView(
    private val activity: Activity,
    private val decorate: (View) -> Unit,
    private val onAndroidSettings: () -> Unit,
    private val onClose: (String) -> Unit,
) : FrameLayout(activity) {

    private enum class Step { LIST, PASSWORD, HIDDEN_NAME, HIDDEN_SECURITY }

    private companion object {
        const val SCRIM = 0xF20F172A.toInt()
        const val CARD = 0xFF0F172A.toInt()
        const val ROW = 0xFF1E293B.toInt()
        const val TEXT = 0xFFFFFFFF.toInt()
        const val SUBTLE = 0xFF94A3B8.toInt()
        const val ACCENT = 0xFF4F46E5.toInt()
        const val GOOD = 0xFF34D399.toInt()
        const val WARN = 0xFFFBBF24.toInt()
        const val PLAYER_PREFS = "edu_player"
    }

    private val app: Context = activity.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "venueos-network-screen").apply { isDaemon = true } }
    private val column = LinearLayout(activity)
    private val scroller = ScrollView(activity)

    private var step = Step.LIST
    private var stopped = false
    private var status: DeviceSettingsWire.NetStatus? = null
    private var scan: WifiScan.Result? = null
    private var scanning = false
    private var chosenSsid = ""
    private var chosenSecurity = WifiScanPolicy.SEC_WPA2
    private var chosenHidden = false
    private var keyboard = KeyboardModel()
    private var showPassword = false
    private var result: String? = null
    private var resultColor = SUBTLE
    private var pendingId: String? = null

    private val prefs: SharedPreferences = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
    private val holdListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == null || key.startsWith("display_emergency_hold")) checkHold()
    }
    private val holdPoll = object : Runnable {
        override fun run() {
            if (stopped || checkHold()) return
            main.postDelayed(this, NetworkScreenPolicy.EMERGENCY_POLL_MS)
        }
    }
    private val statusTick = object : Runnable {
        override fun run() {
            if (stopped) return
            refreshStatus()
            main.postDelayed(this, NetworkScreenPolicy.STATUS_REFRESH_MS)
        }
    }

    init {
        setBackgroundColor(SCRIM)
        isClickable = true
        column.orientation = LinearLayout.VERTICAL
        column.background = pill(CARD, dp(14))
        column.setPadding(dp(20), dp(20), dp(20), dp(20))
        val wrapper = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(12), dp(12), dp(12), dp(12))
            addView(column, LinearLayout.LayoutParams(cardWidth(), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        scroller.isFillViewport = true
        scroller.addView(wrapper, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(scroller, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    // ── lifecycle ──────────────────────────────────────────────────────

    fun start() {
        prefs.registerOnSharedPreferenceChangeListener(holdListener)
        main.postDelayed(holdPoll, NetworkScreenPolicy.EMERGENCY_POLL_MS)
        main.post(statusTick)
        render()
        startScan()
    }

    fun stop() {
        stopped = true
        runCatching { prefs.unregisterOnSharedPreferenceChangeListener(holdListener) }
        main.removeCallbacksAndMessages(null)
        keyboard = KeyboardModel() // the password goes with the screen
        io.shutdown()
    }

    /** ⚠️ The alert wins: true = it is held and the screen is closing. */
    private fun checkHold(): Boolean {
        if (stopped) return true
        val held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
        if (NetworkScreenPolicy.mustClose(held)) {
            onClose("an emergency hold started")
            return true
        }
        return false
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        // Back from Android's permission, location or save dialog: look again.
        if (hasWindowFocus && !stopped && step == Step.LIST) {
            refreshStatus()
            if (scan?.access != WifiScanPolicy.Access.GRANTED) startScan()
        }
    }

    private fun background(work: () -> Unit) {
        if (stopped) return
        runCatching { io.execute(work) }
    }

    private fun refreshStatus() {
        background {
            val now = runCatching { NetworkStatus.read(app) }.getOrNull()
            main.post {
                if (stopped) return@post
                val changed = now != status
                status = now
                if (changed && step == Step.LIST) render()
            }
        }
    }

    private fun startScan() {
        if (scanning) return
        scanning = true
        if (step == Step.LIST) render()
        WifiScan.scan(activity, app) scanned@{ r ->
            scanning = false
            if (stopped) return@scanned
            scan = r
            if (step == Step.LIST) render()
        }
    }

    // ── rendering ──────────────────────────────────────────────────────

    private fun render() {
        if (stopped) return
        column.removeAllViews()
        when (step) {
            Step.LIST -> renderList()
            Step.PASSWORD -> renderPassword()
            Step.HIDDEN_NAME -> renderHiddenName()
            Step.HIDDEN_SECURITY -> renderHiddenSecurity()
        }
        LedCanvasHost.fitNarrow(this)
        parkFocus()
    }

    private var firstFocus: View? = null

    private fun renderList() {
        firstFocus = null
        column.addView(label(s(R.string.net_title), 30f, TEXT, bold = true), lp(bottom = dp(4)))
        column.addView(label(s(R.string.net_hint), 14f, SUBTLE), lp(bottom = dp(14)))
        statusLines().forEach { (text, color) -> column.addView(label(text, 17f, color), lp(bottom = dp(4))) }
        result?.let { column.addView(label(it, 17f, resultColor, bold = true), lp(top = dp(8), bottom = dp(4))) }

        column.addView(label(s(R.string.net_wifi_section), 22f, TEXT, bold = true), lp(top = dp(16), bottom = dp(8)))
        val r = scan
        when {
            r == null || (scanning && r.networks.isEmpty()) ->
                column.addView(label(s(R.string.net_scanning), 16f, SUBTLE), lp(bottom = dp(8)))
            r.access != WifiScanPolicy.Access.GRANTED -> renderAccess(r.access)
            r.networks.isEmpty() -> column.addView(label(s(R.string.net_none_found), 16f, SUBTLE), lp(bottom = dp(8)))
            else -> r.networks.forEach { n -> column.addView(networkRow(n), lp(bottom = dp(6))) }
        }
        if (r?.access == WifiScanPolicy.Access.GRANTED) {
            column.addView(action(s(R.string.net_scan_again)) { startScan() }, lp(top = dp(4), bottom = dp(4)))
        }
        column.addView(action(s(R.string.net_add_hidden)) { beginHidden() }, lp(bottom = dp(8)))

        column.addView(label(s(R.string.net_ethernet_section), 22f, TEXT, bold = true), lp(top = dp(12), bottom = dp(8)))
        ethernetLines().forEach { column.addView(label(it, 16f, SUBTLE), lp(bottom = dp(4))) }
        column.addView(action(s(R.string.net_android_settings)) { onAndroidSettings() }, lp(top = dp(6), bottom = dp(8)))

        column.addView(action(s(R.string.net_close)) { onClose("closed by a person") }, lp(top = dp(10)))
    }

    private fun statusLines(): List<Pair<String, Int>> {
        val st = status ?: return emptyList()
        val lines = mutableListOf<Pair<String, Int>>()
        val head = when (st.transport) {
            NetworkStatusPolicy.T_WIFI -> {
                val signal = NetworkScreenPolicy.signal(st.bars ?: 0)
                st.ssid?.let { s(R.string.net_status_wifi, it, signal) } ?: s(R.string.net_status_wifi_unnamed, signal)
            }
            NetworkStatusPolicy.T_ETHERNET -> s(R.string.net_status_ethernet)
            NetworkStatusPolicy.T_OTHER -> s(R.string.net_status_other)
            else -> s(R.string.net_status_offline)
        }
        lines += head to (if (st.transport == NetworkStatusPolicy.T_NONE) WARN else GOOD)
        if (st.transport != NetworkStatusPolicy.T_NONE && st.validated == false) lines += s(R.string.net_status_unvalidated) to WARN
        st.ip?.let { lines += s(R.string.net_status_address, it) to SUBTLE }
        return lines
    }

    private fun ethernetLines(): List<String> {
        val st = status ?: return emptyList()
        val out = mutableListOf(s(if (st.ethernetLink == true) R.string.net_ethernet_cable_yes else R.string.net_ethernet_cable_no))
        if (st.transport == NetworkStatusPolicy.T_ETHERNET) {
            st.ip?.let { out += s(R.string.net_ethernet_address, it) }
            out += s(
                when (st.auto) {
                    true -> R.string.net_ethernet_auto
                    false -> R.string.net_ethernet_fixed
                    null -> R.string.net_ethernet_mode_unknown
                },
            )
        }
        out += s(R.string.net_ethernet_fixed_note)
        return out
    }

    private fun renderAccess(access: WifiScanPolicy.Access) {
        val (message, button) = when (access) {
            WifiScanPolicy.Access.NEEDS_PERMISSION -> s(R.string.net_access_permission) to
                (s(R.string.net_allow) to { WifiScan.requestPermission(activity, "network screen"); Unit })
            WifiScanPolicy.Access.DENIED -> s(R.string.net_access_denied) to
                (s(R.string.net_app_settings) to {
                    openSystemPage(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.packageName}")))
                })
            WifiScanPolicy.Access.LOCATION_OFF -> s(R.string.net_access_location_off) to
                (s(R.string.net_location_settings) to { openSystemPage(WifiScan.locationSettingsIntent()) })
            WifiScanPolicy.Access.WIFI_OFF -> s(R.string.net_access_wifi_off) to null
            WifiScanPolicy.Access.NO_WIFI -> s(R.string.net_access_no_wifi) to null
            WifiScanPolicy.Access.EMERGENCY -> s(R.string.net_access_alert) to null
            WifiScanPolicy.Access.GRANTED -> return
        }
        column.addView(label(message, 16f, WARN), lp(bottom = dp(6)))
        button?.let { (text, act) -> column.addView(action(text) { act() }, lp(bottom = dp(6))) }
    }

    private fun networkRow(n: WifiScanPolicy.Network): View {
        val parts = mutableListOf(NetworkScreenPolicy.signal(n.bars), n.ssid)
        if (n.security != WifiScanPolicy.SEC_OPEN) parts += "🔒"
        when {
            n.connected -> parts += "· ${s(R.string.net_mark_connected)}"
            n.savedBy != null -> parts += "· ${s(R.string.net_mark_saved)}"
        }
        if (!WifiScanPolicy.joinable(n.security)) parts += "· ${s(R.string.net_mark_cannot_join)}"
        val row = action(parts.joinToString("  "), left = true) {
            if (!WifiScanPolicy.joinable(n.security)) {
                showResult(s(R.string.net_result_not_supported, n.ssid), WARN)
            } else {
                choose(n.ssid, n.security, hidden = false)
            }
        }
        if (firstFocus == null) firstFocus = row
        return shell(row, ROW)
    }

    // ── choosing a network ─────────────────────────────────────────────

    private fun choose(ssid: String, security: String, hidden: Boolean) {
        chosenSsid = ssid
        chosenSecurity = security
        chosenHidden = hidden
        keyboard = KeyboardModel()
        showPassword = false
        if (NetworkScreenPolicy.needsPassword(security)) {
            step = Step.PASSWORD
            render()
        } else {
            connect()
        }
    }

    private fun beginHidden() {
        chosenHidden = true
        keyboard = KeyboardModel(maxLength = 32)
        step = Step.HIDDEN_NAME
        render()
    }

    private var fieldView: TextView? = null
    private var messageView: TextView? = null

    private fun renderPassword() {
        firstFocus = null
        column.addView(label(s(R.string.net_password_for, chosenSsid), 24f, TEXT, bold = true), lp(bottom = dp(4)))
        column.addView(label(s(R.string.net_password_hint), 14f, SUBTLE), lp(bottom = dp(10)))
        fieldView = field(maskedText())
        column.addView(fieldView, lp(bottom = dp(8)))
        messageView = label("", 15f, WARN)
        column.addView(messageView, lp(bottom = dp(6)))
        column.addView(keyboardView(), lp(bottom = dp(10)))
        val toggle = action(s(if (showPassword) R.string.net_hide_password else R.string.net_show_password)) { }
        toggle.setOnClickListener {
            showPassword = !showPassword
            (it as Button).text = s(if (showPassword) R.string.net_hide_password else R.string.net_show_password)
            fieldView?.text = maskedText()
        }
        column.addView(toggle, lp(bottom = dp(6)))
        val go = action(s(R.string.net_connect)) {
            if (!NetworkScreenPolicy.passwordOk(keyboard.text)) {
                messageView?.text = s(R.string.net_password_short)
            } else {
                connect()
            }
        }
        column.addView(shell(go, ACCENT), lp(bottom = dp(6)))
        column.addView(action(s(R.string.net_cancel)) { back() }, lp())
    }

    private fun renderHiddenName() {
        firstFocus = null
        column.addView(label(s(R.string.net_hidden_name), 24f, TEXT, bold = true), lp(bottom = dp(10)))
        fieldView = field(keyboard.text)
        column.addView(fieldView, lp(bottom = dp(8)))
        messageView = label("", 15f, WARN)
        column.addView(messageView, lp(bottom = dp(6)))
        column.addView(keyboardView(), lp(bottom = dp(10)))
        val next = action(s(R.string.net_next)) next@{
            val name = keyboard.text.trim()
            if (name.isEmpty() || !com.educms.player.settings.DeviceSettingDomains.validSsid(name)) return@next
            chosenSsid = name
            step = Step.HIDDEN_SECURITY
            render()
        }
        column.addView(shell(next, ACCENT), lp(bottom = dp(6)))
        column.addView(action(s(R.string.net_cancel)) { back() }, lp())
    }

    private fun renderHiddenSecurity() {
        firstFocus = null
        column.addView(label(s(R.string.net_choose_security, chosenSsid), 24f, TEXT, bold = true), lp(bottom = dp(10)))
        listOf(
            WifiScanPolicy.SEC_WPA2 to R.string.net_security_wpa2,
            WifiScanPolicy.SEC_WPA3 to R.string.net_security_wpa3,
            WifiScanPolicy.SEC_OPEN to R.string.net_security_open,
        ).forEach { (security, text) ->
            val b = action(s(text)) { choose(chosenSsid, security, hidden = true) }
            if (firstFocus == null) firstFocus = b
            column.addView(b, lp(bottom = dp(6)))
        }
        column.addView(action(s(R.string.net_cancel)) { back() }, lp(top = dp(6)))
    }

    private fun maskedText(): String = if (showPassword) keyboard.text else "•".repeat(keyboard.text.length)

    /** VenueOS's own keyboard: same-width rows, so the D-pad moves in a straight grid. */
    private fun keyboardView(): View {
        val grid = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val keys = mutableListOf<Button>()
        fun relabel() {
            val rows = keyboard.rows()
            var i = 0
            rows.forEach { row -> row.forEach { key -> keys.getOrNull(i++)?.text = keyLabel(key) } }
        }
        keyboard.rows().forEachIndexed { r, row ->
            val line = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            row.forEachIndexed { c, initial ->
                val b = Button(activity).apply {
                    setAllCaps(false)
                    text = keyLabel(initial)
                    textSize = 20f
                    setTextColor(TEXT)
                    background = null
                    minWidth = 0
                    minimumWidth = 0
                    setPadding(dp(6), dp(8), dp(6), dp(8))
                }
                decorate(b)
                val current = { keyboard.rows()[r][c] }
                b.setOnClickListener {
                    val before = keyboard.layout
                    keyboard = keyboard.press(current())
                    if (keyboard.layout != before) relabel()
                    fieldView?.text = if (step == Step.PASSWORD) maskedText() else keyboard.text
                    messageView?.text = ""
                }
                wire(b, typing = true)
                keys += b
                if (r == 1 && c == 0 && firstFocus == null) firstFocus = b
                line.addView(b, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
            grid.addView(line, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        return grid
    }

    private fun keyLabel(key: KeyboardModel.Key): String = when (key) {
        is KeyboardModel.Key.Char -> key.c.toString()
        KeyboardModel.Key.Shift -> s(R.string.net_key_shift)
        KeyboardModel.Key.Symbols -> if (keyboard.layout == KeyboardModel.Layout.SYMBOLS) "abc" else s(R.string.net_key_symbols)
        KeyboardModel.Key.Space -> s(R.string.net_key_space)
        KeyboardModel.Key.Delete -> s(R.string.net_key_delete)
        KeyboardModel.Key.Clear -> s(R.string.net_key_clear)
    }

    // ── connecting: the ONE engine ─────────────────────────────────────

    private fun connect() {
        val ssid = chosenSsid
        val previous = previousLabel()
        val password = keyboard.text.takeIf { NetworkScreenPolicy.needsPassword(chosenSecurity) }
        keyboard = KeyboardModel() // the screen holds the password no longer than this
        step = Step.LIST
        showResult(s(R.string.net_result_joining, ssid), SUBTLE)
        pendingId = WifiConnect.connect(
            activity,
            WifiConnect.Request(ssid = ssid, security = chosenSecurity, hidden = chosenHidden, passphrase = password),
            WifiConnect.Listener { r -> onConnectResult(r, ssid, previous) },
        )
    }

    private fun onConnectResult(r: WifiConnect.Result, ssid: String, previous: String) {
        if (stopped || r.id != pendingId) return
        val (text, color) = words(r, ssid, previous)
        showResult(text, color)
        if (r.settled) {
            refreshStatus()
            main.postDelayed({ if (!stopped) startScan() }, 2_000L)
        }
    }

    private fun words(r: WifiConnect.Result, ssid: String, previous: String): Pair<String, Int> =
        when (NetworkScreenPolicy.words(r.status, r.code)) {
            NetworkScreenPolicy.Words.CONNECTED -> s(R.string.net_result_connected, ssid) to GOOD
            NetworkScreenPolicy.Words.SAVED -> s(R.string.net_result_saved, ssid) to GOOD
            NetworkScreenPolicy.Words.SUGGESTED -> s(R.string.net_result_suggested, ssid) to GOOD
            NetworkScreenPolicy.Words.WAITING_APPROVAL -> s(R.string.net_result_waiting_approval) to WARN
            NetworkScreenPolicy.Words.WAITING_DIALOG -> s(R.string.net_result_waiting_dialog) to WARN
            NetworkScreenPolicy.Words.JOINING -> s(R.string.net_result_joining, ssid) to SUBTLE
            NetworkScreenPolicy.Words.WRONG_PASSWORD -> s(R.string.net_result_wrong_password, ssid) to WARN
            NetworkScreenPolicy.Words.COULD_NOT_JOIN -> s(R.string.net_result_could_not_join, ssid, previous) to WARN
            NetworkScreenPolicy.Words.NO_SERVER -> s(R.string.net_result_no_server, ssid, previous) to WARN
            NetworkScreenPolicy.Words.DECLINED -> s(R.string.net_result_declined) to WARN
            NetworkScreenPolicy.Words.ALERT -> s(R.string.net_result_alert) to WARN
            NetworkScreenPolicy.Words.WIFI_OFF -> s(R.string.net_result_wifi_off) to WARN
            NetworkScreenPolicy.Words.NAME_TAKEN -> s(R.string.net_result_name_taken, ssid) to WARN
            NetworkScreenPolicy.Words.NOT_SUPPORTED -> s(R.string.net_result_not_supported, ssid) to WARN
            NetworkScreenPolicy.Words.FAILED -> s(R.string.net_result_failed, ssid) to WARN
        }

    /** What the screen is on BEFORE the change — the network a failed join leaves it on. */
    private fun previousLabel(): String {
        val st = status
        return when {
            st?.transport == NetworkStatusPolicy.T_WIFI && st.ssid != null -> "“${st.ssid}”"
            st?.transport == NetworkStatusPolicy.T_ETHERNET -> s(R.string.net_previous_ethernet)
            else -> s(R.string.net_previous_network)
        }
    }

    private fun showResult(text: String, color: Int) {
        result = text
        resultColor = color
        if (step == Step.LIST) render()
    }

    // ── keys ───────────────────────────────────────────────────────────

    /** Back goes back ONE step, never traps; typing reaches the field from a hardware keyboard. */
    private fun wire(v: View, typing: Boolean = false) {
        v.setOnKeyListener { _, keyCode, event ->
            val isBack = keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE
            if (isBack) {
                if (event.action == KeyEvent.ACTION_UP) back()
                return@setOnKeyListener true
            }
            if (typing && event.action == KeyEvent.ACTION_DOWN && (step == Step.PASSWORD || step == Step.HIDDEN_NAME)) {
                if (keyCode == KeyEvent.KEYCODE_DEL) {
                    keyboard = keyboard.press(KeyboardModel.Key.Delete)
                    fieldView?.text = if (step == Step.PASSWORD) maskedText() else keyboard.text
                    return@setOnKeyListener true
                }
                val ch = event.unicodeChar
                if (ch in 0x20..0x7e && keyCode !in DPAD_KEYS) {
                    keyboard = keyboard.type(ch.toChar())
                    fieldView?.text = if (step == Step.PASSWORD) maskedText() else keyboard.text
                    return@setOnKeyListener true
                }
            }
            false
        }
    }

    fun back() {
        when (step) {
            Step.LIST -> onClose("back")
            Step.PASSWORD, Step.HIDDEN_NAME -> {
                keyboard = KeyboardModel()
                step = Step.LIST
                render()
            }
            Step.HIDDEN_SECURITY -> {
                keyboard = KeyboardModel(text = chosenSsid, maxLength = 32)
                step = Step.HIDDEN_NAME
                render()
            }
        }
    }

    private val DPAD_KEYS = setOf(
        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
    )

    /** Park the remote on a real control — never on this root (the SetupChecklistView bug). */
    private fun parkFocus() {
        main.post {
            if (stopped) return@post
            if (firstFocus?.requestFocus() == true) return@post
            firstButton(column)?.requestFocus()
        }
    }

    private fun firstButton(group: ViewGroup): Button? {
        for (i in 0 until group.childCount) {
            when (val child = group.getChildAt(i)) {
                is Button -> if (child.isFocusable) return child
                is ViewGroup -> firstButton(child)?.let { return it }
            }
        }
        return null
    }

    // ── small builders ─────────────────────────────────────────────────

    private fun s(id: Int, vararg args: Any): String = runCatching { activity.getString(id, *args) }.getOrDefault("")

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun pill(color: Int, radius: Int = dp(10)) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    private fun cardWidth(): Int {
        // The LED canvas, never the frame buffer (BootDiagnosticsView: a poster shows the leftmost 320 px).
        val screen = LedCanvasHost.viewportWidthPx(context)
        return minOf(screen - dp(24), dp(760)).coerceAtLeast(dp(160))
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean = false) = TextView(activity).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun field(text: String) = TextView(activity).apply {
        this.text = text
        textSize = 24f
        setTextColor(TEXT)
        background = pill(ROW)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.START
    }

    private fun action(text: String, left: Boolean = false, onPress: () -> Unit): Button =
        Button(activity).apply {
            setAllCaps(false)
            this.text = text
            textSize = 18f
            setTextColor(TEXT)
            gravity = if (left) Gravity.START or Gravity.CENTER_VERTICAL else Gravity.CENTER
            // `decorate` clears a view's background when focus leaves, so a
            // filled control's fill rides a [shell], as on the boot card.
            background = null
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setOnClickListener { onPress() }
        }.also { b ->
            decorate(b)
            wire(b)
            if (firstFocus == null && step != Step.LIST) firstFocus = b
        }

    /** A fill behind a transparent, highlighted control. */
    private fun shell(control: View, color: Int): View = FrameLayout(activity).apply {
        background = pill(color)
        addView(control, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    private fun lp(top: Int = 0, bottom: Int = 0) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply {
        topMargin = top
        bottomMargin = bottom
    }

    /** Android's own page for [intent] — a system Settings app, never a browser (SettingsPagePolicy). */
    private fun openSystemPage(intent: Intent) {
        background {
            val browsers = SetupFactsReader.browserPackages(app)
            val decision = runCatching {
                SettingsPagePolicy.decide(
                    SetupFactsReader.resolve(app, intent, browsers),
                    setOf(app.packageName, "com.educms.manager", "com.educms.manager.debug"),
                )
            }.getOrNull()
            main.post {
                if (stopped) return@post
                if (decision is PageDecision.Open) {
                    runCatching {
                        activity.startActivity(
                            Intent(intent).setClassName(decision.handler.packageName, decision.handler.activityName)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }.onFailure { onAndroidSettings() }
                } else {
                    onAndroidSettings()
                }
            }
        }
    }
}
