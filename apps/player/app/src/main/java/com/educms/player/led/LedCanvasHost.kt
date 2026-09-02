package com.educms.player.led

import android.app.Activity
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.educms.player.BuildConfig
import com.educms.player.R
import com.educms.player.logging.PlayerLogger

/**
 * The Android glue for [LedCanvas] — ONE place that answers "how wide is
 * the glass, really?" for every native surface this app draws.
 *
 * Three jobs, and nothing else:
 *
 *  • [canvasFor]   — the derived LED canvas, or null when the OS resolution
 *                    governs (every non-poster device: a provable no-op).
 *  • [pin]         — anchor a full-screen native view TOP-LEFT at the
 *                    canvas size, so it lands on the LED instead of being
 *                    centred a metre to the right of it.
 *  • [fitNarrow]   — scale a card's type and padding down for a 320 px
 *                    column, idempotently, so nothing is clipped.
 *
 * ⚠️ NON-POSTER DEVICES MUST BE UNTOUCHED. Every entry point here returns
 * early on a null canvas and the callers keep their existing MATCH_PARENT
 * layout params. That is the contract [LedCanvasHostRuleTest] asserts.
 */
object LedCanvasHost {

    private const val TAG = "LedCanvas"

    /**
     * The canonical player prefs file. The explicit-canvas keys below are
     * RESERVED, not yet written: the operator's LED canvas lives in the
     * manifest and reaches the WEB player's localStorage (`edu_canvasW`),
     * which Kotlin cannot read, and this wave deliberately adds no bridge
     * method for it (a new method is a three-file atomic contract and a
     * fleet-floor problem — see CLAUDE.md player rule 9). Reading them here
     * means the day a writer exists, the rule needs no change. Until then a
     * chained poster falls to rule 4 and draws in its LEFTMOST panel —
     * visible and operable, which is the whole point, rather than exact.
     */
    private const val PREFS = "edu_player"
    private const val KEY_CANVAS_W = "led_canvas_w"
    private const val KEY_CANVAS_H = "led_canvas_h"
    private const val KEY_STD_W = "led_poster_std_w"
    private const val KEY_STD_H = "led_poster_std_h"

    /**
     * Debug-only poster forcing, for an emulator or a bench LCD:
     *   adb shell settings put global venueos_force_poster 1
     * Honored ONLY in a debug build, so no field device can be talked into
     * a 320 px column by a settings write.
     */
    private const val FORCE_POSTER_SETTING = "venueos_force_poster"

    @Volatile
    private var cached: LedCanvas.Canvas? = null

    @Volatile
    private var resolved = false

    /** Test/diagnostic hook: forget the memoized answer. */
    fun invalidate() {
        resolved = false
        cached = null
    }

    /** Is this box the NovaStar TB poster class (or forced, in a debug build)? */
    fun isPosterClass(context: Context): Boolean {
        if (BuildConfig.DEBUG && forcedPoster(context)) return true
        return LedCanvas.isPosterClass(
            Build.MODEL,
            Build.DEVICE,
            Build.PRODUCT,
            Build.HARDWARE,
            Build.MANUFACTURER,
            Build.BOARD,
        )
    }

    private fun forcedPoster(context: Context): Boolean = runCatching {
        val v = Settings.Global.getString(context.contentResolver, FORCE_POSTER_SETTING)
        v == "1" || v.equals("true", ignoreCase = true)
    }.getOrDefault(false)

    /**
     * The canvas every native surface draws inside, or null when the OS
     * resolution governs. Memoized — Build strings and the frame buffer do
     * not change under a running process, and this is called from view
     * construction paths.
     */
    fun canvasFor(context: Context): LedCanvas.Canvas? {
        if (resolved) return cached
        val poster = isPosterClass(context)
        val dm = context.resources.displayMetrics
        val prefs = runCatching {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }.getOrNull()
        val exW = prefs?.getInt(KEY_CANVAS_W, 0)?.takeIf { it > 0 }
        val exH = prefs?.getInt(KEY_CANVAS_H, 0)?.takeIf { it > 0 }
        val stdW = prefs?.getInt(KEY_STD_W, 0)?.takeIf { it > 0 }
        val stdH = prefs?.getInt(KEY_STD_H, 0)?.takeIf { it > 0 }
        val canvas = LedCanvas.nativeCanvas(
            posterClass = poster,
            osW = dm.widthPixels,
            osH = dm.heightPixels,
            explicitW = exW,
            explicitH = exH,
            standardW = stdW,
            standardH = stdH,
        )
        cached = canvas
        resolved = true
        if (canvas != null) {
            PlayerLogger.i(
                TAG,
                "poster class (${Build.MODEL}/${Build.DEVICE}) — native surfaces pinned to " +
                    "${canvas.w}×${canvas.h} top-left (${canvas.source}, panels=${canvas.panels}) " +
                    "inside an OS canvas of ${dm.widthPixels}×${dm.heightPixels}",
            )
        }
        return canvas
    }

    /** Width a native surface should lay itself out against, in pixels. */
    fun viewportWidthPx(context: Context): Int =
        canvasFor(context)?.w ?: context.resources.displayMetrics.widthPixels

    /** Height a native surface should lay itself out against, in pixels. */
    fun viewportHeightPx(context: Context): Int =
        canvasFor(context)?.h ?: context.resources.displayMetrics.heightPixels

    /**
     * Anchor a full-screen native overlay to the LED.
     *
     * On a poster: TOP-LEFT (`START|TOP`), sized to the canvas — the same
     * corner the LED reads, and the same rule the web pin script applies to
     * the page. On every other device: nothing at all, so the view keeps
     * the MATCH_PARENT params its caller gave it.
     *
     * Safe to call before or after the view is attached; call it again
     * after a re-attach.
     */
    fun pin(view: View) {
        val canvas = canvasFor(view.context) ?: return
        val h = pinnedHeightPx(view.context, canvas)
        val existing = view.layoutParams
        val lp = when (existing) {
            is FrameLayout.LayoutParams -> existing.also {
                it.width = canvas.w
                it.height = h
                it.gravity = Gravity.START or Gravity.TOP
            }
            null -> FrameLayout.LayoutParams(canvas.w, h, Gravity.START or Gravity.TOP)
            else -> existing.also {
                it.width = canvas.w
                it.height = h
            }
        }
        view.layoutParams = lp
        // A pinned surface must not drift when a parent applies its own
        // gravity translation on a later pass.
        view.translationX = 0f
        view.translationY = 0f
    }

    /**
     * Add [child] to [parent] already pinned. The one call site shape used
     * by the overlays that mount themselves into `android.R.id.content`.
     */
    fun addPinned(parent: ViewGroup, child: View) {
        val canvas = canvasFor(parent.context)
        if (canvas == null) {
            parent.addView(
                child,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            return
        }
        parent.addView(
            child,
            FrameLayout.LayoutParams(
                canvas.w,
                pinnedHeightPx(parent.context, canvas),
                Gravity.START or Gravity.TOP,
            ),
        )
    }

    /**
     * The canvas height, never taller than the window we are drawing into —
     * see [LedCanvas.pinnedHeight]. A box taller than its parent centres its
     * content off the bottom of the visible area, which is the same failure
     * this wave fixes on the other axis.
     */
    private fun pinnedHeightPx(context: Context, canvas: LedCanvas.Canvas): Int =
        LedCanvas.pinnedHeight(canvas.h, context.resources.displayMetrics.heightPixels)

    /**
     * Squeeze a card into the column: scale every TextView's type and every
     * view's padding by [LedCanvas.narrowScale], so a 36 sp title and 48 dp
     * padding designed for a 1920-wide window still read inside 320 px.
     *
     * IDEMPOTENT — each view is tagged once scaled, because these cards
     * rebuild their children on every render() and compounding the factor
     * would shrink the type to nothing over a few refreshes.
     *
     * No-op on every non-poster device.
     */
    fun fitNarrow(root: View) {
        val canvas = canvasFor(root.context) ?: return
        val scale = LedCanvas.narrowScale(canvas.w)
        if (scale >= 1f) return
        apply(root, scale)
    }

    private fun apply(view: View, scale: Float) {
        if (view.getTag(R.id.led_narrow_fit_tag) == null) {
            view.setTag(R.id.led_narrow_fit_tag, true)
            if (view is TextView) {
                val px = (view.textSize * scale).coerceAtLeast(LedCanvas.MIN_TEXT_PX)
                view.setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
                // A narrow column wraps; nothing may be ellipsized off the
                // LED because a parent guessed one line.
                view.maxLines = Int.MAX_VALUE
                view.ellipsize = null
            }
            view.setPadding(
                (view.paddingLeft * scale).toInt(),
                (view.paddingTop * scale).toInt(),
                (view.paddingRight * scale).toInt(),
                (view.paddingBottom * scale).toInt(),
            )
            (view.layoutParams as? ViewGroup.MarginLayoutParams)?.let { mlp ->
                mlp.leftMargin = (mlp.leftMargin * scale).toInt()
                mlp.topMargin = (mlp.topMargin * scale).toInt()
                mlp.rightMargin = (mlp.rightMargin * scale).toInt()
                mlp.bottomMargin = (mlp.bottomMargin * scale).toInt()
                // A fixed pixel width wider than the column would clip; let
                // it fill the column instead. WRAP/MATCH are left alone.
                if (mlp.width > canvasWidthOrMax(view)) mlp.width = ViewGroup.LayoutParams.MATCH_PARENT
                view.layoutParams = mlp
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) apply(view.getChildAt(i), scale)
        }
    }

    private fun canvasWidthOrMax(view: View): Int =
        canvasFor(view.context)?.w ?: Int.MAX_VALUE

    /**
     * Convenience for an Activity that wants its whole content frame's
     * direct children (the XML overlays) pinned. Only the views handed in —
     * never a blanket sweep, because the blackout view and the WebView must
     * keep filling the OS canvas (the web player pins ITSELF, and a blank
     * that only covered a third of the frame buffer would be a light leak).
     */
    fun pinAll(activity: Activity, vararg views: View?) {
        if (canvasFor(activity) == null) return
        views.forEach { v -> v?.let { pin(it) } }
    }
}
