package com.educms.player.store

import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.URL
import java.security.SecureRandom
import kotlin.math.max
import kotlin.math.min

/** One file the store may fetch: identity from its OWN authenticated read, never from the page. */
internal data class DownloadTarget(
    val tenant: String,
    /** The content digest, or for a lane file the digest of its stable key. Names every path. */
    val id: String,
    /** A URL-keyed lane file: an emergency asset the server published with no digest. */
    val lane: Boolean,
    /** The digest the bytes must have; null only for a lane file. */
    val sha256: String?,
    val url: String,
    val stableKey: String,
    /** The size the authenticated response stated; 0 = unknown (then taken from Content-Range). */
    val expectedSize: Long,
    val emergency: Boolean,
)

internal sealed class DownloadOutcome {
    data class Stored(val file: File, val sha256: String, val size: Long) : DownloadOutcome()
    /** Stopped for something more important (the emergency set); the part resumes where it stopped. */
    object Preempted : DownloadOutcome()
    /** Network / server / storage trouble: retried on the schedule, the part resumes. Never a verdict on the file. */
    data class Failed(val reason: String) : DownloadOutcome()
    /** The COMPLETE file's stored bytes are not the named digest: set aside for 6 h per (stable key, sha). */
    data class Quarantined(val reason: String) : DownloadOutcome()
}

/** The persisted state of one chunked download (`.part.json`, fsynced after the bytes it counts). */
internal data class PartState(
    val id: String,
    val sha256: String?,
    val sourceKey: String,
    val expectedSize: Long,
    val total: Long,
    val written: Long,
    val etag: String?,
    val lastModified: String?,
    val chunk: Long,
    val rangeless: Boolean,
    val nonce: String,
) {
    fun toJson(): String = JSONObject()
        .put("v", 1).put("id", id).put("sha", sha256 ?: JSONObject.NULL).put("src", sourceKey)
        .put("size", expectedSize).put("total", total).put("written", written)
        .put("etag", etag ?: JSONObject.NULL).put("lm", lastModified ?: JSONObject.NULL)
        .put("chunk", chunk).put("rangeless", rangeless).put("nonce", nonce).toString()

    companion object {
        fun parse(text: String): PartState? = runCatching {
            val j = JSONObject(text)
            if (j.optInt("v") != 1) return null
            val s = PartState(
                id = j.getString("id"),
                sha256 = if (j.isNull("sha")) null else j.getString("sha"),
                sourceKey = j.getString("src"),
                expectedSize = j.getLong("size"),
                total = j.getLong("total"),
                written = j.getLong("written"),
                etag = if (j.isNull("etag")) null else j.optString("etag"),
                lastModified = if (j.isNull("lm")) null else j.optString("lm"),
                chunk = j.getLong("chunk"),
                rangeless = j.optBoolean("rangeless", false),
                nonce = j.getString("nonce"),
            )
            s.takeIf {
                StoreNames.isSha(it.id) && StoreNames.isNonce(it.nonce) && (it.sha256 == null || StoreNames.isSha(it.sha256)) &&
                    it.written >= 0 && (it.total == 0L || it.written <= it.total)
            }
        }.getOrNull()
    }
}

/**
 * Download one file whole, in short verified resumable steps (§5.3, rule 17):
 *
 * - HTTP Range chunks (8 MiB, halved on failure to 1 MiB, doubled on a fast link
 *   to 32 MiB), each appended to the staging file; the bytes are fsynced BEFORE
 *   `bytesWritten` is, so a crash or reboot resumes exactly at `bytesWritten`.
 * - Every 206 must state exactly the range asked for (`Content-Range`), or the
 *   chunk is discarded. A changed ETag / Last-Modified / size restarts the file
 *   (`source-changed`). A server that ignores Range gets one whole-file attempt.
 * - VERIFIED AS STORED: the SHA-256 is computed over the bytes read back from
 *   disk after fsync, then an atomic rename gives the file its real name. No
 *   unverified byte ever has the real name.
 * - No credential is ever sent: these are storage-host requests, each hop of at
 *   most three redirects re-checked against the storage allowlist.
 */
internal class ChunkedDownload(
    private val layout: StoreLayout,
    private val env: StoreEnv,
    private val hasher: DiskHasher,
    /** Polled between blocks; false pre-empts (the part is checkpointed and resumes later). */
    private val keepGoing: () -> Boolean,
    private val progress: (loaded: Long, total: Long) -> Unit = { _, _ -> },
    /** Test seam: runs on the complete staging file just before the as-stored verify. */
    private val beforeVerify: (File) -> Unit = {},
) {
    private sealed class Step {
        data class Wrote(val bytes: Long, val expected: Long) : Step()
        data class Aborted(val bytes: Long) : Step()
        object Mismatch : Step()
        object SourceChanged : Step()
        object Rangeless : Step()
        object AlreadyComplete : Step()
        data class Fail(val reason: String, val retryable: Boolean) : Step()
    }

    fun run(t: DownloadTarget): DownloadOutcome {
        val staging = layout.stagingDir(t.tenant)
        if (!staging.isDirectory && !staging.mkdirs()) return DownloadOutcome.Failed("store-unavailable")
        var st = resume(t) ?: fresh(t)
        var chunk = st.chunk.coerceIn(StorePolicy.CHUNK_MIN, StorePolicy.CHUNK_MAX)
        var failures = 0
        var mismatches = 0
        var restarts = 0
        var lastFailure = "media-incomplete"
        while (true) {
            if (!keepGoing()) return DownloadOutcome.Preempted
            if (st.total > 0 && st.written >= st.total) break
            if (st.total > StorePolicy.MAX_FILE_BYTES) return fail(t, st, "media-size")
            val start = st.written
            val end = if (st.total > 0) min(start + chunk, st.total) - 1 else start + chunk - 1
            val ranged = !st.rangeless
            val headers = if (ranged) mapOf("Range" to "bytes=$start-$end") else emptyMap()
            val deadline = if (ranged) StorePolicy.chunkDeadlineMs(end - start + 1)
                else StorePolicy.wholeFileDeadlineMs(max(st.total, t.expectedSize))
            val began = env.clock.nowMs()
            val step = try {
                val resp = open(t.url, headers, deadline)
                try { if (ranged) rangedStep(t, resp, st, start, end) { st = it } else wholeStep(t, resp, st) { st = it } }
                finally { resp.close() }
            } catch (e: Exception) {
                Step.Fail(StoreReasons.of(e, "media-incomplete"), retryable = true)
            }
            when (step) {
                is Step.Wrote -> {
                    if (step.bytes < step.expected) {
                        failures++; lastFailure = "media-incomplete"
                        chunk = StorePolicy.nextChunk(chunk, false, 0)
                    } else {
                        failures = 0; mismatches = 0
                        chunk = StorePolicy.nextChunk(chunk, true, env.clock.nowMs() - began)
                    }
                    st = st.copy(chunk = chunk)
                    checkpoint(t, st)
                    if (failures >= StorePolicy.MAX_CHUNK_FAILURES) return DownloadOutcome.Failed(lastFailure)
                }
                is Step.Aborted -> return DownloadOutcome.Preempted
                Step.AlreadyComplete -> break
                Step.Mismatch -> {
                    mismatches++
                    chunk = StorePolicy.nextChunk(chunk, false, 0)
                    st = st.copy(chunk = chunk)
                    checkpoint(t, st)
                    if (mismatches >= StorePolicy.MAX_CHUNK_FAILURES) return DownloadOutcome.Failed("content-range-mismatch")
                }
                Step.SourceChanged -> {
                    discard(t, st)
                    restarts++
                    if (restarts > 1) return DownloadOutcome.Failed("source-changed")
                    t.log("source-changed: restarting")
                    st = fresh(t)
                    chunk = st.chunk
                }
                Step.Rangeless -> {
                    // The server ignored Range: one whole-file attempt from byte 0.
                    discardBytes(t, st)
                    st = st.copy(written = 0, rangeless = true)
                    checkpoint(t, st)
                }
                is Step.Fail -> {
                    failures++; lastFailure = step.reason
                    chunk = StorePolicy.nextChunk(chunk, false, 0)
                    st = st.copy(chunk = chunk)
                    checkpoint(t, st)
                    if (!step.retryable || failures >= StorePolicy.MAX_CHUNK_FAILURES) {
                        if (st.rangeless && st.written in 1 until st.total) {
                            // A whole-file body cannot resume: start that one attempt over next time.
                            discardBytes(t, st); st = st.copy(written = 0); checkpoint(t, st)
                        }
                        return DownloadOutcome.Failed(step.reason)
                    }
                }
            }
        }
        return verifyAndPublish(t, st)
    }

    private fun verifyAndPublish(t: DownloadTarget, st: PartState): DownloadOutcome {
        val part = layout.partFile(t.tenant, t.id, st.nonce)
        if (!part.isFile || part.length() != st.total || (t.expectedSize > 0 && st.total != t.expectedSize)) {
            discard(t, st)
            return DownloadOutcome.Failed("media-incomplete")
        }
        beforeVerify(part)
        val hash = hasher.sha256(part, keepGoing) ?: return DownloadOutcome.Preempted
        if (!t.lane && hash != t.sha256) {
            discard(t, st)
            return DownloadOutcome.Quarantined("media-digest")
        }
        val dest = layout.fileFor(t.tenant, t.id, t.lane)
        val dir = dest.parentFile
        if (dir == null || (!dir.isDirectory && !dir.mkdirs())) return DownloadOutcome.Failed("store-unavailable")
        if (!part.renameTo(dest)) {
            dest.delete()
            if (!part.renameTo(dest)) return DownloadOutcome.Failed("media-publish")
        }
        layout.partMeta(t.tenant, t.id, st.nonce).delete()
        return DownloadOutcome.Stored(dest, hash, st.total)
    }

    private fun rangedStep(t: DownloadTarget, resp: StoreResponse, st0: PartState, start: Long, end: Long, update: (PartState) -> Unit): Step {
        when (resp.code) {
            206 -> Unit
            200 -> return Step.Rangeless
            416 -> return if (st0.total > 0 && start >= st0.total) Step.AlreadyComplete else Step.SourceChanged
            else -> return httpFail(resp.code)
        }
        val cr = StorePolicy.parseContentRange(resp.header("Content-Range")) ?: return Step.Mismatch
        if (t.expectedSize > 0 && cr.total != null && cr.total != t.expectedSize) return Step.Fail("media-size", retryable = false)
        if (st0.total > 0 && cr.total != null && cr.total != st0.total) return Step.SourceChanged
        if (validatorsChanged(st0, resp)) return Step.SourceChanged
        if (!StorePolicy.rangeAgrees(cr, start, end, st0.total)) return Step.Mismatch
        var st = st0.copy(
            total = if (st0.total > 0) st0.total else cr.total!!,
            etag = st0.etag ?: resp.header("ETag"),
            lastModified = st0.lastModified ?: resp.header("Last-Modified"),
        )
        if (st.total > StorePolicy.MAX_FILE_BYTES) return Step.Fail("media-size", retryable = false)
        update(st)
        val expected = cr.end - cr.start + 1
        val (wrote, aborted) = append(t, st, start, expected, resp.body)
        st = st.copy(written = start + wrote)
        update(st)
        checkpoint(t, st)
        return if (aborted) Step.Aborted(wrote) else Step.Wrote(wrote, expected)
    }

    private fun wholeStep(t: DownloadTarget, resp: StoreResponse, st0: PartState, update: (PartState) -> Unit): Step {
        if (resp.code != 200) return httpFail(resp.code)
        val length = resp.header("Content-Length")?.trim()?.toLongOrNull() ?: -1L
        val total = when {
            t.expectedSize > 0 -> t.expectedSize
            length > 0 -> length
            else -> return Step.Fail("media-size", retryable = false)
        }
        if (length > 0 && length != total) return Step.Fail("media-size", retryable = false)
        var st = st0.copy(total = total, written = 0, etag = resp.header("ETag"), lastModified = resp.header("Last-Modified"))
        update(st)
        val (wrote, aborted) = append(t, st, 0, total, resp.body)
        st = st.copy(written = wrote)
        update(st)
        checkpoint(t, st)
        return if (aborted) Step.Aborted(wrote) else Step.Wrote(wrote, total)
    }

    /** Append at most [expected] body bytes at [offset]; the data is fsynced before the caller checkpoints the count. */
    private fun append(t: DownloadTarget, st: PartState, offset: Long, expected: Long, body: InputStream): Pair<Long, Boolean> {
        val part = layout.partFile(t.tenant, t.id, st.nonce)
        var wrote = 0L
        var aborted = false
        RandomAccessFile(part, "rw").use { raf ->
            raf.setLength(offset)
            raf.seek(offset)
            try {
                val block = ByteArray(64 * 1024)
                while (wrote < expected) {
                    if (!keepGoing()) { aborted = true; break }
                    val n = body.read(block, 0, min(block.size.toLong(), expected - wrote).toInt())
                    if (n < 0) break
                    raf.write(block, 0, n)
                    wrote += n
                    progress(offset + wrote, st.total)
                }
            } finally {
                raf.fd.sync()
            }
        }
        return wrote to aborted
    }

    private fun open(url0: String, headers: Map<String, String>, deadline: Long): StoreResponse {
        var url = url0
        for (hop in 0..StorePolicy.MAX_REDIRECTS) {
            require(env.storageAllowed(url)) { "media-origin" }
            val resp = env.http.get(url, headers, deadline)
            if (resp.code in REDIRECTS) {
                val location = resp.header("Location")
                resp.close()
                url = URL(URL(url), location ?: error("media-redirect")).toString()
                continue
            }
            return resp
        }
        error("media-redirect")
    }

    private fun validatorsChanged(st: PartState, resp: StoreResponse): Boolean {
        val etag = resp.header("ETag")
        if (st.etag != null && etag != null) return etag != st.etag
        val lm = resp.header("Last-Modified")
        return st.etag == null && st.lastModified != null && lm != null && lm != st.lastModified
    }

    private fun httpFail(code: Int): Step =
        Step.Fail("media-http-$code", retryable = code >= 500 || code == 408 || code == 429)

    private fun resume(t: DownloadTarget): PartState? {
        val staging = layout.stagingDir(t.tenant)
        val metas = staging.listFiles()?.filter { it.isFile && it.name.startsWith(t.id + ".") && it.name.endsWith(".part.json") }
            ?.sortedByDescending { it.lastModified() } ?: return null
        var best: PartState? = null
        for (m in metas) {
            val s = AtomicFiles.read(m) { PartState.parse(it) }
            val usable = best == null && s != null && s.id == t.id && s.sourceKey == t.stableKey && s.sha256 == t.sha256 &&
                (t.expectedSize <= 0 || s.total <= 0 || s.total == t.expectedSize)
            if (usable) best = s
            else {
                s?.let { layout.partFile(t.tenant, t.id, it.nonce).delete() }
                m.delete()
            }
        }
        val s = best ?: return null
        val part = layout.partFile(t.tenant, t.id, s.nonce)
        if (!part.isFile || part.length() < s.written) {
            part.delete(); layout.partMeta(t.tenant, t.id, s.nonce).delete()
            return null
        }
        // Bytes past the checkpoint were never counted, so they are unproven: drop them.
        if (part.length() > s.written) RandomAccessFile(part, "rw").use { it.setLength(s.written) }
        return s
    }

    private fun fresh(t: DownloadTarget): PartState {
        val nonce = ByteArray(8).also { RANDOM.nextBytes(it) }
        val st = PartState(t.id, t.sha256, t.stableKey, t.expectedSize, if (t.expectedSize > 0) t.expectedSize else 0L, 0L,
            null, null, StorePolicy.CHUNK_START, false, Hashing.hex(nonce))
        layout.partFile(t.tenant, t.id, st.nonce).createNewFile()
        checkpoint(t, st)
        return st
    }

    private fun checkpoint(t: DownloadTarget, st: PartState) =
        AtomicFiles.write(layout.partMeta(t.tenant, t.id, st.nonce), st.toJson())

    private fun discard(t: DownloadTarget, st: PartState) {
        layout.partFile(t.tenant, t.id, st.nonce).delete()
        layout.partMeta(t.tenant, t.id, st.nonce).delete()
    }

    private fun discardBytes(t: DownloadTarget, st: PartState) {
        val part = layout.partFile(t.tenant, t.id, st.nonce)
        if (part.isFile) RandomAccessFile(part, "rw").use { it.setLength(0) }
    }

    private fun fail(t: DownloadTarget, st: PartState, reason: String): DownloadOutcome {
        discard(t, st)
        return DownloadOutcome.Failed(reason)
    }

    private fun DownloadTarget.log(msg: String) = env.log("[content-store] ${id.take(8)} $msg")

    private companion object {
        val REDIRECTS = setOf(301, 302, 303, 307, 308)
        val RANDOM = SecureRandom()
    }
}

/** Short, secret-free failure codes (no URL, no token, no path ever reaches a reason). */
internal object StoreReasons {
    fun of(e: Throwable, fallback: String): String {
        val m = e.message ?: ""
        return when {
            e is java.net.SocketTimeoutException -> "timeout"
            e is IllegalArgumentException && m.matches(Regex("^[a-z0-9-]{3,40}$")) -> m
            e is IllegalStateException && m.matches(Regex("^[a-z0-9-]{3,40}$")) -> m
            else -> fallback
        }
    }
}
