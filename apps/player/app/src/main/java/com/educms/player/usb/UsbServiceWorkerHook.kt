package com.educms.player.usb

import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.educms.player.logging.PlayerLogger
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The player's media is fetched by its service worker (sw-player.js), and a
 * service worker's requests never reach a WebViewClient — so an imported USB
 * file must be served here too, or the worker goes to the network for it
 * (and an offline box never caches it). Same answer as the page's client
 * ([UsbWebResponses]); URLs the stick does not name pass through untouched.
 * Never the package manifest: the worker passes that path through (null host).
 *
 * Nothing else in the app installs a ServiceWorkerClient; install once.
 */
object UsbServiceWorkerHook {
    private val installed = AtomicBoolean(false)

    fun install() {
        if (!installed.compareAndSet(false, true)) return
        runCatching {
            ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    runCatching { UsbWebResponses.intercept(request, null) }.getOrNull()
            })
        }.onFailure {
            installed.set(false)
            PlayerLogger.w("UsbServiceWorkerHook", "service worker client unavailable: ${it.message}")
        }
    }
}
