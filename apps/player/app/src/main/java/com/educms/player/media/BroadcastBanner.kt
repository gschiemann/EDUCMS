package com.educms.player.media

import org.json.JSONObject
import kotlin.math.roundToInt

/** Volatile per-document banner posture. Never persisted: an unknown hold
 * after a restart still suppresses content. Wake/brightness keep their hold. */
internal object BroadcastBanner {
    private data class Layout(val inset: Double, val rotation: Int)
    private val insets = mutableMapOf<Int, Layout>()
    private val bannerHolders = mutableSetOf<Int>()
    /** Faces whose live native output could not be PROVEN correct under a banner
     * ([BannerPosturePolicy]): their alert is a full takeover until the banner ends. */
    private val refused = mutableMapOf<Int, String>()

    @Synchronized fun inset(face: Int): Double = insets[face]?.inset ?: 0.0
    @Synchronized fun rotation(face: Int): Int = insets[face]?.rotation ?: 0
    @Synchronized fun active(face: Int): Boolean = insets.containsKey(face)
    @Synchronized fun clear(face: Int) { insets.remove(face); bannerHolders.remove(face); refused.remove(face) }

    /** Why banner posture was refused on [face], or null. */
    @Synchronized fun refusal(face: Int): String? = refused[face]

    /** Sticky until the banner ends ([clear] / an inactive [set]): the face's
     * alert becomes a full takeover, and the page is told (SharedVideoHost.stateJson). */
    @Synchronized fun refuse(face: Int, reason: String) { refused[face] = reason; bannerHolders.remove(face) }

    /** Called atomically with the display hold. Geometry alone never grants
     * playback through a hold; a missing/untrusted type is a full takeover. */
    @Synchronized fun hold(face: Int, active: Boolean, bannerOnly: Boolean, heldBefore: Boolean = false) {
        if (active && bannerOnly && face in insets && face !in refused && (!heldBefore || face in bannerHolders)) bannerHolders.add(face)
        else bannerHolders.remove(face)
    }

    /** A banner cannot downgrade a hold already raised for a real takeover. */
    @Synchronized fun set(face: Int, active: Boolean, inset: Double, holding: Set<Int>, rotation: Int = 0): Boolean {
        if (!active) { insets.remove(face); bannerHolders.remove(face); refused.remove(face); return true }
        if (!inset.isFinite() || inset !in 0.0..0.4 || rotation !in setOf(0, 90, 180, 270) || (face in holding && face !in insets)) return false
        insets[face] = Layout(inset, rotation)
        return true
    }

    /** Every holder must be a known banner; one unknown/takeover wins. */
    @Synchronized fun allowsPlayback(holding: Set<Int>): Boolean = holding.isNotEmpty() && holding.all { it in insets && it in bannerHolders && it !in refused }

    /**
     * The video box under a banner, in the WebView PARENT's own coordinates —
     * never the display's physical or natural size. On a panel Android rotates
     * to portrait (a landscape-natural HDMI box with a PORTRAIT Activity) the
     * parent is portrait and so is this box: 2160×3840 at inset 0.025 →
     * 2106×3744 at (27, 96). Proven by BroadcastBannerTest.
     */
    fun rect(width: Int, height: Int, inset: Double, rotation: Int = 0): IntArray {
        val scale = 1.0 - inset.coerceIn(0.0, 0.4)
        val w = (width * scale).roundToInt()
        val h = (height * scale).roundToInt()
        return when (rotation) {
            90 -> intArrayOf(0, (height - h) / 2, w, h)
            180 -> intArrayOf((width - w) / 2, 0, w, h)
            270 -> intArrayOf(width - w, (height - h) / 2, w, h)
            else -> intArrayOf((width - w) / 2, height - h, w, h)
        }
    }

    data class Message(val active: Boolean, val inset: Double, val rotation: Int)
    fun parse(raw: String): Message? = runCatching {
        require(raw.length <= 1024)
        val j = JSONObject(raw)
        require(j.getInt("version") == 4 && j.getString("op") == "banner")
        require(j.get("active") is Boolean && j.get("inset") is Number)
        require(j.keys().asSequence().all { it in setOf("version", "op", "active", "inset", "rotation") })
        val inset = j.getDouble("inset")
        require(inset.isFinite() && inset in 0.0..0.4)
        val rotation = if (j.has("rotation")) j.getInt("rotation") else 0
        require(rotation in setOf(0, 90, 180, 270))
        if (j.has("rotation")) require(j.get("rotation") is Number && j.getDouble("rotation") == rotation.toDouble())
        Message(j.getBoolean("active"), inset, rotation)
    }.getOrNull()
}

/**
 * May a live native video surface be moved under a broadcast banner on this box?
 *
 * 2026-11-02 on-glass evidence (owner's camera, the same broadcast):
 *  - natively PORTRAIT Amlogic t982 panels: banner drawn, native video kept
 *    playing and placed correctly — banner posture WORKS there and must stay;
 *  - a landscape-natural RK3576 HDMI box that Android ROTATES to portrait: the
 *    View geometry was right (a portrait box under the banner), yet the glass
 *    showed the video cut off at about the panel's NATURAL (landscape) height and
 *    black below. Moving a live above-window hardware-video surface mid-decode on
 *    a rotated display is composed by the vendor's compositor, which we cannot see.
 *
 * So banner posture is refused exactly where it cannot be proven: a live native
 * output on a display whose current rotation differs from its natural orientation
 * (or whose rotation cannot be read). A refusal is a FULL TAKEOVER (video stopped,
 * the page shows the full broadcast presentation): in doubt, show the alert.
 */
internal object BannerPosturePolicy {
    const val REASON_DISPLAY_ROTATED = "display-rotated"
    const val REASON_ROTATION_UNKNOWN = "display-rotation-unknown"

    /** Null = banner posture allowed; otherwise the stable reason it is refused.
     * [displayRotation] is Display.getRotation() (Surface.ROTATION_*); null = unreadable. */
    fun refusal(liveNativeOutput: Boolean, displayRotation: Int?): String? = when {
        !liveNativeOutput -> null
        displayRotation == null -> REASON_ROTATION_UNKNOWN
        displayRotation != 0 -> REASON_DISPLAY_ROTATED
        else -> null
    }
}
