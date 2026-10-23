package com.educms.player.media

import org.json.JSONObject

/**
 * A NATIVE-FIRST FACE STARTS WITHOUT THE API (player 1.1.51, Astra P1).
 *
 * THE HOLE. `FaceVideoBox.select()` read this face's manifest LIVE on every
 * start. An enrolled face whose app could not reach the API at boot (power
 * came back before the network, a nightly reboot behind a slow uplink, an
 * outage) ended `manifest-unreachable` → NOT_READY → the page waited — and
 * since native-first paints no web `<video>` for a face it has decided native,
 * the slot was BLACK until the API answered. The verified file was on disk
 * the whole time.
 *
 * THE RULE. Every successful LIVE, authenticated `select()` persists what it
 * selected — the face, the screen the credential named, the raw `nativeVideo`
 * descriptor — as the face's LAST AUTHENTICATED SELECTION. When the live read
 * fails in a way that means "the API could not be reached" (never "this
 * credential or screen was refused"), the face may start from that selection,
 * against the verified disk copy, iff ALL of:
 *   - no emergency hold is engaged (checked FIRST — a persisted hold raises,
 *     and nothing starts under it; `begin()` refuses too);
 *   - the face's current credential still names the requested screen;
 *   - the saved selection is for this face and this screen;
 *   - the saved descriptor is exactly what the page asked for
 *     (`FaceVideoDescriptor.matches`: screen, revision, sha256, asset).
 * The file itself is still subject to `SharedVideoSource.verifiedFile` (size +
 * SHA-256 verified on disk, or no play), and a cached selection teaches the
 * face NOTHING about its native-first switch (`learnSwitch` is live-only). A
 * cached selection never touches the hold: it may never release an alert.
 *
 * Pure Kotlin + org.json; `FaceVideoBox` owns the prefs and the clock.
 */
internal object OfflineSelection {
    private const val VERSION = 1

    /** A saved selection, as persisted. */
    data class Saved(val face: Int, val screenId: String, val nativeVideo: JSONObject, val savedAtMs: Long)

    fun encode(face: Int, screenId: String, nativeVideo: JSONObject, nowMs: Long): String =
        JSONObject().put("v", VERSION).put("face", face).put("screen", screenId).put("at", nowMs)
            .put("nativeVideo", nativeVideo).toString()

    fun decode(raw: String?): Saved? = runCatching {
        val j = JSONObject(raw ?: return null)
        if (j.optInt("v") != VERSION) return null
        Saved(j.getInt("face"), j.getString("screen"), j.getJSONObject("nativeVideo"), j.optLong("at"))
    }.getOrNull()

    /**
     * Did the LIVE read fail because the API could not be REACHED? Only such a
     * failure may fall back to disk. A code that means the credential, the
     * screen or the descriptor was REFUSED (`manifest-http-401/403/404`,
     * `credential-*`, `api-*`, `descriptor-*`, `selection-changed`) never does:
     * a revoked screen must not keep playing from its cache.
     */
    fun unreachable(e: Throwable): Boolean {
        val code = e.message?.takeIf { Regex("[a-z0-9-]{1,64}").matches(it) }
        if (code == null) return e is java.io.IOException
        if (code == "manifest-unreachable" || code == "timeout") return true
        val http = Regex("manifest-http-([0-9]{3})").matchEntire(code)?.groupValues?.get(1)?.toIntOrNull() ?: return false
        return http == 408 || http == 429 || http >= 500
    }

    data class Outcome(val descriptor: FaceVideoDescriptor?, val reason: String)

    fun accept(saved: Saved?, face: Int, tokenScreenId: String?, request: FaceVideoRequest, held: Boolean): Outcome {
        if (held) return Outcome(null, "emergency-held")
        if (saved == null) return Outcome(null, "no-saved-selection")
        if (tokenScreenId == null) return Outcome(null, "credential-missing")
        if (!tokenScreenId.equals(request.screenId, ignoreCase = true)) return Outcome(null, "credential-identity")
        if (saved.face != face) return Outcome(null, "selection-face")
        if (!saved.screenId.equals(request.screenId, ignoreCase = true)) return Outcome(null, "selection-screen")
        val d = runCatching { FaceVideoDescriptor.parse(saved.nativeVideo) }.getOrNull()
            ?: return Outcome(null, "descriptor-invalid")
        if (d.faceIndex != face || !d.matches(request)) return Outcome(null, "selection-changed")
        return Outcome(d, "ok")
    }
}
