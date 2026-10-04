package com.educms.player.ota

/**
 * Which `sha256` values an update may carry (2026-10-04, player 1.1.21).
 *
 * Until 1.1.20 an EMPTY digest meant "skip verification". The server already
 * refuses to advertise a build it has no digest for, so the device-side skip
 * protected nothing and trusted everything: an answer without a digest — a
 * tampered response, a stale proxy, a future server bug — installed unverified
 * bytes. Now only a well-formed SHA-256 (64 hex characters) is acceptable, and
 * the worker refuses the update before downloading anything.
 */
object OtaDigestPolicy {
    private val SHA256_HEX = Regex("^[0-9a-fA-F]{64}$")

    fun acceptable(sha256: String?): Boolean = sha256 != null && SHA256_HEX.matches(sha256)
}
