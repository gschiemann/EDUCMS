package com.educms.player.network

import android.animation.ObjectAnimator
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.FocusFinder
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.educms.player.R
import com.educms.player.boot.Reachability
import com.educms.player.display.DisplayEmergency
import com.educms.player.led.LedCanvasHost
import com.educms.player.logging.PlayerLogger
import com.educms.player.network.NetworkScreenPolicy.Fix
import com.educms.player.network.NetworkScreenPolicy.Health
import com.educms.player.network.NetworkScreenPolicy.Lock
import com.educms.player.network.NetworkScreenPolicy.Outcome
import com.educms.player.network.NetworkScreenPolicy.Stage
import com.educms.player.network.NetworkScreenPolicy.Words
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
 * VenueOS's ON-SCREEN NETWORK SCREEN (2026-10-23; redesigned 2026-10-24 to
 * the owner's bar: "every menu needs to be cutting edge … the most user
 * friendly workflows ever"). The one settings screen the owner asked for
 * first: "Wi-Fi and Ethernet being number 1".
 *
 *  • HOME: a status hero (how the screen is connected, signal, address and
 *    whether VenueOS's own server answers), the Wi-Fi card (nearby networks
 *    — the connected one first, then saved, then by signal; Scan again; Add
 *    a hidden network) and the Ethernet card (read-only, with "Advanced:
 *    Android network settings").
 *  • PASSWORD: VenueOS's own remote-first keyboard ([KeyboardModel]) with a
 *    cursor, a one-letter Shift, a Connect key on the keyboard, a show/hide
 *    eye and the character count. A wrong password comes back KEPT.
 *  • CONNECTING: live stages (joining → address → VenueOS), never a frozen
 *    screen; RESULT: a big check that returns by itself, or one sentence
 *    saying what to do next with the fix as the focused button.
 *
 * ONE ENGINE: every connection runs [WifiConnect] — the SAME engine, policy,
 * outcome codes and never-strand rule as a dashboard push. This file only
 * presents what the engine says.
 *
 * REMOTE-ONLY (player rule 15): focus is always PARKED on a real control and
 * cannot escape to the page underneath ([focusSearch]); Back goes back ONE
 * step (password → list → closed) and never traps; touch works too.
 *
 * ⚠️ AN ALERT OUTRANKS IT: it does not open during an emergency hold, and it
 * leaves the glass the instant one starts (a change listener on the hold, and
 * a [NetworkScreenPolicy.EMERGENCY_POLL_MS] poll behind it) — the alert
 * renders in the page underneath and nothing of ours may cover it. What the
 * person was doing is remembered for a few minutes ([NetworkResume]) — never
 * the password.
 *
 * Entry points: the boot diagnostic's "Network settings" button and the
 * player's Back-menu "Network" entry (the `openNetworkScreen` bridge method).
 *
 * 2026-10-26 (the GUQ55 field failure — "saved the wifi connection info,
 * never connected, not user friendly"): a person's Connect now takes
 * Android's own save page wherever the ROM has it (Settings saves AND
 * connects — `WifiSetupPolicy.route`); a network Android has taken but not
 * moved onto is never shown as a success — the screen says "Not connected
 * yet", hands over to Android's Wi-Fi list with the one press that connects,
 * and keeps watching so it flips to the big check the moment the screen is
 * on it; and the screen asks for NO permission itself — location is granted
 * once, at setup, with every other grant ([Fix.OPEN_SETUP]).
 */
object NetworkScreen {

    private const val TAG = "NetworkScreen"

    /** The close reason an alert uses — the one that remembers where the person was. */
    internal const val REASON_ALERT = "an emergency hold started"

    // The one open screen: attached to the Activity's content view and dropped
    // (removed + nulled) in close(), which the Activity also calls on destroy.
    @SuppressLint("StaticFieldLeak")
    private var screen: NetworkScreenView? = null
    private var restoreFocus: WeakReference<View>? = null

    /** Memory only, never a password ([NetworkResume]). */
    private var resume: NetworkResume.Snapshot? = null

    fun isShowing(): Boolean = screen != null

    /**
     * Put the screen up. Main thread. False when it may not open (an alert,
     * a pinned task) — the caller keeps whatever it had on the glass.
     *
     * @param onConnected a join succeeded and the screen is returning by
     *        itself: the caller takes the person back to content (or the
     *        pairing code). Called after the screen has closed.
     * @param onOpenSetup raise the setup checklist — where location access
     *        is granted, with every other grant (2026-10-26). Returns false
     *        when it could not open (no checklist on this install); the
     *        screen then asks Android directly, as the only way left.
     */
    fun open(
        activity: Activity,
        onAndroidSettings: () -> Unit,
        source: String,
        onConnected: () -> Unit = {},
        onOpenSetup: () -> Boolean = { false },
    ): Boolean {
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
        val pickUp = NetworkResume.restore(resume, SystemClock.elapsedRealtime())
        resume = null
        val view = NetworkScreenView(activity, onAndroidSettings, onOpenSetup, pickUp) { reason -> close(reason, onConnected) }
        root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // On an LED poster: top-left at the LED canvas, never centred off the glass. No-op elsewhere.
        LedCanvasHost.pin(view)
        view.bringToFront()
        screen = view
        view.start()
        PlayerLogger.i(TAG, "opened ($source)${if (pickUp != null) " — picking up ${pickUp.step} after an alert" else ""}")
        return true
    }

    /** Back reached the Activity while the screen is up: one step back. True = handled. */
    fun back(): Boolean {
        val view = screen ?: return false
        view.back()
        return true
    }

    /**
     * The setup checklist that was raised over this screen has closed
     * (2026-10-26): take the remote back and look at the grant again — a
     * location access granted there lists the networks here at once.
     */
    fun onSetupClosed() {
        screen?.setupClosed()
    }

    /** Take it down and give the remote back to the surface it came from. */
    fun close(reason: String) = close(reason) {}

    private fun close(reason: String, onConnected: () -> Unit) {
        val view = screen ?: return
        screen = null
        if (reason == REASON_ALERT) resume = view.resumeSnapshot(SystemClock.elapsedRealtime())
        view.stop()
        runCatching { (view.parent as? ViewGroup)?.removeView(view) }
        PlayerLogger.i(TAG, "closed ($reason)")
        restoreFocus?.get()?.let { previous -> if (previous.isAttachedToWindow) previous.requestFocus() }
        restoreFocus = null
        if (reason == NetworkScreenView.REASON_CONNECTED) runCatching { onConnected() }
    }
}

/** The screen's views. One instance per open; nothing outlives [stop]. */
@SuppressLint("ViewConstructor") // built in code only, never inflated
internal class NetworkScreenView(
    private val activity: Activity,
    private val onAndroidSettings: () -> Unit,
    private val onOpenSetup: () -> Boolean,
    private val pickUp: NetworkResume.Snapshot?,
    private val onClose: (String) -> Unit,
) : FrameLayout(activity) {

    enum class Step { LIST, PASSWORD, HIDDEN_NAME, HIDDEN_SECURITY, CONNECTING, RESULT }

    companion object {
        const val REASON_CONNECTED = "connected — returning"
        private const val PLAYER_PREFS = "edu_player"
        private const val TAG = "NetworkScreen"
        private val DPAD_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
        )
    }

    /** One join in progress. The password stays in [keyboard] (memory) until the attempt ends. */
    private class Attempt(val ssid: String, val security: String, val hidden: Boolean, val previous: String?) {
        var id: String? = null
        var words: Words? = null
        var stage = Stage.JOINING
        var watchUntil = 0L
        var background = false
        var finished = false
        var lastProbeAt = 0L

        /** The engine took Android's save page (Settings saves AND connects) rather than suggesting. */
        var viaDialog = false

        /** Android's page found the network already saved — it connected to nothing. */
        var alreadySaved = false

        /** The screen has said "not connected yet" and is still watching for Android to move. */
        var handedOff = false
    }

    private enum class ResultKind { SUCCESS, NOT_YET, FAILURE }

    private data class ResultState(
        val kind: ResultKind,
        val words: Words?,
        val ssid: String,
        val secured: Boolean,
        val previous: String?,
        val reason: NetworkScreenPolicy.NotYetReason? = null,
        val viaDialog: Boolean = false,
    ) {
        /** The screen keeps watching behind this result and flips to the big check when Android moves. */
        val stillWatching: Boolean get() = kind == ResultKind.NOT_YET || words == Words.NO_SERVER_YET
    }

    private enum class Tone { GOOD, WARN, INFO }

    private data class Banner(val text: String, val tone: Tone)

    private val app: Context = activity.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "venueos-network-screen").apply { isDaemon = true } }
    private val demo: NetworkDemo? = runCatching { NetworkScreenDemo.scenario(app) }.getOrNull()

    private var ui = NetUi(activity, NetworkLayout.metrics(LedCanvasHost.viewportWidthPx(activity), LedCanvasHost.viewportHeightPx(activity)))
    private val content = FrameLayout(activity)

    private var step = Step.LIST
    private var stopped = false
    private var status: DeviceSettingsWire.NetStatus? = null
    private var scan: WifiScan.Result? = null
    private var scanning = false
    private var venueos: Boolean? = null
    private var probing = false
    private var probedFor: String? = null
    private var listLive: String? = null
    private var chosenSsid = ""
    private var chosenSecurity = WifiScanPolicy.SEC_WPA2
    private var chosenHidden = false
    private var keyboard = KeyboardModel()
    private var showPassword = false
    private var revealIndex: Int? = null
    private var entryMessage: String? = null
    private var entryError = false
    private var attempt: Attempt? = null
    private var result: ResultState? = null
    private var banner: Banner? = null
    private var resumed = false
    private var personMoved = false
    private var navAnchor: Int? = null
    private var successReturnAt = 0L
    private val animators = mutableListOf<ObjectAnimator>()

    // Views the current step updates in place (never rebuilt per key press).
    private var heroHolder: LinearLayout? = null
    private var ethernetHolder: LinearLayout? = null
    private var wifiStatusHolder: LinearLayout? = null
    private var wifiList: LinearLayout? = null
    private var bannerHolder: LinearLayout? = null
    private var field: FieldView? = null
    private var counterView: TextView? = null
    private var messageView: TextView? = null
    private var hintView: TextView? = null
    private var eyeIcon: ImageView? = null
    private var eyeLabel: TextView? = null
    private var keyViews: List<List<NetControl>> = emptyList()
    private var fieldItems: List<View> = emptyList()
    private var fieldSpans: List<Int> = emptyList()
    private var backControl: View? = null
    private var stageRows: List<Triple<FrameLayout, TextView, Stage>> = emptyList()
    private var drawnStage: Stage? = null
    private var connectingNote: TextView? = null
    private var connectingExtra: LinearLayout? = null
    private var drawnExtra: Fix? = null
    private var countdownView: TextView? = null

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
            // A grant made on the setup checklist (over this screen) or in
            // Android's settings lists the networks here without a reopen.
            if (step == Step.LIST) recheckAccess()
            main.postDelayed(this, NetworkScreenPolicy.STATUS_REFRESH_MS)
        }
    }
    private val probeTick = object : Runnable {
        override fun run() {
            if (stopped) return
            probe(force = true)
            main.postDelayed(this, NetworkScreenPolicy.PROBE_REFRESH_MS)
        }
    }
    private val stageTick = object : Runnable {
        override fun run() {
            if (stopped || !watchingJoin()) return
            refreshStatus()
            judgeStages()
            main.postDelayed(this, NetworkScreenPolicy.STAGE_POLL_MS)
        }
    }

    /** A join is being watched: the connecting stages, or a "not connected yet" result still waiting for Android. */
    private fun watchingJoin(): Boolean =
        step == Step.CONNECTING || (step == Step.RESULT && result?.stillWatching == true && attempt?.finished == false)
    private val unmask = Runnable {
        revealIndex = null
        updateField()
    }
    private val countdownTick = object : Runnable {
        override fun run() {
            if (stopped || step != Step.RESULT || result?.kind != ResultKind.SUCCESS) return
            val left = successReturnAt - SystemClock.elapsedRealtime()
            if (left <= 0L) {
                finishConnected()
                return
            }
            countdownView?.text = s(R.string.net_returning, ((left + 999L) / 1000L).toInt())
            main.postDelayed(this, 250L)
        }
    }

    init {
        isClickable = true
        isFocusable = false
        NetUi.noClip(this)
        addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        NetUi.noClip(content)
        paintBackground(LedCanvasHost.viewportWidthPx(activity), LedCanvasHost.viewportHeightPx(activity))
    }

    // ── lifecycle ──────────────────────────────────────────────────────

    fun start() {
        prefs.registerOnSharedPreferenceChangeListener(holdListener)
        main.postDelayed(holdPoll, NetworkScreenPolicy.EMERGENCY_POLL_MS)
        main.post(statusTick)
        main.postDelayed(probeTick, NetworkScreenPolicy.PROBE_REFRESH_MS)
        pickUp?.let { p ->
            resumed = true
            chosenSsid = p.ssid
            chosenSecurity = p.security.ifEmpty { WifiScanPolicy.SEC_WPA2 }
            chosenHidden = p.hidden
            when (p.step) {
                NetworkResume.Step.PASSWORD -> {
                    keyboard = KeyboardModel()
                    step = Step.PASSWORD
                }
                NetworkResume.Step.HIDDEN_NAME -> {
                    keyboard = KeyboardModel(text = p.ssid, maxLength = 32)
                    step = Step.HIDDEN_NAME
                }
                NetworkResume.Step.HIDDEN_SECURITY -> step = Step.HIDDEN_SECURITY
            }
        }
        render(forward = true)
        startScan()
        // DEBUG demo only: an "alert" that closes the screen through the real alert path (resume check).
        demo?.alertAfterMs?.let { ms -> main.postDelayed({ if (!stopped) onClose(NetworkScreen.REASON_ALERT) }, ms) }
    }

    fun stop() {
        stopped = true
        runCatching { prefs.unregisterOnSharedPreferenceChangeListener(holdListener) }
        main.removeCallbacksAndMessages(null)
        animators.forEach { it.cancel() }
        animators.clear()
        keyboard = KeyboardModel() // the password goes with the screen
        io.shutdown()
    }

    /** ⚠️ The alert wins: true = it is held and the screen is closing. */
    private fun checkHold(): Boolean {
        if (stopped) return true
        val held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
        if (NetworkScreenPolicy.mustClose(held)) {
            onClose(NetworkScreen.REASON_ALERT)
            return true
        }
        return false
    }

    /** Where the person was, for [NetworkResume] — the network and the step, never the password. */
    fun resumeSnapshot(nowElapsedMs: Long): NetworkResume.Snapshot? {
        val a = attempt
        return when (step) {
            Step.PASSWORD -> NetworkResume.Snapshot(NetworkResume.Step.PASSWORD, chosenSsid, chosenSecurity, chosenHidden, nowElapsedMs)
            Step.HIDDEN_NAME -> NetworkResume.Snapshot(NetworkResume.Step.HIDDEN_NAME, keyboard.text, "", true, nowElapsedMs)
            Step.HIDDEN_SECURITY -> NetworkResume.Snapshot(NetworkResume.Step.HIDDEN_SECURITY, chosenSsid, "", true, nowElapsedMs)
            Step.CONNECTING, Step.RESULT ->
                if (a != null && NetworkScreenPolicy.needsPassword(a.security) && result?.kind != ResultKind.SUCCESS) {
                    NetworkResume.Snapshot(NetworkResume.Step.PASSWORD, a.ssid, a.security, a.hidden, nowElapsedMs)
                } else null
            Step.LIST -> null
        }
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        // Back from Android's location or save page: look again.
        if (hasWindowFocus && !stopped && step == Step.LIST) {
            refreshStatus()
            if (scan?.access != WifiScanPolicy.Access.GRANTED) startScan()
        }
        // Android's approval / save prompt answered, or the person is back from
        // Android's Wi-Fi list: judge the join now, not a second later.
        if (hasWindowFocus && !stopped && watchingJoin()) {
            refreshStatus()
            judgeStages()
        }
    }

    /**
     * The setup checklist raised over this screen has closed (2026-10-26):
     * the remote comes back here, and a grant made there is read now.
     */
    fun setupClosed() {
        if (stopped) return
        refreshStatus()
        if (step == Step.LIST) {
            if (scan?.access != WifiScanPolicy.Access.GRANTED) startScan()
            parkFocus()
        } else if (findFocus() == null) {
            parkFocus()
        }
    }

    /**
     * While the list shows why it is empty, re-read the grant every few
     * seconds (cheap: two permission checks and the Location switch) so the
     * networks appear the moment it is given — on the setup checklist, in
     * Android's settings, or by adb.
     */
    private fun recheckAccess() {
        val r = scan ?: return
        if (scanning || r.access == WifiScanPolicy.Access.GRANTED || demo != null) return
        background {
            val now = runCatching { WifiScan.access(activity, app) }.getOrNull() ?: return@background
            main.post {
                if (stopped || step != Step.LIST || scanning) return@post
                val current = scan ?: return@post
                if (now == WifiScanPolicy.Access.GRANTED) {
                    startScan()
                } else if (now != current.access) {
                    scan = WifiScan.Result(now, emptyList(), fresh = false)
                    bindWifi()
                }
            }
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0 || stopped) return
        paintBackground(w, h)
        val m = NetworkLayout.metrics(w, h)
        if (m != ui.metrics) {
            // Rotated, or the first real measure differs from the display's: same state, new layout.
            ui = NetUi(activity, m)
            post { if (!stopped) render(forward = null) }
        }
    }

    private fun background(work: () -> Unit) {
        if (stopped) return
        runCatching { io.execute(work) }
    }

    // ── what the screen knows ──────────────────────────────────────────

    private fun refreshStatus() {
        demo?.let { d ->
            val now = d.statusNow()
            if (now != status) {
                status = now
                onStatusChanged()
            }
            return
        }
        background {
            val now = runCatching { NetworkStatus.read(app) }.getOrNull()
            main.post {
                if (stopped) return@post
                if (now != status) {
                    status = now
                    onStatusChanged()
                }
            }
        }
    }

    private fun onStatusChanged() {
        val st = status
        val key = statusKey(st)
        if (key != probedFor) {
            venueos = null
            probe(force = false)
        }
        if (step == Step.LIST) {
            bindHero()
            bindEthernet()
            // The list's "Connected" row follows the live connection, not the last scan.
            val live = "${st?.transport}|${st?.ssid}"
            if (live != listLive) bindWifi()
        }
        // Behind a "not connected yet" result the connection is still watched.
        if (step == Step.RESULT && result?.stillWatching == true) judgeStages()
    }

    private fun liveNetworks(networks: List<WifiScanPolicy.Network>): List<WifiScanPolicy.Network> =
        NetworkScreenPolicy.withLive(networks, status?.transport, status?.ssid)

    /**
     * Ask VenueOS's own server whether it answers (GET /api/v1/health, the
     * boot diagnostic's read-only probe) — "Connected to VenueOS" is said
     * only on that evidence (player rule 10).
     */
    private fun probe(force: Boolean) {
        val st = status ?: return
        val key = statusKey(st)
        if (st.transport == NetworkStatusPolicy.T_NONE) {
            venueos = false
            probedFor = key
            return
        }
        if (probing) return
        if (!force && key == probedFor && venueos != null) return
        probing = true
        demo?.let { d ->
            main.postDelayed({ probeAnswered(key, d.venueosNow() == true) }, 700L)
            return
        }
        background {
            val ok = runCatching {
                Reachability.probe("${com.educms.player.ApiRoot.resolve(app)}/api/v1/health", "GET").ok
            }.getOrDefault(false)
            main.post { probeAnswered(key, ok) }
        }
    }

    private fun statusKey(st: DeviceSettingsWire.NetStatus?): String? = st?.let { "${it.transport}|${it.ssid}|${it.ip}" }

    /**
     * An answer counts only for the connection it was asked over: a probe
     * that left on the old network and came back after a switch would
     * otherwise tick "Checking VenueOS" for a network it never tested.
     */
    private fun probeAnswered(key: String?, ok: Boolean) {
        probing = false
        if (stopped) return
        if (key != statusKey(status)) {
            probe(force = false)
            return
        }
        probedFor = key
        venueos = ok
        if (step == Step.LIST) bindHero()
        if (step == Step.CONNECTING) judgeStages()
    }

    private fun startScan() {
        if (scanning) return
        scanning = true
        if (step == Step.LIST) bindWifi()
        demo?.let { d ->
            if (d.access == null) return // a scan that never answers: the skeleton state
            main.postDelayed({
                scanning = false
                if (stopped) return@postDelayed
                scan = WifiScan.Result(d.access, if (d.access == WifiScanPolicy.Access.GRANTED) d.networks else emptyList(), fresh = true)
                if (step == Step.LIST) onScanArrived()
            }, 900L)
            return
        }
        WifiScan.scan(activity, app) scanned@{ r ->
            scanning = false
            if (stopped) return@scanned
            scan = r
            PlayerLogger.i(
                TAG,
                "scan: ${r.access}, ${r.networks.size} network(s)" +
                    (r.networks.maxByOrNull { it.rssi }?.let { ", strongest ${NetworkScreenPolicy.signal(it.bars)}" } ?: ""),
            )
            if (step == Step.LIST) onScanArrived()
        }
    }

    private fun onScanArrived() {
        bindWifi()
        // The list landed: if the person has not touched the remote yet, put
        // them on the most likely next thing (never yank focus mid-browse).
        if (!personMoved) parkHome()
    }

    // ── rendering ──────────────────────────────────────────────────────

    /** @param forward true = deeper (slide from the right), false = back, null = same step re-laid. */
    private fun render(forward: Boolean?) {
        if (stopped) return
        val keep = findFocus()?.let { focusKeyOf(it) }
        clearRefs()
        val page = when (step) {
            Step.LIST -> buildHome()
            Step.PASSWORD, Step.HIDDEN_NAME -> buildEntry()
            Step.HIDDEN_SECURITY -> buildSecurity()
            Step.CONNECTING -> buildConnecting()
            Step.RESULT -> buildResult()
        }
        content.removeAllViews()
        content.addView(page, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        if (forward != null) {
            page.alpha = 0f
            page.translationX = ui.pxf(if (forward) 36f else -36f)
            page.animate().alpha(1f).translationX(0f).setDuration(220L).setInterpolator(DecelerateInterpolator()).start()
        }
        if (forward == null && keep != null) {
            main.post { if (!stopped && !focusByKey(keep)) parkFocus() }
        } else {
            personMoved = false
            parkFocus()
        }
    }

    private fun clearRefs() {
        heroHolder = null
        ethernetHolder = null
        wifiStatusHolder = null
        wifiList = null
        bannerHolder = null
        field = null
        counterView = null
        messageView = null
        hintView = null
        eyeIcon = null
        eyeLabel = null
        keyViews = emptyList()
        fieldItems = emptyList()
        backControl = null
        stageRows = emptyList()
        drawnStage = null
        connectingNote = null
        connectingExtra = null
        drawnExtra = null
        countdownView = null
        animators.forEach { it.cancel() }
        animators.clear()
    }

    private fun paintBackground(w: Int, h: Int) {
        val base = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(NetTheme.BG_TOP, NetTheme.BG_MID, NetTheme.BG_BOTTOM),
        )
        val glow = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            colors = intArrayOf(NetTheme.BG_GLOW, 0x006366F1)
            setGradientCenter(0.12f, 0.06f)
            gradientRadius = maxOf(w, h) * 0.55f
        }
        val glow2 = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            colors = intArrayOf(NetTheme.BG_GLOW_2, 0x008B5CF6)
            setGradientCenter(0.92f, 0.95f)
            gradientRadius = maxOf(w, h) * 0.5f
        }
        // Fully opaque (the base): nothing of the page underneath — the Screen
        // options menu included — shows through any more (1.1.53 was 95 %).
        background = LayerDrawable(arrayOf(base, glow, glow2))
    }

    private fun s(id: Int, vararg args: Any): String = runCatching { activity.getString(id, *args) }.getOrDefault("")

    /** The scrolling page every step sits in, with the margins and room for focus glow. */
    private fun page(scroll: Boolean, centerVertically: Boolean = false): Pair<View, LinearLayout> {
        val col = ui.column(Gravity.CENTER_HORIZONTAL)
        col.setPadding(ui.gutter, ui.px(if (ui.wide) 48 else 40), ui.gutter, ui.px(32))
        if (!scroll) return col to col
        if (centerVertically) col.gravity = Gravity.CENTER
        return scroller(col, padDu = 0f, fill = true) to col
    }

    /**
     * A scroll viewport that clips at its own edge while the controls inside
     * may still grow and glow past THEIR edges: the ScrollView never clips its
     * content (focused rows overhang into its [padDu] padding), and a plain
     * frame around it does the clipping. (Android clips a view to its own
     * bounds only when its PARENT says so — a ScrollView inside a no-clip
     * card would otherwise draw its whole list over the buttons below it.)
     */
    private fun scroller(content: View, padDu: Float, fill: Boolean): FrameLayout {
        val sv = ScrollView(activity).apply {
            isFillViewport = fill
            isVerticalScrollBarEnabled = false
            clipToPadding = false
            clipChildren = false
            overScrollMode = View.OVER_SCROLL_NEVER
            val p = ui.px(padDu)
            setPadding(p, p, p, p)
            addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        return FrameLayout(activity).apply {
            clipChildren = true
            addView(sv, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
    }

    /** Header: the brand mark and title (home), or a Back control (every deeper step). */
    private fun header(back: String?, trailingClose: Boolean): LinearLayout {
        val bar = ui.row()
        if (back == null) {
            bar.addView(
                ui.tile(R.drawable.ic_net_brand, 72f, 40f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM),
                ui.lp(ui.px(72), ui.px(72), r = ui.px(24)),
            )
            val titles = ui.column()
            titles.addView(ui.text(s(R.string.net_title), if (ui.wide) 52f else 48f, NetTheme.TEXT, ui.bold, lines = 1))
            titles.addView(ui.text(s(R.string.net_subtitle), 24f, NetTheme.SUBTLE, lines = 2))
            bar.addView(titles, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
            if (trailingClose) {
                bar.addView(
                    button(s(R.string.net_close), R.drawable.ic_net_close, primary = false, compact = true, key = "close") {
                        onClose("closed by a person")
                    },
                )
            }
        } else {
            backControl = button(back, R.drawable.ic_net_back, primary = false, compact = true, key = "back") { back() }
            bar.addView(backControl)
            bar.addView(View(activity), LinearLayout.LayoutParams(0, 1, 1f))
        }
        return bar
    }

    // ── HOME ───────────────────────────────────────────────────────────

    private fun buildHome(): View {
        val hero = ui.column().apply {
            background = ui.card(hero = true)
            setPadding(ui.px(40), ui.px(36), ui.px(40), ui.px(36))
        }
        heroHolder = hero
        val ethernet = ui.column().apply {
            background = ui.card()
            setPadding(ui.px(36), ui.px(32), ui.px(36), ui.px(32))
        }
        ethernetHolder = ethernet
        val wifi = buildWifiCard(inlineList = !ui.wide)

        if (ui.wide) {
            // Two columns that fit the glass: status + Ethernet | the Wi-Fi list (it scrolls on its own).
            val root = ui.column()
            root.setPadding(ui.gutter, ui.px(48), ui.gutter, ui.px(28))
            root.addView(header(back = null, trailingClose = true), ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(28)))
            bannerHolder = ui.column().also { root.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP)) }
            bindBanner()
            val body = ui.row(Gravity.TOP)
            val left = ui.column()
            left.addView(hero, ui.lp(NetUi.MATCH, NetUi.WRAP))
            left.addView(ethernet, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(28)))
            val leftScroll = scroller(left, padDu = 28f, fill = false)
            val leftWidth = (ui.metrics.widthDu * 0.36f).coerceIn(520f, 700f) + 56f
            body.addView(leftScroll, LinearLayout.LayoutParams(ui.px(leftWidth), NetUi.MATCH).apply {
                leftMargin = -ui.px(28)
                topMargin = -ui.px(28)
                bottomMargin = -ui.px(28)
            })
            body.addView(wifi, LinearLayout.LayoutParams(0, NetUi.MATCH, 1f).apply { leftMargin = ui.px(12) })
            root.addView(body, ui.lpWeight(1f, vertical = true))
            root.addView(hint(), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(20)))
            bindHero()
            bindEthernet()
            bindWifi()
            return root
        }
        // One column (portrait, 4:3 and narrow LED): everything scrolls together.
        val (scroller, col) = page(scroll = true)
        col.gravity = Gravity.START
        col.addView(header(back = null, trailingClose = true), ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(28)))
        bannerHolder = ui.column().also { col.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP)) }
        bindBanner()
        col.addView(hero, ui.lp(NetUi.MATCH, NetUi.WRAP))
        col.addView(wifi, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(28)))
        col.addView(ethernet, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(28)))
        col.addView(hint(), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(24)))
        bindHero()
        bindEthernet()
        bindWifi()
        return scroller
    }

    private fun hint(): TextView = ui.text(s(R.string.net_hint), 21f, NetTheme.FAINT, lines = 2).apply {
        gravity = Gravity.CENTER_HORIZONTAL
    }

    private fun bindBanner() {
        val holder = bannerHolder ?: return
        holder.removeAllViews()
        val b = banner ?: return
        val (fg, bg, icon) = when (b.tone) {
            Tone.GOOD -> Triple(NetTheme.GOOD, NetTheme.GOOD_BG, R.drawable.ic_net_check)
            Tone.WARN -> Triple(NetTheme.WARN, NetTheme.WARN_BG, R.drawable.ic_net_warning)
            Tone.INFO -> Triple(NetTheme.ACCENT_LIGHT, NetTheme.INFO_BG, R.drawable.ic_net_info)
        }
        val line = ui.row().apply {
            background = ui.rounded(bg, 20f)
            setPadding(ui.px(24), ui.px(16), ui.px(24), ui.px(16))
        }
        line.addView(ui.icon(icon, 30f, fg), ui.lp(ui.px(30), ui.px(30), r = ui.px(16)))
        line.addView(ui.text(b.text, 24f, NetTheme.TEXT, ui.medium, lines = 3), LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        holder.addView(line, ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(24)))
    }

    private fun bindHero() {
        val hero = heroHolder ?: return
        hero.removeAllViews()
        val st = status
        val health = NetworkScreenPolicy.health(st?.transport, venueos)
        val (iconRes, caption, name) = when (st?.transport) {
            NetworkStatusPolicy.T_WIFI -> Triple(
                wifiIcon(st.bars ?: 0),
                s(R.string.net_via_wifi),
                st.ssid ?: s(R.string.net_hero_wifi_unnamed),
            )
            NetworkStatusPolicy.T_ETHERNET -> Triple(R.drawable.ic_net_ethernet, s(R.string.net_via_ethernet), s(R.string.net_ethernet_section))
            NetworkStatusPolicy.T_OTHER -> Triple(R.drawable.ic_net_brand, s(R.string.net_via_other), s(R.string.net_via_other))
            null -> Triple(R.drawable.ic_net_wifi_0, s(R.string.net_health_checking), "…")
            // Offline: the big words ARE the health line — no pill repeating them.
            else -> Triple(R.drawable.ic_net_wifi_off, s(R.string.net_caption_status), s(R.string.net_via_none))
        }
        val (tileTop, tileBottom) = when (health) {
            Health.VENUEOS -> NetTheme.PRIMARY_TOP to NetTheme.PRIMARY_BOTTOM
            Health.NO_VENUEOS -> 0xFFB45309.toInt() to 0xFF92400E.toInt()
            Health.OFFLINE -> 0xFF334155.toInt() to 0xFF1E293B.toInt()
            Health.CHECKING -> NetTheme.PRIMARY_TOP to NetTheme.PRIMARY_BOTTOM
        }
        val top = ui.row()
        top.addView(ui.tile(iconRes, 112f, 60f, tileTop, tileBottom), ui.lp(ui.px(112), ui.px(112), r = ui.px(28)))
        val titles = ui.column()
        titles.addView(ui.caption(caption))
        titles.addView(ui.text(name, if (ui.wide) 44f else 46f, NetTheme.TEXT, ui.bold, lines = 2), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(4)))
        top.addView(titles, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        hero.addView(top, ui.lp(NetUi.MATCH, NetUi.WRAP))

        val pill = when (health) {
            Health.VENUEOS -> ui.pill(NetTheme.GOOD, s(R.string.net_health_ok), NetTheme.TEXT, NetTheme.GOOD_BG)
            Health.NO_VENUEOS -> ui.pill(NetTheme.WARN, s(R.string.net_health_no_venueos), NetTheme.TEXT, NetTheme.WARN_BG)
            Health.OFFLINE -> null
            Health.CHECKING -> ui.pill(NetTheme.ACCENT_LIGHT, s(R.string.net_health_checking), NetTheme.TEXT, NetTheme.INFO_BG)
        }
        pill?.let { hero.addView(it, ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(28))) }

        if (st != null && st.transport != NetworkStatusPolicy.T_NONE) {
            val facts = ui.column()
            if (st.transport == NetworkStatusPolicy.T_WIFI) {
                facts.addView(fact(s(R.string.net_fact_signal), signalWords(st.bars ?: 0)))
            }
            st.ip?.let { facts.addView(fact(s(R.string.net_fact_ip), it)) }
            if (facts.childCount > 0) hero.addView(facts, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(20)))
            if (st.validated == false && health != Health.VENUEOS) {
                hero.addView(ui.text(s(R.string.net_status_unvalidated), 22f, NetTheme.SUBTLE, lines = 3), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(16)))
            }
        } else if (st != null) {
            hero.addView(ui.text(s(R.string.net_hero_offline_tip), 24f, NetTheme.TEXT_2, lines = 3), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(20)))
        }
    }

    private fun fact(label: String, value: String): View {
        val line = ui.row().apply {
            setPadding(0, ui.px(14), 0, ui.px(14))
        }
        line.addView(ui.text(label, 22f, NetTheme.SUBTLE, lines = 1), LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        line.addView(ui.text(value, 26f, NetTheme.TEXT, ui.medium, lines = 1).apply { gravity = Gravity.END })
        val wrap = ui.column()
        wrap.addView(View(activity).apply { setBackgroundColor(0x14FFFFFF) }, ui.lp(NetUi.MATCH, ui.px(1.5f)))
        wrap.addView(line, ui.lp(NetUi.MATCH, NetUi.WRAP))
        return wrap
    }

    private fun signalWords(bars: Int): String = s(
        when (NetworkScreenPolicy.signalOf(bars)) {
            NetworkScreenPolicy.Signal.EXCELLENT -> R.string.net_signal_excellent
            NetworkScreenPolicy.Signal.GOOD -> R.string.net_signal_good
            NetworkScreenPolicy.Signal.FAIR -> R.string.net_signal_fair
            NetworkScreenPolicy.Signal.WEAK -> R.string.net_signal_weak
            NetworkScreenPolicy.Signal.NONE -> R.string.net_signal_none
        },
    )

    private fun wifiIcon(bars: Int): Int = when (bars.coerceIn(0, 4)) {
        0 -> R.drawable.ic_net_wifi_0
        1 -> R.drawable.ic_net_wifi_1
        2 -> R.drawable.ic_net_wifi_2
        3 -> R.drawable.ic_net_wifi_3
        else -> R.drawable.ic_net_wifi_4
    }

    private fun bindEthernet() {
        val card = ethernetHolder ?: return
        val keep = findFocus()?.let { focusKeyOf(it) }
        card.removeAllViews()
        val st = status
        val linked = st?.ethernetLink == true
        val active = st?.transport == NetworkStatusPolicy.T_ETHERNET
        val head = ui.row()
        head.addView(ui.icon(R.drawable.ic_net_ethernet, 40f, NetTheme.ACCENT_LIGHT), ui.lp(ui.px(40), ui.px(40), r = ui.px(18)))
        head.addView(ui.text(s(R.string.net_ethernet_section), 32f, NetTheme.TEXT, ui.medium, lines = 1), LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        head.addView(
            if (linked) ui.chip(s(R.string.net_ethernet_cable_yes), NetTheme.GOOD, NetTheme.GOOD_BG)
            else ui.chip(s(R.string.net_ethernet_cable_no), NetTheme.SUBTLE, 0x14FFFFFF),
        )
        card.addView(head, ui.lp(NetUi.MATCH, NetUi.WRAP))
        if (active && st != null) {
            val facts = ui.column()
            st.ip?.let { facts.addView(fact(s(R.string.net_fact_ip), it)) }
            facts.addView(
                fact(
                    s(R.string.net_fact_address),
                    s(
                        when (st.auto) {
                            true -> R.string.net_mode_auto
                            false -> R.string.net_mode_fixed
                            null -> R.string.net_mode_unknown
                        },
                    ),
                ),
            )
            card.addView(facts, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(16)))
        } else {
            card.addView(
                ui.text(s(if (linked) R.string.net_ethernet_standby else R.string.net_ethernet_idle), 24f, NetTheme.TEXT_2, lines = 3),
                ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(18)),
            )
        }
        card.addView(ui.text(s(R.string.net_ethernet_fixed_note), 21f, NetTheme.SUBTLE, lines = 3), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(16)))
        card.addView(
            button(s(R.string.net_android_settings), R.drawable.ic_net_settings, primary = false, key = "android", trailing = R.drawable.ic_net_external) {
                openAndroidSettings()
            },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(22)),
        )
        if (keep == "android") focusByKey("android")
    }

    private fun buildWifiCard(inlineList: Boolean): View {
        val card = ui.column().apply {
            background = ui.card()
            setPadding(ui.px(36), ui.px(32), ui.px(36), ui.px(28))
        }
        val head = ui.row()
        head.addView(ui.icon(R.drawable.ic_net_wifi_4, 40f, NetTheme.ACCENT_LIGHT), ui.lp(ui.px(40), ui.px(40), r = ui.px(18)))
        head.addView(ui.text(s(R.string.net_wifi_section), 32f, NetTheme.TEXT, ui.medium, lines = 1), LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        wifiStatusHolder = ui.row().also { head.addView(it) }
        card.addView(head, ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(16)))

        val list = ui.column()
        wifiList = list
        if (inlineList) {
            card.addView(list, ui.lp(NetUi.MATCH, NetUi.WRAP))
        } else {
            // Room for a focused row's lift and glow inside the scrolling viewport,
            // and a soft fade at its edges so a cut-off row reads as "more below"
            // (ScrollView keeps the focused row clear of the fade by itself).
            val listScroll = scroller(list, padDu = 26f, fill = false)
            (listScroll.getChildAt(0) as? ScrollView)?.apply {
                isVerticalFadingEdgeEnabled = true
                setFadingEdgeLength(ui.px(64))
            }
            card.addView(listScroll, ui.lpWeight(1f, vertical = true).apply {
                leftMargin = -ui.px(26)
                rightMargin = -ui.px(26)
                topMargin = -ui.px(12)
            })
        }
        val actions = ui.row()
        actions.addView(
            button(s(R.string.net_scan_again), R.drawable.ic_net_refresh, primary = false, key = "scan") {
                if (!scanning) {
                    banner = null
                    bindBanner()
                    startScan()
                }
            },
            LinearLayout.LayoutParams(0, NetUi.WRAP, 1f).apply { rightMargin = ui.px(10) },
        )
        actions.addView(
            button(s(R.string.net_add_hidden), R.drawable.ic_net_add, primary = false, key = "hidden") { beginHidden() },
            LinearLayout.LayoutParams(0, NetUi.WRAP, 1f).apply { leftMargin = ui.px(10) },
        )
        card.addView(actions, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(18)))
        return card
    }

    private fun bindWifi() {
        val list = wifiList ?: return
        listLive = "${status?.transport}|${status?.ssid}"
        val keep = findFocus()?.let { focusKeyOf(it) }
        wifiStatusHolder?.let { h ->
            h.removeAllViews()
            if (scanning) {
                h.addView(SpinnerView(activity, ui, 3.5f, NetTheme.ACCENT_LIGHT), ui.lp(ui.px(28), ui.px(28), r = ui.px(12)))
                h.addView(ui.text(s(R.string.net_scanning), 22f, NetTheme.SUBTLE, lines = 1))
            }
        }
        list.removeAllViews()
        val r = scan
        when {
            r == null || (scanning && r.networks.isEmpty() && r.access == WifiScanPolicy.Access.GRANTED) -> skeleton(list)
            r.access != WifiScanPolicy.Access.GRANTED -> accessState(list, r.access)
            r.networks.isEmpty() -> emptyState(list)
            else -> NetworkScreenPolicy.ordered(liveNetworks(r.networks)).forEachIndexed { i, n ->
                list.addView(networkRow(n), ui.lp(NetUi.MATCH, NetUi.WRAP, t = if (i == 0) 0 else ui.px(12)))
            }
        }
        if (keep != null && focusByKey(keep)) return
        if (keep != null && findFocus() == null) parkHome()
    }

    private fun skeleton(list: LinearLayout) {
        repeat(3) { i ->
            val row = ui.row().apply {
                background = ui.rounded(0x0DFFFFFF, 22f)
                setPadding(ui.px(28), ui.px(28), ui.px(28), ui.px(28))
            }
            row.addView(View(activity).apply { background = ui.rounded(0x1AFFFFFF, 12f) }, ui.lp(ui.px(44), ui.px(44), r = ui.px(24)))
            row.addView(View(activity).apply { background = ui.rounded(0x1AFFFFFF, 10f) }, ui.lp(ui.px(if (i == 1) 220 else 300), ui.px(26)))
            list.addView(row, ui.lp(NetUi.MATCH, NetUi.WRAP, t = if (i == 0) 0 else ui.px(12)))
            animators += pulse(row).apply { startDelay = i * 150L }
        }
    }

    private fun emptyState(list: LinearLayout) {
        val box = ui.column(Gravity.CENTER_HORIZONTAL).apply { setPadding(ui.px(24), ui.px(40), ui.px(24), ui.px(40)) }
        box.addView(ui.icon(R.drawable.ic_net_wifi_0, 72f, NetTheme.SUBTLE))
        box.addView(ui.text(s(R.string.net_none_found), 30f, NetTheme.TEXT, ui.medium, lines = 2).apply { gravity = Gravity.CENTER }, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(20)))
        box.addView(ui.text(s(R.string.net_none_found_tip), 24f, NetTheme.SUBTLE, lines = 3).apply { gravity = Gravity.CENTER }, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(10)))
        list.addView(box, ui.lp(NetUi.MATCH, NetUi.WRAP))
    }

    private fun accessState(list: LinearLayout, access: WifiScanPolicy.Access) {
        val (iconRes, message) = when (access) {
            WifiScanPolicy.Access.NEEDS_PERMISSION -> R.drawable.ic_net_location to s(R.string.net_access_permission)
            WifiScanPolicy.Access.DENIED -> R.drawable.ic_net_location to s(R.string.net_access_denied)
            WifiScanPolicy.Access.LOCATION_OFF -> R.drawable.ic_net_location to s(R.string.net_access_location_off)
            WifiScanPolicy.Access.WIFI_OFF -> R.drawable.ic_net_wifi_off to s(R.string.net_access_wifi_off)
            WifiScanPolicy.Access.NO_WIFI -> R.drawable.ic_net_wifi_off to "${s(R.string.net_access_no_wifi)} ${s(R.string.net_access_no_wifi_tip)}"
            WifiScanPolicy.Access.EMERGENCY -> R.drawable.ic_net_warning to s(R.string.net_access_alert)
            WifiScanPolicy.Access.GRANTED -> return
        }
        val box = ui.column(Gravity.CENTER_HORIZONTAL).apply { setPadding(ui.px(24), ui.px(32), ui.px(24), ui.px(24)) }
        box.addView(ui.tile(iconRes, 104f, 56f, 0xFF3B2A0A.toInt(), 0xFF2A1E08.toInt(), NetTheme.WARN), ui.lp(ui.px(104), ui.px(104)))
        box.addView(ui.text(message, 27f, NetTheme.TEXT, lines = 5).apply { gravity = Gravity.CENTER }, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(22)))
        NetworkScreenPolicy.accessFix(access)?.let { fix ->
            box.addView(fixButton(fix, primary = true, key = "fix"), ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(26)))
        }
        list.addView(box, ui.lp(NetUi.MATCH, NetUi.WRAP))
    }

    private fun networkRow(n: WifiScanPolicy.Network): View {
        val lock = NetworkScreenPolicy.lockOf(n.security)
        val row = NetControl(activity, ui, growTo = 1.02f).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = NetBoxDrawable(ui, 22f, NetTheme.CONTROL)
            setPadding(ui.px(28), ui.px(22), ui.px(26), ui.px(22))
            focusKey = rowKey(n.ssid, n.security)
            contentDescription = n.ssid
            alpha = if (lock == Lock.UNSUPPORTED) 0.72f else 1f
        }
        row.addView(ui.icon(wifiIcon(n.bars), 44f, ui.onFocus(if (n.connected) NetTheme.GOOD else NetTheme.TEXT, NetTheme.TEXT)), ui.lp(ui.px(44), ui.px(44), r = ui.px(24)))
        val texts = ui.column()
        texts.addView(ui.text(n.ssid, 30f, NetTheme.TEXT, ui.medium, lines = 1).apply { isDuplicateParentStateEnabled = true })
        val sub = when (lock) {
            Lock.OPEN -> s(R.string.net_row_open)
            Lock.SECURED -> s(R.string.net_row_secured) + (NetworkScreenPolicy.protocolOf(n.security)?.let { " · $it" } ?: "")
            Lock.UNSUPPORTED -> s(R.string.net_row_unsupported) + (NetworkScreenPolicy.protocolOf(n.security)?.let { " · $it" } ?: "")
        }
        texts.addView(
            ui.text(sub, 21f, NetTheme.SUBTLE, lines = 1).apply {
                setTextColor(ui.onFocus(NetTheme.SUBTLE, NetTheme.ON_FOCUS_SUBTLE))
                isDuplicateParentStateEnabled = true
            },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(2)),
        )
        row.addView(texts, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        when {
            n.connected -> row.addView(ui.chip(s(R.string.net_chip_connected), 0xFF052E1C.toInt(), NetTheme.GOOD), ui.lp(NetUi.WRAP, NetUi.WRAP, l = ui.px(12)))
            n.savedBy != null -> row.addView(ui.chip(s(R.string.net_chip_saved), 0xFFE0E7FF.toInt(), 0xFF312E81.toInt()), ui.lp(NetUi.WRAP, NetUi.WRAP, l = ui.px(12)))
        }
        if (lock == Lock.SECURED) row.addView(ui.icon(R.drawable.ic_net_lock, 28f, ui.onFocus(NetTheme.SUBTLE, NetTheme.TEXT)), ui.lp(ui.px(28), ui.px(28), l = ui.px(18)))
        row.addView(ui.icon(R.drawable.ic_net_chevron_right, 30f, ui.onFocus(NetTheme.FAINT, NetTheme.TEXT)), ui.lp(ui.px(30), ui.px(30), l = ui.px(12)))
        row.setOnClickListener {
            if (lock == Lock.UNSUPPORTED) {
                chosenSsid = n.ssid
                chosenSecurity = n.security
                showFailure(Words.NOT_SUPPORTED, n.ssid, secured = false, previous = previousLabel())
            } else {
                choose(n.ssid, n.security, hidden = false)
            }
        }
        return row
    }

    private fun rowKey(ssid: String, security: String) = "net:$ssid\u0000$security"

    /** Where the remote lands on HOME ([NetworkScreenPolicy.homeFocus]). */
    private fun parkHome() {
        val r = scan
        val target = NetworkScreenPolicy.homeFocus(if (scanning && r == null) null else r?.access, liveNetworks(r?.networks.orEmpty()))
        val key = when (target) {
            is NetworkScreenPolicy.HomeFocus.Network -> rowKey(target.ssid, target.security)
            NetworkScreenPolicy.HomeFocus.ScanAgain -> "scan"
            NetworkScreenPolicy.HomeFocus.AccessFix -> "fix"
            NetworkScreenPolicy.HomeFocus.AndroidSettings -> "android"
        }
        main.post {
            if (stopped || step != Step.LIST) return@post
            if (!focusByKey(key)) focusByKey("scan") || focusFirst(content)
        }
    }

    // ── choosing a network ─────────────────────────────────────────────

    private fun choose(ssid: String, security: String, hidden: Boolean) {
        chosenSsid = ssid
        chosenSecurity = security
        chosenHidden = hidden
        keyboard = KeyboardModel()
        showPassword = false
        entryMessage = null
        entryError = false
        resumed = false
        if (NetworkScreenPolicy.needsPassword(security)) {
            step = Step.PASSWORD
            render(forward = true)
        } else {
            connect()
        }
    }

    private fun beginHidden() {
        chosenHidden = true
        keyboard = KeyboardModel(maxLength = 32)
        entryMessage = null
        entryError = false
        resumed = false
        step = Step.HIDDEN_NAME
        render(forward = true)
    }

    // ── PASSWORD / HIDDEN NAME ─────────────────────────────────────────

    private fun buildEntry(): View {
        val password = step == Step.PASSWORD
        val (scroller, col) = page(scroll = true, centerVertically = tall())
        val inner = ui.column()
        col.addView(inner, LinearLayout.LayoutParams(contentWidth(1240f), NetUi.WRAP))
        inner.addView(
            header(back = s(if (password && chosenHidden) R.string.net_back else R.string.net_back_networks), trailingClose = false),
            ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(if (ui.wide) 20 else 28)),
        )
        if (resumed) {
            inner.addView(ui.text(s(R.string.net_resumed), 22f, NetTheme.ACCENT_LIGHT, ui.medium, lines = 2), ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(16)))
        }
        // Who we are typing for.
        val title = ui.row()
        if (password) {
            title.addView(ui.tile(R.drawable.ic_net_lock, 84f, 44f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM), ui.lp(ui.px(84), ui.px(84), r = ui.px(26)))
            val t = ui.column()
            t.addView(ui.caption(s(R.string.net_password_caption)))
            t.addView(ui.text(chosenSsid, 42f, NetTheme.TEXT, ui.bold, lines = 1), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(2)))
            t.addView(
                ui.text(s(R.string.net_row_secured) + (NetworkScreenPolicy.protocolOf(chosenSecurity)?.let { " · $it" } ?: ""), 21f, NetTheme.SUBTLE, lines = 1),
                ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(2)),
            )
            title.addView(t, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        } else {
            title.addView(ui.tile(R.drawable.ic_net_add, 84f, 44f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM), ui.lp(ui.px(84), ui.px(84), r = ui.px(26)))
            val t = ui.column()
            t.addView(ui.caption(s(R.string.net_add_hidden)))
            t.addView(ui.text(s(R.string.net_hidden_name), 38f, NetTheme.TEXT, ui.bold, lines = 2), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(2)))
            title.addView(t, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
        }
        inner.addView(title, ui.lp(NetUi.MATCH, NetUi.WRAP))

        // The field row: field · Show/Hide · Clear.
        val fieldRow = ui.row()
        val f = FieldView(activity, ui).apply {
            focusKey = "field"
            placeholder = s(if (password) R.string.net_password_placeholder else R.string.net_hidden_placeholder)
            onCaretTapped = { i ->
                keyboard = keyboard.copy(cursor = i)
                updateField()
            }
            setOnFocusChangeListener { _, _ -> updateHint() }
        }
        field = f
        val fieldH = ui.px(if (ui.wide) 112 else 116)
        fieldRow.addView(f, LinearLayout.LayoutParams(0, fieldH, 1f))
        val items = mutableListOf<View>(f)
        val spans = mutableListOf(if (password) 14 else 16)
        if (password) {
            val eye = NetControl(activity, ui, growTo = 1.06f).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                background = NetBoxDrawable(ui, 22f, NetTheme.KEY_FN)
                focusKey = "eye"
                setOnClickListener {
                    showPassword = !showPassword
                    updateField()
                }
            }
            eyeIcon = ui.icon(R.drawable.ic_net_eye, 40f, NetTheme.TEXT).also { eye.addView(it) }
            eyeLabel = ui.text(s(R.string.net_show), 19f, NetTheme.TEXT_2, ui.medium, lines = 1).also {
                it.isDuplicateParentStateEnabled = true
                it.setTextColor(ui.onFocus(NetTheme.TEXT_2, NetTheme.TEXT))
                eye.addView(it, ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(4)))
            }
            fieldRow.addView(eye, LinearLayout.LayoutParams(ui.px(132), fieldH).apply { leftMargin = ui.px(16) })
            items += eye
            spans += 3
        }
        val clear = NetControl(activity, ui, growTo = 1.06f).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = NetBoxDrawable(ui, 22f, NetTheme.KEY_FN)
            focusKey = "clear"
            setOnClickListener {
                keyboard = keyboard.press(KeyboardModel.Key.Clear)
                entryMessage = null
                entryError = false
                revealIndex = null
                updateField()
            }
        }
        clear.addView(ui.icon(R.drawable.ic_net_close, 34f, NetTheme.TEXT))
        clear.addView(
            ui.text(s(R.string.net_key_clear), 19f, NetTheme.TEXT_2, ui.medium, lines = 1).apply {
                isDuplicateParentStateEnabled = true
                setTextColor(ui.onFocus(NetTheme.TEXT_2, NetTheme.TEXT))
            },
            ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(4)),
        )
        fieldRow.addView(clear, LinearLayout.LayoutParams(ui.px(132), fieldH).apply { leftMargin = ui.px(16) })
        items += clear
        spans += if (password) 3 else 4
        fieldItems = items
        fieldSpans = spans
        inner.addView(fieldRow, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(if (ui.wide) 26 else 32)))

        // Count · message · hint.
        val under = ui.row()
        counterView = ui.text("", 23f, NetTheme.TEXT_2, ui.medium, lines = 1).also { under.addView(it) }
        hintView = ui.text("", 21f, NetTheme.FAINT, lines = 1).apply { gravity = Gravity.END }.also {
            under.addView(it, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f).apply { leftMargin = ui.px(16) })
        }
        inner.addView(under, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(14)))
        messageView = ui.text("", 24f, NetTheme.WARN, ui.medium, lines = 3).also {
            inner.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(8)))
        }

        inner.addView(buildKeyboard(password), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(if (ui.wide) 18 else 28)))
        updateField()
        relabelKeys()
        return scroller
    }

    /** A tall single-column screen (portrait): the steps centre as a block and keys grow. */
    private fun tall(): Boolean = !ui.wide && ui.metrics.heightDu > ui.metrics.widthDu * 1.4f

    /** A column at most [maxDu] wide, never wider than the page between its margins. */
    private fun contentWidth(maxDu: Float): Int {
        if (!ui.wide) return NetUi.MATCH
        val available = ui.px(ui.metrics.widthDu) - 2 * ui.gutter
        return minOf(ui.px(maxDu), available)
    }

    private fun buildKeyboard(password: Boolean): View {
        val rows = keyboard.rows()
        val grid = ui.column()
        val cellW = (minOf(ui.metrics.widthDu - 2 * (if (ui.wide) 72f else 40f), 1240f)) / 10f
        val keyH = ui.px((cellW * if (tall()) 1.08f else 0.86f).coerceIn(60f, if (ui.wide) 86f else 116f))
        val gap = ui.px(if (ui.wide) 10 else 8)
        keyViews = rows.mapIndexed { r, row ->
            val line = ui.row()
            val spans = KeyboardNav.spans(r, rows.size)
            val views = row.mapIndexed { c, key ->
                val v = keyView(key, r, c, password)
                line.addView(v, LinearLayout.LayoutParams(0, keyH, spans[c].toFloat()).apply {
                    leftMargin = gap / 2
                    rightMargin = gap / 2
                })
                v
            }
            grid.addView(line, ui.lp(NetUi.MATCH, NetUi.WRAP, t = if (r == 0) 0 else gap))
            views
        }
        return grid
    }

    private fun keyView(initial: KeyboardModel.Key, r: Int, c: Int, password: Boolean): NetControl {
        val done = initial == KeyboardModel.Key.Done
        val fn = initial !is KeyboardModel.Key.Char && !done
        val v = NetControl(activity, ui, growTo = 1.1f).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = when {
                done -> NetBoxDrawable(
                    ui, 18f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM,
                    border = 0x33FFFFFF, focusFill = 0xFF818CF8.toInt(), focusFill2 = 0xFF8B5CF6.toInt(),
                )
                fn -> NetBoxDrawable(ui, 18f, NetTheme.KEY_FN)
                else -> NetBoxDrawable(ui, 18f, NetTheme.KEY)
            }
            focusKey = "key:$r:$c"
            setTag(R.id.net_key_pos, KeyboardNav.Pos(r, c))
            setOnClickListener { onKey(keyboard.rows()[r][c]) }
        }
        when (initial) {
            KeyboardModel.Key.Shift -> {
                v.addView(ui.icon(R.drawable.ic_net_shift, 36f, NetTheme.TEXT))
                v.contentDescription = s(R.string.net_key_shift)
            }
            KeyboardModel.Key.Delete -> {
                v.addView(ui.icon(R.drawable.ic_net_backspace, 40f, NetTheme.TEXT))
                v.contentDescription = s(R.string.net_key_delete)
            }
            KeyboardModel.Key.Done -> {
                v.addView(ui.text(s(if (password) R.string.net_connect else R.string.net_next), 28f, NetTheme.TEXT, ui.bold, lines = 1))
                v.addView(ui.icon(R.drawable.ic_net_arrow_right, 30f, NetTheme.TEXT), ui.lp(ui.px(30), ui.px(30), l = ui.px(10)))
            }
            KeyboardModel.Key.Space -> v.addView(ui.text(s(R.string.net_key_space), 24f, NetTheme.TEXT_2, ui.medium, lines = 1))
            KeyboardModel.Key.Symbols -> v.addView(ui.text("", 26f, NetTheme.TEXT, ui.medium, lines = 1))
            else -> v.addView(ui.text("", 34f, NetTheme.TEXT, ui.medium, lines = 1).apply { gravity = Gravity.CENTER })
        }
        return v
    }

    /** Labels follow the layout (lower / UPPER / symbols) — the keys keep their identity, so focus never moves. */
    private fun relabelKeys() {
        val rows = keyboard.rows()
        rows.forEachIndexed { r, row ->
            row.forEachIndexed keys@{ c, key ->
                val v = keyViews.getOrNull(r)?.getOrNull(c) ?: return@keys
                when (key) {
                    is KeyboardModel.Key.Char -> (v.getChildAt(0) as? TextView)?.text = key.c.toString()
                    KeyboardModel.Key.Symbols ->
                        (v.getChildAt(0) as? TextView)?.text = s(if (keyboard.layout == KeyboardModel.Layout.SYMBOLS) R.string.net_key_letters else R.string.net_key_symbols)
                    KeyboardModel.Key.Shift -> {
                        (v.getChildAt(0) as? ImageView)?.setImageResource(
                            when (keyboard.shift) {
                                KeyboardModel.ShiftState.OFF -> R.drawable.ic_net_shift
                                KeyboardModel.ShiftState.ONCE -> R.drawable.ic_net_shift_once
                                KeyboardModel.ShiftState.LOCKED -> R.drawable.ic_net_caps
                            },
                        )
                        v.isSelected = keyboard.shift != KeyboardModel.ShiftState.OFF
                        v.alpha = if (keyboard.layout == KeyboardModel.Layout.SYMBOLS) 0.45f else 1f
                    }
                    else -> Unit
                }
            }
        }
    }

    private fun onKey(key: KeyboardModel.Key) {
        if (key == KeyboardModel.Key.Done) {
            submitEntry()
            return
        }
        val before = keyboard
        keyboard = keyboard.press(key)
        afterEdit(before, typed = key is KeyboardModel.Key.Char || key == KeyboardModel.Key.Space)
    }

    private fun afterEdit(before: KeyboardModel, typed: Boolean) {
        if (keyboard.text != before.text) {
            entryMessage = null
            entryError = false
        }
        main.removeCallbacks(unmask)
        revealIndex = null
        if (typed && keyboard.text != before.text && step == Step.PASSWORD && !showPassword) {
            // Like a phone: the character just typed is readable for a moment, then masked.
            revealIndex = keyboard.caret - 1
            main.postDelayed(unmask, PasswordMask.REVEAL_MS)
        }
        if (keyboard.layout != before.layout || keyboard.capsLock != before.capsLock) relabelKeys()
        updateField()
    }

    private fun updateField() {
        val f = field ?: return
        val password = step == Step.PASSWORD
        f.display = if (password) PasswordMask.render(keyboard.text, showPassword, revealIndex) else keyboard.text
        f.caret = keyboard.caret
        f.error = entryError
        val n = keyboard.text.length
        counterView?.text = s(if (password && n < 8) R.string.net_count_short else R.string.net_count, n)
        counterView?.setTextColor(if (password && n in 1..7) NetTheme.WARN else NetTheme.TEXT_2)
        messageView?.text = entryMessage.orEmpty()
        messageView?.visibility = if (entryMessage == null) View.GONE else View.VISIBLE
        eyeIcon?.setImageResource(if (showPassword) R.drawable.ic_net_eye_off else R.drawable.ic_net_eye)
        eyeLabel?.text = s(if (showPassword) R.string.net_hide else R.string.net_show)
        (eyeIcon?.parent as? View)?.contentDescription = s(if (showPassword) R.string.net_hide_password else R.string.net_show_password)
        updateHint()
    }

    private fun updateHint() {
        val h = hintView ?: return
        h.text = when {
            field?.isFocused == true -> s(R.string.net_hint_cursor)
            step == Step.PASSWORD -> s(R.string.net_hint_shift)
            else -> ""
        }
    }

    private fun submitEntry() {
        when (step) {
            Step.PASSWORD -> {
                if (!NetworkScreenPolicy.passwordOk(keyboard.text)) {
                    entryMessage = s(R.string.net_password_short)
                    entryError = true
                    updateField()
                    return
                }
                connect()
            }
            Step.HIDDEN_NAME -> {
                val name = keyboard.text.trim()
                if (name.isEmpty() || !com.educms.player.settings.DeviceSettingDomains.validSsid(name)) {
                    entryMessage = s(R.string.net_hidden_name_needed)
                    entryError = true
                    updateField()
                    return
                }
                chosenSsid = name
                step = Step.HIDDEN_SECURITY
                render(forward = true)
            }
            else -> Unit
        }
    }

    // ── HIDDEN NETWORK: how is it secured? ─────────────────────────────

    private fun buildSecurity(): View {
        val (scroller, col) = page(scroll = true, centerVertically = tall())
        val inner = ui.column()
        col.addView(inner, LinearLayout.LayoutParams(if (ui.wide) ui.px(1240) else NetUi.MATCH, NetUi.WRAP))
        inner.addView(header(back = s(R.string.net_back), trailingClose = false), ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(28)))
        if (resumed) {
            inner.addView(ui.text(s(R.string.net_resumed), 22f, NetTheme.ACCENT_LIGHT, ui.medium, lines = 2), ui.lp(NetUi.MATCH, NetUi.WRAP, b = ui.px(16)))
        }
        inner.addView(ui.caption(s(R.string.net_add_hidden)))
        inner.addView(ui.text(s(R.string.net_choose_security, chosenSsid), 42f, NetTheme.TEXT, ui.bold, lines = 3), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(6)))
        val options = if (ui.wide) ui.row(Gravity.TOP).apply { isBaselineAligned = false } else ui.column()
        listOf(
            Triple(WifiScanPolicy.SEC_WPA2, R.string.net_sec_wpa2_title, R.string.net_sec_wpa2_sub),
            Triple(WifiScanPolicy.SEC_WPA3, R.string.net_sec_wpa3_title, R.string.net_sec_wpa3_sub),
            Triple(WifiScanPolicy.SEC_OPEN, R.string.net_sec_open_title, R.string.net_sec_open_sub),
        ).forEachIndexed { i, (security, title, sub) ->
            val card = NetControl(activity, ui, growTo = 1.04f).apply {
                orientation = LinearLayout.VERTICAL
                background = NetBoxDrawable(ui, 26f, NetTheme.CONTROL)
                setPadding(ui.px(32), ui.px(30), ui.px(32), ui.px(30))
                focusKey = "sec:$security"
                setOnClickListener { choose(chosenSsid, security, hidden = true) }
            }
            card.addView(ui.icon(if (security == WifiScanPolicy.SEC_OPEN) R.drawable.ic_net_wifi_4 else R.drawable.ic_net_lock, 44f, ui.onFocus(NetTheme.ACCENT_LIGHT, NetTheme.TEXT)))
            card.addView(ui.text(s(title), 30f, NetTheme.TEXT, ui.medium, lines = 2), ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(18)))
            card.addView(
                ui.text(s(sub), 22f, NetTheme.SUBTLE, lines = 2).apply {
                    isDuplicateParentStateEnabled = true
                    setTextColor(ui.onFocus(NetTheme.SUBTLE, NetTheme.ON_FOCUS_SUBTLE))
                },
                ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(6)),
            )
            if (ui.wide) {
                options.addView(card, LinearLayout.LayoutParams(0, NetUi.MATCH, 1f).apply {
                    if (i > 0) leftMargin = ui.px(24)
                })
            } else {
                options.addView(card, ui.lp(NetUi.MATCH, NetUi.WRAP, t = if (i == 0) 0 else ui.px(18)))
            }
        }
        inner.addView(options, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(36)))
        return scroller
    }

    // ── CONNECTING: the ONE engine ─────────────────────────────────────

    private fun connect() {
        val a = Attempt(chosenSsid, chosenSecurity, chosenHidden, previousLabel())
        attempt?.let { it.background = false; it.finished = true }
        attempt = a
        result = null
        banner = null
        step = Step.CONNECTING
        render(forward = true)
        main.removeCallbacks(stageTick)
        main.postDelayed(stageTick, NetworkScreenPolicy.STAGE_POLL_MS)
        // The password rides the request into the engine and nowhere else; the
        // screen keeps it (memory) only so a wrong one can come back KEPT.
        val password = keyboard.text.takeIf { NetworkScreenPolicy.needsPassword(a.security) }
        demo?.let { d ->
            a.id = "demo"
            d.play(main, a.ssid) { st, code -> onConnectResult(WifiConnect.Result("demo", st, code), a) }
            return
        }
        a.id = WifiConnect.connect(
            activity,
            WifiConnect.Request(ssid = a.ssid, security = a.security, hidden = a.hidden, passphrase = password),
            WifiConnect.Listener { r -> onConnectResult(r, a) },
        )
    }

    private fun onConnectResult(r: WifiConnect.Result, a: Attempt) {
        if (stopped || a.finished || r.id != a.id) return
        val words = NetworkScreenPolicy.words(r.status, r.code)
        a.words = words
        if (words == Words.WAITING_DIALOG) a.viaDialog = true
        if (r.alreadySaved) a.alreadySaved = true
        PlayerLogger.i(
            TAG,
            "join result: ${r.status}${r.code?.let { " ($it)" } ?: ""} → $words" +
                (if (a.viaDialog) " (via Android's save page)" else "") + (if (r.alreadySaved) " (already saved)" else ""),
        )
        if (r.settled) {
            refreshStatus()
            main.postDelayed({ if (!stopped) startScan() }, 2_000L)
        }
        when (NetworkScreenPolicy.outcome(words)) {
            Outcome.SUCCESS -> finishAttempt(a, ResultKind.SUCCESS, words)
            // Android took it; whether it MOVES onto it is Android's call. Watch, then say which.
            Outcome.SAVED -> watchAndroid(a)
            Outcome.WAITING ->
                // Android's approval is watched like a save (2026-10-26) — it used to wait forever.
                if (words == Words.WAITING_APPROVAL) watchAndroid(a)
                else if (step == Step.CONNECTING && !a.background) updateConnecting()
            // No password was typed for an open network: nothing to go back and fix.
            Outcome.PASSWORD -> if (!NetworkScreenPolicy.needsPassword(a.security)) finishAttempt(a, ResultKind.FAILURE, words) else {
                a.finished = true
                if (a.background) {
                    showBanner(Banner(s(R.string.net_password_wrong_banner, a.ssid), Tone.WARN))
                } else {
                    // Straight back to the password — everything typed KEPT, cursor at the end, marked.
                    chosenSsid = a.ssid
                    chosenSecurity = a.security
                    chosenHidden = a.hidden
                    keyboard = keyboard.cursorToEnd()
                    entryMessage = s(R.string.net_password_wrong)
                    entryError = true
                    step = Step.PASSWORD
                    render(forward = false)
                    focusByKey(deleteKey())
                }
            }
            Outcome.FAILURE -> finishAttempt(a, ResultKind.FAILURE, words)
        }
    }

    /**
     * Android took the network (saved, suggested, or waiting for its
     * approval). Hand over at once where waiting would be a lie
     * ([NetworkScreenPolicy.handoffNow]); otherwise watch, nudge Android's
     * network selection after a suggestion, then say which.
     */
    private fun watchAndroid(a: Attempt) {
        val st = status
        val on = NetworkScreenPolicy.onNetwork(st?.transport, st?.ssid, a.ssid)
        NetworkScreenPolicy.handoffNow(a.words, a.viaDialog, a.alreadySaved, on, st?.transport)?.let { reason ->
            finishAttempt(a, ResultKind.NOT_YET, Words.NOT_YET, reason)
            return
        }
        a.watchUntil = SystemClock.elapsedRealtime() + (demo?.watchMs ?: NetworkScreenPolicy.WATCH_JOIN_MS)
        if (demo == null && NetworkScreenPolicy.shouldNudgeScan(a.words, a.viaDialog)) {
            WifiScan.nudge(app, "after suggesting a network")
        }
        if (step == Step.CONNECTING && !a.background) updateConnecting()
        judgeStages()
    }

    /** Re-read where the join stands from what the screen can SEE; promote a watched save to success, or say it is not there yet. */
    private fun judgeStages() {
        val a = attempt ?: return
        if (a.finished) return
        val st = status
        val on = NetworkScreenPolicy.onNetwork(st?.transport, st?.ssid, a.ssid)
        val hasAddress = on == true && st?.ip != null
        if (on == true && hasAddress && venueos == null) {
            val now = SystemClock.elapsedRealtime()
            if (now - a.lastProbeAt > 4_000L) {
                a.lastProbeAt = now
                probe(force = true)
            }
        }
        a.stage = NetworkScreenPolicy.stage(on, hasAddress, if (on == true) venueos else null)
        if (step == Step.CONNECTING && !a.background) updateConnecting()
        val words = a.words
        val watchExpired = a.watchUntil > 0L && SystemClock.elapsedRealtime() >= a.watchUntil
        when (NetworkScreenPolicy.promote(words, a.stage, systemDialogUp = !hasWindowFocus(), watchExpired = watchExpired)) {
            NetworkScreenPolicy.Promotion.SUCCESS -> finishAttempt(a, ResultKind.SUCCESS, Words.CONNECTED)
            // Said once; behind the result the watch goes on until Android moves (or the person leaves).
            NetworkScreenPolicy.Promotion.NOT_YET ->
                if (!a.handedOff) finishAttempt(a, ResultKind.NOT_YET, Words.NOT_YET, NetworkScreenPolicy.NotYetReason.TIMEOUT)
            NetworkScreenPolicy.Promotion.NO_SERVER_YET ->
                if (!a.handedOff) finishAttempt(a, ResultKind.FAILURE, Words.NO_SERVER_YET)
            NetworkScreenPolicy.Promotion.NONE -> Unit
        }
    }

    private fun finishAttempt(a: Attempt, kind: ResultKind, words: Words, reason: NetworkScreenPolicy.NotYetReason? = null) {
        val state = ResultState(kind, words, a.ssid, NetworkScreenPolicy.needsPassword(a.security), a.previous, reason, a.viaDialog)
        if (state.stillWatching) {
            // "Not connected yet" is a verdict, not an end: the connection stays
            // watched behind it (the stage tick keeps running), and the big
            // check comes up by itself the moment Android moves onto it.
            a.handedOff = true
            PlayerLogger.i(TAG, "${if (kind == ResultKind.NOT_YET) "not connected yet ($reason)" else "on the network, VenueOS not reached"} — still watching")
        } else {
            a.finished = true
            main.removeCallbacks(stageTick)
        }
        if (kind == ResultKind.SUCCESS) {
            keyboard = KeyboardModel() // done with the password
            venueos = true
        }
        if (a.background) {
            val text = when (kind) {
                ResultKind.SUCCESS -> s(R.string.net_success_title, a.ssid)
                ResultKind.NOT_YET -> s(R.string.net_banner_notyet, a.ssid)
                ResultKind.FAILURE -> failureTitle(words, a.ssid)
            }
            showBanner(Banner(text, if (kind == ResultKind.SUCCESS) Tone.GOOD else Tone.WARN))
            return
        }
        result = state
        step = Step.RESULT
        render(forward = true)
        if (kind == ResultKind.SUCCESS) {
            successReturnAt = SystemClock.elapsedRealtime() + NetworkScreenPolicy.SUCCESS_RETURN_MS
            main.post(countdownTick)
        }
    }

    private fun showFailure(words: Words, ssid: String, secured: Boolean, previous: String?) {
        result = ResultState(ResultKind.FAILURE, words, ssid, secured, previous)
        step = Step.RESULT
        render(forward = true)
    }

    private fun showBanner(b: Banner) {
        banner = b
        if (step == Step.LIST) bindBanner()
    }

    private fun buildConnecting(): View {
        val a = attempt
        val (scroller, col) = page(scroll = true, centerVertically = true)
        val inner = ui.column(Gravity.CENTER_HORIZONTAL)
        col.addView(inner, LinearLayout.LayoutParams(if (ui.wide) ui.px(980) else NetUi.MATCH, NetUi.WRAP))
        val ring = FrameLayout(activity).apply { NetUi.noClip(this) }
        ring.addView(SpinnerView(activity, ui, 9f, NetTheme.ACCENT_LIGHT), LayoutParams(ui.px(184), ui.px(184)))
        ring.addView(
            ui.icon(R.drawable.ic_net_wifi_4, 76f, NetTheme.TEXT).apply {
                layoutParams = LayoutParams(ui.px(76), ui.px(76), Gravity.CENTER)
            },
        )
        inner.addView(ring, ui.lp(ui.px(184), ui.px(184)))
        inner.addView(
            ui.text(s(R.string.net_connecting_title, a?.ssid ?: chosenSsid), 44f, NetTheme.TEXT, ui.bold, lines = 2).apply { gravity = Gravity.CENTER },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(36)),
        )
        val stages = ui.column().apply {
            background = ui.card()
            setPadding(ui.px(40), ui.px(24), ui.px(40), ui.px(24))
        }
        val rows = mutableListOf<Triple<FrameLayout, TextView, Stage>>()
        listOf(
            Stage.JOINING to s(R.string.net_stage_join, a?.ssid ?: chosenSsid),
            Stage.ADDRESS to s(R.string.net_stage_address),
            Stage.CHECKING to s(R.string.net_stage_check),
        ).forEach { (stage, label) ->
            val line = ui.row().apply { setPadding(0, ui.px(14), 0, ui.px(14)) }
            val mark = FrameLayout(activity).apply { NetUi.noClip(this) }
            line.addView(mark, ui.lp(ui.px(40), ui.px(40), r = ui.px(22)))
            val text = ui.text(label, 28f, NetTheme.TEXT, ui.medium, lines = 2)
            line.addView(text, LinearLayout.LayoutParams(0, NetUi.WRAP, 1f))
            stages.addView(line, ui.lp(NetUi.MATCH, NetUi.WRAP))
            rows += Triple(mark, text, stage)
        }
        stageRows = rows
        inner.addView(stages, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(32)))
        connectingNote = ui.text("", 24f, NetTheme.TEXT_2, lines = 4).apply { gravity = Gravity.CENTER }.also {
            inner.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(24)))
        }
        val actions = if (ui.wide) ui.row(Gravity.CENTER) else ui.column(Gravity.CENTER_HORIZONTAL)
        actions.addView(button(s(R.string.net_stop_waiting), null, primary = false, key = "stop") { stopWaiting() })
        connectingExtra = ui.row().also {
            actions.addView(it, if (ui.wide) ui.lp(NetUi.WRAP, NetUi.WRAP, l = ui.px(24)) else ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(18)))
        }
        inner.addView(actions, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(28)))
        updateConnecting()
        return scroller
    }

    private fun updateConnecting() {
        val a = attempt ?: return
        val current = a.stage
        if (current != drawnStage) {
            drawnStage = current
            drawStages(current)
        }
        connectingNote?.text = when (a.words) {
            Words.WAITING_DIALOG -> s(R.string.net_wait_dialog, a.ssid)
            // Android 11 shows its one-time "allow suggested networks?" prompt over this screen; name the right answer.
            Words.WAITING_APPROVAL -> s(R.string.net_result_waiting_approval) + "\n" + s(R.string.net_wait_suggestion_allow)
            Words.SAVED, Words.SUGGESTED ->
                if (a.viaDialog) s(R.string.net_wait_android_dialog)
                else s(R.string.net_wait_android) + "\n" + s(R.string.net_wait_suggestion_allow)
            Words.JOINING -> s(R.string.net_wait_proof, a.previous ?: s(R.string.net_previous_network))
            else -> ""
        }
        connectingNote?.visibility = if (connectingNote?.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        // The plan's second step, while it waits (Android's approval prompt may never show on a signage ROM).
        val extra = a.words?.let { NetworkScreenPolicy.plan(it, NetworkScreenPolicy.needsPassword(a.security)).secondary }
            ?.takeIf { a.words?.let(NetworkScreenPolicy::outcome) == Outcome.WAITING }
        if (extra != drawnExtra) {
            drawnExtra = extra
            connectingExtra?.removeAllViews()
            extra?.let { connectingExtra?.addView(fixButton(it, primary = false, key = "extra")) }
        }
    }

    /** The three stage marks: done ✓, the one in progress spinning, the rest waiting. */
    private fun drawStages(current: Stage) {
        stageRows.forEach { (mark, text, stage) ->
            mark.removeAllViews()
            when {
                stage.ordinal < current.ordinal || current == Stage.DONE -> {
                    mark.addView(
                        FrameLayout(activity).apply {
                            background = ui.oval(NetTheme.GOOD)
                            addView(ui.icon(R.drawable.ic_net_check, 26f, 0xFF052E1C.toInt()).apply {
                                layoutParams = LayoutParams(ui.px(26), ui.px(26), Gravity.CENTER)
                            })
                        },
                        LayoutParams(ui.px(40), ui.px(40)),
                    )
                    text.setTextColor(NetTheme.SUBTLE)
                }
                stage == current -> {
                    mark.addView(SpinnerView(activity, ui, 4.5f, NetTheme.ACCENT_LIGHT), LayoutParams(ui.px(40), ui.px(40)))
                    text.setTextColor(NetTheme.TEXT)
                }
                else -> {
                    mark.addView(View(activity).apply { background = ui.rounded(0x00000000, 999f, 2.5f, 0x40FFFFFF) }, LayoutParams(ui.px(40), ui.px(40)))
                    text.setTextColor(NetTheme.FAINT)
                }
            }
        }
    }

    /** The person stops watching; the engine finishes (or undoes) the join on its own — said on HOME. */
    private fun stopWaiting() {
        val a = attempt
        main.removeCallbacks(stageTick)
        if (a != null && !a.finished) {
            a.background = true
            banner = Banner(s(R.string.net_banner_pending, a.ssid), Tone.INFO)
        }
        keyboard = KeyboardModel() // the engine has the password; the screen lets go of it
        step = Step.LIST
        render(forward = false)
    }

    // ── RESULT ─────────────────────────────────────────────────────────

    private fun stillOn(previous: String?): String =
        if (previous == null) s(R.string.net_still_offline) else s(R.string.net_still_on, previous)

    private fun failureTitle(words: Words?, ssid: String): String = when (words) {
        Words.COULD_NOT_JOIN, Words.WRONG_PASSWORD -> s(R.string.net_fail_join_title, ssid)
        Words.NO_SERVER -> s(R.string.net_fail_server_title, ssid)
        Words.NO_SERVER_YET -> s(R.string.net_noserver_yet_title, ssid)
        Words.NOT_YET -> s(R.string.net_notyet_title)
        Words.DECLINED -> s(R.string.net_fail_declined_title)
        Words.WIFI_OFF -> s(R.string.net_fail_wifi_off_title)
        Words.NAME_TAKEN -> s(R.string.net_fail_taken_title, ssid)
        Words.NOT_SUPPORTED -> s(R.string.net_fail_unsupported_title, ssid)
        Words.ALERT -> s(R.string.net_fail_alert_title)
        else -> s(R.string.net_fail_title, ssid)
    }

    private fun failureBody(words: Words?, previous: String?, secured: Boolean): String = when (words) {
        Words.COULD_NOT_JOIN, Words.WRONG_PASSWORD ->
            s(if (secured) R.string.net_fail_join_body else R.string.net_fail_join_body_open) + " " + stillOn(previous)
        Words.NO_SERVER -> s(R.string.net_fail_server_body) + " " + stillOn(previous)
        Words.NO_SERVER_YET -> s(R.string.net_noserver_yet_body)
        Words.DECLINED -> s(R.string.net_fail_declined_body)
        Words.WIFI_OFF -> s(R.string.net_fail_wifi_off_body)
        Words.NAME_TAKEN -> s(R.string.net_fail_taken_body)
        Words.NOT_SUPPORTED -> s(R.string.net_fail_unsupported_body)
        Words.ALERT -> s(R.string.net_result_alert)
        else -> s(R.string.net_fail_body) + " " + stillOn(previous)
    }

    /**
     * "Not connected yet": WHY Android has not moved (one sentence), then
     * WHAT TO PRESS (one sentence) — Android's own Wi-Fi list, where one
     * press on the network connects. Whether the password is already there
     * depends on how the network was handed to Android: saved by its page →
     * yes; only suggested → Android may ask for it.
     */
    private fun notYetBody(r: ResultState): String {
        val why = when (r.reason) {
            NetworkScreenPolicy.NotYetReason.ALREADY_SAVED -> s(R.string.net_notyet_already, r.ssid)
            NetworkScreenPolicy.NotYetReason.ON_OTHER_WIFI -> s(R.string.net_notyet_other, r.previous ?: s(R.string.net_previous_network))
            NetworkScreenPolicy.NotYetReason.TIMEOUT, null -> s(R.string.net_notyet_timeout, r.ssid)
        }
        val how = if (r.viaDialog || r.reason == NetworkScreenPolicy.NotYetReason.ALREADY_SAVED) {
            s(R.string.net_notyet_how_saved, r.ssid)
        } else {
            s(R.string.net_notyet_how_suggested, r.ssid)
        }
        return "$why $how"
    }

    private fun buildResult(): View {
        val r = result ?: ResultState(ResultKind.FAILURE, Words.FAILED, chosenSsid, false, null)
        val (scroller, col) = page(scroll = true, centerVertically = true)
        val inner = ui.column(Gravity.CENTER_HORIZONTAL)
        col.addView(inner, LinearLayout.LayoutParams(if (ui.wide) ui.px(1040) else NetUi.MATCH, NetUi.WRAP))
        val (top, bottom, iconRes) = when (r.kind) {
            ResultKind.SUCCESS -> Triple(0xFF34D399.toInt(), 0xFF059669.toInt(), R.drawable.ic_net_check)
            // Amber, with the Wi-Fi mark: something to do, nothing broken.
            ResultKind.NOT_YET -> Triple(0xFFF59E0B.toInt(), 0xFFB45309.toInt(), R.drawable.ic_net_wifi_2)
            ResultKind.FAILURE ->
                if (r.words == Words.NOT_SUPPORTED || r.words == Words.NAME_TAKEN) Triple(0xFF64748B.toInt(), 0xFF334155.toInt(), R.drawable.ic_net_lock)
                else Triple(0xFFF59E0B.toInt(), 0xFFB45309.toInt(), R.drawable.ic_net_warning)
        }
        val badge = FrameLayout(activity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(top, bottom)).apply { shape = GradientDrawable.OVAL }
            addView(ui.icon(iconRes, 92f, if (r.kind == ResultKind.SUCCESS) 0xFF052E1C.toInt() else NetTheme.TEXT).apply {
                layoutParams = LayoutParams(ui.px(92), ui.px(92), Gravity.CENTER)
            })
        }
        inner.addView(badge, ui.lp(ui.px(184), ui.px(184)))
        if (r.kind == ResultKind.SUCCESS) {
            badge.scaleX = 0.6f
            badge.scaleY = 0.6f
            badge.animate().scaleX(1f).scaleY(1f).setDuration(320L).setInterpolator(android.view.animation.OvershootInterpolator(1.6f)).start()
        }
        val title = when (r.kind) {
            ResultKind.SUCCESS -> s(R.string.net_success_title, r.ssid)
            ResultKind.NOT_YET -> s(R.string.net_notyet_title)
            ResultKind.FAILURE -> failureTitle(r.words, r.ssid)
        }
        val body = when (r.kind) {
            ResultKind.SUCCESS -> s(R.string.net_success_body)
            ResultKind.NOT_YET -> notYetBody(r)
            ResultKind.FAILURE -> failureBody(r.words, r.previous, r.secured)
        }
        inner.addView(ui.text(title, 46f, NetTheme.TEXT, ui.bold, lines = 3).apply { gravity = Gravity.CENTER }, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(36)))
        inner.addView(ui.text(body, 28f, NetTheme.TEXT_2, lines = 5).apply { gravity = Gravity.CENTER }, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(14)))
        val plan = NetworkScreenPolicy.plan(if (r.kind == ResultKind.SUCCESS) Words.CONNECTED else (r.words ?: Words.FAILED), r.secured)
        val actions = if (ui.wide) ui.row(Gravity.CENTER) else ui.column(Gravity.CENTER_HORIZONTAL)
        actions.addView(fixButton(plan.primary, primary = true, key = "primary"))
        plan.secondary?.let { second ->
            actions.addView(
                fixButton(second, primary = false, key = "secondary"),
                if (ui.wide) ui.lp(NetUi.WRAP, NetUi.WRAP, l = ui.px(24)) else ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(18)),
            )
        }
        inner.addView(actions, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(40)))
        if (r.kind == ResultKind.SUCCESS) {
            countdownView = ui.text(s(R.string.net_returning, 3), 22f, NetTheme.SUBTLE, lines = 1).apply { gravity = Gravity.CENTER }.also {
                inner.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(22)))
            }
        }
        return scroller
    }

    /** A next-step button: the words for [fix] and what pressing it does. */
    private fun fixButton(fix: Fix, primary: Boolean, key: String): NetControl {
        val (label, icon) = when (fix) {
            Fix.OPEN_SETUP -> s(R.string.net_open_setup) to R.drawable.ic_net_settings
            Fix.LOCATION_ON -> s(R.string.net_fix_location) to R.drawable.ic_net_location
            Fix.WIFI_ON -> s(R.string.net_fix_wifi) to R.drawable.ic_net_wifi_4
            Fix.EDIT_PASSWORD -> s(R.string.net_fix_edit_password) to R.drawable.ic_net_lock
            Fix.TRY_AGAIN -> s(R.string.net_fix_try_again) to R.drawable.ic_net_refresh
            Fix.CHECK_AGAIN -> s(R.string.net_fix_check_again) to R.drawable.ic_net_refresh
            Fix.SCAN_AGAIN -> s(R.string.net_scan_again) to R.drawable.ic_net_refresh
            Fix.CHOOSE_ANOTHER -> s(R.string.net_fix_choose) to R.drawable.ic_net_wifi_4
            Fix.ANDROID_SETTINGS -> s(R.string.net_fix_android) to R.drawable.ic_net_external
            Fix.CONNECT_IN_ANDROID -> s(R.string.net_connect_in_android) to R.drawable.ic_net_external
            Fix.DONE -> s(R.string.net_done) to R.drawable.ic_net_check
        }
        return button(label, icon, primary = primary, key = key) { runFix(fix) }
    }

    private fun runFix(fix: Fix) {
        when (fix) {
            // Location access is a setup grant (2026-10-26). The checklist comes up over this
            // screen; when it closes, setupClosed() reads the grant and lists the networks. Where
            // no checklist exists on this install, Android's own dialog is the only way left.
            Fix.OPEN_SETUP -> if (demo == null) {
                val opened = runCatching { onOpenSetup() }.getOrDefault(false)
                if (!opened) PlayerLogger.i(TAG, "setup checklist unavailable — location is asked at first launch only")
            }
            Fix.LOCATION_ON -> openSystemPage(WifiScan.locationSettingsIntent())
            Fix.WIFI_ON, Fix.CONNECT_IN_ANDROID -> openWifiPicker()
            Fix.EDIT_PASSWORD -> {
                val r = result
                if (r != null) {
                    chosenSsid = r.ssid
                    chosenSecurity = attempt?.security ?: chosenSecurity
                }
                attempt?.finished = true // the watch behind "not connected yet" ends with the password it was made with
                main.removeCallbacks(stageTick)
                keyboard = keyboard.cursorToEnd()
                entryMessage = null
                entryError = true
                step = Step.PASSWORD
                render(forward = false)
                focusByKey(deleteKey())
            }
            Fix.CHECK_AGAIN -> {
                venueos = null
                probe(force = true)
                refreshStatus()
            }
            Fix.TRY_AGAIN -> {
                attempt?.let {
                    chosenSsid = it.ssid
                    chosenSecurity = it.security
                    chosenHidden = it.hidden
                }
                connect()
            }
            Fix.SCAN_AGAIN -> {
                goHome()
                startScan()
            }
            Fix.CHOOSE_ANOTHER -> goHome()
            Fix.ANDROID_SETTINGS -> openAndroidSettings()
            Fix.DONE -> if (result?.kind == ResultKind.SUCCESS) finishConnected() else goHome()
        }
    }

    private fun goHome() {
        main.removeCallbacks(countdownTick)
        // Leaving a "not connected yet" result: the engine has the network; the screen stops watching it here.
        attempt?.let { if (it.handedOff) it.finished = true }
        main.removeCallbacks(stageTick)
        keyboard = KeyboardModel()
        result = null
        step = Step.LIST
        render(forward = false)
    }

    /**
     * Android's own Wi-Fi list — the panel (Android 10+), else the full Wi-Fi
     * settings page — resolved to a system Settings app, never a browser. One
     * press on a saved network there connects: the handover for "not
     * connected yet", and the way to switch Wi-Fi on.
     */
    private fun openWifiPicker() {
        openSystemPage(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Intent(Settings.Panel.ACTION_WIFI) else Intent(Settings.ACTION_WIFI_SETTINGS),
        )
    }

    /** Success: back to where the person came from (content or the pairing code). */
    private fun finishConnected() {
        if (stopped) return
        main.removeCallbacks(countdownTick)
        onClose(REASON_CONNECTED)
    }

    // ── keys ───────────────────────────────────────────────────────────

    /**
     * Every key passes through here first: Back goes back ONE step from any
     * control, the keyboard's grid moves (and wraps) by [KeyboardNav], and a
     * hardware keyboard types into the field.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (event.action == KeyEvent.ACTION_UP) back()
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN) {
            personMoved = true
            if ((step == Step.PASSWORD || step == Step.HIDDEN_NAME) && handleEntryKey(event)) return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun handleEntryKey(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        val focused = findFocus()
        val dir = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> KeyboardNav.Dir.LEFT
            KeyEvent.KEYCODE_DPAD_RIGHT -> KeyboardNav.Dir.RIGHT
            KeyEvent.KEYCODE_DPAD_UP -> KeyboardNav.Dir.UP
            KeyEvent.KEYCODE_DPAD_DOWN -> KeyboardNav.Dir.DOWN
            else -> null
        }
        if (dir != null && focused != null) return navigateEntry(focused, dir)
        if (keyCode == KeyEvent.KEYCODE_DEL) {
            val before = keyboard
            keyboard = keyboard.deleteBack()
            afterEdit(before, typed = false)
            return true
        }
        val ch = event.unicodeChar
        if (ch in 0x20..0x7e && keyCode !in DPAD_KEYS) {
            val before = keyboard
            keyboard = keyboard.type(ch.toChar())
            afterEdit(before, typed = true)
            return true
        }
        return false
    }

    /** D-pad inside the password step: wrap-around keyboard, the cursor in the field, nothing lost. */
    private fun navigateEntry(focused: View, dir: KeyboardNav.Dir): Boolean {
        val rows = keyViews.size
        val pos = focused.getTag(R.id.net_key_pos) as? KeyboardNav.Pos
        if (pos != null && rows > 0) {
            if (dir == KeyboardNav.Dir.LEFT || dir == KeyboardNav.Dir.RIGHT) navAnchor = null
            val anchor = navAnchor ?: KeyboardNav.centreUnit2(pos, rows)
            if (dir == KeyboardNav.Dir.UP || dir == KeyboardNav.Dir.DOWN) navAnchor = anchor
            val next = KeyboardNav.move(pos, dir, rows, if (dir == KeyboardNav.Dir.UP || dir == KeyboardNav.Dir.DOWN) anchor else null)
            if (next == null) {
                // Up from the top row: the field row item over the column.
                fieldItems.getOrNull(KeyboardNav.fieldItemAt(fieldSpans, anchor))?.requestFocus()
            } else {
                keyViews.getOrNull(next.row)?.getOrNull(next.col)?.requestFocus()
            }
            return true
        }
        val index = fieldItems.indexOf(focused)
        if (index >= 0) {
            // A sideways move (the cursor, or over to Show / Clear) starts a new column:
            // Down then lands under where the person IS, not where they came up from.
            if (dir == KeyboardNav.Dir.LEFT || dir == KeyboardNav.Dir.RIGHT) navAnchor = null
            when (dir) {
                KeyboardNav.Dir.LEFT -> {
                    if (focused === field) {
                        if (keyboard.caret > 0) {
                            keyboard = keyboard.moveCursor(-1)
                            updateField()
                        }
                    } else {
                        fieldItems.getOrNull(index - 1)?.requestFocus()
                    }
                }
                KeyboardNav.Dir.RIGHT -> {
                    if (focused === field && keyboard.caret < keyboard.text.length) {
                        keyboard = keyboard.moveCursor(1)
                        updateField()
                    } else {
                        fieldItems.getOrNull(index + 1)?.requestFocus()
                    }
                }
                KeyboardNav.Dir.UP -> backControl?.requestFocus()
                KeyboardNav.Dir.DOWN -> {
                    val anchor = navAnchor ?: KeyboardNav.fieldItemCentre2(fieldSpans, index)
                    keyViews.firstOrNull()?.getOrNull(KeyboardNav.colAt(0, keyViews.size, anchor))?.requestFocus()
                }
            }
            return true
        }
        if (focused === backControl && dir == KeyboardNav.Dir.DOWN) {
            field?.requestFocus()
            return true
        }
        return false
    }

    fun back() {
        when (step) {
            Step.LIST -> onClose("back")
            Step.PASSWORD -> {
                keyboard = KeyboardModel()
                entryMessage = null
                entryError = false
                step = if (chosenHidden) Step.HIDDEN_SECURITY else Step.LIST
                render(forward = false)
            }
            Step.HIDDEN_NAME -> {
                keyboard = KeyboardModel()
                step = Step.LIST
                render(forward = false)
            }
            Step.HIDDEN_SECURITY -> {
                keyboard = KeyboardModel(text = chosenSsid, maxLength = 32)
                entryMessage = null
                entryError = false
                step = Step.HIDDEN_NAME
                render(forward = false)
            }
            Step.CONNECTING -> stopWaiting()
            Step.RESULT -> {
                val r = result
                main.removeCallbacks(countdownTick)
                if (r != null && r.kind == ResultKind.FAILURE && r.words != Words.NO_SERVER_YET && r.secured && attempt?.ssid == r.ssid) {
                    // One step back from a failed join is the password it was made with — kept.
                    // (Not from "on it, VenueOS not reached": that password was right.)
                    runFix(Fix.EDIT_PASSWORD)
                } else {
                    goHome()
                }
            }
        }
    }

    // ── focus ──────────────────────────────────────────────────────────

    /** The remote never leaves this screen for the page underneath (rule 15). */
    override fun focusSearch(focused: View?, direction: Int): View? {
        val next = runCatching { FocusFinder.getInstance().findNextFocus(this, focused, direction) }.getOrNull()
        return next ?: focused
    }

    private fun focusKeyOf(v: View): String? = when (v) {
        is NetControl -> v.focusKey
        is FieldView -> v.focusKey
        else -> null
    }

    private fun focusByKey(key: String): Boolean {
        val v = findByKey(content, key) ?: return false
        return v.requestFocus()
    }

    private fun findByKey(group: ViewGroup, key: String): View? {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (focusKeyOf(child) == key) return child
            if (child is ViewGroup) findByKey(child, key)?.let { return it }
        }
        return null
    }

    private fun focusFirst(group: ViewGroup): Boolean {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if ((child is NetControl || child is FieldView) && child.isShown && child.requestFocus()) return true
            if (child is ViewGroup && focusFirst(child)) return true
        }
        return false
    }

    private fun deleteKey(): String {
        val rows = keyboard.rows()
        val r = rows.size - 1
        return "key:$r:${rows[r].indexOf(KeyboardModel.Key.Delete)}"
    }

    /** Park the remote on a real control — never on this root (the SetupChecklistView bug). */
    private fun parkFocus() {
        main.post {
            if (stopped) return@post
            val parked = when (step) {
                Step.LIST -> {
                    parkHome()
                    true
                }
                Step.PASSWORD, Step.HIDDEN_NAME ->
                    if (entryError) focusByKey(deleteKey()) else focusByKey("key:1:0")
                Step.HIDDEN_SECURITY -> focusByKey("sec:${WifiScanPolicy.SEC_WPA2}")
                Step.CONNECTING -> focusByKey("stop")
                Step.RESULT -> focusByKey("primary")
            }
            if (!parked) focusFirst(content)
        }
    }

    // ── what the screen is on, and Android's own pages ─────────────────

    /** What the screen is on BEFORE the change — the network a failed join leaves it on (null: nothing). */
    private fun previousLabel(): String? {
        val st = status
        return when {
            st?.transport == NetworkStatusPolicy.T_WIFI && st.ssid != null -> "“${st.ssid}”"
            st?.transport == NetworkStatusPolicy.T_ETHERNET -> s(R.string.net_previous_ethernet)
            st == null || st.transport == NetworkStatusPolicy.T_NONE -> null
            else -> s(R.string.net_previous_network)
        }
    }

    private fun openAndroidSettings() {
        if (demo != null) {
            PlayerLogger.i(TAG, "demo: would open Android's network settings")
            return
        }
        onAndroidSettings()
    }

    /** Android's own page for [intent] — a system Settings app, never a browser (SettingsPagePolicy). */
    private fun openSystemPage(intent: Intent) {
        if (demo != null) {
            PlayerLogger.i(TAG, "demo: would open ${intent.action}")
            return
        }
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

    // ── builders ───────────────────────────────────────────────────────

    /** A button: icon + words, filled (primary) or quiet, with the shared focus treatment. */
    private fun button(
        label: String,
        iconRes: Int?,
        primary: Boolean,
        key: String,
        compact: Boolean = false,
        trailing: Int? = null,
        onPress: () -> Unit,
    ): NetControl = NetControl(activity, ui, growTo = if (compact) 1.06f else 1.04f).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = if (primary) {
            NetBoxDrawable(ui, 999f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM, border = 0x33FFFFFF, focusFill = 0xFF818CF8.toInt(), focusFill2 = 0xFF7C3AED.toInt())
        } else {
            NetBoxDrawable(ui, if (compact) 999f else 22f, NetTheme.CONTROL)
        }
        val padV = if (compact) 16 else 22
        setPadding(ui.px(if (compact) 26 else 30), ui.px(padV), ui.px(if (compact) 30 else 30), ui.px(padV))
        focusKey = key
        contentDescription = label
        iconRes?.let { addView(ui.icon(it, if (compact) 28f else 32f, NetTheme.TEXT), ui.lp(ui.px(if (compact) 28 else 32), ui.px(if (compact) 28 else 32), r = ui.px(14))) }
        addView(ui.text(label, if (compact) 24f else 26f, NetTheme.TEXT, ui.medium, lines = 2), LinearLayout.LayoutParams(if (trailing != null) 0 else NetUi.WRAP, NetUi.WRAP, if (trailing != null) 1f else 0f))
        trailing?.let { addView(ui.icon(it, 26f, ui.onFocus(NetTheme.SUBTLE, NetTheme.TEXT)), ui.lp(ui.px(26), ui.px(26), l = ui.px(12))) }
        setOnClickListener { onPress() }
    }
}
