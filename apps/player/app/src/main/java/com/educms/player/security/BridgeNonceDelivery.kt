package com.educms.player.security

import org.json.JSONObject
import java.net.URI
import java.util.Locale

/** Delivery acknowledgement belongs to one document checkpoint, never the nonce's lifetime. */
class BridgeNonceDelivery(private val maxAttempts: Int = 25) {
    data class Attempt(val checkpoint: Long, val sequence: Long) {
        val acknowledgement: String get() = "bridge-delivered:$checkpoint:$sequence"
    }

    private var checkpoint = 0L
    private var sequence = 0L
    private var remaining = 0
    private var delivered = false

    // Every start/commit/finish gets a new checkpoint: a start acknowledgement
    // may describe the outgoing same-origin page, so commit MUST deliver again.
    fun begin(): Long {
        checkpoint += 1
        remaining = maxAttempts
        delivered = false
        return checkpoint
    }

    fun invalidate() {
        checkpoint += 1
        remaining = 0
        delivered = false
    }

    fun next(current: Long): Attempt? {
        if (current != checkpoint || delivered || remaining <= 0) return null
        remaining -= 1
        sequence += 1
        return Attempt(checkpoint, sequence)
    }

    fun acknowledge(attempt: Attempt, result: String?): Boolean {
        if (attempt.checkpoint != checkpoint || attempt.sequence != sequence ||
            result != JSONObject.quote(attempt.acknowledgement)) return false
        delivered = true
        return true
    }

    fun pending(current: Long): Boolean = current == checkpoint && !delivered && remaining > 0
    fun isCurrent(current: Long): Boolean = current == checkpoint
    fun isDelivered(current: Long): Boolean = isCurrent(current) && delivered

    companion object {
        fun canonicalOrigin(origin: String): String? = runCatching {
            val uri = URI(origin)
            val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
            val host = uri.host?.lowercase(Locale.ROOT) ?: return null
            if (uri.isOpaque || uri.rawUserInfo != null || (scheme != "https" && scheme != "http")) return null
            val port = uri.port
            val suffix = if (port < 0 || (scheme == "https" && port == 443) || (scheme == "http" && port == 80)) "" else ":$port"
            "$scheme://$host$suffix"
        }.getOrNull()

        /** Exact web origin, including effective port. Never a suffix/host-only match. */
        fun trustedUrl(url: String?, origin: String?): Boolean = runCatching {
            if (url == null || origin == null) return false
            val actual = URI(url)
            val expected = URI(origin)
            fun port(uri: URI): Int = if (uri.port >= 0) uri.port else if (uri.scheme.equals("https", true)) 443 else 80
            !actual.isOpaque && actual.rawUserInfo == null && actual.host != null && expected.host != null &&
                (expected.scheme.equals("https", true) || expected.scheme.equals("http", true)) &&
                actual.scheme.equals(expected.scheme, true) && actual.host.equals(expected.host, true) &&
                port(actual) == port(expected)
        }.getOrDefault(false)

        /** Recheck at execution: navigation can change after the native URL check. */
        fun script(nonce: String, origin: String, acknowledgement: String): String? {
            if (!Regex("^[0-9a-f]{32,128}$").matches(nonce) || !trustedUrl(origin, origin)) return null
            val expectedOrigin = canonicalOrigin(origin) ?: return null
            val secret = JSONObject.quote(nonce)
            return "(function(){try{" +
                "if(window.top!==window||window.location.origin!==${JSONObject.quote(expectedOrigin)})return null;" +
                "window.${BridgeNonce.JS_GLOBAL}=$secret;" +
                "return window.${BridgeNonce.JS_GLOBAL}===$secret?${JSONObject.quote(acknowledgement)}:null;" +
                "}catch(e){return null;}})();"
        }
    }
}
