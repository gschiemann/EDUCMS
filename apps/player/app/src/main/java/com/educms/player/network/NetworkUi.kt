package com.educms.player.network

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.roundToInt

/**
 * The Network screen's design system (2026-10-24) — tokens, sizing and the
 * handful of controls the screen is built from. Native views only, vector
 * icons, no new dependency; nothing here touches the network.
 *
 * Brand: the pairing screen's — a deep navy ground (#05060f → #111024) with
 * an indigo/violet glow, indigo #6366F1 as the accent.
 *
 * GPU budget (Android 7 / 9 boxes): no blur, no RenderEffect, no
 * per-frame allocation. The "glow" is three translucent rounded strokes
 * drawn once; motion is alpha / scale / translation (cheap layer
 * properties) and a spinner that redraws one arc.
 */
internal object NetTheme {
    const val BG_TOP = 0xFF0C1033.toInt()
    const val BG_MID = 0xFF080B22.toInt()
    const val BG_BOTTOM = 0xFF05060F.toInt()
    const val BG_GLOW = 0x386366F1
    const val BG_GLOW_2 = 0x228B5CF6

    const val CARD_TOP = 0xFF141A3D.toInt()
    const val CARD_BOTTOM = 0xFF0F1431.toInt()
    const val CARD_BORDER = 0x1AFFFFFF

    const val HERO_TOP = 0xFF23286E.toInt()
    const val HERO_BOTTOM = 0xFF151A47.toInt()
    const val HERO_BORDER = 0x4D818CF8

    const val CONTROL = 0x0FFFFFFF
    const val CONTROL_BORDER = 0x14FFFFFF
    const val CONTROL_PRESSED = 0x26FFFFFF

    const val FOCUS_FILL = 0xFF4F46E5.toInt()
    const val FOCUS_FILL_2 = 0xFF6D4AE8.toInt()
    const val FOCUS_RING = 0xFFFFFFFF.toInt()
    const val FOCUS_GLOW = 0xFF818CF8.toInt()

    const val PRIMARY_TOP = 0xFF6366F1.toInt()
    const val PRIMARY_BOTTOM = 0xFF7C3AED.toInt()

    const val KEY = 0xFF1B2147.toInt()
    const val KEY_FN = 0xFF121733.toInt()
    const val FIELD = 0xFF070A1E.toInt()
    const val FIELD_BORDER = 0x33FFFFFF

    const val TEXT = 0xFFF8FAFC.toInt()
    const val TEXT_2 = 0xFFCBD5E1.toInt()
    const val SUBTLE = 0xFF94A3B8.toInt()
    const val FAINT = 0xFF64748B.toInt()
    const val ON_FOCUS_SUBTLE = 0xFFE0E7FF.toInt()

    const val ACCENT = 0xFF6366F1.toInt()
    const val ACCENT_LIGHT = 0xFFA5B4FC.toInt()
    const val GOOD = 0xFF34D399.toInt()
    const val GOOD_BG = 0x2634D399
    const val WARN = 0xFFFBBF24.toInt()
    const val WARN_BG = 0x26FBBF24
    const val BAD = 0xFFF87171.toInt()
    const val BAD_BG = 0x26F87171
    const val INFO_BG = 0x336366F1
}

/**
 * Sizes in DESIGN UNITS (1/1080 of the panel's short side — [NetworkLayout]),
 * turned into pixels here. Every dimension in the screen goes through this,
 * so 1080p, 4K, portrait and a narrow LED column are one layout.
 */
internal class NetUi(val context: Context, val metrics: NetworkLayout.Metrics) {

    val wide: Boolean get() = metrics.wide

    fun px(du: Float): Int = if (du == 0f) 0 else (du * metrics.unit).roundToInt().coerceAtLeast(1)
    fun px(du: Int): Int = px(du.toFloat())
    fun pxf(du: Float): Float = du * metrics.unit

    /** Horizontal page margin. */
    val gutter: Int get() = px(if (wide) 72 else 40)

    val medium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val regular: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val mono: Typeface = Typeface.MONOSPACE

    fun text(
        value: CharSequence,
        sizeDu: Float,
        color: Int,
        face: Typeface = regular,
        lines: Int = Int.MAX_VALUE,
    ): TextView = TextView(context).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_PX, pxf(sizeDu))
        setTextColor(color)
        typeface = face
        if (lines != Int.MAX_VALUE) {
            maxLines = lines
            ellipsize = TextUtils.TruncateAt.END
        }
    }

    /** A caption: small, spaced, upper case (a no-op for Chinese). */
    fun caption(value: CharSequence, color: Int = NetTheme.ACCENT_LIGHT): TextView =
        text(value, 19f, color, medium, lines = 1).apply {
            setAllCaps(true)
            letterSpacing = 0.14f
        }

    /** Colours that follow the focused state of the control they sit in. */
    fun onFocus(normal: Int, focused: Int): ColorStateList = ColorStateList(
        arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
        intArrayOf(focused, normal),
    )

    fun icon(res: Int, sizeDu: Float, tint: ColorStateList): ImageView = ImageView(context).apply {
        setImageResource(res)
        imageTintList = tint
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(px(sizeDu), px(sizeDu))
        isDuplicateParentStateEnabled = true
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun icon(res: Int, sizeDu: Float, tint: Int): ImageView = icon(res, sizeDu, ColorStateList.valueOf(tint))

    fun rounded(color: Int, radiusDu: Float, strokeDu: Float = 0f, stroke: Int = 0): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = pxf(radiusDu)
            if (strokeDu > 0f) setStroke(px(strokeDu), stroke)
        }

    fun gradient(top: Int, bottom: Int, radiusDu: Float, strokeDu: Float = 0f, stroke: Int = 0): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(top, bottom)).apply {
            cornerRadius = pxf(radiusDu)
            if (strokeDu > 0f) setStroke(px(strokeDu), stroke)
        }

    fun oval(color: Int): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    /** A card: rounded, a faint top-lit gradient and hairline — elevation without a GPU shadow. */
    fun card(hero: Boolean = false): GradientDrawable =
        if (hero) gradient(NetTheme.HERO_TOP, NetTheme.HERO_BOTTOM, 32f, 1.5f, NetTheme.HERO_BORDER)
        else gradient(NetTheme.CARD_TOP, NetTheme.CARD_BOTTOM, 28f, 1.5f, NetTheme.CARD_BORDER)

    fun lp(w: Int, h: Int, l: Int = 0, t: Int = 0, r: Int = 0, b: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h).apply { setMargins(l, t, r, b) }

    fun lpWeight(weight: Float, vertical: Boolean, l: Int = 0, t: Int = 0, r: Int = 0, b: Int = 0): LinearLayout.LayoutParams =
        (if (vertical) LinearLayout.LayoutParams(MATCH, 0, weight) else LinearLayout.LayoutParams(0, MATCH, weight))
            .apply { setMargins(l, t, r, b) }

    fun row(gravity: Int = Gravity.CENTER_VERTICAL): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        this.gravity = gravity
        noClip(this)
    }

    fun column(gravity: Int = Gravity.START): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        this.gravity = gravity
        noClip(this)
    }

    fun space(wDu: Float, hDu: Float): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(px(wDu), px(hDu))
    }

    companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

        /** A focused control grows and glows past its edges; nothing on the way up may clip it. */
        fun noClip(g: ViewGroup) {
            g.clipChildren = false
            g.clipToPadding = false
        }
    }
}

/**
 * The one focus treatment (2026-10-24): a control's box turns indigo with a
 * white ring and a soft glow drawn OUTSIDE its edges, and the control grows a
 * little ([NetControl]). Visible from across a room on every ROM — it never
 * relies on the OEM focus drawable, which several signage builds strip.
 */
internal class NetBoxDrawable(
    private val ui: NetUi,
    private val radiusDu: Float,
    private val fill: Int,
    private val fill2: Int = fill,
    private val border: Int = NetTheme.CONTROL_BORDER,
    private val focusFill: Int = NetTheme.FOCUS_FILL,
    private val focusFill2: Int = NetTheme.FOCUS_FILL_2,
    private val pressed: Int = NetTheme.CONTROL_PRESSED,
) : Drawable() {

    var focused = false
        private set
    private var isPressed = false
    private var checked = false

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private var shaderFor: Int = 0
    private var shader: Shader? = null

    override fun draw(canvas: Canvas) {
        val b = bounds
        if (b.isEmpty) return
        val r = ui.pxf(radiusDu)
        if (focused) {
            // The glow: three translucent rings outside the box — a blur's look, none of its cost.
            paint.shader = null
            paint.style = Paint.Style.STROKE
            val ring = ui.pxf(3.5f)
            for ((i, alpha) in intArrayOf(0x55, 0x2C, 0x12).withIndex()) {
                val out = ring * (i + 0.5f)
                paint.strokeWidth = ring
                paint.color = (NetTheme.FOCUS_GLOW and 0x00FFFFFF) or (alpha shl 24)
                rect.set(b.left - out, b.top - out, b.right + out, b.bottom + out)
                canvas.drawRoundRect(rect, r + out, r + out, paint)
            }
        }
        // The box.
        paint.style = Paint.Style.FILL
        rect.set(b)
        val top = if (focused) focusFill else fill
        val bottom = if (focused) focusFill2 else fill2
        if (top == bottom) {
            paint.shader = null
            paint.color = top
        } else {
            val key = top * 31 + bottom + b.height()
            if (shader == null || shaderFor != key) {
                shader = LinearGradient(0f, b.top.toFloat(), 0f, b.bottom.toFloat(), top, bottom, Shader.TileMode.CLAMP)
                shaderFor = key
            }
            // Opaque paint: a shader is modulated by the paint's alpha (the last glow ring's 7 %).
            paint.color = 0xFF000000.toInt()
            paint.shader = shader
        }
        canvas.drawRoundRect(rect, r, r, paint)
        paint.shader = null
        if (isPressed && !focused) {
            paint.color = pressed
            canvas.drawRoundRect(rect, r, r, paint)
        }
        // The edge: a hairline at rest, a white ring when focused.
        paint.style = Paint.Style.STROKE
        val sw = if (focused) ui.pxf(3f) else ui.pxf(1.5f)
        paint.strokeWidth = sw
        paint.color = if (focused) NetTheme.FOCUS_RING else if (checked) NetTheme.ACCENT_LIGHT else border
        rect.inset(sw / 2f, sw / 2f)
        canvas.drawRoundRect(rect, r - sw / 2f, r - sw / 2f, paint)
    }

    override fun isStateful(): Boolean = true

    override fun onStateChange(state: IntArray): Boolean {
        val f = state.contains(android.R.attr.state_focused)
        val p = state.contains(android.R.attr.state_pressed)
        val c = state.contains(android.R.attr.state_checked) || state.contains(android.R.attr.state_selected)
        if (f == focused && p == isPressed && c == checked) return false
        focused = f
        isPressed = p
        checked = c
        invalidateSelf()
        return true
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

/**
 * Every pressable thing on the screen: focusable for the remote (in touch
 * mode too — field report G65-B: a panel boots in touch mode and a
 * `requestFocus()` on anything else silently fails, leaving no highlight),
 * yet ONE tap still acts. Android's default makes the first tap on a
 * focusable-in-touch-mode view only take focus; on a touch panel that reads
 * as a dead button, so the tap that takes focus also clicks.
 */
@SuppressLint("ViewConstructor")
internal open class NetControl(
    context: Context,
    private val ui: NetUi,
    private val growTo: Float,
) : LinearLayout(context) {

    /** What [NetworkScreenView] restores focus to after a re-render. */
    var focusKey: String? = null

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        NetUi.noClip(this)
        // Draw over neighbours while lifted, without an elevation shadow.
        outlineProvider = null
    }

    override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
        val s = if (gainFocus) growTo else 1f
        animate().scaleX(s).scaleY(s).setDuration(140L).setInterpolator(DecelerateInterpolator()).start()
        translationZ = if (gainFocus) ui.pxf(12f) else 0f
    }

    @SuppressLint("ClickableViewAccessibility") // performClick is overridden below and called here
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_UP && isEnabled && !isFocused) {
            val inside = event.x >= 0f && event.y >= 0f && event.x < width && event.y < height
            val handled = super.onTouchEvent(event) // takes focus; Android skips the click
            if (inside) performClick()
            return handled
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean = super.performClick()
}

/** A spinning arc — the "working" signal. Redraws only while it is on the glass. */
@SuppressLint("ViewConstructor") // built in code only, never inflated
internal class SpinnerView(context: Context, private val ui: NetUi, private val strokeDu: Float, private val color: Int) : View(context) {
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = 0x1FFFFFFF
    }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        this.color = this@SpinnerView.color
    }
    private val oval = RectF()

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onDraw(canvas: Canvas) {
        val sw = ui.pxf(strokeDu)
        track.strokeWidth = sw
        arc.strokeWidth = sw
        oval.set(sw / 2f, sw / 2f, width - sw / 2f, height - sw / 2f)
        canvas.drawOval(oval, track)
        val t = (SystemClock.uptimeMillis() % 1_600L) / 1_600f
        val sweep = 70f + 110f * (0.5f - 0.5f * kotlin.math.cos(t * 2 * Math.PI).toFloat())
        canvas.drawArc(oval, t * 360f - 90f, sweep, false, arc)
        if (isShown) postInvalidateOnAnimation()
    }
}

/** A soft pulse on a placeholder while the first scan runs. */
internal fun pulse(view: View): ObjectAnimator =
    ObjectAnimator.ofFloat(view, View.ALPHA, 0.35f, 0.9f).apply {
        duration = 900L
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        start()
    }

/**
 * The password (or hidden network name) field: large, monospace so every
 * character can be counted, a visible cursor that the D-pad moves when the
 * field is focused (◀ ▶), scrolled so the cursor is always in view. Taps
 * place the cursor too. It draws text it is handed — the mask is decided in
 * [PasswordMask], the text lives in [KeyboardModel].
 */
@SuppressLint("ViewConstructor")
internal class FieldView(context: Context, private val ui: NetUi) : View(context) {

    var display: String = ""
        set(value) { field = value; invalidate() }
    var caret: Int = 0
        set(value) { field = value; restartBlink(); invalidate() }
    var placeholder: String = ""
        set(value) { field = value; invalidate() }
    var error: Boolean = false
        set(value) { field = value; invalidate() }

    /** A tap chose a cursor position. */
    var onCaretTapped: ((Int) -> Unit)? = null

    var focusKey: String? = null

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = ui.mono
        textSize = ui.pxf(46f)
        color = NetTheme.TEXT
        letterSpacing = 0.06f
    }
    private val hintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = ui.regular
        textSize = ui.pxf(32f)
        color = NetTheme.FAINT
    }
    private val caretPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = NetTheme.ACCENT_LIGHT }
    private val box = NetBoxDrawable(ui, 22f, NetTheme.FIELD, border = NetTheme.FIELD_BORDER, focusFill = NetTheme.FIELD, focusFill2 = NetTheme.FIELD)
    private val errorRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val rect = RectF()
    private var widths = FloatArray(0)
    private var blinkOn = true
    private val blink = object : Runnable {
        override fun run() {
            blinkOn = !blinkOn
            invalidate()
            if (isAttachedToWindow) postDelayed(this, 530L)
        }
    }

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = box
        outlineProvider = null
    }

    private fun restartBlink() {
        blinkOn = true
        removeCallbacks(blink)
        if (isAttachedToWindow) postDelayed(blink, 530L)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        restartBlink()
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(blink)
        super.onDetachedFromWindow()
    }

    private fun padX(): Float = ui.pxf(28f)

    /** Per-character advances of [display] (one glyph per character: printable ASCII or the bullet). */
    private fun measure(): FloatArray {
        if (widths.size < display.length) widths = FloatArray(display.length * 2)
        if (display.isNotEmpty()) textPaint.getTextWidths(display, widths)
        return widths
    }

    /** x of the cursor in text space (before scrolling). */
    private fun caretX(): Float {
        val w = measure()
        var x = 0f
        for (i in 0 until caret.coerceIn(0, display.length)) x += w[i]
        return x
    }

    private fun scrollFor(cx: Float, total: Float): Float {
        val avail = width - 2 * padX()
        if (total <= avail) return 0f
        // Keep the cursor inside the visible part, leaning to show the end.
        return (cx - avail * 0.85f).coerceIn(0f, total - avail).coerceAtLeast(0f)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cy = height / 2f
        if (display.isEmpty()) {
            val fm = hintPaint.fontMetrics
            canvas.drawText(placeholder, padX() + ui.pxf(16f), cy - (fm.ascent + fm.descent) / 2f, hintPaint)
        }
        val cx = caretX()
        val total = textPaint.measureText(display)
        val scroll = scrollFor(cx, total)
        canvas.save()
        canvas.clipRect(padX() * 0.5f, 0f, width - padX() * 0.5f, height.toFloat())
        val fm = textPaint.fontMetrics
        val baseline = cy - (fm.ascent + fm.descent) / 2f
        canvas.drawText(display, padX() - scroll, baseline, textPaint)
        // Steady while the person is moving it (the field has focus), blinking otherwise.
        if (blinkOn || isFocused) {
            val x = padX() - scroll + cx
            val h = textPaint.textSize * 0.64f
            rect.set(x - ui.pxf(2f), cy - h, x + ui.pxf(2f), cy + h)
            canvas.drawRoundRect(rect, ui.pxf(2f), ui.pxf(2f), caretPaint)
        }
        canvas.restore()
        if (error && !isFocused) {
            errorRing.strokeWidth = ui.pxf(3f)
            errorRing.color = NetTheme.WARN
            rect.set(0f, 0f, width.toFloat(), height.toFloat())
            rect.inset(ui.pxf(1.5f), ui.pxf(1.5f))
            canvas.drawRoundRect(rect, ui.pxf(22f), ui.pxf(22f), errorRing)
        }
    }

    override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
        translationZ = if (gainFocus) ui.pxf(12f) else 0f
        invalidate()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_UP) {
            // A tap puts the cursor between the two characters nearest the finger.
            val total = textPaint.measureText(display)
            val x = event.x - padX() + scrollFor(caretX(), total)
            val w = measure()
            var acc = 0f
            var index = display.length
            for (i in display.indices) {
                if (x < acc + w[i] / 2f) {
                    index = i
                    break
                }
                acc += w[i]
            }
            if (!isFocused) requestFocus()
            onCaretTapped?.invoke(index)
            return true
        }
        return super.onTouchEvent(event) || event.actionMasked == MotionEvent.ACTION_DOWN
    }
}

/** A small rounded label: "Connected", "Saved". */
internal fun NetUi.chip(label: String, fg: Int, bg: Int): TextView =
    text(label, 19f, fg, medium, lines = 1).apply {
        background = rounded(bg, 999f)
        setPadding(px(16), px(6), px(16), px(7))
        isDuplicateParentStateEnabled = false
    }

/** The status dot + words pill used for the health line. */
internal fun NetUi.pill(dotColor: Int, label: String, fg: Int, bg: Int): LinearLayout = row().apply {
    background = rounded(bg, 999f)
    setPadding(px(22), px(12), px(26), px(13))
    addView(View(context).apply { background = oval(dotColor) }, lp(px(16), px(16), r = px(14)))
    addView(text(label, 24f, fg, medium, lines = 2))
}

/** A frame that centres one child — the tile behind an icon. */
internal fun NetUi.tile(iconRes: Int, sizeDu: Float, iconDu: Float, bgTop: Int, bgBottom: Int, tint: Int = NetTheme.TEXT): FrameLayout =
    FrameLayout(context).apply {
        background = gradient(bgTop, bgBottom, sizeDu * 0.28f)
        addView(
            icon(iconRes, iconDu, tint).apply { layoutParams = FrameLayout.LayoutParams(px(iconDu), px(iconDu), Gravity.CENTER) },
        )
    }
