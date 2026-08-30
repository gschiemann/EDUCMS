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
 *   2. Probe `${apiRootProvider()}/api/v1/health` with a 6 s timeout.
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
 *
 * ── C-P1-4 (2026-08-30 deep audit) — ONE THREAD OWNS THE STATE ─────────
 *
 * `loop` / `attempt` / `lastError` / `overlayShowing` used to be written
 * from three threads with no synchronisation: the WebViewClient callbacks
 * (main), the `ConnectivityManager.NetworkCallback` (a binder thread) and
 * the probe coroutine itself (an IO worker). A Wi-Fi flap landing during
 * a page load could interleave `cancelLoop()` / `startLoop()` and orphan
 * a loop that later fired a spurious reload over perfectly healthy
 * playback — a reload nobody asked for, on a screen that was fine.
 *
 * The fix is ownership, not locks: the MAIN LOOPER owns every one of
 * those fields. Every public entry point posts to [mainHandler], the loop
 * coroutine itself runs on [Dispatchers.Main] (its blocking work is
 * already inside `withContext(Dispatchers.IO)` blocks, so nothing
 * network-y lands on the UI thread), and the probes now RETURN their
 * error label instead of writing it. The single exception is
 * [networkUp], a `@Volatile` boolean that only the network callback
 * writes and only readers outside this class consume.
 */
class NetworkRecoveryController(
    private val context: Context,
    private val baseUrl: String,
    /**
     * Where the API actually lives. 2026-08-30 (W2-2) — [probeHealth] used
     * to build its URL from [baseUrl], which in production is
     * `https://venue-os.app/player`; that made the probe
     * `https://venue-os.app/player/api/v1/health`, a Next.js 404 the loop
     * could NEVER see succeed. A screen in recovery therefore stayed in
     * recovery until somebody power-cycled it — the exact failure this
     * whole controller exists to prevent. Supplied as a lambda, not a
     * string, because the value is only known after the web player calls
     * `setBootstrap`, which can happen long after this is constructed.
     * See [ApiRoot].
     */
    private val apiRootProvider: () -> String,
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

    /**
     * C-P1-4 — the loop runs on the MAIN looper so it shares one writer
     * thread with every public entry point. All of its blocking work is
     * already fenced behind `withContext(Dispatchers.IO)`, so the UI
     * thread only ever executes the bookkeeping between probes.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())

    // ── main-thread-only state (C-P1-4). Never touch these off-main. ──
    private var loop: Job? = null
    private var attempt: Int = 0
    private var lastError: String? = null
    private var overlayShowing: Boolean = false

    /**
     * C-P0-1 — does this box currently have a usable uplink?
     *
     * Written ONLY by the network callback below (a binder thread), read
     * by [isNetworkUp] from the main thread, hence `@Volatile`. It is
     * deliberately outside the main-thread state block above: it is a
     * latch, not part of the loop's state machine, and the loop never
     * branches on it.
     *
     * Capability chosen deliberately: `NET_CAPABILITY_INTERNET`, NOT
     * `NET_CAPABILITY_VALIDATED`. Validation is Android probing a Google
     * endpoint, and school / venue firewalls block that probe on networks
     * that carry our traffic perfectly well — keying off VALIDATED would
     * permanently disarm the content watchdog on exactly the fleet we
     * ship to. INTERNET-capability presence answers the question the
     * operator's rule actually asks ("did the damn internet drop?"): a
     * pulled cable or a lost Wi-Fi association has no such network at all.
     */
    @Volatile
    private var networkUp: Boolean = true

    private val connectivityManager: ConnectivityManager? by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    }
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    init {
        // Seed from the CURRENT state before subscribing — callbacks only
        // report transitions, so a box that boots with no uplink would
        // otherwise sit on the optimistic default until the cable is
        // plugged in and out again.
        networkUp = readNetworkUp()
        // Subscribe to connectivity transitions so a Wi-Fi reconnect
        // shortcuts the backoff loop. If the API isn't usable yet we
        // just record the network-up event and the loop catches up.
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            netCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    networkUp = true
                    // C-P1-4 — hop to the owner thread before reading
                    // `overlayShowing`; this runs on a binder thread.
                    mainHandler.post {
                        if (overlayShowing) {
                            PlayerLogger.i(TAG, "Network came up while in recovery — kicking probe")
                            triggerImmediateProbeOnMain()
                        }
                    }
                }

                override fun onLost(network: Network) {
                    // C-P0-1 — re-read rather than latching false: a box
                    // with two uplinks (ethernet + Wi-Fi) loses one and is
                    // still online, and reporting a false outage would
                    // disarm the content watchdog for no reason.
                    networkUp = readNetworkUp()
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
     * C-P0-1 — true when the platform reports an active network carrying
     * the INTERNET capability. Safe to call from any thread.
     *
     * This is the signal `MainActivity` feeds to `ContentWatchdogPolicy`
     * so an offline-but-playing screen is never reloaded. Registration is
     * shared with the recovery loop's own connectivity hook rather than
     * duplicated — one subscription, one answer.
     *
     * Fails OPTIMISTIC (returns true) if the platform call throws: an
     * unknown network state must not silently disable content
     * supervision, and every consumer treats `true` as "keep behaving
     * exactly as before this signal existed".
     */
    fun isNetworkUp(): Boolean = networkUp

    private fun readNetworkUp(): Boolean = try {
        val cm = connectivityManager
        val active = cm?.activeNetwork
        val caps = if (active != null) cm.getNetworkCapabilities(active) else null
        caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ?: false
    } catch (e: Exception) {
        PlayerLogger.w(TAG, "activeNetwork read failed — assuming online: ${e.message}")
        true
    }

    /**
     * Called by the WebViewClient / activity when something went wrong.
     * Idempotent — if recovery is already running, just updates the
     * error label so the overlay shows the latest reason.
     *
     * C-P1-4 — hops to the main looper unconditionally. Callers are
     * main-thread today, but `onRenderProcessGone` and the bridge are not
     * contractually so, and this is the entry point that mutates `loop`.
     */
    fun onError(label: String) = onMain {
        lastError = label
        if (loop?.isActive == true) {
            // Already recovering — just refresh the overlay copy.
            pushOverlayState()
            return@onMain
        }
        PlayerLogger.w(TAG, "Recovery loop starting — $label")
        attempt = 0
        startLoop()
    }

    /** Called by MainActivity once the WebView reports a successful page load. */
    fun onPageLoaded() = onMain {
        if (overlayShowing) {
            PlayerLogger.i(TAG, "WebView reported page load — clearing recovery overlay")
        }
        attempt = 0
        lastError = null
        cancelLoop()
        if (overlayShowing) {
            overlayShowing = false
            onHideOverlay()
        }
    }

    /**
     * Ask for a probe right now (e.g. the operator hit Sync). No-op unless
     * a recovery loop is already running. C-P1-4 — main-thread funnelled
     * like every other entry point.
     */
    fun triggerImmediateProbe() = onMain { triggerImmediateProbeOnMain() }

    /** Stop everything (called from Activity.onDestroy). */
    fun shutdown() {
        try { netCallback?.let { connectivityManager?.unregisterNetworkCallback(it) } } catch (_: Exception) {}
        onMain {
            cancelLoop()
            scope.cancel()
        }
    }

    /**
     * C-P1-4 — the single funnel. Runs [block] inline when we are already
     * on the main looper (so the common case keeps today's synchronous
     * ordering — `onError` still starts the loop before it returns) and
     * posts otherwise.
     */
    private inline fun onMain(crossinline block: () -> Unit) {
        if (Looper.myLooper() === Looper.getMainLooper()) block() else mainHandler.post { block() }
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
        // C-P1-4 — `scope` is Dispatchers.Main, so every line of this body
        // that touches attempt / lastError / the overlay runs on the one
        // owner thread. The probes below suspend into Dispatchers.IO
        // themselves, so no network work lands here.
        loop = scope.launch {
            while (isActive) {
                attempt += 1
                pushOverlayState()
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
                // C-P1-4 — the probe RETURNS its failure label instead of
                // writing `lastError` from the IO worker; the assignment
                // happens here, on the owner thread.
                val health = probeHealth()
                if (health.error != null) lastError = health.error
                if (health.ok) {
                    PlayerLogger.i(TAG, "Health probe succeeded on attempt $attempt — reloading player")
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
                    return@launch
                }
                val nextDelay = backoffMs(attempt)
                PlayerLogger.w(TAG, "Probe failed (attempt $attempt) — next try in ${nextDelay}ms")
                // Tick the countdown each second while waiting so the
                // overlay shows "next try in 12s … 11s …" instead of
                // freezing on a stale value.
                val ticks = (nextDelay / 1000L).toInt().coerceAtLeast(1)
                for (s in ticks downTo 1) {
                    pushOverlayState(secondsUntilNext = s)
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

    /** Main-thread body of [triggerImmediateProbe]. C-P1-4 — never call
     *  this off the main looper; it mutates `attempt` and `loop`. */
    private fun triggerImmediateProbeOnMain() {
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
        pushOverlayState()
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
     * C-P1-4 — the probe's verdict, carried back to the owner thread
     * instead of being written into `lastError` from an IO worker.
     * `error` is null when there is nothing new to say (a transport
     * failure we could not name, or success).
     */
    private data class HealthResult(val ok: Boolean, val error: String?)

    /**
     * Returns ok=true iff GET /api/v1/health responds 200 with
     * status:"ok". Anything else (DNS, timeout, 5xx, malformed body) →
     * ok=false plus an operator-facing label.
     */
    private suspend fun probeHealth(): HealthResult = withContext(Dispatchers.IO) {
        // The API ROOT, not the page URL — see [apiRootProvider]. Resolved
        // per probe so a screen that bootstraps mid-recovery starts hitting
        // the right host on its very next attempt.
        val apiRoot = try {
            apiRootProvider().trimEnd('/')
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "apiRootProvider threw", e)
            return@withContext HealthResult(false, null)
        }
        val url = try {
            URL("$apiRoot/api/v1/health")
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Bad health URL $apiRoot", e)
            return@withContext HealthResult(false, null)
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
                return@withContext HealthResult(false, "HTTP $code from $url")
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            // Cheap content check — full JSON parse isn't worth the
            // complexity for a health probe. The backend is contracted
            // to include "status":"ok" in /health responses.
            val ok = body.contains("\"status\":\"ok\"")
            return@withContext HealthResult(ok, if (ok) null else "health body did not include status:ok")
        } catch (e: Exception) {
            return@withContext HealthResult(false, e.javaClass.simpleName + ": " + (e.message ?: ""))
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
