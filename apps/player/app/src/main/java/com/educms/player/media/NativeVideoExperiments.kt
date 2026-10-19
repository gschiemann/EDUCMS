package com.educms.player.media

import org.json.JSONObject

/**
 * THE NATIVE VIDEO ENGINE'S SWITCHES (plan 2026-10-17 §4E), as manifest flags.
 *
 * Since 1.1.43 the engine DECIDES ITS OWN DEFAULTS from the device's facts
 * (owner rule 2026-10-18: "make sure it auto detects, I don't want another
 * setting"); a manifest key is only ever the lead's kill switch or test
 * override, and an absent key means "the APK's default". Nothing here may
 * blank the display without its own safety net.
 *
 * The three M43 experiments of 1.1.41, OFF unless this screen's own
 * authenticated `nativeVideo` descriptor says exactly `true`:
 *  1. [webviewInvisible] — the player WebView goes INVISIBLE while a solo
 *     native session presents (a 4K WebView off the GPU); VISIBLE again on
 *     ANY end, and FIRST of all on an emergency hold. Measured 2026-10-18 on
 *     the M43: no gain. Stays off.
 *  2. [surfaceFrameRate] — `Surface.setFrameRate(fps, ONLY_IF_SEAMLESS)` on
 *     API 30+: a refresh-rate change only when the display can do it without
 *     a mode switch; otherwise nothing changes.
 *  3. [decoderRotation] — the Activity stays in the panel's NATURAL
 *     orientation and the decoder rotates the picture (so the video layer is
 *     an unrotated overlay for the hardware composer). The page requests it
 *     through the existing `setOrientation` bridge value `NATURAL`.
 *
 * The two pacing behaviours of 1.1.42, DEFAULT ON since 1.1.43 (field
 * 2026-10-18: the snap took the M43's late frames from 20–35/h to under 1/h
 * over 11 h with zero drops, and left the clean L55VEC clean):
 *  4. [vsyncSnap] — every output is released at the vsync closest to the
 *     frame's due time, from a Choreographer-measured period and phase, with
 *     a grid-sized lead and a bounded media-clock slew (VsyncClock.kt,
 *     VideoFrameSchedule). ON for every protocol-2 session unless the
 *     descriptor says exactly `false` (the lead's `-vsync-snap:<…>` kill
 *     switch); `true` is accepted and changes nothing. The process-wide fault
 *     guard covers it as before.
 *  5. [prefer60hz] — when the panel lists a ~60 Hz mode of the SAME
 *     resolution, ask for it through `Window.preferredDisplayModeId` once per
 *     process, on the default display's face, at the first native session
 *     boundary after boot, before that session's surface exists
 *     (DisplayModePolicy.kt). [Prefer60Hz.AUTO] is
 *     the default: the request is made, then PROVEN — the active mode must
 *     change and the display must keep producing frames within 10 s, or the
 *     mode is reverted and the automatic request is blocked on this unit for
 *     24 h. [Prefer60Hz.OFF] is the kill switch (`-prefer-60hz:<…>`, sends
 *     `false`); `true` (the 1.1.42 positive token, still accepted) changes
 *     nothing — a manifest key can only REMOVE the behaviour, never force a
 *     request past the safety net's block. A mode switch can blank the panel
 *     for a second or two, which is why it happens only at a boundary, while
 *     the web engine still shows the content.
 *
 * The flags ride OUTSIDE the descriptor's `revision`, so flipping one never
 * restarts a session that is on the glass; it applies to the next session.
 */
internal enum class Prefer60Hz(val wire: String) {
    /** The lead's kill switch: never ask; a mode this process asked for is reverted at the next boundary. */
    OFF("off"),
    /** The default: ask once per process when the panel offers a same-resolution ~60 Hz mode and no block stands. */
    AUTO("auto");

    companion object {
        /** Exactly a JSON `false` = OFF (the kill switch); anything else — absent, `true`, garbage — = AUTO. */
        fun parse(v: Any?): Prefer60Hz = if (v == false) OFF else AUTO
    }
}

internal data class NativeVideoExperiments(
    val webviewInvisible: Boolean = false,
    val surfaceFrameRate: Boolean = false,
    val decoderRotation: Boolean = false,
    /** 1.1.43: ON unless the descriptor says exactly `false`. */
    val vsyncSnap: Boolean = true,
    /** 1.1.43: AUTO unless the descriptor says exactly `false` (OFF). */
    val prefer60hz: Prefer60Hz = Prefer60Hz.AUTO,
) {
    /** Whether anything at all is in effect for a session (with the 1.1.43 defaults, always). */
    val any: Boolean get() = webviewInvisible || surfaceFrameRate || decoderRotation || vsyncSnap || prefer60hz != Prefer60Hz.OFF

    /**
     * The `requested` block of the session report: what is in effect, as
     * booleans the dashboard already reads. `prefer60hz` is written by the
     * session from what its boundary decided ([FaceVideoBox]); here it is
     * simply "not switched off".
     */
    fun toJson(): JSONObject = JSONObject()
        .put(WEBVIEW_INVISIBLE, webviewInvisible)
        .put(SURFACE_FRAME_RATE, surfaceFrameRate)
        .put(DECODER_ROTATION, decoderRotation)
        .put(VSYNC_SNAP, vsyncSnap)
        .put(PREFER_60HZ, prefer60hz != Prefer60Hz.OFF)

    companion object {
        const val WEBVIEW_INVISIBLE = "webviewInvisible"
        const val SURFACE_FRAME_RATE = "surfaceFrameRate"
        const val DECODER_ROTATION = "decoderRotation"
        const val VSYNC_SNAP = "vsyncSnap"
        const val PREFER_60HZ = "prefer60hz"
        /** Every flag this build knows; anything else in the descriptor object is ignored. */
        val KNOWN: List<String> = listOf(WEBVIEW_INVISIBLE, SURFACE_FRAME_RATE, DECODER_ROTATION, VSYNC_SNAP, PREFER_60HZ)
        /** The APK's own defaults: the three experiments off, the snap on, the 60 Hz request automatic. */
        val NONE = NativeVideoExperiments()

        /**
         * The three experiments: absent, malformed or anything but a JSON `true`
         * reads as OFF. The two defaults: absent or malformed reads as the
         * default, a JSON `false` switches off, a JSON `true` is accepted and
         * changes nothing (a key can only remove a default). Unknown keys are ignored.
         */
        fun parse(j: JSONObject?): NativeVideoExperiments {
            if (j == null) return NONE
            fun on(key: String): Boolean = j.opt(key) == true
            return NativeVideoExperiments(
                on(WEBVIEW_INVISIBLE), on(SURFACE_FRAME_RATE), on(DECODER_ROTATION),
                vsyncSnap = j.opt(VSYNC_SNAP) != false,
                prefer60hz = Prefer60Hz.parse(j.opt(PREFER_60HZ)),
            )
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
