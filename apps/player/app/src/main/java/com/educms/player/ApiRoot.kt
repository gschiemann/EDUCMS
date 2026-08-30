package com.educms.player

import android.content.Context
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist

/**
 * The one place that answers "what is this screen's API root?".
 * (2026-08-30 player reliability program, W2-2.)
 *
 * WHY THIS FILE EXISTS. The derivation already existed — privately, in
 * `PlayerApp.resolveApiRoot()`, where only the crash uploader could reach
 * it. [NetworkRecoveryController] had no access to it and instead built
 * its health probe from `BuildConfig.PLAYER_BASE_URL`, which in production
 * is `https://venue-os.app/player`. That produced
 * `https://venue-os.app/player/api/v1/health` — a Next.js 404, so the
 * probe could never pass and the recovery loop could never decide the
 * server was back. Lifting the derivation into a shared, pure helper is
 * what lets both callers agree.
 *
 * The API root is NOT the player base URL: the page lives at `…/player`
 * and the API at the origin root (or wherever the web player bootstrapped
 * us to via `setBootstrap`, which is host-allowlisted before it is
 * persisted — see HostAllowlist).
 */
object ApiRoot {

    /** SharedPreferences file every native surface shares. */
    private const val PREFS = "edu_player"

    /** Written by the `setBootstrap` JS bridge; absent until first page load. */
    private const val KEY_API_ROOT = "api_root"

    /**
     * Pure derivation, unit-testable without a Context.
     *
     * @param savedApiRoot  what `setBootstrap` persisted, or null on a
     *                      fresh install before the WebView has booted.
     * @param playerBaseUrl the compiled-in page URL (`BuildConfig.PLAYER_BASE_URL`).
     * @param isApiRootAllowed C-P1-5 — POINT-OF-USE re-validation of the
     *        saved value. Defaults to accept-everything so the derivation
     *        itself stays pure and its existing contract is unchanged;
     *        [resolve] (Context) passes `HostAllowlist::isApiHost`.
     *        Rejecting falls back to the compiled-in base URL, which is
     *        the fresh-install path and is always reachable — so a screen
     *        poisoned by an older build (or by a hostile iframe reaching
     *        `setBootstrap` before that check existed) SELF-HEALS the
     *        moment any caller resolves, rather than staying wedged
     *        forever on a host that serves no API.
     */
    fun resolve(
        savedApiRoot: String?,
        playerBaseUrl: String,
        isApiRootAllowed: (String) -> Boolean = { true },
    ): String {
        val fallback = playerBaseUrl.trimEnd('/').removeSuffix("/player")
        if (savedApiRoot.isNullOrBlank()) return fallback
        val cleaned = savedApiRoot.trimEnd('/').removeSuffix("/api/v1")
        if (!isApiRootAllowed(cleaned)) return fallback
        return cleaned
    }

    /**
     * Has [resolve] already complained about the persisted value? Process
     * scoped — this is read on the recovery path, which runs on a backoff
     * loop, and a rejected pref would otherwise log on every probe.
     */
    @Volatile
    private var loggedRejection: Boolean = false

    /** Context convenience — reads the saved value, then delegates above. */
    fun resolve(context: Context): String {
        val saved = try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_API_ROOT, null)
        } catch (_: Exception) {
            // Nothing on the recovery path may throw; a missing prefs read
            // just means we fall back to the compiled-in base URL.
            null
        }
        val resolved = resolve(saved, BuildConfig.PLAYER_BASE_URL, HostAllowlist::isApiHost)
        // C-P1-5 — say so, once, when we overrode a persisted value. Silent
        // self-healing is how the original poisoning went unnoticed.
        if (!saved.isNullOrBlank() && !loggedRejection &&
            !HostAllowlist.isApiHost(saved.trimEnd('/').removeSuffix("/api/v1"))
        ) {
            loggedRejection = true
            PlayerLogger.w(
                "ApiRoot",
                "Persisted api_root is NOT an allowed VenueOS API root " +
                    "(${HostAllowlist.describe(saved)}) — falling back to the compiled-in base URL. " +
                    "The next setBootstrap from a healthy page will repair the pref.",
            )
        }
        return resolved
    }
}
