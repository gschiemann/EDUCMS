package com.educms.player.usb

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Layout
import android.view.FocusFinder
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.educms.player.R
import com.educms.player.display.DisplayEmergency
import com.educms.player.led.LedCanvasHost
import com.educms.player.logging.PlayerLogger
import com.educms.player.network.NetBoxDrawable
import com.educms.player.network.NetControl
import com.educms.player.network.NetTheme
import com.educms.player.network.NetUi
import com.educms.player.network.NetworkLayout
import com.educms.player.network.SpinnerView
import java.lang.ref.WeakReference
import java.util.Locale

/**
 * THE USB CARD (2026-10-26, M43 on site: "inserted a USB … and nothing
 * happens"). What the screen is doing with a stick, in plain words, on the
 * glass — the same design language as VenueOS's Network screen (deep navy,
 * fully opaque, 10-ft type, a badge that says the state at a glance).
 *
 *  • Working: "USB drive found — reading…", then the copy with live progress.
 *  • Done: "Playing <playlist> from USB" — a check that closes by itself.
 *  • A problem: one sentence and the fix on the focused button (Allow, Look
 *    again, Network settings). A problem card also closes by itself after
 *    [UsbImportPolicy.PROBLEM_CLOSE_MS], so a screen nobody stands at goes
 *    back to its content; a key press restarts that wait.
 *
 * REMOTE-ONLY (player rule 15): focus is PARKED on the fix (or Close) and
 * cannot escape to the page underneath ([focusSearch]); Back always closes the
 * card; touch works too (NetControl acts on the first tap).
 *
 * ⚠️ AN ALERT OUTRANKS IT: it never opens during an emergency hold, and it
 * leaves the glass the instant one starts (a change listener on the hold plus
 * a [UsbImportPolicy.EMERGENCY_POLL_MS] poll). The import itself carries on
 * in the background — it never touches the display.
 */
object UsbImportCard {
    private const val TAG = "UsbImportCard"
    internal const val REASON_ALERT = "an emergency hold started"

    // The one card: attached to the Activity's content view and dropped
    // (removed + nulled) in hide(), which the Activity also calls on destroy.
    @SuppressLint("StaticFieldLeak")
    private var card: UsbCardView? = null
    private var owner: WeakReference<Activity>? = null
    private var restoreFocus: WeakReference<View>? = null

    fun isShowing(): Boolean = card != null

    fun stage(): UsbStage? = card?.current?.stage

    /**
     * Put [state] on the glass, or move the open card to it. Main thread.
     * False when it may not show (an alert is held, the Activity is going).
     */
    fun show(activity: Activity, state: UsbCardState, onAction: (UsbAction, UsbCardState) -> Unit): Boolean {
        val held = runCatching { DisplayEmergency.isHeld(activity.applicationContext) }.getOrDefault(true)
        if (!UsbImportPolicy.mayShow(held)) {
            hide(REASON_ALERT)
            return false
        }
        if (activity.isFinishing || activity.isDestroyed) return false
        // A card left on an Activity that is going away is not the one on the glass.
        if (card != null && owner?.get() !== activity) hide("a new host")
        card?.let { open ->
            open.bind(state)
            open.bringToFront()
            return true
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
        restoreFocus = activity.currentFocus?.let { WeakReference(it) }
        val view = UsbCardView(activity, onAction) { reason -> hide(reason) }
        root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // On an LED poster: top-left at the LED canvas, never centred off the glass. No-op elsewhere.
        LedCanvasHost.pin(view)
        view.bringToFront()
        card = view
        owner = WeakReference(activity)
        view.start(state)
        PlayerLogger.i(TAG, "shown: ${state.stage}")
        return true
    }

    /** Take it down and give the remote back to what had it. Main thread. */
    fun hide(reason: String) {
        val view = card ?: return
        card = null
        owner = null
        view.stop()
        runCatching { (view.parent as? ViewGroup)?.removeView(view) }
        PlayerLogger.i(TAG, "closed ($reason)")
        restoreFocus?.get()?.let { previous -> if (previous.isAttachedToWindow) previous.requestFocus() }
        restoreFocus = null
    }

    /** The Activity is being destroyed: drop its card, never a newer Activity's. */
    fun detach(activity: Activity) {
        if (card != null && owner?.get() === activity) hide("host destroyed")
    }

    /** Back reached the Activity while the card is up. True = handled. */
    fun back(): Boolean {
        if (card == null) return false
        hide("back")
        return true
    }

    /** The drive was pulled out: a problem about it is no longer on the screen's mind. */
    fun driveRemoved() {
        val s = stage() ?: return
        if (s.problem && s != UsbStage.NO_DRIVE && s != UsbStage.READ_FAILED) hide("the drive was removed")
    }
}

/** The card's views. One instance per open; nothing outlives [stop]. */
@SuppressLint("ViewConstructor") // built in code only, never inflated
internal class UsbCardView(
    private val activity: Activity,
    private val onAction: (UsbAction, UsbCardState) -> Unit,
    private val onClose: (String) -> Unit,
) : FrameLayout(activity) {

    private companion object {
        const val PLAYER_PREFS = "edu_player"
    }

    var current: UsbCardState? = null
        private set

    private val app: Context = activity.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var ui = NetUi(activity, NetworkLayout.metrics(LedCanvasHost.viewportWidthPx(activity), LedCanvasHost.viewportHeightPx(activity)))
    private val content = FrameLayout(activity)
    private var stopped = false

    // Updated in place while copying (never rebuilt per file).
    private var progressBar: ProgressLine? = null
    private var progressText: TextView? = null
    private var footer: TextView? = null
    private var closeAtMs = 0L

    private val prefs: SharedPreferences = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
    private val holdListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == null || key.startsWith("display_emergency_hold")) checkHold()
    }
    private val holdPoll = object : Runnable {
        override fun run() {
            if (stopped || checkHold()) return
            main.postDelayed(this, UsbImportPolicy.EMERGENCY_POLL_MS)
        }
    }
    private val closeTick = object : Runnable {
        override fun run() {
            if (stopped || closeAtMs == 0L) return
            val left = closeAtMs - SystemClock.elapsedRealtime()
            if (left <= 0L) {
                onClose("closed by itself")
                return
            }
            if (current?.stage == UsbStage.IMPORTED) footer?.text = s(R.string.usb_closing, ((left + 999L) / 1000L).toInt())
            main.postDelayed(this, 250L)
        }
    }

    init {
        isClickable = true // touches meant for the content behind stay off it
        isFocusable = false
        NetUi.noClip(this)
        addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        NetUi.noClip(content)
        paintBackground(LedCanvasHost.viewportWidthPx(activity), LedCanvasHost.viewportHeightPx(activity))
    }

    // ── lifecycle ──────────────────────────────────────────────────────

    fun start(state: UsbCardState) {
        prefs.registerOnSharedPreferenceChangeListener(holdListener)
        main.postDelayed(holdPoll, UsbImportPolicy.EMERGENCY_POLL_MS)
        bind(state)
    }

    fun stop() {
        stopped = true
        runCatching { prefs.unregisterOnSharedPreferenceChangeListener(holdListener) }
        main.removeCallbacksAndMessages(null)
    }

    /** ⚠️ The alert wins: true = a hold is in force and the card is closing. */
    private fun checkHold(): Boolean {
        if (stopped) return true
        val held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
        if (!UsbImportPolicy.mayShow(held)) {
            onClose(UsbImportCard.REASON_ALERT)
            return true
        }
        return false
    }

    /** Move to [state]: a new stage is redrawn; more progress on the same copy updates in place. */
    fun bind(state: UsbCardState) {
        if (stopped) return
        val before = current
        current = state
        val sameScene = before != null && before.stage == state.stage && before.playlist == state.playlist &&
            before.sameVersion == state.sameVersion
        if (sameScene && state.stage == UsbStage.COPYING) {
            updateProgress(state)
            return
        }
        if (sameScene) return
        render(state, animate = before == null || before.stage != state.stage)
        scheduleClose(state.stage)
    }

    private fun scheduleClose(stage: UsbStage) {
        main.removeCallbacks(closeTick)
        val after = UsbImportPolicy.closesAfterMs(stage)
        if (after == null) {
            closeAtMs = 0L
            return
        }
        closeAtMs = SystemClock.elapsedRealtime() + after
        main.post(closeTick)
    }

    // ── keys ───────────────────────────────────────────────────────────

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (event.action == KeyEvent.ACTION_UP) onClose("back")
            return true
        }
        // A person is reading it: a problem card waits for them.
        if (event.action == KeyEvent.ACTION_DOWN && current?.stage?.problem == true) scheduleClose(current!!.stage)
        return super.dispatchKeyEvent(event)
    }

    /** The remote never leaves this card for the page underneath (rule 15). */
    override fun focusSearch(focused: View?, direction: Int): View? {
        val next = runCatching { FocusFinder.getInstance().findNextFocus(this, focused, direction) }.getOrNull()
        return next ?: focused
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0 || stopped) return
        paintBackground(w, h)
        val m = NetworkLayout.metrics(w, h)
        if (m != ui.metrics) {
            // Rotated, or the first real measure differs from the display's: same state, new layout.
            ui = NetUi(activity, m)
            current?.let { st -> post { if (!stopped) render(st, animate = false) } }
        }
    }

    // ── drawing ────────────────────────────────────────────────────────

    private fun paintBackground(w: Int, h: Int) {
        val base = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(NetTheme.BG_TOP, NetTheme.BG_MID, NetTheme.BG_BOTTOM),
        )
        val glow = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            colors = intArrayOf(NetTheme.BG_GLOW, 0x006366F1)
            setGradientCenter(0.5f, 0.0f)
            gradientRadius = maxOf(w, h) * 0.6f
        }
        val glow2 = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            colors = intArrayOf(NetTheme.BG_GLOW_2, 0x008B5CF6)
            setGradientCenter(0.5f, 1.05f)
            gradientRadius = maxOf(w, h) * 0.5f
        }
        // Fully opaque (the base): nothing of the page underneath shows through.
        background = LayerDrawable(arrayOf(base, glow, glow2))
    }

    private fun s(id: Int, vararg args: Any): String = runCatching { activity.getString(id, *args) }.getOrDefault("")

    private fun render(state: UsbCardState, animate: Boolean) {
        progressBar = null
        progressText = null
        footer = null
        val page = build(state)
        content.removeAllViews()
        content.addView(page, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        if (animate) {
            page.alpha = 0f
            page.translationY = ui.pxf(24f)
            page.animate().alpha(1f).translationY(0f).setDuration(220L).setInterpolator(DecelerateInterpolator()).start()
        }
        if (state.stage == UsbStage.COPYING) updateProgress(state)
        parkFocus()
    }

    private fun build(state: UsbCardState): View {
        val col = ui.column(Gravity.CENTER)
        col.setPadding(ui.gutter, ui.px(40), ui.gutter, ui.px(40))
        val panel = ui.column(Gravity.CENTER_HORIZONTAL).apply {
            background = ui.card()
            setPadding(ui.px(if (ui.wide) 72 else 44), ui.px(60), ui.px(if (ui.wide) 72 else 44), ui.px(52))
        }
        col.addView(panel, LinearLayout.LayoutParams(if (ui.wide) ui.px(1160) else NetUi.MATCH, NetUi.WRAP))

        panel.addView(badge(state.stage), ui.lp(ui.px(184), ui.px(184)))
        panel.addView(
            ui.caption(s(R.string.usb_caption)).apply { gravity = Gravity.CENTER },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(34)),
        )
        panel.addView(
            ui.text(title(state), if (ui.wide) 52f else 46f, NetTheme.TEXT, ui.bold, lines = 3).apply {
                gravity = Gravity.CENTER
                balanced()
            },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(12)),
        )
        panel.addView(
            ui.text(body(state), 29f, NetTheme.TEXT_2, lines = 4).apply {
                gravity = Gravity.CENTER
                setLineSpacing(0f, 1.12f)
                balanced()
            },
            ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(16)),
        )
        if (state.stage == UsbStage.COPYING) {
            val bar = ProgressLine(activity, ui)
            progressBar = bar
            panel.addView(bar, ui.lp(NetUi.MATCH, ui.px(16), t = ui.px(40)))
            progressText = ui.text("", 24f, NetTheme.SUBTLE, ui.medium, lines = 1).apply { gravity = Gravity.CENTER }.also {
                panel.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(16)))
            }
        }
        val actions = if (ui.wide) ui.row(Gravity.CENTER) else ui.column(Gravity.CENTER_HORIZONTAL)
        UsbImportPolicy.actions(state.stage).forEachIndexed { i, action ->
            val b = button(action, state, primary = i == 0 && action != UsbAction.CLOSE)
            val lp = when {
                i == 0 -> ui.lp(NetUi.WRAP, NetUi.WRAP)
                ui.wide -> ui.lp(NetUi.WRAP, NetUi.WRAP, l = ui.px(24))
                else -> ui.lp(NetUi.WRAP, NetUi.WRAP, t = ui.px(18))
            }
            actions.addView(b, lp)
        }
        panel.addView(actions, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(44)))
        footer = ui.text(
            if (state.stage == UsbStage.IMPORTED) s(R.string.usb_closing, (UsbImportPolicy.IMPORTED_CLOSE_MS / 1000L).toInt()) else s(R.string.usb_hint),
            22f, NetTheme.FAINT, lines = 2,
        ).apply { gravity = Gravity.CENTER }.also {
            panel.addView(it, ui.lp(NetUi.MATCH, NetUi.WRAP, t = ui.px(28)))
        }
        return scroller(col)
    }

    /** The round badge that says the state at a glance; a spinning ring while working. */
    private fun badge(stage: UsbStage): View {
        val size = ui.px(184)
        if (stage.working) {
            val ring = FrameLayout(activity).apply { NetUi.noClip(this) }
            ring.addView(
                View(activity).apply { background = ui.oval(0x1F6366F1) },
                LayoutParams(size, size),
            )
            ring.addView(SpinnerView(activity, ui, 9f, NetTheme.ACCENT_LIGHT), LayoutParams(size, size))
            ring.addView(
                ui.icon(R.drawable.ic_usb_drive, 84f, NetTheme.TEXT).apply {
                    layoutParams = LayoutParams(ui.px(84), ui.px(84), Gravity.CENTER)
                },
            )
            return ring
        }
        val (top, bottom, icon, tint) = when (stage) {
            UsbStage.IMPORTED -> Look(0xFF34D399.toInt(), 0xFF059669.toInt(), R.drawable.ic_net_check, 0xFF052E1C.toInt())
            UsbStage.NEEDS_ACCESS, UsbStage.NO_ACCESS_PAGE -> Look(NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM, R.drawable.ic_net_lock, NetTheme.TEXT)
            UsbStage.NO_DRIVE, UsbStage.NO_PACKAGE -> Look(0xFF64748B.toInt(), 0xFF334155.toInt(), R.drawable.ic_usb_drive, NetTheme.TEXT)
            UsbStage.WAITING_KEY -> Look(NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM, R.drawable.ic_net_wifi_off, NetTheme.TEXT)
            else -> Look(0xFFF59E0B.toInt(), 0xFFB45309.toInt(), R.drawable.ic_net_warning, NetTheme.TEXT)
        }
        val badge = FrameLayout(activity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(top, bottom)).apply { shape = GradientDrawable.OVAL }
            addView(
                ui.icon(icon, 88f, tint).apply { layoutParams = LayoutParams(ui.px(88), ui.px(88), Gravity.CENTER) },
            )
        }
        if (stage == UsbStage.IMPORTED) {
            badge.scaleX = 0.6f
            badge.scaleY = 0.6f
            badge.animate().scaleX(1f).scaleY(1f).setDuration(320L).setInterpolator(OvershootInterpolator(1.6f)).start()
        }
        return badge
    }

    private data class Look(val top: Int, val bottom: Int, val icon: Int, val tint: Int)

    /** Even lines, no hyphens: a two-line title never leaves one word alone on the second line. */
    private fun TextView.balanced() {
        breakStrategy = Layout.BREAK_STRATEGY_BALANCED
        hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
    }

    private fun name(state: UsbCardState): String = state.playlist ?: s(R.string.usb_this_playlist)

    private fun title(state: UsbCardState): String = when (state.stage) {
        UsbStage.LOOKING -> s(R.string.usb_looking_title)
        UsbStage.NO_DRIVE -> s(R.string.usb_no_drive_title)
        UsbStage.READING -> s(R.string.usb_reading_title)
        UsbStage.COPYING -> s(R.string.usb_copying_title, name(state))
        UsbStage.IMPORTED -> s(R.string.usb_imported_title, name(state))
        UsbStage.NEEDS_ACCESS -> s(R.string.usb_access_title)
        UsbStage.NO_ACCESS_PAGE -> s(R.string.usb_no_access_page_title)
        UsbStage.NO_PACKAGE -> s(R.string.usb_no_package_title)
        UsbStage.WAITING_KEY -> s(R.string.usb_waiting_key_title)
        UsbStage.OTHER_ORG -> s(R.string.usb_other_org_title)
        UsbStage.UNVERIFIED -> s(R.string.usb_unverified_title)
        UsbStage.NO_SPACE -> s(R.string.usb_no_space_title)
        UsbStage.READ_FAILED -> s(R.string.usb_read_failed_title)
    }

    private fun body(state: UsbCardState): String = when (state.stage) {
        UsbStage.LOOKING -> s(R.string.usb_looking_body)
        UsbStage.NO_DRIVE -> s(R.string.usb_no_drive_body)
        UsbStage.READING -> s(R.string.usb_reading_body)
        UsbStage.COPYING -> s(R.string.usb_copying_body)
        UsbStage.IMPORTED -> s(if (state.sameVersion) R.string.usb_imported_body_again else R.string.usb_imported_body)
        UsbStage.NEEDS_ACCESS -> s(R.string.usb_access_body, state.appLabel ?: s(R.string.usb_app_fallback))
        UsbStage.NO_ACCESS_PAGE -> s(R.string.usb_no_access_page_body)
        UsbStage.NO_PACKAGE -> s(R.string.usb_no_package_body)
        UsbStage.WAITING_KEY -> s(R.string.usb_waiting_key_body)
        UsbStage.OTHER_ORG -> s(R.string.usb_other_org_body)
        UsbStage.UNVERIFIED -> s(R.string.usb_unverified_body)
        UsbStage.NO_SPACE -> s(R.string.usb_no_space_body, size(state.neededBytes))
        UsbStage.READ_FAILED -> s(R.string.usb_read_failed_body)
    }

    private fun updateProgress(state: UsbCardState) {
        val fraction = when {
            state.bytesTotal > 0L -> state.bytesDone.toFloat() / state.bytesTotal.toFloat()
            state.filesTotal > 0 -> state.filesDone.toFloat() / state.filesTotal.toFloat()
            else -> 0f
        }
        progressBar?.fraction = fraction.coerceIn(0f, 1f)
        progressText?.text = runCatching {
            activity.resources.getQuantityString(
                R.plurals.usb_copying_progress, state.filesTotal,
                state.filesDone, state.filesTotal, size(state.bytesDone), size(state.bytesTotal),
            )
        }.getOrDefault("")
    }

    /** "12.4 MB" — one decimal under 100, none above. */
    private fun size(bytes: Long): String {
        val mb = bytes / (1024.0 * 1024.0)
        return when {
            mb >= 1024.0 -> String.format(Locale.getDefault(), "%.1f GB", mb / 1024.0)
            mb >= 100.0 -> String.format(Locale.getDefault(), "%.0f MB", mb)
            else -> String.format(Locale.getDefault(), "%.1f MB", mb)
        }
    }

    /** One action: icon + words, filled (the fix) or quiet, with the Network screen's focus treatment. */
    private fun button(action: UsbAction, state: UsbCardState, primary: Boolean): NetControl {
        val (label, icon) = when (action) {
            UsbAction.ALLOW -> s(R.string.usb_allow) to R.drawable.ic_net_external
            UsbAction.LOOK_AGAIN -> s(R.string.usb_look_again) to R.drawable.ic_net_refresh
            UsbAction.NETWORK -> s(R.string.usb_network) to R.drawable.ic_net_wifi_4
            UsbAction.CLOSE -> when (state.stage) {
                UsbStage.IMPORTED -> s(R.string.usb_ok) to R.drawable.ic_net_check
                UsbStage.NEEDS_ACCESS -> s(R.string.usb_not_now) to R.drawable.ic_net_close
                else -> s(R.string.usb_close) to R.drawable.ic_net_close
            }
        }
        return NetControl(activity, ui, growTo = 1.05f).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = if (primary) {
                NetBoxDrawable(ui, 999f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM, border = 0x33FFFFFF, focusFill = 0xFF818CF8.toInt(), focusFill2 = 0xFF7C3AED.toInt())
            } else {
                NetBoxDrawable(ui, 999f, NetTheme.CONTROL)
            }
            setPadding(ui.px(40), ui.px(24), ui.px(44), ui.px(24))
            focusKey = action.name
            contentDescription = label
            addView(ui.icon(icon, 32f, NetTheme.TEXT), ui.lp(ui.px(32), ui.px(32), r = ui.px(16)))
            addView(ui.text(label, 28f, NetTheme.TEXT, ui.medium, lines = 1))
            setOnClickListener {
                val st = current ?: state
                PlayerLogger.i("UsbImportCard", "pressed ${action.name} on ${st.stage}")
                onAction(action, st)
            }
        }
    }

    /** Park the remote on the first action — never on this root (the SetupChecklistView bug). */
    private fun parkFocus() {
        main.post {
            if (stopped) return@post
            if (!focusFirst(content)) PlayerLogger.w("UsbImportCard", "no control took focus")
        }
    }

    private fun focusFirst(group: ViewGroup): Boolean {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child is NetControl && child.isShown && child.requestFocus()) return true
            if (child is ViewGroup && focusFirst(child)) return true
        }
        return false
    }

    /** A viewport for short LED canvases: the card scrolls instead of being cut off; focus glow is never clipped. */
    private fun scroller(inner: View): View {
        val sv = ScrollView(activity).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            clipToPadding = false
            clipChildren = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(inner, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        return FrameLayout(activity).apply {
            clipChildren = true
            addView(sv, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
    }
}

/** The copy's progress: a rounded track with an indigo → violet fill. Redraws only when it moves. */
@SuppressLint("ViewConstructor") // built in code only, never inflated
internal class ProgressLine(context: Context, private val ui: NetUi) : View(context) {
    var fraction: Float = 0f
        set(value) {
            if (value == field) return
            field = value
            invalidate()
        }

    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x24FFFFFF }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private var shaderWidth = -1

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onDraw(canvas: Canvas) {
        val h = height.toFloat()
        val r = h / 2f
        rect.set(0f, 0f, width.toFloat(), h)
        canvas.drawRoundRect(rect, r, r, track)
        if (fraction <= 0f) return
        if (shaderWidth != width) {
            fill.shader = LinearGradient(0f, 0f, width.toFloat(), 0f, NetTheme.PRIMARY_TOP, NetTheme.PRIMARY_BOTTOM, Shader.TileMode.CLAMP)
            shaderWidth = width
        }
        rect.set(0f, 0f, maxOf(h, width * fraction), h)
        canvas.drawRoundRect(rect, r, r, fill)
    }
}
