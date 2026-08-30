package com.educms.player

/**
 * ONE canonical native device-token store, and the one-way migration off
 * the legacy one. (2026-08-30 player reliability program, W2-1.)
 *
 * WHY THIS FILE EXISTS. The APK ended up with two native token stores:
 *
 *   • `edu_player` SharedPreferences, key `device_token` — written by the
 *     JS bridge (`setDeviceToken`, see MainActivity) on every page load,
 *     read by the out-of-process workers (OTA). This is the LIVE one.
 *   • The legacy `edu_cms_player` DataStore ([DeviceStore]) — its only
 *     writer was `savePairing()`, which had ZERO callers after
 *     PairingActivity was deleted. Nothing has written it in a long time,
 *     but `MainActivity.loadPlayer` still READ it on every native reload
 *     path and appended it to the player URL as `?token=`.
 *
 * That asymmetry is the production credential-downgrade loop: a token
 * left in DataStore by an ancient build survives every APK update, and
 * each native reload re-injects that stale credential into a web player
 * that had already rotated to a newer one. The screen goes dark behind an
 * expired token and the server logs the downgrade.
 *
 * The resolution is deliberately a PURE function over four injected
 * lambdas so the decision table is unit-testable with no Android
 * framework, no DataStore, and no coroutines. The suspend/IO bridging
 * lives at the call site (`MainActivity.resolveDeviceToken`).
 *
 * @param getPrefsToken    reads the canonical `edu_player`/`device_token`.
 * @param getLegacyToken   reads the legacy DataStore token.
 * @param writePrefsToken  persists a migrated token into the canonical store.
 * @param clearLegacyToken removes ONLY the legacy token key (never the whole
 *                         DataStore — `usbIngestKey` and friends are live).
 * @return the token to hand to `loadPlayer`, or null when this screen has
 *         no native token at all (the normal fresh-install case — the web
 *         player's own register/pair flow takes over).
 */
fun resolveNativeToken(
    getPrefsToken: () -> String?,
    getLegacyToken: () -> String?,
    writePrefsToken: (String) -> Unit,
    clearLegacyToken: () -> Unit,
): String? {
    val prefs = getPrefsToken()?.takeIf { it.isNotBlank() }
    if (prefs != null) {
        // Canonical store wins. The legacy value is inert once we stop
        // reading it, so we deliberately do NOT touch it here — a
        // migration that also fired on this path would be a second
        // write on the hot boot path for no behavioural gain.
        return prefs
    }

    val legacy = getLegacyToken()?.takeIf { it.isNotBlank() }
        ?: return null

    // One-way migration: copy forward, then delete the source so a later
    // unpair can never resurrect it.
    writePrefsToken(legacy)
    clearLegacyToken()
    return legacy
}
