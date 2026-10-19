package com.educms.player.store

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.random.Random

/**
 * Deterministic test kit for the content store: a fake clock (sleep advances
 * time), a fake HTTP server with real Range semantics and fault switches, fake
 * read-only credentials and a temp-dir disk. Every id below is synthetic.
 */
internal object Kit {
    const val API = "https://api.test"
    const val STORAGE = "https://storage.test/storage/v1/object/public/assets"
    const val TENANT_A = "11111111-1111-4111-8111-111111111111"
    const val TENANT_B = "22222222-2222-4222-8222-222222222222"
    const val SCREEN_0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const val SCREEN_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const val SCREEN_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    const val MIB = 1024 * 1024

    fun sha(bytes: ByteArray): String = Hashing.hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    fun bytes(size: Int, seed: Int): ByteArray = Random(seed).nextBytes(size)
    fun tempDir(): File = Files.createTempDirectory("content-store-test").toFile()
    fun token(screen: String) = "tok:$screen"
    val screenIdOf: (String?) -> String? = { t -> t?.takeIf { it.startsWith("tok:") }?.removePrefix("tok:")?.takeIf { it.isNotEmpty() } }
}

internal class Blob(val name: String, var bytes: ByteArray, val mime: String = "video/mp4") {
    val sha: String get() = Kit.sha(bytes)
    val url: String get() = "${Kit.STORAGE}/$name"
    val size: Long get() = bytes.size.toLong()
}

internal class FakeClock(var now: Long = 1_800_000_000_000L) : StoreClock {
    val sleeps = ArrayList<Long>()
    override fun nowMs(): Long = now
    override fun sleep(ms: Long) {
        sleeps += ms
        now += ms
    }
    fun advance(ms: Long) { now += ms }
}

internal class FakeCredentials : StoreCredentials {
    val tokens = HashMap<Int, String>()
    var api: String? = Kit.API
    override fun faces(): List<Int> = listOf(0, 1)
    override fun token(face: Int): String? = tokens[face]
    override fun apiBase(): String? = api
}

internal class FakeDisk(var usable: Long = 100L * 1024 * Kit.MIB) : StoreDisk {
    var linkWorks = true
    override fun usableBytes(dir: File): Long = usable
    override fun inode(file: File): Long = runCatching { (Files.getAttribute(file.toPath(), "unix:ino") as Number).toLong() }.getOrDefault(0L)
    override fun link(from: File, to: File): Boolean =
        linkWorks && runCatching { Files.createLink(to.toPath(), from.toPath()); true }.getOrDefault(false)
}

/** Thrown from a body read to simulate the process dying mid-download (an Error, so no `catch (Exception)` swallows it). */
internal class ProcessDeath : Error("process died")

internal class FakeServer : StoreHttp {
    data class Req(val url: String, val headers: Map<String, String>)

    class Obj(var bytes: ByteArray) {
        var etag: String = "\"v1\""
        var ignoreRange = false
        var badRange = false
        var failNext = 0
        var failStatus = 503
        /** Body stream ends after this many bytes (a cut connection), once. */
        var cutAfter = -1L
        /** Throws [ProcessDeath] after this many body bytes, once. */
        var dieAfter = -1L
        var redirectTo: String? = null
        /** Called with the bytes served so far in the current response. */
        var onBody: ((Long) -> Unit)? = null
        var gets = 0
    }

    val requests = ArrayList<Req>()
    val objects = HashMap<String, Obj>()
    /** screen → manifest JSON (null = 500). */
    val manifests = HashMap<String, JSONObject?>()
    val manifestEtags = HashMap<String, String>()
    /** screen → emergency-assets JSON (null = 500). */
    val emergency = HashMap<String, JSONObject?>()
    var emergencyThrows = false

    fun put(blob: Blob): Obj = Obj(blob.bytes).also { objects[blob.name] = it }

    fun storageGets(): List<Req> = requests.filter { it.url.startsWith(Kit.STORAGE) || it.url.startsWith("https://elsewhere.test") }
    fun storageGetsFor(blob: Blob): List<Req> = requests.filter { it.url.substringBefore('?') == blob.url }
    fun manifestGets(screen: String = Kit.SCREEN_0) = requests.count { it.url == "${Kit.API}/api/v1/screens/$screen/manifest" }
    fun emergencyGets(screen: String = Kit.SCREEN_0) = requests.count { it.url == "${Kit.API}/api/v1/screens/$screen/emergency-assets" }

    override fun get(url: String, headers: Map<String, String>, deadlineMs: Long): StoreResponse {
        requests += Req(url, HashMap(headers))
        val path = url.substringBefore('?')
        if (path.startsWith("${Kit.API}/api/v1/screens/")) {
            val rest = path.removePrefix("${Kit.API}/api/v1/screens/")
            val screen = rest.substringBefore('/')
            if (headers["Authorization"] != "Bearer ${Kit.token(screen)}") return resp(401, "")
            return when (rest.substringAfter('/')) {
                "manifest" -> {
                    val body = manifests[screen] ?: return resp(500, "")
                    val etag = manifestEtags[screen] ?: "\"m-${Kit.sha(body.toString().toByteArray()).take(12)}\""
                    if (headers["If-None-Match"] == etag) resp(304, "", mapOf("ETag" to etag)) else resp(200, body.toString(), mapOf("ETag" to etag))
                }
                "emergency-assets" -> {
                    if (emergencyThrows) throw java.io.IOException("network down")
                    resp(if (emergency[screen] == null) 500 else 200, emergency[screen]?.toString() ?: "")
                }
                else -> resp(404, "")
            }
        }
        val name = path.removePrefix("${Kit.STORAGE}/")
        val o = objects[name] ?: return resp(404, "")
        o.gets++
        o.redirectTo?.let { return resp(302, "", mapOf("Location" to it)) }
        if (o.failNext > 0) {
            o.failNext--
            return resp(o.failStatus, "")
        }
        val total = o.bytes.size.toLong()
        val range = headers["Range"]?.let { Regex("^bytes=(\\d+)-(\\d+)$").matchEntire(it) }
        if (range == null || o.ignoreRange) {
            return Resp(200, mapOf("ETag" to o.etag, "Content-Length" to total.toString()), body(o, o.bytes, 0))
        }
        val s = range.groupValues[1].toLong()
        val e = minOf(range.groupValues[2].toLong(), total - 1)
        if (s >= total) return resp(416, "", mapOf("Content-Range" to "bytes */$total"))
        val start = if (o.badRange) s + 1 else s
        val slice = o.bytes.copyOfRange(start.toInt(), (e + 1).toInt())
        return Resp(206, mapOf("ETag" to o.etag, "Content-Range" to "bytes $start-$e/$total"), body(o, slice, start))
    }

    private fun body(o: Obj, data: ByteArray, @Suppress("UNUSED_PARAMETER") offset: Long): InputStream {
        val cut = o.cutAfter.also { o.cutAfter = -1 }
        val die = o.dieAfter.also { o.dieAfter = -1 }
        val src = ByteArrayInputStream(data)
        var served = 0L
        return object : InputStream() {
            override fun read(): Int {
                val b = ByteArray(1)
                return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 0xff
            }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (cut in 0..served) return -1
                if (die in 0..served) throw ProcessDeath()
                var n = len
                if (cut >= 0) n = minOf(n.toLong(), cut - served).toInt()
                if (die >= 0) n = minOf(n.toLong(), die - served).toInt()
                val r = src.read(b, off, n)
                if (r > 0) {
                    served += r
                    o.onBody?.invoke(served)
                }
                return r
            }
        }
    }

    private fun resp(code: Int, body: String, headers: Map<String, String> = emptyMap()) =
        Resp(code, headers, ByteArrayInputStream(body.toByteArray()))

    class Resp(override val code: Int, private val headers: Map<String, String>, override val body: InputStream) : StoreResponse {
        override fun header(name: String): String? = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
        override fun close() {}
    }
}

/** One store on one temp directory, with everything injectable; [restart] simulates a process death + boot. */
internal class Harness(
    val dir: File = Kit.tempDir(),
    val clock: FakeClock = FakeClock(),
    val server: FakeServer = FakeServer(),
    val creds: FakeCredentials = FakeCredentials().also { it.tokens[0] = Kit.token(Kit.SCREEN_0) },
    val disk: FakeDisk = FakeDisk(),
    var classAllows: Boolean = true,
) {
    val logs = ArrayList<String>()
    val env = StoreEnv(
        clock = clock, http = server, credentials = creds, disk = disk, screenIdOf = Kit.screenIdOf,
        apiHostAllowed = { it == Kit.API },
        storageAllowed = { it.startsWith("${Kit.STORAGE}/") && !it.contains("..") },
        classAllows = { classAllows },
        verifyBytesPerSec = 0,
        log = { logs += it },
    )
    var store = ContentStore(dir, env)
        private set

    fun restart(): ContentStore {
        store = ContentStore(dir, env)
        return store
    }

    /** Run the worker; a [ProcessDeath] escapes (it is an Error) exactly as a real process death would end the work. */
    fun pump() = store.pump()

    fun manifest(
        screen: String = Kit.SCREEN_0, tenant: String = Kit.TENANT_A, items: List<Blob> = emptyList(),
        nativeBlob: Blob? = null, enrolled: Boolean = true, emergency: Boolean = false,
    ) {
        server.manifests[screen] = Json.manifest(screen, tenant, items, nativeBlob, enrolled, emergency)
    }

    fun emergencySet(screen: String = Kit.SCREEN_0, tenant: String = Kit.TENANT_A, blobs: List<Blob>, nullHash: Set<String> = emptySet(), setHash: String? = null) {
        server.emergency[screen] = Json.emergency(screen, tenant, blobs, nullHash, setHash)
    }

    fun storeFile(tenant: String, sha: String): File = store.layout.contentFile(tenant, sha)
}

internal object Json {
    fun manifest(screen: String, tenant: String, items: List<Blob>, nativeBlob: Blob?, enrolled: Boolean, emergency: Boolean): JSONObject {
        val arr = JSONArray()
        items.forEachIndexed { i, b ->
            arr.put(JSONObject().put("item_id", "item-$i").put("asset_id", "asset-$i").put("asset_hash", b.sha)
                .put("asset_size", b.size).put("url", b.url + "?token=t$i").put("mime_type", b.mime))
        }
        val j = JSONObject().put("version", "1.0").put("screenId", screen).put("tenantId", tenant).put("isEmergency", emergency)
            .put("playlists", JSONArray().put(JSONObject().put("id", "pl-1").put("items", arr)))
        if (enrolled) j.put("nativeFirst", true)
        if (nativeBlob != null) {
            j.put("nativeVideo", JSONObject().put("version", 2).put("screenId", screen).put("tenantId", tenant).put("faceIndex", 0)
                .put("asset", JSONObject().put("id", "asset-n").put("sha256", nativeBlob.sha).put("size", nativeBlob.size).put("url", nativeBlob.url)))
        }
        return j
    }

    fun emergency(screen: String, tenant: String, blobs: List<Blob>, nullHash: Set<String>, setHash: String?): JSONObject {
        val arr = JSONArray()
        blobs.forEach { b ->
            arr.put(JSONObject().put("url", b.url).put("sha256", if (b.name in nullHash) JSONObject.NULL else b.sha)
                .put("size", b.size).put("kind", if (b.mime.startsWith("video/")) "video" else "image"))
        }
        val hash = setHash ?: Kit.sha(blobs.joinToString("|") { "${it.url}:${if (it.name in nullHash) "null" else it.sha}" }.toByteArray())
        return JSONObject().put("tenantId", tenant).put("screenId", screen).put("assets", arr).put("assetCount", blobs.size).put("setHash", hash)
    }
}
