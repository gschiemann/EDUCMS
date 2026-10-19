package com.educms.player.media

import android.content.Context
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
import com.educms.player.alertwatch.NativeAlertWatch
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
    /**
     * The host this session belongs to NOW. A protocol-4 session survives its
     * WebView: a renderer loss re-homes it to the replacement WebView's host
     * (design §4.2), so every callback resolves its host through here, never a
     * captured one.
     */
    @Volatile var host: SharedVideoHost,
) {
    val slot: String = zone?.slot ?: ""
    val protocol: Int = if (zone != null) 3 else 2
    /** Where it is registered in `host.faceSessions`: its slot, or [FaceVideoBox.NEXT] / [FaceVideoBox.PREV] around a boundary switch. */
    var key: String = slot
    /** PROTOCOL 4 (native-first): the app owns this session — no page event ends it (§4.2). Never cleared once set. */
    var v4 = false
    var start = StartPolicy.NOW
    /** v4: the next content, preparing beside a presenting one; never on the glass before the swap. */
    var preroll = false
    var swapPath: NativeFirstBoundary.Path? = null
    var readyAt = 0L
    /** v4: what this session does at its next loop end (stop there for a swap, or a release at the boundary). */
    @Volatile var atLapEnd = LapAction.NONE
    var lapArmedAt = 0L
    /** v4: when this session stopped at a loop end or a swap with its last frame held on its surface; 0 = not frozen. */
    var frozenAt = 0L
    /** v4: the session this one replaces; its views go once this one's first post-reveal render confirms. */
    var predecessor: FaceVideoSession? = null
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
 *    the session and restores the opaque WebView background — EXCEPT that a
 *    protocol-4 session (native-first, design §4) belongs to the app: a
 *    document change, a silent page or a renderer loss leaves it presenting
 *    (unattended; the native alert watch speeds up, §7 E4), and only the
 *    hold, the operator UI, the lifecycle, the credential, a fault or the
 *    page's own release / new intent end it;
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
    /** What this engine can do; what it ADVERTISES is the class table's `protocolMax` (2 on every class in 1.1.41), or 4 where native-first is on. */
    const val PROTOCOL_MAX = 4
    private const val LEDGER_CHECKPOINT_MS = 60_000L

    // ─── Native-first (protocol 4): the app owns the playback session (design §3.3–§4, §7) ───
    /** Where the solo's pre-roll waits while the presenting session plays. Never a page slot (those match `(item|zone):…`). */
    const val NEXT = "~next"
    /** Where the replaced session waits, its last frame held, until its successor's first post-reveal render confirms. */
    const val PREV = "~prev"
    /** A frozen predecessor never waits longer than this for its successor (a stuck reveal ends both, transiently). */
    private const val FROZEN_MAX_MS = 10_000L
    /** The hold-last-frame path waits at most this long for A's decoder to be released before B's opens. */
    private const val DECODER_RELEASE_WAIT_MS = 1_000L
    private const val LEASE_TICK_MS = 2_000L
    /** Ends of the presenting session after which its pre-roll must NOT take the face. */
    private val NO_PROMOTION = setOf("emergency-held", "released", "page-requested", "operator-ui", "lifecycle-not-ready",
        "activity-paused", "credential-identity", "document-retired", "host-detached")
    /** The enrolment switch is re-read from this face's own manifest this often (a conditional GET: a 304 costs nothing). */
    private const val SWITCH_REFRESH_MS = 5L * 60_000L
    private const val SWITCH_RETRY_MS = 60_000L
    private val leases = HashMap<Int, PlaybackLease>()
    @Volatile private var intentsMemo: PlaybackIntents? = null
    @Volatile private var blocksMemo: NativeFaultBlocks? = null
    private val transientEnds = TransientEndTracker()
    private val syncGate = SyncGate()
    /** face → the last v4 message the app refused (`native-first-off`, `blocked`, `lease-retired`), for the page. */
    private val rejections = HashMap<Int, JSONObject>()
    /** face → `elapsedRealtime` of the first poll from a document that has not adopted a presenting v4 session. */
    private val unadoptedSince = HashMap<Int, Long>()
    /** Faces that were unattended at the last lease tick (transition detection). */
    private val unattendedFaces = HashSet<Int>()
    private var leaseTickArmed = false
    private val switchRefreshing = HashSet<Int>()

    /**
     * A WebView was attached for [host]'s face. If it replaces another (a
     * renderer loss: RendererRecovery puts the fresh WebView in the SAME
     * parent), a protocol-4 session is RE-HOMED — its surface container lives
     * in that parent (the Activity's / the Presentation's root layout), which
     * the replacement does not touch — and the face's lease is absent at once.
     * Everything else ends `host-replaced`, exactly as before.
     */
    @Synchronized fun attach(host: SharedVideoHost) {
        hosts[host.face]?.let { old ->
            if (old === host) return@let
            val now = SystemClock.elapsedRealtime()
            old.faceSessions.values.toList().forEach { s ->
                val parent = s.container?.parent
                val rehomeable = parent == null || parent === host.web.parent
                if (s.alive && s.v4 && PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.RENDERER_LOST, rehomeable) == PlaybackSessionPolicy.Outcome.REHOME) {
                    old.faceSessions.remove(s.key)
                    host.faceSessions[s.key] = s
                    s.host = host
                    host.engine = SharedVideoHost.ENGINE_FACE
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_REHOME face=${host.face} key=${s.key} state=${s.state} sha=${s.sha256.take(8)}")
                } else {
                    stopSession(old, s, "host-replaced")
                }
            }
            leases[host.face]?.let { it.retire(now); leaseLapsed(host, now) }
        }
        hosts[host.face] = host
    }
    @Synchronized fun detach(host: SharedVideoHost) {
        host.faceSessions.values.toList().forEach { stopSession(host, it, "host-detached") }
        if (hosts[host.face] === host) hosts.remove(host.face)
    }
    @Synchronized fun anyActive(): Boolean = hosts.values.any { h -> h.faceSessions.values.any { it.alive } }

    /**
     * A main-frame document change (a reload, a Resync, a bundle apply). v2 / v3
     * sessions end exactly as before; a protocol-4 session CONTINUES (§4.2) —
     * the face's lease is absent at once and its id retired, so the old
     * document can never act again and the new one must adopt.
     */
    @Synchronized fun invalidate(host: SharedVideoHost, why: String) {
        host.faceSessions.values.toList().forEach { if (!it.v4) stopSession(host, it, why) }
        val now = SystemClock.elapsedRealtime()
        leases[host.face]?.let { lease ->
            // The outgoing document's lease is retired at once; a lease the loading document has just
            // adopted survives that same navigation's later callbacks (PlaybackLease.onDocumentChange).
            if (PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.DOCUMENT_CHANGED) == PlaybackSessionPolicy.Outcome.CONTINUE_UNATTENDED &&
                lease.onDocumentChange(now)) {
                // "until the content changes or the page reloads" (§3.4): a new document starts unsettled.
                transientEnds.resetAll()
                leaseLapsed(host, now)
            }
        }
        unadoptedSince.remove(host.face)
    }

    /** ⚠️ §7 E1: EVERY session of EVERY face — v2, v3, v4, a pre-roll, a held predecessor, attended or not. */
    @Synchronized fun suppress(why: String) { hosts.values.forEach { h -> h.faceSessions.values.toList().forEach { stopSession(h, it, why) } } }
    /** Every session is above the window now, so every one yields to operator UI. A v4 session says which cause (§4.2). */
    @Synchronized fun yieldToUi(host: SharedVideoHost, why: String) {
        host.faceSessions.values.toList().forEach { stopSession(host, it, if (it.v4) pageStopped(host, it) else why) }
    }

    /** `page-stopped` hides three causes; a v4 session reports which one (§4.2). */
    private fun pageStopped(host: SharedVideoHost, s: FaceVideoSession): String = when {
        !s.v4 -> "page-stopped"
        !host.lifecycleReady -> "lifecycle-not-ready"
        else -> "operator-ui"
    }

    private fun live(host: SharedVideoHost, s: FaceVideoSession): Boolean =
        s.alive && s.host === host && hosts[host.face] === host && !host.detached && host.faceSessions[s.key] === s

    /** [live] against the session's CURRENT host (callbacks never trust a captured one: §4.2 re-home). */
    private fun liveNow(s: FaceVideoSession): Boolean = live(s.host, s)

    private fun byId(host: SharedVideoHost, id: String): FaceVideoSession? = host.faceSessions.values.firstOrNull { it.id == id }

    private fun newSession(host: SharedVideoHost, request: FaceVideoRequest?, zone: FaceZoneRequest?): FaceVideoSession =
        FaceVideoSession(UUID.randomUUID().toString(), request, zone, host.face, DeviceClassPolicy.current(host.ctx), host)

    /** Protocol 2: the solo slot. */
    fun prepare(host: SharedVideoHost, json: String) {
        val req = FaceVideoRequest.parse(json) ?: return
        begin(host, newSession(host, req, null)) ?: return
    }

    /** Protocol 3: one positioned slot (refused by the class table in this build — see `begin`). */
    fun prepare(host: SharedVideoHost, req: FaceZoneRequest) {
        begin(host, newSession(host, null, req)) ?: return
    }

    /** Registers the session (or re-uses a live identical one) and starts the authenticated fetch. */
    private fun begin(host: SharedVideoHost, candidate: FaceVideoSession): FaceVideoSession? {
        val session: FaceVideoSession
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return null
            val existing = host.faceSessions[candidate.key]
            if (existing != null && existing.alive && existing.identity == candidate.identity) {
                // Same session; the page may only have re-measured its rect.
                candidate.zone?.layout?.let { relayout(host, existing, it) }
                return null
            }
            if (existing != null) stopSession(host, existing, "content-changed")
            session = candidate
            host.faceSessions[session.key] = session
            host.engine = SharedVideoHost.ENGINE_FACE
            // The class table's verdict comes first: a refused session is registered
            // only so the page reads a STABLE reason, and it costs no network, no
            // surface and no decoder. `composition-unavailable` = this box cannot
            // compose the surface above the window; `protocol3-disabled` = the
            // positioned-slot engine is off on every class in this build.
            session.refusal?.let { stopSession(host, session, it); return null }
            // §7 E2: nothing starts under a hold — a v4 intent is kept, suspended, for the page's restore.
            if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, session, "emergency-held"); return null }
            if (session.protocol == 2 && !host.lifecycleReady) { stopSession(host, session, if (session.v4) "lifecycle-not-ready" else "activity-paused"); return null }
        }
        // The pair engine and this one never share a face (outside our monitor — lock order).
        SharedVideoBox.suppress("engine-switched")
        main.postDelayed({ watch(session) }, 1000)
        meta.execute {
            try {
                val d = select(session.host, session)
                synchronized(this) {
                    if (!liveNow(session)) return@execute
                    session.descriptor = d
                    session.caching = true
                }
                downloads.execute { fetch(session, d) }
            } catch (e: Exception) {
                synchronized(this) { if (liveNow(session)) stopSession(session.host, session, FaceVideoReasons.code(e, "authorization-failed")) }
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
            // Every authenticated read teaches the face its native-first enrolment (§8.1).
            learnSwitch(host.ctx, host.face, d.nativeFirst)
            return d
        }
        val items = FaceVideoItems.parse(manifest.getJSONObject("nativeVideoItems"))
        require(items.faceIndex == host.face && items.screenId == zone.screenId) { "selection-changed" }
        val item = items.find(zone) ?: error("selection-changed")
        return items.descriptor(item, zone.layout.fit)
    }

    private fun fetch(s: FaceVideoSession, d: FaceVideoDescriptor) {
        try {
            val host = s.host
            val source = SharedVideoSource(host.ctx)
            // ONE STORE (§5, stream A): a verified file the store already holds is used as is — no
            // download. A v4 intent whose file the store does NOT hold waits (`not-in-store`, never a
            // verdict on the file) once the store is live; while it answers `mode: off` (the stub, or
            // before adoption) native takes today's own download path, so phase 1 plays unwired.
            val stored = runCatching { ContentStorePort.store.lookup(d.sha256) }.getOrNull()
                ?.takeIf { it.isFile && it.length() == d.size }
            val file = stored ?: if (s.v4 && ContentStorePort.active()) error("not-in-store")
                else source.verifiedFile(NAMESPACE, d.tenantId, d.sha256, d.size, d.url, { wants(d.sha256) }) { dir, keep ->
                    val files = dir.listFiles()?.filter { it.isFile && it != keep && Regex("[a-f0-9]{64}\\.mp4").matches(it.name) }
                        ?.map { it.name.removeSuffix(".mp4") to it.lastModified() } ?: emptyList()
                    FaceVideoPolicy.prune(files, pinned()).forEach { File(dir, "$it.mp4").delete() }
                }
            // Re-prove the selection after a potentially long download.
            val fresh = select(s.host, s)
            require(fresh == d) { "selection-changed" }
            synchronized(this) {
                if (!liveNow(s)) return
                s.caching = false
                s.file = file
            }
            main.post { attachSurface(s.host, s) }
        } catch (e: Exception) {
            synchronized(this) { if (liveNow(s)) stopSession(s.host, s, FaceVideoReasons.code(e, "source-failed")) }
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
            // (`prefer60hz: false` on the descriptor) reverts here, at the next boundary.
            if (s.protocol == 2) {
                val window = host.window()
                val otherAttached = host.faceSessions.values.any { it !== s && it.alive && it.attached }
                val mode = d.experiments.prefer60hz
                if (mode == Prefer60Hz.OFF) {
                    if (!otherAttached) PreferredDisplayMode.withdraw(host.face, window)?.let { result ->
                        s.preferredModeResult = result
                        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=off result=$result active=${s.activeModeAtAttach.ifEmpty { "unknown" }} sha=${s.sha256.take(8)}")
                    }
                } else if (otherAttached) {
                    s.preferredModeApplied = PreferredDisplayMode.applied(host.face); s.preferredModeResult = PreferredDisplayMode.RESULT_OTHER_SESSION
                    s.preferredModeWanted = true
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=${mode.wire} result=${s.preferredModeResult} modeId=${s.preferredModeApplied} sha=${s.sha256.take(8)}")
                } else if (DisplayEmergency.isHeld(host.ctx)) {
                    s.preferredModeResult = PreferredDisplayMode.RESULT_EMERGENCY_HELD
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=${host.face} name=prefer60hz mode=${mode.wire} result=${s.preferredModeResult} sha=${s.sha256.take(8)}")
                } else {
                    val nowMs = System.currentTimeMillis()
                    val blockedUntil = if (mode == Prefer60Hz.AUTO) Prefer60HzBlock.blockedUntil(host.ctx, nowMs) else 0L
                    val (id, result) = PreferredDisplayMode.request(host.face, window, active, modes, mode, blockedUntil, nowMs)
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
                override fun surfaceCreated(holder: SurfaceHolder) { surfaceReady(s.host, s) }
                override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) { surfaceReady(s.host, s) }
                override fun surfaceDestroyed(holder: SurfaceHolder) { synchronized(this@FaceVideoBox) { if (liveNow(s) && s.attached) stopSession(s.host, s, "output-detached") } }
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
        // Every callback resolves the session's CURRENT host (a v4 session may be re-homed, §4.2).
        val r = FaceVideoRenderer(file, d, sv.holder.surface, s.degrees, { s.alive && !s.host.detached },
            failed = { why -> synchronized(this) { if (liveNow(s)) stopSession(s.host, s, why) } },
            rendered = { nanos, pts -> synchronized(this) { if (liveNow(s)) updated(s.host, s, nanos, pts) } },
            looped = { synchronized(this) { if (liveNow(s)) s.loops++ } },
            dropped = { synchronized(this) { if (liveNow(s)) s.drops++ } },
            loop = s.loop,
            // A v4 pre-roll holds its first frame until the swap (§3.3), exactly as a slot does until `play`.
            holdFirst = s.protocol == 3 || (s.v4 && s.key == NEXT),
            firstFrame = { synchronized(this) { if (liveNow(s) && (s.protocol == 3 || s.preroll)) { s.held = true; s.heldAt = SystemClock.elapsedRealtime(); if (s.preroll) prerollHeld(s) } } },
            ended = { synchronized(this) { if (liveNow(s)) s.ended = true } },
            refreshRate = sv.display?.refreshRate ?: 60f,
            freezeAtLapEnd = { s.atLapEnd != LapAction.NONE },
            lapEnded = { onLapEnded(s) },
            vsync = grid)
        meta.execute {
            try {
                r.prepare()
                synchronized(this) {
                    if (!liveNow(s)) { r.stop(); return@execute }
                    // Decoders that exist or will: a v4 pre-roll on the hold-last-frame path has none until its swap.
                    val elsewhere = hosts.values.sumOf { h -> h.faceSessions.values.count { it !== s && it.alive && it.renderer != null &&
                        !(it.preroll && it.swapPath == NativeFirstBoundary.Path.HOLD_LAST_FRAME) } }
                    if (s.v4 && s.key == NEXT) {
                        // §3.3: the budget counts EVERY face; a pre-roll is refused one decoder early, and a refusal
                        // is not an end — it is the hold-last-frame path.
                        s.swapPath = NativeFirstBoundary.path(elsewhere, r.advertisedInstances)
                    } else {
                        val allowed = if (s.protocol == 3) FaceZonePolicy.decoderAllowed(elsewhere, r.advertisedInstances, !s.onGlass)
                            else FaceVideoPolicy.decoderAllowed(elsewhere, r.advertisedInstances)
                        if (!allowed) { stopSession(s.host, s, "decoder-budget"); return@execute }
                    }
                    s.renderer = r; s.codecName = r.codecName; s.state = "ready"
                    s.readyAt = SystemClock.elapsedRealtime()
                    // Protocol 4 has no commit: its start policy replaces it (§3.5).
                    if (s.v4) main.post { v4Ready(s) }
                }
            } catch (e: Exception) {
                synchronized(this) { if (liveNow(s)) stopSession(s.host, s, FaceVideoReasons.code(e, "native-prepare")) }
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
        // Protocol 4 has no commit: its start policy replaces it (§3.5). v2 / v3 are unchanged.
        if (s.v4) return
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

    // ═════════════════════════════════════════════════════════════════════
    // PROTOCOL 4 — NATIVE-FIRST: THE APP OWNS THE PLAYBACK SESSION (design §3.3–§4)
    // ═════════════════════════════════════════════════════════════════════

    /** One `version: 4` message from [host]'s page (SharedVideoHost.prepare). */
    fun onV4(host: SharedVideoHost, m: NativeFirstMessage) {
        when (m) {
            is NativeFirstMessage.Intend -> intend(host, m)
            is NativeFirstMessage.Release -> release(host, m)
            is NativeFirstMessage.Sync -> sync(host, m)
        }
    }

    /**
     * This face's solo intent (§3.5, §4.3). The same content as what presents
     * (or prepares) is an ADOPT — nothing happens on the glass. A new content
     * is a boundary: it pre-rolls beside the presenting session and swaps at
     * its loop end (`boundary`) or as soon as it is ready (`now`); with nothing
     * presenting it simply starts. The switch, the 24 h block and the hold are
     * checked before anything starts; under a hold the intent is kept,
     * suspended, for the page's restore (§7 E2).
     */
    private fun intend(host: SharedVideoHost, m: NativeFirstMessage.Intend) {
        val candidate: FaceVideoSession? = synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return
            val face = host.face
            val now = SystemClock.elapsedRealtime()
            if (!acceptLease(host, m.lease, now)) { reject(face, "lease-retired", m.sha256); return }
            // A v4 intend clears the operator latch exactly as a v2 prepare does: the page decided.
            host.clearOperatorUi()
            val ints = intents(host.ctx)
            val intent = PlaybackIntent.of(m, System.currentTimeMillis())
            val current = host.faceSessions[""]?.takeIf { it.alive }
            val next = host.faceSessions[NEXT]?.takeIf { it.alive }
            val policy = DeviceClassPolicy.current(host.ctx)
            val action = PlaybackSessionPolicy.onIntend(
                sameAsCurrent = current != null && current.identity == m.identity,
                sameAsNext = next != null && next.identity == m.identity,
                currentPresenting = current != null && current.state == "presenting",
                switchOn = policy.nativeFirst(switchValue(host.ctx, face)),
                blocked = blocks(host.ctx).blockedUntil(m.sha256, face, System.currentTimeMillis()) != null,
                // §7 E2: the hold is read at the moment of the decision; begin() reads it again.
                held = DisplayEmergency.isHeld(host.ctx),
            )
            when (action) {
                PlaybackSessionPolicy.IntendAction.ADOPT -> {
                    // ADOPT (§4.3): the new lease takes the session over; a pending release / swap is called off.
                    current!!.v4 = true
                    current.start = m.start
                    current.atLapEnd = LapAction.NONE
                    next?.let { stopSession(host, it, "content-changed") }
                    ints.put(face, intent)
                    rejections.remove(face)
                    armLeaseTick(host.ctx)
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_ADOPT face=$face state=${current.state} sha=${m.sha256.take(8)}")
                    return
                }
                PlaybackSessionPolicy.IntendAction.ADOPT_NEXT -> {
                    next!!.start = m.start
                    ints.put(face, intent)
                    rejections.remove(face)
                    maybeSwap(next)
                    return
                }
                PlaybackSessionPolicy.IntendAction.REFUSE_SWITCH_OFF -> { reject(face, "native-first-off", m.sha256); return }
                PlaybackSessionPolicy.IntendAction.REFUSE_BLOCKED -> { reject(face, "blocked", m.sha256); return }
                PlaybackSessionPolicy.IntendAction.SUSPEND -> {
                    ints.put(face, intent.copy(suspendedByHold = true))
                    rejections.remove(face)
                    armLeaseTick(host.ctx)
                    listOfNotNull(current, next).forEach { stopSession(host, it, "emergency-held") }
                    PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_INTENT face=$face held=true sha=${m.sha256.take(8)}")
                    return
                }
                PlaybackSessionPolicy.IntendAction.PREROLL, PlaybackSessionPolicy.IntendAction.START -> Unit
            }
            // A NEW content (or the restore of a suspended / ended one): "until the content changes" (§3.4).
            ints.get(face)?.takeIf { it.sha256 != m.sha256 }?.let { transientEnds.reset(TransientEndTracker.key(face, it.sha256)) }
            rejections.remove(face)
            armLeaseTick(host.ctx)
            ints.put(face, intent)
            val b = newSession(host, m.request(), null).apply { v4 = true; start = m.start }
            if (action == PlaybackSessionPolicy.IntendAction.PREROLL) {
                next?.let { stopSession(host, it, "content-changed") }
                b.key = NEXT
                b.preroll = true
            } else {
                listOfNotNull(current, next).forEach { stopSession(host, it, "content-changed") }
            }
            PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_INTENT face=$face start=${m.start.wire} preroll=${b.preroll} sha=${m.sha256.take(8)}")
            b
        }
        candidate?.let { begin(host, it) }
    }

    /**
     * No solo native content on this face (§3.5). `now` ends it at once;
     * `boundary` at the presenting session's next loop end, bounded by
     * [NativeFirstBoundary.BOUNDARY_WAIT_MS]. The intent is gone at once (D5).
     */
    private fun release(host: SharedVideoHost, m: NativeFirstMessage.Release) {
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return
            val face = host.face
            val now = SystemClock.elapsedRealtime()
            if (!acceptLease(host, m.lease, now)) { reject(face, "lease-retired", null); return }
            intents(host.ctx).put(face, null)
            rejections.remove(face)
            listOfNotNull(host.faceSessions[NEXT], host.faceSessions[PREV]).filter { it.alive }.forEach { stopSession(host, it, "released") }
            val current = host.faceSessions[""]?.takeIf { it.alive } ?: return
            if (m.at == StartPolicy.NOW || current.state != "presenting") { stopSession(host, current, "released"); return }
            current.atLapEnd = LapAction.RELEASE
            current.lapArmedAt = now
            main.postDelayed({
                synchronized(this) {
                    if (liveNow(current) && current.atLapEnd == LapAction.RELEASE &&
                        SystemClock.elapsedRealtime() - current.lapArmedAt >= NativeFirstBoundary.BOUNDARY_WAIT_MS) stopSession(current.host, current, "released")
                }
            }, NativeFirstBoundary.BOUNDARY_WAIT_MS + 1)
        }
    }

    /** A nudge for the store's OWN authenticated sources (§3.5): rate-limited, single-flight, latest wins. */
    private fun sync(host: SharedVideoHost, m: NativeFirstMessage.Sync) {
        if (!syncGate.offer(m, SystemClock.elapsedRealtime())) {
            main.postDelayed({ syncGate.takePending()?.let { sync(host, it) } }, SyncGate.MIN_INTERVAL_MS)
            return
        }
        meta.execute {
            runCatching { ContentStorePort.store.onSync(m.manifestTag, m.emergencySetHash) }
                .onFailure { PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_SYNC face=${host.face} failed=${it.javaClass.simpleName}") }
            syncGate.done()?.let { later -> main.postDelayed({ sync(host, later) }, SyncGate.MIN_INTERVAL_MS) }
        }
    }

    /** Under the monitor. The lease verdict for a v4 message; a retired document's lease never acts. */
    private fun acceptLease(host: SharedVideoHost, lease: String, now: Long): Boolean {
        val l = leaseOf(host.face, now)
        return when (l.accept(lease, now)) {
            PlaybackLease.Verdict.RETIRED -> {
                PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_LEASE face=${host.face} verdict=retired")
                false
            }
            PlaybackLease.Verdict.ADOPTED -> {
                unadoptedSince.remove(host.face)
                if (unattendedFaces.remove(host.face)) PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_ATTENDED face=${host.face}")
                PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_LEASE face=${host.face} verdict=adopted documents=${l.adoptions}")
                true
            }
            PlaybackLease.Verdict.RENEWED -> true
        }
    }

    private fun leaseOf(face: Int, now: Long): PlaybackLease = leases.getOrPut(face) { PlaybackLease(now) }

    private fun reject(face: Int, reason: String, sha256: String?) {
        rejections[face] = JSONObject().put("reason", reason).put("sha256", sha256 ?: JSONObject.NULL).put("atMs", System.currentTimeMillis())
        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_REJECT face=$face reason=$reason sha=${sha256?.take(8) ?: "none"}")
    }

    /** UI thread. A v4 session finished preparing: start it, or — a pre-roll — get its first frame held and arm the swap. */
    private fun v4Ready(s: FaceVideoSession) {
        synchronized(this) {
            val host = s.host
            if (!live(host, s) || s.state != "ready") return
            if (s.key == NEXT) {
                // PRE-ROLL: the decoder starts now and its first frame is HELD on a surface parked beyond
                // the display (static) or beneath the opaque window (dynamic); prerollHeld() arms the swap.
                // HOLD-LAST-FRAME: no decoder until the swap; the swap is armed at once.
                if (s.swapPath == NativeFirstBoundary.Path.PREROLL) s.renderer?.start() else maybeSwap(s)
                return
            }
            startNow(host, s)
        }
    }

    /** UI thread, under the monitor: the v4 equivalent of commit's start (nothing presents on this face). */
    private fun startNow(host: SharedVideoHost, s: FaceVideoSession) {
        if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, s, "emergency-held"); return }
        host.refreshReadiness()
        if (s.protocol == 2 && !host.lifecycleReady) { stopSession(host, s, pageStopped(host, s)); return }
        if (!host.canOwnWindow()) { stopSession(host, s, pageStopped(host, s)); return }
        // ONE COMPOSITING CONTRACT: opaque black, set-to-known-value.
        host.web.setBackgroundColor(Color.BLACK)
        s.preroll = false
        s.startedAt = SystemClock.elapsedRealtime()
        s.lastUpdate = s.startedAt
        s.renderer?.start()
        // A hold-first renderer (an old pre-roll promoted) must not wait for a swap that will not come.
        s.renderer?.release()
    }

    /** Under the monitor (decode thread): the pre-roll's first frame is on its hidden surface. */
    private fun prerollHeld(b: FaceVideoSession) {
        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_PREROLL face=${b.host.face} held=true path=${b.swapPath?.name?.lowercase(Locale.ROOT)} sha=${b.sha256.take(8)}")
        maybeSwap(b)
    }

    /**
     * Under the monitor. Is [b]'s swap due (NativeFirstBoundary.swapDue)? `now`
     * swaps as soon as B is ready; `boundary` arms the presenting session to
     * stop at its next loop end, with the 60 s bound as a backstop.
     */
    private fun maybeSwap(b: FaceVideoSession) {
        val host = b.host
        if (!live(host, b) || b.key != NEXT) return
        val bReady = if (b.swapPath == NativeFirstBoundary.Path.PREROLL) b.held else b.state == "ready"
        if (!bReady) return
        val a = host.faceSessions[""]?.takeIf { it.alive }
        if (a == null) { main.post { synchronized(this) { if (liveNow(b) && b.key == NEXT) promote(b.host, b) } }; return }
        val now = SystemClock.elapsedRealtime()
        if (NativeFirstBoundary.swapDue(b.start, bReady, a.frozenAt > 0, b.readyAt, now)) {
            main.post { swap(b) }
            return
        }
        if (a.atLapEnd != LapAction.SWAP) {
            a.atLapEnd = LapAction.SWAP
            a.lapArmedAt = now
            main.postDelayed({
                synchronized(this) {
                    if (liveNow(b) && b.key == NEXT &&
                        NativeFirstBoundary.swapDue(b.start, true, false, b.readyAt, SystemClock.elapsedRealtime())) main.post { swap(b) }
                }
            }, NativeFirstBoundary.BOUNDARY_WAIT_MS + 1)
        }
    }

    /** Decode thread: [s] stopped at its loop end with its last frame on the surface (FaceVideoRenderer.freezeAtLapEnd). */
    private fun onLapEnded(s: FaceVideoSession) {
        synchronized(this) {
            if (!liveNow(s)) return
            s.frozenAt = SystemClock.elapsedRealtime()
            when (s.atLapEnd) {
                LapAction.RELEASE -> stopSession(s.host, s, "released")
                LapAction.SWAP -> s.host.faceSessions[NEXT]?.takeIf { it.alive }?.let { b -> main.post { swap(b) } }
                    ?: run { s.atLapEnd = LapAction.NONE; s.frozenAt = 0L; stopSession(s.host, s, "content-changed") }
                LapAction.NONE -> Unit
            }
        }
    }

    /**
     * THE SWAP PASS (UI thread, §3.3). ⚠️ The emergency hold is checked FIRST
     * (§7 E1) — a raised hold moves nothing onto the glass. Then, in ONE pass:
     * A's decoder stops with its last frame held on its surface, B is released
     * (pre-roll) or started (hold-last-frame) and goes through the ordinary
     * reveal, and A's views go only when B's first post-reveal render confirms
     * (updated) — never a black frame between them.
     */
    private fun swap(b: FaceVideoSession) {
        val held = DisplayEmergency.isHeld(b.host.ctx)
        synchronized(this) {
            val host = b.host
            if (!live(host, b) || b.key != NEXT) return
            val a = host.faceSessions[""]?.takeIf { it.alive }
            val path = b.swapPath ?: NativeFirstBoundary.Path.HOLD_LAST_FRAME
            for (step in NativeFirstBoundary.swapSteps(held, path)) when (step) {
                NativeFirstBoundary.Step.ABORT_HELD -> {
                    stopSession(host, b, "emergency-held")
                    a?.let { stopSession(host, it, "emergency-held") }
                    return
                }
                NativeFirstBoundary.Step.FREEZE_A -> a?.let {
                    if (it.frozenAt == 0L) it.frozenAt = SystemClock.elapsedRealtime()
                    it.atLapEnd = LapAction.NONE
                    host.faceSessions.remove("")
                    it.key = PREV
                    host.faceSessions[PREV] = it
                    if (path == NativeFirstBoundary.Path.HOLD_LAST_FRAME) {
                        // B's decoder may only open once A's is gone: release A off the UI thread, then start B.
                        val r = it.renderer
                        meta.execute {
                            r?.stopAndAwait(DECODER_RELEASE_WAIT_MS)
                            main.post { continueSwap(b, a) }
                        }
                        return
                    }
                    it.renderer?.stop()
                }
                NativeFirstBoundary.Step.RELEASE_B -> {
                    promoteKey(host, b)
                    b.preroll = false
                    b.held = false
                    b.startedAt = SystemClock.elapsedRealtime()
                    b.lastUpdate = b.startedAt
                    b.renderer?.release()
                }
                NativeFirstBoundary.Step.START_B -> continueSwap(b, a)
                NativeFirstBoundary.Step.REVEAL_B -> Unit
                NativeFirstBoundary.Step.REMOVE_A_ON_CONFIRM -> b.predecessor = a
            }
            PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_SWAP face=${host.face} path=${path.name.lowercase(Locale.ROOT)} from=${a?.sha256?.take(8) ?: "none"} to=${b.sha256.take(8)}")
        }
    }

    /** UI thread: the hold-last-frame path's second half, once A's decoder is released. The hold is checked first again. */
    private fun continueSwap(b: FaceVideoSession, a: FaceVideoSession?) {
        if (DisplayEmergency.isHeld(b.host.ctx)) {
            synchronized(this) {
                if (liveNow(b)) stopSession(b.host, b, "emergency-held")
                a?.let { if (liveNow(it)) stopSession(it.host, it, "emergency-held") }
            }
            return
        }
        synchronized(this) {
            val host = b.host
            if (!live(host, b)) return
            if (b.key == NEXT) promoteKey(host, b)
            b.predecessor = a?.takeIf { it.alive }
            startNow(host, b)
            PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_SWAP face=${host.face} path=hold_last_frame phase=start-b to=${b.sha256.take(8)}")
        }
    }

    /** Under the monitor: B takes the solo slot. */
    private fun promoteKey(host: SharedVideoHost, b: FaceVideoSession) {
        if (b.key == "") return
        host.faceSessions.remove(b.key)
        b.key = ""
        host.faceSessions[""]?.takeIf { it !== b && it.alive }?.let { stopSession(host, it, "content-changed") }
        host.faceSessions[""] = b
    }

    /** UI thread, under the monitor: nothing presents any more — the pre-roll starts at once. */
    private fun promote(host: SharedVideoHost, b: FaceVideoSession) {
        promoteKey(host, b)
        if (b.state == "ready") startNow(host, b)
        b.preroll = false
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
        if (!s.alive) return
        if (!s.v4) { stopSession(host, s, "page-stopped"); return }
        // A v4 session stopped by its page is a release now: the page asked, and the intent goes with it.
        if (intents(host.ctx).get(host.face)?.identity == s.identity) intents(host.ctx).put(host.face, null)
        stopSession(host, s, "page-requested")
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
                // Native-first (§3.3): the session this one replaces goes only NOW, on this
                // post-reveal render — so the glass never shows a black frame between them.
                s.predecessor?.let { p ->
                    s.predecessor = null
                    if (p.alive) {
                        val heldMs = if (p.frozenAt > 0) SystemClock.elapsedRealtime() - p.frozenAt else 0L
                        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_SWAP face=${host.face} phase=confirmed heldFrameMs=$heldMs from=${p.sha256.take(8)} to=${s.sha256.take(8)}")
                        stopSession(p.host, p, "content-changed")
                    }
                }
                // Experiment 1: with native on the glass, take the WebView off the GPU. The
                // guard refuses it for the rest of the process after one fault, and the
                // view is VISIBLE again, first of all, on any end (stopSession). NEVER for a
                // protocol-4 session (§7 E2): the WebView stays VISIBLE and opaque beneath it,
                // because that session can outlive its page.
                val d = s.descriptor
                if (s.protocol == 2 && !s.v4 && d != null && d.experiments.webviewInvisible && experiments.allows(NativeVideoExperiments.WEBVIEW_INVISIBLE)) {
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
                stopSession(host, s, if (held) "emergency-held" else if (!attached) "output-detached" else pageStopped(host, s))
            }
        } else if (s.layer.request(started = true, validFrame = true)) {
            main.post {
                synchronized(this) {
                    val host = s.host
                    val held = DisplayEmergency.isHeld(host.ctx)
                    val attached = s.attached && sv.isAttachedToWindow && sv.holder.surface.isValid
                    val uiClear = host.canOwnWindow()
                    if (!s.layer.promote(live(host, s), attached, held, uiClear)) {
                        if (live(host, s)) stopSession(host, s,
                            if (held) "emergency-held" else if (!attached) "output-detached" else pageStopped(host, s))
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
                if (liveNow(s) && s.layer.revealTimedOut(System.nanoTime())) stopSession(s.host, s, "output-unavailable")
            }
        }
        s.revealDeadline = deadline
        main.postDelayed(deadline, SoloVideoLayer.REVEAL_TIMEOUT_NS / 1_000_000 + 1)
        val observer = parent.viewTreeObserver
        check(observer.isAlive)
        val listener = ViewTreeObserver.OnPreDrawListener {
            synchronized(this) {
                val host = s.host
                if (!live(host, s)) { clearRevealWait(s); return@synchronized }
                val held = DisplayEmergency.isHeld(host.ctx)
                val attached = s.attached && sv.isAttachedToWindow && sv.holder.surface.isValid
                val uiClear = host.canOwnWindow()
                if (held || !attached || !uiClear || s.layer.revealTimedOut(System.nanoTime())) {
                    stopSession(host, s, if (held) "emergency-held" else if (!attached) "output-detached" else if (!uiClear) pageStopped(host, s) else "output-unavailable")
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

    private fun watch(s: FaceVideoSession) {
        synchronized(this) {
            // The session's CURRENT host: a v4 session may have been re-homed since the last tick.
            val host = s.host
            if (!live(host, s)) return
            val now = SystemClock.elapsedRealtime()
            val screen = s.descriptor?.screenId ?: s.screenId
            val sv = s.surface
            val why = when {
                DisplayEmergency.isHeld(host.ctx) -> "emergency-held"
                s.protocol == 2 && s.startedAt > 0 && !host.lifecycleReady -> pageStopped(host, s)
                s.startedAt > 0 && !host.canOwnWindow() -> pageStopped(host, s)
                s.layer.revealTimedOut(System.nanoTime()) -> "output-unavailable"
                NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(host.ctx, host.face)) != screen -> "credential-identity"
                s.attached && (sv == null || !sv.isAttachedToWindow || !host.web.isAttachedToWindow) -> "output-detached"
                // A page that stops polling ends a v2 / v3 session; a v4 session continues UNATTENDED (§4.2).
                !s.v4 && now - s.lastPoll > 10_000 -> "page-lease-expired"
                s.held && now - s.heldAt > FaceZonePolicy.HOLD_MAX_MS -> "hold-expired"
                // A v4 session stopped at a swap holds its last frame for its successor's reveal, bounded.
                s.frozenAt > 0 && now - s.frozenAt > FROZEN_MAX_MS -> "content-changed"
                s.frozenAt == 0L && s.startedAt > 0 && !s.held && !s.ended && now - maxOf(s.startedAt, s.lastUpdate) > 8000 -> "output-stalled"
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
        main.postDelayed({ watch(s) }, 1000)
    }

    /** Called under the monitor. Invalidate first; the view work happens on the UI thread. */
    private fun stopSession(host: SharedVideoHost, s: FaceVideoSession, reason: String) {
        if (!s.alive) return
        // 1.1.43: a stall before the first native frame after a 60 Hz request — or in a session whose
        // switch the safety net already reverted — is the mode switch's failure, not the file's: the
        // switch is reverted and blocked, and the session ends TRANSIENT (`display-mode-reverted`), so
        // the page tries native again at the panel's own mode instead of blocking the file for a day.
        val graded = if (reason in MODE_SWITCH_FAULTS && (s.modeReverted || PreferredDisplayMode.pending?.face == host.face)) {
            if (!s.modeReverted) revertPreferredMode(host, s, PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES)
            REASON_DISPLAY_MODE_REVERTED
        } else reason
        // A protocol-4 session reports ONLY codes of the closed table (NativeEndReasons, §3.4): a raw
        // network / storage code is never mistaken for a verdict on the file. v2 / v3 are unchanged.
        val why = if (s.v4) NativeEndReasons.normalize(graded) else graded
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
        if (s.v4) endV4(host, s, why)
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
        // Protocol 4: the app owns this session (it survives the page).
        if (s.v4) j.put("nativeFirst", true).put("start", s.start.wire)
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
     * page never starts a positioned slot this box would only refuse — and 4
     * only where the class AND this face's enrolment allow native-first.
     * A v4 pre-roll / held predecessor (keys `~next` / `~prev`) is never a
     * page slot: it rides the solo's entry as `next`.
     */
    @Synchronized fun state(host: SharedVideoHost): JSONObject {
        val now = SystemClock.elapsedRealtime()
        // A stopped session stays readable for a while (the page reads its reason), then goes.
        host.faceSessions.entries.removeAll { !it.value.alive && now - it.value.stoppedAt > 30_000 }
        host.faceSessions.values.forEach { it.lastPoll = now }
        val solo = host.faceSessions[""]
        val top = if (solo != null) sessionJson(host, solo) else JSONObject().put("version", 1).put("state", "idle")
        val next = nextJson(host)
        val sessions = JSONArray()
        host.faceSessions.values.filter { !it.key.startsWith("~") }.forEach { s ->
            val e = sessionJson(host, s).put("slot", s.slot).put("held", s.held).put("ended", s.ended).put("protocol", s.protocol)
            if (s.key == "" && next != null) e.put("next", next)
            sessions.put(e)
        }
        if (next != null) top.put("next", next)
        return top.put("sessions", sessions).put("protocolMax", protocolMax(host, DeviceClassPolicy.current(host.ctx)))
    }

    /** Under the monitor: the solo's pre-roll (§3.3), bounded, for `sessions[].next`. */
    private fun nextJson(host: SharedVideoHost): JSONObject? {
        val b = host.faceSessions[NEXT] ?: return null
        return JSONObject().put("state", b.state).put("sessionId", b.id).put("sha256", b.sha256).put("revision", b.revision)
            .put("start", b.start.wire).put("held", b.held)
            .put("path", b.swapPath?.name?.lowercase(Locale.ROOT) ?: JSONObject.NULL)
            .put("reason", b.reason ?: if (b.caching && b.state == "preparing") "caching" else JSONObject.NULL)
    }

    // ─── Native-first: the session's bookkeeping, the lease, the switch, the reports ───

    /**
     * Under the monitor: a v4 session ended with [why] (a closed-set code).
     * The intent's fate is the policy table's (§4.2); a real fault of the file
     * is blocked for 24 h by file + face + build (§3.4); an unstable transient
     * end counts toward settling; and the boundary pair is kept consistent —
     * a successor that dies takes its held predecessor with it, a pre-roll that
     * dies disarms the presenting session's stop, and a presenting session
     * that dies hands the face to its pre-roll at once.
     */
    private fun endV4(host: SharedVideoHost, s: FaceVideoSession, why: String) {
        val face = host.face
        val ints = intents(host.ctx)
        val intent = ints.get(face)
        if (intent != null && intent.identity == s.identity) when (PlaybackSessionPolicy.fateOf(why)) {
            PlaybackSessionPolicy.Outcome.END_SUSPEND_INTENT -> ints.put(face, intent.copy(suspendedByHold = true))
            PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT -> ints.put(face, null)
            else -> Unit
        }
        if (NativeEndReasons.isFault(why) && why != "blocked") {
            blocks(host.ctx).block(s.sha256, face, System.currentTimeMillis())
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_BLOCK face=$face reason=$why hours=24 sha=${s.sha256.take(8)}")
        }
        if (NativeEndReasons.isTransient(why) && why !in PlaybackSessionPolicy.DELIBERATE &&
            transientEnds.ended(TransientEndTracker.key(face, s.sha256), why, SystemClock.elapsedRealtime())) {
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_SETTLED face=$face reason=$why sha=${s.sha256.take(8)}")
        }
        s.predecessor?.let { p ->
            s.predecessor = null
            if (p.alive) stopSession(p.host, p, if (why == "emergency-held") "emergency-held" else "content-changed")
        }
        when (s.key) {
            NEXT -> host.faceSessions[""]?.let { a ->
                if (a.alive && a.atLapEnd == LapAction.SWAP) { a.atLapEnd = LapAction.NONE; a.lapArmedAt = 0L }
            }
            // The pre-roll IS the page's intent: it takes the face — unless the hold, a release or the
            // page's own stop ended the presenting session (those end the pre-roll too).
            "" -> host.faceSessions[NEXT]?.takeIf { it.alive && why !in NO_PROMOTION }?.let { b ->
                main.post { synchronized(this) { if (liveNow(b) && b.key == NEXT) promote(b.host, b) } }
            }
        }
    }

    private fun intents(ctx: Context): PlaybackIntents = intentsMemo ?: synchronized(this) {
        intentsMemo ?: PlaybackIntents(PrefsIntentStore(ctx.applicationContext)).also { intentsMemo = it }
    }

    private fun blocks(ctx: Context): NativeFaultBlocks = blocksMemo ?: synchronized(this) {
        blocksMemo ?: NativeFaultBlocks(PrefsKv(ctx.applicationContext, "blocks"), BuildConfig.VERSION_NAME).also { blocksMemo = it }
    }

    /** What a face advertises: 4 only where the class can run solo native video AND this face is enrolled (§8.1). */
    internal fun protocolMax(host: SharedVideoHost, policy: DeviceClassPolicy.Resolved): Int {
        val manifest = switchValue(host.ctx, host.face)
        // Only an ENROLLED face re-reads its switch on its own (to notice a flip to off): a screen that
        // is not enrolled makes no request it did not make before — it learns from its sessions' reads.
        if (policy.nativeSolo && manifest == true) maybeRefreshSwitch(host)
        return policy.protocolMax(policy.nativeFirst(manifest))
    }

    // The enrolment switch per face (§8.1): learned from this face's OWN authenticated manifest
    // (`nativeVideo.nativeFirst`) on every native session's selection read, persisted so a reboot
    // answers at once; an enrolled face also re-reads it at most every five minutes with a
    // conditional GET (a 304 costs nothing). A flip changes what the face advertises — never what
    // presents (an adopt of the same content is not a boundary).
    private val switchIo = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-switch").apply { isDaemon = true } }
    private val switchValues = HashMap<Int, Boolean?>()
    private val switchLearnedAt = HashMap<Int, Long>()
    private val switchEtags = HashMap<Int, String>()

    @Synchronized private fun switchValue(ctx: Context, face: Int): Boolean? {
        if (!switchValues.containsKey(face)) {
            switchValues[face] = runCatching {
                when (ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("switch.$face", null)) {
                    "true" -> true
                    "false" -> false
                    else -> null
                }
            }.getOrNull()
        }
        return switchValues[face]
    }

    @Synchronized private fun learnSwitch(ctx: Context, face: Int, value: Boolean?) {
        switchLearnedAt[face] = SystemClock.elapsedRealtime()
        if (switchValues.containsKey(face) && switchValues[face] == value) return
        switchValues[face] = value
        runCatching { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("switch.$face", value?.toString() ?: "").apply() }
        PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_SWITCH face=$face manifest=${value ?: "absent"}")
    }

    private fun maybeRefreshSwitch(host: SharedVideoHost) {
        val face = host.face
        synchronized(this) {
            val now = SystemClock.elapsedRealtime()
            val at = switchLearnedAt[face]
            if (at != null && now - at < SWITCH_REFRESH_MS) return
            if (!switchRefreshing.add(face)) return
            // A failed read is retried after a minute, not on every poll; a good one stamps `now` (learnSwitch).
            switchLearnedAt[face] = now - SWITCH_REFRESH_MS + SWITCH_RETRY_MS
        }
        // Its own thread: a slow read never delays a session's selection or decoder preparation (meta).
        switchIo.execute {
            try {
                val screen = NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(host.ctx, face)) ?: return@execute
                val (manifest, etag) = SharedVideoSource(host.ctx).manifestIfChanged(face, screen, synchronized(this) { switchEtags[face] })
                synchronized(this) { if (etag != null) switchEtags[face] = etag }
                if (manifest == null) { synchronized(this) { switchLearnedAt[face] = SystemClock.elapsedRealtime() }; return@execute }
                learnSwitch(host.ctx, face, FaceVideoDescriptor.nativeFirstOf(manifest.optJSONObject("nativeVideo")))
            } catch (e: Exception) {
                PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_SWITCH face=$face read=${FaceVideoReasons.code(e, "failed")}")
            } finally {
                synchronized(this) { switchRefreshing.remove(face) }
            }
        }
    }

    /**
     * Every `sharedVideoState` poll (SharedVideoHost.stateJson). It renews the
     * live document's lease. A live document that polls WITHOUT having adopted
     * a presenting v4 session for [PlaybackSessionPolicy.ADOPT_GRACE_MS] is not
     * its controller (a page that does not speak v4): that session is released
     * (`document-retired`) and its intent discarded — it must never cover a
     * page that cannot see it. A page that does not poll at all is dead, and
     * the session continues unattended.
     */
    @Synchronized fun onStatePoll(host: SharedVideoHost) {
        if (hosts[host.face] !== host) return
        val now = SystemClock.elapsedRealtime()
        val lease = leases[host.face] ?: return
        if (lease.renew(now)) {
            unadoptedSince.remove(host.face)
            if (unattendedFaces.remove(host.face)) PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_ATTENDED face=${host.face}")
            return
        }
        val presenting = host.faceSessions.values.filter { it.alive && it.v4 }
        if (presenting.isEmpty()) { unadoptedSince.remove(host.face); return }
        val since = unadoptedSince.getOrPut(host.face) { now }
        if (now - since < PlaybackSessionPolicy.ADOPT_GRACE_MS) return
        unadoptedSince.remove(host.face)
        if (PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.UNADOPTED) == PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT) {
            PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_FIRST_UNADOPTED face=${host.face} afterMs=${now - since}")
            intents(host.ctx).put(host.face, null)
            presenting.forEach { stopSession(host, it, "document-retired") }
        }
    }

    /**
     * The v4 blocks of the `sharedVideoState` reply (§3.5, §6): `lease`,
     * `intent`, `intentRejected`, `store`, `nativeFirst`. Written only where
     * the face advertises 4 or holds v4 state, so the dark fleet's replies are
     * unchanged byte for byte.
     */
    fun writeNativeFirst(host: SharedVideoHost, j: JSONObject, protocolMax: Int, policy: DeviceClassPolicy.Resolved) {
        val wrote = synchronized(this) {
            val face = host.face
            val now = SystemClock.elapsedRealtime()
            val intent = intentsMemo?.get(face) ?: if (protocolMax >= 4) intents(host.ctx).get(face) else null
            val rejected = rejections[face]
            if (protocolMax < 4 && intent == null && rejected == null) return
            val lease = leases[face]
            val live = lease?.live(now) == true
            j.put("lease", JSONObject().put("id", lease?.id ?: JSONObject.NULL).put("live", live)
                .put("ageMs", lease?.ageMs(now) ?: -1L).put("unattended", intent != null && !live))
            j.put("intent", if (intent == null) JSONObject.NULL else intentJson(host, intent))
            j.put("intentRejected", rejected ?: JSONObject.NULL)
            j.put("nativeFirst", JSONObject().put("enabled", protocolMax >= 4)
                .put("manifest", switchValue(host.ctx, face) ?: JSONObject.NULL).put("classDefault", policy.nativeFirstDefault))
            true
        }
        // The store answers OUTSIDE this monitor (its own locks never nest inside ours).
        if (wrote) j.put("store", runCatching { ContentStorePort.store.stateBlock() }.getOrNull() ?: NoopContentStore.stateBlock())
    }

    /** Under the monitor: the intent as the page reads it, with what the app is doing about it. */
    private fun intentJson(host: SharedVideoHost, intent: PlaybackIntent): JSONObject {
        val session = listOfNotNull(host.faceSessions[""], host.faceSessions[NEXT]).firstOrNull { it.identity == intent.identity }
        val status = when {
            intent.suspendedByHold -> "suspended-by-hold"
            session?.alive == true -> if (session.key == NEXT) "pre-rolling" else session.state
            else -> "ended"
        }
        return JSONObject().put("screenId", intent.screenId).put("revision", intent.revision).put("sha256", intent.sha256)
            .put("assetId", intent.assetId).put("start", intent.start.wire).put("atMs", intent.atMs)
            .put("status", status).put("lastEnd", session?.takeIf { !it.alive }?.reason ?: JSONObject.NULL)
            .put("settled", transientEnds.settled(TransientEndTracker.key(host.face, intent.sha256)))
    }

    /** Faces holding a native intent with NO live page lease, and since when (§7 E4: the alert watch speeds up). */
    @Synchronized fun unattendedSince(now: Long): Map<Int, Long> {
        val ints = intentsMemo ?: return emptyMap()
        val out = HashMap<Int, Long>()
        for ((face, lease) in leases) if (ints.get(face) != null) lease.absentSince(now)?.let { out[face] = it }
        return out
    }

    /**
     * §4.4 proof without a page: what each face's native solo is presenting,
     * for the status heartbeat (`x-venueos-native-presenting`). Codes and a
     * digest prefix only. Null when nothing presents.
     */
    @Synchronized fun presentingReport(): String? {
        val now = SystemClock.elapsedRealtime()
        val faces = JSONArray()
        for (h in hosts.values) {
            val s = h.faceSessions[""]?.takeIf { it.alive && it.state == "presenting" } ?: continue
            faces.put(JSONObject().put("face", h.face).put("sha8", s.sha256.take(8)).put("uniqueFrames", s.unique)
                .put("ageMs", if (s.lastStamp > 0) ((System.nanoTime() - s.lastStamp) / 1_000_000).coerceIn(0, 86_400_000) else -1L)
                .put("v4", s.v4).put("unattended", s.v4 && leases[h.face]?.live(now) != true))
        }
        return if (faces.length() == 0) null else JSONObject().put("v", 1).put("faces", faces).toString()
    }

    /**
     * Under the monitor: [host]'s face just lost its lease (a document change,
     * a renderer loss). The `webview-invisible` experiment's fault guard keys on
     * this lapse (§7 E2): the WebView is VISIBLE again at once and the
     * experiment is off for the process. The native alert watch is kicked so its
     * fast cadence starts now (§7 E4).
     */
    private fun leaseLapsed(host: SharedVideoHost, now: Long) {
        val face = host.face
        if (intentsMemo?.get(face) == null) return
        host.faceSessions.values.filter { it.webHidden }.forEach { s ->
            s.webHidden = false
            main.post { if (host.web.visibility != View.VISIBLE) host.web.visibility = View.VISIBLE }
            if (experiments.ended(NativeVideoExperiments.WEBVIEW_INVISIBLE, "page-lease-expired"))
                PlayerLogger.w("FaceVideoBox", "PLAYER_NATIVE_VIDEO_EXPERIMENT face=$face name=webviewInvisible disabled=page-lease-expired")
        }
        if (unattendedFaces.add(face)) {
            PlayerLogger.i("FaceVideoBox", "PLAYER_NATIVE_FIRST_UNATTENDED face=$face sinceMs=${leases[face]?.absentSince(now) ?: now}")
            val ctx = host.ctx
            main.post { NativeAlertWatch.kick(ctx, "no page holds a live lease (face $face)") }
        }
        armLeaseTick(host.ctx)
    }

    /** Under the monitor: while any face holds an intent, a 2 s tick notices a lease that lapsed by silence. */
    private fun armLeaseTick(ctx: Context) {
        if (leaseTickArmed) return
        leaseTickArmed = true
        main.postDelayed({ leaseTick(ctx.applicationContext) }, LEASE_TICK_MS)
    }

    private fun leaseTick(ctx: Context) {
        synchronized(this) {
            leaseTickArmed = false
            val now = SystemClock.elapsedRealtime()
            val absent = unattendedSince(now).keys
            for (face in absent) if (face !in unattendedFaces) hosts[face]?.let { leaseLapsed(it, now) }
            unattendedFaces.retainAll(absent)
            if ((intentsMemo != null) && leases.keys.any { intentsMemo?.get(it) != null }) armLeaseTick(ctx)
        }
    }

    private const val PREFS = "native_first"

    /** The intents' storage: one key per face in app-private SharedPreferences, written with `commit()`. */
    private class PrefsIntentStore(private val ctx: Context) : IntentStore {
        override fun read(face: Int): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("intent.$face", null)
        override fun write(face: Int, value: String?): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply { if (value == null) remove("intent.$face") else putString("intent.$face", value) }.commit()
    }

    private class PrefsKv(private val ctx: Context, private val key: String) : NativeFaultBlocks.Kv {
        override fun get(): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null)
        override fun put(value: String) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, value).apply() }
    }
}

/** What a v4 session does at its next loop end (FaceVideoRenderer.freezeAtLapEnd). */
internal enum class LapAction { NONE, SWAP, RELEASE }
