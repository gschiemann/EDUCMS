package com.educms.player.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/**
 * Design §5.3: chunked, resumable, verified AS STORED, with the checksum
 * quarantine, the crash guard, the priority order and pre-emption by the
 * emergency set.
 */
class ContentStoreDownloadTest {
    private val mib = Kit.MIB

    private class Direct {
        val dir: File = Kit.tempDir()
        val layout = StoreLayout(dir)
        val server = FakeServer()
        val clock = FakeClock()
        val env = StoreEnv(clock, server, FakeCredentials(), FakeDisk(), Kit.screenIdOf, { it == Kit.API },
            { it.startsWith("${Kit.STORAGE}/") }, verifyBytesPerSec = 0)
        val hasher = DiskHasher(clock, 0)

        fun target(b: Blob, sha: String = b.sha) =
            DownloadTarget(Kit.TENANT_A, sha, false, sha, b.url, StoreNames.stableKey(b.url)!!, b.size, emergency = false)

        fun run(t: DownloadTarget, keepGoing: () -> Boolean = { true }, beforeVerify: (File) -> Unit = {}) =
            ChunkedDownload(layout, env, hasher, keepGoing, beforeVerify = beforeVerify).run(t)

        fun ranges(b: Blob): List<Pair<Long, Long>> = server.storageGetsFor(b).mapNotNull { r ->
            r.headers["Range"]?.let { Regex("bytes=(\\d+)-(\\d+)").matchEntire(it)!!.destructured.let { (s, e) -> s.toLong() to e.toLong() - s.toLong() + 1 } }
        }

        fun staged(): List<File> = layout.stagingDir(Kit.TENANT_A).listFiles()?.toList() ?: emptyList()
    }

    @Test
    fun `chunks start at 8 MiB and double on a fast link up to 32 MiB, and carry no credential`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(60 * mib, 11))
        d.server.put(clip)
        val out = d.run(d.target(clip))
        assertTrue(out is DownloadOutcome.Stored)
        assertEquals(listOf(0L to 8L * mib, 8L * mib to 16L * mib, 24L * mib to 32L * mib, 56L * mib to 4L * mib), d.ranges(clip))
        assertArrayEquals(clip.bytes, d.layout.contentFile(Kit.TENANT_A, clip.sha).readBytes())
        assertTrue("no credential is ever sent to the storage host", d.server.storageGets().none { it.headers.containsKey("Authorization") })
    }

    @Test
    fun `a failed chunk halves the next one`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(12 * mib, 12))
        d.server.put(clip).failNext = 2
        val out = d.run(d.target(clip))
        assertTrue(out is DownloadOutcome.Stored)
        assertEquals(listOf(8L * mib, 4L * mib, 2L * mib, 4L * mib, 6L * mib), d.ranges(clip).map { it.second }.take(5))
        assertEquals(listOf(0L, 0L, 0L, 2L * mib, 6L * mib), d.ranges(clip).map { it.first }.take(5))
    }

    @Test
    fun `a process death mid-chunk resumes at bytesWritten, and unproven bytes past it are dropped`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(20 * mib, 13))
        val obj = d.server.put(clip)
        obj.onBody = { served -> if (d.ranges(clip).size == 2 && served >= 3L * mib) throw ProcessDeath() }
        try {
            d.run(d.target(clip))
            fail("the process should have died")
        } catch (_: ProcessDeath) {
        }
        obj.onBody = null
        val meta = d.staged().single { it.name.endsWith(".part.json") }
        val state = PartState.parse(meta.readText())!!
        assertEquals("only the first, fsynced and counted chunk is proven", 8L * mib, state.written)
        val part = d.staged().single { it.name.endsWith(".part") }
        assertTrue("the dead chunk's bytes are on disk but uncounted", part.length() > 8L * mib)
        RandomAccessFile(part, "rw").use { it.seek(it.length()); it.write(ByteArray(1000) { 7 }) }

        val out = d.run(d.target(clip))
        assertTrue(out is DownloadOutcome.Stored)
        assertEquals("resumed exactly at bytesWritten", 8L * mib, d.ranges(clip)[2].first)
        assertArrayEquals(clip.bytes, d.layout.contentFile(Kit.TENANT_A, clip.sha).readBytes())
        assertTrue(d.staged().isEmpty())
    }

    @Test
    fun `a Content-Range that is not the range asked for is discarded, never appended`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(20 * mib, 14))
        val obj = d.server.put(clip)
        var stop = false
        obj.onBody = { served -> if (served >= 8L * mib) stop = true }
        assertEquals(DownloadOutcome.Preempted, d.run(d.target(clip), keepGoing = { !stop }))
        obj.onBody = null
        // First chunk landed; now the server answers with the wrong bytes.
        obj.badRange = true
        val out = d.run(d.target(clip))
        assertEquals(DownloadOutcome.Failed("content-range-mismatch"), out)
        val state = PartState.parse(d.staged().single { it.name.endsWith(".part.json") }.readText())!!
        assertEquals(8L * mib, state.written)
        assertEquals(8L * mib, d.staged().single { it.name.endsWith(".part") }.length())
        // The fast first chunk raised the size to 16 MiB (capped at the 12 MiB left); each mismatch then halves it.
        assertEquals("each mismatch halves the next request", listOf(12L * mib, 8L * mib, 4L * mib), d.ranges(clip).drop(1).map { it.second })
        obj.badRange = false
        assertTrue(d.run(d.target(clip)) is DownloadOutcome.Stored)
        assertArrayEquals(clip.bytes, d.layout.contentFile(Kit.TENANT_A, clip.sha).readBytes())
    }

    @Test
    fun `a changed ETag restarts the file from zero (source-changed)`() {
        val d = Direct()
        val v1 = Kit.bytes(20 * mib, 15)
        val v2 = Kit.bytes(20 * mib, 16)
        val clip = Blob("clip.mp4", v1)
        val obj = d.server.put(clip)
        obj.onBody = { served -> if (served >= 8L * mib && obj.etag == "\"v1\"") { obj.bytes = v2; obj.etag = "\"v2\"" } }
        // The authenticated manifest already names the replacement (v2).
        val out = d.run(d.target(clip, sha = Kit.sha(v2)))
        assertTrue(out is DownloadOutcome.Stored)
        val starts = d.ranges(clip).map { it.first }
        assertEquals(listOf(0L, 8L * mib, 0L), starts.take(3))
        assertArrayEquals(v2, d.layout.contentFile(Kit.TENANT_A, Kit.sha(v2)).readBytes())
    }

    @Test
    fun `verified as stored - a byte flipped on disk after the write is caught and never published`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(3 * mib, 17))
        d.server.put(clip)
        val out = d.run(d.target(clip), beforeVerify = { f -> RandomAccessFile(f, "rw").use { it.seek(12345); val b = it.read(); it.seek(12345); it.write(b xor 0xff) } })
        assertEquals(DownloadOutcome.Quarantined("media-digest"), out)
        assertFalse(d.layout.contentFile(Kit.TENANT_A, clip.sha).exists())
        assertTrue("no staging leftovers", d.staged().isEmpty())
    }

    @Test
    fun `a server that ignores Range gets one whole-file attempt`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(10 * mib, 18))
        d.server.put(clip).ignoreRange = true
        val out = d.run(d.target(clip))
        assertTrue(out is DownloadOutcome.Stored)
        val gets = d.server.storageGetsFor(clip)
        assertEquals(2, gets.size)
        assertNotNull(gets[0].headers["Range"])
        assertNull("the whole-file attempt asks for no range", gets[1].headers["Range"])
    }

    @Test
    fun `redirects stay on the storage allowlist`() {
        val d = Direct()
        val clip = Blob("clip.mp4", Kit.bytes(1 * mib, 19))
        val real = Blob("real.mp4", clip.bytes)
        d.server.put(clip).redirectTo = real.url
        d.server.put(real)
        assertTrue(d.run(d.target(clip)) is DownloadOutcome.Stored)
        val evil = Blob("evil.mp4", Kit.bytes(1024, 20))
        d.server.put(evil).redirectTo = "https://elsewhere.test/x.mp4"
        assertEquals(DownloadOutcome.Failed("media-origin"), d.run(d.target(evil)))
        assertTrue(d.server.requests.none { it.url.startsWith("https://elsewhere.test") })
    }

    // ── in the running store ─────────────────────────────────────────────────

    @Test
    fun `checksum quarantine - a wrong file is not fetched again for 6 h`() {
        val h = Harness()
        val named = Blob("clip.mp4", Kit.bytes(256 * 1024, 21))
        h.manifest(items = listOf(named), nativeBlob = named)
        h.emergencySet(blobs = emptyList())
        h.server.put(named).bytes = Kit.bytes(256 * 1024, 22) // the storage object is NOT the named digest
        h.pump()
        assertNull(h.store.lookup(named.sha))
        val first = h.server.storageGetsFor(named).size
        assertTrue(first >= 1)
        h.clock.advance(3_600_000)
        h.store.onSync("other-tag", null)
        h.pump()
        assertEquals("quarantined: not fetched again within 6 h", first, h.server.storageGetsFor(named).size)
        h.clock.advance(StorePolicy.QUARANTINE_MS)
        h.server.objects["clip.mp4"]!!.bytes = named.bytes
        h.pump()
        assertTrue(h.server.storageGetsFor(named).size > first)
        assertNotNull(h.store.lookup(named.sha))
    }

    @Test
    fun `the crash guard sets a file aside for 6 h after the process dies on it twice`() {
        val h = Harness()
        val poison = Blob("poison.mp4", Kit.bytes(4 * mib, 23))
        val good = Blob("good.mp4", Kit.bytes(256 * 1024, 24))
        h.manifest(items = listOf(poison, good), nativeBlob = poison)
        h.emergencySet(blobs = emptyList())
        val obj = h.server.put(poison)
        h.server.put(good)
        repeat(2) {
            obj.dieAfter = 1L * mib
            try {
                h.pump()
                fail("the process should have died")
            } catch (_: ProcessDeath) {
            }
            h.restart()
        }
        val before = h.server.storageGetsFor(poison).size
        h.pump()
        assertEquals("set aside: not touched again", before, h.server.storageGetsFor(poison).size)
        assertNotNull("everything else still downloads", h.store.lookup(good.sha))
        h.clock.advance(StorePolicy.CRASH_ASIDE_MS + 1)
        h.restart()
        h.pump()
        assertNotNull(h.store.lookup(poison.sha))
    }

    @Test
    fun `order - the emergency set, then the content on the glass in play order, then the next content`() {
        fun b(n: String, seed: Int) = Blob(n, Kit.bytes(64 * 1024, seed))
        val e1 = b("e1.png", 31).let { Blob(it.name, it.bytes, "image/png") }
        val g0a = b("g0a.mp4", 32)
        val g0b = b("g0b.mp4", 33)
        val g1a = b("g1a.mp4", 34)
        val n0 = b("n0.mp4", 35)
        val h = Harness()
        h.creds.tokens[1] = Kit.token(Kit.SCREEN_1)
        h.manifest(items = listOf(n0, g0b, g0a))
        h.manifest(screen = Kit.SCREEN_1, items = listOf(g1a))
        h.emergencySet(blobs = listOf(e1))
        h.emergencySet(screen = Kit.SCREEN_1, blobs = listOf(e1))
        listOf(e1, g0a, g0b, g1a, n0).forEach { h.server.put(it) }
        h.store.intend(mapOf(0 to linkedSetOf(g0a.sha, g0b.sha), 1 to linkedSetOf(g1a.sha)))
        h.pump()
        val firstGets = h.server.storageGets().map { it.url.substringBefore('?').substringAfterLast('/') }.distinct()
        assertEquals(listOf("e1.png", "g0a.mp4", "g1a.mp4", "g0b.mp4", "n0.mp4"), firstGets)
        assertEquals(listOf("e", "g0", "g1", "g0b", "n"), StorePolicy.order(listOf("e"), mapOf(0 to listOf("g0", "g0b"), 1 to listOf("g1")), mapOf(0 to listOf("n", "g0"))))
    }

    @Test
    fun `an emergency set pre-empts the in-flight content chunk, and the content resumes where it stopped`() {
        val h = Harness()
        val content = Blob("content.mp4", Kit.bytes(12 * mib, 41))
        val alert = Blob("lockdown.mp4", Kit.bytes(512 * 1024, 42))
        h.manifest(items = listOf(content), nativeBlob = content)
        h.emergencySet(blobs = emptyList())
        val obj = h.server.put(content)
        h.server.put(alert)
        obj.onBody = { served ->
            if (served >= 1L * mib && h.server.storageGetsFor(alert).isEmpty()) {
                obj.onBody = null
                h.emergencySet(blobs = listOf(alert))
                h.store.onSync(h.store.lastSelection(0)!!.etag!!, Kit.sha("new-set".toByteArray()))
            }
        }
        h.pump()
        val order = h.server.storageGets().map { it.url.substringBefore('?').substringAfterLast('/') to it.headers["Range"] }
        assertEquals("content.mp4", order[0].first)
        assertEquals("the alert media is fetched before the content continues", "lockdown.mp4", order[1].first)
        assertEquals("content.mp4", order[2].first)
        val resumedAt = Regex("bytes=(\\d+)-").find(order[2].second!!)!!.groupValues[1].toLong()
        assertTrue("only the in-flight chunk's tail is lost; the content resumes past zero", resumedAt >= 1L * mib)
        assertNotNull(h.store.lookup(content.sha))
        assertTrue(h.store.stateBlock().getJSONObject("emergency").getBoolean("complete"))
    }
}
