package com.educms.player.display

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import com.educms.player.MainActivity
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.media.SharedVideoHost
import com.educms.player.ota.RelaunchEscalation
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.UUID

/** One persisted, face-bound ladder for page, native-watch and cached-manifest raises. */
object EmergencyPaintRecovery {
    private const val KEY = "emergency_paint_recovery_v1"
    private val lock = Any()
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private var loaded = false
    private val episodes = mutableMapOf<Int, EmergencyPaintPolicy.Episode>()
    private data class Host(val web: WeakReference<WebView>, val reload: () -> Unit, val relaunch: () -> Unit)
    private val hosts = mutableMapOf<Int, Host>()
    private val pending = mutableMapOf<Int, Runnable>()

    fun register(ctx: Context, face: Int, web: WebView, reload: () -> Unit, relaunch: () -> Unit) {
        synchronized(lock) {
            hosts[face] = Host(WeakReference(web), reload, relaunch)
        }
        if (face in DisplayEmergency.holdingFaces(ctx)) raised(ctx, face)
    }

    fun unregister(face: Int, web: WebView) {
        synchronized(lock) { if (hosts[face]?.web?.get() === web) hosts.remove(face) }
    }

    /** Called BEFORE fallible display enforcement. Repeated raises never reset the deadline/budget. */
    fun raised(ctx: Context, face: Int) = safely {
        val app = ctx.applicationContext
        synchronized(lock) {
            load(app)
            if (episodes[face] == null) {
                val e = EmergencyPaintPolicy.Episode(UUID.randomUUID().toString(), System.currentTimeMillis(), SystemClock.elapsedRealtime())
                episodes[face] = EmergencyPaintPolicy.event(e, 0, e.heldAtMs, "pending")
                save(app)
                marker(face, "raised", 0)
                prompt(app)
            }
            schedule(app, face)
        }
    }

    fun released(ctx: Context, face: Int) = safely {
        synchronized(lock) {
            load(ctx)
            episodes.remove(face)
            pending.remove(face)?.let(main::removeCallbacks)
            save(ctx)
        }
    }

    /** New renderer/document invalidates the prior challenge; consumed attempts remain consumed. */
    fun documentStarted(ctx: Context, face: Int) = safely {
        synchronized(lock) {
            load(ctx)
            val e = episodes[face] ?: return@synchronized
            episodes[face] = EmergencyPaintPolicy.documentStarted(e, UUID.randomUUID().toString(), SystemClock.elapsedRealtime())
            save(ctx)
            schedule(ctx.applicationContext, face)
        }
    }

    /** Additive field on an EXISTING face-bound bridge reply; never a new method. */
    fun challenge(ctx: Context, face: Int): JSONObject? = synchronized(lock) {
        load(ctx)
        if (face !in DisplayEmergency.holdingFaces(ctx)) null
        else episodes[face]?.let { JSONObject().put("challenge", it.challenge) }
    }

    /** Existing heartbeatV2 carries the page's actual overlay paint receipt. */
    fun painted(ctx: Context, face: Int, raw: String) = safely {
        if (raw.length > 1024) return@safely
        val json = JSONObject(raw)
        if (json.opt("painted") == false) {
            val identity = json.opt("identity") as? String ?: return@safely
            if (!identity.matches(Regex("[A-Za-z0-9._:-]{1,64}"))) return@safely
            synchronized(lock) {
                load(ctx)
                val e = episodes[face] ?: return@synchronized
                if (e.identity == identity) return@synchronized
                episodes[face] = EmergencyPaintPolicy.announce(e, identity, UUID.randomUUID().toString(),
                    System.currentTimeMillis(), SystemClock.elapsedRealtime())
                // Changed identity is a NEW alert; repeats of the same alert never refill the budget.
                if (e.identity != null) pending.remove(face)?.let(main::removeCallbacks)
                save(ctx)
                schedule(ctx.applicationContext, face)
                prompt(ctx)
            }
            return@safely
        }
        val frames = (json.opt("frames") as? Number)?.toDouble()?.takeIf {
            it.isFinite() && it % 1.0 == 0.0 && it >= 2 && it <= 9_007_199_254_740_991.0
        }?.toLong()
        // View properties are read on the UI looper, never on JavaBridge/channel's thread.
        main.post {
            safely receipt@ {
                if (face !in DisplayEmergency.holdingFaces(ctx)) return@receipt
                val host = synchronized(lock) { hosts[face] } ?: return@receipt
                val web = host.web.get() ?: return@receipt
                val visible = web.isAttachedToWindow && web.isShown && web.visibility == View.VISIBLE && web.alpha >= .99f &&
                    web.width > 0 && web.height > 0 && web.background?.alpha == 255
                val nativeClear = com.educms.player.media.FaceVideoBox.emergencyOutputClear(face)
                val interactive = (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive == true
                synchronized(lock) {
                    load(ctx)
                    val e = episodes[face] ?: return@synchronized
                    if (e.status == "painted" || json.opt("painted") != true || !EmergencyPaintPolicy.accepts(e, json.opt("challenge") as? String,
                            json.opt("identity") as? String, json.opt("documentId") as? String, frames,
                            visible, interactive, MainActivity.isInForeground, nativeClear)) return@synchronized
                    episodes[face] = EmergencyPaintPolicy.event(e, e.step, System.currentTimeMillis(), "painted")
                        .copy(status = "painted", identity = json.getString("identity"), documentId = json.getString("documentId"),
                            paintedAtMs = SystemClock.elapsedRealtime())
                    pending.remove(face)?.let(main::removeCallbacks)
                    save(ctx)
                    marker(face, "painted", e.step)
                    prompt(ctx)
                }
            }
        }
    }

    /** Bounded history rides the existing authenticated native status report, including dead pages. */
    fun report(ctx: Context): JSONObject? = synchronized(lock) {
        load(ctx)
        val active = episodes.filterKeys { it in DisplayEmergency.holdingFaces(ctx) }
        if (active.isEmpty()) null else JSONObject().put("faces", JSONArray().also { a ->
            active.toSortedMap().forEach { (face, e) -> a.put(json(face, e, wire = true)) }
        })
    }

    /** The native watch may confirm only paint, never the page's hold/liveness message. */
    fun paintedAtMs(face: Int): Long? = synchronized(lock) { episodes[face]?.paintedAtMs }

    /** Preserve the older watch backstop AFTER this ladder, with durable per-alert aggregate bounds. */
    fun consumeLegacyAttempt(ctx: Context, face: Int?, launch: Boolean): Boolean = runCatching {
        synchronized(lock) {
            load(ctx)
            val selected = face ?: episodes.keys.sorted().firstOrNull() ?: return@synchronized false
            val e = episodes[selected] ?: return@synchronized false
            if (!EmergencyPaintPolicy.legacyAllowed(e, SystemClock.elapsedRealtime(), launch)) return@synchronized false
            episodes[selected] = if (launch) e.copy(legacyLaunches = e.legacyLaunches + 1)
                else e.copy(legacyReloads = e.legacyReloads + 1)
            save(ctx)
            true
        }
    }.getOrDefault(false)

    private fun schedule(app: Context, face: Int) {
        val e = episodes[face] ?: return
        if (e.status != "pending" || pending.containsKey(face)) return
        val due = if (e.step < 4) EmergencyPaintPolicy.STEP_AT_MS[e.step] else EmergencyPaintPolicy.FINISH_AT_MS
        val r = Runnable { safely { tick(app, face) } }
        pending[face] = r
        main.postDelayed(r, (e.startedAtMs + due - SystemClock.elapsedRealtime()).coerceAtLeast(0))
    }

    private fun tick(app: Context, face: Int) {
        val step: Int
        synchronized(lock) {
            pending.remove(face)
            val e = episodes[face] ?: return
            if (face !in DisplayEmergency.holdingFaces(app)) { released(app, face); return }
            val now = SystemClock.elapsedRealtime()
            val next = EmergencyPaintPolicy.next(e, now)
            if (next == null) {
                if (EmergencyPaintPolicy.finished(e, now)) {
                    episodes[face] = EmergencyPaintPolicy.event(e, e.step, System.currentTimeMillis(), "unconfirmed").copy(status = "unconfirmed")
                    save(app)
                    marker(face, "unconfirmed", e.step)
                    prompt(app)
                } else schedule(app, face)
                return
            }
            step = next
            // Commit the consumed attempt BEFORE any Activity recreation or page navigation.
            episodes[face] = EmergencyPaintPolicy.event(e, step, System.currentTimeMillis(), "started")
            save(app)
            marker(face, "escalation", step)
            prompt(app)
            schedule(app, face)
        }
        val host = synchronized(lock) { hosts[face] }
        if (face !in DisplayEmergency.holdingFaces(app)) return
        // An OEM provider can block in a binder/kernel call. Its wake never owns the UI deadline.
        runCatching {
            EmergencyPaintPolicy.dispatch(step,
                reassert = {
                    runCatching { SharedVideoHost.suppressForEmergency() }
                    Thread({ safely {
                        if (face in DisplayEmergency.holdingFaces(app)) DisplayEmergency.enforceNow(app)
                    } }, "emergency-paint-wake").apply { isDaemon = true; start() }
                }, show = {
                    val web = host?.web?.get() ?: error("no-webview")
                    web.onResume()
                    web.resumeTimers()
                    web.visibility = View.VISIBLE
                    web.alpha = 1f
                    web.setBackgroundColor(Color.BLACK)
                    web.bringToFront()
                    web.requestLayout()
                    web.invalidate()
                }, reload = { (host?.reload ?: error("no-page-host"))() },
                relaunch = { if (host != null) host.relaunch() else { RelaunchEscalation.launchNow(app, "emergency-paint"); Unit } })
        }.onFailure {
            synchronized(lock) {
                episodes[face]?.let { e ->
                    // One event per attempt; retain the bounded history without an extra retry.
                    episodes[face] = e.copy(events = e.events.map { event ->
                        if (event.step == step && event.outcome == "started") event.copy(outcome = "failed") else event
                    })
                    save(app)
                }
            }
            marker(face, "failed", step)
            prompt(app)
        }
    }

    internal fun json(face: Int, e: EmergencyPaintPolicy.Episode, wire: Boolean = false): JSONObject = JSONObject()
        .put("face", face).put("challenge", e.challenge).put("heldAtMs", e.heldAtMs)
        .put("step", e.step).put("status", e.status)
        .apply {
            e.identity?.let { put("identity", it) }
            e.documentId?.let { put("documentId", it) }
            if (!wire) {
                put("startedAtMs", e.startedAtMs)
                put("legacyReloads", e.legacyReloads)
                put("legacyLaunches", e.legacyLaunches)
            }
        }
        .put("events", JSONArray().also { a -> e.events.forEach {
            a.put(JSONObject().put("step", it.step).put("atMs", it.atMs).put("outcome", it.outcome))
        } })

    private fun load(ctx: Context) {
        if (loaded) return
        loaded = true
        val raw = ctx.applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE).getString(KEY, null) ?: return
        runCatching {
            val a = JSONArray(raw)
            for (i in 0 until minOf(a.length(), 2)) {
                val j = a.getJSONObject(i)
                val face = j.getInt("face")
                if (face !in 0..1) continue
                val events = j.getJSONArray("events")
                val e = EmergencyPaintPolicy.Episode(j.getString("challenge"), j.getLong("heldAtMs"), j.getLong("startedAtMs"),
                    j.getInt("step").coerceIn(0, 4), j.getString("status"),
                    j.opt("identity") as? String, j.opt("documentId") as? String,
                    (0 until minOf(events.length(), EmergencyPaintPolicy.MAX_EVENTS)).map { k -> events.getJSONObject(k).let {
                        EmergencyPaintPolicy.Event(it.getInt("step"), it.getLong("atMs"), it.getString("outcome"))
                    } }, legacyReloads = j.optInt("legacyReloads").coerceIn(0, 3),
                    legacyLaunches = j.optInt("legacyLaunches").coerceIn(0, 6))
                // A reboot cannot certify a fresh document from an old process's paint.
                episodes[face] = e.copy(challenge = UUID.randomUUID().toString(), status = "pending", identity = null,
                    documentId = null, startedAtMs = SystemClock.elapsedRealtime())
            }
        }.onFailure { PlayerLogger.w("EmergencyPaint", "persisted paint evidence unreadable") }
    }

    private fun save(ctx: Context) {
        val a = JSONArray()
        episodes.toSortedMap().forEach { (face, e) -> a.put(json(face, e)) }
        if (!ctx.applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE).edit().putString(KEY, a.toString()).commit())
            PlayerLogger.e("EmergencyPaint", "paint recovery evidence could not be persisted")
    }
    private fun marker(face: Int, outcome: String, step: Int) {
        PlayerLogger.durable("ERROR", "EmergencyPaint", "PLAYER_EMERGENCY_ENFORCE_STEP step=paint-$outcome face=$face attempt=$step — alert raised; " +
            if (outcome == "painted") "page reported overlay paint" else "no on-glass proof")
    }
    private fun prompt(ctx: Context) { runCatching { HeartbeatService.requestPromptTick(ctx.applicationContext, "emergency-paint") } }
    private inline fun safely(body: () -> Unit) { runCatching(body).onFailure { PlayerLogger.w("EmergencyPaint", "paint recovery failed: ${it.javaClass.simpleName}") } }
}
