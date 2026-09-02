package com.educms.player.boot

import android.app.Activity
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.educms.player.logging.PlayerLogger

/**
 * THE NATIVE DIAGNOSTIC SCREEN (2026-09-02, P0-2).
 *
 * ============================================================
 * WHY IT IS NATIVE
 * ============================================================
 *
 * Because the failure it explains is "the web player is not running".
 * Every existing recovery surface in this product is drawn by the page —
 * the reconnect panel, the stop overlay, the pairing splash — so on a box
 * whose client bundle never executed, all of them are unreachable and
 * what stays on the glass is the SERVER-RENDERED "Connecting to your
 * CMS…". That sentence is not a diagnostic; on the Android-9 Goodview
 * units it was a lie that lasted days.
 *
 * ============================================================
 * WHAT IT MAY SAY (player rule 10)
 * ============================================================
 *
 * Only what the evidence proves. It reports which of the three boot facts
 * never arrived, what two live probes actually returned (with the
 * exception class and the round-trip), whether the device clock disagrees
 * with the server's `Date`, and when this screen last registered
 * successfully. It does NOT say "the screen is frozen", "the server is
 * down", or anything else it cannot see.
 *
 * ============================================================
 * REMOTE-OPERABLE OR IT DOES NOT SHIP (player rule 15)
 * ============================================================
 *
 * Most of these panels are wall-mounted with a D-pad remote as the ONLY
 * input, and the installer standing in front of one has already lost an
 * hour. So: focus is PARKED on a real control (never on this focusable
 * root — a root that holds focus is UNPARKED, the SetupChecklistView
 * bug), every control carries the one visible highlight
 * (`applyRemoteFocus`, because OEM ROMs strip the default drawable), OK
 * on the root still fires the primary, and Back reaches the actionable
 * escape — Exit — rather than silently toggling anything.
 *
 * Style is deliberately the manager gate's / setup checklist's: a slate
 * card on the recovery overlay's own scrim, everything inside a
 * ScrollView so it still reads on a 320×1080 NovaStar poster.
 */
internal class BootDiagnosticsView(
    activity: Activity,
    /** Reload the player URL. */
    private val onRetry: () -> Unit,
    /** Open the OS network settings. */
    private val onNetworkSettings: () -> Unit,
    /** Leave to the device home screen / OEM launcher. */
    private val onExit: () -> Unit,
    /** MainActivity's `applyRemoteFocus` — the ONE highlight treatment. */
    private val decorate: (View) -> Unit,
) : FrameLayout(activity) {

    private companion object {
        const val BG = 0xFF0F172A.toInt()

        /** 90%-opaque slate — the recovery overlay's scrim, to the byte. */
        const val SCRIM = 0xE60F172A.toInt()
        const val TEXT = 0xFFFFFFFF.toInt()
        const val SUBTLE = 0xFF94A3B8.toInt()
        const val FAINT = 0xFF475569.toInt()
        const val WARN = 0xFFFBBF24.toInt()
        const val BAD = 0xFFF87171.toInt()
        const val OK = 0xFF34D399.toInt()
        const val ACCENT = 0xFF6366F1.toInt()
    }

    /** One evidence line: a label, a value, and how alarming the value is. */
    data class Line(val label: String, val value: String, val tone: Tone = Tone.NEUTRAL)

    enum class Tone { NEUTRAL, GOOD, WARN, BAD }

    private val headingView: TextView
    private val subheadView: TextView
    private val linesHolder: LinearLayout
    private val footnoteView: TextView
    private val retryButton: Button
    private val retryShell: FrameLayout
    private val networkButton: Button
    private val exitButton: Button
    private val card: LinearLayout

    /**
     * Has Back already been pressed once? The first press MOVES THE
     * SELECTION to Exit and says so; the second exits. Two presses rather
     * than one because this screen can be up while a paired panel is
     * merely slow, and a single remote key should not drop a working
     * install to the OEM launcher — but a dead key would be worse, so the
     * first press must visibly DO something (rule 15: never a silent
     * state toggle).
     */
    private var backArmed = false

    init {
        setBackgroundColor(SCRIM)
        isClickable = true
        isFocusable = true
        isFocusableInTouchMode = true

        val scroller = ScrollView(activity).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        val wrapper = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = pill(BG, dp(14))
            setPadding(dp(16), dp(22), dp(16), dp(22))
        }
        card = column

        column.addView(
            label("VENUEOS", 11f, SUBTLE, bold = true).apply { letterSpacing = 0.2f },
            lp(marginBottom = dp(8)),
        )
        headingView = label("This screen has not started playing", 20f, TEXT, bold = true)
        column.addView(headingView, lp(marginBottom = dp(4)))
        subheadView = label("", 13f, WARN)
        column.addView(subheadView, lp(marginBottom = dp(16)))

        linesHolder = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        column.addView(linesHolder, lp(marginBottom = dp(18)))

        // Primary: Retry. Same shell-behind-a-transparent-Button idiom as
        // the setup checklist — `decorate` zeroes a view's background when
        // focus leaves, which is right for a borderless control and wrong
        // for a filled call-to-action, so the shell carries the fill.
        retryButton = Button(activity).apply {
            setAllCaps(false)
            text = "Retry now"
            textSize = 15f
            setTextColor(TEXT)
            background = null
            setPadding(dp(20), dp(12), dp(20), dp(12))
            setOnClickListener { onRetry() }
        }
        decorate(retryButton)
        retryShell = FrameLayout(activity).apply {
            background = pill(ACCENT)
            addView(retryButton)
        }
        column.addView(retryShell, lpWrap(marginBottom = dp(10)))

        networkButton = Button(activity).apply {
            setAllCaps(false)
            text = "Network settings"
            textSize = 14f
            setTextColor(TEXT)
            background = null
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setOnClickListener { onNetworkSettings() }
        }
        decorate(networkButton)
        column.addView(networkButton, lpWrap(marginBottom = dp(6)))

        exitButton = Button(activity).apply {
            setAllCaps(false)
            text = "Exit to device home"
            textSize = 13f
            setTextColor(SUBTLE)
            background = null
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setOnClickListener { onExit() }
        }
        decorate(exitButton)
        column.addView(exitButton, lpWrap(marginBottom = dp(14)))

        footnoteView = label(
            "Press Back to select Exit. This screen keeps retrying on its own.",
            11f,
            FAINT,
        )
        column.addView(footnoteView, lp())

        wrapper.addView(
            column,
            LinearLayout.LayoutParams(cardWidth(), LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { gravity = Gravity.CENTER_HORIZONTAL },
        )
        scroller.addView(
            wrapper,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
        addView(scroller, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    /**
     * Card width: capped so a 4K wall does not stretch one sentence across
     * three metres, floored by the screen on a narrow LED poster where the
     * cap never binds. Recomputed on render because a kiosk that rotates
     * is not re-created (`configChanges` handles orientation).
     */
    private fun cardWidth(): Int {
        val screen = resources.displayMetrics.widthPixels
        val available = screen - dp(24)
        return minOf(available, dp(560).coerceAtLeast(dp(160)))
    }

    /** Re-render from a fresh snapshot. Safe to call repeatedly. */
    fun render(heading: String, subhead: String, lines: List<Line>) {
        (card.layoutParams as? LinearLayout.LayoutParams)?.let { params ->
            val wanted = cardWidth()
            if (params.width != wanted) {
                params.width = wanted
                card.layoutParams = params
            }
        }
        headingView.text = heading
        subheadView.text = subhead
        subheadView.visibility = if (subhead.isBlank()) View.GONE else View.VISIBLE

        linesHolder.removeAllViews()
        lines.forEach { linesHolder.addView(buildLine(it), lp(marginBottom = dp(6))) }

        // Rebuilding drops focus. Park it on a control the remote can
        // actually press — never on this root, which is focusable only so
        // it can CONTAIN keys (see [parkFocus]).
        if (!isFocusParked()) parkFocus()
    }

    /**
     * Is the selection on something a remote can operate? A focusable root,
     * the ScrollView, or a detached child all count as UNPARKED — the
     * distinction that two brand-new units failed install over.
     */
    private fun isFocusParked(): Boolean {
        val focused = findFocus() ?: return false
        if (focused.parent == null) return false
        return focused === retryButton || focused === networkButton || focused === exitButton
    }

    /**
     * ⚠️ `requestFocus()` RETURNS A BOOLEAN AND IT IS LOAD-BEARING — it
     * fails silently in touch mode against a view that is not
     * `focusableInTouchMode` (field report G65-B). Every rung is tested and
     * the chain falls through on false.
     */
    private fun parkFocus(prefer: View? = null): Boolean {
        if (prefer != null && prefer.visibility == View.VISIBLE && prefer.requestFocus()) return true
        if (retryButton.requestFocus()) return true
        if (networkButton.requestFocus()) return true
        if (exitButton.requestFocus()) return true
        PlayerLogger.w(
            "BootDiagnostics",
            "no diagnostic control accepted focus — the remote may not be able to operate this card",
        )
        // The root is NOT a parking place; it is key CONTAINMENT. With focus
        // outside this overlay the WebView underneath takes the remote and
        // Back stops reaching dispatchKeyEvent.
        if (findFocus() !== this) requestFocus()
        return false
    }

    /**
     * Back must reach the actionable escape and must never be a silent
     * toggle. First press: select Exit, say so on the card. Second press:
     * exit. OK/Enter on the root fires Retry, so an OEM focus quirk that
     * strands focus on the root still leaves the remote able to act.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            if (backArmed) {
                PlayerLogger.i("BootDiagnostics", "back-press (2nd) — exiting to device home")
                onExit()
                return true
            }
            backArmed = true
            parkFocus(exitButton)
            footnoteView.text = "Press Back again to exit to the device home screen."
            footnoteView.setTextColor(WARN)
            PlayerLogger.i("BootDiagnostics", "back-press — Exit selected, awaiting confirmation")
            return true
        }
        if ((event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) &&
            event.action == KeyEvent.ACTION_UP &&
            findFocus() === this
        ) {
            retryButton.performClick()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // ─────────────────────────────────────────────────────────────────

    private fun buildLine(line: Line): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        row.addView(
            label(line.label, 12f, SUBTLE).apply { gravity = Gravity.START },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.42f),
        )
        val tone = when (line.tone) {
            Tone.GOOD -> OK
            Tone.WARN -> WARN
            Tone.BAD -> BAD
            Tone.NEUTRAL -> TEXT
        }
        row.addView(
            label(line.value, 12f, tone).apply { gravity = Gravity.START },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.58f),
        )
        return row
    }

    private fun label(
        text: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
    ): TextView = TextView(context).apply {
        this.text = text
        textSize = sizeSp
        setTextColor(color)
        gravity = Gravity.CENTER_HORIZONTAL
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun lp(marginBottom: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = marginBottom }

    private fun lpWrap(marginBottom: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
            bottomMargin = marginBottom
            gravity = Gravity.CENTER_HORIZONTAL
        }

    private fun pill(color: Int, radiusPx: Int = dp(10)): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radiusPx.toFloat()
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
