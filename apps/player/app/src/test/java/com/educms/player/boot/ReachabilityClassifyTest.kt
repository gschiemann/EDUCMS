package com.educms.player.boot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * The exception → class table (2026-09-02, P0-2).
 *
 * The whole reason the probe is native is that a browser `fetch` collapses
 * DNS, TLS and refused-connection into one opaque TypeError. If this table
 * is wrong, the diagnostic screen tells an installer a confident wrong
 * cause — worse than the vague message it replaced. So it is pinned here,
 * including the ORDERING traps: SSLHandshakeException IS an IOException and
 * SocketTimeoutException IS an InterruptedIOException, so a naive
 * supertype-first table reports every certificate failure as "network".
 */
class ReachabilityClassifyTest {

    @Test
    fun `an unresolvable host is dns`() {
        assertEquals("dns", Reachability.classify(UnknownHostException("api.example")))
    }

    @Test
    fun `handshake and certificate failures are tls, not network`() {
        assertEquals("tls", Reachability.classify(SSLHandshakeException("bad cert")))
        assertEquals("tls", Reachability.classify(SSLPeerUnverifiedException("no peer")))
        assertEquals("tls", Reachability.classify(CertPathValidatorException("no path")))
    }

    @Test
    fun `a timeout is timeout, not network`() {
        assertEquals("timeout", Reachability.classify(SocketTimeoutException("read timed out")))
        assertEquals("timeout", Reachability.classify(InterruptedIOException("interrupted")))
    }

    @Test
    fun `refusals and dead routes are network`() {
        assertEquals("network", Reachability.classify(ConnectException("refused")))
        assertEquals("network", Reachability.classify(NoRouteToHostException("no route")))
        assertEquals("network", Reachability.classify(SocketException("reset")))
    }

    @Test
    fun `an unnamed IOException degrades to network, not unknown`() {
        assertEquals("network", Reachability.classify(IOException("something")))
    }

    @Test
    fun `a genuinely non-IO throwable is unknown`() {
        assertEquals("unknown", Reachability.classify(IllegalStateException("boom")))
        assertEquals("unknown", Reachability.classify(null))
    }

    @Test
    fun `a WRAPPED cause is still classified — Android wraps these often`() {
        val wrapped = IOException("connection failed", SSLHandshakeException("expired"))
        assertEquals("tls", Reachability.classify(wrapped))
        val deep = RuntimeException("outer", IOException("mid", UnknownHostException("host")))
        assertEquals("dns", Reachability.classify(deep))
    }

    @Test
    fun `cause walking is bounded so a self-referential chain cannot hang`() {
        val a = IllegalStateException("a")
        val b = IllegalStateException("b", a)
        // Six-deep chain of non-matching causes: must terminate and answer.
        val chain = IllegalStateException("f",
            IllegalStateException("e",
                IllegalStateException("d",
                    IllegalStateException("c", b))))
        assertEquals("unknown", Reachability.classify(chain))
    }

    // ─── clock plausibility ──────────────────────────────────────────

    @Test
    fun `no server date means we say nothing rather than guess`() {
        assertNull(Reachability.clockSkewMs(1_700_000_000_000L, 0L))
        assertFalse(Reachability.clockImplausible(null))
    }

    @Test
    fun `a small skew is plausible and a large one is not, in both directions`() {
        val server = 1_700_000_000_000L
        assertFalse(Reachability.clockImplausible(Reachability.clockSkewMs(server + 60_000L, server)))
        assertTrue(Reachability.clockImplausible(Reachability.clockSkewMs(server + 600_000L, server)))
        assertTrue(Reachability.clockImplausible(Reachability.clockSkewMs(server - 600_000L, server)))
    }

    @Test
    fun `the tolerance is the documented five minutes`() {
        assertEquals(5L * 60L * 1000L, Reachability.CLOCK_SKEW_TOLERANCE_MS)
    }
}
