package com.educms.player.media

import android.graphics.Color
import android.graphics.Point
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import com.educms.player.BuildConfig
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.face.FaceTokenStore
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

/**
 * One face's native session. Protocol 2 = the solo slot "" (full face, loops,
 * plays as soon as it is committed). Protocol 3 = a positioned slot
 * (`item:<id>` / `zone:<id>`): committed into a HELD first frame on a surface
 * that is ABOVE the window from the moment its child window exists, parked
 * beyond the physical display, moved onto its rect and released on `play`
 * (1.1.41: the same compositing contract as the solo — the WebView stays
 * opaque black beneath it; page content cannot draw over a native slot, so
 * native→native transitions are hard cuts handed over by the held frame).
 * Mutable fields are guarded by the FaceVideoBox monitor; views are touched on
 * the UI thread only.
 */
internal class FaceVideoSession(
    val id: String, val request: FaceVideoRequest?, val zone: FaceZoneRequest?, face: Int,
    policy: DeviceClassPolicy.Resolved,
) {
    val slot: String = zone?.slot ?: ""
    val protocol: Int = if (zone != null) 3 else 2
    /** The stable reason this session may not run on this box, decided before any work; null = it may. */
    val refusal: String? = policy.refusal(protocol, face)
    /** ONE COMPOSITING CONTRACT: above the window — a solo dynamic (R+) or static (24–29), a slot always static; a refused session never uses it. */
    val layer = SoloVideoLayer(policy.composition(protocol, face) ?: SoloVideoLayer.Mode.DYNAMIC_ABOVE)
    val screenId: String = zone?.screenId ?: request!!.screenId
    val revision: String = zone?.revision ?: request!!.revision
    val sha256: String = zone?.sha256 ?: request!!.sha256
    val loop: Boolean = zone?.loop ?: true
    /** The same session for the page: identity, not geometry. */
    val identity: List<String> = zone?.identity ?: listOf(request!!.screenId, request.revision, request.sha256, request.assetId)
    @Volatile var alive = true
    var state = "preparing"
    var reason: String? = null
    var descriptor: FaceVideoDescriptor? = null
    var file: File? = null
    var renderer: FaceVideoRenderer? = null
    var preparingRenderer = false
    var caching = false
    var attached = false
    var degrees = 0
    /** Protocol 3: the page's latest layout; `onGlass` once `play` moved the surface onto it. */
    var layout: FaceZoneLayout? = zone?.layout
    var onGlass = zone == null
    var held = false
    var heldAt = 0L
    var ended = false
    var lastPoll = SystemClock.elapsedRealtime()
    var updates = 0L
    var unique = 0L
    var ptsUs = 0L
    var lastUpdate = 0L
    var lastStamp = 0L
    var codecName: String? = null
    var loops = 0L
    var drops = 0L
    var startedAt = 0L
    var stoppedAt = 0L
    // Measurement (§4E): render-callback intervals on the glass side of the decoder, and the display they land on.
    var intervals: RenderIntervalHistogram? = null
    var displayRefreshRate = 0f
    var displayMode = ""
    /** The renderer's last scheduling snapshot, kept past `renderer.stop()` for the final ledger entry. */
    var finalTiming: JSONObject? = null
    var lastLedgerAt = 0L
    // Experiments (§4E) applied to THIS session.
    var webHidden = false
    var frameRateRequested: String? = null
    /** 1.1.42 — the display this session attached to, every mode it offers (flag or not), and experiments 4 / 5. */
    var supportedModes: List<String> = emptyList()
    var activeModeAtAttach = ""
    var preferredModeApplied = 0
    var preferredModeResult: String? = null
    /** 1.1.43 — this boundary wanted a 60 Hz mode (asked, kept, blocked, could not ask): `requested.prefer60hz` on the report. */
    var preferredModeWanted = false
    /** 1.1.43 — the safety net reverted a mode switch during this session: its stalls are the switch's, not the file's. */
    var modeReverted = false
    var vsyncSnapped = false
    /** Whether this face's window held FLAG_KEEP_SCREEN_ON at the last watch tick; null = no window to read. */
    var keepScreenOn: Boolean? = null
    // Views, created on the UI thread when the surface is attached; in the tree only while this session runs.
    var container: FrameLayout? = null
    var box: FrameLayout? = null
    var surface: SurfaceView? = null
    var parkLeft = 0
    var revealObserver: ViewTreeObserver? = null
    var revealListener: ViewTreeObserver.OnPreDrawListener? = null
    var revealDeadline: Runnable? = null
}

/**
 * Protocol-2/3 ownership: INDEPENDENT sessions per face (FaceVideoPolicy.kt
 * has the why). Network, hashing and codec work never run while holding this
 * monitor, and this monitor never calls into SharedVideoBox while held.
 *
 * Safety properties, each enforced here and not by the page:
 *  • native plays only what THIS face's own authenticated manifest selected,
 *    and only from a file whose length and SHA-256 were verified on disk;
 *  • ONE COMPOSITING CONTRACT (1.1.41): the WebView is opaque BLACK in every
 *    session state, and a solo surface is composed ABOVE the window or the
 *    session is refused (`composition-unavailable`) — the under-window +
 *    transparent-WebView mechanism behind every white and hazy screen is
 *    gone; a compositor that cannot show the surface shows black, never white;
 *  • nothing starts while an emergency hold is in force, and a hold (or the
 *    1 s watch noticing one) stops every face at once — restoring the WebView
 *    (visible, opaque) and hiding the elevated solo surface synchronously,
 *    before the WebView can draw the alert;
 *  • a page that stops polling (10 s lease), a credential that changes
 *    identity, a detached surface or 8 s without a rendered frame retires
 *    the session and restores the opaque WebView background;
 *  • a pre-rolled slot is never on glass before the page's `play`: its
 *    surface — above the window from creation — waits entirely beyond the
 *    physical display, held first frame and all;
 *  • one slot on glass per face region: `play` removes the previous on-glass
 *    session of the same face in the same UI pass that moves the new one in,
 *    so native→native shows no gap and two surfaces never compete for z-order.
 */
internal object FaceVideoBox {
    private val main = Handler(Looper.getMainLooper())
    private val meta = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-meta").apply { isDaemon = true } }
    private val downloads = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-download").apply { isDaemon = true } }
    private val hosts = mutableMapOf<Int, SharedVideoHost>()
    private val diagnosticsPending = mutableSetOf<Int>()
    private val lastDiagnostics = mutableMapOf<Int, Long>()
    /** Experiment fault latch, process-wide: one flip at most (NativeVideoExperiments.kt). */
    internal val experiments = NativeExperimentGuard()
    /** The default display's vsync grid, sampled while a snapping session presents (VsyncClock.kt; default on since 1.1.43). */
    private val vsync = VsyncSampler(main)
    /** 1.1.43: proof that the display keeps producing frames after an automatic 60 Hz request (DisplayModePolicy.kt). */
    private val modeFrames = ModeSwitchFrameWatch(main)
    /**
     * 1.1.43: the end code of a session whose stall was the 60 Hz mode switch's failure, not the
     * file's. TRANSIENT on both sides (NativeEndGrade / the page's table): native is tried again at
     * the panel's own mode on the 30 s schedule — never a 24 h block of the file.
     */
    const val REASON_DISPLAY_MODE_REVERTED = "display-mode-reverted"
    /** Ends that, before the first native frame after a mode request, are re-graded as the switch's failure. */
    private val MODE_SWITCH_FAULTS = setOf("output-stalled", "output-unavailable", "codec-stalled")
    const val NAMESPACE = "native-video-v2"
    /** What this engine can do; what it ADVERTISES is the class table's `protocolMax` (2 on every class in 1.1.41). */
    const val PROTOCOL_MAX = 3
    private const val LEDGER_CHECKPOINT_MS = 60_000L

    @Synchronized fun attach(host: SharedVideoHost) {
        hosts[host.face]?.let { old -> old.faceSessions.values.toList().forEach { stopSession(old, it, "host-replaced") } }
        hosts[host.face] = host
    }
    @Synchronized fun detach(host: SharedVideoHost) {
        host.faceSessions.values.toList().forEach { stopSession(host, it, "host-detached") }
        if (hosts[host.face] === host) hosts.remove(host.face)
    }
    @Synchronized fun anyActive(): Boolean = hosts.values.any { h -> h.faceSessions.values.any { it.alive } }
    @Synchronized fun invalidate(host: SharedVideoHost, why: String) { host.faceSessions.values.toList().forEach { stopSession(host, it, why) } }
    @Synchronized fun suppress(why: String) { hosts.values.forEach { h -> h.faceSessions.values.toList().forEach { stopSession(h, it, why) } } }
    /** Every session is above the window now, so every one yields to operator UI. */
    @Synchronized fun yieldToUi(host: SharedVideoHost, why: String) {
        host.faceSessions.values.toList().forEach { stopSession(host, it, why) }
    }

    private fun live(host: SharedVideoHost, s: FaceVideoSession): Boolean =
        s.alive && hosts[host.face] === host && !host.detached && host.faceSessions[s.slot] === s

    private fun byId(host: SharedVideoHost, id: String): FaceVideoSession? = host.faceSessions.values.firstOrNull { it.id == id }

    /** Protocol 2: the solo slot. */
    fun prepare(host: SharedVideoHost, json: String) {
        val req = FaceVideoRequest.parse(json) ?: return
        begin(host, FaceVideoSession(UUID.randomUUID().toString(), req, null, host.face, DeviceClassPolicy.current(host.ctx))) ?: return
    }

    /** Protocol 3: one positioned slot (refused by the class table in this build — see `begin`). */
    fun prepare(host: SharedVideoHost, req: FaceZoneRequest) {
        begin(host, FaceVideoSession(UUID.randomUUID().toString(), null, req, host.face, DeviceClassPolicy.current(host.ctx))) ?: return
    }

    /** Registers the session (or re-uses a live identical one) and starts the authenticated fetch. */
    private fun begin(host: SharedVideoHost, candidate: FaceVideoSession): FaceVideoSession? {
        val session: FaceVideoSession
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return null
            val existing = host.faceSessions[candidate.slot]
            if (existing != null && existing.alive && existing.identity == candidate.identity) {
                // Same session; the page may only have re-measured its rect.
                candidate.zone?.layout?.let { relayout(host, existing, it) }
                return null
            }
            if (existing != null) stopSession(host, existing, "content-changed")
            session = candidate
            host.faceSessions[session.slot] = session
            host.engine = SharedVideoHost.ENGINE_FACE
            // The class table's verdict comes first: a refused session is registered
            // only so the page reads a STABLE reason, and it costs no network, no
            // surface and no decoder. `composition-unavailable` = this box cannot
            // compose the surface above the window; `protocol3-disabled` = the
            // positioned-slot engine is off on every class in this build.
            session.refusal?.let { stopSession(host, session, it); return null }
            if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, session, "emergency-held"); return null }
            if (session.protocol == 2 && !host.lifecycleReady) { stopSession(host, session, "activity-paused"); return null }
        }
        // The pair engine and this one never share a face (outside our monitor — lock order).
        SharedVideoBox.suppress("engine-switched")
        main.postDelayed({ watch(host, session) }, 1000)
        meta.execute {
            try {
                val d = select(host, session)
                synchronized(this) {
                    if (!live(host, session)) return@execute
                    session.descriptor = d
                    session.caching = true
                }
                downloads.execute { fetch(host, session, d) }
            } catch (e: Exception) {
                synchronized(this) { if (live(host, session)) stopSession(host, session, FaceVideoReasons.code(e, "authorization-failed")) }
            }
        }
        return session
    }

    /** THIS face's own authenticated manifest must name exactly what the page asked for. */
    private fun select(host: SharedVideoHost, s: FaceVideoSession): FaceVideoDescriptor {
        val manifest = SharedVideoSource(host.ctx).manifest(host.face, s.screenId)
        val zone = s.zone
        if (zone == null) {
            val d = FaceVideoDescriptor.parse(manifest.getJSONObject("nativeVideo"))
            require(d.faceIndex == host.face && d.matches(s.request!!)) { "selection-changed" }
            return d
        }
        val items = FaceVideoItems.parse(manifest.getJSONObject("nativeVideoItems"))
        require(items.faceIndex == host.face && items.screenId == zone.screenId) { "selection-changed" }
        val item = items.find(zone) ?: error("selection-changed")
        return items.descriptor(item, zone.layout.fit)
    }

    private fun fetch(host: SharedVideoHost, s: FaceVideoSession, d: FaceVideoDescriptor) {
        try {
            val source = SharedVideoSource(host.ctx)
            val file = source.verifiedFile(NAMESPACE, d.tenantId, d.sha256, d.size, d.url, { wants(d.sha256) }) { dir, keep ->
                val files = dir.listFiles()?.filter { it.isFile && it != keep && Regex("[a-f0-9]{64}\\.mp4").matches(it.name) }
                    ?.map { it.name.removeSuffix(".mp4") to it.lastModified() } ?: emptyList()
                FaceVideoPolicy.prune(files, pinned()).forEach { File(dir, "$it.mp4").delete() }
            }
            // Re-prove the selection after a potentially long download.
            val fresh = select(host, s)
            require(fresh == d) { "selection-changed" }
            synchronized(this) {
                if (!live(host, s)) return
                s.caching = false
                s.file = file
            }
            main.post { attachSurface(host, s) }
        } catch (e: Exception) {
            synchronized(this) { if (live(host, s)) stopSession(host, s, FaceVideoReasons.code(e, "source-failed")) }
        }
    }

    @Synchronized private fun wants(sha: String): Boolean =
        hosts.values.any { h -> h.faceSessions.values.any { it.alive && it.sha256 == sha } }

    @Synchronized private fun pinned(): Set<String> =
        hosts.values.flatMap { h -> h.faceSessions.values.filter { it.alive }.map { it.sha256 } }.toSet()

    /** The rect of this session's black box inside the WebView's parent, as [l, t, w, h]; protocol 2 = the whole face. A slot not yet on glass is parked beyond the display. */
    private fun boxRect(s: FaceVideoSession, parentW: Int, parentH: Int): IntArray {
        val l = s.layout ?: return s.layer.soloRect(parentW, parentH, s.parkLeft)
        val r = FaceZonePolicy.rect(l, parentW, parentH)
        return if (s.onGlass) r else FaceZonePolicy.parked(r, maxOf(parentW, s.parkLeft))
    }

    /**
     * UI thread. Three views per session: a transparent full-size container
     * (it is the SURFACE's container, never the WebView — the WebView itself
     * stays opaque black), a black BOX at the slot's rect (the letterbox of
     * `contain`; for protocol 2 the whole face), and the SurfaceView inside it.
     */
    private fun attachSurface(host: SharedVideoHost, s: FaceVideoSession) {
        val d: FaceVideoDescriptor
        synchronized(this) { if (!live(host, s)) return; d = s.descriptor ?: return }
        val parent = host.web.parent as? ViewGroup
        if (parent == null || parent.width <= 0 || parent.height <= 0) {
            synchronized(this) { if (live(host, s)) stopSession(host, s, "output-unavailable") }; return
        }
        val degrees = s.layout?.degrees ?: SharedVideoTransform.degrees(d.orientation, 0, parent.width, parent.height)
        if (s.layer.staticAbove) {
            // Park both box and surface beyond the display, including any fitted
            // overhang (a slot's fitted frame never overhangs its own box).
            val displaySize = Point()
            parent.display?.getRealSize(displaySize)
            val parentScreen = IntArray(2)
            parent.getLocationOnScreen(parentScreen)
            val fitted = if (s.protocol == 3) intArrayOf(0, 0, 0, 0)
                else FaceVideoPolicy.frame(d.fit, d.width, d.height, degrees, parent.width, parent.height)
            s.parkLeft = SoloVideoLayer.parkingLeft(parent.width, displaySize.x, parentScreen[0], fitted[0])
        }
        val rect = boxRect(s, parent.width, parent.height)
        if (rect[2] <= 0 || rect[3] <= 0) {
            synchronized(this) { if (live(host, s)) stopSession(host, s, "output-unavailable") }; return
        }
        if (s.surface == null) {
            // 1.1.42 (§4E, the pacing finding): the display this face is on and EVERY mode it
            // offers, once per session, flag or not — `supportedModes` on the snapshot.
            val (active, modes) = DisplayModePolicy.read(parent.display)
            s.supportedModes = DisplayModePolicy.labels(active, modes)
            s.activeModeAtAttach = active?.label() ?: ""
            PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_DISPLAY face=${host.face} proto=${s.protocol} active=${s.activeModeAtAttach.ifEmpty { "unknown" }} refresh=${parent.display?.refreshRate ?: 0f} modes=${s.supportedModes.joinToString(";")} sha=${s.sha256.take(8)}")
            // THE 60 Hz REQUEST (automatic since 1.1.43): ask THIS face's window for a same-resolution
            // ~60 Hz mode at this session boundary — before the surface exists, never mid-session (a
            // mode switch can blank the panel for a second or two), never for a slot, never under an
            // emergency hold — once per process, then PROVEN by the safety net (verifyPreferredMode)
            // and the first native frame (updated). Another session already attached on this face
            // makes this boundary mid-session for IT, so nothing is asked then. The kill switch
            // (`prefer60hz: false` on the descriptor) reverts here, at the next boundary — but never
            // under a hold either: a withdraw is a mode switch too, so the first boundary after it does it.
            if (s.protocol == 2) {
                val window = host.window()
                val otherAttached = host.faceSessions.values.any { it !== s && it.alive && it.attached }
                val mode = d.experiments.prefer60hz
                val held = DisplayEmergency.isHeld(host.ctx)
                if (mode == Prefer60Hz.OFF) {
                    if (!otherAttached && !held) PreferredDisplayMode.withdraw(host.face, window)?.let { result ->
                        s.preferredModeResult = result
                        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=off result=$result active=${s.activeModeAtAttach.ifEmpty { "unknown" }} sha=${s.sha256.take(8)}")
                    }
                } else if (otherAttached) {
                    s.preferredModeApplied = PreferredDisplayMode.applied(host.face); s.preferredModeResult = PreferredDisplayMode.RESULT_OTHER_SESSION
                    s.preferredModeWanted = true
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=${mode.wire} result=${s.preferredModeResult} modeId=${s.preferredModeApplied} sha=${s.sha256.take(8)}")
                } else if (held) {
                    s.preferredModeResult = PreferredDisplayMode.RESULT_EMERGENCY_HELD
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=${mode.wire} result=${s.preferredModeResult} sha=${s.sha256.take(8)}")
                } else {
                    val nowMs = System.currentTimeMillis()
                    // The persisted 24 h block stands for every request: no manifest key walks past it.
                    val blockedUntil = Prefer60HzBlock.blockedUntil(host.ctx, nowMs)
                    val (id, result) = PreferredDisplayMode.request(host.face, window, active, modes, blockedUntil, nowMs)
                    s.preferredModeApplied = id; s.preferredModeResult = result
                    s.preferredModeWanted = result != PreferredDisplayMode.RESULT_ALREADY_60HZ && result != PreferredDisplayMode.RESULT_NO_60HZ_MODE
                    if (result == PreferredDisplayMode.RESULT_APPLIED) {
                        experiments.applied(NativeVideoExperiments.PREFER_60HZ)
                        PreferredDisplayMode.pending?.let { armModeSafetyNet(host, s, it) }
                    }
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=${mode.wire} result=$result modeId=$id active=${s.activeModeAtAttach.ifEmpty { "unknown" }} blockedUntil=$blockedUntil sha=${s.sha256.take(8)}")
                }
            }
        }
        val container = s.container ?: FrameLayout(host.web.context).also { s.container = it }
        val box = s.box ?: FrameLayout(host.web.context).also { it.setBackgroundColor(Color.BLACK); s.box = it }
        val surface = s.surface ?: SurfaceView(host.web.context).also { sv ->
            // Legacy z-order is fixed when this SurfaceView creates its child
            // window. Static solo and EVERY positioned slot start above, parked
            // entirely off display; Android R's dynamic solo path still
            // prepares beneath the web hold and re-orders after its first frame.
            sv.setZOrderOnTop(s.layer.staticAbove)
            sv.isFocusable = false
            sv.holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) { surfaceReady(host, s) }
                override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) { surfaceReady(host, s) }
                override fun surfaceDestroyed(holder: SurfaceHolder) { synchronized(this@FaceVideoBox) { if (live(host, s) && s.attached) stopSession(host, s, "output-detached") } }
            })
            s.surface = sv
        }
        container.isFocusable = false; box.isFocusable = false
        if (container.parent == null) {
            container.setBackgroundColor(Color.TRANSPARENT)
            parent.addView(container, parent.indexOfChild(host.web).coerceAtLeast(0), ViewGroup.LayoutParams(-1, -1))
        }
        if (box.parent == null) container.addView(box, FrameLayout.LayoutParams(rect[2], rect[3]).apply { leftMargin = rect[0]; topMargin = rect[1] })
        else box.layoutParams = FrameLayout.LayoutParams(rect[2], rect[3]).apply { leftMargin = rect[0]; topMargin = rect[1] }
        val f = FaceVideoPolicy.frame(d.fit, d.width, d.height, degrees, rect[2], rect[3])
        val lp = FrameLayout.LayoutParams(f[2], f[3]).apply { leftMargin = f[0]; topMargin = f[1] }
        if (surface.parent == null) box.addView(surface, lp) else surface.layoutParams = lp
        synchronized(this) { if (!live(host, s)) return; s.attached = true; s.degrees = degrees }
        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_LAYER face=${host.face} proto=${s.protocol} mode=${s.layer.mode.name.lowercase(Locale.ROOT)} phase=attached sdk=${Build.VERSION.SDK_INT} parked=${s.layer.parked} box=${rect.joinToString(",")} sha=${s.sha256.take(8)}")
        surfaceReady(host, s)
    }

    /**
     * THE SAFETY NET (1.1.43), armed the moment a 60 Hz mode was asked for: Choreographer frames are
     * watched for [PreferredDisplayMode.CONFIRM_WINDOW_MS], then the verdict is taken on the UI
     * thread — the active mode must be the one asked for AND a frame must have been produced within
     * the last seconds — else the mode is reverted and the automatic request blocked for 24 h. A
     * verified switch still waits for the first NATIVE frame (updated → PreferredDisplayMode.confirm);
     * a stall before it is the switch's failure, not the file's (stopSession).
     */
    private fun armModeSafetyNet(host: SharedVideoHost, s: FaceVideoSession, p: PreferredDisplayMode.Pending) {
        modeFrames.start(PreferredDisplayMode.CONFIRM_WINDOW_MS)
        main.postDelayed({ verifyPreferredMode(host, s, p) }, PreferredDisplayMode.CONFIRM_WINDOW_MS)
    }

    /** UI thread. The verdict at the end of the window; a request already confirmed, reverted or withdrawn is left alone. */
    private fun verifyPreferredMode(host: SharedVideoHost, s: FaceVideoSession, p: PreferredDisplayMode.Pending) {
        synchronized(this) {
            if (PreferredDisplayMode.pending !== p) { modeFrames.stop(); return }
            val display = (host.web.parent as? ViewGroup)?.display ?: host.web.display
            val activeNow = DisplayModeFacts.of(runCatching { display?.mode }.getOrNull())
            val verdict = PreferredDisplayMode.verdict(p, activeNow, modeFrames.lastFrameNs, System.nanoTime())
            val frames = modeFrames.frames
            modeFrames.stop()
            if (verdict == null) {
                PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz result=switched modeId=${p.modeId} active=${activeNow?.label() ?: "unknown"} frames=$frames awaiting=native-frame sha=${s.sha256.take(8)}")
                return
            }
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz result=$verdict modeId=${p.modeId} active=${activeNow?.label() ?: "unknown"} frames=$frames sha=${s.sha256.take(8)}")
            revertPreferredMode(host, s, verdict)
        }
    }

    /**
     * Under the monitor, any thread: the bookkeeping now (the block, the session's code, nothing
     * pending any more), the window write on the UI thread. One place reverts; nothing else does.
     */
    private fun revertPreferredMode(host: SharedVideoHost, s: FaceVideoSession, verdict: String) {
        s.preferredModeResult = verdict; s.preferredModeApplied = 0; s.modeReverted = true
        PreferredDisplayMode.abandon(host.face)
        Prefer60HzBlock.block(host.ctx, System.currentTimeMillis() + PreferredDisplayMode.BLOCK_MS, verdict)
        val revert = Runnable {
            modeFrames.stop()
            val result = PreferredDisplayMode.revert(host.face, host.window(), verdict)
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz result=$verdict revert=$result blockedForMs=${PreferredDisplayMode.BLOCK_MS} sha=${s.sha256.take(8)}")
        }
        if (Looper.myLooper() == Looper.getMainLooper()) revert.run() else main.post(revert)
    }

    /** Surface created/changed (UI thread). Prepares the renderer once the surface is real. */
    fun surfaceReady(host: SharedVideoHost, s: FaceVideoSession) {
        val file: File; val d: FaceVideoDescriptor; val sv: SurfaceView
        var grid: VsyncGrid? = null
        synchronized(this) {
            if (!live(host, s) || !s.attached || s.preparingRenderer || s.renderer != null) return
            file = s.file ?: return; d = s.descriptor ?: return
            sv = s.surface ?: return
            if (!sv.holder.surface.isValid || sv.width <= 0 || sv.height <= 0) return
            if (!host.web.isHardwareAccelerated) { stopSession(host, s, "output-unavailable"); return }
            s.preparingRenderer = true
            // Measurement: the display this surface lands on, and the interval histogram sized to the source period.
            s.intervals = s.intervals ?: RenderIntervalHistogram.forFps(d.fps)
            s.displayRefreshRate = sv.display?.refreshRate ?: 0f
            s.displayMode = displayModeOf(sv)
            // Experiment 2: ask for the clip's rate ONLY if the display can switch seamlessly (API 30+).
            if (d.experiments.surfaceFrameRate && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                experiments.allows(NativeVideoExperiments.SURFACE_FRAME_RATE)) {
                s.frameRateRequested = Api30SurfaceFrameRate.request(sv.holder.surface, d.fps.toFloat())
                experiments.applied(NativeVideoExperiments.SURFACE_FRAME_RATE)
                PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=surfaceFrameRate fps=${d.fps} result=${s.frameRateRequested} displayMode=${s.displayMode} refresh=${s.displayRefreshRate} sha=${s.sha256.take(8)}")
            }
            // Experiment 4: release every output at the vsync closest to its due time, on a grid
            // sampled from Choreographer (the DEFAULT display's; a face on another panel is not
            // snapped). Acquired here, before the renderer exists; released with the session.
            if (d.experiments.vsyncSnap && s.protocol == 2 && experiments.allows(NativeVideoExperiments.VSYNC_SNAP)) {
                if (sv.display?.displayId == android.view.Display.DEFAULT_DISPLAY) {
                    grid = vsync.acquire(sv.display?.refreshRate ?: 60f)
                    s.vsyncSnapped = true
                    experiments.applied(NativeVideoExperiments.VSYNC_SNAP)
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=vsyncSnap applied=true nominal=${s.displayRefreshRate} displayMode=${s.displayMode} sha=${s.sha256.take(8)}")
                } else {
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=vsyncSnap applied=false reason=display-not-default displayMode=${s.displayMode} sha=${s.sha256.take(8)}")
                }
            }
        }
        val r = FaceVideoRenderer(file, d, sv.holder.surface, s.degrees, { s.alive && !host.detached },
            failed = { why -> synchronized(this) { if (live(host, s)) stopSession(host, s, why) } },
            rendered = { nanos, pts -> synchronized(this) { if (live(host, s)) updated(host, s, nanos, pts) } },
            looped = { synchronized(this) { if (live(host, s)) s.loops++ } },
            dropped = { synchronized(this) { if (live(host, s)) s.drops++ } },
            loop = s.loop,
            holdFirst = s.protocol == 3,
            firstFrame = { synchronized(this) { if (live(host, s)) { s.held = true; s.heldAt = SystemClock.elapsedRealtime() } } },
            ended = { synchronized(this) { if (live(host, s)) s.ended = true } },
            refreshRate = sv.display?.refreshRate ?: 60f,
            vsync = grid)
        meta.execute {
            try {
                r.prepare()
                synchronized(this) {
                    if (!live(host, s)) { r.stop(); return@execute }
                    val elsewhere = hosts.values.sumOf { h -> h.faceSessions.values.count { it !== s && it.alive && it.renderer != null } }
                    val allowed = if (s.protocol == 3) FaceZonePolicy.decoderAllowed(elsewhere, r.advertisedInstances, !s.onGlass)
                        else FaceVideoPolicy.decoderAllowed(elsewhere, r.advertisedInstances)
                    if (!allowed) { stopSession(host, s, "decoder-budget"); return@execute }
                    s.renderer = r; s.codecName = r.codecName; s.state = "ready"
                }
            } catch (e: Exception) {
                synchronized(this) { if (live(host, s)) stopSession(host, s, FaceVideoReasons.code(e, "native-prepare")) }
            }
        }
    }

    @Volatile private var bootCountMemo: Long? = null
    /** Android's BOOT_COUNT (API 24+), read once per process; null when the setting cannot be read. */
    private fun bootCount(ctx: android.content.Context): Long? = bootCountMemo ?: runCatching {
        android.provider.Settings.Global.getInt(ctx.contentResolver, android.provider.Settings.Global.BOOT_COUNT).toLong()
    }.getOrNull()?.also { bootCountMemo = it }

    /** `modeId:WxH@Hz` of the display the surface is on (API 23+), or "" when it cannot be read. UI thread. */
    private fun displayModeOf(sv: SurfaceView): String = runCatching {
        val m = sv.display?.mode ?: return@runCatching ""
        "${m.modeId}:${m.physicalWidth}x${m.physicalHeight}@${String.format(Locale.ROOT, "%.2f", m.refreshRate)}"
    }.getOrDefault("").take(48)

    @Synchronized fun commit(host: SharedVideoHost, id: String) {
        val s = byId(host, id) ?: return
        if (!live(host, s) || s.state != "ready") return
        if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, s, "emergency-held"); return }
        main.post {
            synchronized(this) {
                if (!live(host, s) || DisplayEmergency.isHeld(host.ctx)) return@post
                host.refreshReadiness()
                if (s.protocol == 2 && !host.lifecycleReady) { stopSession(host, s, "page-stopped"); return@post }
                if (!host.canOwnWindow()) { stopSession(host, s, "page-stopped"); return@post }
                // ONE COMPOSITING CONTRACT: the WebView is opaque black in every state. A
                // set-to-known-value, never a toggle — nothing here can ever make it transparent.
                host.web.setBackgroundColor(Color.BLACK)
                s.startedAt = SystemClock.elapsedRealtime()
                s.renderer?.start()
            }
        }
    }

    /** Protocol 3: the page moved or resized the slot. A rotation / fit change needs a new decoder. */
    @Synchronized fun layout(host: SharedVideoHost, id: String, l: FaceZoneLayout) {
        val s = byId(host, id) ?: return
        if (!live(host, s) || s.zone == null) return
        relayout(host, s, l)
    }

    /** Under the monitor. */
    private fun relayout(host: SharedVideoHost, s: FaceVideoSession, l: FaceZoneLayout) {
        val old = s.layout ?: return
        if (old == l) return
        if (!FaceZonePolicy.moveOnly(old, l)) { stopSession(host, s, "content-changed"); return }
        s.layout = l
        main.post { synchronized(this) { if (live(host, s) && s.attached) applyRect(host, s) } }
    }

    /** UI thread, under the monitor: put the box (and the fitted surface inside it) on its current rect. */
    private fun applyRect(host: SharedVideoHost, s: FaceVideoSession) {
        val parent = host.web.parent as? ViewGroup ?: return
        val box = s.box ?: return; val sv = s.surface ?: return; val d = s.descriptor ?: return
        val rect = boxRect(s, parent.width, parent.height)
        if (rect[2] <= 0 || rect[3] <= 0) { stopSession(host, s, "output-unavailable"); return }
        box.layoutParams = FrameLayout.LayoutParams(rect[2], rect[3]).apply { leftMargin = rect[0]; topMargin = rect[1] }
        val f = FaceVideoPolicy.frame(d.fit, d.width, d.height, s.degrees, rect[2], rect[3])
        sv.layoutParams = FrameLayout.LayoutParams(f[2], f[3]).apply { leftMargin = f[0]; topMargin = f[1] }
    }

    /**
     * Protocol 3: the slot is on glass. In ONE UI pass: every other on-glass
     * session of this face is removed (`superseded` — the page expected it),
     * this session's surface moves onto its rect, and the held first frame is
     * released. The page's hole is already open, so nothing black shows.
     */
    @Synchronized fun play(host: SharedVideoHost, id: String) {
        val s = byId(host, id) ?: return
        if (!live(host, s) || s.zone == null || s.onGlass || !s.held) return
        if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, s, "emergency-held"); return }
        main.post {
            synchronized(this) {
                if (!live(host, s) || DisplayEmergency.isHeld(host.ctx) || !s.held) return@post
                // Only a session whose rect this one covers is superseded; a
                // second template zone elsewhere on the face keeps playing.
                val parent = host.web.parent as? ViewGroup
                val mine = s.layout?.let { FaceZonePolicy.rect(it, parent?.width ?: 0, parent?.height ?: 0) }
                host.faceSessions.values.toList().filter { o ->
                    o !== s && o.alive && o.onGlass && o.zone != null && mine != null &&
                        FaceZonePolicy.overlaps(mine, FaceZonePolicy.rect(o.layout!!, parent?.width ?: 0, parent?.height ?: 0))
                }.forEach { stopSession(host, it, "superseded") }
                s.onGlass = true
                s.held = false
                s.startedAt = SystemClock.elapsedRealtime()
                s.lastUpdate = s.startedAt
                applyRect(host, s)
                s.renderer?.release()
            }
        }
    }

    @Synchronized fun stop(host: SharedVideoHost, id: String) {
        val s = byId(host, id) ?: return
        if (s.alive) stopSession(host, s, "page-stopped")
    }

    private fun updated(host: SharedVideoHost, s: FaceVideoSession, stamp: Long, pts: Long) {
        if (s.startedAt == 0L) return
        if (s.layer.revealTimedOut(System.nanoTime())) { stopSession(host, s, "output-unavailable"); return }
        val sv = s.surface ?: return
        if (!sv.holder.surface.isValid || !sv.isShown) return
        if (!SharedVideoCodecPolicy.validRenderStamp(stamp, pts)) return
        s.updates++
        val onGlass = if (s.protocol == 3) s.onGlass else s.layer.phase == SoloVideoLayer.Phase.ABOVE_WINDOW
        if (stamp != s.lastStamp) {
            // The interval between consecutive render callbacks, counted once the
            // surface is on the glass: the cadence the compositor actually produced.
            if (s.lastStamp > 0L && onGlass) s.intervals?.observe(stamp - s.lastStamp)
            s.unique++; s.lastStamp = stamp; s.ptsUs = pts
            // 1.1.43: the first native frame rendered after a 60 Hz request proves the switch.
            if (PreferredDisplayMode.confirm(host.face)) {
                modeFrames.stop()
                PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz result=confirmed modeId=${s.preferredModeApplied} displayMode=${s.surface?.let { displayModeOf(it) } ?: s.displayMode} sha=${s.sha256.take(8)}")
            }
        }
        s.lastUpdate = SystemClock.elapsedRealtime()
        if (s.protocol == 3) {
            // A slot is already above the window: its held first frame is "presenting"
            // (parked, `held`) and `play` moves it onto its rect. No solo reveal here.
            s.state = "presenting"
        } else if (s.layer.phase == SoloVideoLayer.Phase.ABOVE_WINDOW) {
            s.state = "presenting"
        } else if (s.layer.phase == SoloVideoLayer.Phase.REVEALING) {
            val held = DisplayEmergency.isHeld(host.ctx)
            val attached = s.attached && sv.isAttachedToWindow && sv.holder.surface.isValid
            val uiClear = host.canOwnWindow()
            if (s.layer.confirm(stamp, live(host, s), attached, held, uiClear)) {
                clearRevealWait(s)
                s.state = "presenting"
                PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_LAYER face=${host.face} proto=${s.protocol} mode=${s.layer.mode.name.lowercase(Locale.ROOT)} phase=post-request-render sdk=${Build.VERSION.SDK_INT} requestNs=${s.layer.revealRequestedNs} renderNs=$stamp ptsUs=$pts frames=${s.unique} size=${sv.width}x${sv.height} codec=${s.codecName} displayMode=${s.displayMode} sha=${s.sha256.take(8)}")
                // Experiment 1: with native on the glass, take the WebView off the GPU. The
                // guard refuses it for the rest of the process after one fault, and the
                // view is VISIBLE again, first of all, on any end (stopSession).
                val d = s.descriptor
                if (s.protocol == 2 && d != null && d.experiments.webviewInvisible && experiments.allows(NativeVideoExperiments.WEBVIEW_INVISIBLE)) {
                    host.web.visibility = View.INVISIBLE
                    s.webHidden = true
                    experiments.applied(NativeVideoExperiments.WEBVIEW_INVISIBLE)
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=webviewInvisible applied=true sha=${s.sha256.take(8)}")
                }
                queueDiagnostics(host, s)
                // Four buffer samples per handoff (at reveal, +10 s, +60 s, +5 min): the
                // first ten seconds on the M43 read as an unreadable uniform buffer.
                probeOutput(host, s, sv)
                main.postDelayed({ probeOutput(host, s, sv) }, 10_000)
                main.postDelayed({ probeOutput(host, s, sv) }, 60_000)
                main.postDelayed({ probeOutput(host, s, sv) }, 300_000)
            } else if (s.layer.phase == SoloVideoLayer.Phase.RETIRED && live(host, s)) {
                stopSession(host, s, if (held) "emergency-held" else if (!attached) "output-detached" else "page-stopped")
            }
        } else if (s.layer.request(started = true, validFrame = true)) {
            main.post {
                synchronized(this) {
                    val held = DisplayEmergency.isHeld(host.ctx)
                    val attached = s.attached && sv.isAttachedToWindow && sv.holder.surface.isValid
                    val uiClear = host.canOwnWindow()
                    if (!s.layer.promote(live(host, s), attached, held, uiClear)) {
                        if (live(host, s)) stopSession(host, s,
                            if (held) "emergency-held" else if (!attached) "output-detached" else "page-stopped")
                        return@post
                    }
                    try {
                        if (s.layer.staticAbove) {
                            revealStatic(host, s, sv)
                        } else {
                            sv.setZOrderOnTop(true)
                            s.layer.revealRequested(System.nanoTime())
                        }
                        // Force a host draw: Android R applies the relative
                        // surface-layer transaction on a RenderThread frame.
                        // Completion waits for a post-request codec render.
                        sv.invalidate()
                        host.web.invalidate()
                        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_LAYER face=${host.face} proto=${s.protocol} mode=${s.layer.mode.name.lowercase(Locale.ROOT)} phase=reveal-request sdk=${Build.VERSION.SDK_INT} sha=${s.sha256.take(8)}")
                    } catch (_: Exception) { stopSession(host, s, "output-unavailable") }
                }
            }
        }
    }

    /** UI thread under monitor. Move an already-elevated surface without recreating its buffer. */
    private fun revealStatic(host: SharedVideoHost, s: FaceVideoSession, sv: SurfaceView) {
        val parent = host.web.parent as? ViewGroup ?: error("output-detached")
        val box = s.box ?: error("output-detached")
        val container = s.container ?: error("output-detached")
        val d = s.descriptor ?: error("output-unavailable")
        val target = s.layer.soloRect(parent.width, parent.height, s.parkLeft)
        val fitted = FaceVideoPolicy.frame(d.fit, d.width, d.height, s.degrees, target[2], target[3])
        // A resize is not the position-only handoff this path qualifies.
        check(box.width == target[2] && box.height == target[3] && sv.width == fitted[2] && sv.height == fitted[3])
        s.layer.moveRequested(System.nanoTime())
        val deadline = Runnable {
            synchronized(this) {
                if (live(host, s) && s.layer.revealTimedOut(System.nanoTime())) stopSession(host, s, "output-unavailable")
            }
        }
        s.revealDeadline = deadline
        main.postDelayed(deadline, SoloVideoLayer.REVEAL_TIMEOUT_NS / 1_000_000 + 1)
        val observer = parent.viewTreeObserver
        check(observer.isAlive)
        val listener = ViewTreeObserver.OnPreDrawListener {
            synchronized(this) {
                if (!live(host, s)) { clearRevealWait(s); return@synchronized }
                val held = DisplayEmergency.isHeld(host.ctx)
                val attached = s.attached && sv.isAttachedToWindow && sv.holder.surface.isValid
                val uiClear = host.canOwnWindow()
                if (held || !attached || !uiClear || s.layer.revealTimedOut(System.nanoTime())) {
                    stopSession(host, s, if (held) "emergency-held" else if (!attached) "output-detached" else if (!uiClear) "page-stopped" else "output-unavailable")
                    return@synchronized
                }
                val origin = IntArray(2); container.getLocationInWindow(origin)
                val boxAt = IntArray(2); box.getLocationInWindow(boxAt)
                val surfaceAt = IntArray(2); sv.getLocationInWindow(surfaceAt)
                val boxExpected = intArrayOf(origin[0] + target[0], origin[1] + target[1], target[2], target[3])
                val surfaceExpected = intArrayOf(boxExpected[0] + fitted[0], boxExpected[1] + fitted[1], fitted[2], fitted[3])
                if (SoloVideoLayer.geometryMatches(boxExpected, intArrayOf(boxAt[0], boxAt[1], box.width, box.height)) &&
                    SoloVideoLayer.geometryMatches(surfaceExpected, intArrayOf(surfaceAt[0], surfaceAt[1], sv.width, sv.height))) {
                    // No frame from before this layout can release the web hold.
                    s.layer.revealRequested(System.nanoTime())
                    clearRevealListener(s)
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_LAYER face=${host.face} proto=${s.protocol} mode=${s.layer.mode.name.lowercase(Locale.ROOT)} phase=geometry-ready requestNs=${s.layer.revealRequestedNs} box=${boxExpected.joinToString(",")} surface=${surfaceExpected.joinToString(",")} sha=${s.sha256.take(8)}")
                }
            }
            true
        }
        s.revealObserver = observer; s.revealListener = listener
        observer.addOnPreDrawListener(listener)
        box.layoutParams = FrameLayout.LayoutParams(target[2], target[3]).apply { leftMargin = target[0]; topMargin = target[1] }
        box.requestLayout()
        parent.invalidate()
    }

    /** UI thread. The original observer may have died during host replacement. */
    private fun clearRevealListener(s: FaceVideoSession) {
        val listener = s.revealListener
        val observer = s.revealObserver
        if (listener != null && observer?.isAlive == true) observer.removeOnPreDrawListener(listener)
        s.revealListener = null; s.revealObserver = null
    }

    private fun clearRevealWait(s: FaceVideoSession) {
        clearRevealListener(s)
        s.revealDeadline?.let { main.removeCallbacks(it) }
        s.revealDeadline = null
    }

    private fun watch(host: SharedVideoHost, s: FaceVideoSession) {
        synchronized(this) {
            if (!live(host, s)) return
            val now = SystemClock.elapsedRealtime()
            val screen = s.descriptor?.screenId ?: s.screenId
            val sv = s.surface
            val why = when {
                DisplayEmergency.isHeld(host.ctx) -> "emergency-held"
                s.protocol == 2 && s.startedAt > 0 && !host.lifecycleReady -> "page-stopped"
                s.startedAt > 0 && !host.canOwnWindow() -> "page-stopped"
                s.layer.revealTimedOut(System.nanoTime()) -> "output-unavailable"
                NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(host.ctx, host.face)) != screen -> "credential-identity"
                s.attached && (sv == null || !sv.isAttachedToWindow || !host.web.isAttachedToWindow) -> "output-detached"
                now - s.lastPoll > 10_000 -> "page-lease-expired"
                s.held && now - s.heldAt > FaceZonePolicy.HOLD_MAX_MS -> "hold-expired"
                s.startedAt > 0 && !s.held && !s.ended && now - maxOf(s.startedAt, s.lastUpdate) > 8000 -> "output-stalled"
                else -> null
            }
            if (why != null) { stopSession(host, s, why); return }
            // 1.1.42: does this face's window hold FLAG_KEEP_SCREEN_ON right now? Read, never written,
            // here (KeepScreenOnContractTest): the runtime report says whether a blank was in force.
            s.keepScreenOn = keepScreenOnOf(host)
            // Checkpoint the running session's timing once a minute, so a crash or an
            // update still leaves its last minute on disk (NativeTimingLedger).
            if (s.startedAt > 0 && now - s.lastLedgerAt >= LEDGER_CHECKPOINT_MS) {
                s.lastLedgerAt = now
                runCatching { NativeTimingLedger.shared(host.ctx).live(timingEntry(host, s, null, now)) }
            }
        }
        main.postDelayed({ watch(host, s) }, 1000)
    }

    /** Called under the monitor. Invalidate first; the view work happens on the UI thread. */
    private fun stopSession(host: SharedVideoHost, s: FaceVideoSession, reason: String) {
        if (!s.alive) return
        // 1.1.43: a stall before the first native frame after a 60 Hz request — or in a session whose
        // switch the safety net already reverted — is the mode switch's failure, not the file's: the
        // switch is reverted and blocked, and the session ends TRANSIENT (`display-mode-reverted`), so
        // the page tries native again at the panel's own mode instead of blocking the file for a day.
        val why = if (reason in MODE_SWITCH_FAULTS && (s.modeReverted || PreferredDisplayMode.pending?.face == host.face)) {
            if (!s.modeReverted) revertPreferredMode(host, s, PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES)
            REASON_DISPLAY_MODE_REVERTED
        } else reason
        val previousLayer = s.layer.phase.name.lowercase(Locale.ROOT)
        s.alive = false
        s.layer.retire()
        s.stoppedAt = SystemClock.elapsedRealtime()
        s.finalTiming = s.renderer?.timing() ?: s.finalTiming
        s.renderer?.stop(); s.renderer = null
        s.state = "failed"; s.reason = why
        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_STOP face=${host.face} proto=${s.protocol} reason=$why layer=$previousLayer mode=${s.layer.mode.name.lowercase(Locale.ROOT)} sdk=${Build.VERSION.SDK_INT} frames=${s.unique} loops=${s.loops} drops=${s.drops} intervals=${s.intervals?.count ?: 0} onPeriod=${s.intervals?.onPeriod() ?: 0} snap=${s.vsyncSnapped} keepScreenOn=${s.keepScreenOn ?: "unknown"} sha=${s.sha256.take(8)}")
        // An experiment that was applied to a session which ended for a reason it could
        // have caused is off for the rest of the process (one flip, never a storm).
        if (s.webHidden && experiments.ended(NativeVideoExperiments.WEBVIEW_INVISIBLE, why))
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=webviewInvisible disabled=$why")
        if (s.frameRateRequested != null && experiments.ended(NativeVideoExperiments.SURFACE_FRAME_RATE, why))
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=surfaceFrameRate disabled=$why")
        if (s.vsyncSnapped) {
            vsync.release()
            if (experiments.ended(NativeVideoExperiments.VSYNC_SNAP, why))
                PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=vsyncSnap disabled=$why")
        }
        if (s.startedAt > 0) runCatching { NativeTimingLedger.shared(host.ctx).record(timingEntry(host, s, why, s.stoppedAt)) }
        val removeOutput = Runnable {
            synchronized(this) {
                // THE WEBVIEW COMES BACK FIRST: visible and opaque, whatever an
                // experiment did to it — before the alert / operator window can draw.
                // Set-to-known-value, so it is free on every ordinary end.
                if (host.web.visibility != View.VISIBLE) host.web.visibility = View.VISIBLE
                s.webHidden = false
                // Hide an elevated surface before the alert/operator window can
                // draw. A main-thread retirement must not wait for another post.
                clearRevealWait(s)
                s.surface?.visibility = View.GONE
                (s.surface?.parent as? ViewGroup)?.removeView(s.surface)
                (s.box?.parent as? ViewGroup)?.removeView(s.box)
                (s.container?.parent as? ViewGroup)?.removeView(s.container)
                // Opaque black in every state (one compositing contract); re-asserted, never conditional.
                host.web.setBackgroundColor(Color.BLACK)
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) removeOutput.run() else main.post(removeOutput)
        queueDiagnostics(host, s)
    }

    /** Under the monitor: coalesce handoff/retirement logs, at most one upload per face per minute. A refused session never uploads. */
    private fun queueDiagnostics(host: SharedVideoHost, s: FaceVideoSession) {
        if (s.refusal != null || !diagnosticsPending.add(host.face)) return
        val delay = maxOf(2000L, (lastDiagnostics[host.face] ?: 0L) + 60_000L - SystemClock.elapsedRealtime())
        main.postDelayed({
            synchronized(this) {
                diagnosticsPending.remove(host.face)
                lastDiagnostics[host.face] = SystemClock.elapsedRealtime()
            }
            runCatching { SharedVideoSource(host.ctx).uploadDiagnostics(host.face, s.screenId) }
        }, delay)
    }

    /** Four tiny buffer samples per handoff; a retired session can never report them, and none is a verdict about the glass. */
    private fun probeOutput(host: SharedVideoHost, s: FaceVideoSession, surface: SurfaceView) {
        NativeVideoSurfaceProbe.capture(surface, main,
            current = { synchronized(this) { live(host, s) && s.surface === surface &&
                s.state == "presenting" && s.layer.phase == SoloVideoLayer.Phase.ABOVE_WINDOW } },
            report = { sample -> synchronized(this) {
                if (live(host, s) && s.surface === surface && s.layer.phase == SoloVideoLayer.Phase.ABOVE_WINDOW) {
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_OUTPUT face=${host.face} proto=${s.protocol} mode=${s.layer.mode.name.lowercase(Locale.ROOT)} sample=surface-buffer $sample frames=${s.unique} ptsUs=${s.ptsUs} displayMode=${s.surface?.let { displayModeOf(it) } ?: s.displayMode} sha=${s.sha256.take(8)}")
                    queueDiagnostics(host, s)
                }
            } })
    }

    /**
     * One bounded summary of a session's timing (the ledger entry, and the
     * live `timing` block minus the history). Stamped when it happens, not
     * when it is uploaded (STAB-01). Codes and a digest prefix only.
     */
    private fun timingEntry(host: SharedVideoHost, s: FaceVideoSession, reason: String?, nowMs: Long): JSONObject {
        val base = s.renderer?.timing() ?: s.finalTiming
        val j = JSONObject()
            .put("at", System.currentTimeMillis()).put("uptimeMs", nowMs)
            .put("face", host.face).put("sha8", s.sha256.take(8)).put("build", BuildConfig.VERSION_NAME)
            .put("protocol", s.protocol)
            .put("composition", s.layer.mode.name.lowercase(Locale.ROOT)).put("layer", s.layer.phase.name.lowercase(Locale.ROOT))
            .put("reason", reason ?: JSONObject.NULL)
            .put("elapsedMs", if (s.startedAt > 0) nowMs - s.startedAt else 0)
            .put("bootCount", bootCount(host.ctx) ?: JSONObject.NULL)
            .put("fps", s.descriptor?.fps ?: 0.0)
            .put("refreshRate", (s.surface?.display?.refreshRate ?: s.displayRefreshRate).toDouble())
            .put("displayMode", s.surface?.let { displayModeOf(it) }?.takeIf { it.isNotEmpty() } ?: s.displayMode)
            .put("decodedFrames", base?.optLong("decodedFrames") ?: 0L).put("submittedFrames", base?.optLong("submittedFrames") ?: 0L)
            .put("lateFrames", base?.optLong("lateFrames") ?: 0L).put("maxLateUs", base?.optLong("maxLateUs") ?: 0L)
            .put("maxSubmitGapMs", base?.optLong("maxSubmitGapMs") ?: 0L)
            .put("droppedFrames", s.drops).put("loops", s.loops).put("uniqueFrames", s.unique)
            .put("codecName", s.codecName ?: JSONObject.NULL)
            .put("webviewInvisible", s.webHidden).put("surfaceFrameRate", s.frameRateRequested ?: JSONObject.NULL)
            // 1.1.42: experiments 4 / 5 and the window flag, per session.
            .put("vsyncSnap", s.vsyncSnapped).put("prefer60hz", s.preferredModeResult ?: JSONObject.NULL)
            .put("preferredModeApplied", s.preferredModeApplied)
            .put("keepScreenOn", s.keepScreenOn ?: JSONObject.NULL)
        if (base?.has("snappedFrames") == true) {
            j.put("snappedFrames", base.optLong("snappedFrames")).put("snapErrorMaxUs", base.optLong("snapErrorMaxUs"))
                .put("snapErrorMeanUs", base.optLong("snapErrorMeanUs")).put("clockSlewUs", base.optLong("clockSlewUs"))
                .put("vsyncPeriodUs", base.optLong("vsyncPeriodUs")).put("vsyncSamples", base.optLong("vsyncSamples"))
            // 1.1.43: the grid-sized release lead the session ran with.
            if (base.has("releaseLeadUs")) j.put("releaseLeadUs", base.optLong("releaseLeadUs"))
        }
        s.intervals?.writeTo(j)
        return j
    }

    /** UI thread. Whether this face's window holds FLAG_KEEP_SCREEN_ON right now; null when there is no window to read. */
    private fun keepScreenOnOf(host: SharedVideoHost): Boolean? = runCatching {
        host.window()?.attributes?.flags?.let { (it and android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0 }
    }.getOrNull()

    /** The live `timing` block: the renderer's scheduling snapshot plus the glass-side measurement and the persisted history. */
    private fun timingJson(host: SharedVideoHost, s: FaceVideoSession): Any {
        val base = s.renderer?.timing() ?: s.finalTiming ?: return JSONObject.NULL
        // The display's CURRENT mode and refresh rate ride on every snapshot (lead, 2026-10-17:
        // overlay vs GPU composition is a candidate for the M43's late-frame residue).
        val j = JSONObject(base.toString())
            .put("droppedFrames", s.drops)
            .put("sourceFps", s.descriptor?.fps ?: 0.0)
            .put("refreshRate", (s.surface?.display?.refreshRate ?: s.displayRefreshRate).toDouble())
            .put("displayMode", s.surface?.let { displayModeOf(it) }?.takeIf { it.isNotEmpty() } ?: s.displayMode)
            // 1.1.42: every mode the panel offers (read at attach), what experiment 5 asked for, the window flag.
            .put("supportedModes", JSONArray(s.supportedModes))
            .put("preferredModeApplied", s.preferredModeApplied)
            .put("preferredModeResult", s.preferredModeResult ?: JSONObject.NULL)
            .put("keepScreenOn", s.keepScreenOn ?: JSONObject.NULL)
        s.intervals?.writeTo(j)
        runCatching { j.put("history", NativeTimingLedger.shared(host.ctx).snapshot()) }
        return j
    }

    private fun sessionJson(host: SharedVideoHost, s: FaceVideoSession): JSONObject {
        val sv = s.surface
        val attached = s.attached && !host.detached && sv != null && sv.isAttachedToWindow
        // A slot's layer is the static shape without the solo reveal: queued while parked, above the window once played.
        val layerMode = if (s.protocol != 3) s.layer.phase.name.lowercase(Locale.ROOT)
            else if (!s.alive) "retired" else if (s.onGlass) "above_window" else "queued"
        val output = JSONObject().put("attached", attached)
            .put("layerMode", layerMode)
            .put("compositionMode", s.layer.mode.name.lowercase(Locale.ROOT))
            .put("moveRequestedNs", s.layer.moveRequestedNs)
            .put("revealRequestedNs", s.layer.revealRequestedNs)
            .put("visible", attached && sv!!.isShown && sv.windowVisibility == View.VISIBLE)
            .put("hardwareAccelerated", host.web.isHardwareAccelerated)
            .put("viewUpdates", s.updates).put("uniqueFrames", s.unique).put("sourcePtsUs", s.ptsUs)
            .put("width", sv?.width ?: 0).put("height", sv?.height ?: 0).put("lastUpdateElapsedMs", s.lastUpdate)
            .put("ageMs", if (s.lastStamp > 0) ((System.nanoTime() - s.lastStamp) / 1_000_000).coerceIn(0, 86_400_000) else 86_400_000)
        val reason = s.reason ?: if (s.caching && s.state == "preparing") "caching" else null
        val j = JSONObject().put("version", 1).put("state", s.state).put("sessionId", s.id)
            .put("sessionProtocol", s.protocol)
            .put("revision", s.revision).put("sha256", s.sha256)
            .put("faceIndex", host.face).put("reason", reason ?: JSONObject.NULL).put("output", output)
            .put("codecName", s.codecName ?: JSONObject.NULL).put("loops", s.loops).put("drops", s.drops)
            .put("timing", timingJson(host, s))
            .put("elapsedMs", if (s.startedAt > 0) SystemClock.elapsedRealtime() - s.startedAt else 0)
            .put("stalls", if (s.reason == "output-stalled") 1 else 0)
        val d = s.descriptor
        if (d != null) {
            // `requested` = what was in effect for THIS session (1.1.43: the snap by default on a solo;
            // the 60 Hz request when this boundary wanted one — asked, kept, blocked or could not ask).
            val requested = d.experiments.toJson()
                .put(NativeVideoExperiments.VSYNC_SNAP, s.protocol == 2 && d.experiments.vsyncSnap)
                .put(NativeVideoExperiments.PREFER_60HZ, s.preferredModeWanted)
            j.put("experiments", JSONObject().put("requested", requested)
                .put("applied", JSONObject().put(NativeVideoExperiments.WEBVIEW_INVISIBLE, s.webHidden)
                    .put(NativeVideoExperiments.SURFACE_FRAME_RATE, s.frameRateRequested ?: JSONObject.NULL)
                    .put(NativeVideoExperiments.VSYNC_SNAP, s.vsyncSnapped)
                    .put(NativeVideoExperiments.PREFER_60HZ, s.preferredModeResult ?: JSONObject.NULL))
                .put("guard", experiments.toJson()))
        }
        return j
    }

    /**
     * The top level is the protocol-2 solo slot exactly as 1.1.29 reported it
     * (idle when there is none); `sessions[]` lists every slot, each with its
     * `slot`, `held` and `ended`. Every poll renews every session's lease.
     * `protocolMax` is the CLASS TABLE's answer (2 everywhere in 1.1.41), so a
     * page never starts a positioned slot this box would only refuse.
     */
    @Synchronized fun state(host: SharedVideoHost): JSONObject {
        val now = SystemClock.elapsedRealtime()
        // A stopped session stays readable for a while (the page reads its reason), then goes.
        host.faceSessions.entries.removeAll { !it.value.alive && now - it.value.stoppedAt > 30_000 }
        host.faceSessions.values.forEach { it.lastPoll = now }
        val solo = host.faceSessions[""]
        val top = if (solo != null) sessionJson(host, solo) else JSONObject().put("version", 1).put("state", "idle")
        val sessions = JSONArray()
        host.faceSessions.values.forEach { s ->
            sessions.put(sessionJson(host, s).put("slot", s.slot).put("held", s.held).put("ended", s.ended).put("protocol", s.protocol))
        }
        return top.put("sessions", sessions).put("protocolMax", DeviceClassPolicy.current(host.ctx).protocolMax)
    }
}
