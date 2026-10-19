package com.educms.player.store

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.TreeMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/**
 * THE ONE VERIFIED CONTENT STORE, owned by the app (design §5, phase 0 + 1).
 *
 * One copy per file, downloaded once, resumable, verified as stored, shared by
 * both faces. The store reads only its OWN authenticated sources (each face's
 * manifest and the emergency-assets list, with that face's canonical device
 * credential); the page can never add a file. Phase 1 stores video (what native
 * plays) and the whole emergency set (pinned, shadowing the worker's tier — the
 * worker's tier stays as the redundant alert copy, owner decision D2).
 *
 * Threading: [pump] runs on ONE worker thread (downloads, hashing, reads); the
 * [ContentStoreApi] methods are cheap, never touch the network and may be
 * called from any thread.
 */
internal class ContentStore(
    private val filesDir: File,
    private val env: StoreEnv,
    /** Wakes the worker (production: [AndroidContentStore]); tests leave it a no-op and call [pump]. */
    private val kick: () -> Unit = {},
) : ContentStoreApi {
    val layout = StoreLayout(filesDir)
    internal val hasher = DiskHasher(env.clock, env.verifyBytesPerSec)

    /** Test seam: runs on a complete staging file just before its as-stored verify. */
    internal var beforeVerify: (File) -> Unit = {}

    enum class FaultVerdict { INTACT, CORRUPT_EVICTED, ABSENT }

    private data class Progress(val id: String, val loaded: Long, val total: Long)

    internal data class Accounting(
        val usedBytes: Long, val pinnedBytes: Long, val contentBytes: Long, val stagingBytes: Long,
        val largestPinned: Long, val budgetBytes: Long, val freeBytes: Long,
    )

    private val lock = Any()
    private val pumping = AtomicBoolean(false)
    @Volatile private var pumpAgain = false
    /** An emergency set / pin arrived that the store does not hold yet: the in-flight content chunk yields. */
    @Volatile private var preempt = false
    @Volatile private var progress: Progress? = null

    // ── state, guarded by [lock] ─────────────────────────────────────────────
    private var loaded = false
    private val records = HashMap<String, StoreRecord>()
    private val quarantine = HashMap<String, Long>()
    private val rejected = HashMap<String, Long>()
    private val faces = TreeMap<Int, FaceSource>()
    private val intents = HashMap<Int, List<String>>()
    private val emergency = HashMap<String, EmergencyState>()
    private val emergencyDirty = HashSet<String>()
    /** Media of a live alert manifest, per tenant (pinned and fetched first; not persisted — the next read restores it). */
    private val alertMedia = HashMap<String, List<EmergencyEntry>>()
    /** Tenants whose emergency set was read successfully by this process (an empty answer included). */
    private val emergencyReadOk = HashSet<String>()
    /** Shas a caller pinned that no set named yet; asked about once, so a stale cached input never loops re-reads. */
    private val askedShas = HashSet<String>()
    private val suspects = LinkedHashSet<String>()
    private val failures = HashMap<String, Pair<Int, Long>>()
    private val refusedFull = HashMap<String, Long>()
    private val recentUse = HashMap<String, Long>()
    private val adoptedTenants = HashSet<String>()
    private var crash = CrashGuardState()
    private var enrolled = false
    private var everActive = false
    private var lastCorruption: Pair<String, Long>? = null
    private var lastScrubAt = 0L
    private var lastManifestReadAt = Long.MIN_VALUE / 4
    private var lastEmergencyReadAt = Long.MIN_VALUE / 4
    private var manifestRequested = true
    private var emergencyRequested = false
    private var generation = 0L
    private var accounting: Accounting? = null
    private var dirty = false

    // ── ContentStoreApi ──────────────────────────────────────────────────────

    override fun lookup(sha256: String): File? {
        val sha = StoreNames.shaOrNull(sha256) ?: return null
        var wake = false
        val found = synchronized(lock) {
            if (!loaded) return null
            val now = env.clock.nowMs()
            var hit: File? = null
            for (tenant in boundTenants()) {
                val key = StoreRecord.key(tenant, sha, false)
                val file = layout.contentFile(tenant, sha)
                val r = records[key]
                if (r == null) {
                    if (file.isFile && suspects.add(key)) wake = true
                    continue
                }
                if (key !in suspects && matches(r, file)) {
                    records[key] = r.copy(lastUsedAt = now)
                    recentUse[sha] = now
                    dirty = true
                    hit = file
                    break
                }
                if (suspects.add(key)) wake = true
            }
            hit
        }
        if (wake) kick()
        return found
    }

    override fun readySet(): Set<String> = synchronized(lock) { LinkedHashSet(lists().first) }

    override fun stateBlock(): JSONObject = synchronized(lock) {
        val (mode, reason) = modeNow()
        val (ready, pending) = lists()
        val j = JSONObject().put("mode", mode).put("serve", false).put("generation", generation)
            .put("ready", JSONArray(ready)).put("pending", JSONArray(pending))
        if (reason != null) j.put("reason", reason)
        progress?.let { p ->
            j.put("downloading", JSONObject().put("sha8", p.id.take(8)).put("bytesLoaded", p.loaded).put("bytesTotal", p.total))
        }
        j.put("emergency", emergencyBlock())
        val a = accounting
        val acc = JSONObject().put("usedBytes", a?.usedBytes ?: 0L).put("pinnedBytes", a?.pinnedBytes ?: 0L)
            .put("budgetBytes", a?.budgetBytes ?: 0L).put("freeBytes", a?.freeBytes ?: 0L)
        if (storeFull(env.clock.nowMs())) acc.put("storeFull", true)
        j.put("accounting", acc)
        lastCorruption?.let { (sha8, at) -> j.put("lastCorruption", JSONObject().put("sha8", sha8).put("at", at)) }
        j
    }

    override fun intend(currentSets: Map<Int, Set<String>>) {
        var changed = false
        synchronized(lock) {
            for ((face, set) in currentSets) {
                if (face !in 0..1) continue
                val list = set.mapNotNull { StoreNames.shaOrNull(it) }.distinct().take(StoreSourceParser.MAX_ITEMS)
                if (intents[face] != list) {
                    intents[face] = list
                    changed = true
                }
            }
            if (changed) {
                generation++
                refusedFull.clear()
            }
        }
        if (changed) kick()
    }

    override fun pinEmergency(set: Set<String>) {
        val shas = set.mapNotNull { StoreNames.shaOrNull(it) }.toSet()
        if (shas.isEmpty()) return
        var wake = false
        synchronized(lock) {
            for (tenant in boundTenants()) {
                val es = emergency[tenant] ?: EmergencyState()
                val raised = es.raise(shas)
                if (raised != es) {
                    emergency[tenant] = raised
                    emergencyDirty += tenant
                    generation++
                    wake = true
                }
                val known = es.wanted().map { it.key }.toSet()
                val unknown = shas.filter { it !in known && it !in askedShas }
                if (unknown.isNotEmpty()) {
                    // New information: re-read the server's set before anything else.
                    askedShas += unknown
                    emergencyRequested = true
                    preempt = true
                    wake = true
                }
            }
        }
        if (wake) kick()
    }

    override fun onSync(tag: String, emergencySetHash: String?) {
        var wake = false
        synchronized(lock) {
            val t = normalizeTag(tag)
            if (faces.isEmpty() || (t.isNotEmpty() && faces.values.none { normalizeTag(it.etag) == t })) {
                manifestRequested = true
                wake = true
            }
            val h = StoreNames.shaOrNull(emergencySetHash)
            if (h != null && boundTenants().none { emergency[it]?.knows(h) == true }) {
                emergencyRequested = true
                preempt = true
                wake = true
            }
        }
        if (wake) kick()
    }

    override fun onCredentialChanged() {
        synchronized(lock) {
            for (face in faces.keys.toList()) {
                val screen = env.screenIdOf(env.credentials.token(face))
                if (screen == null || !screen.equals(faces[face]!!.screenId, ignoreCase = true)) {
                    // Stops being served AT ONCE: lookups only search tenants a current credential is bound to.
                    faces.remove(face)
                    intents.remove(face)
                    generation++
                    dirty = true
                }
            }
            manifestRequested = true
            failures.clear()
        }
        kick()
    }

    // ── extras for the lead (not on the shared interface) ────────────────────

    /** Start: the first [pump] loads the index and reads the store's sources once. */
    fun start() = kick()

    /**
     * Re-hash before grading a decode fault (§5.4): CORRUPT_EVICTED means corruption
     * (evicted, re-download queued, NEVER a native block); INTACT means a real
     * decoder fault of a good file (the §3.4 fault policy applies).
     */
    fun verifyAfterFault(sha256: String): FaultVerdict {
        val sha = StoreNames.shaOrNull(sha256) ?: return FaultVerdict.ABSENT
        val key = synchronized(lock) {
            boundTenants().map { StoreRecord.key(it, sha, false) }.firstOrNull { records.containsKey(it) }
        } ?: return FaultVerdict.ABSENT
        // Null = the crash guard set this file aside: not settled, so not-ready (wait) — never a native block.
        val v = rehash(key) { true } ?: FaultVerdict.ABSENT
        if (v == FaultVerdict.CORRUPT_EVICTED) kick()
        return v
    }

    /** The pinned emergency state of [tenant] (tests and diagnostics). */
    internal fun emergencyState(tenant: String): EmergencyState? = synchronized(lock) { emergency[tenant] }

    /** The store's last authenticated selection for [face] (offline-boot validation, design §6). */
    fun lastSelection(face: Int): FaceSource? = synchronized(lock) { faces[face] }

    // ── the worker ───────────────────────────────────────────────────────────

    /** One pass of work until idle. Single-flight: a concurrent call makes the running pass loop once more. */
    fun pump() {
        if (!pumping.compareAndSet(false, true)) {
            pumpAgain = true
            return
        }
        try {
            var rounds = 0
            do {
                pumpAgain = false
                pumpOnce()
            } while (pumpAgain && ++rounds < 4)
        } catch (e: Exception) {
            env.log("[content-store] pass failed: ${StoreReasons.of(e, e.javaClass.simpleName)}")
        } finally {
            pumping.set(false)
        }
    }

    private fun pumpOnce() {
        ensureLoaded()
        refresh(waitForEmergency = false)
        if (!synchronized(lock) { participating() }) {
            persist()
            return
        }
        computeAccounting()
        rehashSuspects()
        commitEmergency()
        var steps = 0
        while (steps++ < 10_000) {
            if (preempt || synchronized(lock) { manifestRequested || emergencyRequested }) refresh(waitForEmergency = preempt)
            if (!synchronized(lock) { participating() }) break
            rehashSuspects()
            val t = nextTarget()
            // Adoption (§5.7) runs after the emergency set is on disk and before any content download,
            // so a file already on disk is never fetched again.
            if ((t == null || !t.emergency) && synchronized(lock) { boundTenants().any { it !in adoptedTenants } }) {
                adopt()
                continue
            }
            if (t == null) break
            if (!admit(t)) continue
            download(t)
            commitEmergency()
        }
        updateMode()
        if (nextTarget() == null) scrub()
        prune()
        persist()
    }

    /** Enrolled, allowed on this class, and bound to a tenant. Otherwise the store does NOTHING (dark ship). */
    private fun participating() = enrolled && env.classAllows() && boundTenants().isNotEmpty()

    // ── sources (§5.2) ───────────────────────────────────────────────────────

    private fun refresh(waitForEmergency: Boolean) {
        if (!env.classAllows()) {
            preempt = false
            return
        }
        val now = env.clock.nowMs()
        val doManifest = synchronized(lock) {
            val sinceLast = now - lastManifestReadAt
            (manifestRequested && sinceLast >= StorePolicy.SYNC_MIN_INTERVAL_MS) || (enrolled && sinceLast >= StorePolicy.MANIFEST_REFRESH_MS)
        }
        if (doManifest) readManifests()
        if (!synchronized(lock) { enrolled }) {
            synchronized(lock) { emergencyRequested = false }
            preempt = false
            return
        }
        var due = synchronized(lock) { emergencyDue(env.clock.nowMs()) }
        if (!due && waitForEmergency && synchronized(lock) { emergencyRequested }) {
            // Single-flight + rate limit: an alert's set is worth a short wait, never a skipped read.
            val wait = synchronized(lock) { lastEmergencyReadAt + StorePolicy.SYNC_MIN_INTERVAL_MS - env.clock.nowMs() }
            if (wait > 0) env.clock.sleep(wait)
            due = true
        }
        if (due) readEmergency()
        // A request that arrived DURING the read keeps the content yielding until it is read too.
        if (!synchronized(lock) { emergencyRequested }) preempt = false
    }

    private fun emergencyDue(now: Long): Boolean {
        if (!enrolled) return false
        val since = now - lastEmergencyReadAt
        val interval = when {
            emergencyRequested -> StorePolicy.SYNC_MIN_INTERVAL_MS
            boundTenants().any { it !in emergencyReadOk } -> StorePolicy.RETRY_BASE_MS
            else -> StorePolicy.EMERGENCY_REFRESH_MS
        }
        return since >= interval
    }

    private sealed class Fetched {
        object NotModified : Fetched()
        class Body(val json: JSONObject, val etag: String?) : Fetched()
    }

    private fun readManifests() {
        val now = env.clock.nowMs()
        val base = env.credentials.apiBase()?.takeIf { env.apiHostAllowed(it) }
        val credentialed = ArrayList<Int>()
        val resolved = HashSet<Int>()
        for (face in env.credentials.faces()) {
            val token = env.credentials.token(face) ?: continue
            val screen = env.screenIdOf(token) ?: continue
            credentialed += face
            if (base == null) continue
            val prev = synchronized(lock) { faces[face] }
            val etag = prev?.takeIf { it.screenId.equals(screen, ignoreCase = true) }?.etag
            val fetched = try {
                fetchManifest(base, screen, token, etag)
            } catch (e: Exception) {
                env.log("[content-store] manifest face=$face ${StoreReasons.of(e, "manifest-unreachable")}")
                null
            } ?: continue
            // The credential must still name THIS screen after the read (a re-pair mid-request is refused).
            if (env.screenIdOf(env.credentials.token(face))?.equals(screen, ignoreCase = true) != true) continue
            synchronized(lock) {
                when (fetched) {
                    Fetched.NotModified -> if (prev != null) {
                        faces[face] = prev.copy(fetchedAt = now)
                        resolved += face
                    } else Unit
                    is Fetched.Body -> {
                        val read = try {
                            StoreSourceParser.manifest(fetched.json, face, screen, fetched.etag, now, env.storageAllowed, env.enrolledBy)
                        } catch (e: Exception) {
                            env.log("[content-store] manifest face=$face ${StoreReasons.of(e, "manifest-invalid")}")
                            null
                        }
                        when (read) {
                            is StoreSourceParser.ManifestRead.Content -> {
                                if (prev != read.source.copy(fetchedAt = prev?.fetchedAt ?: 0L)) generation++
                                faces[face] = read.source
                                alertMedia.remove(read.source.tenant)
                                resolved += face
                            }
                            is StoreSourceParser.ManifestRead.Alert -> {
                                // An alert is live: content stays as it was; the alert's media is pinned (raise-only).
                                if (prev == null || prev.tenant != read.tenant) {
                                    faces[face] = FaceSource(face, screen, read.tenant, null, emptyList(), null, false, now)
                                }
                                // Raise-only: the alert's media is pinned; it never becomes, displaces or completes a set.
                                val es = emergency[read.tenant] ?: EmergencyState()
                                val raised = es.raise(read.media.map { it.key })
                                if (raised != es || emergency[read.tenant] == null) {
                                    emergency[read.tenant] = raised
                                    emergencyDirty += read.tenant
                                }
                                alertMedia[read.tenant] = read.media
                                resolved += face
                                generation++
                            }
                            null -> Unit
                        }
                    }
                }
            }
        }
        synchronized(lock) {
            val wasEnrolled = enrolled
            enrolled = faces.values.any { it.enrolled }
            if (wasEnrolled != enrolled) generation++
            lastManifestReadAt = now
            manifestRequested = false
            dirty = true
            if (credentialed.isNotEmpty() && resolved.containsAll(credentialed)) purgeUnbound()
        }
    }

    private fun fetchManifest(base: String, screen: String, token: String, etag: String?): Fetched {
        val headers = HashMap<String, String>()
        headers["Authorization"] = "Bearer $token"
        headers["Accept"] = "application/json"
        if (etag != null) headers["If-None-Match"] = etag
        env.http.get("$base/api/v1/screens/$screen/manifest", headers, 15_000L).use { r ->
            if (r.code == 304 && etag != null) return Fetched.NotModified
            require(r.code == 200) { "manifest-http-${r.code}" }
            return Fetched.Body(JSONObject(readBounded(r.body, 2 * StorePolicy.MIB)), r.header("ETag"))
        }
    }

    private fun readEmergency() {
        val now = env.clock.nowMs()
        synchronized(lock) {
            // Cleared BEFORE the read: a request arriving during it is honoured by the next one.
            lastEmergencyReadAt = now
            emergencyRequested = false
        }
        val base = env.credentials.apiBase()?.takeIf { env.apiHostAllowed(it) }
        val readers = synchronized(lock) { faces.values.groupBy { it.tenant }.map { (tenant, fs) -> tenant to fs.first() } }
        for ((tenant, fs) in readers) {
            if (base == null) break
            val token = env.credentials.token(fs.face) ?: continue
            if (env.screenIdOf(token)?.equals(fs.screenId, ignoreCase = true) != true) continue
            val set = try {
                env.http.get("$base/api/v1/screens/${fs.screenId}/emergency-assets", mapOf("Authorization" to "Bearer $token"), 15_000L).use { r ->
                    require(r.code == 200) { "emergency-http-${r.code}" }
                    StoreSourceParser.emergencyAssets(JSONObject(readBounded(r.body, StorePolicy.MIB)), tenant, fs.screenId, env.storageAllowed)
                        ?: error("emergency-identity")
                }
            } catch (e: Exception) {
                // A failed fetch is NO DATA: no pin moves, no set-hash is written (§5.5).
                env.log("[content-store] emergency set ${StoreReasons.of(e, "emergency-unreachable")}")
                null
            } ?: continue
            synchronized(lock) {
                val es = emergency[tenant] ?: EmergencyState()
                val next = es.onFresh(set) // an empty list returns es unchanged
                if (next != es || emergency[tenant] == null) {
                    emergency[tenant] = next
                    emergencyDirty += tenant
                    generation++
                }
                emergencyReadOk += tenant
            }
        }
        persistEmergency()
    }

    // ── the download queue (§5.3) ────────────────────────────────────────────

    private fun nextTarget(): DownloadTarget? = synchronized(lock) {
        val now = env.clock.nowMs()
        val byKey = HashMap<String, DownloadTarget>()
        val emergencyKeys = ArrayList<String>()
        for (tenant in boundTenants()) {
            val entries = (emergency[tenant]?.wanted() ?: emptyList()) + (alertMedia[tenant] ?: emptyList())
            for (e in entries) {
                if (presentEmergency(tenant, e)) continue
                val k = "e:$tenant/${e.key}"
                if (byKey.putIfAbsent(k, DownloadTarget(tenant, e.key, e.lane, e.sha256, e.url, e.stableKey, e.size, emergency = true)) == null) emergencyKeys += k
            }
        }
        val glass = HashMap<Int, List<String>>()
        val next = HashMap<Int, List<String>>()
        if (!insufficient()) {
            for ((face, fs) in faces) {
                val g = glassShas(face, fs)
                // Every position keeps its place (verified files included), so a face's second item never
                // overtakes the other face's first just because an earlier file already landed.
                fun keyOf(item: ContentItem): String {
                    val k = "c:${fs.tenant}/${item.sha256}"
                    if (!verified(fs.tenant, item.sha256)) {
                        byKey.putIfAbsent(k, DownloadTarget(fs.tenant, item.sha256, false, item.sha256, item.url, item.stableKey, item.size, emergency = false))
                    }
                    return k
                }
                glass[face] = g.mapNotNull { sha -> fs.item(sha)?.let { keyOf(it) } }
                next[face] = fs.items.filter { it.video && it.sha256 !in g }.map { keyOf(it) }
            }
        }
        StorePolicy.order(emergencyKeys, glass, next).asSequence().mapNotNull { byKey[it] }.firstOrNull { eligible(it, now) }
    }

    private fun eligible(t: DownloadTarget, now: Long): Boolean {
        if (StoreRecord.key(t.tenant, t.id, t.lane) in suspects) return false
        if ((quarantine[StorePolicy.quarantineKey(t.stableKey, t.id)] ?: 0L) > now) return false
        if (crash.isAside(t.id, now)) return false
        if ((failures[t.id]?.second ?: 0L) > now) return false
        return t.emergency || (refusedFull[t.id] ?: 0L) <= now
    }

    /** Admission (§5.6): content must fit the budget after LRU eviction; emergency files must fit the disk. Pinned / in-use files are never touched. */
    private fun admit(t: DownloadTarget): Boolean {
        val acc = computeAccounting()
        synchronized(lock) {
            val now = env.clock.nowMs()
            val need = max(0L, t.expectedSize - partBytes(t))
            val candidates = pruneCandidates(now)
            val victims = if (t.emergency) StorePolicy.freeFor(candidates, need, acc.freeBytes)
                else StorePolicy.pruneFor(candidates, acc.contentBytes, need, acc.budgetBytes)
            if (victims == null) {
                if (t.emergency) {
                    val n = (failures[t.id]?.first ?: 0) + 1
                    failures[t.id] = n to now + StorePolicy.retryDelayMs(n)
                } else {
                    refusedFull[t.id] = now + StorePolicy.FULL_RETRY_MS
                }
                generation++
                env.log("[content-store] store-full: ${t.id.take(8)} (${t.expectedSize} bytes) refused; current content and pins untouched")
                return false
            }
            victims.forEach { evict(it, "prune") }
            return true
        }
    }

    private fun download(t: DownloadTarget) {
        synchronized(lock) { crash = crash.begin(t.id) }
        persistCrash()
        progress = Progress(t.id, partBytes(t), t.expectedSize)
        val outcome = try {
            ChunkedDownload(layout, env, hasher, keepGoing = { !(preempt && !t.emergency) },
                progress = { loaded, total -> progress = Progress(t.id, loaded, total) }, beforeVerify = beforeVerify).run(t)
        } catch (e: Exception) {
            DownloadOutcome.Failed(StoreReasons.of(e, "store-unavailable"))
        }
        progress = null
        val now = env.clock.nowMs()
        synchronized(lock) {
            crash = crash.end(t.id, outcome is DownloadOutcome.Stored)
            when (outcome) {
                is DownloadOutcome.Stored -> {
                    put(record(t.tenant, t.id, t.lane, outcome.sha256, outcome.file, t.stableKey, now))
                    failures.remove(t.id)
                    generation++
                }
                DownloadOutcome.Preempted -> Unit
                is DownloadOutcome.Failed -> {
                    val n = (failures[t.id]?.first ?: 0) + 1
                    failures[t.id] = n to now + StorePolicy.retryDelayMs(n)
                    env.log("[content-store] ${t.id.take(8)} ${outcome.reason} (attempt $n)")
                }
                is DownloadOutcome.Quarantined -> {
                    quarantine[StorePolicy.quarantineKey(t.stableKey, t.id)] = now + StorePolicy.QUARANTINE_MS
                    failures.remove(t.id)
                    env.log("[content-store] ${t.id.take(8)} ${outcome.reason}: quarantined 6 h")
                }
            }
            dirty = true
        }
        persistCrash()
        persistIndex()
    }

    // ── the emergency set (§5.5) ─────────────────────────────────────────────

    private fun commitEmergency() {
        synchronized(lock) {
            for (tenant in boundTenants()) {
                val es = emergency[tenant] ?: continue
                val next = es.tryCommit { presentEmergency(tenant, it) }
                if (next != es) {
                    emergency[tenant] = next
                    emergencyDirty += tenant
                    generation++
                }
            }
        }
        persistEmergency()
    }

    /** A digest file is present when its record is verified; a lane file when it exists (never revalidated, F4). */
    private fun presentEmergency(tenant: String, e: EmergencyEntry): Boolean =
        if (e.lane) layout.laneFile(tenant, e.key).isFile else verified(tenant, e.key)

    private fun emergencyBlock(): JSONObject {
        val tenants = boundTenants()
        var count = 0
        var bytes = 0L
        for (r in records.values) if (r.tenant in tenants && isPinned(r)) {
            count++
            bytes += r.size
        }
        val states = tenants.mapNotNull { emergency[it]?.let { s -> it to s } }
        val complete = states.isNotEmpty() && states.size == tenants.size && states.all { (t, s) -> s.complete { presentEmergency(t, it) } }
        val setHash = if (states.size == 1) states[0].second.reportedHash() else null
        return JSONObject().put("setHash", setHash ?: JSONObject.NULL).put("complete", complete).put("count", count).put("bytes", bytes)
    }

    // ── records, verification, scrub (§5.4) ──────────────────────────────────

    private fun matches(r: StoreRecord, file: File): Boolean =
        file.isFile && file.length() == r.size && file.lastModified() == r.mtime && env.disk.inode(file) == r.inode

    private fun verified(tenant: String, sha: String): Boolean {
        val key = StoreRecord.key(tenant, sha, false)
        return records.containsKey(key) && key !in suspects
    }

    private fun record(tenant: String, id: String, lane: Boolean, sha: String, file: File, src: String, now: Long) =
        StoreRecord(tenant, id, lane, sha, file.length(), file.lastModified(), env.disk.inode(file), now, src, now)

    private fun put(r: StoreRecord) {
        records[r.key] = r
        suspects.remove(r.key)
        dirty = true
    }

    private fun evict(key: String, why: String) {
        val r = records.remove(key) ?: return
        layout.fileFor(r.tenant, r.id, r.lane).delete()
        generation++
        dirty = true
        env.log("[content-store] evicted ${r.id.take(8)} ($why)")
    }

    private fun rehashSuspects() {
        val deferred = ArrayList<String>()
        while (true) {
            val key = synchronized(lock) { suspects.firstOrNull { it !in deferred } } ?: break
            if (rehash(key) { !preempt } == null) deferred += key
        }
    }

    /**
     * Re-hash one file and settle its record. A content file whose bytes are
     * not its name is CORRUPT: evicted (and re-downloaded if still wanted). A
     * lane file is never revalidated: present = current (F4).
     * Null = not settled now (pre-empted, or set aside by the crash guard).
     */
    private fun rehash(key: String, keepGoing: () -> Boolean): FaultVerdict? {
        val (tenant, id, lane) = parseKey(key) ?: return synchronized(lock) { suspects.remove(key); FaultVerdict.ABSENT }
        val file = layout.fileFor(tenant, id, lane)
        val now = env.clock.nowMs()
        if (!file.isFile) return synchronized(lock) {
            suspects.remove(key)
            if (records.remove(key) != null) { generation++; dirty = true }
            FaultVerdict.ABSENT
        }
        val existing = synchronized(lock) { if (crash.isAside(id, now)) return null; records[key] }
        if (lane && existing != null) return synchronized(lock) {
            put(existing.copy(size = file.length(), mtime = file.lastModified(), inode = env.disk.inode(file)))
            FaultVerdict.INTACT
        }
        synchronized(lock) { crash = crash.begin(id) }
        persistCrash()
        val hash = try { hasher.sha256(file, keepGoing) } catch (e: Exception) { null }
        synchronized(lock) { crash = crash.end(id, hash != null) }
        persistCrash()
        hash ?: return null
        return synchronized(lock) {
            if (lane || hash == id) {
                put(record(tenant, id, lane, hash, file, existing?.sourceKey ?: "", now).copy(lastUsedAt = existing?.lastUsedAt ?: now))
                FaultVerdict.INTACT
            } else {
                suspects.remove(key)
                if (records.containsKey(key)) evict(key, "corrupt") else { file.delete(); generation++ }
                lastCorruption = id.take(8) to now
                failures.remove(id)
                FaultVerdict.CORRUPT_EVICTED
            }
        }
    }

    private fun scrub() {
        val now = env.clock.nowMs()
        val key = synchronized(lock) {
            val tenants = boundTenants()
            StorePolicy.scrubNext(records.values.filter { !it.lane && it.tenant in tenants }.map { ScrubCandidate(it.key, it.verifiedAt, isPinned(it)) }, now, lastScrubAt)
        } ?: return
        synchronized(lock) { lastScrubAt = now; dirty = true }
        rehash(key) { !preempt }
    }

    // ── adoption (§5.7, §8.3) ────────────────────────────────────────────────

    private fun adopt() {
        val tenants = synchronized(lock) { boundTenants().filter { it !in adoptedTenants } }
        for (tenant in tenants) {
            var complete = true
            for (ns in LEGACY_NAMESPACES) complete = adoptDir(tenant, File(File(filesDir, ns), tenant)) && complete
            complete = adoptUsb(tenant) && complete
            // Interrupted by an emergency set: the alert goes first, adoption resumes on the next turn.
            if (!complete) return
            synchronized(lock) {
                adoptedTenants += tenant
                generation++
            }
        }
    }

    private sealed class Hashed {
        class Done(val sha: String) : Hashed()
        object Preempted : Hashed()
        object Unreadable : Hashed()
    }

    /**
     * `native-video-v2/<tenant>/<sha>.mp4`, `shared-video-v1/<tenant>/<sha>.mp4`: verify once,
     * rename (same filesystem, zero copy). False when interrupted (retried on the next turn).
     */
    private fun adoptDir(tenant: String, dir: File): Boolean {
        val files = dir.listFiles()?.filter { it.isFile && LEGACY_NAME.matches(it.name) } ?: return true
        for (f in files) {
            val sha = f.name.substring(0, 64)
            if (!claimForAdoption(tenant, sha, f)) continue
            val hash = when (val r = guardedHash(sha, f)) {
                Hashed.Preempted -> return false
                Hashed.Unreadable -> { reject(f); continue }
                is Hashed.Done -> r.sha
            }
            if (hash != sha) {
                reject(f)
                continue
            }
            val dest = layout.contentFile(tenant, sha)
            if (!(dest.parentFile?.let { it.isDirectory || it.mkdirs() } ?: false) || !f.renameTo(dest)) {
                env.log("[content-store] adopt ${sha.take(8)}: rename failed")
                continue
            }
            synchronized(lock) {
                put(record(tenant, sha, false, sha, dest, "", env.clock.nowMs()))
                generation++
            }
        }
        return true
    }

    /**
     * The USB sneakernet cache: a file is adopted only when this tenant's own
     * authenticated sources name its digest (tenant isolation), by hard link so
     * the USB interceptor keeps serving it; a copy (verified as stored) when a
     * link is impossible and the budget allows.
     */
    private fun adoptUsb(tenant: String): Boolean {
        val root = File(filesDir, "usb-cache")
        val manifest = File(root, "manifest.json")
        if (!manifest.isFile) return true
        val assets = runCatching { JSONObject(manifest.readText()).optJSONArray("assets") }.getOrNull() ?: return true
        val named = synchronized(lock) { namedShas(tenant) }
        val rootPath = runCatching { root.canonicalPath }.getOrNull() ?: return true
        for (i in 0 until minOf(assets.length(), 4096)) {
            val a = assets.optJSONObject(i) ?: continue
            val sha = StoreNames.shaOrNull(a.optString("sha256", "")) ?: continue
            if (sha !in named) continue
            val rel = a.optString("localPath", "")
            if (rel.isEmpty() || rel.startsWith("/") || rel.contains("..") || rel.contains('\\')) continue
            val src = runCatching { File(root, rel).canonicalFile }.getOrNull() ?: continue
            if (!src.path.startsWith(rootPath + File.separator)) continue
            if (!claimForAdoption(tenant, sha, src)) continue
            val hash = when (val r = guardedHash(sha, src)) {
                Hashed.Preempted -> return false
                Hashed.Unreadable -> { reject(src); continue }
                is Hashed.Done -> r.sha
            }
            if (hash != sha) {
                reject(src)
                continue
            }
            val dest = layout.contentFile(tenant, sha)
            if (!(dest.parentFile?.let { it.isDirectory || it.mkdirs() } ?: false)) continue
            val ok = env.disk.link(src, dest) || copyVerified(tenant, sha, src, dest)
            if (ok) synchronized(lock) {
                put(record(tenant, sha, false, sha, dest, "", env.clock.nowMs()))
                generation++
            }
        }
        return true
    }

    private fun claimForAdoption(tenant: String, sha: String, f: File): Boolean = synchronized(lock) {
        // Never overwrite what the store already holds (a pinned file stays exactly as it is).
        !records.containsKey(StoreRecord.key(tenant, sha, false)) && !layout.contentFile(tenant, sha).exists() &&
            memo(f) !in rejected && !crash.isAside(sha, env.clock.nowMs())
    }

    private fun reject(f: File) = synchronized(lock) {
        rejected[memo(f)] = env.clock.nowMs()
        dirty = true
    }

    private fun memo(f: File) = "${f.path}|${f.length()}|${f.lastModified()}"

    private fun guardedHash(id: String, f: File): Hashed {
        synchronized(lock) { crash = crash.begin(id) }
        persistCrash()
        val result = try {
            hasher.sha256(f) { !preempt }?.let { Hashed.Done(it) } ?: Hashed.Preempted
        } catch (e: Exception) {
            Hashed.Unreadable
        }
        synchronized(lock) { crash = crash.end(id, result is Hashed.Done) }
        persistCrash()
        return result
    }

    private fun copyVerified(tenant: String, sha: String, src: File, dest: File): Boolean {
        val acc = computeAccounting()
        if (synchronized(lock) { StorePolicy.pruneFor(pruneCandidates(env.clock.nowMs()), acc.contentBytes, src.length(), acc.budgetBytes) } != emptyList<String>()) return false
        val staging = layout.stagingDir(tenant)
        if (!staging.isDirectory && !staging.mkdirs()) return false
        val tmp = File(staging, "$sha.adopt.part")
        return try {
            FileInputStream(src).use { input -> FileOutputStream(tmp).use { out -> copy(input, out); out.fd.sync() } }
            if (hasher.sha256(tmp) == sha && tmp.renameTo(dest)) true else { tmp.delete(); false }
        } catch (e: Exception) {
            tmp.delete()
            false
        }
    }

    // ── accounting, prune (§5.6) ─────────────────────────────────────────────

    internal fun computeAccounting(): Accounting {
        val usable = runCatching { env.disk.usableBytes(if (layout.root.isDirectory) layout.root else filesDir) }.getOrDefault(0L)
        var staging = 0L
        for (tenant in layout.tenantsOnDisk()) layout.stagingDir(tenant).listFiles()?.forEach { if (it.isFile && it.name.endsWith(".part")) staging += it.length() }
        synchronized(lock) {
            var used = 0L
            var pinned = 0L
            var content = 0L
            var largestPinned = 0L
            for (r in records.values) {
                used += r.size
                if (isPinned(r)) {
                    pinned += r.size
                    largestPinned = max(largestPinned, r.size)
                } else {
                    content += r.size
                }
            }
            val budget = StorePolicy.budget(usable, used + staging, pinned, largestPinned)
            return Accounting(used + staging, pinned, content, staging, largestPinned, budget, usable).also { accounting = it }
        }
    }

    private fun prune() {
        val acc = computeAccounting()
        synchronized(lock) {
            if (acc.contentBytes <= acc.budgetBytes) return
            StorePolicy.pruneOver(pruneCandidates(env.clock.nowMs()), acc.contentBytes, acc.budgetBytes).forEach { evict(it, "budget") }
        }
    }

    private fun pruneCandidates(now: Long): List<PruneCandidate> {
        val inUse = inUseShas(now)
        return records.values.map { PruneCandidate(it.key, it.size, it.lastUsedAt, isPinned(it), !it.lane && it.sha256 in inUse) }
    }

    /** In use: either face's current set (the page's intent, the server's native pick, every file its manifest names) and anything handed out in the last 10 min. */
    private fun inUseShas(now: Long): Set<String> {
        val out = HashSet<String>()
        intents.values.forEach { out.addAll(it) }
        for (fs in faces.values) {
            fs.nativeSha?.let { out += it }
            fs.items.forEach { out += it.sha256 }
        }
        recentUse.entries.removeAll { now - it.value > StorePolicy.RECENT_USE_MS }
        out.addAll(recentUse.keys)
        return out
    }

    private fun isPinned(r: StoreRecord): Boolean = emergency[r.tenant]?.pinned?.contains(r.id) == true

    private fun insufficient(): Boolean {
        val a = accounting ?: return false
        var largest = 0L
        for ((face, fs) in faces) for (sha in glassShas(face, fs)) fs.item(sha)?.let { largest = max(largest, it.size) }
        return StorePolicy.insufficient(a.budgetBytes, largest)
    }

    private fun storeFull(now: Long) = refusedFull.values.any { it > now }

    // ── mode, lists ──────────────────────────────────────────────────────────

    private fun modeNow(): Pair<String, String?> = when {
        !loaded -> MODE_OFF to "starting"
        !env.classAllows() -> MODE_OFF to "class"
        !enrolled -> MODE_OFF to "not-enrolled"
        boundTenants().isEmpty() -> MODE_OFF to "no-credential"
        insufficient() -> MODE_OFF to "insufficient-storage"
        !everActive -> MODE_ADOPTING to null
        else -> MODE_ACTIVE to null
    }

    /** `adopting` → `active` once every bound tenant was adopted and both faces' current sets are verified (§8.3). */
    private fun updateMode() = synchronized(lock) {
        if (everActive || !participating() || insufficient()) return@synchronized
        if (!boundTenants().all { it in adoptedTenants }) return@synchronized
        val glassVerified = faces.all { (face, fs) -> glassShas(face, fs).filter { fs.item(it) != null }.all { verified(fs.tenant, it) } }
        if (glassVerified) {
            everActive = true
            generation++
        }
    }

    /** ready = verified shas the server names (current sets first); pending = wanted, not yet verified. Each ≤ 64. */
    private fun lists(): Pair<List<String>, List<String>> {
        val ready = LinkedHashSet<String>()
        val pending = LinkedHashSet<String>()
        val glassByFace = faces.mapValues { (face, fs) -> glassShas(face, fs) }
        val ordered = ArrayList<Pair<FaceSource, String>>()
        val longest = glassByFace.values.maxOfOrNull { it.size } ?: 0
        for (i in 0 until longest) for ((face, g) in glassByFace) g.getOrNull(i)?.let { ordered += faces[face]!! to it }
        for (fs in faces.values) fs.items.forEach { ordered += fs to it.sha256 }
        for ((fs, sha) in ordered) {
            if (verified(fs.tenant, sha)) ready += sha
            else if (sha in (glassByFace[fs.face] ?: emptyList()) || fs.item(sha)?.video == true) pending += sha
        }
        return ready.take(StorePolicy.LIST_MAX) to pending.filter { it !in ready }.take(StorePolicy.LIST_MAX)
    }

    private fun glassShas(face: Int, fs: FaceSource): List<String> =
        intents[face]?.takeIf { it.isNotEmpty() } ?: listOfNotNull(fs.nativeSha)

    private fun boundTenants(): Set<String> = faces.values.mapTo(sortedSetOf()) { it.tenant }

    private fun namedShas(tenant: String): Set<String> {
        val out = HashSet<String>()
        for (fs in faces.values) if (fs.tenant == tenant) fs.items.forEach { out += it.sha256 }
        emergency[tenant]?.wanted()?.forEach { e -> e.sha256?.let { out += it } }
        return out
    }

    private fun partBytes(t: DownloadTarget): Long =
        layout.stagingDir(t.tenant).listFiles()?.filter { it.name.startsWith(t.id + ".") && it.name.endsWith(".part") }?.sumOf { it.length() } ?: 0L

    /** A confirmed re-pair: every tenant no current credential is bound to is deleted with its records and pins. */
    private fun purgeUnbound() {
        val bound = boundTenants()
        if (bound.isEmpty()) return
        val stale = (layout.tenantsOnDisk() + records.values.map { it.tenant }).toSet() - bound
        for (tenant in stale) {
            File(layout.root, tenant).deleteRecursively()
            records.keys.removeAll { it.startsWith("$tenant/") }
            suspects.removeAll { it.startsWith("$tenant/") }
            emergency.remove(tenant)
            emergencyReadOk.remove(tenant)
            alertMedia.remove(tenant)
            adoptedTenants.remove(tenant)
            generation++
            dirty = true
            env.log("[content-store] purged tenant ${tenant.take(8)} (credential now names another tenant)")
        }
    }

    // ── persistence ──────────────────────────────────────────────────────────

    private fun ensureLoaded() {
        if (synchronized(lock) { loaded }) return
        layout.root.mkdirs()
        val index = AtomicFiles.read(layout.index) { JSONObject(it) }
        val guard = AtomicFiles.read(layout.work) { CrashGuardState.parse(it) } ?: CrashGuardState()
        val now = env.clock.nowMs()
        val tenantsOnDisk = layout.tenantsOnDisk()
        val pins = tenantsOnDisk.mapNotNull { t ->
            AtomicFiles.read(layout.emergencyFile(t), withBackup = true) { EmergencyState.parse(it, env.storageAllowed) }?.let { t to it }
        }
        synchronized(lock) {
            index?.let { loadIndex(it, now) }
            crash = guard.onStart(now)
            pins.forEach { (t, s) -> emergency[t] = s }
            for (face in faces.keys.toList()) {
                if (env.screenIdOf(env.credentials.token(face))?.equals(faces[face]!!.screenId, ignoreCase = true) != true) faces.remove(face)
            }
            enrolled = faces.values.any { it.enrolled }
            // Files with no record (a lost index, a crash between rename and index write): re-hash before serving.
            for (t in tenantsOnDisk) {
                layout.tenantDir(t).listFiles()?.forEach { f -> if (f.isFile && StoreNames.isSha(f.name)) StoreRecord.key(t, f.name, false).let { if (it !in records) suspects += it } }
                File(layout.tenantDir(t), StoreNames.LANE).listFiles()?.forEach { f -> if (f.isFile && StoreNames.isSha(f.name)) StoreRecord.key(t, f.name, true).let { if (it !in records) suspects += it } }
            }
            loaded = true
            generation++
        }
        persistCrash()
        sweepStaging(now)
    }

    private fun loadIndex(j: JSONObject, now: Long) {
        if (j.optInt("v") != 1) return
        j.optJSONArray("records")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { StoreRecord.parse(it) }?.let { records[it.key] = it } }
        j.optJSONObject("quarantine")?.let { q -> q.keys().forEach { k -> q.optLong(k).takeIf { it > now }?.let { quarantine[k] = it } } }
        j.optJSONObject("rejected")?.let { q -> q.keys().forEach { k -> rejected[k] = q.optLong(k) } }
        j.optJSONObject("faces")?.let { o -> o.keys().forEach { k -> o.optJSONObject(k)?.let { FaceSource.parse(it, env.storageAllowed) }?.let { fs -> faces[fs.face] = fs } } }
        lastScrubAt = j.optLong("lastScrubAt")
        j.optJSONObject("lastCorruption")?.let { lastCorruption = it.optString("sha8") to it.optLong("at") }
    }

    private fun persist() {
        persistEmergency()
        persistIndex()
    }

    private fun persistIndex() {
        val text = synchronized(lock) {
            if (!dirty || !loaded) return
            dirty = false
            val recs = JSONArray()
            records.values.sortedBy { it.key }.forEach { recs.put(it.toJson()) }
            val fs = JSONObject()
            faces.values.forEach { fs.put(it.face.toString(), it.toJson()) }
            JSONObject().put("v", 1).put("records", recs).put("quarantine", JSONObject(quarantine as Map<*, *>))
                .put("rejected", JSONObject(rejected as Map<*, *>)).put("faces", fs).put("lastScrubAt", lastScrubAt)
                .put("lastCorruption", lastCorruption?.let { JSONObject().put("sha8", it.first).put("at", it.second) } ?: JSONObject.NULL)
                .toString()
        }
        try { AtomicFiles.write(layout.index, text) } catch (e: Exception) {
            synchronized(lock) { dirty = true }
            env.log("[content-store] index write failed: ${StoreReasons.of(e, "store-unavailable")}")
        }
    }

    /** The emergency state is written on its own (with a backup) the moment it changes: a lost index never loses a pin. */
    private fun persistEmergency() {
        val writes = synchronized(lock) {
            val w = emergencyDirty.filter { StoreNames.isTenant(it) }.mapNotNull { t -> emergency[t]?.let { t to it.toJson() } }
            emergencyDirty.clear()
            w
        }
        for ((tenant, text) in writes) {
            try { AtomicFiles.write(layout.emergencyFile(tenant), text, withBackup = true) } catch (e: Exception) {
                synchronized(lock) { emergencyDirty += tenant }
                env.log("[content-store] emergency write failed: ${StoreReasons.of(e, "store-unavailable")}")
            }
        }
    }

    private fun persistCrash() {
        val text = synchronized(lock) { crash.toJson().toString() }
        runCatching { AtomicFiles.write(layout.work, text) }
    }

    /** Orphan `.part` files (no state) and week-old abandoned downloads are removed; resumable parts are kept. */
    private fun sweepStaging(now: Long) {
        for (tenant in layout.tenantsOnDisk()) {
            val dir = layout.stagingDir(tenant)
            val files = dir.listFiles() ?: continue
            val metas = files.filter { it.name.endsWith(".part.json") }.map { it.name.removeSuffix(".json") }.toSet()
            for (f in files) {
                val stale = now - f.lastModified() > StorePolicy.SCRUB_MAX_AGE_MS
                if ((f.name.endsWith(".part") && f.name !in metas) || stale || f.name.endsWith(".tmp")) f.delete()
            }
        }
    }

    private fun parseKey(key: String): Triple<String, String, Boolean>? {
        val parts = key.split('/')
        return when {
            parts.size == 2 && StoreNames.isTenant(parts[0]) && StoreNames.isSha(parts[1]) -> Triple(parts[0], parts[1], false)
            parts.size == 3 && parts[1] == StoreNames.LANE && StoreNames.isTenant(parts[0]) && StoreNames.isSha(parts[2]) -> Triple(parts[0], parts[2], true)
            else -> null
        }
    }

    private fun normalizeTag(tag: String?): String = tag?.trim()?.removePrefix("W/")?.trim('"') ?: ""

    companion object {
        const val MODE_OFF = "off"
        const val MODE_ADOPTING = "adopting"
        const val MODE_ACTIVE = "active"
        val LEGACY_NAMESPACES = listOf("native-video-v2", "shared-video-v1")
        private val LEGACY_NAME = Regex("^[a-f0-9]{64}\\.mp4$")

        fun readBounded(input: InputStream, max: Long): String {
            val out = java.io.ByteArrayOutputStream()
            val block = ByteArray(8192)
            while (true) {
                val n = input.read(block)
                if (n < 0) break
                require(out.size() + n <= max) { "response-too-large" }
                out.write(block, 0, n)
            }
            return String(out.toByteArray(), Charsets.UTF_8)
        }

        private fun copy(input: InputStream, out: FileOutputStream) {
            val block = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(block)
                if (n < 0) break
                out.write(block, 0, n)
            }
        }
    }
}
