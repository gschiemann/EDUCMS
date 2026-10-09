package com.educms.player.media

import android.content.Context
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.face.FaceTokenStore
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Timer
import java.util.TimerTask
import java.util.UUID

/** Native does not read browser CacheStorage and never receives a token/URL from the page. */
internal class SharedVideoSource(private val ctx: Context) {
    fun descriptor(face: Int, expectedScreen: String): SharedVideoDescriptor {
        val token = FaceTokenStore.read(ctx, face) ?: error("credential-missing")
        require(NativeAlertWatchPolicy.screenIdOf(token) == expectedScreen) { "credential-identity" }
        val saved = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE).getString("api_root", null) ?: error("api-root")
        val root = SharedVideoSourcePolicy.apiBase(saved)
        require(HostAllowlist.isApiHost(root)) { "api-origin" }
        val url = "$root/api/v1/screens/$expectedScreen/manifest"
        val bytes = request(url, token, 15_000L) { c ->
            require(c.responseCode == 200) { "manifest-http-${c.responseCode}" }
            c.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val block = ByteArray(8192)
                while (true) {
                    val n = input.read(block); if (n < 0) break
                    require(out.size() + n <= 2 * 1024 * 1024) { "manifest-too-large" }
                    out.write(block, 0, n)
                }
                out.toByteArray()
            }
        }
        require(FaceTokenStore.read(ctx, face) == token) { "credential-changed" }
        val d = SharedVideoDescriptor.parse(JSONObject(String(bytes, Charsets.UTF_8)).getJSONObject("nativeSharedVideo"))
        require(d.screenId == expectedScreen && d.faceIndex == face) { "descriptor-identity" }
        return d
    }

    fun verifiedFile(d: SharedVideoDescriptor, current: () -> Boolean): File {
        val dir = File(ctx.filesDir, "shared-video-v1/${d.tenantId}")
        require(dir.isDirectory || dir.mkdirs()) { "media-cache-unavailable" }
        val file = File(dir, "${d.sha256}.mp4")
        if (verify(file, d, current)) return file
        // This cache owns video bytes only; never touches browser or emergency caches.
        // Bound retained copies and remove interrupted, box-owned staging files.
        dir.listFiles()?.filter { it.isFile && it.name.startsWith(".") && it.name.endsWith(".part") }?.forEach { it.delete() }
        val copies = dir.listFiles()?.filter { it.isFile && Regex("[a-f0-9]{64}\\.mp4").matches(it.name) && it != file }
            ?.sortedByDescending { it.lastModified() } ?: emptyList()
        copies.drop(1).forEach { it.delete() }
        if (file.exists()) require(file.delete()) { "media-cache-corrupt" }
        require(dir.usableSpace > d.size + 64L * 1024 * 1024) { "media-cache-quota" }
        val temp = File(dir, ".${d.sha256}.${UUID.randomUUID()}.part")
        try {
            var url = d.url
            var finished = false
            for (hop in 0..3) {
                require(current()) { "session-retired" }
                require(SharedVideoSourcePolicy.allowed(url)) { "media-origin" }
                val redirect = request(url, null, 300_000L) { c ->
                    if (c.responseCode in setOf(301, 302, 303, 307, 308)) {
                        URL(URL(url), c.getHeaderField("Location") ?: error("media-redirect")).toString()
                    } else {
                        require(c.responseCode == 200) { "media-http-${c.responseCode}" }
                        var count = 0L
                        val digest = MessageDigest.getInstance("SHA-256")
                        temp.outputStream().use { output -> c.inputStream.use { input ->
                            val block = ByteArray(64 * 1024)
                            while (true) {
                                require(current()) { "session-retired" }
                                val n = input.read(block); if (n < 0) break
                                count += n; require(count <= d.size) { "media-size" }
                                digest.update(block, 0, n); output.write(block, 0, n)
                            }
                            output.fd.sync()
                        } }
                        require(count == d.size && hex(digest.digest()) == d.sha256) { "media-digest" }
                        finished = true
                        null
                    }
                }
                if (finished) break
                url = redirect ?: error("media-redirect")
            }
            require(finished && current()) { "media-incomplete" }
            // One box-owned download worker publishes; no face can evict another face's file.
            require(temp.renameTo(file)) { "media-publish" }
            return file
        } finally { temp.delete() }
    }

    private fun verify(file: File, d: SharedVideoDescriptor, current: () -> Boolean): Boolean {
        if (!file.isFile || file.length() != d.size) return false
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val block = ByteArray(64 * 1024)
            while (true) {
                require(current()) { "session-retired" }
                val n = input.read(block); if (n < 0) break
                digest.update(block, 0, n)
            }
        }
        return hex(digest.digest()) == d.sha256
    }

    private fun <T> request(url: String, token: String?, deadline: Long, body: (HttpURLConnection) -> T): T {
        val c = URL(url).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false
        c.connectTimeout = 6000; c.readTimeout = 6000
        c.setRequestProperty("Accept-Encoding", "identity")
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        val timer = Timer("shared-media-http", true)
        timer.schedule(object : TimerTask() { override fun run() { c.disconnect() } }, deadline)
        try { return body(c) } finally { timer.cancel(); c.disconnect() }
    }
    private fun hex(value: ByteArray) = value.joinToString("") { "%02x".format(it.toInt() and 255) }
}
