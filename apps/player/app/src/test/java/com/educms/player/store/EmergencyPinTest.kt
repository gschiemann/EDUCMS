package com.educms.player.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Design §7 E3 — the emergency set is pinned in the store with the worker's
 * guarantees. LIFE-SAFETY: one case per guarantee, each against the running
 * store (real files, real persistence), never a mock of the rule itself.
 */
class EmergencyPinTest {
    private val a = Blob("lockdown.mp4", Kit.bytes(300 * 1024, 101))
    private val b = Blob("evacuate.png", Kit.bytes(40 * 1024, 102), "image/png")
    private val c = Blob("weather.mp4", Kit.bytes(200 * 1024, 103))

    /** An enrolled store whose committed emergency set is {a, b}. */
    private fun committed(): Harness {
        val h = Harness()
        h.manifest()
        h.emergencySet(blobs = listOf(a, b))
        listOf(a, b, c).forEach { h.server.put(it) }
        h.pump()
        val es = h.store.emergencyState(Kit.TENANT_A)!!
        assertNotNull("set committed", es.committed)
        assertTrue(h.state().getBoolean("complete"))
        return h
    }

    private fun Harness.state() = store.stateBlock().getJSONObject("emergency")
    private fun Harness.pinned() = store.emergencyState(Kit.TENANT_A)!!.pinned
    private fun Harness.emergencyFile(): File = store.layout.emergencyFile(Kit.TENANT_A)
    private fun Harness.nudge(hash: String = "e".repeat(64)) {
        clock.advance(StorePolicy.SYNC_MIN_INTERVAL_MS + 1)
        store.onSync(store.lastSelection(0)?.etag ?: "", hash)
        pump()
    }

    @Test
    fun `an empty answer is no data - no pin moves and no set-hash is written`() {
        val h = committed()
        val setHash = h.state().getString("setHash")
        val pins = h.pinned()
        val file = h.emergencyFile().readText()
        val reads = h.server.emergencyGets()
        h.emergencySet(blobs = emptyList())
        h.nudge()
        assertTrue("the set was read again", h.server.emergencyGets() > reads)
        assertEquals(setHash, h.state().getString("setHash"))
        assertEquals(pins, h.pinned())
        assertEquals("nothing written", file, h.emergencyFile().readText())
        assertTrue(h.state().getBoolean("complete"))
        assertTrue(h.storeFile(Kit.TENANT_A, a.sha).isFile)
    }

    @Test
    fun `a failed fetch is no data`() {
        val h = committed()
        val setHash = h.state().getString("setHash")
        val pins = h.pinned()
        h.server.emergency[Kit.SCREEN_0] = null // 500
        h.nudge()
        h.server.emergencyThrows = true // network down
        h.nudge("d".repeat(64))
        assertEquals(setHash, h.state().getString("setHash"))
        assertEquals(pins, h.pinned())
        assertTrue(h.state().getBoolean("complete"))
    }

    @Test
    fun `a cached input adds pins and never removes them, offline boot included`() {
        val h = committed()
        // A content file the cached input names joins the pins…
        h.manifest(items = listOf(c), nativeBlob = c)
        h.store.onSync("new-tag", null)
        h.clock.advance(StorePolicy.SYNC_MIN_INTERVAL_MS + 1)
        h.pump()
        h.store.pinEmergency(setOf(c.sha))
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha, c.sha)))
        // …and no cached input can take one away.
        h.store.pinEmergency(setOf(a.sha))
        h.store.pinEmergency(emptySet())
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha, c.sha)))
        h.pump()
        // An offline boot (every source down) restores every pin from disk and unpins nothing.
        h.server.manifests[Kit.SCREEN_0] = null
        h.server.emergencyThrows = true
        h.restart()
        h.pump()
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha, c.sha)))
        assertNotNull("offline boot still serves from disk", h.store.lookup(a.sha))
    }

    @Test
    fun `a null-hash file, once present, is never revalidated - only a URL change replaces it`() {
        val h = Harness()
        val png = Blob("lockdown-banner.png", Kit.bytes(30 * 1024, 104), "image/png")
        val original = png.bytes.copyOf()
        h.manifest()
        h.emergencySet(blobs = listOf(png), nullHash = setOf(png.name))
        val obj = h.server.put(png)
        h.pump()
        val laneId = StoreNames.laneId(StoreNames.stableKey(png.url)!!)
        val lane = h.store.layout.laneFile(Kit.TENANT_A, laneId)
        assertTrue(lane.isFile)
        assertTrue(h.state().getBoolean("complete"))
        assertEquals(1, obj.gets)
        // A captive portal (or anything) now serves other bytes at that URL: the store never asks again.
        obj.bytes = Kit.bytes(30 * 1024, 105)
        h.nudge()
        h.clock.advance(StorePolicy.SCRUB_MAX_AGE_MS + StorePolicy.SCRUB_EVERY_MS)
        h.nudge("c".repeat(64))
        assertEquals("never fetched again", 1, obj.gets)
        assertArrayEquals(original, lane.readBytes())
        // A URL change is a new file; the old one stays pinned until the new set is complete.
        val v2 = Blob("lockdown-banner-v2.png", Kit.bytes(30 * 1024, 106), "image/png")
        val obj2 = h.server.put(v2)
        obj2.failNext = 100
        h.emergencySet(blobs = listOf(v2), nullHash = setOf(v2.name))
        h.nudge("b".repeat(64))
        assertTrue("old file still pinned while the new set is incomplete", laneId in h.pinned())
        assertFalse(h.state().getBoolean("complete"))
        obj2.failNext = 0
        h.clock.advance(StorePolicy.RETRY_CAP_MS + 1)
        h.pump()
        val laneId2 = StoreNames.laneId(StoreNames.stableKey(v2.url)!!)
        assertTrue(h.store.layout.laneFile(Kit.TENANT_A, laneId2).isFile)
        assertEquals(setOf(laneId2), h.pinned())
        assertTrue(h.state().getBoolean("complete"))
    }

    @Test
    fun `commit-then-unpin - the old set stays pinned and reported until the new set is complete`() {
        val h = committed()
        val s1 = h.state().getString("setHash")
        h.server.objects[c.name]!!.failNext = 100
        h.emergencySet(blobs = listOf(b, c))
        h.nudge()
        assertEquals("the set-hash moves only at commit", s1, h.state().getString("setHash"))
        assertFalse("alert media not all on disk = not emergency-ready", h.state().getBoolean("complete"))
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha, c.sha)))
        assertTrue(h.storeFile(Kit.TENANT_A, a.sha).isFile)
        h.server.objects[c.name]!!.failNext = 0
        h.clock.advance(StorePolicy.RETRY_CAP_MS + 1)
        h.pump()
        val s2 = h.state().getString("setHash")
        assertFalse(s1 == s2)
        assertTrue(h.state().getBoolean("complete"))
        assertEquals("a is released only now", setOf(b.sha, c.sha), h.pinned())
    }

    @Test
    fun `alert media on disk before the screen counts as emergency-ready`() {
        val h = Harness()
        h.manifest()
        h.emergencySet(blobs = listOf(a, b))
        h.server.put(a)
        h.server.put(b).failNext = 100
        h.pump()
        assertFalse(h.state().getBoolean("complete"))
        assertTrue("no set-hash before every file is present", h.state().isNull("setHash"))
        h.server.objects[b.name]!!.failNext = 0
        h.clock.advance(StorePolicy.RETRY_CAP_MS + 1)
        h.pump()
        assertTrue(h.state().getBoolean("complete"))
        assertFalse(h.state().isNull("setHash"))
        assertEquals(2, h.state().getInt("count"))
    }

    @Test
    fun `storage full refuses new content and leaves the pinned set intact`() {
        val h = committed()
        val g = Blob("glass.mp4", Kit.bytes(100 * 1024, 107))
        val big = Blob("big-next.mp4", Kit.bytes(2 * Kit.MIB, 108))
        h.server.put(g)
        h.server.put(big)
        h.manifest(items = listOf(g, big), nativeBlob = g)
        h.store.onSync("new-tag", null)
        h.clock.advance(StorePolicy.SYNC_MIN_INTERVAL_MS + 1)
        // Room for the glass file only: the next file cannot fit after evicting everything evictable.
        h.disk.usable = StorePolicy.OS_RESERVE + a.size + 300 * 1024
        h.pump()
        assertNotNull(h.store.lookup(g.sha))
        assertNull(h.store.lookup(big.sha))
        assertTrue(h.store.stateBlock().getJSONObject("accounting").optBoolean("storeFull"))
        assertArrayEquals(a.bytes, h.storeFile(Kit.TENANT_A, a.sha).readBytes())
        assertArrayEquals(b.bytes, h.storeFile(Kit.TENANT_A, b.sha).readBytes())
        assertTrue(h.state().getBoolean("complete"))
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha)))
    }

    @Test
    fun `prune never evicts a pinned file, even the least recently used one`() {
        val h = committed()
        val old = Blob("old.mp4", Kit.bytes(200 * 1024, 109))
        val cur = Blob("cur.mp4", Kit.bytes(200 * 1024, 110))
        h.server.put(old)
        h.server.put(cur)
        h.manifest(items = listOf(old), nativeBlob = old)
        h.store.onSync("t2", null)
        h.clock.advance(StorePolicy.SYNC_MIN_INTERVAL_MS + 1)
        h.pump()
        h.manifest(items = listOf(cur), nativeBlob = cur)
        h.store.onSync("t3", null)
        h.clock.advance(StorePolicy.RECENT_USE_MS + 1)
        h.pump()
        // A budget smaller than everything: every evictable file goes, the pins never do.
        h.disk.usable = StorePolicy.OS_RESERVE
        h.clock.advance(1_000)
        h.pump()
        assertFalse(h.storeFile(Kit.TENANT_A, old.sha).exists())
        assertTrue("in use is never evicted", h.storeFile(Kit.TENANT_A, cur.sha).isFile)
        assertArrayEquals(a.bytes, h.storeFile(Kit.TENANT_A, a.sha).readBytes())
        assertArrayEquals(b.bytes, h.storeFile(Kit.TENANT_A, b.sha).readBytes())
        assertTrue(h.state().getBoolean("complete"))
    }

    @Test
    fun `migration keeps the pin intact - adoption never overwrites it and a lost index never loses it`() {
        val h = committed()
        // A legacy native copy under the pinned file's name, with other bytes: never adopted over the pin.
        val legacy = File(File(File(h.dir, "native-video-v2"), Kit.TENANT_A), "${a.sha}.mp4")
        legacy.parentFile!!.mkdirs()
        legacy.writeBytes(Kit.bytes(300 * 1024, 111))
        // A good legacy copy of other content is adopted alongside.
        val x = Blob("x.mp4", Kit.bytes(100 * 1024, 112))
        val legacyX = File(File(File(h.dir, "shared-video-v1"), Kit.TENANT_A), "${x.sha}.mp4")
        legacyX.parentFile!!.mkdirs()
        legacyX.writeBytes(x.bytes)
        h.restart()
        h.pump()
        assertArrayEquals(a.bytes, h.storeFile(Kit.TENANT_A, a.sha).readBytes())
        assertTrue(a.sha in h.pinned())
        assertNotNull("other legacy content adopted", h.store.lookup(x.sha))
        assertFalse(legacyX.exists())
        // The index is lost: the pins live apart from it, and the files are re-verified, not deleted.
        h.store.layout.index.delete()
        h.server.emergencyThrows = true
        h.restart()
        h.pump()
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha)))
        assertTrue(h.state().getBoolean("complete"))
        assertArrayEquals(a.bytes, h.storeFile(Kit.TENANT_A, a.sha).readBytes())
        // A torn emergency write falls back to the previous good copy, still holding the pins.
        h.emergencyFile().writeText("{ torn")
        h.restart()
        h.pump()
        assertTrue(h.pinned().containsAll(setOf(a.sha, b.sha)))
    }
}
