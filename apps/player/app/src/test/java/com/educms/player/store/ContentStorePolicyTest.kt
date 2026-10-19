package com.educms.player.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Design §5.1 (layout, naming, isolation) and §5.6 (budget, prune,
 * insufficient storage): the rules as numbers, then the store obeying them.
 */
class ContentStorePolicyTest {
    private val gib = StorePolicy.GIB
    private val mib = StorePolicy.MIB

    // ── names and paths ─────────────────────────────────────────────────────

    @Test
    fun `digests and tenant ids are validated, nothing else names a path`() {
        val sha = "a".repeat(64)
        assertTrue(StoreNames.isSha(sha))
        assertFalse(StoreNames.isSha("A".repeat(64)))
        assertFalse(StoreNames.isSha("a".repeat(63)))
        assertFalse(StoreNames.isSha("$sha.mp4"))
        assertFalse(StoreNames.isSha("../" + "a".repeat(61)))
        assertEquals(sha, StoreNames.shaOrNull(" ${"A".repeat(64)} "))
        assertNull(StoreNames.shaOrNull("g".repeat(64)))
        assertEquals(Kit.TENANT_A, StoreNames.tenantOrNull(Kit.TENANT_A.uppercase()))
        assertNull(StoreNames.tenantOrNull("../" + Kit.TENANT_A))
        assertNull(StoreNames.tenantOrNull("not-a-uuid"))
        assertNull(StoreNames.tenantOrNull(Kit.TENANT_A + "/x"))
    }

    @Test
    fun `the stable key strips query and fragment, so a rotated signed URL is the same object`() {
        val a = StoreNames.stableKey("https://Storage.Test/storage/v1/object/sign/assets/x/clip.mp4?token=one#t=3")
        val b = StoreNames.stableKey("https://storage.test/storage/v1/object/sign/assets/x/clip.mp4?token=two")
        assertEquals("https://storage.test/storage/v1/object/sign/assets/x/clip.mp4", a)
        assertEquals(a, b)
        assertEquals("https://storage.test:8443/a/b", StoreNames.stableKey("https://storage.test:8443/a/b"))
        assertEquals("https://storage.test/a/b", StoreNames.stableKey("https://storage.test:443/a/b"))
        for (bad in listOf("http://storage.test/a", "https://user@storage.test/a", "https://storage.test/a/../b",
            "https://storage.test/a\\b", "https://storage.test//a", "file:///etc/passwd", "", "not a url")) {
            assertNull(bad, StoreNames.stableKey(bad))
        }
    }

    @Test
    fun `no URL segment ever reaches a path`() {
        val layout = StoreLayout(Kit.tempDir())
        val key = StoreNames.stableKey("https://storage.test/storage/v1/object/public/assets/evil%2F..%2Fname.mp4")
        assertNull("an encoded traversal is not even a key", key)
        val clean = StoreNames.stableKey("https://storage.test/storage/v1/object/public/assets/tenant/lockdown.png")!!
        val lane = layout.laneFile(Kit.TENANT_A, StoreNames.laneId(clean))
        assertEquals(StoreNames.laneId(clean), lane.name)
        assertFalse(lane.path.contains("lockdown"))
        assertFalse(lane.path.contains("storage.test"))
        assertEquals(File(File(File(layout.root, Kit.TENANT_A), "u"), lane.name), lane)
        val sha = "b".repeat(64)
        assertEquals(File(File(layout.root, Kit.TENANT_A), sha), layout.contentFile(Kit.TENANT_A, sha))
        for (call in listOf<() -> Unit>(
            { layout.contentFile(Kit.TENANT_A, "clip.mp4") },
            { layout.contentFile("../${Kit.TENANT_A}", sha) },
            { layout.tenantDir("..") },
            { layout.laneFile(Kit.TENANT_A, "lockdown.png") },
            { layout.partFile(Kit.TENANT_A, sha, "../../x") },
        )) {
            try { call(); fail("accepted an unvalidated name") } catch (_: IllegalArgumentException) { }
        }
    }

    // ── budget, prune, insufficient storage ──────────────────────────────────

    @Test
    fun `budget is min 8 GiB, usable plus the store's own bytes minus the OS and pinned reserves`() {
        assertEquals(8 * gib, StorePolicy.budget(usableBytes = 20 * gib, storeBytes = 0, pinnedBytes = 0, largestPinned = 0))
        assertEquals(3 * gib - 512 * mib - 100 * mib - 40 * mib,
            StorePolicy.budget(usableBytes = 2 * gib, storeBytes = 1 * gib, pinnedBytes = 100 * mib, largestPinned = 40 * mib))
        // The store's own bytes are capacity: filling the store does not shrink its budget.
        assertEquals(StorePolicy.budget(4 * gib, 0, 0, 0), StorePolicy.budget(3 * gib, 1 * gib, 0, 0))
        assertEquals(0L, StorePolicy.budget(usableBytes = 100 * mib, storeBytes = 0, pinnedBytes = 50 * mib, largestPinned = 50 * mib))
    }

    @Test
    fun `prune evicts least recently used first and never a pinned or in-use file`() {
        val files = listOf(
            PruneCandidate("pinned-oldest", 400, lastUsedAt = 1, pinned = true, inUse = false),
            PruneCandidate("in-use-old", 400, lastUsedAt = 2, pinned = false, inUse = true),
            PruneCandidate("lru-1", 300, lastUsedAt = 3, pinned = false, inUse = false),
            PruneCandidate("lru-2", 300, lastUsedAt = 4, pinned = false, inUse = false),
            PruneCandidate("recent", 300, lastUsedAt = 9, pinned = false, inUse = false),
        )
        assertEquals(emptyList<String>(), StorePolicy.pruneFor(files, contentBytes = 1000, need = 0, budget = 1000))
        assertEquals(listOf("lru-1"), StorePolicy.pruneFor(files, contentBytes = 1300, need = 0, budget = 1000))
        assertEquals(listOf("lru-1", "lru-2"), StorePolicy.pruneFor(files, contentBytes = 1300, need = 300, budget = 1000))
        // Cannot fit even with every evictable file gone: NOTHING is evicted (store-full).
        assertNull(StorePolicy.pruneFor(files, contentBytes = 1300, need = 5000, budget = 1000))
        assertEquals(listOf("lru-1", "lru-2", "recent"), StorePolicy.pruneOver(files, contentBytes = 9000, budget = 1000))
        // Emergency files fit against the disk, never the OS reserve, and still never evict a pin.
        assertEquals(emptyList<String>(), StorePolicy.freeFor(files, need = 10, usableBytes = StorePolicy.OS_RESERVE + 10))
        assertEquals(listOf("lru-1"), StorePolicy.freeFor(files, need = 300, usableBytes = StorePolicy.OS_RESERVE + 10))
        assertNull(StorePolicy.freeFor(files, need = 5000, usableBytes = StorePolicy.OS_RESERVE))
    }

    @Test
    fun `store mode stays off when the budget cannot hold the largest current file x 1_5`() {
        assertFalse(StorePolicy.insufficient(budget = 300 * mib, largestCurrent = 200 * mib))
        assertTrue(StorePolicy.insufficient(budget = 299 * mib, largestCurrent = 200 * mib))
        assertFalse(StorePolicy.insufficient(budget = 0, largestCurrent = 0))

        val h = Harness(disk = FakeDisk(usable = 700 * mib))
        val big = Blob("big.mp4", ByteArray(200), "video/mp4")
        // The manifest states 400 MiB (larger than it is: the store must decide from the stated size, before any byte).
        h.server.manifests[Kit.SCREEN_0] = Json.manifest(Kit.SCREEN_0, Kit.TENANT_A, listOf(big), big, true, false).also {
            it.getJSONArray("playlists").getJSONObject(0).getJSONArray("items").getJSONObject(0).put("asset_size", 400 * mib)
            it.getJSONObject("nativeVideo").getJSONObject("asset").put("size", 400 * mib)
        }
        h.server.put(big)
        h.pump()
        val state = h.store.stateBlock()
        assertEquals("off", state.getString("mode"))
        assertEquals("insufficient-storage", state.getString("reason"))
        assertTrue("no content download in insufficient-storage", h.server.storageGetsFor(big).isEmpty())
    }

    @Test
    fun `chunk sizing, Content-Range parsing and the retry schedule`() {
        assertEquals(16 * mib, StorePolicy.nextChunk(8 * mib, ok = true, elapsedMs = 1_000))
        assertEquals(32 * mib, StorePolicy.nextChunk(32 * mib, ok = true, elapsedMs = 1_000))
        assertEquals(8 * mib, StorePolicy.nextChunk(8 * mib, ok = true, elapsedMs = 30_000))
        assertEquals(4 * mib, StorePolicy.nextChunk(8 * mib, ok = false, elapsedMs = 0))
        assertEquals(1 * mib, StorePolicy.nextChunk(1 * mib, ok = false, elapsedMs = 0))
        assertEquals(ContentRange(0, 99, 1000), StorePolicy.parseContentRange("bytes 0-99/1000"))
        assertEquals(ContentRange(5, 9, null), StorePolicy.parseContentRange("bytes 5-9/*"))
        assertNull(StorePolicy.parseContentRange("bytes 9-5/1000"))
        assertNull(StorePolicy.parseContentRange("bytes 0-1000/1000"))
        assertNull(StorePolicy.parseContentRange("items 0-9/10"))
        assertTrue(StorePolicy.rangeAgrees(ContentRange(0, 99, 1000), 0, 99, 1000))
        assertTrue("a shorter tail is fine", StorePolicy.rangeAgrees(ContentRange(0, 49, 1000), 0, 99, 1000))
        assertFalse(StorePolicy.rangeAgrees(ContentRange(1, 99, 1000), 0, 99, 1000))
        assertFalse(StorePolicy.rangeAgrees(ContentRange(0, 120, 1000), 0, 99, 1000))
        assertFalse("unknown size needs a total", StorePolicy.rangeAgrees(ContentRange(0, 99, null), 0, 99, 0))
        assertEquals(0L, StorePolicy.retryDelayMs(0))
        assertEquals(30_000L, StorePolicy.retryDelayMs(1))
        assertEquals(60_000L, StorePolicy.retryDelayMs(2))
        assertEquals(StorePolicy.RETRY_CAP_MS, StorePolicy.retryDelayMs(30))
    }

    @Test
    fun `scrub picks one file an hour, pinned first, each file at least weekly`() {
        val now = 100 * StorePolicy.SCRUB_MAX_AGE_MS
        val old = now - StorePolicy.SCRUB_MAX_AGE_MS
        val files = listOf(ScrubCandidate("old", old - 5, false), ScrubCandidate("pinned", old, true), ScrubCandidate("fresh", now - 1, false))
        assertEquals("pinned", StorePolicy.scrubNext(files, now, lastScrubAt = 0))
        assertEquals("old", StorePolicy.scrubNext(files.filter { it.key != "pinned" }, now, lastScrubAt = 0))
        assertNull("one per hour", StorePolicy.scrubNext(files, now, lastScrubAt = now - 1_000))
        assertNull("nothing due", StorePolicy.scrubNext(listOf(ScrubCandidate("fresh", now - 1, true)), now, 0))
    }

    // ── isolation in the running store ───────────────────────────────────────

    @Test
    fun `a face is served only from its own credential's tenant`() {
        val h = Harness()
        val clip = Blob("a.mp4", Kit.bytes(64 * 1024, 1))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        assertNotNull(h.store.lookup(clip.sha))
        // The same digest planted in ANOTHER tenant's directory is never served from there.
        val other = Blob("b.mp4", Kit.bytes(1024, 2))
        val foreign = h.store.layout.contentFile(Kit.TENANT_B, other.sha)
        foreign.parentFile!!.mkdirs()
        foreign.writeBytes(other.bytes)
        assertNull(h.store.lookup(other.sha))
        assertEquals(h.storeFile(Kit.TENANT_A, clip.sha), h.store.lookup(clip.sha))
    }

    @Test
    fun `re-pair - the old tenant stops being served at once and is deleted once the new tenant is confirmed`() {
        val h = Harness()
        val clip = Blob("a.mp4", Kit.bytes(64 * 1024, 3))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        assertNotNull(h.store.lookup(clip.sha))
        val oldDir = h.store.layout.tenantDir(Kit.TENANT_A)
        assertTrue(oldDir.isDirectory)

        // Re-paired to a screen of another tenant.
        h.creds.tokens[0] = Kit.token(Kit.SCREEN_2)
        h.store.onCredentialChanged()
        assertNull("not served for a single lookup after the credential changed", h.store.lookup(clip.sha))
        assertTrue("not deleted before the new tenant is confirmed", oldDir.isDirectory)

        h.manifest(screen = Kit.SCREEN_2, tenant = Kit.TENANT_B)
        h.emergencySet(screen = Kit.SCREEN_2, tenant = Kit.TENANT_B, blobs = emptyList())
        h.clock.advance(10_000)
        h.pump()
        assertFalse("the old tenant's directory is purged", oldDir.exists())
        assertNull(h.store.lookup(clip.sha))
    }

    @Test
    fun `a credential that is merely missing stops serving but deletes nothing`() {
        val h = Harness()
        val clip = Blob("a.mp4", Kit.bytes(32 * 1024, 4))
        h.manifest(items = listOf(clip), nativeBlob = clip)
        h.emergencySet(blobs = emptyList())
        h.server.put(clip)
        h.pump()
        h.creds.tokens.remove(0)
        h.store.onCredentialChanged()
        h.clock.advance(10_000)
        h.pump()
        assertNull(h.store.lookup(clip.sha))
        assertTrue(h.storeFile(Kit.TENANT_A, clip.sha).isFile)
        // Paired back to the same tenant: served again at zero egress.
        h.creds.tokens[0] = Kit.token(Kit.SCREEN_0)
        h.store.onCredentialChanged()
        h.clock.advance(10_000)
        h.pump()
        assertNotNull(h.store.lookup(clip.sha))
        assertEquals(1, h.server.storageGetsFor(clip).size)
    }

    @Test
    fun `store-wide prune evicts least recently used content outside the current sets`() {
        val h = Harness()
        val old = Blob("old.mp4", Kit.bytes(300 * 1024, 5))
        val current = Blob("cur.mp4", Kit.bytes(300 * 1024, 6))
        h.manifest(items = listOf(old), nativeBlob = old)
        h.emergencySet(blobs = emptyList())
        h.server.put(old)
        h.server.put(current)
        h.pump()
        assertNotNull(h.store.lookup(old.sha))
        // The schedule moves on; `old` is now previous content (kept while the budget allows, D6).
        h.manifest(items = listOf(current), nativeBlob = current)
        h.store.onSync("new-tag", null)
        h.clock.advance(StorePolicy.RECENT_USE_MS + 10_000)
        h.pump()
        assertTrue("previous content kept while it fits", h.storeFile(Kit.TENANT_A, old.sha).isFile)
        // Space shrinks: the budget now holds only one file → the LRU file outside the current sets goes.
        val a = h.store.computeAccounting()
        h.disk.usable = StorePolicy.OS_RESERVE + 350 * 1024 - a.usedBytes
        h.clock.advance(1_000)
        h.pump()
        assertFalse("previous content evicted", h.storeFile(Kit.TENANT_A, old.sha).exists())
        assertTrue("current content never evicted", h.storeFile(Kit.TENANT_A, current.sha).isFile)
    }
}
