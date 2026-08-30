package com.educms.player.watchdog

/**
 * "The web runtime is alive" is not the same as "the screen is showing
 * content." (2026-08-30 player reliability program, W2-4.)
 *
 * WHY THIS FILE EXISTS. `WebAppBridge.heartbeat()` is a bare liveness
 * tick: the page's JS event loop calls it every ~60 s and MainActivity
 * refreshes `lastSuccessfulLoadAtMs`, which satisfies the 10-minute
 * staleness watchdog. That was the right fix for its own bug (healthy
 * players were being force-reloaded every 10 minutes), but it means a
 * player stuck unauthenticated — event loop fine, manifest sync failing,
 * nothing on the glass — heartbeats forever and the watchdog never fires.
 * The screen is dark and every native signal says healthy.
 *
 * `heartbeatV2` carries the missing bit (`syncOk`), and this policy is
 * what turns it into a decision. Kept pure — no clock, no Android, no
 * WebView — so the timing rules are testable directly.
 *
 * RULES:
 *  1. DORMANT until the first V2 heartbeat ever. An APK running an older
 *     web bundle (which only knows `heartbeat()`) therefore keeps exactly
 *     today's behaviour — this cannot regress a fleet mid-rollout.
 *  2. The reference point is the last tick that reported `syncOk == true`,
 *     or — if none ever has — the first V2 tick we saw.
 *  3. A `null` syncOk (field missing, or malformed JSON) refreshes
 *     nothing, but does not disarm the policy either. Unknown is not OK.
 *  4. Fire when the reference is older than [STALE_MS], subject to a
 *     [COOLDOWN_MS] gate so a screen that reloads into the same broken
 *     state doesn't reload-loop.
 *  5. NEVER while the box believes it is OFFLINE (C-P0-1, 2026-08-30 deep
 *     audit). See [onNetworkState].
 *  6. Time spent offline is not stale time (C-P0-1). See [onNetworkState].
 *
 * ── C-P0-1 — the offline hole this closes ──────────────────────────────
 *
 * `syncOk` cannot distinguish "the credential is dead" from "the internet
 * is out": both make the manifest fetch fail, both report `syncOk=false`.
 * So a screen playing perfectly good CACHED content through a WAN outage
 * looked identical to a dark screen, and this policy reloaded it every 30
 * minutes — during an outage, when recovery-through-reload depends
 * entirely on the service worker holding a 200 shell. Without a healthy
 * SW that reload is a main-frame error, an overlay, and total content
 * loss for the duration. It violated the operator's iron rule ("once
 * content is live, it stays live — even if the damn internet drops")
 * which the WEB half already enforces verbatim.
 *
 * Rules 5 + 6 are the fix, and they are deliberately asymmetric: going
 * offline suppresses everything, and coming back online hands the screen
 * a FULL fresh [STALE_MS] window to re-sync before it is judged. Reloading
 * cannot fix an outage, so declining to reload costs nothing; reloading
 * into one can cost the glass.
 *
 * The EMERGENCY gate is deliberately NOT here — it is caller-side, in
 * `MainActivity.watchdogTicker`, because it must also guard the staleness
 * watchdog's reload, which this class knows nothing about. This class
 * stays pure.
 */
class ContentWatchdogPolicy {

    /** When we first heard a V2 heartbeat. Null = dormant, never armed. */
    private var firstV2AtMs: Long? = null

    /** Last tick that reported syncOk == true. Null = never since boot. */
    private var lastSyncOkAtMs: Long? = null

    /** Last time the CALLER acted on our advice. Null = never. */
    private var lastFiredAtMs: Long? = null

    /**
     * C-P0-1 — what the box last told us about its own connectivity.
     *
     * Starts `true` so a caller that never reports network state behaves
     * exactly as this policy did before the parameter existed. Optimism is
     * the no-regression default here, not a judgement about the network.
     */
    private var networkUp: Boolean = true

    /**
     * C-P0-1 — rule 6. The earliest instant staleness may be measured
     * from, moved forward on every offline→online transition. Null until
     * the box has been seen to come back from an outage.
     */
    private var referenceFloorMs: Long? = null

    /**
     * Record a V2 heartbeat.
     *
     * @param syncOk null when the web bundle omitted the field or sent
     *        something we could not parse — see rule 3.
     * @param networkUp what the platform says about connectivity RIGHT NOW
     *        (C-P0-1). `false` makes the whole tick inert: it refreshes
     *        nothing and — via [shouldForceReload] — fires nothing, exactly
     *        like a `null` syncOk, because an offline `syncOk=false` is not
     *        evidence about the glass. The tick still ARMS the policy
     *        (rule 1 is about bundle version, not connectivity).
     */
    fun onV2Heartbeat(nowMs: Long, syncOk: Boolean?, networkUp: Boolean) {
        onNetworkState(nowMs, networkUp)
        if (firstV2AtMs == null) firstV2AtMs = nowMs
        // Rule 5: offline is not evidence. Do not refresh the reference on
        // an offline tick either — a cached-content screen may legitimately
        // report syncOk=true offline (the SW served it) and we do not want
        // that to become the yardstick for the outage.
        if (!networkUp) return
        if (syncOk == true) lastSyncOkAtMs = nowMs
    }

    /**
     * C-P0-1 — feed connectivity independently of the web bundle.
     *
     * The heartbeat is not a reliable carrier for this: a page whose JS
     * has wedged stops heartbeating entirely, and if the last thing it
     * ever said was "offline" the policy would stay disarmed forever. So
     * the native caller also pushes the live ConnectivityManager reading
     * on every watchdog tick, whether or not a heartbeat arrived.
     *
     * On the offline→ONLINE edge this resets the staleness reference to
     * `nowMs` (rule 6). That deliberately also discards stale time
     * accumulated BEFORE the outage: after any outage the screen gets a
     * clean [STALE_MS] window to re-sync. A screen whose network flaps
     * faster than [STALE_MS] therefore never fires — correct, because a
     * screen with a flapping uplink is one this policy cannot judge, and
     * the bias must be toward leaving live content alone.
     *
     * Idempotent: only the transition matters, so calling this every tick
     * with an unchanged value costs nothing.
     */
    fun onNetworkState(nowMs: Long, up: Boolean) {
        val was = networkUp
        networkUp = up
        if (up && !was) referenceFloorMs = nowMs
    }

    /**
     * Should the caller force a reload right now? Does NOT mutate — the
     * caller confirms by calling [markFired], so a caller that decides not
     * to act (emergency hold on screen, say) doesn't burn the cooldown.
     */
    fun shouldForceReload(nowMs: Long): Boolean {
        val armedAt = firstV2AtMs ?: return false          // rule 1
        if (!networkUp) return false                       // rule 5
        val floor = referenceFloorMs                       // rule 6
        val lastOk = lastSyncOkAtMs ?: armedAt             // rule 2
        val reference = if (floor != null && floor > lastOk) floor else lastOk
        if (nowMs - reference <= STALE_MS) return false
        val fired = lastFiredAtMs ?: return true           // never fired → go
        return nowMs - fired > COOLDOWN_MS                 // rule 4
    }

    /** The caller acted. Starts the cooldown. */
    fun markFired(nowMs: Long) {
        lastFiredAtMs = nowMs
    }

    companion object {
        /** How long sync may be not-OK before the screen is presumed dark. */
        const val STALE_MS = 30L * 60L * 1000L

        /** Minimum gap between two content-watchdog reloads. */
        const val COOLDOWN_MS = 30L * 60L * 1000L
    }
}
