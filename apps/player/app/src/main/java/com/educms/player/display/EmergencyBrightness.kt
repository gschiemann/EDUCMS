package com.educms.player.display

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import com.educms.player.logging.PlayerLogger

/**
 * The emergency's HARDWARE brightness write, run only once the panel has
 * settled — the Android half of [EmergencyBrightnessPolicy] (2026-10-12).
 * Read that file's header for the field evidence and the rules.
 *
 * One request at a time: a re-raise while one is waiting does not queue a
 * second write, it just keeps the first. The write runs on its own thread,
 * never the UI thread — if a backlight driver ever blocks in the kernel,
 * the Activity must not ANR with an alert on it.
 *
 * Also the single place the emergency path learns the panel's recent power
 * history ([noteScreenOn] / [noteScreenOff] from UserStandby's receiver,
 * [noteWakeRequested] from enforceNow) and the source of `sinceWakeMs` on
 * every `PLAYER_EMERGENCY_ENFORCE_STEP` marker.
 */
object EmergencyBrightness {

    private const val TAG = "EmergencyBrightness"

    /** Same value as DisplayEmergency's — the brightness an alert drives to. */
    const val TARGET_PERCENT = 100

    private val lock = Any()
    private val handler: Handler by lazy {
        Handler(HandlerThread("emergency-brightness").apply { start() }.looper)
    }

    @Volatile private var lastWakeAtMs: Long? = null
    @Volatile private var interactiveSinceMs: Long? = null
    private var pending: Runnable? = null
    private var requestedAtMs = 0L

    /** `elapsedRealtime` of the last wake we asked for or saw, or null. */
    fun lastWakeAtMs(): Long? = lastWakeAtMs

    /** ms since the last wake, or null when none is known in this process. */
    fun sinceWakeMs(nowMs: Long = SystemClock.elapsedRealtime()): Long? = lastWakeAtMs?.let { nowMs - it }

    /** enforceNow is about to wake a panel that is NOT interactive. */
    fun noteWakeRequested(nowMs: Long = SystemClock.elapsedRealtime()) {
        lastWakeAtMs = nowMs
        interactiveSinceMs = null
    }

    /** `ACTION_SCREEN_ON`. */
    fun noteScreenOn(nowMs: Long = SystemClock.elapsedRealtime()) {
        lastWakeAtMs = nowMs
        if (interactiveSinceMs == null) interactiveSinceMs = nowMs
    }

    /** `ACTION_SCREEN_OFF`. */
    fun noteScreenOff() {
        interactiveSinceMs = null
    }

    /**
     * Ask for the alert's hardware brightness write. Returns at once; the
     * write happens on this object's thread when the policy says so.
     */
    fun request(ctx: Context, why: String) {
        val app = ctx.applicationContext
        synchronized(lock) {
            if (pending != null) return
            requestedAtMs = SystemClock.elapsedRealtime()
            val r = object : Runnable {
                override fun run() {
                    val next = runCatching { tick(app, why) }.getOrElse {
                        PlayerLogger.w(TAG, "emergency brightness tick failed: ${it.message}")
                        null
                    }
                    synchronized(lock) {
                        if (pending !== this) return
                        if (next == null) pending = null else handler.postDelayed(this, next)
                    }
                }
            }
            pending = r
            handler.post(r)
        }
    }

    /** @return the delay to the next tick, or null when the request is finished. */
    private fun tick(app: Context, why: String): Long? {
        val now = SystemClock.elapsedRealtime()
        val interactive = runCatching {
            (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
        }.getOrNull()
        val since = EmergencyBrightnessPolicy.trackInteractive(interactiveSinceMs, interactive, now)
        interactiveSinceMs = since
        val timing = EmergencyBrightnessPolicy.timing(
            EmergencyBrightnessPolicy.Facts(
                nowMs = now,
                requestedAtMs = requestedAtMs,
                held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true),
                interactive = interactive,
                interactiveSinceMs = since,
                lastWakeAtMs = lastWakeAtMs,
            ),
        )
        when (timing) {
            is EmergencyBrightnessPolicy.Timing.Wait -> return timing.ms
            is EmergencyBrightnessPolicy.Timing.Drop -> {
                step("hw-brightness-dropped", "why=\"${timing.why}\"")
                return null
            }
            EmergencyBrightnessPolicy.Timing.Ready -> Unit
        }
        val provider = runCatching { DisplayControlRegistry.providerFor(app, Capability.BRIGHTNESS)?.id }.getOrNull()
        val (current, target) = if (provider == SysfsBacklightProvider.id) {
            runCatching { SysfsBacklightProvider.currentRaw() }.getOrNull() to
                runCatching { SysfsBacklightProvider.targetRaw(TARGET_PERCENT) }.getOrNull()
        } else {
            null to null
        }
        when (EmergencyBrightnessPolicy.afterRead(current, target)) {
            EmergencyBrightnessPolicy.Write.SkipAlreadyAtTarget -> {
                step("hw-brightness-skip", "provider=$provider raw=$current target=$target — already at full")
                return null
            }
            EmergencyBrightnessPolicy.Write.Now -> Unit
        }
        // ⚠️ DURABLE BEFORE THE WRITE: if this write is what resets the box,
        // this line (and every line before it) is on disk for the next boot.
        step(
            "hw-brightness-write",
            "provider=$provider raw=$current target=$target interactiveForMs=${since?.let { now - it }} why=$why",
            durable = true,
        )
        val result = runCatching {
            DisplayControlRegistry.apply(app, DisplayAction.SetBrightness(TARGET_PERCENT), revertAfterMs = null)
        }.getOrElse { ActionResult.Failed(it.message ?: it.javaClass.simpleName, provider ?: "unknown") }
        step("hw-brightness-done", "result=$result", durable = true)
        return null
    }

    /** One `PLAYER_EMERGENCY_ENFORCE_STEP` marker. */
    fun step(name: String, detail: String = "", durable: Boolean = false) {
        val since = sinceWakeMs()
        val msg = "PLAYER_EMERGENCY_ENFORCE_STEP step=$name sinceWakeMs=${since ?: "none"}" +
            if (detail.isEmpty()) "" else " $detail"
        if (durable) PlayerLogger.durable("ERROR", TAG, msg) else PlayerLogger.i(TAG, msg)
    }
}
