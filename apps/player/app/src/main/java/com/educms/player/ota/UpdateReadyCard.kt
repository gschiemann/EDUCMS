package com.educms.player.ota

import android.app.Activity
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.educms.player.logging.PlayerLogger

/**
 * The full-screen "Update ready — press OK to install" card (1.1.46,
 * [UpdatePromptPolicy] rule 2). Remote-operable (player rule 15): focus is
 * PARKED on the Install button with a visible highlight; Back on either
 * button takes the card down. Emergency-first: it re-checks the hold every
 * second while up and leaves the moment one starts.
 */
object UpdateReadyCard {
    private const val TAG = "UpdateReadyCard"

    private var view: View? = null
    private var onClosed: (() -> Unit)? = null
    private var shownAtMs = 0L
    private val handler = Handler(Looper.getMainLooper())

    fun isShowing(): Boolean = view != null

    /**
     * @param emergencyHeld read every second while the card is up.
     * @param decorate      the Activity's remote-focus treatment.
     * @param onInstall     the OK press (runs after the card is removed).
     */
    fun show(
        activity: Activity,
        versionLabel: String,
        emergencyHeld: () -> Boolean,
        decorate: (View) -> Unit,
        onInstall: () -> Unit,
        onClosed: () -> Unit = {},
    ) {
        if (view != null) return
        if (emergencyHeld()) return
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), activity.resources.displayMetrics).toInt()

        val install = Button(activity).apply {
            text = "Install update"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            setPadding(dp(32), dp(16), dp(32), dp(16))
        }
        val later = Button(activity).apply {
            text = "Not now"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setPadding(dp(24), dp(12), dp(24), dp(12))
        }
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(48), dp(48), dp(48), dp(48))
            addView(TextView(activity).apply {
                text = "Update ready"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
                gravity = Gravity.CENTER
            })
            addView(TextView(activity).apply {
                text = "VenueOS Player $versionLabel is ready to install.\nPress OK on the remote (or tap Install update), then tap Install."
                setTextColor(0xFFD1D5DB.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
                gravity = Gravity.CENTER
                setPadding(0, dp(16), 0, dp(32))
            })
            addView(install)
            addView(later, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(16) })
        }
        val card = FrameLayout(activity).apply {
            setBackgroundColor(0xF2111827.toInt())
            isClickable = true // swallow touches meant for the content behind
            addView(column, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
            ))
        }
        decorate(install)
        decorate(later)
        val back = View.OnKeyListener { _, keyCode, event ->
            if ((keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) && event.action == KeyEvent.ACTION_UP) {
                hide("back")
                true
            } else {
                keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE
            }
        }
        install.setOnKeyListener(back)
        later.setOnKeyListener(back)
        install.setOnClickListener {
            hide("install pressed")
            runCatching(onInstall).onFailure { PlayerLogger.e(TAG, "install from card failed", it) }
        }
        later.setOnClickListener { hide("not now") }

        root.addView(card, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        card.bringToFront()
        view = card
        this.onClosed = onClosed
        shownAtMs = SystemClock.elapsedRealtime()
        install.requestFocus()
        PlayerLogger.i(TAG, "update-ready card shown ($versionLabel) — focus parked on Install")

        val watch = object : Runnable {
            override fun run() {
                if (view !== card) return
                val keep = UpdatePromptPolicy.keepCard(
                    runCatching(emergencyHeld).getOrDefault(true),
                    SystemClock.elapsedRealtime() - shownAtMs,
                )
                if (!keep) hide("emergency hold or window elapsed") else handler.postDelayed(this, 1_000L)
            }
        }
        handler.postDelayed(watch, 1_000L)
    }

    fun hide(reason: String) {
        val v = view ?: return
        view = null
        runCatching { (v.parent as? ViewGroup)?.removeView(v) }
        PlayerLogger.i(TAG, "update-ready card removed ($reason)")
        val closed = onClosed
        onClosed = null
        closed?.let { runCatching(it) }
    }
}
