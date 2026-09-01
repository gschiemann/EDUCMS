package com.educms.player.setup

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
 * SetupChecklist — the ONE screen the first-boot grants live on.
 *
 * WHY THIS EXISTS (operator, 2026-08-25, after walking a real panel
 * through the v1 ceremony): *"the buttons to allow permissions are all
 * over the place, not even in a consistent menu, and one menu wasnt even
 * visible i had to guess where all admin permissions was …. why cant we
 * pop one menu where we quickly check everything we want and then it
 * auto configures everything …. i get it its only one time but its a lot
 * for an end user."*
 *
 * ⚠️ BE HONEST ABOUT THE CEILING. Android does not let a sideloaded app
 * grant install-unknown-apps, WRITE_SETTINGS, battery exemption,
 * device-admin or the HOME default from one dialog — not from ours, not
 * from anyone's — without DEVICE-OWNER provisioning, which needs a
 * factory reset per screen and is off the table for this fleet (every
 * deployed box already carries the vendor's owner). Each grant is its
 * own system Activity that a human has to visit. This screen does NOT
 * change that and must never be described as if it did.
 *
 * WHAT IT DOES FIX — the half that was actually ours. v1 sent the
 * operator to six vendor Settings pages with nothing tying them
 * together, so when one page turned out to be hidden on that panel they
 * were left guessing with nowhere to return to. This is a persistent
 * HOME BASE: every grant on one list, live status re-read on every
 * resume, a progress count, the next one armed, and a generic "can't
 * find it?" path under the armed row. Every Settings round-trip lands
 * back HERE, in the same place, one row further along.
 *
 * STYLE. Deliberately the same idiom as the manager-install gate and
 * the recovery overlay in `activity_main.xml` — a slate #0F172A card on
 * the recovery overlay's own #E60F172A scrim, small type, everything
 * inside a ScrollView so it still reads on a 320×1080 NovaStar poster
 * (the clipped-install-dialog bug from v1.0.56). A SCRIM and not a
 * blackout on purpose: on first boot the WebView underneath is showing
 * the PAIRING CODE the operator has to type into the dashboard, and
 * after that it is live signage. Views are built in code rather than XML
 * so the whole surface stays inside the `setup` package instead of
 * spreading across a layout file, a binding and MainActivity.
 *
 * This class is pure presentation: it renders a
 * [SetupCeremonyMath.ChecklistModel] and reports taps. Every decision
 * about what a row says, which one is armed, and whether the screen
 * should be up at all lives in [SetupCeremonyMath] / [SetupCeremony].
 */
internal class SetupChecklistView(
    activity: Activity,
    /** Operator asked to run this step's grant. */
    private val onGrant: (String) -> Unit,
    /** The explicit "Not now" / Done button. */
    private val onSecondary: () -> Unit,
    /**
     * The remote's Back key. Split from [onSecondary] 2026-08-30 (field
     * install): Back used to run the same advance-past-the-armed-step
     * semantics as "Not now", so on a panel where the remote could not
     * operate the list, every escape press silently burned a step until
     * the ceremony stopped appearing — with the corner-hold re-entry
     * being TOUCH-only. Back now only hides for the session; the armed
     * step is unchanged and re-offers on the next boot.
     */
    private val onBack: () -> Unit,
    /**
     * MainActivity's `applyRemoteFocus`, handed in rather than
     * duplicated: OEM signage ROMs strip the default focus-highlight
     * drawable, so a D-pad remote gets no feedback and the screen looks
     * dead. One implementation, applied to every focusable thing here.
     */
    private val decorate: (View) -> Unit,
) : FrameLayout(activity) {

    private companion object {
        // Palette lifted from the existing kiosk overlays so setup does
        // not look like a different product than the gate that precedes it.
        const val BG = 0xFF0F172A.toInt()

        /** 90%-opaque slate — the recovery overlay's scrim, to the byte. */
        const val SCRIM = 0xE60F172A.toInt()
        const val TEXT = 0xFFFFFFFF.toInt()
        const val SUBTLE = 0xFF94A3B8.toInt()
        const val FAINT = 0xFF475569.toInt()
        const val WARN = 0xFFFBBF24.toInt()
        const val OK = 0xFF34D399.toInt()
        const val ACCENT = 0xFF6366F1.toInt()

        /**
         * Status glyphs. `✓` and `○` are near-universal; the operator's
         * brief asked for `➜` on the armed row but that dingbat is
         * missing from some stripped OEM font sets — `→` renders
         * everywhere and reads identically.
         */
        const val GLYPH_GRANTED = "✓"
        const val GLYPH_CURRENT = "→"
        const val GLYPH_NEEDED = "○"
    }

    private val rowsHolder: LinearLayout
    private val headingView: TextView
    private val progressView: TextView
    private val countdownView: TextView
    private val footnoteView: TextView
    private val primaryButton: Button
    private val primaryShell: FrameLayout
    private val secondaryButton: Button
    private val card: LinearLayout

    init {
        // A SCRIM, not a blackout — same treatment as the recovery
        // overlay in activity_main.xml. On first boot the WebView behind
        // this is showing the PAIRING CODE the operator has to type into
        // the dashboard, and later it is live signage; a full-bleed panel
        // would hide both. The card is what they read; the screen keeps
        // showing what it was showing.
        setBackgroundColor(SCRIM)
        // Swallow every touch + key: the WebView is still alive underneath
        // and must not receive taps meant for setup.
        isClickable = true
        isFocusable = true
        isFocusableInTouchMode = true

        val scroller = ScrollView(activity).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        // fillViewport + a centred wrapper is what vertically centres the
        // card when it is short, and lets it scroll when it is not —
        // the 320×1080 NovaStar poster case (v1.0.56's clipped dialog).
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
            label("VENUEOS", 11f, SUBTLE, bold = true).apply {
                letterSpacing = 0.2f
            },
            lp(marginBottom = dp(8)),
        )
        headingView = label(SetupCeremonyMath.HEADING_GRANTING, 21f, TEXT, bold = true)
        column.addView(headingView, lp(marginBottom = dp(4)))

        progressView = label("", 13f, SUBTLE)
        column.addView(progressView, lp(marginBottom = dp(18)))

        rowsHolder = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        column.addView(rowsHolder, lp(marginBottom = dp(20)))

        // Primary action. The Button's own background is cleared and a
        // shell behind it carries the fill, because `decorate` zeroes a
        // view's background when focus leaves it — correct for the
        // borderless dialog buttons it was written for, wrong for a
        // filled call-to-action. Shell keeps the fill, decorate keeps
        // the one focus treatment.
        primaryButton = Button(activity).apply {
            setAllCaps(false)
            textSize = 15f
            setTextColor(TEXT)
            background = null
            setPadding(dp(20), dp(12), dp(20), dp(12))
            setOnClickListener { primaryKey?.let(onGrant) }
        }
        decorate(primaryButton)
        primaryShell = FrameLayout(activity).apply {
            background = pill(ACCENT)
            addView(primaryButton)
        }
        column.addView(primaryShell, lpWrap(marginBottom = dp(10)))

        secondaryButton = Button(activity).apply {
            setAllCaps(false)
            textSize = 13f
            setTextColor(SUBTLE)
            background = null
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setOnClickListener { onSecondary() }
        }
        decorate(secondaryButton)
        column.addView(secondaryButton, lpWrap(marginBottom = dp(16)))

        // The self-closing countdown (2026-09-01). Its own view, updated in
        // place by [updateCountdown], because the alternative — a full
        // re-render once a second — rebuilds every row, and rebuilding rows
        // is what DROPS FOCUS on a remote-only panel. A card that stole the
        // selection back to the top every second would be unusable with a
        // D-pad, which is the input most of these screens have.
        countdownView = label("", 12f, WARN).apply { visibility = View.GONE }
        column.addView(countdownView, lp(marginBottom = dp(10)))

        // The footnote is now MODEL-DRIVEN (v1.1.6). On the completion card
        // it is the only thing on screen that says how to get back here, and
        // that card auto-dismisses — so it must never be a hard-coded string
        // that describes a different state than the one being shown.
        footnoteView = label(SetupCeremonyMath.FOOTNOTE_GRANTING, 11f, FAINT)
        column.addView(footnoteView, lp())

        wrapper.addView(
            column,
            LinearLayout.LayoutParams(
                cardWidth(),
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { gravity = Gravity.CENTER_HORIZONTAL },
        )
        scroller.addView(
            wrapper,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
        addView(
            scroller,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
    }

    /**
     * Card width: capped so a 4K wall does not stretch one sentence
     * across three metres, floored by the screen on a narrow LED poster
     * where the cap never binds. Recomputed on every render because a
     * kiosk that changes orientation is not re-created (MainActivity
     * handles `orientation` in `configChanges`), so a rebuild is the only
     * moment we get to re-measure.
     */
    private fun cardWidth(): Int {
        val screen = resources.displayMetrics.widthPixels
        val available = screen - dp(24)
        return minOf(available, dp(520)).coerceAtLeast(dp(160))
    }

    /** Key the primary button currently fires. Null in PAUSED/COMPLETE. */
    private var primaryKey: String? = null

    /**
     * Re-render from live state. Called on every resume — the whole
     * point of the screen is that a grant made in Settings is reflected
     * the moment the operator comes back.
     */
    fun render(model: SetupCeremonyMath.ChecklistModel) {
        (card.layoutParams as? LinearLayout.LayoutParams)?.let { params ->
            val wanted = cardWidth()
            if (params.width != wanted) {
                params.width = wanted
                card.layoutParams = params
            }
        }
        // WHICH ROW the operator was on, read BEFORE the rebuild below
        // destroys it. Read off the view's tag rather than a focus listener
        // because `decorate` owns the rows' OnFocusChangeListener — that is
        // the visible highlight, and a second listener would silently
        // replace it (a row nobody can see is selected is the same failure
        // as a row nobody can select).
        val focusedRowKey = findFocus()?.tag as? String

        headingView.text = model.heading
        headingView.setTextColor(
            if (model.mode == SetupCeremonyMath.ChecklistMode.COMPLETE) OK else TEXT,
        )
        progressView.text = model.progress
        // AMBER when advanced grants are still outstanding: on the completion
        // card this line is the whole correction to "Setup complete ✓", and a
        // grey sub-line under a green heading is not read.
        progressView.setTextColor(if (model.optionalOutstanding > 0) WARN else SUBTLE)
        // Model-driven, so a card that does NOT close itself can never
        // inherit a stale countdown from one that did.
        updateCountdown(model.countdown)
        footnoteView.text = model.footnote

        rowsHolder.removeAllViews()
        model.rows.forEach { rowsHolder.addView(buildRow(it), lp(marginBottom = dp(10))) }
        // ── ADVANCED (2026-08-25) ────────────────────────────────────────
        // Below a divider and its own label, so an installer working a
        // stack of panels reads the happy path, taps through it, and stops.
        // These rows stay fully tappable — a demoted grant must never
        // become unreachable, only un-demanded. See the per-grant evidence
        // in SetupCeremony.STEPS.
        if (model.optionalRows.isNotEmpty()) {
            rowsHolder.addView(
                View(context).apply { setBackgroundColor(FAINT) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply {
                    topMargin = dp(4)
                    bottomMargin = dp(10)
                },
            )
            rowsHolder.addView(
                label(SetupCeremonyMath.OPTIONAL_HEADING, 11f, FAINT, bold = true),
                lp(marginBottom = dp(6)),
            )
            model.optionalRows.forEach { rowsHolder.addView(buildRow(it), lp(marginBottom = dp(10))) }
        }

        primaryKey = model.primaryKey
        if (model.primaryLabel == null) {
            primaryShell.visibility = View.GONE
        } else {
            primaryShell.visibility = View.VISIBLE
            primaryButton.text = model.primaryLabel
            // In PAUSED there is nothing left to arm, so the primary is
            // simply "Done" — same handler as Not-now.
            primaryButton.setOnClickListener {
                val key = primaryKey
                if (key == null) onSecondary() else onGrant(key)
            }
        }

        if (model.secondaryLabel == null) {
            secondaryButton.visibility = View.GONE
        } else {
            secondaryButton.visibility = View.VISIBLE
            secondaryButton.text = model.secondaryLabel
        }

        // Rebuilding the rows drops focus. Park it somewhere reachable so
        // a remote-only panel is never stranded with nothing selected.
        //
        // ⚠️ `findFocus() === this` counts as UNPARKED (2026-08-30, field
        // install): ensureView() calls requestFocus() on this root — which
        // is focusable so it swallows stray keys — BEFORE the first
        // render(). A plain null check then saw "something has focus" and
        // never parked, so on a remote-only panel the checklist opened
        // with focus on an invisible root: no highlight anywhere, OK doing
        // nothing. Two brand-new units failed install over this.
        //
        // ⚠️ AND SO DOES ANY OTHER CONTAINER (2026-09-01, G65). The test is
        // now "is the selection on a control this operator can OPERATE" —
        // the primary, the escape, or one of the tappable rows — because a
        // ScrollView holding focus, or a ghost row that
        // `rowsHolder.removeAllViews()` just detached, is exactly as dead to
        // a D-pad as the root is.
        if (!isFocusParked()) parkFocus(focusedRowKey)
    }

    /**
     * Is the remote's selection on something it can actually press?
     *
     * Anything that is not one of THIS card's live controls counts as
     * unparked — null, the root, the ScrollView, a detached row. See
     * CLAUDE.md player rule 15: a focusable root holding focus is not
     * parked, it only looks parked.
     */
    private fun isFocusParked(): Boolean {
        val focused = findFocus() ?: return false
        if (focused.parent == null) return false
        if (focused === primaryButton) return primaryShell.visibility == View.VISIBLE
        if (focused === secondaryButton) return secondaryButton.visibility == View.VISIBLE
        return focusableRows().any { it === focused }
    }

    /**
     * Put the remote's selection on a control it can actually operate.
     *
     * ORDER, and why each rung is where it is:
     *  1. THE ROW THE OPERATOR WAS ON, when this render still has it. Every
     *     Settings round-trip re-renders, and throwing the selection back to
     *     the top each time is what makes a six-step list feel like a
     *     treadmill on a D-pad.
     *  2. THE PRIMARY BUTTON — the armed call-to-action. This is the rung
     *     that shipped 2026-08-30 and it stays first for a FRESH open: the
     *     big "Grant next: …" is what the ceremony wants pressed.
     *  3. ANY ACTIONABLE ROW. Reached when the primary refuses focus, and
     *     the reason this exists at all: it must come BEFORE the root.
     *  4. THE ESCAPE. Better a reachable "Not now" than nothing.
     *
     * ⚠️ requestFocus() RETURNS A BOOLEAN AND IT IS LOAD-BEARING. It fails
     * silently when the window is in touch mode and the target is not
     * `focusableInTouchMode` — the exact shape of field report G65-B on a
     * touch-capable panel driven by a remote. Every rung is tested, and the
     * chain falls through on false instead of assuming it took.
     *
     * @return true when something focusable actually took the selection.
     */
    private fun parkFocus(preferRowKey: String? = null): Boolean {
        if (preferRowKey != null) {
            focusableRows().firstOrNull { it.tag == preferRowKey }?.let {
                if (it.requestFocus()) return true
            }
        }
        if (primaryShell.visibility == View.VISIBLE && primaryButton.requestFocus()) return true
        focusableRows().forEach { if (it.requestFocus()) return true }
        if (secondaryButton.visibility == View.VISIBLE && secondaryButton.requestFocus()) return true
        // Nothing took it. The root is NOT a parking place (rule 15) — but
        // it IS key CONTAINMENT: with focus outside this overlay the WebView
        // underneath gets the remote and Back stops reaching
        // [dispatchKeyEvent]. So the root holds the keys, dispatchKeyEvent
        // refuses to swallow the ones it cannot act on, and this log line is
        // the evidence that the panel needs a look. After v1.1.12 every mode
        // carries a primary button, so reaching here means the window
        // refused focus to every real control.
        PlayerLogger.w(
            "SetupCeremony",
            "no setup control accepted focus — the remote may not be able to operate this card",
        )
        if (findFocus() !== this) requestFocus()
        return false
    }

    /** The rows a remote can select, in the order they are on screen. */
    private fun focusableRows(): List<View> =
        (0 until rowsHolder.childCount)
            .map { rowsHolder.getChildAt(it) }
            .filter { it.isFocusable && it.visibility == View.VISIBLE }

    /**
     * Update ONLY the countdown line. Called once a second by the
     * post-upgrade offer; deliberately not a re-render, because rebuilding
     * the rows drops focus and a remote-only panel would lose its selection
     * every second. Null hides the line.
     */
    fun updateCountdown(text: String?) {
        if (text.isNullOrBlank()) {
            countdownView.visibility = View.GONE
            countdownView.text = ""
        } else {
            countdownView.text = text
            countdownView.visibility = View.VISIBLE
        }
    }

    /**
     * Back = hide for this session (see [onBack] — it must never burn the
     * armed step). Intercepted at dispatch (not via an OnKeyListener) so it
     * fires no matter which child inside the overlay holds focus.
     *
     * OK/Enter while the ROOT itself holds focus fires the primary action —
     * the belt to the focus-parking suspenders above: even if some OEM
     * focus quirk strands focus on the root again, the remote's OK key
     * still advances the ceremony instead of doing nothing.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            onBack()
            return true
        }
        if ((event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) &&
            event.action == KeyEvent.ACTION_UP &&
            findFocus() === this
        ) {
            if (primaryShell.visibility == View.VISIBLE) primaryButton.performClick()
            else if (secondaryButton.visibility == View.VISIBLE) secondaryButton.performClick()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // ─────────────────────────────────────────────────────────────────
    // row + view helpers
    // ─────────────────────────────────────────────────────────────────

    private fun buildRow(row: SetupCeremonyMath.ChecklistRow): View {
        val ctx = context
        val line = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }

        val glyphColor = when (row.status) {
            SetupCeremonyMath.RowStatus.GRANTED -> OK
            SetupCeremonyMath.RowStatus.CURRENT -> ACCENT
            SetupCeremonyMath.RowStatus.NEEDED -> SUBTLE
        }
        val glyph = when (row.status) {
            SetupCeremonyMath.RowStatus.GRANTED -> GLYPH_GRANTED
            SetupCeremonyMath.RowStatus.CURRENT -> GLYPH_CURRENT
            SetupCeremonyMath.RowStatus.NEEDED -> GLYPH_NEEDED
        }
        line.addView(
            label(glyph, 16f, glyphColor, bold = true).apply {
                gravity = Gravity.START
                minWidth = dp(24)
            },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { rightMargin = dp(8) },
        )

        val body = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        body.addView(
            label(
                row.name,
                14f,
                if (row.status == SetupCeremonyMath.RowStatus.GRANTED) SUBTLE else TEXT,
                bold = row.status == SetupCeremonyMath.RowStatus.CURRENT,
            ).apply { gravity = Gravity.START },
        )
        body.addView(
            label(
                if (row.status == SetupCeremonyMath.RowStatus.GRANTED) "Granted" else row.why,
                12f,
                SUBTLE,
            ).apply { gravity = Gravity.START },
        )
        // What just happened, when the direct page was not there.
        row.note?.takeIf { it.isNotBlank() }?.let {
            body.addView(label(it, 11f, WARN).apply { gravity = Gravity.START })
        }
        // The vendor-lost escape hatch, armed row only.
        row.hint?.takeIf { it.isNotBlank() }?.let {
            body.addView(label(it, 11f, FAINT).apply { gravity = Gravity.START })
        }
        line.addView(
            body,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )

        // Every un-granted row is individually tappable — an operator who
        // skipped step 3 can come back to exactly step 3 without waiting
        // for anything to re-offer it. Operator-initiated, so it is not a
        // nag no matter how many times they use it.
        if (row.actionable) {
            line.isClickable = true
            line.isFocusable = true
            // The step key, so [parkFocus] can put the selection back on the
            // SAME row after a re-render instead of throwing the operator to
            // the top of the list on every return from Settings. A tag and
            // not a focus listener: `decorate` owns OnFocusChangeListener,
            // and that is the visible highlight.
            line.tag = row.key
            line.setOnClickListener { onGrant(row.key) }
            decorate(line)
        }
        return line
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

    /** Centred, content-width — for the two action buttons. */
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
