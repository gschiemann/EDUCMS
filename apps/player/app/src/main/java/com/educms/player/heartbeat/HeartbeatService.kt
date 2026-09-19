package com.educms.player.heartbeat

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.educms.player.BuildConfig
import com.educms.player.MainActivity
import com.educms.player.PlayerApp
import com.educms.player.R
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.RelaunchEscalation
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Foreground service that keeps the player "alive" + visible to the
 * dashboard. Two responsibilities:
 *
 * 1) HEARTBEAT — periodically GET /api/v1/screens/status/{fp} so the
 *    dashboard's auto-refreshing screen list flips the row to ONLINE (the
 *    API derives status from `lastPingAt` against SCREEN_ONLINE_GRACE_MS;
 *    see screens.controller). Without an active ping the row goes OFFLINE
 *    within minutes of the player going idle, even when it's actually
 *    playing.
 *
 *    ── 2026-09-02, efficiency program P0-1: 30 s → 60 s, and 5 min while
 *    the page is reporting for itself. ────────────────────────────────────
 *    This service and the WEB PLAYER were both writing the SAME
 *    `lastPingAt` column on their own timers — 2,880 requests per screen
 *    per day from here, plus the page's own 30 s and 45 s status GETs. The
 *    audit measured ~93 % of live production API traffic as that class of
 *    player maintenance. The page now sends ONE unified telemetry POST per
 *    minute and tells us so via `heartbeatV2`'s `telemetryOk` key
 *    ([noteWebTelemetry]); while that is fresh, this loop drops to a
 *    5-minute floor.
 *
 *    ⚠️ IT SLOWS DOWN, IT NEVER STANDS DOWN — player rule 5, never equate
 *    signals. "The web reported" is NOT "the Android process is alive".
 *    The page can be killed, its WebView torn down, or its renderer wedged
 *    while this process is perfectly healthy — and the reverse. The
 *    5-minute floor is the independent proof of THIS process, and it is
 *    also what recovers the fleet's view of the screen if the page's
 *    reporting dies without the page dying.
 *
 * 2) UPTIME — runs as a STARTED foreground service with the
 *    FOREGROUND_SERVICE permission. Android will not kill foreground
 *    services to reclaim memory the way it kills background ones,
 *    even on aggressive OEM forks (Xiaomi, Samsung, Vivo). Combined
 *    with the wake lock + restart-from-watchdog fallback, this gets
 *    us as close to '100% uptime' as Android lets you on real
 *    hardware.
 *
 * Failure handling:
 *   - Coroutine wrapped in try/catch; one failed ping never kills the
 *     loop. Failures are logged + counted; backoff doubles up to 5min
 *     after 3 consecutive failures so we don't hammer a down API.
 *   - Service.onTaskRemoved + onDestroy reschedule themselves via
 *     AlarmManager so even if the system or user kills the process
 *     it comes back within 60s.
 *   - PartialWakeLock is held only during the network call so we don't
 *     drain battery on tablets / phones running this.
 */
class HeartbeatService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var loopJob: Job? = null
    private var consecutiveFailures = 0

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "HeartbeatService.onCreate")
        PlayerLogger.i(TAG, "HeartbeatService started (register loop beginning)")
        startForegroundCompat()
        loopJob?.cancel()
        loopJob = scope.launch { runLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // v1.0.62 — post-install activity-launch trampoline.
        //
        // When MY_PACKAGE_REPLACED fires after an OTA install, the
        // system grants BAL EXEMPTION FOR FGS STARTS ONLY, not for
        // activity starts. BootReceiver therefore can't directly
        // startActivity(MainActivity) — Android 14 BAL rejects it
        // with `result code=102` (verified on emulator post-v1.0.61
        // install: activity start from BootReceiver was blocked 80 ms
        // after this FGS started successfully).
        //
        // BUT: this FGS received the 20-second BAL grant from the
        // MY_PACKAGE_REPLACED broadcast (logged as `tempAllowListReason:
        // MY_PACKAGE_REPLACED ... duration:20000`). Activity launches
        // from a FGS-in-foreground-state inside that window ARE allowed.
        //
        // ⚠️ 2026-09-01 — THAT REASONING IS ANDROID 14 ONLY, and this
        // comment stated it as if it were universal. The BAL grant it
        // describes is an API-34 construct; the two Goodview panels that
        // installed an OTA and never came back run API 30 and API 33, where
        // no such grant exists and the activity start below is SILENTLY
        // DROPPED (no exception — which is why the log line said "launched"
        // over a screen sitting on the OEM launcher). The FGS start itself
        // still works on every version; only the activity start it performs
        // is version-dependent.
        //
        // So BootReceiver passes EXTRA_LAUNCH_MAIN=true when starting
        // this service after MY_PACKAGE_REPLACED. We honor it here on
        // the very first onStartCommand after process spawn (guarded
        // with hasAutoLaunchedMain so the regular periodic restarts
        // don't yank focus from the operator) — and delegate to
        // RelaunchEscalation, which makes the same call and then PROVES
        // whether it landed instead of assuming it did.
        if (!hasAutoLaunchedMain && intent?.getBooleanExtra(EXTRA_LAUNCH_MAIN, false) == true) {
            hasAutoLaunchedMain = true
            PlayerLogger.i(TAG, "launching MainActivity from FGS BAL grant (post-MY_PACKAGE_REPLACED)")
            RelaunchEscalation.attempt(applicationContext, "fgs-package-replaced")
        }
        // START_STICKY — Android restarts us with a null intent if the
        // process gets killed. Combined with PendingIntent rescheduling
        // in onTaskRemoved/onDestroy, this is belt-and-suspenders.
        return START_STICKY
    }

    /** v1.0.62 — track first auto-launch so periodic restarts don't yank
     *  focus from the operator. Process-scoped; resets on every fresh
     *  Player process (which is the only time we WANT to auto-launch). */
    private var hasAutoLaunchedMain = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        // User swiped the recent-apps card. Schedule ourselves to come
        // back in 60s — Android 12+ disallows direct startService from
        // background, so AlarmManager + a broadcast receiver is the
        // canonical workaround.
        rescheduleSelf(60_000)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Log.w(TAG, "HeartbeatService.onDestroy — scheduling restart")
        PlayerLogger.w(TAG, "HeartbeatService destroyed — rescheduling in 30s")
        rescheduleSelf(30_000)
        loopJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    /**
     * C-P2-11 (2026-08-30 deep audit) — a REAL bug that was sitting under
     * the lint baseline, not a false positive.
     *
     * `PendingIntent.getForegroundService` is API 26+. `minSdk` is 24, so
     * on API 24/25 this call site resolves to nothing and the runtime
     * throws `NoSuchMethodError` — an `Error`, not an `Exception`, so the
     * `catch (e: Exception)` below NEVER caught it. It escaped, and it
     * escaped from `onDestroy` / `onTaskRemoved`: the two places whose
     * entire job is to guarantee the heartbeat service comes back after
     * the system kills it. On those devices the restart path was dead.
     *
     * Pre-Oreo there is no background-start restriction to work around,
     * so `getService` is not a degraded fallback there — it is simply the
     * correct API for that platform. The baseline entry has been removed
     * so lint re-catches any regression.
     */
    private fun rescheduleSelf(delayMs: Long) {
        try {
            val intent = Intent(this, HeartbeatService::class.java)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PendingIntent.getForegroundService(this, 0, intent, flags)
            } else {
                PendingIntent.getService(this, 0, intent, flags)
            }
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val triggerAt = SystemClock.elapsedRealtime() + delayMs
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to reschedule HeartbeatService", e)
        }
    }

    private fun startForegroundCompat() {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif: Notification = NotificationCompat.Builder(this, PlayerApp.CHANNEL_HEARTBEAT)
            .setSmallIcon(android.R.drawable.presence_online)
            .setContentTitle("Player connected")
            .setContentText("EduCMS Player ${BuildConfig.VERSION_NAME}")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        startForeground(NOTIF_ID, notif)
    }

    private suspend fun runLoop() {
        val ctx = applicationContext
        val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        while (scope.isActive) {
            val fp = prefs.getString("device_fingerprint", null)
            val apiRoot = prefs.getString("api_root", null)
            if (!fp.isNullOrBlank() && !apiRoot.isNullOrBlank() && shouldTickNow(prefs)) {
                tickWithWakeLock(apiRoot, fp, prefs)
            }
            // Backoff if we're failing — 30s baseline doubles to a 90s cap.
            //
            // C-P2-12 (2026-08-30 deep audit) — the cap was 300 s, and
            // that OUTRAN the window everything downstream measures us in.
            // The dashboard grades a screen ONLINE on `lastPingAt` inside
            // ~2 minutes, so after a handful of failed ticks a perfectly
            // healthy player that had merely ridden out a network blip
            // went quiet for five minutes and the fleet UI called it
            // OFFLINE — and, worse, the screen-wedge detector's sweep saw
            // the same gap and could not tell a recovered screen from a
            // dead one. The backoff exists to stop us hammering a down
            // API; 90 s is still a 3× reduction in load versus the 30 s
            // baseline and stays comfortably inside the ONLINE window, so
            // a screen that recovers is visibly back on its next tick.
            val delayMs = if (consecutiveFailures > 3)
                minOf(BASE_INTERVAL_MS * (1L shl minOf(consecutiveFailures - 3, 4)), MAX_BACKOFF_MS)
            else BASE_INTERVAL_MS
            delay(delayMs)
        }
    }

    /**
     * Should this iteration actually make a request?
     *
     * NO only when the page has recently proven it is reporting for itself
     * AND we have ticked inside the 5-minute floor. Both halves matter:
     *
     *  • the freshness window on `telemetryOk` means a page that STOPS
     *    reporting (killed, wedged, navigated away, credential dead) puts
     *    us back on the full cadence within [WEB_TELEMETRY_FRESH_MS] with
     *    no signalling required — silence is the trigger, which is the only
     *    kind of trigger a dead page can still send;
     *  • the floor means this process still proves ITSELF alive on a
     *    predictable schedule, so "the web says it is fine" can never be
     *    the only evidence the fleet has about this screen.
     */
    private fun shouldTickNow(prefs: SharedPreferences): Boolean = decideTick(
        nowMs = System.currentTimeMillis(),
        lastTickAtMs = prefs.getLong(KEY_LAST_TICK_AT, 0L),
        webTelemetryAtMs = prefs.getLong(KEY_WEB_TELEMETRY_AT, 0L),
    )

    private suspend fun tickWithWakeLock(apiRoot: String, fp: String, prefs: SharedPreferences) {
        val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edu:heartbeat")
        try {
            wl.acquire(8_000)
            withContext(Dispatchers.IO) {
                // Pass app version on every heartbeat so the dashboard
                // sees the kiosk's current build within ~30s instead of
                // waiting on the 6h /update-check cycle. Operator
                // (2026-04-27): "we shouldnt have to wait 6 hours to
                // see an updated version, why not grab that everytime
                // the screen checks in?"
                val vn = java.net.URLEncoder.encode(BuildConfig.VERSION_NAME, "UTF-8")
                val vc = BuildConfig.VERSION_CODE
                // Stamped BEFORE the request, not after: the floor is about how
                // often we ATTEMPT, and stamping on success only would let a
                // screen with a down API hammer the network at full rate.
                prefs.edit().putLong(KEY_LAST_TICK_AT, System.currentTimeMillis()).apply()
                val url = URL("$apiRoot/api/v1/screens/status/$fp?v=$vn&vc=$vc")
                // ── The device credential (school-security audit item 3, 2026-09-08) ──
                // This route used to WRITE `lastPingAt` / `status` / the reported
                // version for ANY caller, so a stranger who knew a fingerprint could
                // hold a dead screen at ONLINE and falsify the fleet's firmware view.
                // The server now requires the device credential for those writes on a
                // PAIRED screen; without this header the tick still gets its READ (the
                // `forceUpdatePending` OTA fallback below is unaffected) but stops
                // being this screen's independent liveness proof.
                //
                // `edu_player`/`device_token` is the canonical native store — written
                // by the `setDeviceToken` bridge on every page load, and the same key
                // TokenResolution and the OTA worker read. We only READ it here; this
                // service must never become a second writer (player rule 3).
                //
                // Absent / blank ⇒ header omitted ⇒ byte-for-byte the pre-2026-09-08
                // request, so a screen that has not paired yet is unaffected. A STALE
                // token now earns a 401 rather than a silent anonymous downgrade, and
                // that is deliberate: it is counted as a real failure by the branch
                // below (player rule 2) instead of being papered over. A screen in that
                // state has a dead credential the web player is failing to renew, which
                // is a problem to surface, not to hide behind a forged ONLINE.
                val deviceToken = prefs.getString("device_token", null)?.trim()
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 6_000
                    readTimeout = 6_000
                    if (!deviceToken.isNullOrBlank()) {
                        setRequestProperty("Authorization", "Bearer $deviceToken")
                    }
                }
                val code = conn.responseCode
                if (code in 200..299) {
                    consecutiveFailures = 0
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    handleHeartbeatResponse(body, prefs)
                } else {
                    consecutiveFailures += 1
                    Log.w(TAG, "Heartbeat returned HTTP $code (consecutive=$consecutiveFailures)")
                    PlayerLogger.w(TAG, "Heartbeat tick failed: HTTP $code (consecutive=$consecutiveFailures)")
                }
            }
        } catch (e: Exception) {
            consecutiveFailures += 1
            Log.w(TAG, "Heartbeat failed (consecutive=$consecutiveFailures): ${e.message}")
            PlayerLogger.w(TAG, "Heartbeat tick exception (consecutive=$consecutiveFailures): ${e.message}")
        } finally {
            try { if (wl.isHeld) wl.release() } catch (_: Exception) {}
        }
    }

    private fun handleHeartbeatResponse(body: String, prefs: SharedPreferences) {
        if (body.isBlank()) return
        // ── How many sides the server says this display has ─────────────
        // Read BEFORE the forced-OTA early return below, and isolated from it:
        // a malformed OTA field must not stop a back side being hosted, and
        // vice versa. `null` = the reply did not say, so nothing is touched —
        // silence must never un-host a side that is playing.
        runCatching {
            com.educms.player.face.FaceActivation.faceCountFrom(body)?.let { sides ->
                val key = com.educms.player.face.FaceActivation.PREF_FACE_COUNT
                if (prefs.getInt(key, 1) != sides) {
                    prefs.edit().putInt(key, sides).apply()
                    PlayerLogger.i(TAG, "server says this display has $sides side(s) — the face host will reconcile")
                }
            }
        }
        try {
            val json = JSONObject(body)
            if (!json.optBoolean("forceUpdatePending", false)) return

            val pendingAt = json.optString("forceUpdatePendingAt", "").trim()
            val now = System.currentTimeMillis()
            val lastKey = prefs.getString(KEY_LAST_FORCE_OTA_KEY, null)
            val lastAt = prefs.getLong(KEY_LAST_FORCE_OTA_AT, 0L)

            if (pendingAt.isNotBlank()) {
                if (pendingAt == lastKey) return
            } else if (now - lastAt < FORCE_OTA_MIN_INTERVAL_MS) {
                return
            }

            prefs.edit()
                .putString(KEY_LAST_FORCE_OTA_KEY, pendingAt.ifBlank { "legacy-$now" })
                .putLong(KEY_LAST_FORCE_OTA_AT, now)
                .apply()

            PlayerLogger.i(TAG, "Heartbeat detected forceUpdatePending; firing OTA check")
            PlayerApp.fireOtaCheckNow(applicationContext)
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Heartbeat response parse failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "HeartbeatService"
        private const val NOTIF_ID = 1001
        private const val KEY_LAST_FORCE_OTA_KEY = "last_force_ota_key"
        private const val KEY_LAST_FORCE_OTA_AT = "last_force_ota_at"
        private const val FORCE_OTA_MIN_INTERVAL_MS = 60_000L

        /** Prefs keys shared with the page (via MainActivity) — same
         *  `edu_player` file the fingerprint and api_root already live in,
         *  because this service runs in its own process and cannot see the
         *  Activity's memory. */
        const val KEY_WEB_TELEMETRY_AT = "web_telemetry_at"
        private const val KEY_LAST_TICK_AT = "heartbeat_last_tick_at"

        /**
         * Base cadence. 2026-09-02: 30 s → 60 s (efficiency program P0-1).
         * Paired with SCREEN_ONLINE_GRACE_MS on the server, which moved to
         * 100 s in the same wave precisely so a once-a-minute reporter is
         * never read as OFFLINE. Do not raise either one alone.
         */
        const val BASE_INTERVAL_MS = 60_000L

        /**
         * How long a `telemetryOk` report from the page keeps this service
         * on its reduced cadence. Deliberately ~3× the page's own 60 s
         * cadence: two dropped page reports are a blip, three is a page
         * that has stopped reporting, and at that point we go back to full
         * cadence on our own.
         */
        const val WEB_TELEMETRY_FRESH_MS = 3 * 60_000L

        /**
         * The liveness floor we keep even while the page is reporting.
         * This is the independent proof that the ANDROID PROCESS is alive
         * — the fact no web-side signal can stand in for.
         */
        const val WEB_REPORTING_FLOOR_MS = 5 * 60_000L

        /**
         * C-P2-12 — ceiling on the failure backoff. MUST stay below the
         * dashboard's ONLINE window (~2 min on `lastPingAt`) or a
         * recovered screen reads as OFFLINE and the wedge detector goes
         * blind after every network blip.
         */
        private const val MAX_BACKOFF_MS = 90_000L

        /**
         * 2026-09-02 — record what the page said about its own telemetry.
         * Called from MainActivity's `onWebTelemetryReported` wiring, which
         * the WebAppBridge fires on every `heartbeatV2`.
         *
         * A `false` CLEARS the stamp rather than leaving a stale one: a page
         * that is running but whose telemetry has started failing must put
         * this service back on full cadence immediately, not after the
         * freshness window expires.
         */
        /**
         * The tick decision, as a PURE function so it is unit-testable
         * without an Android runtime — same discipline as
         * `ScreenWedgeDetectorCron.decide` and `ContentWatchdogPolicy` on
         * the server side. `shouldTickNow` is the thin prefs-reading wrapper.
         *
         * Rules, in order:
         *   1. THE FLOOR IS ABSOLUTE. Past [WEB_REPORTING_FLOOR_MS] since
         *      our last attempt we always tick, whatever the page claims.
         *      This is the independent proof that the ANDROID PROCESS is
         *      alive; no web-side signal may stand in for it (player rule 5).
         *   2. A BACKWARDS CLOCK NEVER WEDGES THE LOOP. Signage boxes step
         *      their clock on NTP sync; a negative age must resolve to
         *      "tick", never to "wait forever".
         *   3. Otherwise skip only while the page's `telemetryOk` is FRESH.
         *      Freshness — not a flag — is what makes this self-healing: a
         *      page that is killed, wedged, or whose telemetry starts
         *      failing simply stops refreshing the stamp, and we are back on
         *      full cadence within [WEB_TELEMETRY_FRESH_MS] with no
         *      signalling required. Silence is the only message a dead page
         *      can still send.
         */
        fun decideTick(nowMs: Long, lastTickAtMs: Long, webTelemetryAtMs: Long): Boolean {
            if (nowMs < lastTickAtMs) return true                       // rule 2
            if (nowMs - lastTickAtMs >= WEB_REPORTING_FLOOR_MS) return true // rule 1
            val webFresh = webTelemetryAtMs > 0L &&
                nowMs >= webTelemetryAtMs &&
                nowMs - webTelemetryAtMs < WEB_TELEMETRY_FRESH_MS
            return !webFresh                                            // rule 3
        }

        fun noteWebTelemetry(ctx: Context, telemetryOk: Boolean) {
            try {
                val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
                prefs.edit()
                    .putLong(KEY_WEB_TELEMETRY_AT, if (telemetryOk) System.currentTimeMillis() else 0L)
                    .apply()
            } catch (e: Exception) {
                Log.w(TAG, "noteWebTelemetry failed", e)
            }
        }

        /**
         * v1.0.62 — when BootReceiver handled MY_PACKAGE_REPLACED, it
         * starts this FGS with EXTRA_LAUNCH_MAIN=true so the service
         * (which inherits the FGS BAL grant) can launch MainActivity
         * on behalf of the receiver (which can't). See onStartCommand.
         */
        const val EXTRA_LAUNCH_MAIN = "edu.educms.player.LAUNCH_MAIN_AFTER_START"

        /**
         * Convenience entrypoint — call from PlayerApp.onCreate and
         * BootReceiver to ensure the service is running. Idempotent.
         */
        fun ensureRunning(ctx: Context) {
            val intent = Intent(ctx, HeartbeatService::class.java)
            try {
                ContextCompat.startForegroundService(ctx, intent)
            } catch (e: Exception) {
                Log.w(TAG, "ensureRunning failed", e)
            }
        }

        /**
         * Same as ensureRunning but tags the start intent so onStartCommand
         * also brings the MainActivity to the foreground. Use from
         * BootReceiver when it handled MY_PACKAGE_REPLACED — the BAL
         * grant flows from the receiver to the FGS, and the FGS can then
         * launch the activity that the receiver itself cannot.
         */
        fun ensureRunningAndLaunchMain(ctx: Context) {
            val intent = Intent(ctx, HeartbeatService::class.java).apply {
                putExtra(EXTRA_LAUNCH_MAIN, true)
            }
            try {
                ContextCompat.startForegroundService(ctx, intent)
            } catch (e: Exception) {
                Log.w(TAG, "ensureRunningAndLaunchMain failed", e)
            }
        }
    }
}
