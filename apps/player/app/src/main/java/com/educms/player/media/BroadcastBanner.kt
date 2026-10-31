package com.educms.player.media

import org.json.JSONObject
import kotlin.math.roundToInt

/** Volatile per-document banner posture. Never persisted: an unknown hold
 * after a restart still suppresses content. Wake/brightness keep their hold. */
internal object BroadcastBanner {
    private data class Layout(val inset: Double, val rotation: Int)
    private val insets = mutableMapOf<Int, Layout>()
    private val bannerHolders = mutableSetOf<Int>()

    @Synchronized fun inset(face: Int): Double = insets[face]?.inset ?: 0.0
    @Synchronized fun rotation(face: Int): Int = insets[face]?.rotation ?: 0
    @Synchronized fun active(face: Int): Boolean = insets.containsKey(face)
    @Synchronized fun clear(face: Int) { insets.remove(face); bannerHolders.remove(face) }

    /** Called atomically with the display hold. Geometry alone never grants
     * playback through a hold; a missing/untrusted type is a full takeover. */
    @Synchronized fun hold(face: Int, active: Boolean, bannerOnly: Boolean, heldBefore: Boolean = false) {
        if (active && bannerOnly && face in insets && (!heldBefore || face in bannerHolders)) bannerHolders.add(face)
        else bannerHolders.remove(face)
    }

    /** A banner cannot downgrade a hold already raised for a real takeover. */
    @Synchronized fun set(face: Int, active: Boolean, inset: Double, holding: Set<Int>, rotation: Int = 0): Boolean {
        if (!active) { insets.remove(face); bannerHolders.remove(face); return true }
        if (!inset.isFinite() || inset !in 0.0..0.4 || rotation !in setOf(0, 90, 180, 270) || (face in holding && face !in insets)) return false
        insets[face] = Layout(inset, rotation)
        return true
    }

    /** Every holder must be a known banner; one unknown/takeover wins. */
    @Synchronized fun allowsPlayback(holding: Set<Int>): Boolean = holding.isNotEmpty() && holding.all { it in insets && it in bannerHolders }

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
