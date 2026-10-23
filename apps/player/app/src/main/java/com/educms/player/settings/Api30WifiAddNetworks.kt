package com.educms.player.settings

import android.content.ComponentName
import android.content.Intent
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import android.provider.Settings
import androidx.annotation.RequiresApi

/**
 * Android's own "save this Wi-Fi network" dialog —
 * `Settings.ACTION_WIFI_ADD_NETWORKS`, Android 11 (API 30)+ (2026-10-23).
 * The network it saves is the PERSON's, kept for good like one typed into
 * Settings. API-30 symbols only, loaded only on Android 11+.
 *
 * The request names the system Settings component explicitly (resolved by
 * `SettingsPagePolicy` — a system app, never a browser or a chooser), and is
 * started FOR A RESULT, so it carries no NEW_TASK flag.
 *
 * ⚠️ The request holds the suggestion and therefore the passphrase: it lives
 * in memory only (`WifiSavePrompt`), is handed to Android's Settings app and
 * nowhere else, and is never logged or written to disk.
 */
@RequiresApi(Build.VERSION_CODES.R)
internal object Api30WifiAddNetworks {

    /** What is resolved to decide whether this screen has the dialog at all. */
    fun pageIntent(): Intent = Intent(Settings.ACTION_WIFI_ADD_NETWORKS)

    fun request(suggestion: WifiNetworkSuggestion, component: ComponentName): Intent =
        Intent(Settings.ACTION_WIFI_ADD_NETWORKS)
            .setComponent(component)
            .putParcelableArrayListExtra(Settings.EXTRA_WIFI_NETWORK_LIST, arrayListOf(suggestion))

    /** Android's per-network results, when the build sends them. */
    fun results(data: Intent?): List<Int>? =
        runCatching { data?.getIntegerArrayListExtra(Settings.EXTRA_WIFI_NETWORK_RESULT_LIST)?.toList() }.getOrNull()
}
