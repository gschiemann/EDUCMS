package com.educms.player

import android.content.Context

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
     */
    fun resolve(savedApiRoot: String?, playerBaseUrl: String): String {
        if (!savedApiRoot.isNullOrBlank()) {
            return savedApiRoot.trimEnd('/').removeSuffix("/api/v1")
        }
        return playerBaseUrl.trimEnd('/').removeSuffix("/player")
    }

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
        return resolve(saved, BuildConfig.PLAYER_BASE_URL)
    }
}
