package com.educms.player.face

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.NativeBridgeChannel

/**
 * WHICH FACES THIS BOX IS ACTUALLY PRESENTING — the Activity-owned half of
 * the double-sided host (2026-09-16).
 *
 * Enumerates displays, applies [FaceDisplayMap], attaches and detaches
 * [FacePresentation]s, watches hot-plug, and publishes the honest result to
 * [FaceHostRegistry] so the probe can report it (contract §6).
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ INERT BY DEFAULT — READ THIS BEFORE ENABLING IT
 * ═════════════════════════════════════════════════════════════════════
 * [requestedFaceCount] answers 1 (the primary alone) unless the
 * `edu_player`/`face_count` key says otherwise, so on EVERY screen in the
 * fleet this controller enumerates displays, hosts nothing, publishes a
 * snapshot and stops. Behaviour is byte-for-byte unchanged, including on a
 * DH43 that has an eligible HDMI panel sitting right there.
 *
 * That is deliberate, and the reason is a real, unshipped dependency: the
 * WEB half of the per-face storage namespace is NOT wired yet. Both faces
 * load the same origin in the same process and therefore share ONE
 * `localStorage`; `apps/web/src/app/player/faceStorage.ts` exists and is
 * tested, but `page.tsx` still reads the bare literals. Hosting a second
 * face before that lands would have face B's mint overwrite face A's
 * credential (`persistDeviceToken` writes the token key unconditionally),
 * the server would answer 401 because a token's `sub` is bound to a screen
 * id, and BOTH panes would settle into a mutual 401 loop — content-dead
 * screens whose native heartbeat still reports ONLINE, which is the exact
 * 1.1.6 signature. Turning this on early would not degrade one face; it
 * would take down both.
 *
 * So: the native host lands first and dormant, the web namespace lands
 * second, and the key is what joins them. Nothing sets `face_count` today.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ NEVER SILENTLY REASSIGN A FACE (contract §1)
 * ═════════════════════════════════════════════════════════════════════
 * A face with no eligible panel is reported as a SHORTFALL and left
 * unhosted. Sliding face 2 onto the panel face 1 is already using would put
 * the wrong content on a piece of glass and tell nobody.
 */
class FaceHostController(
    private val activity: Activity,
    /** BOX-level fact, shared on purpose — one ConnectivityManager registration. */
    private val isNetworkUp: () -> Boolean,
) {

    private companion object {
        const val TAG = "FaceHostController"
        const val PREFS_NAME = "edu_player"

        /**
         * How many faces this box hosts, primary included. Absent = 1, and
         * absent is the state of every deployed screen. See the class header
         * for why the default is the safe one.
         */
        const val KEY_FACE_COUNT = "face_count"

        /**
         * How long a face that failed the isolation proof stays refused. Long
         * enough that a bad web deploy cannot thrash a WebView, short enough
         * that the fix reaches the glass without anyone touching the box.
         */
        const val ISOLATION_RETRY_MS = 10 * 60_000L

        /**
         * An HDMI re-seat bounces the display list several times in a
         * fraction of a second. Debounce so one cable wiggle is one sync,
         * not six teardowns.
         */
        const val HOTPLUG_DEBOUNCE_MS = 1_500L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val hosts = mutableMapOf<Int, FacePlayerHost>()

    /**
     * face → the displayId its Presentation was ACTUALLY shown on. Written only
     * after `window.show()` succeeds, removed on every exit. It is the single
     * source for what sync() reconciles against, what the interlock is told is
     * live, and what publish() reports.
     */
    private val boundDisplayIds = mutableMapOf<Int, Int>()

    /** face → elapsedRealtime when its page last failed to prove isolation. */
    private val isolationFailedAtMs = mutableMapOf<Int, Long>()

    private fun isolationBlocked(now: Long = SystemClock.elapsedRealtime()): Set<Int> =
        isolationFailedAtMs.filterValues { now - it < ISOLATION_RETRY_MS }.keys.toSet()
    private val windows = mutableMapOf<Int, FacePresentation>()
    private var started = false

    private val resync = Runnable {
        runCatching { sync() }.onFailure { PlayerLogger.e(TAG, "hot-plug re-sync failed", it) }
    }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = debounceSync("display $displayId added")
        override fun onDisplayRemoved(displayId: Int) = debounceSync("display $displayId removed")
        override fun onDisplayChanged(displayId: Int) = debounceSync("display $displayId changed")
    }

    // ─── lifecycle ───────────────────────────────────────────────────

    fun start() {
        if (started) return
        started = true
        runCatching {
            displayManager()?.registerDisplayListener(displayListener, mainHandler)
        }.onFailure { PlayerLogger.w(TAG, "could not watch displays: ${it.message}") }
        sync()
    }

    fun stop() {
        started = false
        mainHandler.removeCallbacks(resync)
        runCatching { displayManager()?.unregisterDisplayListener(displayListener) }
        for (face in hosts.keys.toList()) detach(face, "controller stopped")
        reportHostedFaces()
        publish()
    }

    fun onResume() {
        for (h in hosts.values) runCatching { h.onResume() }
    }

    fun onPause() {
        for (h in hosts.values) runCatching { h.onPause() }
    }

    /** Fan a reload out to every hosted face. The primary is NOT included. */
    fun reloadAll(reason: String) {
        for (h in hosts.values) runCatching { h.reload(reason) }
    }

    fun hostFor(faceIndex: Int): FacePlayerHost? = hosts[faceIndex]

    // ─── the decision ────────────────────────────────────────────────

    /**
     * How many faces this box should host, primary included.
     *
     * Clamped to [FaceDisplayMap.MAX_FACES]; anything unreadable answers 1.
     * A corrupt value must land a screen on the ordinary single-sided path,
     * never on a face nobody configured.
     */
    fun requestedFaceCount(): Int = try {
        activity.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getInt(KEY_FACE_COUNT, 1)
            .coerceIn(1, FaceDisplayMap.MAX_FACES)
    } catch (_: Throwable) {
        1
    }

    /** The real `DisplayManager` list, reduced to the pure mapping's shape. */
    private fun currentDisplays(): List<FaceDisplay> {
        // Block body on purpose: the first cut was `= try { … ?: return … }`,
        // and Kotlin refuses a `return` inside an expression body. It was the
        // branch's one compile error — invisible for three days because nothing
        // on the machine that wrote it could compile Kotlin.
        return try {
            val dm = displayManager()
            if (dm == null) emptyList() else dm.displays.orEmpty().map { d ->
            val flags = d.flags
            val size = android.graphics.Point()
            @Suppress("DEPRECATION")
            runCatching { d.getRealSize(size) }
            FaceDisplay(
                displayId = d.displayId,
                name = d.name ?: "",
                widthPx = size.x,
                heightPx = size.y,
                // ⚠️ The masks are applied in ONE place so the native
                // predicate cannot drift from the probe's — which is what
                // stops the device and the dashboard disagreeing about
                // whether a second panel exists (contract §1).
                isPresentation = (flags and FaceDisplayMap.FLAG_PRESENTATION) != 0,
                isPrivate = (flags and FaceDisplayMap.FLAG_PRIVATE) != 0,
                stateOn = d.state == Display.STATE_ON,
            )
        }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not enumerate displays: ${t.message}")
            emptyList()
        }
    }

    /**
     * Reconcile hosted faces with the panels that actually exist.
     *
     * Idempotent: a face already hosted on the right display is left alone,
     * because tearing a window down and rebuilding it costs that pane a cold
     * boot every time a cable is touched.
     */
    fun sync() {
        if (!started) return
        val all = currentDisplays()
        val requestedFaces = (1 until requestedFaceCount()).toList()

        // Decided by pure math (FaceHostPlan) against the displays each window
        // is ACTUALLY on — never against "is face N in the map", which is what
        // left a re-enumerated panel dark forever.
        val plan = FaceHostPlan.reconcile(all, requestedFaces, boundDisplayIds.toMap(), isolationBlocked())
        for (d in plan.detach) detach(d.face, d.why)
        for (a in plan.attach) attach(a.face, a.displayId)

        reportHostedFaces()
        publish(all, requestedFaces)
    }

    /**
     * Tell the two things that must know WHICH faces are live.
     *
     * The emergency interlock bounds hold membership to hosted faces and moves a
     * departed face's membership to the primary (DisplayEmergency.setLiveFaces).
     * The bridge channel only uses its separate alert lane when a second face
     * can actually contend for it, so a single-sided screen — the whole fleet —
     * keeps master's exact scheduling.
     */
    private fun reportHostedFaces() {
        val live = boundDisplayIds.keys.toSet()
        runCatching { DisplayEmergency.setLiveFaces(activity.applicationContext, live) }
            .onFailure { PlayerLogger.w(TAG, "could not report hosted faces to the interlock: ${it.message}") }
        runCatching { NativeBridgeChannel.setMultiFace(live.isNotEmpty()) }
    }

    private fun attach(faceIndex: Int, displayId: Int) {
        val display = runCatching { displayManager()?.getDisplay(displayId) }.getOrNull()
        if (display == null) {
            PlayerLogger.w(TAG, "face $faceIndex: display $displayId vanished before attach")
            return
        }
        runCatching {
            val host = FacePlayerHost(
                activity = activity,
                faceIndex = faceIndex,
                display = display,
                isNetworkUp = isNetworkUp,
                onIsolationFailed = { why ->
                    // Off the WebView callback, onto the controller's thread.
                    mainHandler.post {
                        isolationFailedAtMs[faceIndex] = SystemClock.elapsedRealtime()
                        detach(faceIndex, "its page did not prove storage isolation ($why)")
                        reportHostedFaces()
                        publish()
                    }
                },
            )
            val window = FacePresentation(
                activity = activity,
                display = display,
                host = host,
                // ⚠️ UNBIND FIRST. The system can dismiss a Presentation while its
                // display still exists with the same id (a mode change). Left
                // bound, the plan would see "face on the right panel", do
                // nothing, and the pane would stay dark through every re-sync.
                onDismissed = {
                    if (boundDisplayIds.remove(faceIndex) != null) {
                        windows.remove(faceIndex)
                        runCatching { hosts.remove(faceIndex)?.destroy() }
                    }
                    debounceSync("face $faceIndex window dismissed")
                },
            )
            window.show()
            hosts[faceIndex] = host
            windows[faceIndex] = window
            // The BINDING, recorded only once the window is really up. This is
            // what sync() compares against and what publish() reports.
            boundDisplayIds[faceIndex] = displayId
            PlayerLogger.i(TAG, "face $faceIndex is now hosted on display $displayId")
        }.onFailure {
            // Contract §3 — a face that cannot be hosted is a reported
            // shortfall, never an exception that reaches the Activity.
            PlayerLogger.e(TAG, "face $faceIndex could not be hosted on display $displayId", it)
            runCatching { windows.remove(faceIndex)?.dismiss() }
            runCatching { hosts.remove(faceIndex)?.destroy() }
            // Unbound ⇒ FaceHostPlan.shortfall reports it as
            // "panel-present-but-host-failed". The first cut reported it as
            // nothing at all.
            boundDisplayIds.remove(faceIndex)
        }
    }

    private fun detach(faceIndex: Int, why: String) {
        PlayerLogger.i(TAG, "face $faceIndex detached — $why")
        // The hold is deliberately NOT touched here or in destroy(): sync()
        // reports the face gone and the interlock moves its membership to the
        // primary. See DisplayEmergency.setLiveFaces.
        boundDisplayIds.remove(faceIndex)
        runCatching { hosts.remove(faceIndex)?.destroy() }
        runCatching { windows.remove(faceIndex)?.dismiss() }
    }

    private fun publish(
        all: List<FaceDisplay> = currentDisplays(),
        requestedFaces: List<Int> = (1 until requestedFaceCount()).toList(),
    ) {
        runCatching {
            val bound = boundDisplayIds.toMap()
            val shortfall = FaceHostPlan.shortfall(
                all, requestedFaces, bound,
                isolationBlocked().associateWith { FaceHostPlan.REASON_NOT_ISOLATED },
            )
            FaceHostRegistry.publish(
                // The primary is always requested and always hosted — it is
                // the Activity's own display and needs no Presentation.
                requested = listOf(0) + requestedFaces,
                // The display each window IS ON — not what the map would pick now.
                hosted = bound,
                shortfall = shortfall.keys.toList(),
                reason = FaceHostPlan.summaryReason(shortfall),
                nowMs = SystemClock.elapsedRealtime(),
            )
        }.onFailure { PlayerLogger.w(TAG, "publish failed: ${it.message}") }
    }

    private fun debounceSync(why: String) {
        PlayerLogger.i(TAG, "display topology changed ($why) — re-syncing faces")
        mainHandler.removeCallbacks(resync)
        mainHandler.postDelayed(resync, HOTPLUG_DEBOUNCE_MS)
    }

    private fun displayManager(): DisplayManager? =
        activity.applicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
}
