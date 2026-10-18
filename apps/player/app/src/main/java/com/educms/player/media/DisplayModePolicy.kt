package com.educms.player.media

import android.os.Build
import android.view.Display
import android.view.Window
import java.util.Locale
import kotlin.math.abs

/**
 * EXPERIMENT 5 — `prefer60hz` (player 1.1.42, plan 2026-10-17 §4E).
 *
 * M43 and L55VEC both run their 4K panel at `1:3840x2160@30.00`. A 30 fps clip
 * on a 30 Hz panel has zero headroom; on a 60 Hz mode of the SAME resolution
 * it is a clean 2:2 cadence with a whole vsync of slack. Android lets a window
 * ask for a display mode (`WindowManager.LayoutParams.preferredDisplayModeId`,
 * API 23); the panel switches mode, which can BLANK IT FOR A SECOND OR TWO —
 * so this is asked only at a native session boundary, BEFORE that session's
 * surface exists, never mid-session, and only when the manifest flag says so.
 *
 * [DisplayModePolicy] is the pure half: which mode to ask for. Same width and
 * height as the active mode, ~60 Hz (59–61), faster than the active rate —
 * never another resolution, never a lower rate; nothing when the panel already
 * runs at 59 Hz or more. Every supported mode is logged first, flag or not.
 *
 * [PreferredDisplayMode] is the window half: the request lives on the Activity
 * window (face 0) or the face Presentation's window (face 1), is kept for the
 * process lifetime while the flag stays on, and is reverted (mode id 0 = the
 * system's choice) at a session boundary once the flag is withdrawn.
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

    /** face → the mode id this process asked its window for (0 = none). UI thread. */
    private val appliedByFace = HashMap<Int, Int>()

    fun applied(face: Int): Int = appliedByFace[face] ?: 0

    /**
     * UI thread, at a session boundary BEFORE the session's surface exists.
     * Returns the mode id asked for (0 = none) and the result code.
     */
    fun request(face: Int, window: Window?, active: DisplayModeFacts?, modes: List<DisplayModeFacts>): Pair<Int, String> {
        val have = applied(face)
        if (have != 0) return Pair(have, RESULT_KEPT)
        if (active != null && active.refreshRate >= DisplayModePolicy.MIN_HZ) return Pair(0, RESULT_ALREADY_60HZ)
        val pick = DisplayModePolicy.choosePreferred60(active, modes) ?: return Pair(0, RESULT_NO_60HZ_MODE)
        if (window == null) return Pair(0, RESULT_NO_WINDOW)
        if (!set(window, pick.id)) return Pair(0, RESULT_FAILED)
        appliedByFace[face] = pick.id
        return Pair(pick.id, RESULT_APPLIED)
    }

    /** UI thread, at a session boundary with the flag withdrawn: back to the system's choice. Null when nothing was applied. */
    fun withdraw(face: Int, window: Window?): String? {
        if (applied(face) == 0) return null
        appliedByFace.remove(face)
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
