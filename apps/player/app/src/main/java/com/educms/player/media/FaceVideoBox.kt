package com.educms.player.media

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.face.FaceTokenStore
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** One face's protocol-2 session. Mutable fields are guarded by the FaceVideoBox monitor. */
internal class FaceVideoSession(val id: String, val request: FaceVideoRequest) {
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
}

/**
 * Protocol-2 ownership: one INDEPENDENT session per face (FaceVideoPolicy.kt
 * has the why). Network, hashing and codec work never run while holding this
 * monitor, and this monitor never calls into SharedVideoBox while held.
 *
 * Safety properties, each enforced here and not by the page:
 *  • native plays only what THIS face's own authenticated manifest selected,
 *    and only from a file whose length and SHA-256 were verified on disk;
 *  • nothing starts while an emergency hold is in force, and a hold (or the
 *    1 s watch noticing one) stops every face at once — the WebView, which
 *    is always ABOVE the surface, then shows the alert;
 *  • a page that stops polling (10 s lease), a credential that changes
 *    identity, a detached surface or 8 s without a rendered frame retires
 *    the session and restores the opaque WebView background.
 */
internal object FaceVideoBox {
    private val main = Handler(Looper.getMainLooper())
    private val meta = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-meta").apply { isDaemon = true } }
    private val downloads = Executors.newSingleThreadExecutor { r -> Thread(r, "face-video-download").apply { isDaemon = true } }
    private val hosts = mutableMapOf<Int, SharedVideoHost>()
    const val NAMESPACE = "native-video-v2"

    @Synchronized fun attach(host: SharedVideoHost) {
        hosts[host.face]?.let { old -> old.face2?.let { stopSession(old, it, "host-replaced") } }
        hosts[host.face] = host
    }
    @Synchronized fun detach(host: SharedVideoHost) {
        host.face2?.let { stopSession(host, it, "host-detached") }
        if (hosts[host.face] === host) hosts.remove(host.face)
    }
    @Synchronized fun anyActive(): Boolean = hosts.values.any { h -> h.face2?.alive == true }
    @Synchronized fun invalidate(host: SharedVideoHost, why: String) { host.face2?.let { stopSession(host, it, why) } }
    @Synchronized fun suppress(why: String) { hosts.values.forEach { h -> h.face2?.let { stopSession(h, it, why) } } }

    private fun live(host: SharedVideoHost, s: FaceVideoSession): Boolean =
        s.alive && hosts[host.face] === host && !host.detached && host.face2 === s

    fun prepare(host: SharedVideoHost, json: String) {
        val req = FaceVideoRequest.parse(json) ?: return
        val session: FaceVideoSession
        synchronized(this) {
            if (hosts[host.face] !== host || host.detached) return
            val existing = host.face2
            if (existing != null && existing.alive && existing.request == req) return
            if (existing != null) stopSession(host, existing, "content-changed")
            session = FaceVideoSession(UUID.randomUUID().toString(), req)
            host.face2 = session
            host.engine = SharedVideoHost.ENGINE_FACE
            if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, session, "emergency-held"); return }
        }
        // The pair engine and this one never share a face (outside our monitor — lock order).
        SharedVideoBox.suppress("engine-switched")
        main.postDelayed({ watch(host, session) }, 1000)
        meta.execute {
            try {
                val source = SharedVideoSource(host.ctx)
                val d = FaceVideoDescriptor.parse(source.manifest(host.face, req.screenId).getJSONObject("nativeVideo"))
                require(d.faceIndex == host.face && d.matches(req)) { "selection-changed" }
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
            val fresh = FaceVideoDescriptor.parse(source.manifest(host.face, d.screenId).getJSONObject("nativeVideo"))
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
        hosts.values.any { h -> h.face2?.let { it.alive && it.request.sha256 == sha } == true }

    @Synchronized private fun pinned(): Set<String> =
        hosts.values.mapNotNull { h -> h.face2?.takeIf { it.alive }?.request?.sha256 }.toSet()

    /** UI thread. The container is black (the letterbox of `contain`) and sits directly below the WebView. */
    private fun attachSurface(host: SharedVideoHost, s: FaceVideoSession) {
        val d: FaceVideoDescriptor
        synchronized(this) { if (!live(host, s)) return; d = s.descriptor ?: return }
        val parent = host.web.parent as? ViewGroup
        if (parent == null || parent.width <= 0 || parent.height <= 0) {
            synchronized(this) { if (live(host, s)) stopSession(host, s, "output-unavailable") }; return
        }
        val degrees = SharedVideoTransform.degrees(d.orientation, 0, parent.width, parent.height)
        val r = FaceVideoPolicy.frame(d.fit, d.width, d.height, degrees, parent.width, parent.height)
        val container = host.faceContainer
        if (container.parent == null) {
            container.setBackgroundColor(Color.BLACK)
            parent.addView(container, parent.indexOfChild(host.web).coerceAtLeast(0), ViewGroup.LayoutParams(-1, -1))
        }
        val lp = FrameLayout.LayoutParams(r[2], r[3]).apply { leftMargin = r[0]; topMargin = r[1] }
        if (host.faceSurface.parent == null) {
            host.faceSurface.setZOrderOnTop(false)
            container.addView(host.faceSurface, lp)
        } else host.faceSurface.layoutParams = lp
        synchronized(this) { if (!live(host, s)) return; s.attached = true; s.degrees = degrees }
        surfaceReady(host)
    }

    /** Surface created/changed (UI thread). Prepares the renderer once the surface is real. */
    fun surfaceReady(host: SharedVideoHost) {
        val s: FaceVideoSession; val file: File; val d: FaceVideoDescriptor
        synchronized(this) {
            s = host.face2 ?: return
            if (!live(host, s) || !s.attached || s.preparingRenderer || s.renderer != null) return
            file = s.file ?: return; d = s.descriptor ?: return
            val sv = host.faceSurface
            if (!sv.holder.surface.isValid || sv.width <= 0 || sv.height <= 0) return
            if (!host.web.isHardwareAccelerated) { stopSession(host, s, "output-unavailable"); return }
            s.preparingRenderer = true
        }
        val r = FaceVideoRenderer(file, d, host.faceSurface.holder.surface, s.degrees, { s.alive && !host.detached },
            failed = { why -> synchronized(this) { if (live(host, s)) stopSession(host, s, why) } },
            rendered = { nanos, pts -> synchronized(this) { if (live(host, s)) updated(host, s, nanos, pts) } },
            looped = { synchronized(this) { if (live(host, s)) s.loops++ } },
            dropped = { synchronized(this) { if (live(host, s)) s.drops++ } })
        meta.execute {
            try {
                r.prepare()
                synchronized(this) {
                    if (!live(host, s)) { r.stop(); return@execute }
                    val elsewhere = hosts.values.count { h -> h !== host && h.face2?.let { it.alive && it.renderer != null } == true }
                    if (!FaceVideoPolicy.decoderAllowed(elsewhere, r.advertisedInstances)) {
                        stopSession(host, s, "decoder-budget"); return@execute
                    }
                    s.renderer = r; s.codecName = r.codecName; s.state = "ready"
                }
            } catch (e: Exception) {
                synchronized(this) { if (live(host, s)) stopSession(host, s, FaceVideoReasons.code(e, "native-prepare")) }
            }
        }
    }

    @Synchronized fun commit(host: SharedVideoHost, id: String) {
        val s = host.face2 ?: return
        if (!live(host, s) || s.id != id || s.state != "ready") return
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

    @Synchronized fun stop(host: SharedVideoHost, id: String) {
        val s = host.face2 ?: return
        if (s.id == id && s.alive) stopSession(host, s, "page-stopped")
    }

    private fun updated(host: SharedVideoHost, s: FaceVideoSession, stamp: Long, pts: Long) {
        if (s.startedAt == 0L) return
        if (!host.faceSurface.holder.surface.isValid || !host.faceSurface.isShown) return
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
            val screen = s.descriptor?.screenId ?: s.request.screenId
            val why = when {
                DisplayEmergency.isHeld(host.ctx) -> "emergency-held"
                NativeAlertWatchPolicy.screenIdOf(FaceTokenStore.read(host.ctx, host.face)) != screen -> "credential-identity"
                s.attached && (!host.faceSurface.isAttachedToWindow || !host.web.isAttachedToWindow) -> "output-detached"
                now - s.lastPoll > 10_000 -> "page-lease-expired"
                s.startedAt > 0 && now - maxOf(s.startedAt, s.lastUpdate) > 8000 -> "output-stalled"
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
        s.renderer?.stop(); s.renderer = null
        s.state = "failed"; s.reason = why
        main.post {
            synchronized(this) {
                val cur = host.face2
                if (cur != null && cur.alive && cur.attached) return@post
                host.web.setBackgroundColor(Color.BLACK)
                (host.faceSurface.parent as? ViewGroup)?.removeView(host.faceSurface)
                (host.faceContainer.parent as? ViewGroup)?.removeView(host.faceContainer)
            }
        }
    }

    @Synchronized fun state(host: SharedVideoHost): JSONObject {
        val s = host.face2 ?: return JSONObject().put("version", 1).put("state", "idle")
        s.lastPoll = SystemClock.elapsedRealtime()
        val sv = host.faceSurface
        val output = JSONObject().put("attached", s.attached && !host.detached && sv.isAttachedToWindow)
            .put("visible", s.attached && !host.detached && sv.isShown && sv.windowVisibility == View.VISIBLE)
            .put("hardwareAccelerated", host.web.isHardwareAccelerated)
            .put("viewUpdates", s.updates).put("uniqueFrames", s.unique).put("sourcePtsUs", s.ptsUs)
            .put("width", sv.width).put("height", sv.height).put("lastUpdateElapsedMs", s.lastUpdate)
            .put("ageMs", if (s.lastStamp > 0) ((System.nanoTime() - s.lastStamp) / 1_000_000).coerceIn(0, 86_400_000) else 86_400_000)
        val reason = s.reason ?: if (s.caching && s.state == "preparing") "caching" else null
        return JSONObject().put("version", 1).put("state", s.state).put("sessionId", s.id)
            .put("revision", s.request.revision).put("sha256", s.request.sha256)
            .put("faceIndex", host.face).put("reason", reason ?: JSONObject.NULL).put("output", output)
            .put("codecName", s.codecName ?: JSONObject.NULL).put("loops", s.loops).put("drops", s.drops)
            .put("elapsedMs", if (s.startedAt > 0) SystemClock.elapsedRealtime() - s.startedAt else 0)
            .put("stalls", if (s.reason == "output-stalled") 1 else 0)
    }
}
