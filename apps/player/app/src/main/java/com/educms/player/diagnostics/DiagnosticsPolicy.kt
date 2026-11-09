package com.educms.player.diagnostics

import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

/**
 * SCREEN DIAGNOSTICS — the pure rules (2026-11-08, Manager waves, wave 2).
 *
 * The operator presses "Run self-test" or "Get recent logs" in the screen
 * drawer. The request reaches this unit three ways — signed pub/sub and the
 * manifest (both read by the page) and the native status heartbeat's reply
 * (read here, so a dead or asleep page still answers) — with ONE identity,
 * the request id. This side runs an id at most once ([shouldRun]) and answers
 * BY VALUE: it posts its result for that id, never compares clocks.
 *
 * Nothing here touches playback or the emergency tier: every probe is a
 * read (StatFs, a 64 KiB scratch file in the cache dir, one HTTPS GET of the
 * API's liveness route, a DNS lookup, ConnectivityManager facts, the WebView
 * package version), each bounded by [TIMEOUT_MS] on a worker thread.
 *
 * Pure — DiagnosticsPolicyTest pins it.
 */
object DiagnosticsPolicy {

    const val TIMEOUT_MS = 6_000L
    /** The whole self-test, hard ceiling. */
    const val SELF_TEST_BUDGET_MS = 25_000L
    /** logcat for one package, hard ceiling. */
    const val LOGCAT_TIMEOUT_MS = 8_000L
    /** Player + Manager bundle, bytes before upload (the API refuses > 1.5 MB). */
    const val LOG_PLAYER_MAX_BYTES = 900_000
    const val LOG_MANAGER_MAX_BYTES = 400_000
    const val MINUTES_MIN = 5
    const val MINUTES_MAX = 60

    /** A storage report rides the heartbeat at most this often. */
    const val STORAGE_REPORT_EVERY_MS = 30L * 60_000L
    const val WRITE_TEST_BYTES = 64 * 1024

    enum class Kind { SELF_TEST, LOGS }

    data class Request(val id: String, val kind: Kind, val minutes: Int)

    private val ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    /** `{id, kind, minutes?}` from a heartbeat reply / page relay; null for anything else. */
    fun parse(id: String?, kind: String?, minutes: Int?): Request? {
        if (id == null || !ID.matches(id)) return null
        return when (kind) {
            "SELF_TEST" -> Request(id, Kind.SELF_TEST, 0)
            "LOGS" -> Request(id, Kind.LOGS, (minutes ?: 15).coerceIn(MINUTES_MIN, MINUTES_MAX))
            else -> null
        }
    }

    /**
     * Run [req] unless it is the id already done or already started twice.
     * Value identity: the persisted id, never a timestamp.
     */
    fun shouldRun(req: Request, doneId: String?, startedId: String?, startedCount: Int): Boolean {
        if (req.id == doneId) return false
        if (req.id == startedId && startedCount >= 2) return false
        return true
    }

    fun storageReportDue(nowMs: Long, lastReportMs: Long): Boolean =
        lastReportMs <= 0L || nowMs < lastReportMs || nowMs - lastReportMs >= STORAGE_REPORT_EVERY_MS

    /** The x-venueos-storage header body. */
    fun storageHeader(freeBytes: Long, totalBytes: Long, writeOk: Boolean?, writeMs: Long?): String {
        val sb = StringBuilder("{\"schema\":1,\"freeBytes\":").append(freeBytes)
            .append(",\"totalBytes\":").append(totalBytes)
        if (writeOk != null) sb.append(",\"writeOk\":").append(writeOk)
        if (writeMs != null) sb.append(",\"writeMs\":").append(writeMs)
        return sb.append('}').toString()
    }

    // ─── Addresses: masked, never sent whole ─────────────────────────────

    enum class IpKind(val wire: String) { PRIVATE("private"), PUBLIC("public"), CGNAT("cgnat"), LINK_LOCAL("link-local"), NONE("none") }

    fun ipv4Kind(ip: String?): IpKind {
        val o = ipv4Octets(ip) ?: return IpKind.NONE
        return when {
            o[0] == 10 -> IpKind.PRIVATE
            o[0] == 172 && o[1] in 16..31 -> IpKind.PRIVATE
            o[0] == 192 && o[1] == 168 -> IpKind.PRIVATE
            o[0] == 100 && o[1] in 64..127 -> IpKind.CGNAT
            o[0] == 169 && o[1] == 254 -> IpKind.LINK_LOCAL
            o[0] == 0 -> IpKind.NONE
            else -> IpKind.PUBLIC
        }
    }

    /** `192.168.1.44` → `192.168.x.x`; a public address keeps only its first octet. */
    fun maskIpv4(ip: String?): String? {
        val o = ipv4Octets(ip) ?: return null
        return when (ipv4Kind(ip)) {
            IpKind.PUBLIC -> "${o[0]}.x.x.x"
            else -> "${o[0]}.${o[1]}.x.x"
        }
    }

    private fun ipv4Octets(ip: String?): IntArray? {
        val parts = ip?.trim()?.split('.') ?: return null
        if (parts.size != 4) return null
        val out = IntArray(4)
        for (i in 0 until 4) {
            val n = parts[i].toIntOrNull() ?: return null
            if (n !in 0..255) return null
            out[i] = n
        }
        return out
    }

    fun webViewMajor(versionName: String?): Int? {
        val head = versionName?.trim()?.substringBefore('.') ?: return null
        if (head.isEmpty() || head.length > 4 || !head.all { it in '0'..'9' }) return null
        return head.toIntOrNull()
    }

    /** A short, safe code for an exception: its simple class name, never its message (which can carry a URL). */
    fun errorCode(t: Throwable?): String {
        if (t == null) return "unknown"
        val n = t.javaClass.simpleName.ifEmpty { "error" }
        return n.filter { it.isLetterOrDigit() }.take(48).ifEmpty { "error" }
    }

    /**
     * Run [block] on [pool] and wait at most [timeoutMs]; null on timeout or
     * failure (the error code goes to [onError]). The worker is interrupted;
     * a blocking DNS call that ignores interrupts is abandoned, never awaited.
     */
    fun <T> bounded(pool: ExecutorService, timeoutMs: Long, onError: (String) -> Unit = {}, block: () -> T): T? {
        val f = try { pool.submit(Callable { block() }) } catch (t: Throwable) { onError(errorCode(t)); return null }
        return try {
            f.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (t: java.util.concurrent.TimeoutException) {
            f.cancel(true); onError("timeout"); null
        } catch (t: java.util.concurrent.ExecutionException) {
            onError(errorCode(t.cause)); null
        } catch (t: Throwable) {
            f.cancel(true); onError(errorCode(t)); null
        }
    }

    /** logcat `-t` wants `MM-dd HH:mm:ss.mmm` in the device's local time. */
    fun logcatSince(nowMs: Long, minutes: Int, tz: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
        val fmt = java.text.SimpleDateFormat("MM-dd HH:mm:ss.SSS", java.util.Locale.US)
        fmt.timeZone = tz
        return fmt.format(java.util.Date(nowMs - minutes.coerceIn(MINUTES_MIN, MINUTES_MAX) * 60_000L))
    }
}
