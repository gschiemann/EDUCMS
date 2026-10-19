package com.educms.player.media

import android.content.Context
import android.os.Build
import android.os.Handler
import android.view.Choreographer
import android.view.Display
import android.view.Window
import java.util.Locale
import kotlin.math.abs

/**
 * THE 60 Hz MODE REQUEST (player 1.1.42 as experiment 5, AUTOMATIC since 1.1.43).
 *
 * A 30 fps clip on a 30 Hz panel has zero headroom; on a 60 Hz mode of the
 * SAME resolution it is a clean 2:2 cadence with a whole vsync of slack.
 * Android lets a window ask for a display mode
 * (`WindowManager.LayoutParams.preferredDisplayModeId`, API 23); the panel
 * switches mode, which can BLANK IT FOR A SECOND OR TWO — so this is asked
 * only at a native session boundary, BEFORE that session's surface exists,
 * never mid-session, never under an emergency hold, never for a positioned
 * slot, and ONCE per process (the first boundary after boot) — while the web
 * engine still shows the content.
 *
 * [DisplayModePolicy] is the pure half: which mode to ask for. Same width and
 * height as the active mode, ~60 Hz (59–61), faster than the active rate —
 * never another resolution, never a lower rate; nothing when the panel already
 * runs at 59 Hz or more. Every supported mode is logged first, flag or not.
 *
 * [PreferredDisplayMode] is the window half: the request lives on the Activity
 * window (face 0) or the face Presentation's window (face 1), is kept for the
 * process lifetime, and is reverted (mode id 0 = the system's choice) at a
 * session boundary once the kill switch withdraws it — or by the SAFETY NET:
 * after a request the active mode must change AND the display must keep
 * producing frames within [CONFIRM_WINDOW_MS] ([verdict]), and the first
 * native frame rendered after the switch confirms it ([confirm]); a session
 * that stalls before any native frame is the switch's failure, not the file's
 * (FaceVideoBox.watch). A failed request is reverted, reported as one of the
 * `reverted-*` codes, and the AUTOMATIC request is blocked on this unit for
 * [BLOCK_MS] ([Prefer60HzBlock], persisted across reboots). Nothing asks past
 * the block or past the once-per-process rule: a manifest key can only switch
 * the request off ([Prefer60Hz.OFF]), never force one.
 */
internal data class DisplayModeFacts(val id: Int, val width: Int, val height: Int, val refreshRate: Float) {
    /** `modeId:WxH@Hz`, the shape every `displayMode` field already uses. */
    fun label(): String = "$id:${width}x$height@${String.format(Locale.ROOT, "%.2f", refreshRate)}"

    companion object {
        fun of(m: Display.Mode?): DisplayModeFacts? =
            m?.let { DisplayModeFacts(it.modeId, it.physicalWidth, it.physicalHeight, it.refreshRate) }
    }
}

internal object DisplayModePolicy {
    const val TARGET_HZ = 60f
    const val MIN_HZ = 59f
    const val MAX_HZ = 61f
    /** Bound on the list every snapshot carries. */
    const val MAX_MODES = 16

    /**
     * The ~60 Hz mode with the active mode's exact resolution that is closest to
     * 60.00 Hz, or null: nothing to ask when the panel already runs at
     * [MIN_HZ] or faster, when no such mode exists, or when the active mode is
     * unknown. A different resolution or a lower rate is never chosen.
     */
    fun choosePreferred60(active: DisplayModeFacts?, modes: List<DisplayModeFacts>): DisplayModeFacts? {
        if (active == null || active.refreshRate >= MIN_HZ) return null
        return modes.filter {
            it.width == active.width && it.height == active.height &&
                it.refreshRate >= MIN_HZ && it.refreshRate <= MAX_HZ && it.refreshRate > active.refreshRate
        }.minByOrNull { abs(it.refreshRate - TARGET_HZ) }
    }

    /** Bounded labels for the snapshot: at most [MAX_MODES], the active mode's resolution first. */
    fun labels(active: DisplayModeFacts?, modes: List<DisplayModeFacts>): List<String> =
        modes.sortedWith(compareByDescending<DisplayModeFacts> { active != null && it.width == active.width && it.height == active.height }
            .thenBy { it.id }).take(MAX_MODES).map { it.label() }

    /** What the panel offers, read from a Display (API 23+). Never throws; unknown = (null, empty). */
    fun read(display: Display?): Pair<DisplayModeFacts?, List<DisplayModeFacts>> = runCatching {
        val d = display ?: return@runCatching Pair(null, emptyList())
        val active = DisplayModeFacts.of(d.mode)
        val modes = d.supportedModes.mapNotNull { DisplayModeFacts.of(it) }
        Pair(active, modes)
    }.getOrDefault(Pair(null, emptyList()))
}

/**
 * The persisted 24-hour block on the AUTOMATIC request, per unit. Written by
 * the safety net when a switch was reverted; read at every boundary; survives
 * a reboot (the panels reboot nightly on an OEM schedule). Never written by a
 * successful switch, never by the kill switch.
 */
internal object Prefer60HzBlock {
    const val PREFS = "native_video_display"
    const val KEY_UNTIL = "prefer60hz.blockedUntil"
    const val KEY_REASON = "prefer60hz.blockReason"

    /** The instant (epoch ms) a standing block ends, or 0 when none stands at [nowMs]. Never throws. */
    fun blockedUntil(ctx: Context, nowMs: Long): Long = runCatching {
        val until = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_UNTIL, 0L)
        if (until > nowMs) until else 0L
    }.getOrDefault(0L)

    fun reason(ctx: Context): String? = runCatching {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_REASON, null)
    }.getOrNull()

    fun block(ctx: Context, untilMs: Long, reason: String) {
        runCatching {
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(KEY_UNTIL, untilMs).putString(KEY_REASON, reason.take(64)).apply()
        }
    }
}

internal object PreferredDisplayMode {
    const val RESULT_APPLIED = "applied"
    /** Already asked for in this process; nothing to do at this boundary. */
    const val RESULT_KEPT = "kept"
    const val RESULT_ALREADY_60HZ = "already-60hz"
    const val RESULT_NO_60HZ_MODE = "no-60hz-mode"
    const val RESULT_NO_WINDOW = "no-window"
    const val RESULT_FAILED = "failed"
    const val RESULT_REVERTED = "reverted"
    /** Another session of this face is attached: this boundary is mid-session for it, nothing is asked. */
    const val RESULT_OTHER_SESSION = "other-session"
    /** 1.1.43: the automatic request is blocked on this unit (a switch was reverted within the last 24 h). */
    const val RESULT_BLOCKED = "blocked"
    /** 1.1.43: the panel never changed to the requested mode within the window; reverted, blocked. */
    const val RESULT_REVERTED_NO_SWITCH = "reverted-no-switch"
    /** 1.1.43: the mode changed but no frame was produced within the window (or before the first native frame); reverted, blocked. */
    const val RESULT_REVERTED_NO_FRAMES = "reverted-no-frames"
    /** 1.1.43: an emergency hold stood at this boundary; nothing is asked under a hold. */
    const val RESULT_EMERGENCY_HELD = "emergency-held"

    /** Every code this object can answer with (the dashboard's catalogue). */
    val RESULTS: List<String> = listOf(RESULT_APPLIED, RESULT_KEPT, RESULT_ALREADY_60HZ, RESULT_NO_60HZ_MODE, RESULT_NO_WINDOW,
        RESULT_FAILED, RESULT_REVERTED, RESULT_OTHER_SESSION, RESULT_BLOCKED, RESULT_REVERTED_NO_SWITCH, RESULT_REVERTED_NO_FRAMES,
        RESULT_EMERGENCY_HELD)

    /** How long the automatic request stays blocked on a unit after a reverted switch. */
    const val BLOCK_MS = 24L * 60L * 60L * 1000L
    /** The safety net's window: the mode must have changed and frames must flow this long after the request. */
    const val CONFIRM_WINDOW_MS = 10_000L
    /** "Frames flow" = a Choreographer frame within this of the check. */
    const val FRAME_RECENT_NS = 2_000_000_000L

    /** A request this process made and the glass has not yet proven: its face, the mode asked for, the mode before it, when. */
    data class Pending(val face: Int, val modeId: Int, val fromModeId: Int, val atMs: Long)

    /** face → the mode id this process asked its window for (0 = none). UI thread. */
    private val appliedByFace = HashMap<Int, Int>()
    /** face → the result of the ONE request this process made (once per process; a later boundary repeats it). */
    private val attemptedByFace = HashMap<Int, String>()
    @Volatile private var pendingRequest: Pending? = null

    fun applied(face: Int): Int = appliedByFace[face] ?: 0
    fun attempted(face: Int): String? = attemptedByFace[face]
    val pending: Pending? get() = pendingRequest

    /**
     * UI thread, at a session boundary BEFORE the session's surface exists.
     * Returns the mode id asked for (0 = none) and the result code. Only the
     * automatic request comes here (the kill switch withdraws instead); a
     * standing block ([blockedUntilMs] > [nowMs]) refuses it, always.
     */
    fun request(
        face: Int, window: Window?, active: DisplayModeFacts?, modes: List<DisplayModeFacts>,
        blockedUntilMs: Long = 0L, nowMs: Long = 0L,
    ): Pair<Int, String> {
        val have = applied(face)
        if (have != 0) return Pair(have, RESULT_KEPT)
        if (active != null && active.refreshRate >= DisplayModePolicy.MIN_HZ) return Pair(0, RESULT_ALREADY_60HZ)
        val pick = DisplayModePolicy.choosePreferred60(active, modes) ?: return Pair(0, RESULT_NO_60HZ_MODE)
        // Once per process: a request that was made (and failed, or was reverted) is not made again.
        attemptedByFace[face]?.let { return Pair(0, it) }
        if (blockedUntilMs > nowMs) return Pair(0, RESULT_BLOCKED)
        if (window == null) return Pair(0, RESULT_NO_WINDOW)
        if (!set(window, pick.id)) { attemptedByFace[face] = RESULT_FAILED; return Pair(0, RESULT_FAILED) }
        appliedByFace[face] = pick.id
        attemptedByFace[face] = RESULT_APPLIED
        pendingRequest = Pending(face, pick.id, active?.id ?: 0, nowMs)
        return Pair(pick.id, RESULT_APPLIED)
    }

    /**
     * The safety net's verdict at the end of the window, pure: null = the switch is proven so far
     * (the panel runs the requested mode and frames flow); otherwise the `reverted-*` code to apply.
     */
    fun verdict(p: Pending, activeNow: DisplayModeFacts?, lastFrameNs: Long, nowNs: Long): String? = when {
        activeNow == null || activeNow.id != p.modeId -> RESULT_REVERTED_NO_SWITCH
        lastFrameNs <= 0L || nowNs - lastFrameNs > FRAME_RECENT_NS -> RESULT_REVERTED_NO_FRAMES
        else -> null
    }

    /** A native frame was rendered on [face] after the request: the switch is confirmed; nothing is pending any more. */
    fun confirm(face: Int): Boolean {
        val p = pendingRequest ?: return false
        if (p.face != face) return false
        pendingRequest = null
        return true
    }

    /** Any thread: the safety net gave up on the pending request of [face] (the UI-thread [revert] follows). */
    fun abandon(face: Int) {
        if (pendingRequest?.face == face) pendingRequest = null
    }

    /**
     * UI thread. The safety net reverts a request this process made: back to
     * the system's choice, the verdict remembered for this process (no second
     * request), nothing pending. Returns the window result (reverted / failed).
     */
    fun revert(face: Int, window: Window?, verdict: String): String {
        appliedByFace.remove(face)
        attemptedByFace[face] = verdict
        if (pendingRequest?.face == face) pendingRequest = null
        return if (window != null && set(window, 0)) RESULT_REVERTED else RESULT_FAILED
    }

    /** UI thread, at a session boundary with the kill switch on: back to the system's choice. Null when nothing was applied. */
    fun withdraw(face: Int, window: Window?): String? {
        if (applied(face) == 0) return null
        appliedByFace.remove(face)
        if (pendingRequest?.face == face) pendingRequest = null
        return if (window != null && set(window, 0)) RESULT_REVERTED else RESULT_FAILED
    }

    private fun set(window: Window, modeId: Int): Boolean = runCatching {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@runCatching false
        val lp = window.attributes
        lp.preferredDisplayModeId = modeId
        window.attributes = lp
        true
    }.getOrDefault(false)
}

/**
 * Proof that the display keeps producing frames after a mode request: one
 * Choreographer callback per vsync, re-posted only while the safety net's
 * window is open (at most ~10 s), recording the last frame stamp. UI thread.
 * A panel that goes dark while the compositor runs still produces frames —
 * this proves the pipeline, not the glass (rule 10); the native session's own
 * render callback is the second half of the proof (FaceVideoBox.updated).
 */
internal class ModeSwitchFrameWatch(private val main: Handler) {
    @Volatile var lastFrameNs = 0L; private set
    @Volatile var frames = 0L; private set
    private var active = false
    private val callback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!active) return
            lastFrameNs = frameTimeNanos
            frames++
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /** UI thread. Start (or restart) watching; stops itself after [windowMs]. */
    fun start(windowMs: Long) {
        lastFrameNs = 0L; frames = 0L
        if (!active) {
            active = true
            Choreographer.getInstance().postFrameCallback(callback)
        }
        main.postDelayed({ active = false }, windowMs + 500L)
    }

    fun stop() { active = false }
}
