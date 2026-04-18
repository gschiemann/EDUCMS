package com.educms.player.usb

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * Lookup index for USB-ingested assets. UsbIngester writes a `state.json`
 * + the manifest into `filesDir/usb-cache/`; this class loads them and
 * exposes URL-to-File and SHA-to-File maps so the WebViewClient can
 * intercept asset fetches and serve from local disk.
 *
 * Refresh after every successful USB ingest by calling [reload]. Lookups
 * are O(1) and lock-free (AtomicReference snapshot swap).
 */
object UsbCacheIndex {

    private data class Snapshot(
        val urlToFile: Map<String, File>,
        val shaToFile: Map<String, File>,
        val bundleVersion: String,
        val assetCount: Int,
        val totalBytes: Long,
        val cacheRoot: File,
    )

    private val current = AtomicReference<Snapshot?>(null)

    /** Re-scan filesDir/usb-cache/. Cheap; safe to call from any thread. */
    fun reload(context: Context) {
        val root = File(context.filesDir, "usb-cache")
        if (!root.exists()) {
            current.set(null); return
        }
        val state = File(root, "state.json")
        // The manifest from the ingest. We deliberately keep a copy so the
        // index can be rebuilt across process restarts without re-running
        // a USB scan.
        val manifestFile = File(root, "manifest.json")
        if (!state.exists() || !manifestFile.exists()) {
            // First-version layout from UsbIngester didn't write manifest
            // copy; the state file alone is enough to know we have content,
            // but URL-mapping requires the manifest. Bail gracefully.
            current.set(null)
            return
        }
        val manifest = runCatching { JSONObject(manifestFile.readText()) }.getOrNull()
            ?: return run { current.set(null) }

        val urlMap = mutableMapOf<String, File>()
        val shaMap = mutableMapOf<String, File>()
        val assets = manifest.optJSONArray("assets") ?: return
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            val url = a.optString("url", "").ifBlank { continue }
            val sha = a.optString("sha256", "").ifBlank { continue }
            val localPath = a.optString("localPath", "").ifBlank { continue }
            val f = File(root, localPath)
            if (f.exists()) {
                urlMap[url] = f
                shaMap[sha] = f
            }
        }

        val stateJson = runCatching { JSONObject(state.readText()) }.getOrNull()
        current.set(
            Snapshot(
                urlToFile = urlMap.toMap(),
                shaToFile = shaMap.toMap(),
                bundleVersion = stateJson?.optString("bundleVersion", "(unknown)") ?: "(unknown)",
                assetCount = stateJson?.optInt("assetCount", 0) ?: urlMap.size,
                totalBytes = stateJson?.optLong("totalBytes", 0L) ?: 0L,
                cacheRoot = root,
            )
        )
        Log.i("UsbCacheIndex", "Reloaded — ${urlMap.size} URL mappings (${shaMap.size} sha mappings)")
    }

    /** Returns the local File for an asset URL, or null if not USB-cached. */
    fun lookup(url: String): File? = current.get()?.urlToFile?.get(url)

    /** Returns true if any USB content is present (for status indicator). */
    fun isPopulated(): Boolean = (current.get()?.assetCount ?: 0) > 0

    /** Snapshot for status reporting (info overlay / cache-status POST). */
    fun stats(): Triple<String, Int, Long>? {
        val s = current.get() ?: return null
        return Triple(s.bundleVersion, s.assetCount, s.totalBytes)
    }
}
