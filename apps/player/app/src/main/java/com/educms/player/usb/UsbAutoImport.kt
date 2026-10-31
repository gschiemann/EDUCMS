package com.educms.player.usb

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbDevice
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.os.storage.StorageManager
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Plug in a stick, the playlist plays (2026-10-22) — and the screen SAYS what
 * it is doing (2026-10-26, M43 on site: "inserted a USB and nothing happens").
 *
 * How:
 *   1. The tenant's USB key arrives with the screen's OWN credential
 *      (`GET /api/v1/screens/:id/usb-key`) and is kept on the device, so an
 *      offline screen can still verify a stick. Refreshed every 6 h online.
 *   2. Removable volumes are scanned on a mount broadcast, on a USB attach,
 *      at start, every 60 s (some signage ROMs mount without telling anyone),
 *      when a person chooses "Import from USB" in the Back menu, and when they
 *      come back from Android's file-access page.
 *   3. Android 11+ needs "All files access" to read a stick at all: without it
 *      a listing of the drive holds folders only (the .zip is not in it) and
 *      no file opens. That is checked FIRST, from the permission itself —
 *      never inferred from a listing — and the card asks for it ([UsbStage.
 *      NEEDS_ACCESS]); a person's press on Allow opens Android's page.
 *   4. [UsbPackageFinder] finds packages where operators put them;
 *      [UsbImporter] verifies signature + tenant + every file and swaps the
 *      import in; the page is told (`venueos-usb-imported`) and plays it via
 *      [UsbWebResponses]. The stick can be pulled afterwards.
 *   5. Every state goes to [host] (the card, UsbImportCard via MainActivity)
 *      and is reported to `POST /api/v1/tenants/me/usb-ingest/screens/:id/event`
 *      (DETECTED, NEEDS_ACCESS, NO_PACKAGE, WAITING_KEY, REJECTED, IMPORTED).
 *
 * All scanning runs on one background thread and every report on another, so
 * a slow network never delays a stick. Nothing here touches the emergency
 * path: the card never opens over an alert and leaves the moment one starts;
 * the page's overlay leaves emergency manifests alone.
 */
@SuppressLint("StaticFieldLeak") // holds the APPLICATION context only (start() takes applicationContext)
object UsbAutoImport {
    private const val TAG = "UsbAutoImport"
    private const val PREFS = "venueos_usb"
    private const val KEY_KEY = "key"
    private const val KEY_TENANT = "tenant"
    private const val KEY_FETCHED_AT = "fetched_at"
    /** `<drive key>|<stage>` — the last card shown for a drive (a stick left in says each problem once). */
    private const val KEY_SHOWN = "shown"
    private const val PLAYER_PREFS = "edu_player"
    private const val SCAN_EVERY_MS = 60_000L
    private const val KEY_REFRESH_MS = 6 * 60 * 60_000L
    private const val PROGRESS_EVERY_MS = 250L
    private const val FIRST_SCAN_DELAY_MS = 8_000L

    /** Where the card is drawn. Main thread only. */
    interface Host {
        /** True when [state] is on the glass now (false: an alert is held, or no window to draw in). */
        fun show(state: UsbCardState, allowOpening: Boolean): Boolean
        fun driveRemoved()
    }

    /** Called on the main thread after a package was imported (MainActivity tells the page). */
    @Volatile var onImported: (() -> Unit)? = null

    /** The card (MainActivity). Null while no Activity is attached: the import still runs, silently. */
    @Volatile var host: Host? = null

    private val started = AtomicBoolean(false)
    private val mountSignal = AtomicBoolean(false)
    private val connection = UsbConnectionState()
    // Only the single scan worker writes this. Each queued UI callback keeps
    // the ticket of the scan that produced it, even across a slow key fetch.
    private var scanTicket = connection.ticket()

    // The APPLICATION context (start() takes applicationContext), never an Activity.
    @SuppressLint("StaticFieldLeak")
    private lateinit var app: Context
    private lateinit var worker: Handler
    private val reporter = Executors.newSingleThreadExecutor { r -> Thread(r, "venueos-usb-report").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val processed = HashSet<String>()
    private val reported = HashMap<String, Long>()

    // Worker-thread state.
    private var firstScan = true
    /** This scan found something that looks like a VenueOS package (UsbPackageFinder.looksLikePackage). */
    private var packageSeen = false
    /** looksLikePackage answers by candidate identity (path|size|mtime) — a stick left in is not re-opened every minute. */
    private val looksMemo = LinkedHashMap<String, Boolean>()
    private var lastDrive: String? = null

    @Volatile private var awaitingAccessSinceMs = 0L

    fun start(context: Context) {
        if (!started.compareAndSet(false, true)) return
        app = context.applicationContext
        worker = Handler(HandlerThread("venueos-usb").apply { start() }.looper)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                // Only the system's own mount / attach broadcasts: a forged one
                // can do no more than trigger a scan, which verifies everything.
                when (intent.action) {
                    Intent.ACTION_MEDIA_MOUNTED, UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                        if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED && !storageDevice(intent)) return
                        // A sticky mount delivered when the APK starts is a
                        // snapshot of an already connected drive, not a plug.
                        if (!isInitialStickyBroadcast && connection.inserted(
                                physicalAttach = intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED,
                            )) mountSignal.set(true)
                        scanSoon(3_000)
                    }
                    Intent.ACTION_MEDIA_EJECT, Intent.ACTION_MEDIA_UNMOUNTED, Intent.ACTION_MEDIA_REMOVED,
                    Intent.ACTION_MEDIA_BAD_REMOVAL, UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                        if (intent.action == UsbManager.ACTION_USB_DEVICE_DETACHED && !storageDevice(intent)) return
                        connection.removed()
                        mountSignal.set(false)
                        awaitingAccessSinceMs = 0L
                        // onReceive runs on the main thread. Dismiss now,
                        // before a delayed mount scan or old result can show.
                        runCatching { host?.driveRemoved() }
                        scanSoon(1_000)
                    }
                }
            }
        }
        runCatching {
            // System broadcasts, so the receiver must be exported to hear them
            // (Android 13+ requires the flag to be stated).
            val media = IntentFilter().apply {
                addAction(Intent.ACTION_MEDIA_MOUNTED)
                addAction(Intent.ACTION_MEDIA_EJECT)
                addAction(Intent.ACTION_MEDIA_UNMOUNTED)
                addAction(Intent.ACTION_MEDIA_REMOVED)
                addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
                addDataScheme("file")
            }
            val usb = IntentFilter().apply {
                addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
                addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            }
            if (Build.VERSION.SDK_INT >= 33) {
                app.registerReceiver(receiver, media, Context.RECEIVER_EXPORTED)
                app.registerReceiver(receiver, usb, Context.RECEIVER_EXPORTED)
            } else {
                app.registerReceiver(receiver, media)
                app.registerReceiver(receiver, usb)
            }
        }.onFailure { PlayerLogger.w(TAG, "receiver registration failed: ${it.message}") }
        // The first scan waits for the player's window: at process start the
        // Activity is not up yet, and a card drawn into nothing says nothing.
        // (MainActivity.onResume asks for a scan one second after it attaches.)
        worker.postDelayed(object : Runnable {
            override fun run() {
                runCatching { scan(null) }.onFailure { PlayerLogger.w(TAG, "scan failed: ${it.message}") }
                worker.postDelayed(this, SCAN_EVERY_MS)
            }
        }, FIRST_SCAN_DELAY_MS)
    }

    fun scanSoon(delayMs: Long = 0) {
        if (!started.get()) return
        worker.postDelayed({ runCatching { scan(null) }.onFailure { PlayerLogger.w(TAG, "scan failed: ${it.message}") } }, delayMs)
    }

    /**
     * A person asked: the Back menu's "Import from USB", or "Look again" on
     * the card. Forgets what was already read so the same stick is read again,
     * and puts the card up at once. Main thread.
     */
    fun importNow(why: String) {
        if (!started.get()) return
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) {
            PlayerLogger.i(TAG, "import from USB ($why) refused — an emergency hold is in force")
            return
        }
        PlayerLogger.i(TAG, "USB_IMPORT_REQUESTED ($why)")
        synchronized(processed) { processed.clear() }
        val ticket = connection.request()
        if (host?.show(UsbCardState(UsbStage.LOOKING), connection.mayOpen(ticket)) == true) connection.shown(ticket)
        worker.post { runCatching { scan(UsbTrigger.MANUAL) }.onFailure { PlayerLogger.w(TAG, "scan failed: ${it.message}") } }
    }

    /** A person pressed Allow and Android's page is opening: the next return to the player reads the drive again. */
    fun awaitingAccess() {
        awaitingAccessSinceMs = SystemClock.elapsedRealtime()
    }

    /** Android on this screen has no page that grants file access (MainActivity found none). */
    fun noAccessPage() {
        if (!started.get()) return
        awaitingAccessSinceMs = 0L
        val ticket = connection.ticket()
        worker.post {
            if (!connection.current(ticket)) return@post
            scanTicket = ticket
            val drive = UsbImportPolicy.driveKey(volumeRoots().map { it.name })
            stage(UsbTrigger.MANUAL, drive, UsbCardState(UsbStage.NO_ACCESS_PAGE))
        }
    }

    /**
     * The player is in front again (resume / window focus / a permission
     * answer). Main thread. True when this was a person coming back from
     * Android's file-access page, and the drive is being read again.
     */
    fun hostResumed(): Boolean {
        if (!started.get()) return false
        if (!UsbImportPolicy.returnedFromAccessPage(awaitingAccessSinceMs, SystemClock.elapsedRealtime())) return false
        awaitingAccessSinceMs = 0L
        PlayerLogger.i(TAG, "back from Android's file-access page — reading the drive again (access=${hasFileAccess()})")
        synchronized(processed) { processed.clear() }
        val ticket = connection.request()
        if (host?.show(UsbCardState(UsbStage.LOOKING), connection.mayOpen(ticket)) == true) connection.shown(ticket)
        worker.post { runCatching { scan(UsbTrigger.RETURNED) }.onFailure { PlayerLogger.w(TAG, "scan failed: ${it.message}") } }
        return true
    }

    /** Unpair: the stick content belonged to the identity being dropped. */
    fun forget(context: Context) {
        val c = context.applicationContext
        runCatching { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply() }
        runCatching { UsbImporter(c.filesDir).forget() }
        runCatching { UsbCacheIndex.reload(c) }
        synchronized(processed) { processed.clear() }
    }

    /** Can this process read a stick right now? */
    fun hasFileAccess(): Boolean = runCatching {
        UsbImportPolicy.hasFileAccess(
            sdk = Build.VERSION.SDK_INT,
            externalStorageManager = Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager(),
            readPermissionGranted = app.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED,
        )
    }.getOrDefault(false)

    // ─── one scan (worker thread) ────────────────────────────────────────

    private fun scan(requested: UsbTrigger?) {
        val mounted = mountedVolumeRoots()
        val roots = volumeRoots(mounted)
        val drive = UsbImportPolicy.driveKey(roots.map { it.name })
        val change = connection.observe(drive, UsbImportPolicy.driveKey(mounted.map { it.name }))
        if (change.inserted) mountSignal.set(true)
        if (change.removed) {
            mountSignal.set(false)
            awaitingAccessSinceMs = 0L
            notifyDriveRemoved()
        }
        scanTicket = connection.ticket()
        // Consume the insertion hint even when a manual/permission-return
        // scan owns this pass; it must not become a second insertion later.
        val insertionSignal = mountSignal.getAndSet(false)
        val trigger = requested ?: UsbImportPolicy.classify(
            firstScan = firstScan,
            mountSignal = insertionSignal,
            newDrive = UsbImportPolicy.newDrive(lastDrive, drive),
            elapsedSinceBootMs = SystemClock.elapsedRealtime(),
        )
        val hadDrive = !lastDrive.isNullOrEmpty()
        firstScan = false
        lastDrive = drive
        packageSeen = false

        if (roots.isEmpty()) {
            synchronized(processed) { processed.clear() } // a stick put back in is read again
            when (UsbImportPolicy.next(
                drivePresent = false, requested = requested != null, access = false, usableCandidates = 0, hasKey = false,
                driveJustRemoved = hadDrive || change.removed,
            )) {
                UsbNext.NO_DRIVE -> stage(trigger, drive, UsbCardState(UsbStage.NO_DRIVE))
                else -> if (hadDrive) {
                    PlayerLogger.i(TAG, "USB drive removed")
                    notifyDriveRemoved()
                }
            }
            // Keep the key fresh while online, so an offline screen can still verify a stick later.
            refreshKeyIfDue()
            return
        }
        // -- access is judged from the permission, never from a listing (a
        //    FUSE listing without access succeeds and simply leaves the files out) --
        val access = hasFileAccess()
        // 1.1.56 — only what looks like a VenueOS package is a candidate at
        // all, and only then may anything go on the glass by itself.
        val found = UsbPackageFinder.candidates(roots).filter(::looksLikePackage)
        packageSeen = found.isNotEmpty()
        if (trigger.deliberate) {
            PlayerLogger.i(TAG, "USB_IMPORT_DETECTED $drive ($trigger, VenueOS package seen=$packageSeen)")
            stage(trigger, drive, UsbCardState(UsbStage.READING))
        }
        // After the card is up: on an offline screen this can take its 10 s connect timeout.
        refreshKeyIfDue()
        val usable = if (access) found else found.filter(::readableWithoutAccess)
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var key = prefs.getString(KEY_KEY, null)
        var tenant = prefs.getString(KEY_TENANT, null)
        if (usable.isNotEmpty() && (!UsbPackage.isKey(key) || tenant.isNullOrBlank())) {
            refreshKey(force = true)
            key = prefs.getString(KEY_KEY, null)
            tenant = prefs.getString(KEY_TENANT, null)
        }
        val hasKey = UsbPackage.isKey(key) && !tenant.isNullOrBlank()
        when (UsbImportPolicy.next(drivePresent = true, requested = requested != null, access = access, usableCandidates = usable.size, hasKey = hasKey)) {
            UsbNext.NEEDS_ACCESS -> {
                PlayerLogger.w(TAG, "USB_IMPORT_NEEDS_ACCESS a drive is in ($drive, ${found.size} candidate(s) seen) but this app may not read it")
                stage(trigger, drive, UsbCardState(UsbStage.NEEDS_ACCESS, appLabel = appLabel()))
                return
            }
            UsbNext.NO_PACKAGE -> {
                PlayerLogger.w(TAG, "USB_IMPORT_NO_PACKAGE no VenueOS package on $drive")
                stage(trigger, drive, UsbCardState(UsbStage.NO_PACKAGE))
                return
            }
            UsbNext.WAITING_KEY -> {
                PlayerLogger.w(TAG, "USB_IMPORT_WAITING a package is on the stick but this screen has no USB key yet - it needs to be paired and online once")
                stage(trigger, drive, UsbCardState(UsbStage.WAITING_KEY))
                return
            }
            UsbNext.NO_DRIVE, UsbNext.QUIET -> return
            UsbNext.VERIFY -> Unit
        }

        // -- verify every package; the newest verified one wins --
        val importer = UsbImporter(app.filesDir)
        val skip: (String) -> Boolean = { id -> !trigger.deliberate && synchronized(processed) { id in processed } }
        val logRefused: (File, UsbImporter.Verdict.Rejected) -> Unit = { c, v ->
            PlayerLogger.w(TAG, "USB_IMPORT_REJECTED ${c.name}: ${v.outcome} ${v.reason}")
        }
        var round = UsbSelection.verifyAll(usable, importer, key!!, tenant!!, skip, logRefused)
        if (round.best == null && round.refused.any { it.second.outcome == "REJECTED_SIGNATURE" }) {
            // Our organization's package that our key does not open: the key
            // may have been rotated since this screen fetched it. Ask once.
            refreshKey(force = true)
            val fresh = prefs.getString(KEY_KEY, null)
            val freshTenant = prefs.getString(KEY_TENANT, null)
            if (UsbPackage.isKey(fresh) && !freshTenant.isNullOrBlank() && fresh != key) {
                PlayerLogger.i(TAG, "USB key changed on the server - checking the drive again with the new one")
                key = fresh
                tenant = freshTenant
                round = UsbSelection.verifyAll(usable, importer, key!!, tenant!!, skip, logRefused)
            }
        }
        for ((identity, v) in round.refused) {
            // Refused for good (another organization, a bad signature) is not
            // read again every minute; a read error is.
            if (v.kind == UsbImporter.Reject.OTHER_ORG || v.kind == UsbImporter.Reject.UNVERIFIED) {
                synchronized(processed) { processed.add(identity) }
            }
        }
        val chosen = round.best
        if (chosen == null) {
            val stage = UsbImportPolicy.afterVerify(false, round.refused.map { it.second.kind }, round.openedAny) ?: return
            val detail = UsbImportPolicy.worst(round.refused.map { it.second.kind })
                ?.let { worst -> round.refused.first { it.second.kind == worst }.second.reason }
            if (stage == UsbStage.NO_PACKAGE) {
                PlayerLogger.w(TAG, "USB_IMPORT_NO_PACKAGE ${usable.size} candidate(s) on $drive, none a VenueOS package")
            }
            stage(trigger, drive, UsbCardState(stage), detail = detail)
            return
        }
        importChosen(trigger, drive, importer, chosen.first, chosen.second, key!!, tenant!!)
    }

    private fun importChosen(
        trigger: UsbTrigger,
        drive: String,
        importer: UsbImporter,
        file: File,
        verdict: UsbImporter.Verdict.Ok,
        key: String,
        tenant: String,
    ) {
        val label = verdict.label
        val src = UsbBundleSource.open(file) ?: run {
            stage(trigger, drive, UsbCardState(UsbStage.READ_FAILED), detail = "the package could not be opened again")
            return
        }
        src.use {
            if (importer.currentVersion() == verdict.bundleVersion) {
                synchronized(processed) { processed.add(it.identity) }
                if (trigger.deliberate) replayCurrent(trigger, drive, importer, verdict.bundleVersion, label)
                return
            }
            val total = verdict.assets.sumOf { a -> a.sizeBytes }
            var lastPost = 0L
            stage(trigger, drive, UsbCardState(UsbStage.COPYING, playlist = label, filesTotal = verdict.assets.size, bytesTotal = total))
            val out = importer.import(it, key, tenant) { done, files, bytes, bytesTotal ->
                val now = SystemClock.elapsedRealtime()
                if (done == files || now - lastPost >= PROGRESS_EVERY_MS) {
                    lastPost = now
                    present(
                        trigger, drive,
                        UsbCardState(UsbStage.COPYING, playlist = label, filesDone = done, filesTotal = files, bytesDone = bytes, bytesTotal = bytesTotal),
                    )
                }
            }
            when (out) {
                is UsbImporter.Outcome.Imported -> {
                    synchronized(processed) { processed.add(it.identity) }
                    UsbCacheIndex.reload(app)
                    PlayerLogger.i(TAG, "USB_IMPORT_OK ${out.bundleVersion}: ${out.assetCount} files, ${out.totalBytes} bytes")
                    stage(
                        trigger, drive, UsbCardState(UsbStage.IMPORTED, playlist = label),
                        detail = "${out.assetCount} files", version = out.bundleVersion,
                        count = out.assetCount, bytes = out.totalBytes, emergency = out.emergencyAssets > 0,
                    )
                    main.post { runCatching { onImported?.invoke() } }
                }
                is UsbImporter.Outcome.AlreadyCurrent -> {
                    synchronized(processed) { processed.add(it.identity) }
                    if (trigger.deliberate) replayCurrent(trigger, drive, importer, out.bundleVersion, label) else Unit
                }
                is UsbImporter.Outcome.Rejected -> {
                    // Not marked processed when the box is short of space or the
                    // read failed mid-way: the next scan tries again.
                    PlayerLogger.w(TAG, "USB_IMPORT_REJECTED ${file.name}: ${out.outcome} ${out.reason}")
                    if (out.kind == UsbImporter.Reject.UNVERIFIED) synchronized(processed) { processed.add(it.identity) }
                    stage(
                        trigger, drive,
                        UsbCardState(UsbImportPolicy.stageOf(out.kind), playlist = label, neededBytes = out.neededBytes),
                        detail = out.reason, version = verdict.bundleVersion,
                    )
                }
            }
        }
    }

    /**
     * The same package is already on the screen and a person asked for it (a
     * fresh insertion, or Import from USB): nothing is copied; the import time
     * moves on so the page plays it again even over a newer server publish.
     */
    private fun replayCurrent(trigger: UsbTrigger, drive: String, importer: UsbImporter, version: String, label: String?) {
        importer.restamp()
        UsbCacheIndex.reload(app)
        PlayerLogger.i(TAG, "USB_IMPORT_CURRENT $version — already on this screen, playing it again ($trigger)")
        stage(trigger, drive, UsbCardState(UsbStage.IMPORTED, playlist = label, sameVersion = true), detail = "already on this screen", version = version)
        main.post { runCatching { onImported?.invoke() } }
    }

    /** Put [state] on the card when the policy says so, and report it. */
    private fun stage(
        trigger: UsbTrigger,
        drive: String,
        state: UsbCardState,
        detail: String? = null,
        version: String? = null,
        count: Int = 0,
        bytes: Long = 0L,
        emergency: Boolean = false,
    ) {
        present(trigger, drive, state)
        if (!UsbImportPolicy.reports(trigger, state.stage, packageSeen)) return
        val (outcome, reason) = UsbImportPolicy.report(state.stage, detail) ?: return
        reportOnce(trigger, drive, outcome, reason, version, count, bytes, emergency)
    }

    private fun present(trigger: UsbTrigger, drive: String, state: UsbCardState) {
        val ticket = scanTicket
        if (!connection.current(ticket)) return
        // ⚠️ Never over an alert — and not remembered as shown, so it can still be said afterwards.
        if (!UsbImportPolicy.mayShow(runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true))) return
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val memo = prefs.getString(KEY_SHOWN, null)
        val shownBefore = memo?.takeIf { it.substringBeforeLast('|') == drive }
            ?.substringAfterLast('|')?.let { s -> runCatching { UsbStage.valueOf(s) }.getOrNull() }
        if (!UsbImportPolicy.shows(trigger, state.stage, shownBefore, packageSeen)) return
        main.post {
            if (!connection.current(ticket)) return@post
            val shown = runCatching { host?.show(state, connection.mayOpen(ticket)) ?: false }.getOrDefault(false)
            if (shown) connection.shown(ticket)
            // Remembered only once it was really on the glass: a scan that ran
            // before the Activity attached (or under an alert) said nothing yet.
            if (shown && !state.stage.working) prefs.edit().putString(KEY_SHOWN, "$drive|${state.stage.name}").apply()
        }
    }

    private fun notifyDriveRemoved() {
        val ticket = connection.ticket()
        main.post {
            if (connection.unchanged(ticket)) runCatching { host?.driveRemoved() }
        }
    }

    // ─── the stick ───────────────────────────────────────────────────────

    /**
     * A candidate this process can read WITHOUT the storage permission: an
     * older ROM that mounts sticks world-readable. Under Android 11+'s FUSE
     * neither the zip nor the manifest opens, so nothing passes.
     */
    private fun readableWithoutAccess(c: File): Boolean = runCatching {
        if (c.isDirectory) File(c, UsbPackage.MANIFEST).canRead() else c.canRead()
    }.getOrDefault(false)

    /** Mounted removable volumes. Several routes: OEM ROMs disagree. Never the internal storage (UsbVolumePolicy). */
    private fun mountedVolumeRoots(): List<File> {
        val out = LinkedHashSet<File>()
        val internal = internalRoots()
        runCatching {
            val sm = app.getSystemService(Context.STORAGE_SERVICE) as StorageManager
            for (v in sm.storageVolumes) {
                if (!v.isRemovable || v.isPrimary || v.isEmulated || v.state != Environment.MEDIA_MOUNTED) continue
                val dir = if (Build.VERSION.SDK_INT >= 30) v.directory else
                    runCatching { v.javaClass.getMethod("getPathFile").invoke(v) as? File }.getOrNull()
                if (dir == null || !dir.exists()) continue
                if (UsbVolumePolicy.counts(dir.path, canonical(dir), internal, reportedRemovable = true, mountPoints = null, hasEntries = true)) out.add(dir)
            }
        }
        return out.toList()
    }

    private fun volumeRoots(mounted: List<File> = mountedVolumeRoots()): List<File> {
        val out = LinkedHashSet<File>(mounted)
        val internal = internalRoots()
        val mounts = runCatching { UsbVolumePolicy.mountPoints(File("/proc/mounts").readText()) }.getOrNull()
        val fallback = LinkedHashSet<File>()
        // Fallbacks for ROMs whose StorageManager does not list USB disks.
        for (parent in listOf("/storage", "/mnt/media_rw", "/mnt/usb_storage", "/mnt/usbhost", "/mnt/udisk")) {
            val dirs = File(parent).listFiles() ?: continue
            for (d in dirs) if (d.isDirectory) fallback.add(d)
        }
        for (p in listOf("/mnt/usb_storage", "/mnt/udisk", "/mnt/usbdisk")) File(p).takeIf { it.isDirectory }?.let { fallback.add(it) }
        for (d in fallback) {
            if (d in out || !d.exists()) continue
            val counts = UsbVolumePolicy.counts(
                d.path, canonical(d), internal, reportedRemovable = false, mountPoints = mounts,
                hasEntries = runCatching { !d.list().isNullOrEmpty() }.getOrDefault(false),
            )
            if (counts) out.add(d)
        }
        // The same drive reached by two routes (/storage/X and /mnt/media_rw/X) is one drive.
        return out.distinctBy { it.name }
    }

    private fun canonical(f: File): String = runCatching { f.canonicalPath }.getOrDefault(f.path)

    /** The device's own storage, by canonical path: a "drive" that is (or links to) it never counts. */
    private fun internalRoots(): List<String> {
        val out = LinkedHashSet<String>()
        runCatching { @Suppress("DEPRECATION") out += canonical(Environment.getExternalStorageDirectory()) }
        runCatching { out += canonical(app.filesDir) }
        runCatching { app.getExternalFilesDir(null)?.let { out += canonical(it) } }
        runCatching {
            val sm = app.getSystemService(Context.STORAGE_SERVICE) as StorageManager
            for (v in sm.storageVolumes) {
                if (!v.isPrimary && !v.isEmulated) continue
                val dir = if (Build.VERSION.SDK_INT >= 30) v.directory else
                    runCatching { v.javaClass.getMethod("getPathFile").invoke(v) as? File }.getOrNull()
                if (dir != null) out += canonical(dir)
            }
        }
        return out.filter { it.isNotEmpty() && it != "/" }
    }

    /** UsbPackageFinder.looksLikePackage, memoised per candidate identity. */
    private fun looksLikePackage(c: File): Boolean {
        val id = "${c.path}|${c.length()}|${c.lastModified()}"
        looksMemo[id]?.let { return it }
        val v = UsbPackageFinder.looksLikePackage(c)
        looksMemo[id] = v
        if (looksMemo.size > 256) looksMemo.remove(looksMemo.keys.first())
        return v
    }

    private fun storageDevice(intent: Intent): Boolean = runCatching {
        @Suppress("DEPRECATION")
        val device = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            else intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
        device != null && UsbConnectionState.storageDevice(device.deviceClass,
            (0 until device.interfaceCount).map { device.getInterface(it).interfaceClass })
    }.getOrDefault(false)

    /** What Android's settings call this app — the card names it on the file-access step. */
    private fun appLabel(): String? = runCatching {
        app.packageManager.getApplicationLabel(app.applicationInfo).toString().takeIf { it.isNotBlank() }
    }.getOrNull()

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

    // ─── the dashboard ───────────────────────────────────────────────────

    /**
     * Report one state. A stick left in is scanned every minute, so the same
     * drive + outcome + reason is sent once per [UsbImportPolicy.REPORT_REPEAT_MS]
     * — unless a person asked, which always reports.
     */
    private fun reportOnce(
        trigger: UsbTrigger,
        drive: String,
        outcome: String,
        reason: String,
        version: String?,
        count: Int,
        bytes: Long,
        emergency: Boolean,
    ) {
        val dedupe = "$drive|$outcome|${reason.substringBefore(':')}|${version.orEmpty()}"
        val now = SystemClock.elapsedRealtime()
        synchronized(reported) {
            val last = reported[dedupe]
            if (!trigger.deliberate && last != null && now - last < UsbImportPolicy.REPORT_REPEAT_MS) return
            reported[dedupe] = now
            if (reported.size > 64) reported.entries.minByOrNull { it.value }?.let { reported.remove(it.key) }
        }
        val clamped = UsbImportPolicy.clampReason(reason)
        runCatching { reporter.execute { post(outcome, clamped, version, count, bytes, emergency) } }
    }

    private fun post(outcome: String, reason: String, version: String?, count: Int, bytes: Long, emergency: Boolean) {
        val target = NativeAlertWatchPolicy.targetOf(DisplayEmergency.PRIMARY_FACE, deviceToken()) ?: return
        val root = apiRoot() ?: return
        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$root/api/v1/tenants/me/usb-ingest/screens/${target.screenId}/event").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 10_000
                doOutput = true
                instanceFollowRedirects = false
                setRequestProperty("Authorization", "Bearer ${target.token}")
                setRequestProperty("Content-Type", "application/json")
            }
            val body = JSONObject().put("outcome", outcome).put("assetCount", count).put("totalBytes", bytes.toString())
                .put("emergencyAssets", emergency).put("reason", reason)
            version?.let { body.put("bundleVersion", it) }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            if (code !in 200..299) PlayerLogger.w(TAG, "usb event $outcome → HTTP $code")
        } catch (e: Exception) {
            PlayerLogger.d(TAG, "usb event $outcome not sent: ${e.javaClass.simpleName}")
        } finally {
            runCatching { conn?.disconnect() }
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
