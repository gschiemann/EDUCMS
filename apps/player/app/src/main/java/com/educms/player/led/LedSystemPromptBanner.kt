package com.educms.player.led

import android.app.Activity
import android.content.Intent
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
 * "ANDROID OPENED SOMETHING YOU CANNOT SEE" — the poster-class
 * announcement + escape hatch for SYSTEM activities (2026-09-02, 1.1.14;
 * rewritten for MOUSE-ONLY posters in 1.1.15).
 *
 * ============================================================
 * WHY THIS EXISTS AND WHAT IT HONESTLY DOES
 * ============================================================
 *
 * We can pin every surface WE draw into the LED's top-left column
 * ([LedCanvasHost.pin]). We cannot move a page ANDROID draws — the package
 * installer's confirmation, a Settings screen. Those are centred in the
 * 1920×1080 frame buffer, which on a 320×1080 poster is entirely off the
 * glass. The installer sees black and has no idea a button is waiting.
 *
 * So we say so IN THE COLUMN: what is open, why it cannot be seen, and a
 * button that brings VenueOS back over it.
 *
 * ============================================================
 * ⚠️ A NOVASTAR POSTER HAS NO REMOTE (operator, 2026-09-02)
 * ============================================================
 *
 * The ONLY input on these controllers is a USB mouse, and the pointer is
 * invisible outside the 320 px the LED shows. Two hard consequences, and
 * both are corrections to what 1.1.14 shipped:
 *
 *  1. **NO KEY INSTRUCTIONS.** "Press OK · Back to skip" was written for
 *     the D-pad panels and is simply false here — there is no OK key and no
 *     Back key to press. This class no longer accepts key copy at all, so
 *     the wrong sentence cannot be handed to it again. What it says instead
 *     is what is true: something is open, it is off the glass, and here is
 *     the button.
 *  2. **A MOUSE CANNOT REACH AN OFF-GLASS PAGE.** A remote can blind-press
 *     Back; a pointer that vanishes at x=320 cannot click a dialog centred
 *     at x≈960. So the banner carries a real, CLICKABLE escape —
 *     [BRING_BACK_LABEL] — that reorders our own task to the front, and a
 *     [AUTO_RETURN_MS] backstop that tries the same thing by itself for an
 *     operator who has already walked away.
 *
 * ⚠️ THE AUTO-RETURN IS BEST-EFFORT AND THE CODE SAYS SO. Android 10+
 * silently drops a `startActivity` from a background process unless the app
 * is HOME, is/has a device owner, or holds "Display over other apps" — the
 * same rule that produced RELAUNCH_BLOCKED on the Goodview panels. While a
 * foreign activity is on top we ARE that background process. So the timer
 * is a backstop, never the promise; the promise is the button, which is
 * pressed while our window is in front and is therefore always legal.
 *
 * ============================================================
 * FOCUS AND CLICK SAFETY (player rule 15)
 * ============================================================
 *
 * The strip itself stays non-focusable and non-clickable — it must never
 * take the selection from the checklist button underneath it on a
 * remote-driven panel. The escape button is `clickable` but deliberately
 * NOT `focusable`: a mouse click reaches a clickable view without focus, so
 * the button works on the hardware it is for while the D-pad panels' focus
 * order is left exactly as it was.
 */
object LedSystemPromptBanner {

    private const val TAG = "LedPrompt"

    /** How long a forgotten banner stays up before it clears itself. */
    private const val MAX_LIFETIME_MS = 120_000L

    /**
     * How long an unanswered system page gets before we try to come back
     * over it on our own. 60 s: long enough that an operator who IS
     * answering it is not interrupted, short enough that a screen left on a
     * foreign page is not stranded there until someone drives out.
     */
    const val AUTO_RETURN_MS = 60_000L

    /** The escape button's label. Says what it does, in the operator's words. */
    const val BRING_BACK_LABEL = "Bring VenueOS back"

    private val handler = Handler(Looper.getMainLooper())
    private var viewRef: WeakReference<android.view.View>? = null
    private var hostRef: WeakReference<Activity>? = null

    private val expire = Runnable { dismissInternal("timed out") }

    private val autoReturn = Runnable {
        val act = hostRef?.get()
        when {
            act == null -> PlayerLogger.i(TAG, "auto-return skipped — the host activity is gone")
            // Our window already has focus: nothing foreign is on top, so
            // there is nothing to come back over. Say that rather than
            // firing a startActivity nobody needed.
            runCatching { act.hasWindowFocus() }.getOrDefault(false) ->
                PlayerLogger.i(TAG, "auto-return skipped — VenueOS is already in front")
            else -> bringPlayerBack(act, "no answer after ${AUTO_RETURN_MS / 1000}s")
        }
    }

    /**
     * Announce a system page about to be launched.
     *
     * @param what   what Android is about to put on screen, in the
     *               operator's words ("A software update is ready to
     *               install").
     * @param detail optional extra context. ⚠️ NEVER key instructions —
     *               see the class header; this hardware has no keys.
     *
     * No-op on every non-poster device: on those the page lands on the
     * glass where the operator can already see it.
     */
    fun announce(activity: Activity, what: String, detail: String? = null) {
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
            val strip = build(activity, what, detail, canvas)
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
            hostRef = WeakReference(activity)
            handler.removeCallbacks(expire)
            handler.removeCallbacks(autoReturn)
            handler.postDelayed(autoReturn, AUTO_RETURN_MS)
            handler.postDelayed(expire, MAX_LIFETIME_MS)
            PlayerLogger.i(TAG, "poster banner raised for a system page — $what")
        }.onFailure { PlayerLogger.w(TAG, "could not raise the poster banner: ${it.message}") }
    }

    /** Take it down — the grant resolved, or the operator moved on. */
    fun dismiss(why: String) = dismissInternal(why)

    /**
     * Bring our own task back to the front, covering whatever Android put
     * on top of it.
     *
     * `REORDER_TO_FRONT | SINGLE_TOP` on the EXISTING MainActivity: no new
     * instance, no relaunch, no content reload — the task is simply moved
     * in front of the foreign activity. (Never `CLEAR_TOP`, which cannot be
     * combined with REORDER_TO_FRONT, and never `NEW_TASK` from an Activity
     * context, which would make a second task rather than raise this one.)
     *
     * Public so a future caller with the same problem uses this one
     * implementation rather than writing a second set of flags.
     */
    fun bringPlayerBack(activity: Activity, why: String) {
        runCatching {
            activity.startActivity(
                Intent(activity, com.educms.player.MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                ),
            )
            // "requested", not "returned": on Android 10+ a start from the
            // background is dropped SILENTLY, with no exception and no
            // result code. Claiming we came back would be a claim this
            // process cannot check — player rule 10.
            PlayerLogger.i(TAG, "requested a return to VenueOS — $why")
        }.onFailure {
            PlayerLogger.w(TAG, "could not request a return to VenueOS: ${it.message}")
        }
    }

    private fun dismissInternal(why: String) {
        handler.removeCallbacks(expire)
        handler.removeCallbacks(autoReturn)
        hostRef = null
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
        detail: String?,
        canvas: LedCanvas.Canvas,
    ): android.view.View {
        val density = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * density + 0.5f).toInt()

        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            // The STRIP never takes focus and never eats a click — the
            // control underneath it stays reachable. Only the button below
            // is interactive.
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

        column.addView(line("ANDROID OPENED A PAGE", 11f, 0xFFFBBF24.toInt(), bold = true))
        column.addView(line(what, 16f, 0xFFFFFFFF.toInt(), bold = true))
        if (!detail.isNullOrBlank()) {
            column.addView(line(detail, 13f, 0xFF93C5FD.toInt()))
        }
        column.addView(
            line(
                "Android drew it in the middle of this controller's " +
                    "${activity.resources.displayMetrics.widthPixels}px canvas, outside the " +
                    "${canvas.w}px the LED shows — a mouse cannot reach it. Click below to " +
                    "bring VenueOS back over it.",
                11f,
                0xFF94A3B8.toInt(),
            ),
        )

        // THE ESCAPE. Clickable, not focusable — see the class header.
        // Generously padded because it is a pointer target inside a 320 px
        // column, and `fitNarrow` will scale the type but not the hit area
        // below what the padding gives it.
        val button = TextView(activity).apply {
            text = BRING_BACK_LABEL
            textSize = 15f
            setTextColor(0xFF0B1220.toInt())
            gravity = Gravity.CENTER
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            // ⚠️ A FLOOR THE COLUMN FIT CANNOT SHRINK. `fitNarrow` scales
            // type and PADDING by canvasWidth/720 (≈0.44 on a 320 px
            // poster), which would leave this pointer target about 19 px
            // tall. `minHeight` is not touched by that pass, so the button
            // keeps a full 44 dp — Android's own minimum touch target, and
            // the only input this hardware has is a mouse.
            minHeight = dp(44)
            background = GradientDrawable().apply {
                setColor(0xFFFBBF24.toInt())
                cornerRadius = dp(8).toFloat()
            }
            isClickable = true
            isFocusable = false
            setOnClickListener {
                dismissInternal("operator asked to come back")
                bringPlayerBack(activity, "operator clicked \"$BRING_BACK_LABEL\"")
            }
        }
        column.addView(
            button,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(10) },
        )
        return column
    }
}
