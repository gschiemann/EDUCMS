package com.educms.player.media

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.SurfaceView
import android.view.SurfaceHolder
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import android.webkit.WebView
import android.widget.FrameLayout
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.face.FaceTokenStore
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.util.UUID

/** Activity/Presentation-owned adapter. No JS-supplied face index or credential is accepted. */
class SharedVideoHost private constructor(internal val face: Int, internal val web: WebView, private val operatorUiClear: () -> Boolean, private val foreground: (() -> Boolean)?, private val focusRequired: Boolean,
    /** The Window this face's WebView lives in (the Activity's, or a face Presentation's): experiment 5 asks it for a display mode, the runtime report reads its KEEP_SCREEN_ON flag. UI thread. */
    internal val window: () -> Window?) {
    internal val ctx: Context = web.context.applicationContext
    internal val surfaceView = SurfaceView(web.context)
    internal var attached = false
    internal var generation = 0L
    internal var state = "idle"
    internal var reason: String? = null
    internal var request: Triple<String,String,String>? = null
    internal var descriptor: SharedVideoDescriptor? = null
    internal var reportRevision: String? = null
    internal var reportSha: String? = null
    internal var sessionId: String? = null
    internal var lastPoll = SystemClock.elapsedRealtime()
    internal var updates = 0L
    internal var unique = 0L
    internal var ptsUs = 0L
    internal var lastUpdate = 0L
    internal var lastStamp = 0L
    internal var codecName: String? = null
    internal var loops = 0L
    internal var startedAt = 0L
    @Volatile internal var detached = false

    // -- Protocol 2/3: this face's own independent sessions (FaceVideoBox) --
    /** By slot: "" is the protocol-2 solo; `item:<id>` / `zone:<id>` are protocol-3 slots. Guarded by FaceVideoBox. */
    internal val faceSessions = LinkedHashMap<String, FaceVideoSession>()
    /** Which engine this face last used: the one `sharedVideoState` reports. */
    @Volatile internal var engine = ENGINE_SHARED
    @Volatile private var operatorUiRequested = false
    private val readiness = NativeVideoReadiness()
    internal val lifecycleReady: Boolean get() = foreground == null || readiness.snapshot.ready
    /** View/window properties are observed only on the UI thread. No bridge wait or lock inversion. */
    fun refreshReadiness() {
        if (foreground == null) return
        if (Looper.myLooper() != Looper.getMainLooper()) { web.post { refreshReadiness() }; return }
        val interactive = (ctx.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager)?.isInteractive == true
        readiness.observe(!detached && foreground.invoke(), interactive, web.hasWindowFocus(), operatorUiClear(), focusRequired)
    }
    internal fun canOwnWindow(): Boolean {
        refreshReadiness()
        return !operatorUiRequested && lifecycleReady && operatorUiClear()
    }
    private val windowGuard = ViewTreeObserver.OnPreDrawListener {
        if (!canOwnWindow()) FaceVideoBox.yieldToUi(this, "page-stopped")
        true
    }
    /** Native escape does not depend on the page handling the key promptly. */
    fun yieldToUi() { operatorUiRequested = true; FaceVideoBox.yieldToUi(this, "page-stopped") }

    /** The page decided again (a v2 prepare, a v4 intend): the operator latch is cleared, exactly as a v2 prepare always did. */
    internal fun clearOperatorUi() { operatorUiRequested = false }

    /**
     * `version: 4` (native-first: an `op` of intend / release / sync — the app
     * owns the session), `version: 3` (an op on a positioned slot) and
     * `version: 2` (the solo) select the per-face engine; anything else is the
     * protocol-1 pair engine, unchanged. No bridge method was added (rule 9).
     */
    fun prepare(json: String) {
        NativeFirstMessage.parse(json)?.let { FaceVideoBox.onV4(this, it); return }
        // A malformed version-4 message is dropped, never handed to the pair engine.
        if (runCatching { json.length <= 1024 && JSONObject(json).optInt("version") == NativeFirstMessage.VERSION }.getOrDefault(false)) return
        when (val m = FaceZoneMessage.parse(json)) {
            is FaceZoneMessage.Prepare -> FaceVideoBox.prepare(this, m.request)
            is FaceZoneMessage.Layout -> FaceVideoBox.layout(this, m.sessionId, m.layout)
            is FaceZoneMessage.Play -> FaceVideoBox.play(this, m.sessionId)
            null -> if (FaceVideoRequest.parse(json) != null) { operatorUiRequested = false; FaceVideoBox.prepare(this,json) }
                else if (!FaceVideoBox.anyActive()) { engine = ENGINE_SHARED; SharedVideoBox.prepare(this,json) }
        }
    }
    fun commit(id: String) = if (engine == ENGINE_FACE) FaceVideoBox.commit(this,id) else SharedVideoBox.commit(this,id)
    fun stop(id: String) = if (engine == ENGINE_FACE) FaceVideoBox.stop(this,id) else SharedVideoBox.stop(this,id)
    /**
     * Always carries `protocol: 2` (independent per-face sessions) exactly as
     * 1.1.29 did, so an older web bundle sees what it saw; `protocolMax: 3`
     * and `sessions[]` (FaceVideoBox.state) prove the positioned-slot engine.
     */
    fun stateJson(): String {
        refreshReadiness()
        // Native-first (§4.1): every poll renews this document's lease — the page's liveness, never a
        // condition for presenting.
        FaceVideoBox.onStatePoll(this)
        val policy = DeviceClassPolicy.current(ctx)
        val max = FaceVideoBox.protocolMax(this, policy)
        val j = if (engine == ENGINE_FACE) FaceVideoBox.state(this) else JSONObject(SharedVideoBox.state(this)).put("protocolMax", max)
        // 1.1.41: the resolved device class and what it does (DeviceClassPolicy), bounded, on every reply.
        j.put("device", policy.toJson())
        // 1.1.42: plus what the default display runs and offers, read live (a mode switch shows when it happens).
        DeviceClassPolicy.displayFacts(ctx)?.writeTo(j.getJSONObject("device"))
        // 1.1.43: plus what the panel firmware itself lists (sysfs, read-only, bounded, refreshed every 30 s).
        DeviceClassPolicy.sysDisplayFacts().writeTo(j.getJSONObject("device"))
        if (foreground != null) {
            val s = readiness.snapshot
            j.put("availability", JSONObject().put("version", 1).put("foreground", s.foreground)
                .put("interactive", s.interactive).put("focused", s.focused).put("focusRequired", s.focusRequired).put("uiClear", s.uiClear)
                .put("ready", s.ready).put("epoch", s.epoch))
        }
        // Protocol 4's blocks (lease, intent, store, nativeFirst) — only where this face advertises 4 or holds v4 state.
        FaceVideoBox.writeNativeFirst(this, j, max, policy)
        com.educms.player.display.EmergencyPaintRecovery.challenge(ctx, face)?.let { j.put("emergencyProof", it) }
        // The page refuses a reply over 16 384 characters: trim history before it could ever get there.
        return ReplyBudget.fit(j.put("protocol",2)).toString()
    }
    fun invalidate() { SharedVideoBox.invalidate(this,"document-retired"); FaceVideoBox.invalidate(this,"document-retired") }
    fun detach() {
        com.educms.player.display.EmergencyPaintRecovery.unregister(face, web)
        if (web.viewTreeObserver.isAlive) web.viewTreeObserver.removeOnPreDrawListener(windowGuard)
        SharedVideoBox.invalidate(this,"host-detached")
        synchronized(SharedVideoBox) { detached = true }
        (surfaceView.parent as? ViewGroup)?.removeView(surfaceView)
        SharedVideoBox.detach(this)
        FaceVideoBox.detach(this)
    }

    companion object {
        /** Called on UI thread, including renderer replacement. Surface stays below the WebView. */
        fun attach(face: Int, web: WebView, foreground: (() -> Boolean)? = null, focusRequired: Boolean = true, window: () -> Window? = { null }, operatorUiClear: () -> Boolean = { false }): SharedVideoHost {
            val host = SharedVideoHost(face,web,operatorUiClear,foreground,focusRequired,window)
            host.refreshReadiness()
            SharedVideoBox.attach(host)
            FaceVideoBox.attach(host)
            web.viewTreeObserver.addOnPreDrawListener(host.windowGuard)
            val parent = web.parent as? ViewGroup
            if (parent == null || face !in 0..1) { host.detached = true; return host }
            // No default-fleet surface allocation. Attach only after authenticated descriptors agree.
            host.surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) { SharedVideoBox.surfaceReady() }
                override fun surfaceChanged(holder: SurfaceHolder,format: Int,w: Int,h: Int) { SharedVideoBox.surfaceReady() }
                override fun surfaceDestroyed(holder: SurfaceHolder) { if (host.attached) host.invalidate() }
            })
            // Per-face sessions (FaceVideoBox) create their own SurfaceViews, each with its own holder callback.
            return host
        }
        /** Called by the native hold path; it never releases or changes an emergency hold. */
        fun suppressForEmergency() {
            SharedVideoBox.suppress("emergency-held")
            FaceVideoBox.suppress("emergency-held")
            FaceVideoBox.clearEmergencySurfaces()
        }
        fun suspendAll() { SharedVideoBox.suppress("activity-paused"); FaceVideoBox.suppress("activity-paused") }
        internal const val ENGINE_SHARED = "shared"
        internal const val ENGINE_FACE = "face"
    }
}

/**
 * The protocol-1 PAIR engine's ownership (one mirrored file on both faces of
 * a DH43, the 1.1.25–1.1.28 field path). Since 1.1.41 it REFUSES every
 * request: it drew its surfaces beneath the WebView and needed the WebView
 * transparent, which is the mechanism behind every white and hazy screen,
 * and the WebView is now opaque black in every state (one compositing
 * contract — SoloVideoLayer.kt). A page that still asks for protocol 1 reads
 * `failed` + `composition-unavailable` and keeps its own player; its state,
 * stop and emergency paths keep answering exactly as before. The per-face
 * engine (FaceVideoBox, protocol 2) is the one native path.
 */
internal object SharedVideoBox {
    private val main = Handler(Looper.getMainLooper())
    private val hosts = mutableMapOf<Int,SharedVideoHost>()
    private var id: String? = null

    @Synchronized fun attach(host: SharedVideoHost) {
        hosts[host.face]?.let { old ->
            stopAll("host-replaced")
            old.detached = true
            (old.surfaceView.parent as? ViewGroup)?.removeView(old.surfaceView)
        }
        hosts[host.face] = host
    }
    @Synchronized fun detach(host: SharedVideoHost) { if (hosts[host.face] === host) hosts.remove(host.face) }
    @Synchronized fun invalidate(host: SharedVideoHost, why: String) {
        if (hosts[host.face] !== host) return
        host.generation++
        stopAll(why)
        host.request = null; host.descriptor = null
    }
    @Synchronized fun suppress(why: String) { if (id != null || hosts.values.any { it.state == "preparing" }) stopAll(why) }

    /** A well-formed protocol-1 request is answered `failed` + `composition-unavailable` before any network, surface or decoder. */
    fun prepare(host: SharedVideoHost,json: String) {
        val req = runCatching {
            require(json.length <= 1024)
            val j = JSONObject(json); require(j.getInt("version") == 1)
            Triple(j.getString("screenId"),j.getString("revision"),j.getString("sha256"))
        }.getOrNull() ?: return
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return
            if (id != null) stopAll("content-changed")
            host.request = null; host.descriptor = null; host.reportRevision = req.second; host.reportSha = req.third
            host.sessionId = UUID.randomUUID().toString(); host.state = "failed"; host.reason = SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE
            host.lastPoll = SystemClock.elapsedRealtime()
        }
        PlayerLogger.i("SharedVideoBox", "PLAYER_NATIVE_VIDEO_STOP face=${host.face} proto=1 reason=${SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE} layer=under_window sha=${req.third.take(8)}")
    }

    /** The host's own SurfaceView never carries a session any more; nothing to prepare. */
    fun surfaceReady() {}

    /** No pair session can be ready, so a commit changes nothing; the WebView stays opaque black. */
    @Synchronized fun commit(host: SharedVideoHost,session: String) {
        if (hosts[host.face] !== host || session != id || host.sessionId != session || host.state != "ready") return
        if (DisplayEmergency.isHeld(host.ctx)) { stopAll("emergency-held"); return }
    }

    @Synchronized fun stop(host: SharedVideoHost,session: String) {
        if (hosts[host.face] === host && host.sessionId == session) stopAll("peer-stopped")
    }

    @Synchronized fun state(host: SharedVideoHost): String {
        host.lastPoll = SystemClock.elapsedRealtime()
        val output = JSONObject().put("attached",!host.detached && host.surfaceView.isAttachedToWindow)
            .put("visible",!host.detached && host.surfaceView.isShown && host.surfaceView.windowVisibility == View.VISIBLE)
            .put("hardwareAccelerated",host.web.isHardwareAccelerated)
            .put("viewUpdates",host.updates).put("uniqueFrames",host.unique).put("sourcePtsUs",host.ptsUs)
            .put("width",host.surfaceView.width).put("height",host.surfaceView.height).put("lastUpdateElapsedMs",host.lastUpdate)
            .put("ageMs",if (host.lastStamp > 0) ((System.nanoTime()-host.lastStamp)/1_000_000).coerceIn(0,86_400_000) else 86_400_000)
        return JSONObject().put("version",1).put("state",host.state).put("sessionId",host.sessionId ?: JSONObject.NULL)
            .put("revision",host.reportRevision ?: JSONObject.NULL).put("sha256",host.reportSha ?: JSONObject.NULL)
            .put("faceIndex",host.face).put("reason",host.reason ?: JSONObject.NULL).put("output",output)
            .put("codecName",host.codecName ?: JSONObject.NULL).put("loops",host.loops)
            .put("elapsedMs",if (host.startedAt > 0) SystemClock.elapsedRealtime()-host.startedAt else 0)
            .put("stalls",if (host.reason == "output-stalled") 1 else 0).toString()
    }

    /** Invalidate first; the view work happens on the UI thread. The WebView is opaque black in every state. */
    private fun stopAll(why: String) {
        id = null
        hosts.values.forEach { h ->
            h.generation++
            h.request = null; h.descriptor = null
            if (h.state != "idle") { h.state = "failed"; h.reason = why }
            main.post { if (h.state == "failed" || h.state == "idle") {
                h.web.setBackgroundColor(Color.BLACK)
                if (h.attached) { h.attached = false; (h.surfaceView.parent as? ViewGroup)?.removeView(h.surfaceView) }
            } }
        }
    }
}
