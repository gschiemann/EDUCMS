package com.educms.player.boot

import java.net.HttpURLConnection
import java.net.URL

/**
 * "Can this box reach that origin, and if not, WHY?" (2026-09-02, P0-2.)
 *
 * ============================================================
 * WHY NATIVE, AND WHY NOT `fetch`
 * ============================================================
 *
 * The web player already retries registration forever and already prints
 * a reason — but a browser `fetch` rejection is one opaque `TypeError`: a
 * DNS failure, an expired certificate and a refused connection are
 * indistinguishable from JavaScript. `HttpURLConnection` throws the real
 * exception type, so this is the only place in the product that can tell
 * an installer "your DNS cannot resolve the API host" instead of "network
 * error". And it keeps working when the page's JS is dead, which is the
 * whole situation this feature exists for.
 *
 * ⚠️ THIS PROBE NEVER CHANGES ANYTHING. It issues one HEAD and one GET,
 * follows no redirects it did not ask for, writes nothing, and its result
 * is only ever rendered or logged. A diagnostic that can mutate state is
 * a second failure mode on a screen that already has one.
 */
object Reachability {

    /** Bounded hard: an installer is standing there, and a stall is a lie. */
    const val CONNECT_TIMEOUT_MS = 6_000
    const val READ_TIMEOUT_MS = 6_000

    /**
     * A clock this far from the server's `Date` header is reported as
     * implausible. 5 minutes: comfortably past any legitimate skew,
     * comfortably inside the window where TLS starts rejecting
     * certificates as not-yet-valid — which is the actual failure this
     * catches on a signage box whose RTC lost its battery.
     */
    const val CLOCK_SKEW_TOLERANCE_MS = 5L * 60L * 1000L

    /** One probe's verdict. `cls` is the vocabulary the screen renders. */
    data class Result(
        /** dns | tls | http | timeout | network | ok | unknown */
        val cls: String,
        /** HTTP status when we got one, else null. */
        val status: Int?,
        /** Round-trip milliseconds, measured across connect + status read. */
        val ms: Long,
        /** The exception's simple name (or the status line) — evidence, not prose. */
        val detail: String?,
        /** Server `Date` header in wall-clock ms, or 0 when absent. */
        val serverDateMs: Long = 0L,
    ) {
        val ok: Boolean get() = cls == "ok"
    }

    /**
     * Exception → class. PURE and unit-tested; the whole point is that
     * this table is auditable without a network.
     *
     * ORDER IS LOAD-BEARING. `SSLHandshakeException` is an `IOException`
     * and `SocketTimeoutException` is an `InterruptedIOException`, so the
     * specific types must be tested before their supertypes or every TLS
     * failure would be reported as a generic network fault — exactly the
     * uselessly-vague answer this function exists to replace.
     *
     * Causes are walked (bounded to 5 hops): Android wraps the interesting
     * exception inside a generic one often enough that testing only the
     * top-level type mis-reports a real certificate failure as `network`.
     */
    fun classify(t: Throwable?): String {
        var cur: Throwable? = t
        var hops = 0
        while (cur != null && hops < 5) {
            val name = cur.javaClass.name
            when {
                name.endsWith("UnknownHostException") -> return "dns"
                // Certificate + handshake failures, by name rather than by
                // `is` checks: several live only in the javax.net.ssl /
                // java.security.cert trees that a unit-test JVM may or may
                // not surface identically to Android's.
                name.endsWith("SSLHandshakeException") ||
                    name.endsWith("SSLPeerUnverifiedException") ||
                    name.endsWith("SSLKeyException") ||
                    name.endsWith("SSLProtocolException") ||
                    name.endsWith("CertPathValidatorException") ||
                    name.endsWith("CertificateExpiredException") ||
                    name.endsWith("CertificateNotYetValidException") ||
                    name.endsWith("CertificateException") ||
                    name.endsWith("SSLException") -> return "tls"
                name.endsWith("SocketTimeoutException") ||
                    name.endsWith("ConnectTimeoutException") -> return "timeout"
                name.endsWith("ConnectException") ||
                    name.endsWith("NoRouteToHostException") ||
                    name.endsWith("PortUnreachableException") ||
                    name.endsWith("UnknownServiceException") ||
                    name.endsWith("SocketException") -> return "network"
                // Generic interrupted I/O is a timeout in every path we can
                // reach here (we set both timeouts and never interrupt the
                // thread ourselves).
                name.endsWith("InterruptedIOException") -> return "timeout"
            }
            cur = cur.cause
            hops += 1
        }
        // An IOException we could not name is still a transport fault, and
        // saying "network" is honest; anything else is genuinely unknown.
        return if (t is java.io.IOException) "network" else "unknown"
    }

    /**
     * Probe one origin. Never throws — a diagnostic that can crash the
     * screen it is diagnosing is worthless.
     *
     * @param method HEAD for the page origin (we want reachability, not a
     *   4K bundle down a metered uplink), GET for the health endpoint
     *   (whose body is the point).
     */
    fun probe(url: String, method: String): Result {
        val startedNs = System.nanoTime()
        fun elapsedMs(): Long = (System.nanoTime() - startedNs) / 1_000_000L
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                instanceFollowRedirects = true
                useCaches = false
            }
            val code = conn.responseCode
            val serverDateMs = conn.getHeaderFieldDate("Date", 0L)
            val ms = elapsedMs()
            if (code in 200..399) {
                Result("ok", code, ms, "HTTP $code", serverDateMs)
            } else {
                Result("http", code, ms, "HTTP $code", serverDateMs)
            }
        } catch (t: Throwable) {
            Result(classify(t), null, elapsedMs(), t.javaClass.simpleName)
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) { /* diagnostics only */ }
        }
    }

    /**
     * Is the device clock plausible, judged against a server `Date`?
     *
     * Returns null when we have no server date to judge against — SAYING
     * NOTHING beats guessing (player rule 10: copy states what the
     * evidence proves). Returns the signed skew in ms otherwise.
     */
    fun clockSkewMs(deviceWallMs: Long, serverDateMs: Long): Long? =
        if (serverDateMs <= 0L) null else deviceWallMs - serverDateMs

    /** True when [clockSkewMs] exceeds the tolerance in either direction. */
    fun clockImplausible(skewMs: Long?): Boolean =
        skewMs != null && kotlin.math.abs(skewMs) > CLOCK_SKEW_TOLERANCE_MS
}
