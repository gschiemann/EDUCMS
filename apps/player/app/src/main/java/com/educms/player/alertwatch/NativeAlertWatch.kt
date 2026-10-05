package com.educms.player.alertwatch

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.educms.player.MainActivity
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.RelaunchEscalation
import com.educms.player.security.HostAllowlist
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * THE NATIVE ALERT WATCH — the Android half (2026-10-05, player 1.1.22).
 *
 * The rules are [NativeAlertWatchPolicy], the sequence is
 * [NativeAlertWatchEngine]; this file is only what they cannot be: the
 * screen-off receiver, the wake lock, the HTTP call and the loop.
 *
 * Read [NativeAlertWatchPolicy]'s header for WHY: on the X80 the page made no
 * request for 8.8 hours after its panel was turned off, so a lockdown could
 * not wake it. This asks the manifest from native code while the panel is
 * off, and raises the existing emergency hold when it reports an alert.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT KEEPS IT RUNNING WHILE THE PANEL IS OFF
 * ─────────────────────────────────────────────────────────────────────
 *  • It lives in the process the foreground `HeartbeatService` keeps alive,
 *    and is started from that service. The measured fact this leans on: on
 *    that same X80 the service's own loop reached the API every 60 s all
 *    night — the same ingredients as this one (a coroutine on the IO
 *    dispatcher, `HttpURLConnection`, a partial wake lock held).
 *  • ACTION_SCREEN_OFF takes the PARTIAL wake lock IN THE RECEIVER, before
 *    the loop is even scheduled — a box whose panel is off and that holds no
 *    wake lock is free to suspend, and a suspended box polls nothing. The
 *    lock is timed and re-acquired before every request and every sleep
 *    (same pattern as `UserStandby.acquireCpuLock`), and let go the moment
 *    the panel is on.
 *  • A loop that died or was never started is restarted by the next
 *    screen-off, by the heartbeat loop (every minute) and by the Watchdog
 *    alarm (every ~15 min — the one of the three that can wake a suspended
 *    CPU). [kick] is idempotent and costs one binder call when the panel is
 *    on.
 *
 * ⚠️ RAISE ONLY. The one write this file makes to the emergency interlock is
 * [DisplayEmergency.raiseFromNativeWatch]. It never releases a hold and
 * never treats "no alert" as an all-clear; the page, on a LIVE manifest, is
 * the only thing that releases (CLAUDE.md player rule 11).
 *
 * ⚠️ NO SECOND TOKEN WRITER (player rule 3). The device token is READ from
 * the canonical `edu_player`/`device_token` store exactly as
 * `HeartbeatService` reads it. A screen whose token has expired in the dark
 * gets a 401 here, which is logged as what it is: only the page renews
 * credentials.
 */
object NativeAlertWatch {

    private const val TAG = "NativeAlertWatch"
    private const val PREFS = "edu_player"
    private const val KEY_API_ROOT = "api_root"

    /** THE canonical native token key — the one `HeartbeatService` and the OTA worker read. */
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val CPU_LOCK_TAG = "educms:alert-watch"

    /**
     * What the watch needs from the Activity: its reload path, and when a
     * page load last started. MainActivity registers one and holds it as a
     * field; the reference here is weak, like `DisplayWindowBridge`'s hooks.
     */
    interface PageHost {
        /** Reload [face]'s page through the Activity's own reload path. Any thread. */
        fun reloadPage(face: Int, why: String)

        /** `elapsedRealtime` when [face]'s page last STARTED a load; 0 = unknown. */
        fun pageLoadStartedAtMs(face: Int): Long
    }

    private val lock = Any()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Wakes a sleeping loop: the panel changed state, or somebody kicked. */
    private val poke = Channel<Unit>(Channel.CONFLATED)

    @Volatile private var receiverRegistered = false
    private var running = false
    private var kicked = false
    private var cpuLock: PowerManager.WakeLock? = null

    @Volatile private var pageHostRef: WeakReference<PageHost>? = null

    /**
     * Aborts a request that outlives [NativeAlertWatchPolicy.REQUEST_BUDGET_MS].
     * One daemon thread that exists only while the watch is polling.
     */
    private val requestKiller = ScheduledThreadPoolExecutor(1) { r ->
        Thread(r, "alert-watch-deadline").apply { isDaemon = true }
    }.apply {
        setKeepAliveTime(30, TimeUnit.SECONDS)
        allowCoreThreadTimeOut(true)
        removeOnCancelPolicy = true
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    // The CPU first: the broadcast's own wake lock ends when
                    // this method returns, and the loop has not run yet.
                    acquireCpuLock(context.applicationContext)
                    kick(context, "the panel went off")
                }
                Intent.ACTION_SCREEN_ON -> kick(context, "the panel came on")
                else -> Unit
            }
        }
    }

    // ─── wiring ──────────────────────────────────────────────────────

    /**
     * Called from `HeartbeatService.onCreate` (and, as a belt, from
     * `PlayerApp.onCreate`). Idempotent. ACTION_SCREEN_OFF / ON reach only a
     * runtime-registered receiver, and the APPLICATION context is the one
     * that lives as long as the process.
     */
    fun ensureStarted(ctx: Context) {
        val app = ctx.applicationContext
        val register = synchronized(lock) {
            if (receiverRegistered) {
                false
            } else {
                receiverRegistered = true
                true
            }
        }
        if (register) {
            runCatching {
                val filter = IntentFilter().apply {
                    addAction(Intent.ACTION_SCREEN_OFF)
                    addAction(Intent.ACTION_SCREEN_ON)
                }
                // Both are PROTECTED system broadcasts — only the system can
                // send them — so EXPORTED grants nothing to other apps.
                ContextCompat.registerReceiver(app, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
                PlayerLogger.i(TAG, "native alert watch installed — it polls the manifest only while the panel is off")
            }.onFailure {
                receiverRegistered = false
                PlayerLogger.e(TAG, "could not register the screen on/off receiver for the native alert watch", it)
            }
        }
        // A process that starts while the panel is already off (an OOM kill,
        // an OTA in the night) gets no screen-off broadcast.
        kick(app, "service start")
    }

    /**
     * Make sure the loop is running if it has anything to do, and wake it if
     * it is asleep. Safe from any thread, cheap, never throws.
     */
    fun kick(ctx: Context, why: String) {
        runCatching {
            val app = ctx.applicationContext
            val start = synchronized(lock) {
                kicked = true
                if (running) {
                    false
                } else {
                    running = true
                    true
                }
            }
            if (start) {
                scope.launch { runLoop(app, why) }
            } else {
                poke.trySend(Unit)
            }
        }.onFailure { PlayerLogger.w(TAG, "native alert watch kick ($why) failed: ${it.message}") }
    }

    fun setPageHost(host: PageHost) {
        pageHostRef = WeakReference(host)
    }

    fun clearPageHost(host: PageHost) {
        if (pageHostRef?.get() === host) pageHostRef = null
    }

    // ─── the loop ────────────────────────────────────────────────────

    /** One engine for the life of the process: what it knows about an alert outlives a dark period. */
    @Volatile private var engine: NativeAlertWatchEngine? = null

    private fun engineFor(app: Context): NativeAlertWatchEngine =
        engine ?: NativeAlertWatchEngine(AndroidPorts(app)).also { engine = it }

    private suspend fun runLoop(app: Context, why: String) {
        var leftCleanly = false
        try {
            val machine = engineFor(app)
            while (true) {
                synchronized(lock) { kicked = false }
                val sleepMs = try {
                    machine.pass()
                } catch (ce: CancellationException) {
                    throw ce
                } catch (t: Throwable) {
                    // A bug in a pass must not end the watch for the night.
                    PlayerLogger.e(TAG, "native alert watch pass failed — trying again", t)
                    NativeAlertWatchPolicy.POLL_INTERVAL_MS
                }
                if (sleepMs == null) {
                    // Nothing to watch. Leave only if nobody kicked while
                    // this pass was running — a screen-off that lands in
                    // that gap must not be lost.
                    val leave = synchronized(lock) {
                        if (kicked) {
                            false
                        } else {
                            running = false
                            true
                        }
                    }
                    if (leave) {
                        leftCleanly = true
                        return
                    }
                    continue
                }
                withTimeoutOrNull(sleepMs) { poke.receive() }
            }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            PlayerLogger.e(TAG, "native alert watch loop ($why) ended unexpectedly — the next kick restarts it", t)
        } finally {
            // A clean leave cleared `running` under the lock, and its last
            // pass already settled the CPU lock; touching either here could
            // undo a loop that has started since. Only a loop that DIED
            // tidies up — and the wake lock is timed either way.
            if (!leftCleanly) {
                releaseCpuLock()
                synchronized(lock) { running = false }
            }
        }
    }

    // ─── the ports ───────────────────────────────────────────────────

    private class AndroidPorts(private val app: Context) : NativeAlertWatchEngine.Ports {

        override fun nowMs(): Long = SystemClock.elapsedRealtime()

        /**
         * Fails toward "off": an unreadable power state must not be able to
         * stand the watch down. The cost of being wrong that way is a few
         * extra polls; the other way it is an alert nobody sees.
         */
        override fun panelInteractive(): Boolean = runCatching {
            (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
        }.getOrNull() ?: false

        override fun plan(): NativeAlertWatchEngine.WatchPlan {
            val prefs = runCatching { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }.getOrNull()
            val targets = ArrayList<WatchTarget>()
            if (prefs != null) {
                // The canonical primary store — READ ONLY (player rule 3).
                //
                // ⚠️ PRIMARY ONLY (1.1.22). A double-sided unit's back side has
                // its own screen row and its own manifest, and is NOT watched
                // here: an alert scoped to the back side alone cannot wake the
                // unit while its panel is off. A tenant-wide alert, or one that
                // includes the front, does. The policy and the engine are
                // already per-face; what is missing is this list and a reload
                // path for a face.
                NativeAlertWatchPolicy.targetOf(
                    DisplayEmergency.PRIMARY_FACE,
                    runCatching { prefs.getString(KEY_DEVICE_TOKEN, null) }.getOrNull(),
                )?.let { targets.add(it) }
            }
            // The facts only — whether they add up to "may poll" is
            // NativeAlertWatchPolicy.pollRefusal's decision, not this file's.
            val allowed = apiRoot()
            return NativeAlertWatchEngine.WatchPlan(
                apiRoot = allowed ?: rawApiRoot(),
                apiRootAllowed = allowed != null,
                targets = targets,
            )
        }

        private fun rawApiRoot(): String? = runCatching {
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_API_ROOT, null)
        }.getOrNull()

        /**
         * The API root the page bootstrapped, re-validated at the point of
         * USE: the device credential is sent to it. Null = absent or not an
         * allowed VenueOS API host.
         */
        private fun apiRoot(): String? {
            val saved = rawApiRoot()?.trim()?.trimEnd('/')?.removeSuffix("/api/v1") ?: return null
            if (saved.isEmpty()) return null
            return saved.takeIf { HostAllowlist.isApiHost(it) }
        }

        override fun fetchManifest(target: WatchTarget, ifNoneMatch: String?): PollOutcome {
            val root = apiRoot() ?: return PollOutcome(httpStatus = null, sentEtag = ifNoneMatch, error = "no-api-root")
            val live = AtomicReference<HttpURLConnection?>(null)
            val startedAt = SystemClock.elapsedRealtime()
            // The hard bound on the whole exchange: closing the connection is
            // the one thing that unblocks a read that is stuck in the kernel.
            val killer = requestKiller.schedule(
                Runnable { runCatching { live.get()?.disconnect() } },
                NativeAlertWatchPolicy.REQUEST_BUDGET_MS,
                TimeUnit.MILLISECONDS,
            )
            return try {
                val url = URL("$root/api/v1/screens/${target.screenId}/manifest")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = NativeAlertWatchPolicy.CONNECT_TIMEOUT_MS
                    readTimeout = NativeAlertWatchPolicy.READ_TIMEOUT_MS
                    useCaches = false
                    // A redirect is not a manifest, and the credential must
                    // never follow one to another host.
                    instanceFollowRedirects = false
                    setRequestProperty("Authorization", "Bearer ${target.token}")
                    setRequestProperty("Accept", "application/json")
                    if (ifNoneMatch != null) setRequestProperty("If-None-Match", ifNoneMatch)
                    // No User-Agent override: the platform's own (Dalvik/…) is
                    // what every native call from this app already sends.
                }
                live.set(conn)
                when (val code = conn.responseCode) {
                    200 -> {
                        val etag = conn.getHeaderField("ETag")
                        val scan = conn.inputStream.use { body ->
                            ManifestAlertScanner.scan(
                                DeadlineInputStream(
                                    body,
                                    startedAt + NativeAlertWatchPolicy.REQUEST_BUDGET_MS,
                                ) { SystemClock.elapsedRealtime() },
                                NativeAlertWatchPolicy.MAX_BODY_BYTES,
                            )
                        }
                        PollOutcome(httpStatus = 200, scan = scan, etag = etag, sentEtag = ifNoneMatch)
                    }
                    else -> PollOutcome(httpStatus = code, sentEtag = ifNoneMatch)
                }
            } catch (t: Throwable) {
                // The class name only: a message can carry a URL.
                PollOutcome(httpStatus = null, sentEtag = ifNoneMatch, error = t.javaClass.simpleName)
            } finally {
                killer.cancel(false)
                runCatching { live.get()?.disconnect() }
            }
        }

        override fun holdHeld(): Boolean = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(false)

        override fun pageRaisedAtMs(face: Int): Long? = DisplayEmergency.pageRaisedAtMs(face)

        override fun raise(face: Int, firstForThisAlert: Boolean) {
            runCatching { DisplayEmergency.raiseFromNativeWatch(app, face, firstForThisAlert) }
                .onFailure { PlayerLogger.e(TAG, "PLAYER_NATIVE_ALERT_RAISE FAILED face=$face", it) }
        }

        override fun playerInForeground(): Boolean = MainActivity.isInForeground

        override fun bringPlayerForward(attempt: Int) {
            // The raise has already ended any user standby (enforceNow), so
            // the Activity's turn-screen-on is armed again by the time this
            // launch is delivered.
            runCatching { RelaunchEscalation.launchNow(app, "native-alert-watch") }
                .onFailure { PlayerLogger.w(TAG, "could not bring the player forward: ${it.message}") }
        }

        override fun reloadPage(face: Int, attempt: Int, why: String) {
            val host = pageHostRef?.get()
            if (host == null) {
                PlayerLogger.e(TAG, "no player Activity to reload (face $face, attempt $attempt) — it is being relaunched instead")
                return
            }
            runCatching { host.reloadPage(face, why) }
                .onFailure { PlayerLogger.e(TAG, "the Activity could not reload face $face's page", it) }
        }

        override fun pageLoadStartedAtMs(face: Int): Long? = runCatching {
            pageHostRef?.get()?.pageLoadStartedAtMs(face)?.takeIf { it > 0L }
        }.getOrNull()

        override fun cpuLock(hold: Boolean) {
            if (hold) acquireCpuLock(app) else releaseCpuLock()
        }

        override fun log(level: NativeAlertWatchEngine.Level, message: String) {
            when (level) {
                NativeAlertWatchEngine.Level.INFO -> PlayerLogger.i(TAG, message)
                NativeAlertWatchEngine.Level.WARN -> PlayerLogger.w(TAG, message)
                NativeAlertWatchEngine.Level.ERROR -> PlayerLogger.e(TAG, message)
            }
        }
    }

    // ─── the CPU ─────────────────────────────────────────────────────

    private fun acquireCpuLock(app: Context) {
        runCatching {
            synchronized(lock) {
                val wl = cpuLock ?: run {
                    val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@runCatching
                    pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, CPU_LOCK_TAG).also {
                        it.setReferenceCounted(false)
                        cpuLock = it
                    }
                }
                // Re-acquiring a non-counted lock re-arms its timeout.
                wl.acquire(NativeAlertWatchPolicy.CPU_LOCK_TIMEOUT_MS)
            }
        }.onFailure { PlayerLogger.w(TAG, "could not hold the alert-watch CPU lock: ${it.message}") }
    }

    private fun releaseCpuLock() {
        runCatching {
            synchronized(lock) {
                val wl = cpuLock
                if (wl != null && wl.isHeld) wl.release()
            }
        }.onFailure { PlayerLogger.w(TAG, "could not release the alert-watch CPU lock: ${it.message}") }
    }
}
