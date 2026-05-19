package com.educms.player

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Self-healing network recovery for the kiosk player.
 *
 * Operator reported: "the android player throws a standard android error
 * when it cant connect to the server and then never goes off that screen,
 * i need to reboot the entire media player to get it back online…we need
 * to have a player that self heals."
 *
 * Trigger sources (any of):
 *   • WebView main-frame onReceivedError      (DNS / TCP / TLS failure)
 *   • WebView main-frame onReceivedHttpError  (5xx from origin)
 *   • Renderer-process gone                    (WebView crashed)
 *
 * Recovery loop:
 *   1. Show the branded "Reconnecting…" overlay on the activity.
 *   2. Probe `${baseUrl}/api/v1/health` with a 6 s timeout.
 *      • 200 + body contains `"status":"ok"` → server is back.
 *      • Anything else                       → server still down.
 *   3. If down: bump attempt counter, schedule next probe with
 *      exponential backoff capped at MAX_BACKOFF_MS, update overlay
 *      countdown.
 *   4. If up: hide overlay, ask MainActivity to reload the player URL.
 *
 * Network-availability hook:
 *   We also subscribe to ConnectivityManager so that the moment the
 *   physical network reappears (Wi-Fi reconnect, ethernet plug back in)
 *   we trigger an immediate probe, instead of waiting for the next
 *   backoff tick. Saves the operator from staring at "next attempt in
 *   60s" while the network is actually fine.
 *
 * No third-party HTTP client; uses HttpURLConnection same as
 * HeartbeatService + OtaUpdateWorker. The whole class is one file with
 * no Compose dependencies so it builds on every Android version we ship.
 */
class NetworkRecoveryController(
    private val context: Context,
    private val baseUrl: String,
    /** Called on the main thread whenever the overlay should appear / update. */
    private val onShowOverlay: (state: OverlayState) -> Unit,
    /** Called on the main thread when recovery succeeds. */
    private val onHideOverlay: () -> Unit,
    /** Called on the main thread when we should reload the player URL. */
    private val onReloadRequested: () -> Unit,
) {

    /** UI state pushed to MainActivity for the overlay. */
    data class OverlayState(
        /** "Reconnecting…" / "Server is back, reloading…" / "Network offline — reconnecting…" */
        val title: String,
        /** "Attempt #5 · next try in 12s" — operator-facing. */
        val sub: String,
        /** Most recent error label for the diagnostics row. May be null. */
        val errorLabel: String?,
        /** Attempt count starting at 1. */
        val attempt: Int,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var loop: Job? = null
    private var attempt: Int = 0
    private var lastError: String? = null
    private var overlayShowing: Boolean = false

    private val connectivityManager: ConnectivityManager? by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    }
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    init {
        // Subscribe to connectivity transitions so a Wi-Fi reconnect
        // shortcuts the backoff loop. If the API isn't usable yet we
        // just record the network-up event and the loop catches up.
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            netCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (overlayShowing) {
                        PlayerLogger.i(TAG, "Network came up while in recovery — kicking probe")
                        triggerImmediateProbe()
                    }
                }
            }
            connectivityManager?.registerNetworkCallback(req, netCallback!!)
        } catch (e: Exception) {
            // ConnectivityManager API can throw on some OEM builds. Safe
            // to skip; the backoff loop still works without it.
            PlayerLogger.w(TAG, "Network callback registration failed", e)
        }
    }

    /**
     * Called by the WebViewClient / activity when something went wrong.
     * Idempotent — if recovery is already running, just updates the
     * error label so the overlay shows the latest reason.
     */
    fun onError(label: String) {
        lastError = label
        if (loop?.isActive == true) {
            // Already recovering — just refresh the overlay copy.
            mainHandler.post { pushOverlayState() }
            return
        }
        PlayerLogger.w(TAG, "Recovery loop starting — $label")
        attempt = 0
        startLoop()
    }

    /** Called by MainActivity once the WebView reports a successful page load. */
    fun onPageLoaded() {
        if (overlayShowing) {
            PlayerLogger.i(TAG, "WebView reported page load — clearing recovery overlay")
        }
        attempt = 0
        lastError = null
        cancelLoop()
        if (overlayShowing) {
            overlayShowing = false
            mainHandler.post { onHideOverlay() }
        }
    }

    /** Stop everything (called from Activity.onDestroy). */
    fun shutdown() {
        cancelLoop()
        try { netCallback?.let { connectivityManager?.unregisterNetworkCallback(it) } } catch (_: Exception) {}
        scope.cancel()
    }

    /**
     * 2026-05-19 (v1.0.71) — true iff the recovery loop is currently
     * running (player webview in an error state, probing /health on
     * backoff). MainActivity.hideUrlOverlay() uses this to decide
     * whether to re-show the recovery overlay after a URL asset is
     * dismissed — if the player is still broken underneath, the
     * operator should see "Reconnecting…" instead of a black screen.
     */
    fun isActive(): Boolean = loop?.isActive == true

    // ── Internals ──────────────────────────────────────────────

    private fun startLoop() {
        cancelLoop()
        showOverlay()
        loop = scope.launch {
            while (isActive) {
                attempt += 1
                pushOverlayStateMain()
                // 2026-05-07 (v1.0.52) — additive captive-portal check.
                // Runs alongside the health probe on EVERY attempt so
                // the operator sees "School WiFi requires login" instead
                // of "HTTP 429 from server" if the school IT department
                // has a captive portal in front of the kiosk.
                val portalLabel = probeCaptivePortal()
                if (portalLabel != null) {
                    PlayerLogger.w(TAG, "Captive portal detected on attempt $attempt: $portalLabel")
                    // Enrich lastError so pushOverlayState picks it up.
                    // Health probe is still allowed to overwrite this
                    // if it gets a more specific error code below.
                    lastError = portalLabel
                }
                val healthy = probeHealth()
                if (healthy) {
                    PlayerLogger.i(TAG, "Health probe succeeded on attempt $attempt — reloading player")
                    mainHandler.post {
                        // Overlay stays up briefly with "reloading…" to
                        // explain the WebView jump.
                        onShowOverlay(
                            OverlayState(
                                title = "Server is back",
                                sub = "Reloading the player…",
                                errorLabel = null,
                                attempt = attempt,
                            ),
                        )
                        onReloadRequested()
                    }
                    return@launch
                }
                val nextDelay = backoffMs(attempt)
                PlayerLogger.w(TAG, "Probe failed (attempt $attempt) — next try in ${nextDelay}ms")
                // Tick the countdown each second while waiting so the
                // overlay shows "next try in 12s … 11s …" instead of
                // freezing on a stale value.
                val ticks = (nextDelay / 1000L).toInt().coerceAtLeast(1)
                for (s in ticks downTo 1) {
                    pushOverlayStateMain(secondsUntilNext = s)
                    delay(1000L)
                    if (!isActive) return@launch
                }
            }
        }
    }

    private fun cancelLoop() {
        loop?.cancel()
        loop = null
    }

    private fun triggerImmediateProbe() {
        if (loop?.isActive != true) return
        // Cancel current wait and restart with attempt unchanged so the
        // overlay doesn't reset its counter. Cheapest way: cancel and
        // re-launch — startLoop() bumps attempt by 1, so we decrement
        // first to land on the same number after restart.
        attempt = (attempt - 1).coerceAtLeast(0)
        startLoop()
    }

    private fun showOverlay() {
        if (overlayShowing) return
        overlayShowing = true
        pushOverlayStateMain()
    }

    private fun pushOverlayStateMain(secondsUntilNext: Int? = null) {
        mainHandler.post { pushOverlayState(secondsUntilNext) }
    }

    private fun pushOverlayState(secondsUntilNext: Int? = null) {
        val title = "Reconnecting to server…"
        val sub = when {
            attempt == 0 -> "Checking connection"
            secondsUntilNext != null -> "Attempt $attempt · next try in ${secondsUntilNext}s"
            else -> "Attempt $attempt · checking now…"
        }
        onShowOverlay(OverlayState(title, sub, lastError, attempt))
    }

    /**
     * 2026-05-07 (v1.0.52) — captive portal detection.
     *
     * On every recovery attempt, alongside the health probe we also
     * check Google's connectivity-check endpoint
     * (`generate_204` returns 204 with empty body when there's clean
     * internet, otherwise something else — usually a captive portal
     * HTML page with status 200 and a Location-redirect, or a school
     * firewall returning a custom error page).
     *
     * If we see captive portal indicators, we update lastError so
     * the overlay says "School/guest WiFi requires login" instead of
     * the misleading "HTTP 429 / can't reach server" the operator
     * sees today on a TaurusOS box that has no captive-portal UI.
     *
     * Result is logged either way for support diagnostics. This is
     * additive — never blocks recovery, just enriches the error label.
     *
     * Cite: NovaStar Taurus boxes ship a stripped TaurusOS without a
     * captive-portal UI (TaurusOS lacks the AOSP CaptivePortalLogin
     * activity). This produces "white screen with retry button" that
     * looks identical to a real network failure but isn't. See
     * docs/research/NOVA_STAR_DEEP_DIVE.md.
     */
    private suspend fun probeCaptivePortal(): String? = withContext(Dispatchers.IO) {
        var conn: HttpURLConnection? = null
        try {
            // Use HTTP not HTTPS — captive portals typically intercept
            // unencrypted traffic. The 204-no-body contract is what
            // Android's own connectivity detector uses.
            val url = URL("http://connectivitycheck.gstatic.com/generate_204")
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 4_000
                readTimeout = 4_000
                instanceFollowRedirects = false
                requestMethod = "GET"
                setRequestProperty("User-Agent", "EduCmsPlayer-CaptivePortalCheck")
            }
            val code = conn.responseCode
            return@withContext when {
                // Clean internet — generate_204 contract honored.
                code == 204 -> null
                // Captive portal redirect — page wants us to login.
                code in 300..399 -> {
                    val loc = conn.getHeaderField("Location") ?: "(no Location header)"
                    "Captive portal: $loc"
                }
                // Captive portal returning HTML at 200 — common pattern.
                code == 200 -> "Captive portal (intercepted 200 with body)"
                // Other status — could be a school firewall page.
                else -> "Network filter (HTTP $code from generate_204)"
            }
        } catch (e: Exception) {
            // No internet at all — DNS failed, TCP refused, timeout.
            // This is "real" disconnect, not captive portal. Return null
            // so the existing health-probe logic owns the messaging.
            return@withContext null
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    /**
     * Returns true iff GET /api/v1/health responds 200 with status:"ok".
     * Anything else (DNS, timeout, 5xx, malformed body) → false.
     */
    private suspend fun probeHealth(): Boolean = withContext(Dispatchers.IO) {
        val url = try {
            URL("${baseUrl.trimEnd('/')}/api/v1/health")
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Bad health URL ${baseUrl}", e)
            return@withContext false
        }
        var conn: HttpURLConnection? = null
        try {
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 6_000
                readTimeout = 6_000
                requestMethod = "GET"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "EduCmsPlayer-Recovery")
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                lastError = "HTTP $code from $url"
                return@withContext false
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            // Cheap content check — full JSON parse isn't worth the
            // complexity for a health probe. The backend is contracted
            // to include "status":"ok" in /health responses.
            val ok = body.contains("\"status\":\"ok\"")
            if (!ok) lastError = "health body did not include status:ok"
            return@withContext ok
        } catch (e: Exception) {
            lastError = e.javaClass.simpleName + ": " + (e.message ?: "")
            return@withContext false
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    /**
     * Exponential backoff with floor + cap. Operator-friendly cadence:
     *   1 → 3s,  2 → 6s,  3 → 12s,  4 → 24s,  5+ → 60s
     * 60s ceiling balances "be quick on a flapping connection" against
     * "don't hammer the API while Railway redeploys."
     */
    private fun backoffMs(attempt: Int): Long {
        if (attempt <= 1) return 3_000
        val pow = 1L shl (attempt - 1).coerceAtMost(6)  // 2^(n-1), cap exponent at 6
        val ms = 3_000L * pow
        return ms.coerceAtMost(MAX_BACKOFF_MS)
    }

    companion object {
        private const val TAG = "PlayerRecovery"
        private const val MAX_BACKOFF_MS = 60_000L
    }
}
