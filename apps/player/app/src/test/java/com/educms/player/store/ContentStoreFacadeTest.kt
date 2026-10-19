package com.educms.player.store

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The facade (§6 state block, §5.7 adoption, §5.4 records, §3.5 sync) as the
 * rest of the app sees it, plus the dark-ship guarantee.
 */
class ContentStoreFacadeTest {

    @Test
    fun `the facade keeps stream B's exact method names and signatures`() {
        val actual = ContentStoreApi::class.java.declaredMethods
            .map { m -> "${m.name}(${m.parameterTypes.joinToString(",") { it.simpleName }}):${m.returnType.simpleName}" }.sorted()
        assertEquals(listOf(
            "intend(Map):void", "lookup(String):File", "onCredentialChanged():void", "onSync(String,String):void",
            "pinEmergency(Set):void", "readySet():Set", "stateBlock():JSONObject",
        ), actual)
    }

    @Test
    fun `the noop store answers mode off`() {
        val s = NoopContentStore.stateBlock()
        assertEquals("off", s.getString("mode"))
        assertFalse(s.getBoolean("serve"))
        assertEquals(0, s.getInt("generation"))
        assertNull(NoopContentStore.lookup("a".repeat(64)))
        assertTrue(NoopContentStore.readySet().isEmpty())
    }

    @Test
    fun `ships dark - not enrolled means no download, no adoption, no emergency read`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(64 * 1024, 201))
        h.manifest(items = listOf(clip), nativeBlob = clip, enrolled = false)
        h.emergencySet(blobs = listOf(clip))
        h.server.put(clip)
        val legacy = File(File(File(h.dir, "native-video-v2"), Kit.TENANT_A), "${clip.sha}.mp4").also { it.parentFile!!.mkdirs(); it.writeBytes(clip.bytes) }
        h.pump()
        h.clock.advance(3_600_000)
        h.pump()
        val s = h.store.stateBlock()
        assertEquals("off", s.getString("mode"))
        assertEquals("not-enrolled", s.getString("reason"))
        assertEquals(1, h.server.manifestGets())
        assertEquals(0, h.server.emergencyGets())
        assertTrue(h.server.storageGets().isEmpty())
        assertTrue("legacy copies untouched", legacy.isFile)
        // A web-only class never even reads its manifest.
        val taurus = Harness(classAllows = false)
        taurus.manifest(items = listOf(clip), nativeBlob = clip)
        taurus.pump()
        assertEquals(0, taurus.server.requests.size)
        assertEquals("class", taurus.store.stateBlock().getString("reason"))
    }

    @Test
    fun `adoption verifies each legacy copy once and renames it in - mode goes adopting then active`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(256 * 1024, 202))
        val stale = Blob("stale.mp4", Kit.bytes(64 * 1024, 203))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        val dir = File(File(h.dir, "native-video-v2"), Kit.TENANT_A).also { it.mkdirs() }
        val good = File(dir, "${clip.sha}.mp4").also { it.writeBytes(clip.bytes) }
        val bad = File(dir, "${stale.sha}.mp4").also { it.writeBytes(Kit.bytes(64 * 1024, 204)) } // name ≠ bytes
        assertEquals("off", h.store.stateBlock().getString("mode"))
        h.pump()
        assertFalse("renamed into the store (same filesystem, zero copy)", good.exists())
        assertArrayEquals(clip.bytes, h.storeFile(Kit.TENANT_A, clip.sha).readBytes())
        assertTrue("a copy whose bytes are not its name is never adopted", bad.isFile)
        assertNull(h.store.lookup(stale.sha))
        assertTrue("adopted, not downloaded", h.server.storageGetsFor(clip).isEmpty())
        assertEquals("active", h.store.stateBlock().getString("mode"))
        assertEquals(setOf(clip.sha), h.store.readySet())
    }

    @Test
    fun `adoption waits for the emergency set and an adopted file is never downloaded`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(256 * 1024, 213))
        val alert = Blob("alert.png", Kit.bytes(16 * 1024, 214), "image/png")
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = listOf(alert))
        h.server.put(clip)
        val legacy = File(File(File(h.dir, "native-video-v2"), Kit.TENANT_A), "${clip.sha}.mp4").also { it.parentFile!!.mkdirs(); it.writeBytes(clip.bytes) }
        // The alert media lands while the legacy copy is still where it was: emergency first, adoption after.
        h.server.put(alert).onBody = { assertTrue("emergency set before adoption", legacy.exists()) }
        h.pump()
        assertTrue(h.store.stateBlock().getJSONObject("emergency").getBoolean("complete"))
        assertFalse(legacy.exists())
        assertNotNull(h.store.lookup(clip.sha))
        assertTrue(h.server.storageGetsFor(clip).isEmpty())
    }

    @Test
    fun `mode stays adopting until the current content is verified`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(256 * 1024, 205))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip).failNext = 100
        h.pump()
        val s = h.store.stateBlock()
        assertEquals("adopting", s.getString("mode"))
        assertEquals(JSONArray(listOf(clip.sha)).toString(), s.getJSONArray("pending").toString())
        h.server.objects[clip.name]!!.failNext = 0
        h.clock.advance(StorePolicy.RETRY_CAP_MS + 1)
        h.pump()
        assertEquals("active", h.store.stateBlock().getString("mode"))
    }

    @Test
    fun `USB copies are adopted by link only when the tenant's own sources name them`() {
        val h = Harness()
        val named = Blob("named.mp4", Kit.bytes(128 * 1024, 206))
        val unnamed = Blob("unnamed.mp4", Kit.bytes(128 * 1024, 207))
        h.manifest(items = listOf(named), nativeBlob = named)
        h.emergencySet(blobs = emptyList())
        h.server.put(named)
        val usb = File(h.dir, "usb-cache").also { File(it, "media").mkdirs() }
        File(usb, "media/named.mp4").writeBytes(named.bytes)
        File(usb, "media/unnamed.mp4").writeBytes(unnamed.bytes)
        File(usb, "manifest.json").writeText(JSONObject().put("assets", JSONArray()
            .put(JSONObject().put("url", named.url).put("sha256", named.sha).put("localPath", "media/named.mp4"))
            .put(JSONObject().put("url", unnamed.url).put("sha256", unnamed.sha).put("localPath", "media/unnamed.mp4"))
            .put(JSONObject().put("url", "x").put("sha256", "a".repeat(64)).put("localPath", "../../etc/passwd"))).toString())
        h.pump()
        assertNotNull(h.store.lookup(named.sha))
        assertTrue("the USB interceptor keeps its file", File(usb, "media/named.mp4").isFile)
        assertTrue("adopted, not downloaded", h.server.storageGetsFor(named).isEmpty())
        assertFalse(h.storeFile(Kit.TENANT_A, unnamed.sha).exists())
    }

    @Test
    fun `the state block is bounded and complete`() {
        val h = Harness()
        val blobs = (0 until 200).map { Blob("v$it.mp4", Kit.bytes(1024, 300 + it)) }
        h.manifest(items = blobs, nativeBlob = blobs[0])
        h.emergencySet(blobs = emptyList())
        blobs.take(100).forEach { h.server.put(it) } // 100 stay missing → pending (worst case: both lists full)
        h.pump()
        val s = h.store.stateBlock()
        for (k in listOf("mode", "serve", "generation", "ready", "pending", "emergency", "accounting")) assertTrue(k, s.has(k))
        assertFalse(s.getBoolean("serve"))
        assertEquals(64, s.getJSONArray("ready").length())
        assertEquals(64, s.getJSONArray("pending").length())
        for (k in listOf("setHash", "complete", "count", "bytes")) assertTrue(k, s.getJSONObject("emergency").has(k))
        for (k in listOf("usedBytes", "pinnedBytes", "budgetBytes", "freeBytes")) assertTrue(k, s.getJSONObject("accounting").has(k))
        // Worst case (64 + 64 digests, every optional key present) stays well inside the 16 KB reply.
        s.put("downloading", JSONObject().put("sha8", "deadbeef").put("bytesLoaded", Long.MAX_VALUE).put("bytesTotal", Long.MAX_VALUE))
        s.put("lastCorruption", JSONObject().put("sha8", "deadbeef").put("at", Long.MAX_VALUE))
        assertTrue("store block ${s.toString().length} bytes", s.toString().length < 9_500)
        assertEquals(blobs[0].sha, s.getJSONArray("ready").getString(0))
        // generation moves on every change; the page's intent puts its content first.
        val g = s.getLong("generation")
        h.store.intend(mapOf(0 to linkedSetOf(blobs[7].sha)))
        val s2 = h.store.stateBlock()
        assertTrue(s2.getLong("generation") > g)
        assertEquals(blobs[7].sha, s2.getJSONArray("ready").getString(0))
        assertEquals(blobs[7].sha, h.store.readySet().first())
    }

    @Test
    fun `a file that moved is unverified until re-hashed, and a corrupt one is evicted and fetched again`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(256 * 1024, 208))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        val f = h.store.lookup(clip.sha)!!
        f.setLastModified(f.lastModified() - 60_000)
        assertNull("mtime moved: not served before a re-hash", h.store.lookup(clip.sha))
        h.pump()
        assertNotNull("re-hashed intact: served again", h.store.lookup(clip.sha))
        assertEquals(1, h.server.storageGetsFor(clip).size)
        f.writeBytes(Kit.bytes(256 * 1024, 209))
        assertNull(h.store.lookup(clip.sha))
        h.pump()
        assertArrayEquals("evicted and fetched again", clip.bytes, h.store.lookup(clip.sha)!!.readBytes())
        assertEquals(2, h.server.storageGetsFor(clip).size)
        assertEquals(clip.sha.take(8), h.store.stateBlock().getJSONObject("lastCorruption").getString("sha8"))
    }

    @Test
    fun `a reboot re-hashes nothing`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(512 * 1024, 210))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        val store = h.restart()
        h.pump()
        assertNotNull(store.lookup(clip.sha))
        assertEquals(0, store.hasher.hashedFiles)
    }

    @Test
    fun `sync re-reads only on a new tag, single-flight and rate-limited`() {
        val h = Harness()
        h.manifest()
        h.emergencySet(blobs = emptyList())
        h.pump()
        assertEquals(1, h.server.manifestGets())
        val tag = h.store.lastSelection(0)!!.etag!!
        h.clock.advance(60_000)
        h.store.onSync(tag, null)
        h.store.onSync("W/$tag", null)
        h.pump()
        assertEquals("the same tag is no news", 1, h.server.manifestGets())
        h.store.onSync("other-1", null)
        h.pump()
        h.store.onSync("other-2", null)
        h.pump()
        assertEquals("one read per 5 s at most", 2, h.server.manifestGets())
        h.clock.advance(StorePolicy.SYNC_MIN_INTERVAL_MS)
        h.pump()
        assertEquals(3, h.server.manifestGets())
    }

    @Test
    fun `re-hash before grading a decode fault - corruption is never a native block`() {
        val h = Harness()
        val clip = Blob("clip.mp4", Kit.bytes(256 * 1024, 211))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        assertEquals(ContentStore.FaultVerdict.INTACT, h.store.verifyAfterFault(clip.sha))
        assertEquals(ContentStore.FaultVerdict.ABSENT, h.store.verifyAfterFault("f".repeat(64)))
        val f = h.store.lookup(clip.sha)!!
        val mtime = f.lastModified()
        f.writeBytes(Kit.bytes(256 * 1024, 212))
        f.setLastModified(mtime)
        assertEquals(ContentStore.FaultVerdict.CORRUPT_EVICTED, h.store.verifyAfterFault(clip.sha))
        assertNull(h.store.lookup(clip.sha))
        h.pump()
        assertArrayEquals(clip.bytes, h.store.lookup(clip.sha)!!.readBytes())
    }
}
