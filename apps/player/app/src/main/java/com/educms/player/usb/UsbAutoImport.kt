package com.educms.player.usb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.storage.StorageManager
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Plug in a stick, the playlist plays (2026-10-22). No picker, no PIN, no
 * prompt — the only on-glass step that can ever appear is Android's one-time
 * "allow access to files" screen on a box that has never granted it, and that
 * is never shown while an emergency hold is up.
 *
 * How:
 *   1. The tenant's USB key arrives with the screen's OWN credential
 *      (`GET /api/v1/screens/:id/usb-key`) and is kept on the device, so an
 *      offline screen can still verify a stick. Refreshed every 6 h online.
 *   2. Removable volumes are scanned on a mount broadcast, on a USB attach,
 *      at start, and every 60 s (some signage ROMs mount without telling
 *      anyone). The scan is a few directory listings.
 *   3. [UsbImporter] verifies signature + tenant + every file and swaps the
 *      import in; the page is told (`venueos-usb-imported`) and plays it via
 *      [UsbWebResponses]. The stick can be pulled afterwards.
 *
 * All work runs on one background thread. Nothing here touches the display,
 * the emergency path or the WebView's content — a stick can never interrupt
 * or delay an alert; the page's overlay leaves emergency manifests alone.
 */
object UsbAutoImport {
    private const val TAG = "UsbAutoImport"
    private const val PREFS = "venueos_usb"
    private const val KEY_KEY = "key"
    private const val KEY_TENANT = "tenant"
    private const val KEY_FETCHED_AT = "fetched_at"
    private const val PLAYER_PREFS = "edu_player"
    private const val SCAN_EVERY_MS = 60_000L
    private const val KEY_REFRESH_MS = 6 * 60 * 60_000L

    /** Called on the main thread after a package was imported (MainActivity tells the page). */
    @Volatile var onImported: (() -> Unit)? = null
    /** Called on the main thread when a stick is present but unreadable (one-time access grant). */
    @Volatile var onNeedsFileAccess: (() -> Unit)? = null

    private val started = AtomicBoolean(false)
    private val askedForAccess = AtomicBoolean(false)
    private lateinit var app: Context
    private lateinit var worker: Handler
    private val main = Handler(Looper.getMainLooper())
    private val processed = HashSet<String>()

    fun start(context: Context) {
        if (!started.compareAndSet(false, true)) return
        app = context.applicationContext
        worker = Handler(HandlerThread("venueos-usb").apply { start() }.looper)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                // Only the system's own mount / attach broadcasts: a forged one
                // can do no more than trigger a scan, which verifies everything.
                when (intent.action) {
                    Intent.ACTION_MEDIA_MOUNTED, UsbManager.ACTION_USB_DEVICE_ATTACHED -> scanSoon(3_000)
                }
            }
        }
        runCatching {
            // Both are system broadcasts, so the receiver must be exported to
            // hear them (Android 13+ requires the flag to be stated).
            val mounted = IntentFilter(Intent.ACTION_MEDIA_MOUNTED).apply { addDataScheme("file") }
            val attached = IntentFilter(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            if (Build.VERSION.SDK_INT >= 33) {
                app.registerReceiver(receiver, mounted, Context.RECEIVER_EXPORTED)
                app.registerReceiver(receiver, attached, Context.RECEIVER_EXPORTED)
            } else {
                app.registerReceiver(receiver, mounted)
                app.registerReceiver(receiver, attached)
            }
        }.onFailure { PlayerLogger.w(TAG, "receiver registration failed: ${it.message}") }
        worker.post(object : Runnable {
            override fun run() {
                runCatching { tick() }.onFailure { PlayerLogger.w(TAG, "scan failed: ${it.message}") }
                worker.postDelayed(this, SCAN_EVERY_MS)
            }
        })
    }

    fun scanSoon(delayMs: Long = 0) {
        if (!started.get()) return
        worker.postDelayed({ runCatching { tick() } }, delayMs)
    }

    /** Unpair: the stick content belonged to the identity being dropped. */
    fun forget(context: Context) {
        val c = context.applicationContext
        runCatching { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply() }
        runCatching { UsbImporter(c.filesDir).forget() }
        runCatching { UsbCacheIndex.reload(c) }
        synchronized(processed) { processed.clear() }
    }

    private fun tick() {
        refreshKeyIfDue()
        val roots = volumeRoots()
        if (roots.isEmpty()) {
            synchronized(processed) { processed.clear() } // a stick put back in is read again
            return
        }
        val readable = roots.filter { it.listFiles() != null }
        if (readable.isEmpty()) {
            requestAccessOnce()
            return
        }
        val candidates = UsbPackageFinder.candidates(readable)
        if (candidates.isEmpty()) return
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var key = prefs.getString(KEY_KEY, null)
        var tenant = prefs.getString(KEY_TENANT, null)
        if (!UsbPackage.isKey(key) || tenant.isNullOrBlank()) {
            refreshKey(force = true)
            key = prefs.getString(KEY_KEY, null)
            tenant = prefs.getString(KEY_TENANT, null)
        }
        if (!UsbPackage.isKey(key) || tenant.isNullOrBlank()) {
            PlayerLogger.w(TAG, "USB_IMPORT_WAITING a package is on the stick but this screen has no USB key yet — it needs to be paired and online once")
            return
        }
        val importer = UsbImporter(app.filesDir)
        // Highest verified version wins when a stick carries several packages.
        var best: Pair<File, UsbImporter.Verdict.Ok>? = null
        for (c in candidates) {
            val src = UsbBundleSource.open(c) ?: continue
            src.use {
                if (synchronized(processed) { it.identity in processed }) return@use
                when (val v = importer.verify(it, key!!, tenant!!)) {
                    is UsbImporter.Verdict.Ok ->
                        if (best == null || compareVersions(v.bundleVersion, best!!.second.bundleVersion) > 0) best = c to v
                    is UsbImporter.Verdict.Rejected -> {
                        PlayerLogger.w(TAG, "USB_IMPORT_REJECTED ${c.name}: ${v.outcome} ${v.reason}")
                        synchronized(processed) { processed.add(it.identity) }
                        report(v.outcome, null, 0, 0, false, v.reason)
                    }
                }
            }
        }
        val chosen = best ?: return
        val src = UsbBundleSource.open(chosen.first) ?: return
        src.use {
            when (val out = importer.import(it, key!!, tenant!!)) {
                is UsbImporter.Outcome.Imported -> {
                    synchronized(processed) { processed.add(it.identity) }
                    UsbCacheIndex.reload(app)
                    PlayerLogger.i(TAG, "USB_IMPORT_OK ${out.bundleVersion}: ${out.assetCount} files, ${out.totalBytes} bytes")
                    report("ACCEPTED", out.bundleVersion, out.assetCount, out.totalBytes, out.emergencyAssets > 0, null)
                    main.post { runCatching { onImported?.invoke() } }
                }
                is UsbImporter.Outcome.AlreadyCurrent -> synchronized(processed) { processed.add(it.identity) }
                is UsbImporter.Outcome.Rejected -> {
                    // Not marked processed when the box is short of space or the
                    // read failed mid-way: the next tick tries again.
                    PlayerLogger.w(TAG, "USB_IMPORT_REJECTED ${chosen.first.name}: ${out.outcome} ${out.reason}")
                    if (out.outcome == "REJECTED_HASH") synchronized(processed) { processed.add(it.identity) }
                    report(out.outcome, chosen.second.bundleVersion, 0, 0, false, out.reason)
                }
            }
        }
    }

    private fun compareVersions(a: String, b: String): Int = UsbPackage.compareVersions(a, b)

    // ─── the stick ───────────────────────────────────────────────────────

    /** Mounted removable volumes. Several routes: OEM ROMs disagree. */
    private fun volumeRoots(): List<File> {
        val out = LinkedHashSet<File>()
        runCatching {
            val sm = app.getSystemService(Context.STORAGE_SERVICE) as StorageManager
            for (v in sm.storageVolumes) {
                if (!v.isRemovable || v.state != Environment.MEDIA_MOUNTED) continue
                val dir = if (Build.VERSION.SDK_INT >= 30) v.directory else
                    runCatching { v.javaClass.getMethod("getPathFile").invoke(v) as? File }.getOrNull()
                if (dir != null) out.add(dir)
            }
        }
        // Fallbacks for ROMs whose StorageManager does not list USB disks.
        for (parent in listOf("/storage", "/mnt/media_rw", "/mnt/usb_storage", "/mnt/usbhost", "/mnt/udisk")) {
            val dirs = File(parent).listFiles() ?: continue
            for (d in dirs) {
                if (!d.isDirectory) continue
                if (d.name in setOf("emulated", "self", "sdcard0", "enc_emulated")) continue
                out.add(d)
            }
        }
        for (p in listOf("/mnt/usb_storage", "/mnt/udisk", "/mnt/usbdisk")) File(p).takeIf { it.isDirectory }?.let { out.add(it) }
        return out.filter { it.exists() }
    }

    private fun requestAccessOnce() {
        if (Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()) return
        if (DisplayEmergency.isHeld(app)) return // never a settings screen over an alert
        if (!askedForAccess.compareAndSet(false, true)) return
        PlayerLogger.w(TAG, "USB_IMPORT_NEEDS_ACCESS a stick is mounted but unreadable — asking once for file access")
        main.post { runCatching { onNeedsFileAccess?.invoke() } }
    }

    // ─── the key ─────────────────────────────────────────────────────────

    private fun refreshKeyIfDue() {
        val at = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_FETCHED_AT, 0L)
        if (System.currentTimeMillis() - at > KEY_REFRESH_MS) refreshKey(force = false)
    }

    private fun refreshKey(force: Boolean) {
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!force && System.currentTimeMillis() - prefs.getLong(KEY_FETCHED_AT, 0L) < KEY_REFRESH_MS) return
        val target = NativeAlertWatchPolicy.targetOf(DisplayEmergency.PRIMARY_FACE, deviceToken()) ?: return
        val root = apiRoot() ?: return
        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$root/api/v1/screens/${target.screenId}/usb-key").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 10_000
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Authorization", "Bearer ${target.token}")
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode != 200) {
                PlayerLogger.w(TAG, "usb-key fetch HTTP ${conn.responseCode}")
                return
            }
            val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            val j = JSONObject(body)
            val key = j.optString("key", "")
            val tenant = j.optString("tenantId", "")
            if (!UsbPackage.isKey(key) || tenant.isBlank()) return
            prefs.edit().putString(KEY_KEY, key.lowercase()).putString(KEY_TENANT, tenant)
                .putLong(KEY_FETCHED_AT, System.currentTimeMillis()).apply()
        } catch (e: Exception) {
            // Offline is normal here: the stored key keeps working.
        } finally {
            runCatching { conn?.disconnect() }
        }
    }

    private fun report(outcome: String, version: String?, count: Int, bytes: Long, emergency: Boolean, reason: String?) {
        val target = NativeAlertWatchPolicy.targetOf(DisplayEmergency.PRIMARY_FACE, deviceToken()) ?: return
        val root = apiRoot() ?: return
        runCatching {
            val conn = (URL("$root/api/v1/tenants/me/usb-ingest/screens/${target.screenId}/event").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 10_000
                doOutput = true
                instanceFollowRedirects = false
                setRequestProperty("Authorization", "Bearer ${target.token}")
                setRequestProperty("Content-Type", "application/json")
            }
            val body = JSONObject().put("outcome", outcome).put("assetCount", count).put("totalBytes", bytes.toString())
                .put("emergencyAssets", emergency)
            version?.let { body.put("bundleVersion", it) }
            reason?.let { body.put("reason", it.take(300)) }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            conn.responseCode
            conn.disconnect()
        }
    }

    /** The canonical device token store — READ ONLY (player rule 3). */
    private fun deviceToken(): String? = runCatching {
        app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE).getString("device_token", null)
    }.getOrNull()

    /** The API root the page bootstrapped, re-validated before a credential is sent to it. */
    private fun apiRoot(): String? {
        val saved = runCatching {
            app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE).getString("api_root", null)
        }.getOrNull()?.trim()?.trimEnd('/')?.removeSuffix("/api/v1") ?: return null
        if (saved.isEmpty()) return null
        return saved.takeIf { HostAllowlist.isApiHost(it) }
    }
}
