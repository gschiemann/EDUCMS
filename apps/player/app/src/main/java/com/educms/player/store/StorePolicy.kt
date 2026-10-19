package com.educms.player.store

import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * The store's rules as pure functions (design §5.3–§5.6), so every number the
 * design states is a unit-tested value, not a side effect of the I/O code.
 */
internal object StorePolicy {
    const val MIB = 1024L * 1024
    const val GIB = 1024L * MIB

    /** The page's `LARGE_MEDIA_BYTES` / the worker's `LARGE_ASSET_BYTES` (rule 17). Readiness-gated + chunked at or above. */
    const val LARGE_BYTES = 8 * MIB

    /** Range chunks: start at 8 MiB, halve on failure to a 1 MiB floor, double on a fast link up to 32 MiB (§5.3). */
    const val CHUNK_START = 8 * MIB
    const val CHUNK_MIN = 1 * MIB
    const val CHUNK_MAX = 32 * MIB
    /** A chunk that lands faster than this doubles the next one. */
    const val FAST_CHUNK_MS = 4_000L
    /** A chunk's deadline: a minute, or long enough at 128 KiB/s (the existing native floor rate). */
    const val CHUNK_DEADLINE_FLOOR_MS = 60_000L
    /** A server that ignores Range gets one whole-file attempt with today's generous deadline (SharedVideoSource). */
    const val WHOLE_FILE_FLOOR_MS = 300_000L
    const val SLOW_LINK_BYTES_PER_SEC = 131_072L
    const val MAX_FILE_BYTES = 2 * GIB
    const val MAX_REDIRECTS = 3
    /** Consecutive failed chunks before one attempt yields to the retry schedule (the part stays; it resumes). */
    const val MAX_CHUNK_FAILURES = 3

    /** Budget = min(8 GiB, usable − 512 MiB OS reserve − pinned reserve) (§5.6). */
    const val OS_RESERVE = 512 * MIB
    const val BUDGET_CAP = 8 * GIB

    /** A complete download that fails verification is not fetched again for 6 h per (stable key, sha) (§5.3). */
    const val QUARANTINE_MS = 6 * 3_600_000L
    /** The process died twice while downloading / verifying one file → that file is set aside for 6 h (§5.3). */
    const val CRASH_LIMIT = 2
    const val CRASH_ASIDE_MS = 6 * 3_600_000L

    /** The final verify never starves 4K playback reads (initial value; to be tuned on rk3288). */
    const val VERIFY_BYTES_PER_SEC = 50_000_000L

    /** Scrub: at most one file per hour, every file at least weekly, pinned first (§5.4). */
    const val SCRUB_EVERY_MS = 3_600_000L
    const val SCRUB_MAX_AGE_MS = 7 * 86_400_000L

    /** A file handed to a session in the last 10 min counts as in use (stands in for the decoder refcount). */
    const val RECENT_USE_MS = 600_000L

    /** `ready` / `pending` bound in the state block (§6). */
    const val LIST_MAX = 64

    /** `onSync` re-reads at most this often (single-flight on top). */
    const val SYNC_MIN_INTERVAL_MS = 5_000L
    /** The store's own periodic re-reads while enrolled (ETag 304s make them cheap). */
    const val MANIFEST_REFRESH_MS = 600_000L
    const val EMERGENCY_REFRESH_MS = 900_000L

    /** Network failures: 30 s doubling to 15 min, per file, never blocking the other files. */
    const val RETRY_BASE_MS = 30_000L
    const val RETRY_CAP_MS = 900_000L
    /** A file refused for space (`store-full`) is reconsidered after this, or when the sets change. */
    const val FULL_RETRY_MS = 900_000L

    fun nextChunk(current: Long, ok: Boolean, elapsedMs: Long): Long = when {
        !ok -> max(CHUNK_MIN, current / 2)
        elapsedMs < FAST_CHUNK_MS -> min(CHUNK_MAX, current * 2)
        else -> min(CHUNK_MAX, max(CHUNK_MIN, current))
    }

    fun chunkDeadlineMs(bytes: Long): Long = max(CHUNK_DEADLINE_FLOOR_MS, bytes / SLOW_LINK_BYTES_PER_SEC * 1000L)

    fun wholeFileDeadlineMs(size: Long): Long = max(WHOLE_FILE_FLOOR_MS, size / SLOW_LINK_BYTES_PER_SEC * 1000L)

    fun retryDelayMs(failures: Int): Long =
        if (failures <= 0) 0L else min(RETRY_CAP_MS, RETRY_BASE_MS shl min(failures - 1, 10))

    /**
     * The bytes non-pinned content may occupy. The store's own bytes count as
     * capacity (they are space the store already holds), so the budget does not
     * shrink as the store fills.
     */
    fun budget(usableBytes: Long, storeBytes: Long, pinnedBytes: Long, largestPinned: Long): Long =
        max(0L, min(BUDGET_CAP, usableBytes + storeBytes - OS_RESERVE - pinnedBytes - largestPinned))

    /** Store mode stays off when the budget cannot hold the largest current file × 1.5 (`insufficient-storage`). */
    fun insufficient(budget: Long, largestCurrent: Long): Boolean = largestCurrent > 0 && budget < largestCurrent + largestCurrent / 2

    /**
     * What to evict so [need] more content bytes fit in [budget]: least
     * recently used first, NEVER a pinned or in-use file. Empty = fits as is;
     * null = it cannot fit even with every evictable file gone (`store-full`),
     * in which case nothing at all is evicted.
     */
    fun pruneFor(files: List<PruneCandidate>, contentBytes: Long, need: Long, budget: Long): List<String>? {
        if (contentBytes + need <= budget) return emptyList()
        var bytes = contentBytes
        val victims = ArrayList<String>()
        for (f in evictable(files)) {
            victims += f.key
            bytes -= f.bytes
            if (bytes + need <= budget) return victims
        }
        return null
    }

    /** Back under budget (no new file): LRU evictable files until it fits, or every evictable file when it cannot. */
    fun pruneOver(files: List<PruneCandidate>, contentBytes: Long, budget: Long): List<String> =
        pruneFor(files, contentBytes, 0L, budget) ?: evictable(files).map { it.key }

    /**
     * Room on the DISK for an emergency file of [need] bytes (emergency files sit
     * outside the content budget but never eat the OS reserve). Empty = fits;
     * null = cannot.
     */
    fun freeFor(files: List<PruneCandidate>, need: Long, usableBytes: Long): List<String>? {
        var free = usableBytes - OS_RESERVE
        if (need <= free) return emptyList()
        val victims = ArrayList<String>()
        for (f in evictable(files)) {
            victims += f.key
            free += f.bytes
            if (need <= free) return victims
        }
        return null
    }

    private fun evictable(files: List<PruneCandidate>) =
        files.filter { !it.pinned && !it.inUse }.sortedWith(compareBy<PruneCandidate>({ it.lastUsedAt }, { it.key }))

    private val CONTENT_RANGE = Regex("^bytes (\\d{1,19})-(\\d{1,19})/(\\d{1,19}|\\*)$")

    fun parseContentRange(header: String?): ContentRange? {
        val m = CONTENT_RANGE.matchEntire(header?.trim() ?: return null) ?: return null
        val start = m.groupValues[1].toLongOrNull() ?: return null
        val end = m.groupValues[2].toLongOrNull() ?: return null
        val total = if (m.groupValues[3] == "*") null else (m.groupValues[3].toLongOrNull() ?: return null)
        if (end < start || (total != null && end >= total)) return null
        return ContentRange(start, end, total)
    }

    /** A 206 is accepted only when it is exactly the bytes asked for (a shorter tail is allowed), of the file we know. */
    fun rangeAgrees(cr: ContentRange?, start: Long, end: Long, knownTotal: Long): Boolean =
        cr != null && cr.start == start && cr.end <= end &&
            (if (knownTotal > 0) cr.total == null || cr.total == knownTotal else cr.total != null)

    fun quarantineKey(stableKey: String, id: String): String = "$stableKey|$id"

    /** The next file to re-hash, or null: one per hour at most, every file weekly, pinned first, oldest first. */
    fun scrubNext(candidates: List<ScrubCandidate>, now: Long, lastScrubAt: Long): String? {
        if (now - lastScrubAt < SCRUB_EVERY_MS) return null
        return candidates.filter { now - it.verifiedAt >= SCRUB_MAX_AGE_MS }
            .sortedWith(compareBy<ScrubCandidate>({ !it.pinned }, { it.verifiedAt }, { it.key }))
            .firstOrNull()?.key
    }

    /**
     * One download at a time, in this order (§5.3): (1) the emergency set,
     * (2) the content on the glass in play order, (3) the next content. Faces
     * interleave by position, so both faces' first items come before either
     * face's second. Duplicates keep their first (highest) place.
     */
    fun order(emergency: List<String>, glass: Map<Int, List<String>>, next: Map<Int, List<String>>): List<String> {
        val out = LinkedHashSet<String>()
        out.addAll(emergency)
        interleave(glass, out)
        interleave(next, out)
        return out.toList()
    }

    private fun interleave(perFace: Map<Int, List<String>>, out: LinkedHashSet<String>) {
        val faces = perFace.keys.sorted()
        val longest = perFace.values.maxOfOrNull { it.size } ?: 0
        for (i in 0 until longest) for (f in faces) perFace[f]?.getOrNull(i)?.let { out.add(it) }
    }
}

internal data class ContentRange(val start: Long, val end: Long, val total: Long?)

internal data class PruneCandidate(val key: String, val bytes: Long, val lastUsedAt: Long, val pinned: Boolean, val inUse: Boolean)

internal data class ScrubCandidate(val key: String, val verifiedAt: Long, val pinned: Boolean)

/**
 * The crash guard (§5.3), as the page's `playbackSafety` does for the WebView:
 * a marker is written BEFORE downloading or verifying a file and cleared after;
 * a marker still present at the next start means the process died doing it.
 * Two deaths on one file set it aside for 6 h. Persisted in `.work.json`.
 */
internal data class CrashGuardState(
    val active: String? = null,
    val deaths: Map<String, Int> = emptyMap(),
    val aside: Map<String, Long> = emptyMap(),
) {
    fun onStart(now: Long): CrashGuardState {
        val liveAside = aside.filterValues { it > now }
        val key = active ?: return copy(aside = liveAside)
        val count = (deaths[key] ?: 0) + 1
        return if (count >= StorePolicy.CRASH_LIMIT) {
            CrashGuardState(null, deaths - key, liveAside + (key to now + StorePolicy.CRASH_ASIDE_MS))
        } else {
            CrashGuardState(null, deaths + (key to count), liveAside)
        }
    }

    fun begin(key: String): CrashGuardState = copy(active = key)

    /** The work ended without the process dying; a success also forgets earlier deaths. */
    fun end(key: String, success: Boolean): CrashGuardState =
        copy(active = null, deaths = if (success) deaths - key else deaths)

    fun isAside(key: String, now: Long): Boolean = (aside[key] ?: 0L) > now

    fun toJson(): JSONObject = JSONObject()
        .put("active", active ?: JSONObject.NULL)
        .put("deaths", JSONObject(deaths as Map<*, *>))
        .put("aside", JSONObject(aside as Map<*, *>))

    companion object {
        fun parse(text: String): CrashGuardState {
            val j = JSONObject(text)
            val active = j.optString("active", "").takeIf { StoreNames.isSha(it) }
            fun <T> map(key: String, read: (JSONObject, String) -> T): Map<String, T> {
                val o = j.optJSONObject(key) ?: return emptyMap()
                return o.keys().asSequence().filter { StoreNames.isSha(it) }.associateWith { read(o, it) }
            }
            return CrashGuardState(active, map("deaths") { o, k -> o.optInt(k) }, map("aside") { o, k -> o.optLong(k) })
        }
    }
}
