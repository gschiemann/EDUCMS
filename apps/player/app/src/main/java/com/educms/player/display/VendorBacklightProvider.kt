package com.educms.player.display

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.DeadObjectException
import android.os.IBinder
import android.os.Looper
import android.os.Parcel
import android.os.SystemClock
import android.provider.Settings
import com.educms.player.display.VendorBacklightPolicy.Detection
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Future
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

/**
 * BLANK / WAKE through the panel vendor's own backlight service (player
 * 1.1.52) — the Android half of [VendorBacklightPolicy] / [VendorBacklightEngine].
 *
 * On a Goodview GUQ (Amlogic t982, IFPDOS firmware) the MCU that drives the
 * panel is reachable through one exported bound service, exactly the way the
 * vendor's own player reaches it: `bindService("com.ifpdos.opensdk
 * .SERVICE_MANAGER" @ com.seewo.mcuservice)` → `getService("opensdk")` →
 * `getToken(ourPackage)` → `sendMessage(token, json)`. `CmdSetScreenStatus
 * (false)` switches the BACKLIGHT off while Android, this process, the
 * WebView and the native alert watch keep running; `(true)` lights it again.
 * That is a dark panel whose page is ALIVE — the thing the standby-alert hole
 * (`project_standby_alert_hole_2026_10_05`) needed.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES AND DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────
 *  • Every binder call runs on ONE worker thread with a budget; a caller on
 *    the registry waits for the worker's answer with a timeout and never
 *    longer ([apply]). A caller on the MAIN thread never waits for a bind
 *    (the bind's own callback needs the main looper) — it fails through.
 *  • [emergencyOn] queues the ON and returns at once. `DisplayEmergency
 *    .enforceNow` calls it before its first window hook (rule 3).
 *  • The blank ALSO raises the player's own black overlay, as the software
 *    floor does: belt and braces for a firmware whose MCU accepts the command
 *    and leaves the glass lit. `FLAG_KEEP_SCREEN_ON` is NOT dropped — Android
 *    must stay awake behind the dark backlight; that is the whole point.
 *  • The dark record (`vendor_backlight_dark`) is persisted with the boot
 *    count, like `UserStandby`: a reboot resets the MCU, so a record from a
 *    previous boot says nothing. [isDarkByUs] feeds the native alert watch,
 *    which treats a vendor-dark panel as a dark panel and polls.
 *  • No bridge method is added. BLANK / WAKE arrive through `displayApply`
 *    and resolve to this provider inside `DisplayControlRegistry` natively.
 *
 * Reached only through [DisplayControlRegistry.apply] (the emergency gate
 * refuses every BLANK while a hold is engaged) and through
 * [DisplayEmergency.enforceNow] in the ON direction only.
 */
object VendorBacklightProvider : DisplayControlProvider {

    private const val TAG = "VendorBacklight"
    private const val PREFS = "edu_player"
    private const val KEY_SEEN = "vendor_backlight_seen"
    private const val KEY_DARK = "vendor_backlight_dark"
    private const val KEY_DARK_BOOT_COUNT = "vendor_backlight_dark_boot_count"
    private const val KEY_LAST_OUTCOME = "vendor_backlight_last_blank_outcome"

    // A LITERAL, not `VendorBacklightPolicy.PROVIDER_ID`: the API's drift guard
    // (`display-mechanism-drift.spec.ts`) parses this line to pin the server's
    // mechanism enum to the device's ids. VendorBacklightWiringTest holds the
    // two equal.
    override val id: String = "vendor-backlight"

    private val lock = Any()

    @Volatile private var app: Context? = null
    @Volatile private var engine: VendorBacklightEngine? = null
    @Volatile private var ports: AndroidPorts? = null
    @Volatile private var lastBlankOutcome: String? = null

    /** One worker. A call that outlives its budget is abandoned here and the worker replaced ([replaceWorker]). */
    private var worker: ScheduledThreadPoolExecutor = newWorker()

    private fun newWorker() = ScheduledThreadPoolExecutor(1) { r ->
        Thread(r, "vendor-backlight").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }

    // ─── wiring ──────────────────────────────────────────────────────

    /**
     * Called once from `PlayerApp.onCreate`. Restores the dark record, then
     * probes the service on the worker; a finished probe re-resolves the
     * display registry so the chain picks this mechanism up without a
     * restart. Never throws, never blocks the caller.
     */
    fun start(ctx: Context) {
        val a = ctx.applicationContext
        synchronized(lock) {
            if (engine != null) return
            app = a
            val p = AndroidPorts(a)
            ports = p
            engine = VendorBacklightEngine(p).also { e ->
                e.restoreDark(readDark(a))
                lastBlankOutcome = runCatching { prefs(a).getString(KEY_LAST_OUTCOME, null) }.getOrNull()
            }
        }
        submitQuietly("probe") { probeAndResolve(a, attempt = 1) }
    }

    private fun probeAndResolve(a: Context, attempt: Int) {
        val e = engine ?: return
        val before = e.detection
        val after = runCatching { e.probeIfDue() }.getOrElse {
            PlayerLogger.w(TAG, "probe threw: ${it.message}")
            e.detection
        }
        if (after != before || after == Detection.AVAILABLE) {
            runCatching { DisplayControlRegistry.invalidate() }
        }
        if (after == Detection.UNREACHABLE && attempt < VendorBacklightPolicy.MAX_PROBES) {
            runCatching {
                worker.schedule({ probeAndResolve(a, attempt + 1) }, VendorBacklightPolicy.PROBE_RETRY_MS, TimeUnit.MILLISECONDS)
            }
        }
    }

    // ─── DisplayControlProvider ──────────────────────────────────────

    override fun supports(ctx: Context): Set<Capability> {
        val e = engine ?: return emptySet()
        val a = ctx.applicationContext
        return VendorBacklightPolicy.supports(
            detection = e.detection,
            seenBefore = seenBefore(a),
            killSwitchOff = runCatching { DisplayConfigStore.load(a).vendorBacklightDisabled }.getOrDefault(false),
            faulted = e.faulted != null,
        )
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        val e = engine ?: return ActionResult.Unsupported("vendor backlight not started")
        val a = ctx.applicationContext
        // ── THE MAIN THREAD BEFORE THE SERVICE IS CONNECTED ──
        // A bind's callback needs the main looper, so a main-thread caller
        // (the AlarmManager scheduler, `onWindowAttached`'s re-apply at process
        // start) cannot wait for one. Such a call is DEFERRED to the worker
        // instead of failed through: at process start the panel is already
        // dark by the MCU's hand and the persisted blank re-applies itself the
        // moment the service answers — handing it to the screen-off timeout
        // would turn a vendor-dark panel with a live page into an Android-asleep
        // one. A deferred BLANK that then fails hands itself to the rest of the
        // chain (never a latch-prone lock); a deferred WAKE reports Failed so
        // the chain's wake runs meanwhile, and the vendor ON still follows.
        if (onMainThread() && ports?.connected() != true &&
            (action == DisplayAction.Blank || action == DisplayAction.Wake)
        ) {
            if (action == DisplayAction.Blank && Capability.BLANK !in supports(a)) {
                return ActionResult.Unsupported("vendor backlight is not available for blank on this box")
            }
            PlayerLogger.w(TAG, "${action.describe()} asked on the main thread before the control service is connected — deferred to the worker")
            submitQuietly("deferred ${action.describe()}") { deferredApply(a, e, action) }
            return if (action == DisplayAction.Blank) {
                ActionResult.Ok(id, "deferred — applying when the vendor service connects")
            } else {
                ActionResult.Failed("the vendor service is not connected yet — the ON follows when it is", id)
            }
        }
        return when (action) {
            DisplayAction.Blank -> {
                if (Capability.BLANK !in supports(a)) {
                    return ActionResult.Unsupported("vendor backlight is not available for blank on this box")
                }
                when (val step = onWorker("blank") { e.blank() }) {
                    is VendorBacklightEngine.Step.Ok -> {
                        val outcome = VendorBacklightPolicy.blankOutcome(step.backlightOff)
                        lastBlankOutcome = outcome
                        runCatching { prefs(a).edit().putString(KEY_LAST_OUTCOME, outcome).apply() }
                        // Belt and braces: black under a backlight the MCU may
                        // not have switched off. Refused on the UI thread while
                        // a hold is engaged (DisplayEmergency.blocksBlackout).
                        DisplayWindowBridge.withHooks { it.setBlackout(true) }
                        ActionResult.Ok(id, "backlight off" + (step.backlightOff?.let { if (it) " (vendor confirms)" else " (vendor still reads on)" } ?: ""))
                    }
                    is VendorBacklightEngine.Step.Failed -> ActionResult.Failed(step.reason, id)
                    null -> ActionResult.Failed("vendor backlight worker did not answer in time", id)
                }
            }
            DisplayAction.Wake -> {
                // Un-hide first, whatever the MCU says — this is the recovery direction.
                val attached = DisplayWindowBridge.withHooks { h ->
                    h.setBlackout(false)
                    h.setKeepScreenOn(true)
                    h.requestWake()
                }
                when (val step = onWorker("wake") { e.wake() }) {
                    is VendorBacklightEngine.Step.Ok -> ActionResult.Ok(id, if (attached) "backlight on" else "backlight on — no window attached")
                    is VendorBacklightEngine.Step.Failed -> ActionResult.Failed(step.reason, id)
                    null -> ActionResult.Failed("vendor backlight worker did not answer in time", id)
                }
            }
            else -> ActionResult.Unsupported("vendor-backlight only handles blank/wake")
        }
    }

    private fun onMainThread(): Boolean =
        runCatching { Looper.myLooper() == Looper.getMainLooper() }.getOrDefault(false)

    /**
     * A main-thread BLANK / WAKE that arrived before the service was connected,
     * now on the worker (see [apply]). The emergency gate is re-checked: a
     * deferred blank must not land under a hold that engaged in the meantime.
     */
    private fun deferredApply(a: Context, e: VendorBacklightEngine, action: DisplayAction) {
        when (action) {
            DisplayAction.Blank -> {
                if (DisplayEmergency.isHeld(a) || !DisplayPrefs.blanked(a)) {
                    PlayerLogger.i(TAG, "deferred blank dropped — ${if (DisplayEmergency.isHeld(a)) "an emergency hold is engaged" else "the screen is no longer meant to be blank"}")
                    return
                }
                val step = e.blank()
                if (step is VendorBacklightEngine.Step.Ok) {
                    val outcome = VendorBacklightPolicy.blankOutcome(step.backlightOff)
                    lastBlankOutcome = outcome
                    runCatching { prefs(a).edit().putString(KEY_LAST_OUTCOME, outcome).apply() }
                    runCatching { SleepProof.expect(a, id) }
                    DisplayWindowBridge.withHooks { it.setBlackout(true) }
                    return
                }
                // Hand the blank to the rest of the chain — never back to this
                // provider, and never a latch-prone lock (rule 6).
                PlayerLogger.w(TAG, "deferred blank did not take ($step) — handing it to the next mechanism")
                runCatching {
                    DisplayControlRegistry.apply(a, DisplayAction.Blank, revertAfterMs = null, allowProvider = { next ->
                        next != id && com.educms.player.standby.RestoreBlankPolicy.allows(
                            next, android.os.Build.VERSION.SDK_INT, android.os.Build.MODEL,
                        )
                    })
                }
            }
            DisplayAction.Wake -> {
                if (e.wake() is VendorBacklightEngine.Step.Ok) {
                    DisplayWindowBridge.withHooks { h ->
                        h.setBlackout(false)
                        h.setKeepScreenOn(true)
                    }
                }
            }
            else -> Unit
        }
    }

    /**
     * Run [work] on the worker and wait for it, bounded. Never reached from the
     * main thread while the service is unconnected ([apply] defers that case),
     * so the wait can only ever be for a command, never for a bind callback.
     */
    private fun <T> onWorker(what: String, work: () -> T): T? {
        val future: Future<T> = try {
            synchronized(lock) { worker.submit(work) }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "$what could not be queued: ${t.message}")
            return null
        }
        return try {
            future.get(VendorBacklightPolicy.APPLY_BUDGET_MS + 200L, TimeUnit.MILLISECONDS)
        } catch (t: TimeoutException) {
            PlayerLogger.e(TAG, "$what did not finish within its budget — abandoning that call and replacing the worker")
            future.cancel(true)
            replaceWorker()
            null
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "$what failed: ${t.message}")
            null
        }
    }

    private fun replaceWorker() {
        synchronized(lock) {
            runCatching { worker.shutdownNow() }
            worker = newWorker()
        }
    }

    private fun submitQuietly(what: String, work: () -> Unit) {
        runCatching { synchronized(lock) { worker.execute { runCatching(work).onFailure { PlayerLogger.w(TAG, "$what failed: ${it.message}") } } } }
            .onFailure { PlayerLogger.w(TAG, "$what could not be queued: ${it.message}") }
    }

    // ─── emergency (rule 3) ──────────────────────────────────────────

    /**
     * The alert path's first act: ask the MCU for the backlight ON, on the
     * worker, and return at once. Nothing that draws the alert waits for it.
     */
    fun emergencyOn(ctx: Context, quiet: Boolean) {
        val e = engine ?: return
        runCatching { e.emergencyOn(quiet, seenBefore(ctx.applicationContext)) }
            .onFailure { PlayerLogger.e(TAG, "emergency ON could not be queued", it) }
    }

    // ─── facts ───────────────────────────────────────────────────────

    /** Is the backlight off because WE turned it off, in THIS boot? */
    fun isDarkByUs(): Boolean = engine?.dark == true

    /** What the last vendor blank proved (SleepProofPolicy outcome), or null. */
    fun lastBlankOutcome(): String? = lastBlankOutcome

    /**
     * The kill switch moved, or a new display block landed. If the mechanism
     * is now disabled while the backlight is off by our hand, light it and
     * hand the blank to the next mechanism in the chain — a kill switch must
     * never strand a panel dark.
     */
    fun onConfigChanged(ctx: Context) {
        val a = ctx.applicationContext
        val e = engine ?: return
        val disabled = runCatching { DisplayConfigStore.load(a).vendorBacklightDisabled }.getOrDefault(false)
        if (!disabled || !e.dark) return
        PlayerLogger.w(TAG, "vendor backlight disabled by the kill switch while the backlight is off — turning it on and re-blanking through the remaining chain")
        submitQuietly("kill-switch") {
            val step = e.wake()
            if (step !is VendorBacklightEngine.Step.Ok) return@submitQuietly
            if (DisplayPrefs.blanked(a) && !DisplayEmergency.isHeld(a)) {
                runCatching { DisplayControlRegistry.apply(a, DisplayAction.Blank, revertAfterMs = null) }
            }
        }
    }

    /** Compact facts for the native runtime report (`sleep.vb`): detection, dark, fault. Null when the vendor package is absent. */
    fun reportJson(): JSONObject? {
        val e = engine ?: return null
        if (e.detection == Detection.ABSENT) return null
        val out = JSONObject().put("d", e.detection.wire).put("off", e.dark)
        e.faulted?.let { out.put("f", it.take(40)) }
        return out
    }

    // ─── prefs ───────────────────────────────────────────────────────

    private fun prefs(a: Context) = a.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun seenBefore(a: Context): Boolean = runCatching { prefs(a).getBoolean(KEY_SEEN, false) }.getOrDefault(false)

    private fun bootCount(a: Context): Int = runCatching {
        Settings.Global.getInt(a.contentResolver, Settings.Global.BOOT_COUNT, -1)
    }.getOrDefault(-1)

    /** The dark record counts only inside the boot it was written in: a reboot resets the MCU. */
    private fun readDark(a: Context): Boolean = runCatching {
        val p = prefs(a)
        p.getBoolean(KEY_DARK, false) && p.getInt(KEY_DARK_BOOT_COUNT, -2) == bootCount(a)
    }.getOrDefault(false)

    // ─── the Android ports ───────────────────────────────────────────

    private class AndroidPorts(private val a: Context) : VendorBacklightEngine.Ports {

        private val managerRef = AtomicReference<IBinder?>(null)
        private val sdkRef = AtomicReference<IBinder?>(null)
        @Volatile private var token: String? = null
        @Volatile private var bindLatch: CountDownLatch? = null
        @Volatile private var bound = false

        private val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                managerRef.set(service)
                bindLatch?.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                managerRef.set(null)
                sdkRef.set(null)
                token = null
            }
        }

        private val death = IBinder.DeathRecipient {
            PlayerLogger.w(TAG, "the vendor control service died — it is re-bound on the next call")
            sdkRef.set(null)
            token = null
        }

        fun connected(): Boolean = sdkRef.get()?.isBinderAlive == true && token != null

        override fun nowMs(): Long = SystemClock.elapsedRealtime()

        override fun servicePackageInstalled(): Boolean = try {
            a.packageManager.getPackageInfo(VendorBacklightPolicy.SERVICE_PACKAGE, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "package lookup failed: ${t.message}")
            false
        }

        override fun connect(budgetMs: Long): VendorBacklightEngine.Connect {
            if (connected()) return VendorBacklightEngine.Connect.Ready
            val deadline = SystemClock.elapsedRealtime() + budgetMs
            fun left(): Long = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0L)
            try {
                var manager = managerRef.get()?.takeIf { it.isBinderAlive }
                if (manager == null) {
                    val latch = CountDownLatch(1)
                    bindLatch = latch
                    if (!bound) {
                        val intent = Intent(VendorBacklightPolicy.SERVICE_MANAGER_ACTION).setPackage(VendorBacklightPolicy.SERVICE_PACKAGE)
                        bound = a.bindService(intent, connection, Context.BIND_AUTO_CREATE)
                        if (!bound) return VendorBacklightEngine.Connect.Failed("bindService refused")
                    }
                    if (!latch.await(left(), TimeUnit.MILLISECONDS)) return VendorBacklightEngine.Connect.TimedOut
                    manager = managerRef.get() ?: return VendorBacklightEngine.Connect.Failed("no service manager binder")
                }
                if (left() <= 0L) return VendorBacklightEngine.Connect.TimedOut
                val sdk = getService(manager, VendorBacklightPolicy.SDK_SERVICE_NAME)
                    ?: return VendorBacklightEngine.Connect.Failed("no '${VendorBacklightPolicy.SDK_SERVICE_NAME}' service")
                runCatching { sdk.linkToDeath(death, 0) }
                sdkRef.set(sdk)
                if (left() <= 0L) return VendorBacklightEngine.Connect.TimedOut
                val t = getToken(sdk) ?: return VendorBacklightEngine.Connect.Failed("no token")
                token = t
                return VendorBacklightEngine.Connect.Ready
            } catch (t: Throwable) {
                return VendorBacklightEngine.Connect.Failed(t.javaClass.simpleName)
            }
        }

        override fun disconnect() {
            sdkRef.getAndSet(null)?.let { runCatching { it.unlinkToDeath(death, 0) } }
            token = null
            managerRef.set(null)
            if (bound) {
                runCatching { a.unbindService(connection) }
                bound = false
            }
        }

        override fun send(requestJson: String, budgetMs: Long): VendorBacklightEngine.Call {
            val sdk = sdkRef.get() ?: return VendorBacklightEngine.Call.Failed("not connected")
            val t = token ?: return VendorBacklightEngine.Call.Failed("no token")
            // The transact itself is synchronous and cannot be given a timeout;
            // the caller's bound is the worker future the provider waits on.
            // `budgetMs` is honoured as "do not even start past the deadline".
            if (budgetMs <= 0L) return VendorBacklightEngine.Call.TimedOut
            return try {
                VendorBacklightEngine.Call.Reply(sendMessage(sdk, t, requestJson))
            } catch (d: DeadObjectException) {
                VendorBacklightEngine.Call.Failed("DeadObjectException", binderDead = true)
            } catch (t: Throwable) {
                VendorBacklightEngine.Call.Failed(t.javaClass.simpleName)
            }
        }

        override fun submit(work: () -> Unit): Boolean = runCatching {
            synchronized(lock) { worker.execute { work() } }
            true
        }.getOrDefault(false)

        override fun darkChanged(dark: Boolean) {
            runCatching {
                prefs(a).edit()
                    .putBoolean(KEY_DARK, dark)
                    .putInt(KEY_DARK_BOOT_COUNT, bootCount(a))
                    .commit()
            }
            // The native alert watch treats a vendor-dark panel as a dark panel.
            runCatching { com.educms.player.alertwatch.NativeAlertWatch.kick(a, if (dark) "the vendor backlight went off" else "the vendor backlight came on") }
        }

        override fun seen() {
            runCatching { prefs(a).edit().putBoolean(KEY_SEEN, true).apply() }
        }

        override fun log(level: VendorBacklightEngine.Level, message: String) {
            when (level) {
                VendorBacklightEngine.Level.INFO -> PlayerLogger.i(TAG, message)
                VendorBacklightEngine.Level.WARN -> PlayerLogger.w(TAG, message)
                VendorBacklightEngine.Level.ERROR -> PlayerLogger.e(TAG, message)
            }
        }

        // ─── the three transactions, as the vendor's Proxy classes write them ─

        private fun getService(manager: IBinder, name: String): IBinder? {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            try {
                data.writeInterfaceToken(VendorBacklightPolicy.SERVICE_MANAGER_DESCRIPTOR)
                data.writeString(name)
                manager.transact(VendorBacklightPolicy.TX_GET_SERVICE, data, reply, 0)
                reply.readException()
                return reply.readStrongBinder()
            } finally {
                reply.recycle()
                data.recycle()
            }
        }

        private fun getToken(sdk: IBinder): String? {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            try {
                data.writeInterfaceToken(VendorBacklightPolicy.SDK_SERVICE_DESCRIPTOR)
                data.writeString(a.packageName)
                data.writeString(null)
                sdk.transact(VendorBacklightPolicy.TX_GET_TOKEN, data, reply, 0)
                reply.readException()
                return reply.readString()?.takeIf { it.isNotEmpty() }
            } finally {
                reply.recycle()
                data.recycle()
            }
        }

        private fun sendMessage(sdk: IBinder, token: String, requestJson: String): String? {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            try {
                data.writeInterfaceToken(VendorBacklightPolicy.SDK_SERVICE_DESCRIPTOR)
                data.writeString(token)
                data.writeString(requestJson)
                sdk.transact(VendorBacklightPolicy.TX_SEND_MESSAGE, data, reply, 0)
                reply.readException()
                return reply.readString()
            } finally {
                reply.recycle()
                data.recycle()
            }
        }
    }
}
