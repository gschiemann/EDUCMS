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
) {
    @JavascriptInterface
    fun unpair() = onUnpair()

    @JavascriptInterface
    fun reload() = onReload()

    /** Returns device info as JSON: manufacturer, model, sdk, width, height, appVersion. */
    @JavascriptInterface
    fun deviceInfo(): String = getDeviceInfo()
}
