package com.educms.player

import com.educms.player.security.HostAllowlist
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    // ─── C-P1-5: api_root trusts only real API hosts ──────────────────
    //
    // `setBootstrap` used to validate against the BROAD first-party
    // allowlist, which necessarily contains the OTA release host
    // github.com — a host that serves no API. The bridge is reachable
    // from every frame the player WebView loads, so one hostile iframe
    // could persist `api_root = https://github.com` and, in a single
    // write, kill the recovery health probe (screen wedged in
    // "Reconnecting…" until a power cycle), the native heartbeat
    // (dashboard reads OFFLINE), OTA and diagnostics — surviving reboot
    // and OTA, because it is a pref.
    //
    // Two independent gates now: `HostAllowlist.isApiHost` at SET, and
    // the same predicate re-applied at USE inside `ApiRoot.resolve`.
    // `isApiHost` is the exact predicate `setBootstrap` calls (via
    // `requireApiHost`), so testing it here IS testing the set-side gate;
    // `setBootstrap` itself lives in MainActivity and needs a device.

    /** The `BuildConfig.PLAYER_BASE_URL` these tests are compiled against. */
    private val baseUrl = BuildConfig.PLAYER_BASE_URL

    @Test
    fun `isApiHost accepts the compiled-in player host and the pinned API`() {
        assertTrue("the player's own origin must be a valid api_root", HostAllowlist.isApiHost(baseUrl))
        assertTrue(HostAllowlist.isApiHost("https://api-production-39a1.up.railway.app"))
        // Our own apex keeps its dot-boundary match — we run staging
        // subdomains there and nobody else can create one.
        assertTrue(HostAllowlist.isApiHost("https://staging-api.venue-os.app"))
    }

    @Test
    fun `isApiHost rejects the OTA release host`() {
        // THE regression this whole item exists to prevent. github.com is
        // on the broad allowlist (it serves the OTA APK) and must never
        // be accepted as an API root.
        assertFalse(HostAllowlist.isApiHost("https://github.com"))
        assertFalse(HostAllowlist.isApiHost("https://github.com/gschiemann/EDUCMS"))
        assertFalse(HostAllowlist.isApiHost("https://raw.githubusercontent.com"))
        // Sanity: it IS still allowed for its actual purpose, so this is a
        // narrowing of api_root specifically and not a change to OTA.
        assertTrue(HostAllowlist.isAllowed("https://github.com"))
    }

    @Test
    fun `isApiHost keeps every rule the broad allowlist enforces`() {
        assertFalse("plain http must not be accepted", HostAllowlist.isApiHost("http://venue-os.app"))
        assertFalse("userinfo is a confusion vector", HostAllowlist.isApiHost("https://evil.com@venue-os.app"))
        assertFalse("suffix must be dot-bounded", HostAllowlist.isApiHost("https://venue-os.app.evil.com"))
        assertFalse(HostAllowlist.isApiHost("https://evilvenue-os.app"))
        assertFalse(HostAllowlist.isApiHost("https://up.railway.app"))
        assertFalse(HostAllowlist.isApiHost(null))
        assertFalse(HostAllowlist.isApiHost(""))
        assertFalse(HostAllowlist.isApiHost("not a url at all"))
    }

    @Test
    fun `a poisoned saved value falls back to the compiled-in base URL at USE`() {
        // The self-heal: even a screen whose pref was written by an older
        // build resolves to something reachable, so recovery/heartbeat/OTA
        // all come back to life without an operator visit.
        assertEquals(
            "https://venue-os.app",
            ApiRoot.resolve("https://github.com", "https://venue-os.app/player", HostAllowlist::isApiHost),
        )
        assertEquals(
            "https://venue-os.app",
            ApiRoot.resolve("https://evil.example", "https://venue-os.app/player", HostAllowlist::isApiHost),
        )
    }

    @Test
    fun `a legitimate saved value still wins at USE`() {
        // The narrowing must not break the normal path: the web player
        // bootstraps us to the production API host on every page load.
        assertEquals(
            "https://api-production-39a1.up.railway.app",
            ApiRoot.resolve(
                "https://api-production-39a1.up.railway.app",
                "https://venue-os.app/player",
                HostAllowlist::isApiHost,
            ),
        )
        // …including with the /api/v1 suffix the bridge strips, which is
        // stripped BEFORE validation so the predicate sees a bare origin.
        assertEquals(
            "https://api-production-39a1.up.railway.app",
            ApiRoot.resolve(
                "https://api-production-39a1.up.railway.app/api/v1/",
                "https://venue-os.app/player",
                HostAllowlist::isApiHost,
            ),
        )
    }
}
