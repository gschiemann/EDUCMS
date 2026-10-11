package com.educms.player.wake

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import com.educms.player.MainActivity
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.DiagnosticsUploadPolicy
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.RelaunchEscalation
import com.educms.player.security.HostAllowlist
import com.educms.player.setup.SetupCeremony
import com.educms.player.standby.UserStandby
import org.json.JSONObject

/**
 * AFTER A WAKE, GET THE PLAYER ON THE GLASS — the Android half (2026-10-11).
 *
 * The rules are [WakePolicy]; the record is [WakeTimeline]. This file is
 * the clock, the prefs, the Handler and the three facts only Android has.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHERE IT IS WIRED
 * ─────────────────────────────────────────────────────────────────────
 *  • [afterWake] — from `DisplayControlRegistry.apply` for EVERY
 *    `DisplayAction.Wake`, after the provider and the software backstop
 *    ran. That single site covers the dead-man revert (`DisplayGuard`), the
 *    dashboard's Turn on / WAKE (`DisplayControlApi`, `NativePowerControl`),
 *    the on/off schedule's ON (`DisplayScheduler`), the native alert raise
 *    (`DisplayEmergency.enforceNow`) and the end of a restored standby
 *    (`UserStandby.exit`). Each names itself in `wakeSource`.
 *  • [onScreenOn] / [onScreenOff] — from `UserStandby`'s receiver. A
 *    person's power key is a wake too (nothing of ours asked for it), so it
 *    starts the same bounded check.
 *  • [onActivityResumed] — `MainActivity.onResume`: the only proof.
 *  • [onPageLoadStarted] — `MainActivity.loadPlayer`: evidence only.
 *  • [onProcessStart] — `PlayerApp.onCreate`: `PLAYER_PROCESS_START`, and
 *    `PLAYER_WAKE_PROCESS_RESTART` when the last wake never reached onResume.
 *  • [onAlertEpisodeSettled] — the native alert watch, through its port.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT IT NEVER DOES
 * ─────────────────────────────────────────────────────────────────────
 *  • It never pokes the panel: it only brings the EXISTING Activity forward
 *    once the panel is interactive ([WakePolicy] rule 2). A relaunch in a
 *    person's standby is refused, and `MainActivity.onCreate` keeps its
 *    wake flags disarmed in standby regardless.
 *  • It never reloads the page and never recreates the Activity
 *    (`RelaunchEscalation.launchNow`: singleTask + CLEAR_TOP = onNewIntent).
 *  • It never touches the emergency hold, the device admin or any lock.
 *
 * Every entry point is wrapped: nothing here may ever take the player down.
 */
object WakeRecovery {

    private const val TAG = "WakeRecovery"
    private const val PREFS = "edu_player"

    // The timeline, persisted with commit() so a wake that kills the process
    // is still on record when the next process starts.
    private const val KEY_SRC = "wake_src"
    private const val KEY_REQ_WALL = "wake_req_wall_ms"
    private const val KEY_REQ_EL = "wake_req_elapsed_ms"
    private const val KEY_ON_WALL = "wake_on_wall_ms"
    private const val KEY_RES_WALL = "wake_res_wall_ms"
    private const val KEY_LOAD_WALL = "wake_load_wall_ms"
    private const val KEY_N = "wake_launches"
    private const val KEY_OUT = "wake_outcome"

    private val lock = Any()
    private val main: Handler by lazy { Handler(Looper.getMainLooper()) }

    /** The wake whose checks are scheduled right now; null = none in flight. */
    private var inFlight: WakeTimeline? = null
    private var pendingCheck: Runnable? = null
    @Volatile private var lastLaunchAtElapsedMs = 0L

    // This process.
    @Volatile private var pid = 0
    @Volatile private var processStartedAtWallMs = 0L
    @Volatile private var bootCount = -1

    // Automatic diagnostics uploads.
    private var uploadState = DiagnosticsUploadPolicy.State()
    private var pendingUpload: Runnable? = null
    private var pendingUploadReason: DiagnosticsUploadPolicy.Reason? = null

    // ─── wiring ──────────────────────────────────────────────────────

    /** `PlayerApp.onCreate`. Records this process and attributes a restart to the last wake. */
    fun onProcessStart(ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            pid = android.os.Process.myPid()
            processStartedAtWallMs = System.currentTimeMillis()
            bootCount = readBootCount(app)
            val uptime = SystemClock.elapsedRealtime()
            val last = readTimeline(app)
            PlayerLogger.i(
                TAG,
                "PLAYER_PROCESS_START pid=$pid uptimeMs=$uptime bootCount=$bootCount " +
                    "lastWake=${last?.let { "${it.source}@${it.requestedAtWallMs} resumed=${it.resumedAtWallMs} out=${it.outcome}" } ?: "none"}",
            )
            if (last != null &&
                WakePolicy.restartAttributableToWake(last.requestedAtWallMs, last.resumedAtWallMs, processStartedAtWallMs)
            ) {
                PlayerLogger.e(
                    TAG,
                    "PLAYER_WAKE_PROCESS_RESTART src=${last.source} reqAt=${last.requestedAtWallMs} " +
                        "sinceMs=${processStartedAtWallMs - last.requestedAtWallMs} uptimeMs=$uptime — this process " +
                        "started inside the last wake's window and that wake never reached onResume: the previous " +
                        "process died (or the box restarted) between the wake and the glass. See PLAYER_PROCESS_EXIT " +
                        "above for the OS's reason, if it recorded one",
                )
                scheduleUpload(app, DiagnosticsUploadPolicy.Reason.PROCESS_RESTART_AFTER_WAKE)
            }
        }.onFailure { PlayerLogger.w(TAG, "process-start bookkeeping failed: ${it.message}") }
    }

    /**
     * A WAKE just ran through the display registry. Start the bounded
     * foreground check. Any thread.
     */
    fun afterWake(ctx: Context, source: String) {
        runCatching {
            val app = ctx.applicationContext
            val now = SystemClock.elapsedRealtime()
            val interactiveNow = interactive(app)
            if (WakePolicy.alreadyOnGlass(interactiveNow, MainActivity.isInForeground)) {
                // Nothing to bring forward. A command still gets its prompt
                // report; the alert's per-poll re-assert stays quiet.
                if (WakePolicy.promptWhenAlreadyOnGlass(source)) {
                    HeartbeatService.requestPromptTick(app, "wake:$source")
                }
                return
            }
            val t = WakeTimeline(
                source = source.take(WakeReport.MAX_SOURCE_CHARS),
                requestedAtWallMs = System.currentTimeMillis(),
                requestedAtElapsedMs = now,
            )
            // An interactive panel is on already; a dark one is stamped by the
            // screen-on broadcast when it arrives.
            val stamped = if (interactiveNow == true) t.copy(interactiveAtWallMs = t.requestedAtWallMs) else t
            synchronized(lock) {
                writeTimeline(app, stamped, commit = true)
                inFlight = stamped
                cancelPendingCheckLocked()
                scheduleCheckLocked(app, 0)
            }
            PlayerLogger.i(TAG, "PLAYER_WAKE_REQUESTED src=$source interactive=$interactiveNow foreground=${MainActivity.isInForeground}")
            HeartbeatService.requestPromptTick(app, "wake:$source")
        }.onFailure { PlayerLogger.w(TAG, "wake bookkeeping failed: ${it.message}") }
    }

    /** `ACTION_SCREEN_ON`. A wake that nothing of ours asked for is checked exactly the same way. */
    fun onScreenOn(ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            val wall = System.currentTimeMillis()
            synchronized(lock) {
                val t = inFlight ?: readTimeline(app)
                if (t != null && t.interactiveAtWallMs == 0L && wall >= t.requestedAtWallMs &&
                    wall - t.requestedAtWallMs <= WakePolicy.RESTART_ATTRIBUTION_WINDOW_MS
                ) {
                    val next = t.copy(interactiveAtWallMs = wall)
                    writeTimeline(app, next, commit = false)
                    if (inFlight != null) inFlight = next
                }
            }
            if (!MainActivity.isInForeground) {
                // Nobody of ours asked (a person's power key, a vendor wake):
                // start a sequence so the player still comes forward.
                val running = synchronized(lock) { inFlight != null }
                if (!running) afterWake(app, "screen-on")
            }
            HeartbeatService.requestPromptTick(app, "screen-on")
        }.onFailure { PlayerLogger.w(TAG, "screen-on bookkeeping failed: ${it.message}") }
    }

    /** `ACTION_SCREEN_OFF`. A dark panel ends any check — never launch into the dark. */
    fun onScreenOff(ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            synchronized(lock) {
                val t = inFlight
                if (t != null) {
                    cancelPendingCheckLocked()
                    inFlight = null
                    writeTimeline(app, t.copy(outcome = WakePolicy.outcomeOf(WakePolicy.Step.STOP_PANEL_DARK)), commit = false)
                }
            }
            HeartbeatService.requestPromptTick(app, "screen-off")
        }.onFailure { PlayerLogger.w(TAG, "screen-off bookkeeping failed: ${it.message}") }
    }

    /** `MainActivity.onResume` — the only proof a wake landed. */
    fun onActivityResumed(ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            val wall = System.currentTimeMillis()
            var landed: WakeTimeline? = null
            synchronized(lock) {
                val t = inFlight ?: readTimeline(app)
                if (t != null && t.resumedAtWallMs < t.requestedAtWallMs && wall >= t.requestedAtWallMs &&
                    wall - t.requestedAtWallMs <= WakePolicy.RESTART_ATTRIBUTION_WINDOW_MS
                ) {
                    val next = t.copy(resumedAtWallMs = wall, outcome = WakePolicy.outcomeOf(WakePolicy.Step.DONE_ON_GLASS))
                    writeTimeline(app, next, commit = true)
                    landed = next
                    if (inFlight != null) {
                        cancelPendingCheckLocked()
                        inFlight = null
                    }
                }
            }
            landed?.let { t ->
                PlayerLogger.i(
                    TAG,
                    "PLAYER_WAKE_LANDED src=${t.source} sinceMs=${t.resumeAfterMs} launches=${t.launches} " +
                        "pid=$pid — MainActivity resumed on the glass",
                )
                scheduleUpload(app, DiagnosticsUploadPolicy.Reason.WAKE_LANDED)
            }
            HeartbeatService.requestPromptTick(app, "activity-resumed")
        }.onFailure { PlayerLogger.w(TAG, "resume bookkeeping failed: ${it.message}") }
    }

    /** `MainActivity.loadPlayer` — evidence only (did the wake cost a page load?). */
    fun onPageLoadStarted(ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            val wall = System.currentTimeMillis()
            synchronized(lock) {
                val t = inFlight ?: readTimeline(app)
                if (t != null && wall >= t.requestedAtWallMs &&
                    wall - t.requestedAtWallMs <= WakePolicy.RESTART_ATTRIBUTION_WINDOW_MS &&
                    (t.pageLoadAtWallMs == 0L || t.pageLoadAtWallMs < t.requestedAtWallMs)
                ) {
                    val next = t.copy(pageLoadAtWallMs = wall)
                    writeTimeline(app, next, commit = false)
                    if (inFlight != null) inFlight = next
                }
            }
        }.onFailure { PlayerLogger.w(TAG, "page-load bookkeeping failed: ${it.message}") }
    }

    /** The native alert watch settled an episode (confirmed, unconfirmed, page-cleared, not-on-glass). */
    fun onAlertEpisodeSettled(ctx: Context, outcome: String) {
        runCatching {
            PlayerLogger.i(TAG, "native alert episode settled ($outcome) — the device log will be sent up")
            scheduleUpload(ctx.applicationContext, DiagnosticsUploadPolicy.Reason.ALERT_SETTLED)
        }.onFailure { PlayerLogger.w(TAG, "alert-settled bookkeeping failed: ${it.message}") }
    }

    /** `HeartbeatService`: a wake is still being checked, so keep the full cadence. */
    fun checkInFlight(): Boolean = synchronized(lock) { inFlight != null }

    /** The `wake` + `proc` blocks for the native runtime report. Never throws. */
    fun attachTo(report: JSONObject, ctx: Context) {
        runCatching {
            val app = ctx.applicationContext
            val t = synchronized(lock) { inFlight ?: readTimeline(app) }
            val blocks = WakeReport.json(t, pid, processStartedAtWallMs, bootCount)
            blocks.optJSONObject("wake")?.let { report.put("wake", it) }
            blocks.optJSONObject("proc")?.let { report.put("proc", it) }
        }.onFailure { PlayerLogger.w(TAG, "wake facts unavailable: ${it.message}") }
    }

    // ─── the checks ──────────────────────────────────────────────────

    private fun scheduleCheckLocked(app: Context, index: Int) {
        val t = inFlight ?: return
        val delays = WakePolicy.CHECK_DELAYS_MS
        if (index >= delays.size) return
        val due = t.requestedAtElapsedMs + delays[index]
        val r = Runnable { runCatching { check(app, index) }.onFailure { PlayerLogger.w(TAG, "wake check failed: ${it.message}") } }
        pendingCheck = r
        main.postDelayed(r, (due - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
    }

    private fun cancelPendingCheckLocked() {
        pendingCheck?.let { main.removeCallbacks(it) }
        pendingCheck = null
    }

    private fun check(app: Context, index: Int) {
        val t = synchronized(lock) { inFlight } ?: return
        val last = index >= WakePolicy.CHECK_DELAYS_MS.size - 1
        val facts = WakePolicy.Facts(
            interactive = interactive(app),
            foreground = MainActivity.isInForeground,
            standbyActive = runCatching { UserStandby.isActive(app) }.getOrDefault(false),
            emergencyHeld = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(false),
            installPromptOutstanding = runCatching { MainActivity.installPromptOutstanding }.getOrDefault(false),
            setupYield = runCatching { SetupCeremony.relaunchShouldYield(app) }.getOrDefault(false),
            launchesThisWake = t.launches,
            lastLaunchAtMs = lastLaunchAtElapsedMs,
            nowMs = SystemClock.elapsedRealtime(),
            lastCheck = last,
        )
        val step = WakePolicy.step(facts)
        when (step) {
            WakePolicy.Step.DONE_ON_GLASS -> {
                // onResume stamps the landing itself; this is the check that
                // happened to see it first.
                synchronized(lock) { if (inFlight === t) inFlight = null }
                onActivityResumed(app)
            }
            WakePolicy.Step.LAUNCH -> {
                val now = SystemClock.elapsedRealtime()
                lastLaunchAtElapsedMs = now
                val next = t.copy(launches = t.launches + 1)
                synchronized(lock) {
                    if (inFlight === t) {
                        inFlight = next
                        writeTimeline(app, next, commit = false)
                    }
                }
                PlayerLogger.w(
                    TAG,
                    "PLAYER_WAKE_LAUNCH src=${t.source} n=${next.launches} of=${WakePolicy.MAX_LAUNCHES_PER_WAKE} " +
                        "sinceMs=${now - t.requestedAtElapsedMs} — the panel is on and the player is not in front; " +
                        "bringing the existing Activity forward",
                )
                runCatching { RelaunchEscalation.launchNow(app, "wake/${t.source}") }
                    .onFailure { PlayerLogger.w(TAG, "wake launch failed: ${it.message}") }
                synchronized(lock) { if (inFlight === next) scheduleCheckLocked(app, index + 1) }
            }
            WakePolicy.Step.WAIT -> synchronized(lock) { if (inFlight === t) scheduleCheckLocked(app, index + 1) }
            else -> conclude(app, t, step, facts)
        }
    }

    private fun conclude(app: Context, t: WakeTimeline, step: WakePolicy.Step, facts: WakePolicy.Facts) {
        val outcome = WakePolicy.outcomeOf(step)
        val done = t.copy(outcome = outcome)
        synchronized(lock) {
            if (inFlight === t) {
                inFlight = null
                writeTimeline(app, done, commit = false)
            }
        }
        val since = facts.nowMs - t.requestedAtElapsedMs
        when (step) {
            WakePolicy.Step.STOP_PANEL_DARK -> PlayerLogger.w(
                TAG,
                "PLAYER_WAKE_PANEL_DARK src=${t.source} sinceMs=$since interactive=${facts.interactive} — the panel " +
                    "did not come on after the wake; nothing is launched into the dark",
            )
            WakePolicy.Step.STOP_BUDGET -> {
                PlayerLogger.e(
                    TAG,
                    "PLAYER_WAKE_NOT_ON_GLASS src=${t.source} sinceMs=$since launches=${t.launches} " +
                        "overlay=${canDrawOverlays(app)} — the panel is on and the player did not reach the " +
                        "foreground. Android refuses a launch from the background unless the app is the Home app, " +
                        "holds \"Display over other apps\" or is a device owner; whatever is in front stays there",
                )
                scheduleUpload(app, DiagnosticsUploadPolicy.Reason.WAKE_NOT_ON_GLASS)
            }
            else -> PlayerLogger.i(TAG, "wake check stood down (src=${t.source} sinceMs=$since): $outcome")
        }
    }

    // ─── the upload ──────────────────────────────────────────────────

    private fun scheduleUpload(app: Context, reason: DiagnosticsUploadPolicy.Reason) {
        val now = SystemClock.elapsedRealtime()
        val at: Long?
        synchronized(lock) {
            at = DiagnosticsUploadPolicy.scheduleAt(now, uploadState, reason)
            if (at == null) {
                PlayerLogger.i(TAG, "diagnostics upload for $reason refused — hourly cap")
                return
            }
            if (uploadState.scheduledAtMs == at && pendingUpload != null) {
                // Already scheduled for that instant; the reason that carries
                // an alert wins the name.
                if (reason.alert) pendingUploadReason = reason
                return
            }
            pendingUpload?.let { main.removeCallbacks(it) }
            val r = Runnable { runCatching { upload(app) }.onFailure { PlayerLogger.w(TAG, "diagnostics upload failed: ${it.message}") } }
            pendingUpload = r
            pendingUploadReason = if (pendingUploadReason?.alert == true) pendingUploadReason else reason
            uploadState = uploadState.copy(scheduledAtMs = at)
            main.postDelayed(r, (at - now).coerceAtLeast(0L))
        }
    }

    private fun upload(app: Context) {
        val reason: DiagnosticsUploadPolicy.Reason?
        synchronized(lock) {
            reason = pendingUploadReason
            pendingUpload = null
            pendingUploadReason = null
            uploadState = DiagnosticsUploadPolicy.State(
                uploadsMs = (uploadState.uploadsMs + SystemClock.elapsedRealtime()).takeLast(DiagnosticsUploadPolicy.MAX_PER_HOUR * 2),
                scheduledAtMs = 0L,
            )
        }
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val apiRoot = prefs.getString("api_root", null)?.trim()
        if (apiRoot.isNullOrBlank() || !HostAllowlist.isApiHost(apiRoot)) {
            PlayerLogger.w(TAG, "diagnostics upload ($reason) skipped — no allowed API root")
            return
        }
        // The device credential is READ, never written (player rule 3). The
        // upload is attributed only when the path names the screen the token
        // is bound to — the screen id, not the hardware fingerprint.
        val token = prefs.getString("device_token", null)?.trim()
        val screenId = NativeAlertWatchPolicy.screenIdOf(token) ?: prefs.getString("device_fingerprint", null)
        PlayerLogger.i(TAG, "PLAYER_WAKE_LOG_UPLOAD reason=$reason attributed=${token != null && NativeAlertWatchPolicy.screenIdOf(token) != null}")
        PlayerLogger.uploadRecent(apiRoot, token, screenId)
    }

    // ─── the record ──────────────────────────────────────────────────

    private fun readTimeline(app: Context): WakeTimeline? = runCatching {
        val p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val req = p.getLong(KEY_REQ_WALL, 0L)
        if (req <= 0L) return@runCatching null
        WakeTimeline(
            source = p.getString(KEY_SRC, null) ?: "unknown",
            requestedAtWallMs = req,
            requestedAtElapsedMs = p.getLong(KEY_REQ_EL, 0L),
            interactiveAtWallMs = p.getLong(KEY_ON_WALL, 0L),
            resumedAtWallMs = p.getLong(KEY_RES_WALL, 0L),
            pageLoadAtWallMs = p.getLong(KEY_LOAD_WALL, 0L),
            launches = p.getInt(KEY_N, 0),
            outcome = p.getString(KEY_OUT, null) ?: "pending",
        )
    }.getOrNull()

    private fun writeTimeline(app: Context, t: WakeTimeline, commit: Boolean) {
        runCatching {
            val e = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_SRC, t.source)
                .putLong(KEY_REQ_WALL, t.requestedAtWallMs)
                .putLong(KEY_REQ_EL, t.requestedAtElapsedMs)
                .putLong(KEY_ON_WALL, t.interactiveAtWallMs)
                .putLong(KEY_RES_WALL, t.resumedAtWallMs)
                .putLong(KEY_LOAD_WALL, t.pageLoadAtWallMs)
                .putInt(KEY_N, t.launches)
                .putString(KEY_OUT, t.outcome)
            if (commit) e.commit() else e.apply()
        }.onFailure { PlayerLogger.w(TAG, "could not persist the wake timeline: ${it.message}") }
    }

    // ─── facts ───────────────────────────────────────────────────────

    private fun interactive(app: Context): Boolean? = runCatching {
        (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
    }.getOrNull()

    private fun canDrawOverlays(app: Context): Boolean = runCatching { Settings.canDrawOverlays(app) }.getOrDefault(false)

    /** `Settings.Global.BOOT_COUNT` (API 24, our minSdk), or -1 where the ROM does not keep it. */
    private fun readBootCount(app: Context): Int = runCatching {
        Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)
    }.getOrDefault(-1)
}
