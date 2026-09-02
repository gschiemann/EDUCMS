package com.educms.player.boot

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import com.educms.player.ApiRoot
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Android half of the boot + registration watchdog (2026-09-02, P0-2).
 *
 * Owns: raising / tearing down [BootDiagnosticsView], running the two
 * reachability probes off the main thread, persisting the last successful
 * registration, and reporting the diagnostic to fleet telemetry once.
 * Every DECISION lives in BootProgress.kt so it can be tested without a
 * device; this file is wiring.
 *
 * ⚠️ IT NEVER RAISES OVER SOMETHING MORE IMPORTANT. See
 * [bootDiagnosticSuppression] — an emergency hold, a system install
 * confirmation, the manager gate, the setup ceremony and lock task all
 * refuse it, and the refusal is logged rather than silent.
 *
 * ⚠️ IT NEVER STOPS THE PLAYER RECOVERING ON ITS OWN. The card is a
 * SCRIM over a WebView that keeps loading, keeps heartbeating and keeps
 * being reloaded by the existing watchdogs. If registration finally
 * succeeds the card comes down by itself. Nothing here is a state the
 * screen can get stuck in.
 */
object BootDiagnostics {

    private const val TAG = "BootDiagnostics"
    private const val PREFS = "edu_player"
    private const val KEY_LAST_REGISTER_OK = "last_register_ok_at"

    /**
     * How often the boot facts are judged. 10 s — fine enough that a
     * 30-second deadline is reported within a third of a tick of its
     * truth, cheap enough to be one `postDelayed` on an idle looper.
     */
    const val TICK_MS = 10_000L

    /**
     * Minimum gap between two telemetry reports from this process. A
     * screen wedged in a boot loop must not turn a diagnostic into a
     * write storm: the report writes Screen columns, and even
     * telemetry-only columns are a row write per screen per report.
     */
    const val REPORT_COOLDOWN_MS = 30L * 60L * 1000L

    val tracker = BootProgressTracker()

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * One worker for probes and the telemetry POST. Both are blocking
     * network I/O and must never touch the thread that draws signage.
     */
    private val worker = Executors.newSingleThreadExecutor { r ->
        Thread(r, "educms-bootdiag").apply { isDaemon = true }
    }

    private var viewRef: WeakReference<BootDiagnosticsView>? = null
    private val probeInFlight = AtomicBoolean(false)
    private var lastReportAtMs: Long = 0L

    /** Set by MainActivity so this object never holds an Activity strongly. */
    private var hostRef: WeakReference<Activity>? = null
    private var decorate: ((View) -> Unit)? = null
    private var onRetry: (() -> Unit)? = null
    private var onNetworkSettings: (() -> Unit)? = null
    private var onExit: (() -> Unit)? = null

    /**
     * Wire the host. Called from `MainActivity.onCreate`; the callbacks are
     * the Activity's own (reload / Settings / exitToDeviceHomeNow) so this
     * object owns no policy about what those mean.
     */
    fun attach(
        activity: Activity,
        decorate: (View) -> Unit,
        onRetry: () -> Unit,
        onNetworkSettings: () -> Unit,
        onExit: () -> Unit,
    ) {
        this.hostRef = WeakReference(activity)
        this.decorate = decorate
        this.onRetry = onRetry
        this.onNetworkSettings = onNetworkSettings
        this.onExit = onExit
        tracker.seedLastRegisterOk(readLastRegisterOk(activity.applicationContext))
    }

    /** Symmetric teardown; safe when nothing was attached. */
    fun detach(activity: Activity) {
        val view = viewRef?.get()
        if (view != null && view.context === activity) dismiss("activity detached")
        if (hostRef?.get() === activity) {
            hostRef = null
            decorate = null
            onRetry = null
            onNetworkSettings = null
            onExit = null
        }
    }

    /** Is the diagnostic card on the glass right now? */
    fun isShowing(): Boolean {
        val v = viewRef?.get() ?: return false
        return v.parent != null
    }

    // ─── the three facts, from WebAppBridge ──────────────────────────

    fun onLoadStarted(nowMs: Long) {
        tracker.onLoadStarted(nowMs)
        // A new navigation is the player's own recovery attempt. Whatever
        // the card was explaining is no longer the current truth, so take
        // it down and let the deadlines judge this attempt from scratch.
        mainHandler.post { dismiss("a new page load started") }
    }

    fun onClientBooted(nowMs: Long) {
        tracker.onClientBooted(nowMs)
        PlayerLogger.i(TAG, "boot proof: the player bundle's client JS is running")
    }

    fun onRegisterAttempt(nowMs: Long) {
        tracker.onRegisterAttempt(nowMs)
    }

    fun onRegisterResult(
        ctx: Context,
        nowMs: Long,
        ok: Boolean,
        failureClass: String?,
        httpStatus: Int?,
        message: String?,
    ) {
        val wallMs = System.currentTimeMillis()
        tracker.onRegisterResult(
            nowMs = nowMs,
            wallMs = wallMs,
            ok = ok,
            failureClass = if (ok) null else RegisterFailureClass.parse(failureClass),
            httpStatus = httpStatus,
            message = message,
        )
        if (ok) {
            persistLastRegisterOk(ctx, wallMs)
            PlayerLogger.i(TAG, "registration OK — boot watchdog satisfied")
            mainHandler.post { dismiss("registration succeeded") }
        } else {
            PlayerLogger.w(
                TAG,
                "registration failed: class=${failureClass ?: "unknown"} " +
                    "status=${httpStatus ?: "-"} ${message ?: ""}",
            )
        }
    }

    // ─── the tick ────────────────────────────────────────────────────

    /**
     * Judge the boot. Called on the main thread every [TICK_MS] by
     * MainActivity while the boot is unsatisfied.
     *
     * @param suppression null when the card may be raised; the reason
     *   otherwise (built by [bootDiagnosticSuppression] in the Activity,
     *   which is the only place that can see all five inputs).
     */
    fun tick(activity: Activity, nowMs: Long, suppression: String?) {
        val reason = tracker.evaluate(nowMs) ?: return
        if (suppression != null) {
            // Deliberately AFTER evaluate(): the verdict is latched, so a
            // boot that failed under an emergency hold does not re-raise on
            // every tick for the rest of the alert — and the next page load
            // re-arms it honestly.
            PlayerLogger.w(TAG, "boot failed ($reason) but not raising — $suppression")
            return
        }
        raise(activity, reason)
    }

    /**
     * The BACK-KEY path (P0-2 deliverable 4). An operator pressed Back,
     * the page never reported a client boot, and the web listener the
     * universal Back trap depends on therefore does not exist — so Back
     * would be a dead key on a wall panel whose remote is the only input.
     *
     * Distinct from [tick] on purpose: it is OPERATOR-INITIATED, so it
     * does not wait for a deadline and does not consult the tracker's
     * latch (an operator who presses Back after a suppressed raise still
     * deserves an escape). It DOES still respect suppression — checked by
     * the caller, which is the only place that can see all five inputs.
     */
    fun raiseForDeadBack(activity: Activity) {
        raise(activity, BootFailureReason.NO_CLIENT_BOOT)
    }

    // ─── the screen ──────────────────────────────────────────────────

    private fun raise(activity: Activity, reason: BootFailureReason) {
        val facts = tracker.facts()
        PlayerLogger.w(TAG, "raising the boot diagnostic — reason=$reason")
        val view = ensureView(activity) ?: return
        view.render(
            heading = BootDiagnosticsCopy.heading(reason),
            subhead = BootDiagnosticsCopy.subhead(reason),
            lines = staticLines(activity, facts) + listOf(
                BootDiagnosticsView.Line("Page origin", "checking…"),
                BootDiagnosticsView.Line("API", "checking…"),
            ),
        )
        runProbes(activity, reason, facts)
    }

    private fun ensureView(activity: Activity): BootDiagnosticsView? {
        viewRef?.get()?.let { if (it.context === activity && it.parent != null) return it }
        val dec = decorate ?: return null
        val view = BootDiagnosticsView(
            activity,
            onRetry = {
                tracker.onManualRetry(android.os.SystemClock.elapsedRealtime())
                dismiss("operator pressed Retry")
                onRetry?.invoke()
            },
            onNetworkSettings = { onNetworkSettings?.invoke() },
            onExit = { onExit?.invoke() },
            decorate = dec,
        )
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return null
        root.addView(
            view,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        // Focus containment first; render() parks it on a real control.
        view.requestFocus()
        viewRef = WeakReference(view)
        return view
    }

    fun dismiss(why: String) {
        val view = viewRef?.get() ?: return
        viewRef = null
        try {
            (view.parent as? ViewGroup)?.removeView(view)
            PlayerLogger.i(TAG, "boot diagnostic dismissed — $why")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not remove the diagnostic: ${t.message}")
        }
    }

    /**
     * Everything we know WITHOUT touching the network. Rendered
     * immediately so an installer is never staring at an empty card while
     * two 6-second probes run.
     */
    private fun staticLines(ctx: Context, facts: BootFacts): List<BootDiagnosticsView.Line> {
        // API 26+. Below that the WebView package simply is not nameable, and
        // saying "unknown" is the honest answer (rule 10) — the diagnostic
        // must never invent an engine identity it cannot read.
        val wv = try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.webkit.WebView.getCurrentWebViewPackage()
            } else {
                null
            }
        } catch (_: Throwable) {
            null
        }
        val lines = mutableListOf<BootDiagnosticsView.Line>()
        lines += BootDiagnosticsView.Line(
            "Browser engine",
            "${wv?.packageName ?: "unknown"} ${wv?.versionName ?: ""}".trim(),
        )
        lines += BootDiagnosticsView.Line(
            "Player / companion",
            "${BuildConfig.VERSION_NAME} / ${managerVersion(ctx) ?: "not installed"}",
        )
        lines += BootDiagnosticsView.Line(
            "Client JS",
            if (facts.clientBooted) "started" else "never reported starting",
            if (facts.clientBooted) BootDiagnosticsView.Tone.GOOD else BootDiagnosticsView.Tone.BAD,
        )
        lines += BootDiagnosticsView.Line(
            "Registration",
            when {
                facts.registerResultAtMs != 0L && facts.lastFailureClass != null ->
                    "failed (${facts.lastFailureClass.wire}" +
                        (facts.lastFailureStatus?.let { " $it" } ?: "") + ")"
                facts.registerAttempted -> "sent, no answer yet"
                else -> "never attempted"
            },
            BootDiagnosticsView.Tone.BAD,
        )
        facts.lastFailureMessage?.takeIf { it.isNotBlank() }?.let {
            lines += BootDiagnosticsView.Line("Server said", it.take(120))
        }
        lines += BootDiagnosticsView.Line(
            "Last registered",
            BootDiagnosticsCopy.lastRegistered(tracker.lastRegisterOkWallMs),
        )
        lines += BootDiagnosticsView.Line("Device clock", BootDiagnosticsCopy.clockNow())
        return lines
    }

    /**
     * Two probes, off the main thread, then one re-render. Single-flight:
     * a second raise while probes are running reuses the first result
     * rather than queueing another pair of 6-second connects.
     */
    private fun runProbes(activity: Activity, reason: BootFailureReason, facts: BootFacts) {
        if (!probeInFlight.compareAndSet(false, true)) return
        val appCtx = activity.applicationContext
        worker.execute {
            val pageOrigin = originOf(BuildConfig.PLAYER_BASE_URL)
            val apiRoot = ApiRoot.resolve(appCtx)
            val page = Reachability.probe(pageOrigin, "HEAD")
            val api = Reachability.probe("$apiRoot/api/v1/health", "GET")
            val skew = Reachability.clockSkewMs(
                System.currentTimeMillis(),
                if (api.serverDateMs > 0) api.serverDateMs else page.serverDateMs,
            )
            probeInFlight.set(false)
            mainHandler.post {
                val view = viewRef?.get() ?: return@post
                view.render(
                    heading = BootDiagnosticsCopy.heading(reason),
                    subhead = BootDiagnosticsCopy.subhead(reason),
                    lines = staticLines(appCtx, facts) +
                        clockLine(skew) +
                        BootDiagnosticsCopy.probeLine("Page origin", pageOrigin, page) +
                        BootDiagnosticsCopy.probeLine("API", apiRoot, api),
                )
            }
            maybeReport(appCtx, reason, facts, page, api, skew)
        }
    }

    private fun clockLine(skewMs: Long?): List<BootDiagnosticsView.Line> = when {
        skewMs == null -> emptyList() // no server date — say nothing, not a guess
        Reachability.clockImplausible(skewMs) -> listOf(
            BootDiagnosticsView.Line(
                "Clock vs server",
                "off by ${skewMs / 1000}s — HTTPS may fail",
                BootDiagnosticsView.Tone.BAD,
            ),
        )
        else -> listOf(
            BootDiagnosticsView.Line(
                "Clock vs server",
                "within ${skewMs / 1000}s",
                BootDiagnosticsView.Tone.GOOD,
            ),
        )
    }

    // ─── telemetry ───────────────────────────────────────────────────

    /**
     * Report the diagnostic to the fleet, at most once per
     * [REPORT_COOLDOWN_MS] per process.
     *
     * ⚠️ MANIFEST CACHE (CLAUDE.md "Manifest content cache"). The server
     * writes this into Screen columns that are listed in
     * `SCREEN_TELEMETRY_ONLY_FIELDS`, so the write does NOT bump the
     * process-wide manifest content rev. Adding a column here without that
     * entry silently re-creates the 25 GB/mo Supabase egress bug.
     */
    private fun maybeReport(
        ctx: Context,
        reason: BootFailureReason,
        facts: BootFacts,
        page: Reachability.Result,
        api: Reachability.Result,
        skewMs: Long?,
    ) {
        val nowMs = android.os.SystemClock.elapsedRealtime()
        if (lastReportAtMs != 0L && nowMs - lastReportAtMs < REPORT_COOLDOWN_MS) return
        lastReportAtMs = nowMs
        val fp = fingerprint(ctx)
        if (fp.isNullOrBlank()) {
            PlayerLogger.w(TAG, "no device fingerprint yet — diagnostic not reported to the fleet")
            return
        }
        val detail = JSONObject().apply {
            put("reason", reason.name)
            put("clientBooted", facts.clientBooted)
            put("registerAttempted", facts.registerAttempted)
            facts.lastFailureClass?.let { put("failureClass", it.wire) }
            facts.lastFailureStatus?.let { put("failureStatus", it) }
            facts.lastFailureMessage?.let { put("failureMessage", it.take(200)) }
            put("consecutiveTransportFailures", facts.consecutiveTransportFailures)
            put("pageOrigin", JSONObject().apply {
                put("class", page.cls); put("ms", page.ms)
                page.status?.let { put("status", it) }
            })
            put("api", JSONObject().apply {
                put("class", api.cls); put("ms", api.ms)
                api.status?.let { put("status", it) }
            })
            skewMs?.let { put("clockSkewMs", it) }
            put("playerVersion", BuildConfig.VERSION_NAME)
        }
        BootDiagnosticsReporter.post(ApiRoot.resolve(ctx), fp, reason.name, detail)
    }

    // ─── small helpers ───────────────────────────────────────────────

    private fun originOf(url: String): String = try {
        val u = java.net.URL(url)
        if (u.port >= 0) "${u.protocol}://${u.host}:${u.port}" else "${u.protocol}://${u.host}"
    } catch (_: Throwable) {
        url
    }

    private fun fingerprint(ctx: Context): String? = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("device_fingerprint", null)
    } catch (_: Throwable) {
        null
    }

    private fun managerVersion(ctx: Context): String? = try {
        ctx.packageManager.getPackageInfo("com.educms.manager", 0).versionName
    } catch (_: Throwable) {
        null
    }

    /**
     * WHY SHAREDPREFERENCES AND NOT `DeviceStore`. DeviceStore's own header
     * declares it LEGACY and asks for no new writers; `edu_player` is the
     * canonical native prefs file that MainActivity, ApiRoot, the OTA
     * worker and the token store already share, and this value has to be
     * readable synchronously on the main thread while rendering the card
     * (DataStore is a coroutine Flow). Wall clock on purpose: it is a
     * timestamp a human reads, never a deadline input.
     */
    private fun persistLastRegisterOk(ctx: Context, wallMs: Long) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_LAST_REGISTER_OK, wallMs).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist last-register-ok: ${t.message}")
        }
    }

    private fun readLastRegisterOk(ctx: Context): Long = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_REGISTER_OK, 0L)
    } catch (_: Throwable) {
        0L
    }
}

/**
 * The words. Pure, so the honesty rules (player rule 10 — copy states what
 * the evidence proves) are unit-testable rather than aspirational.
 */
internal object BootDiagnosticsCopy {

    fun heading(reason: BootFailureReason): String = when (reason) {
        BootFailureReason.NO_CLIENT_BOOT -> "The page loaded but the player never started"
        BootFailureReason.NO_REGISTER_ATTEMPT -> "The player started but never contacted the server"
        BootFailureReason.NO_REGISTER_RESULT -> "The server has not answered this screen"
        BootFailureReason.REPEATED_TRANSPORT_FAILURE -> "This screen cannot reach the server"
    }

    /**
     * ⚠️ NO CAUSES WE CANNOT SEE. "The page loaded" is provable (we got a
     * document); "the player never started" is provable (no boot proof).
     * "The Wi-Fi is bad", "the server is down" and "the screen is frozen"
     * are not, and none of them appear here.
     */
    fun subhead(reason: BootFailureReason): String = when (reason) {
        BootFailureReason.NO_CLIENT_BOOT ->
            "No client-side code reported running within ${BootDeadlines.CLIENT_BOOT_MS / 1000}s of the page loading."
        BootFailureReason.NO_REGISTER_ATTEMPT ->
            "No registration request was sent within ${BootDeadlines.REGISTER_ATTEMPT_MS / 1000}s of the page loading."
        BootFailureReason.NO_REGISTER_RESULT ->
            "A registration request was sent and nothing came back within ${BootDeadlines.REGISTER_RESULT_MS / 1000}s."
        BootFailureReason.REPEATED_TRANSPORT_FAILURE ->
            "${BootDeadlines.CONSECUTIVE_TRANSPORT_FAILURES} registration attempts in a row failed before reaching the server."
    }

    /** One probe rendered as label + verdict + round-trip. */
    fun probeLine(
        label: String,
        target: String,
        result: Reachability.Result,
    ): List<BootDiagnosticsView.Line> {
        val verdict = when (result.cls) {
            "ok" -> "reachable (${result.status}) ${result.ms}ms"
            "http" -> "HTTP ${result.status} ${result.ms}ms"
            "dns" -> "name not resolved (DNS) ${result.ms}ms"
            "tls" -> "certificate rejected (${result.detail ?: "TLS"}) ${result.ms}ms"
            "timeout" -> "no answer in ${result.ms}ms"
            "network" -> "no route (${result.detail ?: "network"}) ${result.ms}ms"
            else -> "${result.detail ?: "unknown"} ${result.ms}ms"
        }
        val tone = when (result.cls) {
            "ok" -> BootDiagnosticsView.Tone.GOOD
            "http" -> BootDiagnosticsView.Tone.WARN
            else -> BootDiagnosticsView.Tone.BAD
        }
        return listOf(
            BootDiagnosticsView.Line(label, verdict, tone),
            BootDiagnosticsView.Line("", hostOf(target), BootDiagnosticsView.Tone.NEUTRAL),
        )
    }

    private fun hostOf(url: String): String = try {
        java.net.URL(url).host ?: url
    } catch (_: Throwable) {
        url
    }

    /** Never "unknown" dressed up as a time. */
    fun lastRegistered(wallMs: Long): String =
        if (wallMs <= 0L) "never on this device" else stamp(wallMs)

    fun clockNow(): String = stamp(System.currentTimeMillis()) + " " +
        java.util.TimeZone.getDefault().id

    private fun stamp(wallMs: Long): String = try {
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(wallMs))
    } catch (_: Throwable) {
        wallMs.toString()
    }
}
