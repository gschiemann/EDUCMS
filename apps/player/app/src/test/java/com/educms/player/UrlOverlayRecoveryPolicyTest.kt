package com.educms.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlOverlayRecoveryPolicyTest {
    @Test fun `retry backoff is bounded`() {
        assertEquals(2_000L, UrlOverlayRecoveryPolicy.retryDelayMs(1))
        assertEquals(4_000L, UrlOverlayRecoveryPolicy.retryDelayMs(2))
        assertEquals(60_000L, UrlOverlayRecoveryPolicy.retryDelayMs(99))
    }

    @Test fun `healthy sites and other overlay owners are never retried`() {
        assertFalse(UrlOverlayRecoveryPolicy.shouldRetry(true, false, "https://example.com", false))
        assertFalse(UrlOverlayRecoveryPolicy.shouldRetry(true, true, "https://example.com", true))
        assertFalse(UrlOverlayRecoveryPolicy.shouldRetry(false, false, "https://example.com", true))
        assertTrue(UrlOverlayRecoveryPolicy.shouldRetry(true, false, "https://example.com", true))
    }
}
