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
import android.webkit.WebView
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.face.FaceTokenStore
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** Activity/Presentation-owned adapter. No JS-supplied face index or credential is accepted. */
class SharedVideoHost private constructor(internal val face: Int, internal val web: WebView) {
    internal val ctx: Context = web.context.applicationContext
    internal val texture = SurfaceView(web.context)
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
    internal var swapMaxMs = 0L
    internal var codecName: String? = null
    internal var loops = 0L
    internal var startedAt = 0L
    internal val stamps = LinkedHashMap<Long,Long>()
    internal var detached = false

    fun prepare(json: String) = SharedVideoBox.prepare(this,json)
    fun commit(id: String) = SharedVideoBox.commit(this,id)
    fun stop(id: String) = SharedVideoBox.stop(this,id)
    fun stateJson(): String = SharedVideoBox.state(this)
    fun invalidate() = SharedVideoBox.invalidate(this,"document-retired")
    fun detach() {
        SharedVideoBox.invalidate(this,"host-detached")
        synchronized(SharedVideoBox) { detached = true }
        (texture.parent as? ViewGroup)?.removeView(texture)
        SharedVideoBox.detach(this)
    }

    companion object {
        /** Called on UI thread, including renderer replacement. Surface stays below the WebView. */
        fun attach(face: Int, web: WebView): SharedVideoHost {
            val host = SharedVideoHost(face,web)
            SharedVideoBox.attach(host)
            val parent = web.parent as? ViewGroup
            if (parent == null || face !in 0..1) { host.detached = true; return host }
            // No default-fleet surface allocation. Attach only after authenticated descriptors agree.
            host.texture.holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) { SharedVideoBox.surfaceReady() }
                override fun surfaceChanged(holder: SurfaceHolder,format: Int,w: Int,h: Int) { SharedVideoBox.surfaceReady() }
                override fun surfaceDestroyed(holder: SurfaceHolder) { if (host.attached) host.invalidate() }
            })
            return host
        }
        /** Called by the native hold path; it never releases or changes an emergency hold. */
        fun suppressForEmergency() = SharedVideoBox.suppress("emergency-held")
        fun suspendAll() = SharedVideoBox.suppress("activity-paused")
    }
}

/** Serialized box ownership. Network/codec work never runs while holding this monitor. */
internal object SharedVideoBox {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r,"shared-video-source").apply { isDaemon = true } }
    private val hosts = mutableMapOf<Int,SharedVideoHost>()
    private var renderer: SharedVideoRenderer? = null
    private var id: String? = null
    private var gate: SharedVideoCommitGate? = null
    private var epoch = 0L
    private var allocating = false

    @Synchronized fun attach(host: SharedVideoHost) {
        hosts[host.face]?.let { old ->
            stopAll("host-replaced")
            old.detached = true
            (old.texture.parent as? ViewGroup)?.removeView(old.texture)
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

    fun prepare(host: SharedVideoHost,json: String) {
        val req = runCatching {
            require(json.length <= 1024)
            val j = JSONObject(json); require(j.getInt("version") == 1)
            Triple(j.getString("screenId"),j.getString("revision"),j.getString("sha256"))
        }.getOrNull() ?: return
        val generation: Long
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached || DisplayEmergency.isHeld(host.ctx)) return
            if (req == host.request && host.state in setOf("preparing","ready","presenting")) return
            if (id != null) stopAll("content-changed")
            host.request = req; host.descriptor = null; host.reportRevision = req.second; host.reportSha = req.third; host.sessionId = UUID.randomUUID().toString(); host.state = "preparing"; host.reason = null
            host.lastPoll = SystemClock.elapsedRealtime(); generation = host.generation
        }
        io.execute {
            try {
                val d = SharedVideoSource(host.ctx).descriptor(host.face,req.first)
                require(d.revision == req.second && d.sha256 == req.third) { "selection-changed" }
                synchronized(this) {
                    if (!valid(host,generation,req)) return@execute
                    host.descriptor = d
                    joinIfReady()
                }
            } catch (_: Exception) {
                synchronized(this) { if (valid(host,generation,req)) stopAll("authorization-failed") }
            }
        }
    }

    private fun valid(host: SharedVideoHost,generation: Long,request: Triple<String,String,String>) =
        hosts[host.face] === host && !host.detached && host.generation == generation && host.request == request && host.state == "preparing"

    /** Called under monitor; dispatches output snapshot to UI before any decoder allocation. */
    private fun joinIfReady() {
        if (id != null) return
        val a = hosts[0] ?: return; val b = hosts[1] ?: return
        val da = a.descriptor ?: return; val db = b.descriptor ?: return
        if (a.state != "preparing" || b.state != "preparing") return
        if (!da.agrees(db)) { stopAll("descriptor-disagreement"); return }
        val session = UUID.randomUUID().toString(); id = session; val e = ++epoch
        gate = SharedVideoCommitGate(session,setOf(0,1))
        listOf(a,b).forEach {
            it.sessionId = session; it.updates = 0; it.unique = 0; it.ptsUs = 0; it.lastStamp = 0
            it.lastUpdate = 0; it.swapMaxMs = 0; it.loops = 0; it.stamps.clear(); it.startedAt = 0
        }
        main.post {
            if (!current(e,session)) return@post
            listOf(a,b).forEach { h ->
                if (!h.attached) {
                    val parent = h.web.parent as? ViewGroup
                    if (parent == null) { synchronized(this) { stopAll("output-detached") }; return@post }
                    h.texture.setZOrderOnTop(false)
                    parent.addView(h.texture,parent.indexOfChild(h.web),ViewGroup.LayoutParams(-1,-1))
                    h.attached = true
                }
            }
            prepareSurfaces(e,session,a,b,da)
            main.postDelayed({ watch(e,session) },1000)
        }
    }

    fun surfaceReady() {
        main.post { synchronized(this) {
            val session = id ?: return@post
            val a = hosts[0] ?: return@post; val b = hosts[1] ?: return@post
            val da = a.descriptor ?: return@post
            prepareSurfaces(epoch,session,a,b,da)
        } }
    }

    private fun prepareSurfaces(e: Long,session: String,a: SharedVideoHost,b: SharedVideoHost,da: SharedVideoDescriptor) {
            if (!current(e,session) || allocating) return
            if (listOf(a,b).any { !it.texture.holder.surface.isValid || it.texture.width <= 0 || it.texture.height <= 0 }) return
            allocating = true
            val outputList = listOf(a,b).map { h ->
                val s = h.texture.holder.surface
                if (!s.isValid || h.texture.width <= 0 || h.texture.height <= 0 || !h.web.isHardwareAccelerated) {
                    synchronized(this) { if (current(e,session)) stopAll("output-unavailable") }; return
                }
                SharedVideoRenderer.Output(s,h.texture.width,h.texture.height,h.descriptor!!) { stamp,pts,_ ->
                    synchronized(this) { if (current(e,session)) updated(h,stamp,pts) }
                }
            }
            io.execute {
                try {
                    val file = SharedVideoSource(a.ctx).verifiedFile(da) { current(e,session) }
                    if (!current(e,session)) return@execute
                    // Re-prove BOTH credentials/selections after a potentially long download.
                    val freshA = SharedVideoSource(a.ctx).descriptor(a.face,da.screenId)
                    val freshB = SharedVideoSource(b.ctx).descriptor(b.face,b.descriptor?.screenId ?: error("peer-retired"))
                    require(freshA == da && freshB == b.descriptor && freshA.agrees(freshB)) { "selection-changed" }
                    if (!current(e,session)) return@execute
                    val r = SharedVideoRenderer(file,da,outputList,{ current(e,session) },
                        ready = { synchronized(this) { if (current(e,session)) {
                            a.state = "ready"; b.state = "ready"
                        } } },
                        failed = { why -> synchronized(this) { if (current(e,session)) stopAll(why) } },
                        codecInfo = { face,name -> synchronized(this) { if (current(e,session)) hosts[face]?.codecName = name } },
                        looped = { face -> synchronized(this) { if (current(e,session)) hosts[face]?.let { it.loops++ } } })
                    synchronized(this) { if (!current(e,session)) { r.stop(); return@execute }; renderer = r }
                    r.prepare()
                } catch (_: Exception) { synchronized(this) { if (current(e,session)) stopAll("source-failed") } }
            }
    }

    @Synchronized private fun current(e: Long,session: String): Boolean = epoch == e && id == session

    @Synchronized fun commit(host: SharedVideoHost,session: String) {
        if (hosts[host.face] !== host || session != id || host.sessionId != session || host.state != "ready") return
        if (DisplayEmergency.isHeld(host.ctx)) { stopAll("emergency-held"); return }
        if (gate?.commit(host.face,session) != true) return
        val e = epoch
        main.post {
            synchronized(this) {
                if (!current(e,session) || DisplayEmergency.isHeld(host.ctx)) return@post
                hosts.values.filter { it.sessionId == session }.forEach {
                    it.web.setBackgroundColor(Color.TRANSPARENT)
                    it.startedAt = SystemClock.elapsedRealtime()
                }
                renderer?.start()
            }
        }
    }

    @Synchronized fun updated(host: SharedVideoHost,stamp: Long,pts: Long) {
        if (host.sessionId != id || id == null || host.startedAt == 0L || hosts[host.face] !== host) return
        if (!host.texture.holder.surface.isValid || !host.texture.isShown) return
        if (!SharedVideoCodecPolicy.validRenderStamp(stamp,pts)) return
        host.updates++
        if (stamp != host.lastStamp) { host.unique++; host.lastStamp = stamp; host.ptsUs = pts }
        host.lastUpdate = SystemClock.elapsedRealtime()
        host.state = "presenting"
    }

    @Synchronized fun stop(host: SharedVideoHost,session: String) {
        if (hosts[host.face] === host && host.sessionId == session) stopAll("peer-stopped")
    }

    private fun watch(e: Long,session: String) {
        synchronized(this) {
            if (!current(e,session)) return
            val now = SystemClock.elapsedRealtime()
            for (h in hosts.values.filter { it.sessionId == session }) {
                val sid = NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(h.ctx,h.face))
                val why = when {
                    DisplayEmergency.isHeld(h.ctx) -> "emergency-held"
                    sid != h.descriptor?.screenId -> "credential-identity"
                    h.detached || !h.texture.isAttachedToWindow || !h.web.isAttachedToWindow -> "output-detached"
                    now-h.lastPoll > 10_000 -> "page-lease-expired"
                    h.startedAt > 0 && now-maxOf(h.startedAt,h.lastUpdate) > 8000 -> "output-stalled"
                    else -> null
                }
                if (why != null) { stopAll(why); return }
            }
        }
        main.postDelayed({ watch(e,session) },1000)
    }

    @Synchronized fun state(host: SharedVideoHost): String {
        host.lastPoll = SystemClock.elapsedRealtime()
        val output = JSONObject().put("attached",!host.detached && host.texture.isAttachedToWindow)
            .put("visible",!host.detached && host.texture.isShown && host.texture.windowVisibility == View.VISIBLE)
            .put("hardwareAccelerated",host.web.isHardwareAccelerated)
            .put("viewUpdates",host.updates).put("uniqueFrames",host.unique).put("sourcePtsUs",host.ptsUs)
            .put("width",host.texture.width).put("height",host.texture.height).put("lastUpdateElapsedMs",host.lastUpdate)
            .put("swapMaxMs",host.swapMaxMs)
            .put("ageMs",if (host.lastStamp > 0) ((System.nanoTime()-host.lastStamp)/1_000_000).coerceIn(0,86_400_000) else 86_400_000)
        return JSONObject().put("version",1).put("state",host.state).put("sessionId",host.sessionId ?: JSONObject.NULL)
            .put("revision",host.reportRevision ?: JSONObject.NULL).put("sha256",host.reportSha ?: JSONObject.NULL)
            .put("faceIndex",host.face).put("reason",host.reason ?: JSONObject.NULL).put("output",output)
            .put("codecName",host.codecName ?: JSONObject.NULL).put("loops",host.loops)
            .put("elapsedMs",if (host.startedAt > 0) SystemClock.elapsedRealtime()-host.startedAt else 0)
            .put("stalls",if (host.reason == "output-stalled") 1 else 0).toString()
    }

    /** Invalidate first, then stop asynchronously. The native layer can never cover the WebView. */
    private fun stopAll(why: String) {
        epoch++; id = null; gate = null; allocating = false
        val old = renderer; renderer = null; old?.stop()
        hosts.values.forEach { h ->
            h.generation++
            h.request = null; h.descriptor = null
            if (h.state != "idle") { h.state = "failed"; h.reason = why }
            h.stamps.clear()
            main.post { if (h.state == "failed" || h.state == "idle") {
                h.web.setBackgroundColor(Color.BLACK)
                if (h.attached) { h.attached = false; (h.texture.parent as? ViewGroup)?.removeView(h.texture) }
            } }
        }
    }
}
