package com.educms.player.standby

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.educms.player.MainActivity
import com.educms.player.display.DisplayEmergency
import com.educms.player.display.DisplayPrefs
import com.educms.player.display.DisplayScheduler
import com.educms.player.logging.PlayerLogger
import java.lang.ref.WeakReference

/**
 * USER STANDBY — the Android half (2026-10-03, player 1.1.21). The rules are
 * [UserStandbyPolicy]; this file is the receiver, the record and the locks.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT HOLDS THE STANDBY
 * ─────────────────────────────────────────────────────────────────────
 *  • The record, in `edu_player` prefs, written with `commit()`: it must
 *    survive a process death (an OOM kill, an OTA). It is void after a
 *    reboot — [UserStandbyPolicy.recordStillValid].
 *  • MainActivity's turn-screen-on arming: the Activity registers a
 *    [Listener] and DISARMS `FLAG_TURN_SCREEN_ON` / `setTurnScreenOn` while a
 *    standby lasts. That one switch is what makes EVERY relaunch actor safe —
 *    ours, the Manager companion's, an OEM launcher's — because none of them
 *    can turn the panel on except through this Activity's own wake flags.
 *  • The relaunch paths ask [relaunchMode] and skip, or launch dark.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT KEEPS AN ALERT ABLE TO REACH A PANEL IN STANDBY
 * ─────────────────────────────────────────────────────────────────────
 * A screen in standby still has to show a lockdown. The page keeps running
 * behind the dark panel (nothing calls `WebView.pauseTimers()`; the
 * foreground HeartbeatService keeps this process alive), and the alert path
 * — WS OVERRIDE / manifest → `displayEmergencyHold(true)` →
 * [DisplayEmergency.enforceNow] — ends the standby and wakes the panel with a
 * wake lock that needs no window. NOTHING on that path consults this class.
 *
 * What was missing is the CPU: a box whose panel is off and that holds no
 * wake lock is free to suspend, and a suspended box receives nothing. Before
 * 1.1.21 the Watchdog woke the panel within 15 minutes, which incidentally
 * restored delivery; now that a standby can last all night, this holds a
 * PARTIAL wake lock for as long as it lasts (refreshed by every Watchdog
 * tick), so the page's socket and its polling keep running dark.
 */
object UserStandby {

    private const val TAG = "UserStandby"
    private const val PREFS = "edu_player"
    private const val KEY_SINCE_WALL = "user_standby_since_wall_ms"
    private const val KEY_SINCE_ELAPSED = "user_standby_since_elapsed_ms"
    private const val KEY_BOOT_COUNT = "user_standby_boot_count"
    private const val CPU_LOCK_TAG = "educms:user-standby"

    /** MainActivity hears every transition so it can disarm / re-arm its wake flags. */
    fun interface Listener {
        fun onStandbyChanged(active: Boolean)
    }

    private val lock = Any()

    @Volatile private var installed = false

    /** In-memory mirror of the record so the hot paths (every emergency re-raise) stay cheap. */
    @Volatile private var cachedActive: Boolean? = null

    /** `elapsedRealtime` when this process last started one of our own blanks; 0 = never. */
    @Volatile private var ownBlankAtElapsedMs = 0L

    @Volatile private var lastEmergencyReassertAtMs = 0L

    @Volatile private var listenerRef: WeakReference<Listener>? = null

    private var cpuLock: PowerManager.WakeLock? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> onScreenOff(context)
                Intent.ACTION_SCREEN_ON -> onScreenOn(context)
                else -> Unit
            }
        }
    }

    // ─── wiring ──────────────────────────────────────────────────────

    /**
     * Called once from `PlayerApp.onCreate`. ACTION_SCREEN_OFF / ON can only
     * be received by a runtime-registered receiver, and the APPLICATION is the
     * one context that lives as long as the process — the Activity can be
     * gone while the panel is off.
     */
    fun install(ctx: Context) {
        val app = ctx.applicationContext
        synchronized(lock) {
            if (installed) return
            installed = true
        }
        runCatching {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
            }
            // Both actions are PROTECTED system broadcasts — only the system
            // can send them — so EXPORTED grants nothing to other apps; it is
            // the flag that delivers them on every API level without the
            // compat permission shim.
            ContextCompat.registerReceiver(app, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        }.onFailure { PlayerLogger.w(TAG, "could not register the screen on/off receiver: ${it.message}") }

        // A standby that survived a process death needs its CPU lock back,
        // and a schedule trigger that fired while we were dead must still end it.
        if (isActive(app)) {
            PlayerLogger.i(TAG, "process start inside a user standby — keeping the panel off, CPU awake")
            acquireCpuLock(app)
            runCatching { DisplayScheduler.endStandbyIfScheduleTriggered(app) }
                .onFailure { PlayerLogger.w(TAG, "schedule check at process start failed: ${it.message}") }
        }
    }

    fun setListener(listener: Listener) {
        listenerRef = WeakReference(listener)
    }

    fun clearListener(listener: Listener) {
        if (listenerRef?.get() === listener) listenerRef = null
    }

    // ─── reads ───────────────────────────────────────────────────────

    /** Is a person's standby in force right now? Cheap when it is not. */
    fun isActive(ctx: Context): Boolean = activeRecord(ctx) != null

    /** The standby record, validated, or null. A stale record is cleared on the way out. */
    fun activeRecord(ctx: Context): StandbyRecord? {
        if (cachedActive == false) return null
        val app = ctx.applicationContext
        val record = readRecord(app)
        if (record == null) {
            cachedActive = false
            return null
        }
        val valid = UserStandbyPolicy.recordStillValid(
            record = record,
            nowElapsedMs = SystemClock.elapsedRealtime(),
            nowBootCount = bootCount(app),
            screenInteractive = screenInteractive(app),
        )
        if (!valid) {
            exit(app, "the record is stale (the panel is on, or the device rebooted)")
            return null
        }
        cachedActive = true
        return record
    }

    /** What a relaunch path may do right now. Never throws. */
    fun relaunchMode(ctx: Context): RelaunchMode = runCatching {
        UserStandbyPolicy.relaunchMode(isActive(ctx), MainActivity.isAlive)
    }.getOrDefault(RelaunchMode.NORMAL)

    // ─── writes ──────────────────────────────────────────────────────

    /**
     * One of OUR blanks is about to run. Called by the registry BEFORE the
     * provider, so the ACTION_SCREEN_OFF a device-admin lock fires right away
     * is never read as a person's remote.
     */
    fun noteOwnBlank() {
        ownBlankAtElapsedMs = SystemClock.elapsedRealtime()
    }

    /**
     * End a standby, if one is in force. Idempotent and cheap when none is.
     *
     * Every caller is a deliberate "be visible": a WAKE command, the
     * schedule's ON trigger, an emergency, the person pressing power. The
     * caller wakes the panel itself; this only clears the record, releases the
     * CPU lock and re-arms MainActivity's wake flags.
     */
    fun end(ctx: Context, reason: String): Boolean {
        if (cachedActive == false) return false
        val app = ctx.applicationContext
        if (readRecord(app) == null) {
            cachedActive = false
            return false
        }
        exit(app, reason)
        return true
    }

    /** MainActivity resumed. A resumed Activity with the panel on means the standby is over. */
    fun onActivityResumed(ctx: Context) {
        if (cachedActive == false) return
        val app = ctx.applicationContext
        if (screenInteractive(app)) end(app, "the player came back on the glass")
    }

    /** Every Watchdog tick: keep the CPU lock fresh and catch a schedule trigger an alarm missed. */
    fun onWatchdogTick(ctx: Context) {
        val app = ctx.applicationContext
        if (!isActive(app)) return
        acquireCpuLock(app)
        runCatching { DisplayScheduler.endStandbyIfScheduleTriggered(app) }
            .onFailure { PlayerLogger.w(TAG, "schedule check on the watchdog tick failed: ${it.message}") }
    }

    // ─── the receiver ────────────────────────────────────────────────

    internal fun onScreenOff(ctx: Context) {
        val app = ctx.applicationContext
        val now = SystemClock.elapsedRealtime()
        val ownAt = ownBlankAtElapsedMs
        val pausedAt = MainActivity.lastPausedBySleepAtMs
        val facts = ScreenOffFacts(
            emergencyHeld = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(false),
            ourBlankInForce = DisplayPrefs.blanked(app),
            sinceOwnBlankMs = if (ownAt > 0L) now - ownAt else null,
            playerOnGlass = UserStandbyPolicy.playerOnGlass(
                inForeground = MainActivity.isInForeground,
                sincePausedBySleepMs = if (pausedAt > 0L) now - pausedAt else null,
            ),
        )
        when (UserStandbyPolicy.classifyScreenOff(facts)) {
            ScreenOffCause.USER -> enter(app, now)
            ScreenOffCause.OURS ->
                PlayerLogger.i(TAG, "screen off — one of our own blanks; not a user standby")
            ScreenOffCause.NOT_ON_GLASS ->
                PlayerLogger.i(TAG, "screen off while the player was not on the glass — not a user standby")
            ScreenOffCause.EMERGENCY -> reassertEmergency(app, now)
        }
    }

    internal fun onScreenOn(ctx: Context) {
        val app = ctx.applicationContext
        // Any screen-on ends it: the person pressed power, or one of the
        // deliberate wakes (alert, schedule ON, WAKE command) already did.
        end(app, "the panel was turned on")
    }

    // ─── internals ───────────────────────────────────────────────────

    private fun enter(app: Context, nowElapsedMs: Long) {
        val record = StandbyRecord(
            sinceWallMs = System.currentTimeMillis(),
            sinceElapsedMs = nowElapsedMs,
            bootCount = bootCount(app),
        )
        synchronized(lock) {
            val persisted = runCatching {
                prefs(app).edit()
                    .putLong(KEY_SINCE_WALL, record.sinceWallMs)
                    .putLong(KEY_SINCE_ELAPSED, record.sinceElapsedMs)
                    .putInt(KEY_BOOT_COUNT, record.bootCount)
                    .commit()
            }.getOrDefault(false)
            cachedActive = true
            PlayerLogger.w(
                TAG,
                "USER STANDBY — the panel was turned off by something that is not us while the player " +
                    "was on the glass. It stays off until the power key, the schedule's ON trigger, a WAKE " +
                    "command or an emergency alert (persisted=$persisted bootCount=${record.bootCount})",
            )
        }
        acquireCpuLock(app)
        notifyListener(true)
    }

    private fun exit(app: Context, reason: String) {
        synchronized(lock) {
            runCatching {
                prefs(app).edit()
                    .remove(KEY_SINCE_WALL)
                    .remove(KEY_SINCE_ELAPSED)
                    .remove(KEY_BOOT_COUNT)
                    .commit()
            }.onFailure { PlayerLogger.w(TAG, "could not clear the standby record: ${it.message}") }
            cachedActive = false
        }
        PlayerLogger.i(TAG, "user standby ENDED — $reason")
        releaseCpuLock()
        notifyListener(false)
    }

    /**
     * The panel went off DURING an active alert. The alert outranks the
     * remote: put it straight back rather than waiting for the page's next
     * per-poll re-raise, which a hidden page may run late. Rate-limited, so a
     * firmware that keeps forcing the panel off cannot turn this into a loop.
     */
    private fun reassertEmergency(app: Context, nowElapsedMs: Long) {
        if (nowElapsedMs - lastEmergencyReassertAtMs < UserStandbyPolicy.EMERGENCY_REASSERT_MIN_GAP_MS &&
            lastEmergencyReassertAtMs != 0L
        ) {
            PlayerLogger.w(TAG, "screen off during an alert again — re-assert rate-limited")
            return
        }
        lastEmergencyReassertAtMs = nowElapsedMs
        PlayerLogger.e(TAG, "screen turned off DURING an active emergency alert — putting the alert back on the glass")
        runCatching { DisplayEmergency.enforceNow(app) }
            .onFailure { PlayerLogger.e(TAG, "emergency re-assert after a screen-off failed", it) }
    }

    private fun notifyListener(active: Boolean) {
        runCatching { listenerRef?.get()?.onStandbyChanged(active) }
            .onFailure { PlayerLogger.w(TAG, "standby listener threw: ${it.message}") }
    }

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
                wl.acquire(UserStandbyPolicy.CPU_LOCK_TIMEOUT_MS)
            }
        }.onFailure { PlayerLogger.w(TAG, "could not hold the standby CPU lock: ${it.message}") }
    }

    private fun releaseCpuLock() {
        runCatching {
            synchronized(lock) {
                val wl = cpuLock
                if (wl != null && wl.isHeld) wl.release()
            }
        }.onFailure { PlayerLogger.w(TAG, "could not release the standby CPU lock: ${it.message}") }
    }

    private fun readRecord(app: Context): StandbyRecord? = runCatching {
        val p = prefs(app)
        if (!p.contains(KEY_SINCE_WALL)) return@runCatching null
        StandbyRecord(
            sinceWallMs = p.getLong(KEY_SINCE_WALL, 0L),
            sinceElapsedMs = p.getLong(KEY_SINCE_ELAPSED, 0L),
            bootCount = p.getInt(KEY_BOOT_COUNT, -1),
        )
    }.getOrNull()

    private fun prefs(app: Context) = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** `Settings.Global.BOOT_COUNT` (API 24, our minSdk), or -1 where the ROM does not keep it. */
    private fun bootCount(app: Context): Int = runCatching {
        Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)
    }.getOrDefault(-1)

    /** Fails toward "on": an unknown power state must never be read as standby. */
    private fun screenInteractive(app: Context): Boolean = runCatching {
        (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive ?: true
    }.getOrDefault(true)
}
