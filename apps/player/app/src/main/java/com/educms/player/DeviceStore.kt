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
 */
class DeviceStore(private val context: Context) {

    val deviceToken: Flow<String?> =
        context.dataStore.data.map { it[KEY_TOKEN] }

    val tenantSlug: Flow<String?> =
        context.dataStore.data.map { it[KEY_TENANT_SLUG] }

    val screenId: Flow<String?> =
        context.dataStore.data.map { it[KEY_SCREEN_ID] }

    suspend fun savePairing(token: String, tenantSlug: String?, screenId: String?) {
        context.dataStore.edit { prefs ->
            prefs[KEY_TOKEN] = token
            tenantSlug?.let { prefs[KEY_TENANT_SLUG] = it }
            screenId?.let { prefs[KEY_SCREEN_ID] = it }
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }

    private companion object {
        val KEY_TOKEN = stringPreferencesKey("device_token")
        val KEY_TENANT_SLUG = stringPreferencesKey("tenant_slug")
        val KEY_SCREEN_ID = stringPreferencesKey("screen_id")
    }
}
