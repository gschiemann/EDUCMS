package com.educms.player.media

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.face.FaceTokenStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * One face's native session. Protocol 2 = the solo slot "" (full face, loops,
 * plays as soon as it is committed). Protocol 3 = a positioned slot
 * (`item:<id>` / `zone:<id>`): committed into a HELD first frame on a surface
 * parked off-screen, moved onto its rect and released on `play`.
 * Mutable fields are guarded by the FaceVideoBox monitor; views are touched on
 * the UI thread only.
 */
internal class FaceVideoSession(val id: String, val request: FaceVideoRequest?, val zone: FaceZoneRequest?) {
    val slot: String = zone?.slot ?: ""
    val protocol: Int = if (zone != null) 3 else 2
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
    // Views, created on the UI thread when the surface is attached; in the tree only while this session runs.
    var container: FrameLayout? = null
    var box: FrameLayout? = null
    var surface: SurfaceView? = null
}

/**
 * Protocol-2/3 ownership: INDEPENDENT sessions per face (FaceVideoPolicy.kt
 * has the why). Network, hashing and codec work never run while holding this
 * monitor, and this monitor never calls into SharedVideoBox while held.
 *
 * Safety properties, each enforced here and not by the page:
 *  • native plays only what THIS face's own authenticated manifest selected,
 *    and only from a file whose length and SHA-256 were verified on disk;
 *  • nothing starts while an emergency hold is in force, and a hold (or the
 *    1 s watch noticing one) stops every face at once — the WebView, which
 *    is always ABOVE every surface, then shows the alert;
 *  • a page that stops polling (10 s lease), a credential that changes
 *    identity, a detached surface or 8 s without a rendered frame retires
 *    the session and restores the opaque WebView background;
 *  • a pre-rolled slot is never on glass before the page's `play`: its
 *    surface waits entirely outside the WebView's bounds;
 *  • one slot on glass per face region: `play` removes the previous on-glass
 *    session of the same face in the same UI pass that moves the new one in,
 *    so native→native shows no gap and two surfaces never compete for z-order.
 */
internal object FaceVideoBox {
    private val main = Handler(Looper.getMainLooper())
    private val meta = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-meta").apply { isDaemon = true } }
    private val downloads = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-download").apply { isDaemon = true } }
    private val hosts = mutableMapOf<Int, SharedVideoHost>()
    const val NAMESPACE = "native-video-v2"
    const val PROTOCOL_MAX = 3

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

    private fun live(host: SharedVideoHost, s: FaceVideoSession): Boolean =
        s.alive && hosts[host.face] === host && !host.detached && host.faceSessions[s.slot] === s

    private fun byId(host: SharedVideoHost, id: String): FaceVideoSession? = host.faceSessions.values.firstOrNull { it.id == id }

    /** Protocol 2: the solo slot. */
    fun prepare(host: SharedVideoHost, json: String) {
        val req = FaceVideoRequest.parse(json) ?: return
        begin(host, FaceVideoSession(UUID.randomUUID().toString(), req, null)) ?: return
    }

    /** Protocol 3: one positioned slot. */
    fun prepare(host: SharedVideoHost, req: FaceZoneRequest) {
        begin(host, FaceVideoSession(UUID.randomUUID().toString(), null, req)) ?: return
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
            if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, session, "emergency-held"); return null }
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

    /** The rect of this session's black box inside the WebView's parent, as [l, t, w, h]; protocol 2 = the whole face. */
    private fun boxRect(s: FaceVideoSession, parentW: Int, parentH: Int): IntArray {
        val l = s.layout ?: return intArrayOf(0, 0, parentW, parentH)
        val r = FaceZonePolicy.rect(l, parentW, parentH)
        return if (s.onGlass) r else FaceZonePolicy.parked(r, parentW)
    }

    /**
     * UI thread. Three views per session, all below the WebView: a transparent
     * full-size container, a black BOX at the slot's rect (the letterbox of
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
        val rect = boxRect(s, parent.width, parent.height)
        if (rect[2] <= 0 || rect[3] <= 0) {
            synchronized(this) { if (live(host, s)) stopSession(host, s, "output-unavailable") }; return
        }
        val container = s.container ?: FrameLayout(host.web.context).also { s.container = it }
        val box = s.box ?: FrameLayout(host.web.context).also { it.setBackgroundColor(Color.BLACK); s.box = it }
        val surface = s.surface ?: SurfaceView(host.web.context).also { sv ->
            // A SOLO full-screen video (protocol 2) sits ABOVE the page, the
            // way a native signage player (Goodview's CMS) draws it: nothing
            // has to turn transparent, so it shows on every ROM. Field
            // 2026-10-12 VisionCore (Rockchip rk3328, Android 11): behind the
            // page the decoder rendered 29.8 fps, visible=true, while the glass
            // stayed WHITE (the window never turned see-through). Emergency
            // stops native before an alert paints (FaceVideoBox hold + 1 s
            // watch), so nothing the page must show is ever covered. Protocol-3
            // zones stay UNDER the page — widgets draw above them.
            if (s.protocol == 2) sv.setZOrderMediaOverlay(true) else sv.setZOrderOnTop(false)
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
        surfaceReady(host, s)
    }

    /** Surface created/changed (UI thread). Prepares the renderer once the surface is real. */
    fun surfaceReady(host: SharedVideoHost, s: FaceVideoSession) {
        val file: File; val d: FaceVideoDescriptor; val sv: SurfaceView
        synchronized(this) {
            if (!live(host, s) || !s.attached || s.preparingRenderer || s.renderer != null) return
            file = s.file ?: return; d = s.descriptor ?: return
            sv = s.surface ?: return
            if (!sv.holder.surface.isValid || sv.width <= 0 || sv.height <= 0) return
            if (!host.web.isHardwareAccelerated) { stopSession(host, s, "output-unavailable"); return }
            s.preparingRenderer = true
        }
        val r = FaceVideoRenderer(file, d, sv.holder.surface, s.degrees, { s.alive && !host.detached },
            failed = { why -> synchronized(this) { if (live(host, s)) stopSession(host, s, why) } },
            rendered = { nanos, pts -> synchronized(this) { if (live(host, s)) updated(host, s, nanos, pts) } },
            looped = { synchronized(this) { if (live(host, s)) s.loops++ } },
            dropped = { synchronized(this) { if (live(host, s)) s.drops++ } },
            loop = s.loop,
            holdFirst = s.protocol == 3,
            firstFrame = { synchronized(this) { if (live(host, s)) { s.held = true; s.heldAt = SystemClock.elapsedRealtime() } } },
            ended = { synchronized(this) { if (live(host, s)) s.ended = true } })
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

    @Synchronized fun commit(host: SharedVideoHost, id: String) {
        val s = byId(host, id) ?: return
        if (!live(host, s) || s.state != "ready") return
        if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, s, "emergency-held"); return }
        main.post {
            synchronized(this) {
                if (!live(host, s) || DisplayEmergency.isHeld(host.ctx)) return@post
                host.web.setBackgroundColor(Color.TRANSPARENT)
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
        val sv = s.surface ?: return
        if (!sv.holder.surface.isValid || !sv.isShown) return
        if (!SharedVideoCodecPolicy.validRenderStamp(stamp, pts)) return
        s.updates++
        if (stamp != s.lastStamp) { s.unique++; s.lastStamp = stamp; s.ptsUs = pts }
        s.lastUpdate = SystemClock.elapsedRealtime()
        s.state = "presenting"
    }

    private fun watch(host: SharedVideoHost, s: FaceVideoSession) {
        synchronized(this) {
            if (!live(host, s)) return
            val now = SystemClock.elapsedRealtime()
            val screen = s.descriptor?.screenId ?: s.screenId
            val sv = s.surface
            val why = when {
                DisplayEmergency.isHeld(host.ctx) -> "emergency-held"
                NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(host.ctx, host.face)) != screen -> "credential-identity"
                s.attached && (sv == null || !sv.isAttachedToWindow || !host.web.isAttachedToWindow) -> "output-detached"
                now - s.lastPoll > 10_000 -> "page-lease-expired"
                s.held && now - s.heldAt > FaceZonePolicy.HOLD_MAX_MS -> "hold-expired"
                s.startedAt > 0 && !s.held && !s.ended && now - maxOf(s.startedAt, s.lastUpdate) > 8000 -> "output-stalled"
                else -> null
            }
            if (why != null) { stopSession(host, s, why); return }
        }
        main.postDelayed({ watch(host, s) }, 1000)
    }

    /** Called under the monitor. Invalidate first; the view work happens on the UI thread. */
    private fun stopSession(host: SharedVideoHost, s: FaceVideoSession, why: String) {
        if (!s.alive) return
        s.alive = false
        s.stoppedAt = SystemClock.elapsedRealtime()
        s.renderer?.stop(); s.renderer = null
        s.state = "failed"; s.reason = why
        main.post {
            synchronized(this) {
                (s.surface?.parent as? ViewGroup)?.removeView(s.surface)
                (s.box?.parent as? ViewGroup)?.removeView(s.box)
                (s.container?.parent as? ViewGroup)?.removeView(s.container)
                // The WebView goes opaque again only once no live session of this face is attached.
                if (host.faceSessions.values.none { it.alive && it.attached }) host.web.setBackgroundColor(Color.BLACK)
            }
        }
    }

    private fun sessionJson(host: SharedVideoHost, s: FaceVideoSession): JSONObject {
        val sv = s.surface
        val attached = s.attached && !host.detached && sv != null && sv.isAttachedToWindow
        val output = JSONObject().put("attached", attached)
            .put("visible", attached && sv!!.isShown && sv.windowVisibility == View.VISIBLE)
            .put("hardwareAccelerated", host.web.isHardwareAccelerated)
            .put("viewUpdates", s.updates).put("uniqueFrames", s.unique).put("sourcePtsUs", s.ptsUs)
            .put("width", sv?.width ?: 0).put("height", sv?.height ?: 0).put("lastUpdateElapsedMs", s.lastUpdate)
            .put("ageMs", if (s.lastStamp > 0) ((System.nanoTime() - s.lastStamp) / 1_000_000).coerceIn(0, 86_400_000) else 86_400_000)
        val reason = s.reason ?: if (s.caching && s.state == "preparing") "caching" else null
        return JSONObject().put("version", 1).put("state", s.state).put("sessionId", s.id)
            .put("revision", s.revision).put("sha256", s.sha256)
            .put("faceIndex", host.face).put("reason", reason ?: JSONObject.NULL).put("output", output)
            .put("codecName", s.codecName ?: JSONObject.NULL).put("loops", s.loops).put("drops", s.drops)
            .put("elapsedMs", if (s.startedAt > 0) SystemClock.elapsedRealtime() - s.startedAt else 0)
            .put("stalls", if (s.reason == "output-stalled") 1 else 0)
    }

    /**
     * The top level is the protocol-2 solo slot exactly as 1.1.29 reported it
     * (idle when there is none); `sessions[]` lists every slot, each with its
     * `slot`, `held` and `ended`. Every poll renews every session's lease.
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
        return top.put("sessions", sessions).put("protocolMax", PROTOCOL_MAX)
    }
}
