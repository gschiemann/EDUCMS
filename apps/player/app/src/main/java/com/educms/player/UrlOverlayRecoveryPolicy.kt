package com.educms.player

/** Small bounded retry schedule for a failed native URL-asset overlay. */
internal object UrlOverlayRecoveryPolicy {
    private val delaysMs = longArrayOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L)

    /** How many distinct backoff steps there are — the bound on reloads of a blank page ([UrlOverlayDrawProofPolicy]). */
    val retrySteps: Int get() = delaysMs.size

    fun retryDelayMs(failureCount: Int): Long =
        delaysMs[(failureCount - 1).coerceAtLeast(0).coerceAtMost(delaysMs.lastIndex)]

    fun shouldRetry(visible: Boolean, websiteTabsOwnIt: Boolean, targetUrl: String?, failed: Boolean): Boolean =
        visible && !websiteTabsOwnIt && !targetUrl.isNullOrBlank() && failed
}
