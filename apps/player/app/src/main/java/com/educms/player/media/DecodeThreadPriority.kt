package com.educms.player.media

import android.os.Process
import com.educms.player.logging.PlayerLogger

/**
 * Thread priorities for the native video engine (1.1.45, GUQ decode stalls).
 *
 * The decode/pump thread feeds the hardware decoder's input from disk and
 * releases each output at its vsync. It ran at the default priority (nice 0),
 * level with the WebView renderer, the service worker's SHA-256 passes and the
 * file download/verify worker. Field evidence on the t982 class: exact vsync
 * snapping, yet 0.5–0.8 s holes between submissions in sessions that started
 * right after a page (re)load — the window where the page is busiest. The pump
 * now asks for the display class's priority (the one SurfaceFlinger's own
 * clients use), and the engine's file download / verify / switch-read workers
 * drop to background, so a big copy or a whole-file hash can never take the
 * cores from a presenting decoder.
 *
 * Android's raw values (android.os.Process) are pinned here so the order is
 * testable on the JVM: URGENT_DISPLAY = -8, DISPLAY = -4, BACKGROUND = 10.
 */
internal object DecodeThreadPriority {
    const val URGENT_DISPLAY = -8
    const val DISPLAY = -4
    const val DEFAULT = 0
    const val BACKGROUND = 10

    /** Tried in order; the first the kernel accepts wins. */
    val DECODE_LADDER = intArrayOf(URGENT_DISPLAY, DISPLAY)

    /** The first priority of [ladder] that [set] accepts, or [DEFAULT] when none is (never throws). */
    fun apply(ladder: IntArray, set: (Int) -> Unit): Int {
        for (p in ladder) {
            try { set(p); return p } catch (_: Throwable) { /* not allowed here: try the next */ }
        }
        return DEFAULT
    }

    /** On the decode thread itself, first thing. */
    fun raiseDecodeThread(tag: String) {
        val got = apply(DECODE_LADDER) { Process.setThreadPriority(it) }
        PlayerLogger.i("FaceVideoRenderer", "PLAYER_NATIVE_VIDEO_THREAD $tag priority=$got")
    }

    /** A thread factory body for the engine's background I/O workers. */
    fun background(r: Runnable): Runnable = Runnable {
        apply(intArrayOf(BACKGROUND)) { Process.setThreadPriority(it) }
        r.run()
    }
}
