package com.educms.player.display

import com.educms.player.display.VendorBacklightPolicy.Detection

/**
 * THE VENDOR BACKLIGHT, AS A SEQUENCE (player 1.1.52). The rules are
 * [VendorBacklightPolicy]; the Android half — the bind, the Parcel transacts,
 * the worker thread, the prefs — is [VendorBacklightProvider]. This class is
 * what sits between them so the order of events can be watched on a plain
 * JVM with recording fakes (VendorBacklightEngineTest):
 *
 *  • [probe]: installed? → connect within budget → ask the screen status →
 *    [Detection]. Never throws; every failure is a verdict.
 *  • [setScreen]: Goodview's CMS sequence — connect if needed → read the
 *    power state (`CmdGetScreenStatus`) → only if it is not already the
 *    wanted one, OFF = `CmdPowerOff(-1)`, ON = the power key
 *    `CmdSendKeyEvent(5000)` → one readback → the dark record moves and the
 *    alert watch is kicked. A dead binder gets ONE reconnect (and a fresh
 *    read) inside the same budget. A failed ON after our own OFF latches
 *    [faulted] (rule 4). A wake that lands while our own last command is
 *    still taking effect tries again by itself once it has settled.
 *  • [emergencyOn]: decide, then HAND OFF — the caller's thread never waits
 *    (rule 3).
 *
 * Not thread-safe by itself: the provider serialises every call on one
 * worker. No android.*, no I/O of its own, no clock reads.
 */
class VendorBacklightEngine(private val ports: Ports) {

    /** The Android half, or a test double. Every call is bounded by its caller's budget. */
    interface Ports {
        /** `SystemClock.elapsedRealtime()`. */
        fun nowMs(): Long

        /** Is `com.seewo.mcuservice` installed? (`PackageManager`, under the manifest's `<queries>`.) */
        fun servicePackageInstalled(): Boolean

        /**
         * Make the `opensdk` binder + token ready, or confirm they already
         * are, within [budgetMs]. Returns what happened; never throws.
         */
        fun connect(budgetMs: Long): Connect

        /** Forget a binder that is dead or that answered nothing. */
        fun disconnect()

        /** One `sendMessage(token, requestJson)`, within [budgetMs]. Never throws. */
        fun send(requestJson: String, budgetMs: Long): Call

        /** Hand a unit of work to the worker; false when it could not be queued. */
        fun submit(work: () -> Unit): Boolean

        /** Hand a unit of work to the worker after [delayMs]; false when it could not be queued. */
        fun schedule(delayMs: Long, work: () -> Unit): Boolean

        /** The persisted "the backlight is off because WE turned it off" record moved. */
        fun darkChanged(dark: Boolean)

        /** The service answered on this device: remember it across processes. */
        fun seen()

        fun log(level: Level, message: String)

        /**
         * True when OFF / ON are setters, not a toggle (the RK3576 backend,
         * [RkSdkApiPolicy]): the engine then sends every time
         * ([VendorBacklightPolicy.powerStep] `idempotent`). The GUQ's power
         * key is a toggle, so the default stays false.
         */
        fun idempotentCommands(): Boolean = false
    }

    enum class Level { INFO, WARN, ERROR }

    private companion object {
        /** A deferred wake runs this long after the settle window closes. */
        const val SETTLE_SLACK_MS = 250L
    }

    sealed class Connect {
        object Ready : Connect()
        object TimedOut : Connect()
        /** Bind refused, no `opensdk` service, no token. */
        data class Failed(val reason: String) : Connect()
    }

    sealed class Call {
        data class Reply(val json: String?) : Call()
        object TimedOut : Call()
        /** `DeadObjectException`, a `RemoteException`, not connected. */
        data class Failed(val reason: String, val binderDead: Boolean = false) : Call()
    }

    /** The outcome of one blank / wake. */
    sealed class Step {
        /** The command was accepted. [backlightOff] is the MCU's readback, or null when none came. */
        data class Ok(val backlightOff: Boolean?) : Step()
        data class Failed(val reason: String) : Step()
    }

    @Volatile var detection: Detection = Detection.PROBING
        private set

    /** Why darkening stepped aside in this process (rule 4), or null. */
    @Volatile var faulted: String? = null
        private set

    /** OUR record: the backlight is off because we turned it off. Restored from prefs by the provider. */
    @Volatile var dark: Boolean = false
        private set

    private var probes = 0
    private var lastProbeAtMs: Long? = null

    /** When OUR last power command was accepted, and which way it went. */
    private var lastCommandAtMs: Long? = null
    private var lastCommandOn: Boolean? = null

    /** Moves on every blank / wake request, so a deferred wake never undoes a newer request. */
    private var generation = 0L

    /** The provider restores the persisted record before anything else runs. */
    fun restoreDark(dark: Boolean) {
        this.dark = dark
    }

    // ─── probe ───────────────────────────────────────────────────────

    /** Run a probe if one is due; returns the detection either way. */
    fun probeIfDue(): Detection {
        if (!VendorBacklightPolicy.probeDue(detection, probes, lastProbeAtMs, ports.nowMs())) return detection
        return probe()
    }

    fun probe(): Detection {
        probes++
        lastProbeAtMs = ports.nowMs()
        val next = runProbe()
        if (next != detection) {
            ports.log(
                if (next == Detection.AVAILABLE) Level.INFO else Level.WARN,
                "vendor backlight: ${next.wire} (probe $probes)",
            )
        }
        detection = next
        if (next == Detection.AVAILABLE) ports.seen()
        return next
    }

    private fun runProbe(): Detection {
        if (!ports.servicePackageInstalled()) return Detection.ABSENT
        when (val c = ports.connect(VendorBacklightPolicy.BIND_TIMEOUT_MS)) {
            Connect.Ready -> Unit
            Connect.TimedOut -> return Detection.UNREACHABLE
            is Connect.Failed -> {
                ports.log(Level.WARN, "vendor backlight: the control service did not connect — ${c.reason}")
                return Detection.UNREACHABLE
            }
        }
        val call = ports.send(VendorBacklightPolicy.getScreenStatusRequest(), VendorBacklightPolicy.CALL_TIMEOUT_MS)
        val reply = when (call) {
            is Call.Reply -> VendorBacklightPolicy.parseReply(call.json)
            Call.TimedOut -> null
            is Call.Failed -> {
                if (call.binderDead) ports.disconnect()
                null
            }
        }
        return VendorBacklightPolicy.detectionFrom(reply)
    }

    // ─── blank / wake ────────────────────────────────────────────────

    fun blank(budgetMs: Long = VendorBacklightPolicy.APPLY_BUDGET_MS): Step = setScreen(on = false, budgetMs = budgetMs)

    fun wake(budgetMs: Long = VendorBacklightPolicy.APPLY_BUDGET_MS): Step = setScreen(on = true, budgetMs = budgetMs)

    /**
     * One sleep (`on = false`) or wake (`on = true`), as Goodview's CMS does it
     * on a t982, all inside [budgetMs]. The dark record and the fault latch
     * move on the outcome.
     */
    fun setScreen(on: Boolean, budgetMs: Long): Step {
        generation++
        return powerSequence(on, budgetMs, generation)
    }

    private fun powerSequence(on: Boolean, budgetMs: Long, gen: Long): Step {
        val startedAt = ports.nowMs()
        fun left(): Long = (budgetMs - (ports.nowMs() - startedAt)).coerceAtLeast(0L)
        val what = if (on) "power key (wake)" else "power off (sleep)"

        when (val c = ports.connect(minOf(VendorBacklightPolicy.BIND_TIMEOUT_MS, left()))) {
            Connect.Ready -> Unit
            Connect.TimedOut -> return failed(on, "the control service did not connect in time")
            is Connect.Failed -> return failed(on, "the control service did not connect — ${c.reason}")
        }

        var reconnected = false
        fun reconnectOnce(): Boolean {
            if (reconnected || left() <= 0L) return false
            reconnected = true
            // The MCU service restarts under us now and then (the vendor's
            // own client binds again on binderDied too).
            ports.disconnect()
            ports.log(Level.WARN, "vendor power: the control service binder died — reconnecting once")
            return ports.connect(minOf(VendorBacklightPolicy.BIND_TIMEOUT_MS, left())) == Connect.Ready
        }

        while (true) {
            // 1. The state, first — Goodview's `isScreenOn()` guard.
            val read = ports.send(VendorBacklightPolicy.getScreenStatusRequest(), minOf(VendorBacklightPolicy.CALL_TIMEOUT_MS, left()))
            if (read is Call.Failed && read.binderDead && reconnectOnce()) continue
            val screenOn = (read as? Call.Reply)?.let { VendorBacklightPolicy.booleanResult(VendorBacklightPolicy.parseReply(it.json)) }
            val since = lastCommandAtMs?.let { ports.nowMs() - it }

            when (VendorBacklightPolicy.powerStep(on, screenOn, since, lastCommandOn, ports.idempotentCommands())) {
                VendorBacklightPolicy.PowerStep.UNKNOWN ->
                    return failed(on, "could not read whether the panel is on — nothing sent (the power key is a toggle)")

                VendorBacklightPolicy.PowerStep.ALREADY -> {
                    setDark(!on)
                    if (on) faulted = null
                    ports.log(Level.INFO, "vendor power: the panel already reads ${if (on) "on" else "off"} — nothing sent")
                    return Step.Ok(backlightOff = !on)
                }

                VendorBacklightPolicy.PowerStep.SETTLING -> {
                    if (!on) return failed(false, "our last power command is still taking effect — sleep not sent")
                    // A wake must not be lost: try again once the panel has settled.
                    val wait = (VendorBacklightPolicy.POWER_SETTLE_MS - (since ?: 0L)).coerceAtLeast(0L) + SETTLE_SLACK_MS
                    val queued = runCatching {
                        ports.schedule(wait) {
                            if (gen == generation) {
                                runCatching { powerSequence(true, VendorBacklightPolicy.APPLY_BUDGET_MS, gen) }
                                    .onFailure { ports.log(Level.ERROR, "vendor power: deferred wake threw — ${it.message}") }
                            }
                        }
                    }.getOrDefault(false)
                    ports.log(
                        if (queued) Level.WARN else Level.ERROR,
                        "vendor power: our last power command is still taking effect — wake " +
                            if (queued) "tried again in $wait ms" else "could NOT be queued for later",
                    )
                    return Step.Ok(backlightOff = null)
                }

                VendorBacklightPolicy.PowerStep.SEND -> Unit
            }

            // 2. The command.
            val request = if (on) VendorBacklightPolicy.powerKeyRequest() else VendorBacklightPolicy.powerOffRequest()
            val call = ports.send(request, minOf(VendorBacklightPolicy.CALL_TIMEOUT_MS, left()))
            // A dead binder: reconnect and READ AGAIN before sending a toggle again.
            if (call is Call.Failed && call.binderDead && reconnectOnce()) continue
            val reply = when (call) {
                is Call.Reply -> VendorBacklightPolicy.parseReply(call.json)
                Call.TimedOut -> return failed(on, "$what did not answer in time")
                is Call.Failed -> return failed(on, "$what failed — ${call.reason}")
            }
            if (reply == null) return failed(on, "$what answered something that is not an SDK reply")
            if (!reply.ok) return failed(on, "$what was refused — ${reply.status}")

            // Accepted. Record it BEFORE the readback: a readback that times
            // out must not leave the record saying "lit" over a panel we just
            // put to sleep.
            lastCommandAtMs = ports.nowMs()
            lastCommandOn = on
            setDark(!on)
            if (on) faulted = null

            // 3. One readback. The panel may not have changed state yet; that
            // is reported as what was read, never rounded to the wanted state.
            val readback = if (left() > 0L) {
                val r = ports.send(VendorBacklightPolicy.getScreenStatusRequest(), minOf(VendorBacklightPolicy.CALL_TIMEOUT_MS, left()))
                (r as? Call.Reply)?.let { VendorBacklightPolicy.booleanResult(VendorBacklightPolicy.parseReply(it.json)) }
            } else {
                null
            }
            val backlightOff = readback?.let { nowOn -> !nowOn }
            ports.log(
                Level.INFO,
                "vendor $what accepted" +
                    (backlightOff?.let { " — readback: panel ${if (it) "off" else "on"}" } ?: " — no readback"),
            )
            return Step.Ok(backlightOff)
        }
    }

    private fun failed(on: Boolean, reason: String): Step {
        if (on && dark) {
            // Rule 4: we turned it off and could not turn it back on. No more
            // darkening from this mechanism in this process; wake keeps trying.
            faulted = reason
            ports.log(Level.ERROR, "VENDOR POWER FAULT — the panel we put to sleep could not be woken ($reason); this mechanism offers no further blank in this process")
        } else {
            ports.log(Level.WARN, "vendor backlight: $reason")
        }
        return Step.Failed(reason)
    }

    private fun setDark(value: Boolean) {
        if (dark == value) return
        dark = value
        ports.darkChanged(value)
    }

    // ─── emergency ───────────────────────────────────────────────────

    /** Is the mechanism reachable enough to be worth asking right now? */
    fun reachable(seenBefore: Boolean): Boolean =
        detection == Detection.AVAILABLE || (detection == Detection.PROBING && seenBefore)

    /**
     * Rule 3. Decide synchronously, then hand the ON to the worker and return
     * at once. Returns true when a wake was queued. Never throws, never waits.
     */
    fun emergencyOn(quiet: Boolean, seenBefore: Boolean): Boolean {
        if (!VendorBacklightPolicy.emergencyOnWanted(reachable(seenBefore), dark, quiet)) return false
        val queued = runCatching {
            ports.submit {
                runCatching { wake(VendorBacklightPolicy.APPLY_BUDGET_MS) }
                    .onFailure { ports.log(Level.ERROR, "vendor backlight: emergency ON threw — ${it.message}") }
            }
        }.getOrDefault(false)
        if (!queued) ports.log(Level.ERROR, "vendor backlight: emergency ON could not be queued — the registry wake will try again")
        return queued
    }
}
