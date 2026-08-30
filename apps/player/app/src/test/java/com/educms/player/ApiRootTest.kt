package com.educms.player

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 2026-08-30 player reliability program, W2-2.
 *
 * The bug: [NetworkRecoveryController] built its health probe from
 * `BuildConfig.PLAYER_BASE_URL` (`https://venue-os.app/player` in prod),
 * yielding `https://venue-os.app/player/api/v1/health` — a Next.js 404.
 * The probe could never return true, so the recovery loop could never
 * decide the server was back. The first case below is that exact fix.
 */
class ApiRootTest {

    @Test
    fun `production base URL drops the player suffix`() {
        assertEquals(
            "https://venue-os.app",
            ApiRoot.resolve(null, "https://venue-os.app/player"),
        )
    }

    @Test
    fun `a saved api root drops a trailing api v1`() {
        assertEquals(
            "https://api.example.com",
            ApiRoot.resolve("https://api.example.com/api/v1", "https://venue-os.app/player"),
        )
    }

    @Test
    fun `a saved api root tolerates a trailing slash`() {
        assertEquals(
            "https://api.example.com",
            ApiRoot.resolve("https://api.example.com/api/v1/", "https://venue-os.app/player"),
        )
        assertEquals(
            "https://api.example.com",
            ApiRoot.resolve("https://api.example.com/", "https://venue-os.app/player"),
        )
    }

    @Test
    fun `a saved api root wins over the compiled-in base URL`() {
        assertEquals(
            "https://staging-api.example.com",
            ApiRoot.resolve("https://staging-api.example.com", "https://venue-os.app/player"),
        )
    }

    @Test
    fun `a base URL without a player suffix is returned unchanged`() {
        assertEquals(
            "https://venue-os.app",
            ApiRoot.resolve(null, "https://venue-os.app"),
        )
        assertEquals(
            "http://10.0.2.2:3000",
            ApiRoot.resolve(null, "http://10.0.2.2:3000/"),
        )
    }

    @Test
    fun `blank saved values fall through to the base URL`() {
        assertEquals("https://venue-os.app", ApiRoot.resolve("", "https://venue-os.app/player"))
        assertEquals("https://venue-os.app", ApiRoot.resolve("   ", "https://venue-os.app/player"))
    }

    @Test
    fun `the probe URL the recovery loop builds is the real health endpoint`() {
        // Mirrors NetworkRecoveryController.probeHealth's concatenation.
        val probe = ApiRoot.resolve(null, "https://venue-os.app/player").trimEnd('/') + "/api/v1/health"
        assertEquals("https://venue-os.app/api/v1/health", probe)
    }
}
