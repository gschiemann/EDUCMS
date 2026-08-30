package com.educms.player

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "edu_cms_player")

/**
 * Persists pairing state across reboots and reinstalls (within scoped storage).
 *
 * ⚠️ LEGACY, AND NOT THE TOKEN STORE (2026-08-30, W2-1). The canonical
 * device token lives in the `edu_player` SharedPreferences file under
 * `device_token` — written by the `setDeviceToken` JS bridge, read by the
 * out-of-process OTA worker, and resolved for the WebView URL by
 * [resolveNativeToken]. This DataStore's token key is now READ ONCE, to
 * migrate it forward, and then removed; `savePairing()` was deleted along
 * with the same wave because it had no callers left after PairingActivity
 * was removed and its existence invited re-poisoning. Do not add a token
 * writer here — a second writable token store is exactly the bug.
 *
 * The other keys (notably [usbIngestKey] and `tenant_id`) are still read
 * by USB ingest, which is why [clearToken] removes ONLY the token key and
 * [clear] stays reserved for a real unpair.
 */
class DeviceStore(private val context: Context) {

    val deviceToken: Flow<String?> =
        context.dataStore.data.map { it[KEY_TOKEN] }

    val tenantSlug: Flow<String?> =
        context.dataStore.data.map { it[KEY_TENANT_SLUG] }

    val tenantId: Flow<String?> =
        context.dataStore.data.map { it[KEY_TENANT_ID] }

    val screenId: Flow<String?> =
        context.dataStore.data.map { it[KEY_SCREEN_ID] }

    /** Tenant HMAC key for verifying USB-ingested content bundles. Empty string when USB ingest disabled. */
    val usbIngestKey: Flow<String?> =
        context.dataStore.data.map { it[KEY_USB_INGEST_KEY] }

    /**
     * Remove ONLY the legacy token key, leaving every other key intact.
     *
     * Used by the one-way migration in [resolveNativeToken] and by the
     * unpair path. Deliberately NOT [clear] — `usb_ingest_key` and
     * `tenant_id` are live state that USB ingest still reads, and wiping
     * them here would break sneakernet on a screen that merely migrated
     * its token.
     */
    suspend fun clearToken() {
        context.dataStore.edit { it.remove(KEY_TOKEN) }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }

    private companion object {
        val KEY_TOKEN = stringPreferencesKey("device_token")
        val KEY_TENANT_SLUG = stringPreferencesKey("tenant_slug")
        val KEY_TENANT_ID = stringPreferencesKey("tenant_id")
        val KEY_SCREEN_ID = stringPreferencesKey("screen_id")
        val KEY_USB_INGEST_KEY = stringPreferencesKey("usb_ingest_key")
    }
}
