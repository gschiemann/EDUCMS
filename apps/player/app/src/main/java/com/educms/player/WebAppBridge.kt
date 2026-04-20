package com.educms.player

import android.webkit.JavascriptInterface

/**
 * Minimal JS ↔ native bridge surface exposed to the web player as
 * `window.EduCmsNative`. Keep this surface tiny — every method becomes
 * an attack surface if the player loads untrusted content.
 */
class WebAppBridge(
    private val onUnpair: () -> Unit,
    private val onReload: () -> Unit,
    private val getDeviceInfo: () -> String,
    private val onCheckForUpdates: () -> Unit,
) {
    @JavascriptInterface
    fun unpair() = onUnpair()

    @JavascriptInterface
    fun reload() = onReload()

    /** Returns device info as JSON: manufacturer, model, sdk, width, height, appVersion. */
    @JavascriptInterface
    fun deviceInfo(): String = getDeviceInfo()

    /**
     * Kicks off a one-time OTA update check. Called by the web player
     * when it receives a signed CHECK_FOR_UPDATES WebSocket message
     * from an admin clicking "Push APK update" in the dashboard.
     * Returns the app's versionName so the server side can log what
     * build was asked to update (forensic trail for forced rollouts).
     */
    @JavascriptInterface
    fun checkForUpdates(): String {
        onCheckForUpdates()
        return BuildConfig.VERSION_NAME
    }
}
