package com.educms.player.store

import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Timer
import java.util.TimerTask

/**
 * One bounded HTTP GET. Implementations NEVER follow redirects themselves: the
 * store follows at most [StorePolicy.MAX_REDIRECTS] hops, each one re-checked
 * against the storage allowlist, and sends a credential to the API host only.
 */
internal interface StoreHttp {
    fun get(url: String, headers: Map<String, String>, deadlineMs: Long): StoreResponse
}

internal interface StoreResponse : Closeable {
    val code: Int
    fun header(name: String): String?
    val body: InputStream
}

/** The production client: today's native request posture (SharedVideoSource), plus Range. */
internal class UrlConnectionStoreHttp : StoreHttp {
    override fun get(url: String, headers: Map<String, String>, deadlineMs: Long): StoreResponse {
        val c = URL(url).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false
        c.connectTimeout = 6_000
        c.readTimeout = 15_000
        c.useCaches = false
        c.setRequestProperty("Accept-Encoding", "identity")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        // A hard deadline across the WHOLE body read, not just the headers
        // (rule 4: a 200-then-stalled body must never wedge the worker).
        val timer = Timer("content-store-http", true)
        timer.schedule(object : TimerTask() { override fun run() { c.disconnect() } }, deadlineMs)
        return try {
            val code = c.responseCode
            object : StoreResponse {
                override val code: Int = code
                override fun header(name: String): String? = c.getHeaderField(name)
                override val body: InputStream by lazy { if (code >= 400) (c.errorStream ?: ByteArrayInputStream(ByteArray(0))) else c.inputStream }
                override fun close() {
                    timer.cancel()
                    c.disconnect()
                }
            }
        } catch (e: Exception) {
            timer.cancel()
            c.disconnect()
            throw e
        }
    }
}
