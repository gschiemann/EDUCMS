package com.educms.player.media

import org.json.JSONObject

/**
 * THE THREE M43 EXPERIMENTS (plan 2026-10-17 §4E), as manifest flags.
 *
 * Each is OFF unless this screen's own authenticated `nativeVideo` descriptor
 * says otherwise (`experiments: { … }`, set per screen by the API's
 * `PLAYER_NATIVE_VIDEO_EXPERIMENTS`), each is switchable on its own, and none
 * may blank the display:
 *  1. [webviewInvisible] — the player WebView goes INVISIBLE while a solo
 *     native session presents (a 4K WebView off the GPU); VISIBLE again on
 *     ANY end, and FIRST of all on an emergency hold.
 *  2. [surfaceFrameRate] — `Surface.setFrameRate(fps, ONLY_IF_SEAMLESS)` on
 *     API 30+: a refresh-rate change only when the display can do it without
 *     a mode switch; otherwise nothing changes.
 *  3. [decoderRotation] — the Activity stays in the panel's NATURAL
 *     orientation and the decoder rotates the picture (so the video layer is
 *     an unrotated overlay for the hardware composer). The page requests it
 *     through the existing `setOrientation` bridge value `NATURAL`.
 *
 * The flags ride OUTSIDE the descriptor's `revision`, so flipping one never
 * restarts a session that is on the glass; it applies to the next session.
 */
internal data class NativeVideoExperiments(
    val webviewInvisible: Boolean = false,
    val surfaceFrameRate: Boolean = false,
    val decoderRotation: Boolean = false,
) {
    val any: Boolean get() = webviewInvisible || surfaceFrameRate || decoderRotation

    fun toJson(): JSONObject = JSONObject()
        .put(WEBVIEW_INVISIBLE, webviewInvisible)
        .put(SURFACE_FRAME_RATE, surfaceFrameRate)
        .put(DECODER_ROTATION, decoderRotation)

    companion object {
        const val WEBVIEW_INVISIBLE = "webviewInvisible"
        const val SURFACE_FRAME_RATE = "surfaceFrameRate"
        const val DECODER_ROTATION = "decoderRotation"
        val NONE = NativeVideoExperiments()

        /** Absent, malformed or anything but a JSON `true` reads as OFF; unknown keys are ignored. */
        fun parse(j: JSONObject?): NativeVideoExperiments {
            if (j == null) return NONE
            fun on(key: String): Boolean = j.opt(key) == true
            return NativeVideoExperiments(on(WEBVIEW_INVISIBLE), on(SURFACE_FRAME_RATE), on(DECODER_ROTATION))
        }
    }
}

/**
 * Process-wide fault latch for the experiments. An experiment that was
 * applied to a presenting session which then ended for a reason the hidden
 * or re-timed page could have caused (its lease expired, its output stalled)
 * is switched OFF for the rest of the process: one visible flip at most,
 * never a storm, and the next session plays exactly as 1.1.40 did. The
 * owner's rule — never flip web ↔ native on the glass — is what this bounds.
 * Reported on `sharedVideoState` so the dashboard sees a tripped guard.
 */
internal class NativeExperimentGuard {
    private val disabled = LinkedHashMap<String, String>()
    private val applied = LinkedHashMap<String, Long>()

    @Synchronized fun allows(name: String): Boolean = !disabled.containsKey(name)

    @Synchronized fun applied(name: String) { applied[name] = (applied[name] ?: 0L) + 1L }

    /** The end of a session that had [name] applied. True when this end tripped the guard. */
    @Synchronized fun ended(name: String, reason: String): Boolean {
        if (reason !in FAULTS || disabled.containsKey(name)) return false
        disabled[name] = reason
        return true
    }

    @Synchronized fun disabledReason(name: String): String? = disabled[name]

    @Synchronized fun toJson(): JSONObject {
        val d = JSONObject(); disabled.forEach { (k, v) -> d.put(k, v) }
        val a = JSONObject(); applied.forEach { (k, v) -> a.put(k, v) }
        return JSONObject().put("disabled", d).put("applied", a)
    }

    companion object {
        /** Ends that mean the page behind the experiment could not keep its side of the contract. */
        val FAULTS: Set<String> = setOf("page-lease-expired", "output-stalled", "output-unavailable", "codec-stalled")
    }
}
