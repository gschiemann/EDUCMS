package com.educms.player.health

import android.app.ActivityManager
import android.app.Application
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import com.educms.player.BuildConfig
import com.educms.player.ProcessExitPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * PROCESS HEALTH (2026-11-09, player stability gaps 1, 4, 8 + thermal) — the
 * thin Android glue around three pure policies:
 *
 *  • memory pressure — [MemoryPressurePolicy], Application-wide
 *    `ComponentCallbacks2`;
 *  • main-thread liveness — [MainThreadStallPolicy], a probe on its own
 *    low-priority `HandlerThread` that posts a no-op to the main looper;
 *  • the previous process's exit — [ExitEvidencePolicy].
 *
 * Everything reaches the server on the SIGNED native heartbeat
 * (`x-venueos-process-health`, [headerValue]) and, for an ANR / native crash,
 * on the existing crash-report route with the device credential
 * ([uploadPendingTraces]). Nothing here reloads the page, restarts the
 * process or touches the display or the emergency path. Never throws.
 *
 * Kill switch: the heartbeat reply's `processHealth: "off"`
 * (`PLAYER_PROCESS_HEALTH=off` on the API) stops the probe's posts, the
 * memory free, the header and the trace uploads. Failure direction: any
 * fault here leaves the player exactly as it was before this file existed.
 */
object ProcessHealth {

    private const val TAG = "ProcessHealth"
    const val PREF_OFF = "process_health_off"
    private const val EXIT_PREFS = "process_exit_diagnostics"
    private const val KEY_EXITS = "exitSummary"
    private const val KEY_PENDING = "pendingTraces"

    @Volatile private var app: Context? = null
    @Volatile private var memRecord = MemoryPressurePolicy.Record()
    @Volatile private var stall = MainThreadStallPolicy.State()
    @Volatile private var answeredAt: Long? = null

    /** Set by MainActivity: drop the player WebView's in-RAM cache. Runs on the main thread. */
    @Volatile var freeRebuildable: (() -> Unit)? = null

    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
    private var probe: Handler? = null
    private val uploader = Executors.newSingleThreadExecutor { r ->
        Thread(r, "process-health-upload").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    }
    @Volatile private var uploading = false

    fun install(application: Application) {
        app = application.applicationContext
        runCatching {
            application.registerComponentCallbacks(object : ComponentCallbacks2 {
                override fun onTrimMemory(level: Int) = onPressure(level)
                @Deprecated("Deprecated in Java")
                override fun onLowMemory() = onPressure(MemoryPressurePolicy.LOW_MEMORY)
                override fun onConfigurationChanged(newConfig: Configuration) {}
            })
        }.onFailure { PlayerLogger.w(TAG, "memory callbacks not registered: ${it.javaClass.simpleName}") }
        runCatching { startProbe() }
            .onFailure { PlayerLogger.w(TAG, "main-thread probe not started: ${it.javaClass.simpleName}") }
    }

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)

    private fun off(): Boolean = app?.let { runCatching { prefs(it).getBoolean(PREF_OFF, false) }.getOrDefault(false) } ?: false

    // ── memory ──────────────────────────────────────────────────────────

    private fun onPressure(level: Int) {
        runCatching {
            val ctx = app ?: return
            val now = SystemClock.elapsedRealtime()
            val held: Boolean? = runCatching { DisplayEmergency.isHeld(ctx) }.getOrNull()
            val record = memRecord
            val action = MemoryPressurePolicy.decide(level, now, record.lastFreeAtMs, held, off())
            if (action == MemoryPressurePolicy.Action.IGNORE) return
            val next = MemoryPressurePolicy.apply(record, level, now, action)
            memRecord = next
            PlayerLogger.w(TAG, MemoryPressurePolicy.line(level, action, next))
            if (action == MemoryPressurePolicy.Action.RECORD_AND_FREE) {
                freeRebuildable?.let { free -> mainHandler.post { runCatching { free() } } }
            }
        }
    }

    // ── main-thread probe ──────────────────────────────────────────────

    private val answer = Runnable { answeredAt = SystemClock.uptimeMillis() }

    private fun startProbe() {
        if (probe != null) return
        val t = HandlerThread("edu-main-probe", android.os.Process.THREAD_PRIORITY_BACKGROUND).also { it.start() }
        val h = Handler(t.looper)
        probe = h
        val tick = object : Runnable {
            override fun run() {
                runCatching { probeTick() }
                h.postDelayed(this, MainThreadStallPolicy.PROBE_INTERVAL_MS)
            }
        }
        h.postDelayed(tick, MainThreadStallPolicy.PROBE_INTERVAL_MS)
    }

    private fun probeTick() {
        if (off()) {
            stall = MainThreadStallPolicy.State(); return
        }
        val now = SystemClock.uptimeMillis()
        val (next, act) = MainThreadStallPolicy.onTick(stall, now, answeredAt)
        var s = next
        if (act.captureStack) {
            val frames = runCatching { Looper.getMainLooper().thread.stackTrace.toList() }.getOrDefault(emptyList())
            s = s.copy(stack = MainThreadStallPolicy.formatStack(frames).ifEmpty { null })
        }
        stall = s
        act.startedMs?.let { PlayerLogger.w(TAG, MainThreadStallPolicy.startLine(it, s.stalls, s.stack)) }
        act.endedMs?.let { PlayerLogger.w(TAG, MainThreadStallPolicy.endLine(it, s.maxStallMs)) }
        if (act.prompt) app?.let { HeartbeatService.requestPromptTick(it, "main-stall") }
        if (act.post) mainHandler.post(answer)
    }

    // ── the heartbeat header ───────────────────────────────────────────

    /** The header body, or null when switched off / unavailable. Lock-free reads only; never waits on the main thread. */
    fun headerValue(ctx: Context): String? = runCatching {
        if (prefs(ctx).getBoolean(PREF_OFF, false)) return null
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val info = am?.let { a -> ActivityManager.MemoryInfo().also { a.getMemoryInfo(it) } }
        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.currentThermalStatus }.getOrNull()
        } else null
        ProcessHealthReport.build(
            mem = memRecord,
            main = stall,
            exits = runCatching { JSONArray(exitPrefs(ctx).getString(KEY_EXITS, "[]")) }.getOrNull(),
            nowElapsedMs = SystemClock.elapsedRealtime(),
            nowUptimeMs = SystemClock.uptimeMillis(),
            rssMb = rssMb(),
            availMb = info?.availMem?.div(1024 * 1024),
            lowMemory = info?.lowMemory,
            thermalStatus = thermal,
        )
    }.getOrNull()

    private fun rssMb(): Long? = runCatching {
        val pages = java.io.File("/proc/self/statm").readText().trim().split(' ')[1].toLong()
        pages * Os.sysconf(OsConstants._SC_PAGESIZE) / (1024 * 1024)
    }.getOrNull()

    /** The heartbeat reply's kill switch; silence changes nothing. */
    fun acceptServerDirective(prefs: SharedPreferences, reply: JSONObject) {
        val off = when (reply.optString("processHealth", "")) { "off" -> true; "on" -> false; else -> return }
        if (prefs.getBoolean(PREF_OFF, false) != off) {
            prefs.edit().putBoolean(PREF_OFF, off).apply()
            PlayerLogger.i(TAG, "server says process health is ${if (off) "OFF" else "on"}")
        }
    }

    // ── the previous process's exit ────────────────────────────────────

    private fun exitPrefs(ctx: Context) = ctx.getSharedPreferences(EXIT_PREFS, Context.MODE_PRIVATE)

    /** Called by ProcessExitDiagnostics at boot with the newly seen kept exits. */
    fun rememberExits(ctx: Context, fresh: List<ExitEvidencePolicy.Exit>) {
        if (fresh.isEmpty()) return
        runCatching {
            val p = exitPrefs(ctx)
            val merged = ExitEvidencePolicy.merge(p.getString(KEY_EXITS, null), fresh)
            val pending = ExitEvidencePolicy.pendingAfter(readPending(p), fresh)
            p.edit().putString(KEY_EXITS, merged.toString())
                .putString(KEY_PENDING, pending.joinToString(",")).apply()
        }.onFailure { PlayerLogger.w(TAG, "exit summary not stored: ${it.javaClass.simpleName}") }
    }

    private fun readPending(p: SharedPreferences): List<Long> =
        p.getString(KEY_PENDING, "").orEmpty().split(',').mapNotNull { it.trim().toLongOrNull() }

    /**
     * After a successful SIGNED heartbeat: post each waiting ANR / native-crash
     * trace once, on a background thread, with the device credential.
     */
    fun uploadPendingTraces(ctx: Context, apiRoot: String, fingerprint: String, token: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val p = exitPrefs(ctx)
        if (readPending(p).isEmpty() || uploading || prefs(ctx).getBoolean(PREF_OFF, false)) return
        if (!HostAllowlist.isApiHost(apiRoot)) return
        uploading = true
        val appCtx = ctx.applicationContext
        uploader.execute {
            try {
                uploadNow(appCtx, p, apiRoot.trimEnd('/'), fingerprint, token)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "exit trace upload failed: ${t.javaClass.simpleName}")
            } finally {
                uploading = false
            }
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.R)
    private fun uploadNow(ctx: Context, p: SharedPreferences, apiRoot: String, fp: String, token: String) {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
        val history = am.getHistoricalProcessExitReasons(ctx.packageName, 0, 16)
        val remaining = readPending(p).toMutableList()
        for (at in readPending(p)) {
            val info = history.firstOrNull { it.timestamp == at }
            if (info == null) { remaining.remove(at); continue } // the OS no longer holds it
            val exit = ExitEvidencePolicy.Exit(info.timestamp, info.reason, info.status, info.importance, info.pss, info.rss, info.description)
            val stack = if (info.reason == ProcessExitPolicy.REASON_ANR) {
                runCatching {
                    info.traceInputStream?.use { s ->
                        val buf = ByteArray(ExitEvidencePolicy.TRACE_READ_CAP)
                        var n = 0
                        while (n < buf.size) { val r = s.read(buf, n, buf.size - n); if (r < 0) break; n += r }
                        ExitEvidencePolicy.mainThreadSection(String(buf, 0, n, Charsets.UTF_8))
                    }
                }.getOrNull()
            } else null
            val body = ExitEvidencePolicy.crashBody(exit, stack, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)
            val code = post("$apiRoot/api/v1/screens/status/$fp/crash-report", token, body.toString())
            PlayerLogger.i(TAG, "PLAYER_EXIT_EVIDENCE posted at=$at reason=${info.reason} trace=${stack != null} http=$code")
            if (ExitEvidencePolicy.acknowledged(code)) remaining.remove(at) else break
        }
        p.edit().putString(KEY_PENDING, remaining.joinToString(",")).apply()
    }

    private fun post(url: String, token: String, json: String): Int = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 10_000
            conn.instanceFollowRedirects = false
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    } catch (_: Throwable) {
        -1
    }
}
