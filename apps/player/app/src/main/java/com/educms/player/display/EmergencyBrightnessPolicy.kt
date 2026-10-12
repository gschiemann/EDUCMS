package com.educms.player.display

/**
 * WHEN THE ALERT MAY TOUCH THE BACKLIGHT HARDWARE (2026-10-12, player 1.1.28).
 *
 * Pure — no `android.*` — so every rule here has a JVM test on a virtual
 * clock (EmergencyBrightnessPolicyTest).
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE FIELD EVIDENCE
 * ─────────────────────────────────────────────────────────────────────
 * MAXHUB L55VEC (Amlogic T982, Android 13, BLANK = device-admin
 * `lockNow()`, BRIGHTNESS = `sysfs-backlight`), 2026-10-12: a per-screen
 * drill raised the native alert watch while the panel was asleep from
 * `lockNow()`; [DisplayEmergency.enforceNow] poked the panel awake and, in
 * the SAME call, wrote `/sys/class/backlight/.../brightness`. The alert
 * reached the glass and the BOX REBOOTED ≈13 s later (uptime 43 s at the
 * next process start — a full kernel reset, not a soft restart). The same
 * drill on 1.1.26 did the same. A plain dead-man wake from the same
 * `lockNow()` sleep — the same wake path, but NO backlight write — never
 * rebooted, and the re-enforce on the already-awake panel after the reboot
 * (a backlight write on a panel that had been on for seconds) did not
 * either. The one difference that is ours is a direct hardware brightness
 * write while the display pipeline is still powering up — repeated, too,
 * because every enforce (native raise, onResume, the page's raise) wrote
 * the node again inside the same few seconds.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE RULES
 * ─────────────────────────────────────────────────────────────────────
 *  1. The alert is made VISIBLE by the window, not by this: enforceNow
 *     still lifts the blackout, sets window brightness 1.0, re-arms
 *     KEEP_SCREEN_ON and wakes the panel immediately. Only the HARDWARE
 *     brightness write waits.
 *  2. A provider that does not write hardware ([SoftwareDimProvider]) is
 *     applied immediately, exactly as before.
 *  3. Never write while the panel is not interactive — a dark panel is not
 *     made more visible by a backlight value, and that is the moment the
 *     display pipeline is powering up.
 *  4. Write only once the panel has been CONTINUOUSLY interactive for
 *     [SETTLE_MS] AND [SETTLE_MS] has passed since the last wake we asked
 *     for or saw (a screen-on broadcast).
 *  5. Skip the write when the node already reads at or above the target —
 *     the per-poll re-raise of a long alert then never touches the node
 *     again.
 *  6. A request for a hold that has been released is dropped (the release
 *     path restores the operator's level itself).
 *  7. Give up after [GIVE_UP_MS] of waiting (a panel that never comes on,
 *     a power state we cannot read). Nothing is lost: the window is already
 *     at full, and the page re-raises on every poll, which asks again.
 *
 * NOTHING HERE CAN DARKEN A SCREEN — it only decides when a raise-direction
 * write runs. The emergency gate in [DisplayControlRegistry.apply] still
 * refuses every lowering, and enforceNow moves the brightness MIRROR to full
 * at once so that gate is exactly as strict during the settle window as it
 * was when the write was immediate.
 */
object EmergencyBrightnessPolicy {

    /** Continuous interactivity required before a hardware brightness write. */
    const val SETTLE_MS = 5_000L

    /** How often a waiting request is re-examined. */
    const val TICK_MS = 500L

    /** Longest a request waits before it is dropped (the next re-raise asks again). */
    const val GIVE_UP_MS = 120_000L

    /** Step markers are written for enforces this close to a wake (bounded log volume). */
    const val STEP_LOG_WINDOW_MS = 60_000L

    /** The one provider whose SetBrightness touches nothing but our own window. */
    const val SOFTWARE_PROVIDER_ID = "software-dim"

    /** Does [providerId] write display hardware (so its emergency write must wait)? */
    fun providerDefers(providerId: String?): Boolean =
        providerId != null && providerId != SOFTWARE_PROVIDER_ID

    /**
     * Fold one observation of the power state into "interactive since".
     * Unknown (null) and false both break continuity — the safe direction is
     * to wait longer, never to write early.
     */
    fun trackInteractive(prevSinceMs: Long?, interactive: Boolean?, nowMs: Long): Long? =
        if (interactive == true) (prevSinceMs ?: nowMs) else null

    data class Facts(
        val nowMs: Long,
        /** When this request was made. */
        val requestedAtMs: Long,
        val held: Boolean,
        val interactive: Boolean?,
        /** First observation of the current continuous interactive stretch, or null. */
        val interactiveSinceMs: Long?,
        /** The last wake we asked for or a screen-on we saw, or null when none is known. */
        val lastWakeAtMs: Long?,
    )

    sealed class Timing {
        /** Settled: read the node, then [afterRead]. */
        object Ready : Timing()
        data class Wait(val ms: Long, val why: String) : Timing()
        data class Drop(val why: String) : Timing()
    }

    fun timing(f: Facts): Timing {
        if (!f.held) return Timing.Drop("the emergency hold was released")
        if (f.nowMs - f.requestedAtMs >= GIVE_UP_MS) {
            return Timing.Drop("the panel did not settle within ${GIVE_UP_MS / 1000}s")
        }
        if (f.interactive != true || f.interactiveSinceMs == null) {
            return Timing.Wait(TICK_MS, if (f.interactive == null) "power state unknown" else "panel not interactive")
        }
        val anchor = maxOf(f.interactiveSinceMs, f.lastWakeAtMs ?: Long.MIN_VALUE)
        val settledFor = f.nowMs - anchor
        if (settledFor < SETTLE_MS) {
            // Never sleep through the settle in one jump: every tick observes
            // the power state, so a flicker off inside the window restarts it
            // even if the SCREEN_OFF broadcast is late or never arrives.
            return Timing.Wait((SETTLE_MS - settledFor).coerceIn(1L, TICK_MS), "settling ${settledFor}ms of ${SETTLE_MS}ms")
        }
        return Timing.Ready
    }

    sealed class Write {
        object Now : Write()
        object SkipAlreadyAtTarget : Write()
    }

    /**
     * The node's current raw value against the target's. Unreadable (null)
     * writes — a skip has to be PROVEN.
     */
    fun afterRead(currentRaw: Int?, targetRaw: Int?): Write =
        if (currentRaw != null && targetRaw != null && currentRaw >= targetRaw) Write.SkipAlreadyAtTarget else Write.Now

    /** Write `PLAYER_EMERGENCY_ENFORCE_STEP` markers for this enforce? */
    fun logSteps(quiet: Boolean, sinceWakeMs: Long?): Boolean =
        !quiet || (sinceWakeMs != null && sinceWakeMs in 0 until STEP_LOG_WINDOW_MS)
}
