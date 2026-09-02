package com.educms.player.led

import android.app.Activity
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import java.lang.ref.WeakReference

/**
 * "ANDROID IS ASKING YOU SOMETHING YOU CANNOT SEE" — the poster-class
 * announcement for SYSTEM dialogs (2026-09-02, player 1.1.14).
 *
 * ============================================================
 * WHY THIS EXISTS AND WHAT IT HONESTLY DOES
 * ============================================================
 *
 * We can pin every surface WE draw into the LED's top-left column
 * ([LedCanvasHost.pin]). We cannot move a dialog ANDROID draws — the
 * package installer's confirmation, install-unknown-apps, WRITE_SETTINGS,
 * overlay permission, device-admin activation, the battery prompt, the HOME
 * chooser. Those are centred in the 1920×1080 frame buffer, which on a
 * 320×1080 poster is entirely off the glass. The installer sees black and
 * has no idea a button is waiting.
 *
 * So before we launch one, we say so IN THE COLUMN: which prompt is open,
 * and which remote key answers it. Stated exactly as strongly as the
 * evidence allows (player rule 10) — we know which Intent we fired, we do
 * NOT know what the ROM actually put on screen, and the copy says so.
 *
 * Scope, plainly: an opaque Settings page or installer activity covers our
 * window while it is up, so the banner is what the operator reads in the
 * seconds BEFORE it opens and again the moment they come back (it stays up
 * until the ceremony's next render dismisses it, or the timeout fires). It
 * is not visible THROUGH a full-screen system activity — nothing in an app
 * can be.
 *
 * ============================================================
 * REMOTE-FOCUS SAFETY (player rule 15)
 * ============================================================
 *
 * This banner is NOT focusable and NOT clickable. It never takes the
 * selection away from the checklist button underneath it, and it is a strip
 * across the top of the column rather than a full-screen cover, so the card
 * and its parked control stay visible and operable.
 */
object LedSystemPromptBanner {

    private const val TAG = "LedPrompt"

    /** How long a forgotten banner stays up before it clears itself. */
    private const val MAX_LIFETIME_MS = 120_000L

    private val handler = Handler(Looper.getMainLooper())
    private var viewRef: WeakReference<android.view.View>? = null

    private val expire = Runnable { dismissInternal("timed out") }

    /**
     * Announce a system prompt about to be launched.
     *
     * @param what   what Android is being asked to show, in the operator's
     *               words ("Allow installing apps").
     * @param keys   which remote keys answer it ("Press OK to allow · Back to skip").
     *
     * No-op on every non-poster device: on those the dialog lands on the
     * glass where the operator can already see it.
     */
    fun announce(activity: Activity, what: String, keys: String) {
        val canvas = LedCanvasHost.canvasFor(activity) ?: return
        // ⚠️ NEVER OVER AN ALERT. A lockdown / evacuation hold owns the
        // glass; a setup banner does not get to share it. Same invariant
        // the setup ceremony obeys (SetupCeremony's emergency withdrawal).
        if (runCatching { DisplayEmergency.isHeld(activity.applicationContext) }.getOrDefault(false)) {
            PlayerLogger.w(TAG, "poster banner suppressed — an emergency alert is on this screen")
            return
        }
        runCatching {
            dismissInternal("replaced")
            val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
            val strip = build(activity, what, keys, canvas)
            root.addView(
                strip,
                FrameLayout.LayoutParams(
                    canvas.w,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.START or Gravity.TOP,
                ),
            )
            strip.bringToFront()
            LedCanvasHost.fitNarrow(strip)
            viewRef = WeakReference(strip)
            handler.removeCallbacks(expire)
            handler.postDelayed(expire, MAX_LIFETIME_MS)
            PlayerLogger.i(TAG, "poster banner raised for a system prompt — $what")
        }.onFailure { PlayerLogger.w(TAG, "could not raise the poster banner: ${it.message}") }
    }

    /** Take it down — the grant resolved, or the operator moved on. */
    fun dismiss(why: String) = dismissInternal(why)

    private fun dismissInternal(why: String) {
        handler.removeCallbacks(expire)
        val view = viewRef?.get() ?: return
        viewRef = null
        runCatching {
            (view.parent as? ViewGroup)?.removeView(view)
            PlayerLogger.i(TAG, "poster banner dismissed — $why")
        }.onFailure { PlayerLogger.w(TAG, "could not remove the poster banner: ${it.message}") }
    }

    private fun build(
        activity: Activity,
        what: String,
        keys: String,
        canvas: LedCanvas.Canvas,
    ): android.view.View {
        val density = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * density + 0.5f).toInt()

        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            isFocusable = false
            isClickable = false
            setPadding(dp(12), dp(14), dp(12), dp(14))
            background = GradientDrawable().apply {
                setColor(0xF2111827.toInt())
                cornerRadius = dp(10).toFloat()
                setStroke(dp(2), 0xFFFBBF24.toInt())
            }
        }

        fun line(text: String, sizeSp: Float, color: Int, bold: Boolean = false) =
            TextView(activity).apply {
                this.text = text
                textSize = sizeSp
                setTextColor(color)
                gravity = Gravity.START
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            }

        column.addView(line("ANDROID IS ASKING", 11f, 0xFFFBBF24.toInt(), bold = true))
        column.addView(line(what, 16f, 0xFFFFFFFF.toInt(), bold = true))
        column.addView(line(keys, 13f, 0xFF93C5FD.toInt()))
        column.addView(
            line(
                "The prompt is drawn by Android in the middle of this " +
                    "controller's ${activity.resources.displayMetrics.widthPixels}px canvas, " +
                    "outside the ${canvas.w}px the LED shows. Answer it with the remote.",
                11f,
                0xFF94A3B8.toInt(),
            ),
        )
        return column
    }
}
