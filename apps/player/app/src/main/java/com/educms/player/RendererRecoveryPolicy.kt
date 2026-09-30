package com.educms.player

/** Renderer failures are independent of network failures and page-load success. */
class RendererRecoveryPolicy(previousFailures: Int = 0, previousFailureAt: Long = 0) {
    var failures = previousFailures.coerceIn(0, 6)
        private set
    var lastFailureAt = previousFailureAt
        private set

    fun onFailure(now: Long): Long {
        // A process restart must not reset the crash-loop backoff. A quiet
        // half hour does; onPageFinished alone is not proof of recovery.
        if (now < lastFailureAt || now - lastFailureAt >= QUIET_RESET_MS) failures = 0
        failures = (failures + 1).coerceAtMost(6)
        lastFailureAt = now
        return (2_000L shl (failures - 1)).coerceAtMost(60_000L)
    }

    fun recentlyFailed(now: Long): Boolean =
        lastFailureAt > 0 && now >= lastFailureAt && now - lastFailureAt < SAFE_MODE_MS

    companion object {
        const val QUIET_RESET_MS = 30L * 60 * 1000
        const val SAFE_MODE_MS = 6L * 60 * 60 * 1000
    }
}
