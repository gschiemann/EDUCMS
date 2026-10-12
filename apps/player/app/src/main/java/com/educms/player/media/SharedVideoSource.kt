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
        val d = SharedVideoDescriptor.parse(manifest(face, expectedScreen).getJSONObject("nativeSharedVideo"))
        require(d.screenId == expectedScreen && d.faceIndex == face) { "descriptor-identity" }
        return d
    }

    /**
     * This face's own authenticated manifest, fetched with ITS OWN device
     * credential — never a token or URL the page supplies. Both native video
     * engines read their descriptor from here, so the page can only ever ask
     * native to play what the server already selected for this exact screen.
     */
    fun manifest(face: Int, expectedScreen: String): JSONObject {
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
        // The credential must still belong to THIS screen after the fetch (a
        // re-pair or revoke mid-request is refused). It is NOT compared byte for
        // byte: the page renews its token constantly, so an exact match failed
        // every attempt on the field units (2026-10-12, M43 + L55VEC).
        require(NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(ctx, face)) == expectedScreen) { "credential-changed" }
        return JSONObject(String(bytes, Charsets.UTF_8))
    }

    fun verifiedFile(d: SharedVideoDescriptor, current: () -> Boolean): File =
        verifiedFile("shared-video-v1", d.tenantId, d.sha256, d.size, d.url, current) { dir, file ->
            // Bound retained copies: the newest other copy only.
            val copies = dir.listFiles()?.filter { it.isFile && Regex("[a-f0-9]{64}\\.mp4").matches(it.name) && it != file }
                ?.sortedByDescending { it.lastModified() } ?: emptyList()
            copies.drop(1).forEach { it.delete() }
        }

    /**
     * The verified on-disk copy of one file, returned only when its length AND
     * SHA-256 match what the authenticated manifest named. Nothing is ever
     * streamed: a partial download is never visible under the real name.
     * [retain] prunes the directory before a fresh download — each engine owns
     * its own directory and its own retention rule.
     */
    fun verifiedFile(
        namespace: String, tenantId: String, sha256: String, size: Long, sourceUrl: String,
        current: () -> Boolean, retain: (dir: File, keep: File) -> Unit,
    ): File {
        val dir = File(ctx.filesDir, "$namespace/$tenantId")
        require(dir.isDirectory || dir.mkdirs()) { "media-cache-unavailable" }
        val file = File(dir, "$sha256.mp4")
        if (verify(file, sha256, size, current)) return file
        // This cache owns video bytes only; never touches browser or emergency caches.
        // Remove interrupted, box-owned staging files.
        dir.listFiles()?.filter { it.isFile && it.name.startsWith(".") && it.name.endsWith(".part") }?.forEach { it.delete() }
        retain(dir, file)
        if (file.exists()) require(file.delete()) { "media-cache-corrupt" }
        require(dir.usableSpace > size + 64L * 1024 * 1024) { "media-cache-quota" }
        val temp = File(dir, ".$sha256.${UUID.randomUUID()}.part")
        try {
            var url = sourceUrl
            var finished = false
            for (hop in 0..3) {
                require(current()) { "session-retired" }
                require(SharedVideoSourcePolicy.allowed(url)) { "media-origin" }
                // Five minutes, or long enough for this size at 128 KiB/s — a
                // fixed 5 min made a large file on a slow venue link uncachable.
                val redirect = request(url, null, maxOf(300_000L, size / 131_072L * 1000L)) { c ->
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
                                count += n; require(count <= size) { "media-size" }
                                digest.update(block, 0, n); output.write(block, 0, n)
                            }
                            output.fd.sync()
                        } }
                        require(count == size && hex(digest.digest()) == sha256) { "media-digest" }
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
            VerifiedFiles.remember(file, sha256)
            return file
        } finally { temp.delete() }
    }

    private fun verify(file: File, sha256: String, size: Long, current: () -> Boolean): Boolean {
        if (!file.isFile || file.length() != size) return false
        if (VerifiedFiles.known(file, sha256)) return true
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val block = ByteArray(64 * 1024)
            while (true) {
                require(current()) { "session-retired" }
                val n = input.read(block); if (n < 0) break
                digest.update(block, 0, n)
            }
        }
        return (hex(digest.digest()) == sha256).also { if (it) VerifiedFiles.remember(file, sha256) }
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

/**
 * Files already hashed by THIS process, keyed by path + digest + length +
 * mtime. A second face (or a re-prepare) asking for the same 500 MB clip does
 * not re-read it on an rk3288; any rewrite of the file changes the key.
 */
internal object VerifiedFiles {
    private val seen = HashMap<String, String>()
    private fun key(f: File, sha: String) = "$sha|${f.length()}|${f.lastModified()}"
    @Synchronized fun known(f: File, sha: String) = seen[f.absolutePath] == key(f, sha)
    @Synchronized fun remember(f: File, sha: String) { seen[f.absolutePath] = key(f, sha) }
}
