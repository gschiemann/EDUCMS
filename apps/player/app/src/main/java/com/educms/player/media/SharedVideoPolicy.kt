package com.educms.player.media

import org.json.JSONObject
import java.net.URI

/** Pure, fail-closed wire contract. This descriptor must come from native authenticated HTTP. */
internal data class SharedVideoDescriptor(
    val screenId: String, val tenantId: String, val primaryScreenId: String, val peerScreenId: String,
    val faceIndex: Int, val revision: String, val assetId: String, val url: String, val sha256: String,
    val size: Long, val width: Int, val height: Int, val fps: Double, val orientation: String, val rotation: Int,
) {
    fun agrees(other: SharedVideoDescriptor): Boolean =
        screenId == other.peerScreenId && peerScreenId == other.screenId &&
        tenantId == other.tenantId && primaryScreenId == other.primaryScreenId &&
        setOf(faceIndex, other.faceIndex) == setOf(0, 1) && revision == other.revision &&
        assetId == other.assetId && sha256 == other.sha256 && size == other.size &&
        width == other.width && height == other.height && fps == other.fps

    companion object {
        private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        fun parse(j: JSONObject): SharedVideoDescriptor {
            require(j.getInt("version") == 1) { "descriptor-version" }
            fun id(key: String): String = j.getString(key).also { require(uuid.matches(it)) { "descriptor-identity" } }
            val a = j.getJSONObject("asset")
            val t = j.getJSONObject("transform")
            val d = SharedVideoDescriptor(id("screenId"), id("tenantId"), id("primaryScreenId"), id("peerScreenId"),
                j.getInt("faceIndex"), j.getString("revision"), a.getString("id"), a.getString("url"),
                a.getString("sha256"), a.getLong("size"), a.getInt("width"), a.getInt("height"),
                a.getDouble("fps"), t.getString("orientation"), t.getInt("rotation"))
            require(d.faceIndex in 0..1 && d.screenId != d.peerScreenId) { "descriptor-face" }
            require(if (d.faceIndex == 0) d.screenId == d.primaryScreenId else d.peerScreenId == d.primaryScreenId) { "descriptor-parent" }
            require(d.revision.length in 1..128 && uuid.matches(d.assetId)) { "descriptor-revision" }
            require(Regex("[a-f0-9]{64}").matches(d.sha256)) { "descriptor-digest" }
            require(d.size in 1..SharedVideoSourcePolicy.MAX_BYTES && d.width in 16..4096 && d.height in 16..4096 &&
                d.fps.isFinite() && d.fps > 0 && d.fps <= 30) { "descriptor-format" }
            require(t.getString("fit") == "fill" && d.orientation in setOf("PORTRAIT", "LANDSCAPE", "AUTO") &&
                d.rotation in setOf(0, 90, 180, 270)) { "descriptor-transform" }
            require(SharedVideoSourcePolicy.allowed(d.url)) { "media-origin" }
            return d
        }
    }
}

internal object SharedVideoSourcePolicy {
    const val MAX_BYTES = 512L * 1024 * 1024
    fun allowed(value: String): Boolean = runCatching {
        val u = URI(value)
        u.scheme == "https" && u.host == "bhdaxzfalaycfopvcopm.supabase.co" &&
            u.userInfo == null && (u.port == -1 || u.port == 443) && u.fragment == null &&
            (u.rawPath.startsWith("/storage/v1/object/public/assets/") ||
                u.rawPath.startsWith("/storage/v1/object/sign/assets/")) &&
            !u.rawPath.contains("..") && !u.rawPath.contains('%') && !u.rawPath.contains('\\')
    }.getOrDefault(false)
}

internal object SharedVideoTransform {
    fun degrees(orientation: String,rotation: Int,outputWidth: Int,outputHeight: Int): Int =
        (rotation + if (orientation == "PORTRAIT" && outputWidth > outputHeight) 90
            else if (orientation == "LANDSCAPE" && outputHeight > outputWidth) 270 else 0) % 360
    /** Texture coordinates; decoder crop/vertical transform is subsequently applied by GL. */
    fun coordinates(orientation: String, rotation: Int, outputWidth: Int, outputHeight: Int): FloatArray {
        val quarter = degrees(orientation,rotation,outputWidth,outputHeight)/90
        val corners = arrayOf(floatArrayOf(0f, 0f), floatArrayOf(1f, 0f), floatArrayOf(0f, 1f), floatArrayOf(1f, 1f))
        return corners.flatMap { p ->
            var x = p[0]; var y = p[1]
            repeat(quarter) { val oldX = x; x = 1f - y; y = oldX }
            listOf(x, y)
        }.toFloatArray()
    }
}

/** No decoder is admitted until both exact session participants surrender their HTML decoder. */
internal class SharedVideoCommitGate(private val session: String, private val faces: Set<Int>) {
    private val committed = mutableSetOf<Int>()
    private var consumed = false
    fun commit(face: Int, id: String): Boolean {
        if (id != session || face !in faces || consumed) return false
        committed.add(face)
        if (committed != faces) return false
        consumed = true
        return true
    }
}
