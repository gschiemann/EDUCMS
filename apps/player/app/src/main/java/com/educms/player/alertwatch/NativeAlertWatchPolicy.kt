package com.educms.player.alertwatch

import java.io.ByteArrayInputStream

/**
 * THE NATIVE ALERT WATCH — the rules (2026-10-05, player 1.1.22).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — measured in production, not a theory
 * ═════════════════════════════════════════════════════════════════════
 * Player 1.1.21 let a person turn a panel off with the remote and have it
 * STAY off ("user standby"), on the promise that an emergency alert still
 * ends the standby. But the whole alert path runs through the WEB PAGE:
 * WS OVERRIDE / manifest poll → `displayEmergencyHold(true)` →
 * `DisplayEmergency`. On the one box that ran 1.1.21 (an X80: Android 11,
 * WebView 101) the page made NO request for 8.8 hours from the minute the
 * panel went off — no manifest poll, no push heartbeat, no cache report —
 * while the native `HeartbeatService` reached the API every 60 s the whole
 * time. The same silence is in the 1.1.20 logs between a remote power-off
 * and the Watchdog waking the panel. A page that is not running raises
 * nothing, so a lockdown could not wake a screen that was off. 1.1.21 was
 * recalled.
 *
 * Nobody knows WHY the page stops on that hardware (the box cannot be
 * reached with adb), and nothing here guesses: this package never touches
 * the WebView's lifecycle. The one question that matters is asked instead by
 * code that provably keeps running:
 *
 *   While the panel is NOT interactive, the native side polls the screen's
 *   own manifest — the document that is already the page's sole arbiter of
 *   emergency state, so this adds no server semantics — and RAISES the
 *   existing emergency hold when it says there is an alert.
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE RULES (every one has a JVM test in NativeAlertWatchPolicyTest /
 * NativeAlertWatchEngineTest)
 * ═════════════════════════════════════════════════════════════════════
 *  1. PANEL OFF ONLY. The moment the panel is interactive the page is alive
 *     and owns alert handling; the watch does not poll, and a verdict that
 *     arrives after the panel came on is discarded. Not paired, or no usable
 *     API root ⇒ no polling either.
 *  2. RAISE ONLY. [WatchAction] has no release member and nothing in this
 *     package can lower a hold. "No alert" from here is never an all-clear:
 *     the page, on a LIVE manifest, stays the only thing that releases
 *     (CLAUDE.md player rule 11). A hold nothing releases costs electricity;
 *     a hold released by a guess costs someone their safety.
 *  3. UNKNOWN IS NOT AN ANSWER. A network failure, a timeout, a 401/403, a
 *     5xx, a body that is not a complete manifest — none is an alert and
 *     none is an all-clear. Log, back off (15 s → 30 s → 60 s), retry.
 *  4. THE PAGE HAS TO CONFIRM. Waking the panel is not the goal — the alert
 *     on the glass is, and only the page can draw it. The page proves it has
 *     seen the alert when IT calls `displayEmergencyHold(true)`. If it has
 *     not within [CONFIRM_WINDOW_MS] of a native raise, the page is reloaded
 *     through the Activity's own reload path: no more often than once per
 *     [RELOAD_MIN_GAP_MS], at most [MAX_RELOADS_PER_ALERT] times for one
 *     alert.
 *
 * No android.*, no clock reads, no I/O: every fact is passed in.
 */

/** What one manifest poll proved. */
enum class AlertVerdict {
    /** The server says an alert is active for this screen. */
    ALERT,

    /** The server answered, completely, and there is no alert. NOT an all-clear for the hold. */
    NO_ALERT,

    /** The poll proved nothing — see rule 3. */
    UNKNOWN,
}

/**
 * What the watch may do with a verdict.
 *
 * ⚠️ THERE IS NO `RELEASE`, AND THERE MUST NEVER BE ONE (rule 2).
 */
enum class WatchAction { NONE, RAISE }

/**
 * A screen whose manifest is watched: the primary (face 0) or one hosted
 * side of a double-sided unit.
 */
class WatchTarget internal constructor(
    val face: Int,
    val screenId: String,
    /** The device JWT. Sent as a bearer credential and nowhere else. */
    val token: String,
) {
    /** Never the credential — this lands in logs. */
    override fun toString(): String = "WatchTarget(face=$face, screen=${screenId.take(8)}…)"
}

/** Everything a poll is allowed to tell the policy. */
data class PollOutcome(
    /** The HTTP status, or null when no response was read at all (DNS, TLS, timeout, reset). */
    val httpStatus: Int?,
    /** What the body said. Only meaningful with a 200. */
    val scan: ManifestScan? = null,
    /** The response's `ETag`, verbatim, or null. */
    val etag: String? = null,
    /** The `If-None-Match` this request carried, or null when it was unconditional. */
    val sentEtag: String? = null,
    /** A short, secret-free reason when there was no response (an exception class name). */
    val error: String? = null,
)

/** What the watch remembers about ONE manifest between polls of one dark period. */
data class PollMemory(
    /** `elapsedRealtime` before which this manifest is not asked again. */
    val nextPollAtMs: Long,
    /** The validator of the last body that gave a definite answer, or null. */
    val etag: String? = null,
    /** The answer that body gave. Never [AlertVerdict.UNKNOWN]. */
    val etagVerdict: AlertVerdict? = null,
    /** Consecutive polls that proved nothing. */
    val failures: Int = 0,
)

/** How an alert episode ended, as far as the confirm-or-reload machine is concerned. */
enum class Settled {
    /** The page raised the hold itself: it has the alert. */
    CONFIRMED,

    /** The reload budget is spent and the page still has not raised. The hold stays up. */
    GAVE_UP,
}

/**
 * One alert, from the native watch's first sight of it.
 *
 * It ends when the page releases the hold on a live all-clear, or when the
 * watch itself sees the server say "no alert" after it was settled.
 */
data class AlertEpisode(
    /** `elapsedRealtime` of the native watch's first raise for this alert. */
    val openedAtMs: Long,
    /**
     * A page raise at or after this instant counts as "the page has this
     * alert": the last moment the watch itself saw NO alert for this screen,
     * or [Long.MIN_VALUE] when it never has — then any raise the page made
     * in the current hold period counts (it can only be about this alert, or
     * about one the page is still holding).
     */
    val confirmFloorMs: Long,
    /** Reloads spent on this alert. */
    val reloads: Int = 0,
    /** The watch has since seen the server say there is no alert. */
    val serverCleared: Boolean = false,
    val settled: Settled? = null,
)

/** What the watch remembers about one face across dark periods (process lifetime). */
data class FaceWatch(
    val episode: AlertEpisode? = null,
    /** `elapsedRealtime` of the last definite "no alert" this watch read for the face. */
    val lastNoAlertAtMs: Long? = null,
    /** `elapsedRealtime` of the last reload this watch asked for. Outlives the episode. */
    val lastReloadAtMs: Long? = null,
)

/** The result of feeding one verdict to [NativeAlertWatchPolicy.onVerdict]. */
data class VerdictStep(
    val state: FaceWatch,
    val action: WatchAction,
    /** True when this verdict is the first sight of a new alert. */
    val openedEpisode: Boolean,
)

/** Facts the confirm-or-reload decision may use. */
data class FollowUpFacts(
    val nowMs: Long,
    /** Is the emergency hold engaged (by anyone)? */
    val holdHeld: Boolean,
    /** `elapsedRealtime` of the page's last raise in the current hold period; null = none. */
    val pageRaisedAtMs: Long?,
    /** `elapsedRealtime` when the page last STARTED a load; null = unknown. */
    val pageLoadStartedAtMs: Long?,
)

/** What the confirm-or-reload machine wants next for one face. */
sealed class FollowUp {
    /** Nothing to do for this face. */
    object Idle : FollowUp()

    /** Ask again in [ms]. */
    data class Wait(val ms: Long) : FollowUp()

    /** The page raised the hold itself. Settle the episode. */
    object Confirmed : FollowUp()

    /** The page RELEASED the hold on a live manifest: it has spoken. Close the episode. */
    object PageCleared : FollowUp()

    /** No confirmation, and a reload is allowed now. */
    object Reload : FollowUp()

    /** No confirmation and the budget is spent. Settle; the hold stays up. */
    object GaveUp : FollowUp()
}

/** Attempts to put the player on the glass for the alert that is live now. */
data class RelaunchMemory(
    val attempts: Int = 0,
    val lastAtMs: Long? = null,
)

object NativeAlertWatchPolicy {

    // ─── cadence ─────────────────────────────────────────────────────

    /**
     * The first poll after the panel goes off. Three seconds lets a blank of
     * our own finish (a device-admin lock, a vendor broadcast) and skips an
     * off/on blip, and is still inside one page-poll interval.
     */
    const val FIRST_POLL_DELAY_MS = 3_000L

    /** Poll interval while the panel is off and the manifest is answering. */
    const val POLL_INTERVAL_MS = 15_000L

    /** Ceiling on the failure backoff. */
    const val MAX_BACKOFF_MS = 60_000L

    // ─── one request ─────────────────────────────────────────────────

    const val CONNECT_TIMEOUT_MS = 10_000
    const val READ_TIMEOUT_MS = 10_000

    /**
     * Hard bound on one whole exchange, body included. `readTimeout` bounds a
     * single read, so a body that drips one byte every nine seconds would
     * otherwise never end (player rule 4, native side).
     */
    const val REQUEST_BUDGET_MS = 30_000L

    /**
     * The most of a body the scanner will read. A manifest is tens to a few
     * hundred kilobytes; the scan is a stream, so this bounds time and bytes,
     * not memory. An emergency manifest says so in its first ~150 bytes.
     */
    const val MAX_BODY_BYTES = 8L * 1024L * 1024L

    /** A validator longer than this is not echoed back as a header. */
    const val MAX_ETAG_CHARS = 256

    // ─── the CPU ─────────────────────────────────────────────────────

    /**
     * Timeout of the watch's PARTIAL wake lock. It is re-acquired before
     * every request and before every sleep, so in practice it is held for as
     * long as the panel is off; the timeout only exists so a dead loop can
     * never pin the CPU. It must outlast the longest gap between two
     * refreshes — one full backoff sleep, or one whole request — with room
     * for a slow resolver.
     */
    const val CPU_LOCK_TIMEOUT_MS = 3L * 60_000L

    // ─── page confirmation ───────────────────────────────────────────

    /** How long the page gets to raise the hold itself after a native raise. */
    const val CONFIRM_WINDOW_MS = 20_000L

    /** Minimum gap between two loads of the page while its confirmation is awaited. */
    const val RELOAD_MIN_GAP_MS = 60_000L

    /** Reloads the watch may spend on one alert. */
    const val MAX_RELOADS_PER_ALERT = 3

    /** How often the confirm-or-reload machine is consulted while it is waiting. */
    const val FOLLOW_UP_TICK_MS = 5_000L

    // ─── the player on the glass ─────────────────────────────────────

    const val RELAUNCH_MIN_GAP_MS = 10_000L

    /** Launches of the player the watch may make for one alert (~a minute of trying). */
    const val MAX_RELAUNCHES_PER_ALERT = 6

    // ─── who is watched ──────────────────────────────────────────────

    /** Same shape `MainActivity.DEVICE_TOKEN_RE` accepts into the store. */
    private val JWT = Regex("^[A-Za-z0-9_-]{4,2048}\\.[A-Za-z0-9_-]{4,4096}\\.[A-Za-z0-9_-]{4,2048}$")

    /** A screen id goes into a URL path. UUIDs fit; a slash, a dot or a percent sign never does. */
    private val SCREEN_ID = Regex("^[A-Za-z0-9_-]{8,64}$")

    /**
     * The screen a device token belongs to — its `sub` claim.
     *
     * The native side never stored a screen id (the heartbeat is keyed by
     * fingerprint), and the manifest route is keyed by one. The token already
     * in the canonical store names it, so it is read from there rather than
     * adding a second thing to keep in step. This is a READ of an unverified
     * claim used only to build a URL: the server verifies the signature and
     * refuses a token whose `sub` is not the screen in the path.
     */
    fun screenIdOf(token: String?): String? {
        val t = token?.trim() ?: return null
        if (!JWT.matches(t)) return null
        val payload = base64UrlDecode(t.substring(t.indexOf('.') + 1, t.lastIndexOf('.'))) ?: return null
        val sub = topLevelString(payload, "sub", maxLen = 64) ?: return null
        return sub.takeIf { SCREEN_ID.matches(it) }
    }

    /** The target for [face], or null when it has no usable credential (not paired, or a damaged store). */
    fun targetOf(face: Int, token: String?): WatchTarget? {
        val id = screenIdOf(token) ?: return null
        return WatchTarget(face, id, token!!.trim())
    }

    /**
     * Why no manifest may be polled right now, or null when polling is
     * allowed. Order is the point: a lit panel outranks everything (rule 1).
     */
    fun pollRefusal(
        panelInteractive: Boolean,
        apiRoot: String?,
        apiRootAllowed: Boolean,
        targets: Int,
    ): String? = when {
        panelInteractive -> "the panel is on — the page owns alert handling"
        apiRoot.isNullOrBlank() -> "no API root yet (the page has never bootstrapped this install)"
        !apiRootAllowed -> "the stored API root is not an allowed VenueOS API host"
        targets <= 0 -> "this screen is not paired (no usable device token)"
        else -> null
    }

    // ─── one poll ────────────────────────────────────────────────────

    /** The memory a manifest starts a dark period with. */
    fun firstMemory(nowMs: Long): PollMemory = PollMemory(nextPollAtMs = nowMs + FIRST_POLL_DELAY_MS)

    /**
     * What a poll proved.
     *
     *  • 200 + a body that states an alert → ALERT.
     *  • 200 + a complete manifest that states none → NO_ALERT.
     *  • 304 → "unchanged", so the answer of the body that carried the
     *    validator we sent — and ONLY when we sent one we still remember the
     *    answer for. (The server's emergency branch never 304s: it returns
     *    before any validator is compared and stamps every body with the
     *    time.)
     *  • anything else → UNKNOWN (rule 3).
     */
    fun classify(outcome: PollOutcome, memory: PollMemory): AlertVerdict = when (outcome.httpStatus) {
        200 -> when (outcome.scan) {
            ManifestScan.ALERT -> AlertVerdict.ALERT
            ManifestScan.NO_ALERT -> AlertVerdict.NO_ALERT
            else -> AlertVerdict.UNKNOWN
        }
        304 ->
            if (outcome.sentEtag != null && outcome.sentEtag == memory.etag) {
                memory.etagVerdict ?: AlertVerdict.UNKNOWN
            } else {
                AlertVerdict.UNKNOWN
            }
        else -> AlertVerdict.UNKNOWN
    }

    /** The memory after a poll: the validator to send next, the failure count, when to ask again. */
    fun afterPoll(memory: PollMemory, outcome: PollOutcome, verdict: AlertVerdict, nowMs: Long): PollMemory {
        if (verdict != AlertVerdict.UNKNOWN) {
            if (outcome.httpStatus == 304) {
                return memory.copy(nextPollAtMs = nowMs + POLL_INTERVAL_MS, failures = 0)
            }
            val etag = usableEtag(outcome.etag)
            return PollMemory(
                nextPollAtMs = nowMs + POLL_INTERVAL_MS,
                etag = etag,
                etagVerdict = if (etag != null) verdict else null,
                failures = 0,
            )
        }
        val failures = if (memory.failures < Int.MAX_VALUE) memory.failures + 1 else memory.failures
        // A 200 we could not read, or a 304 we cannot attribute, means the
        // validator we hold no longer stands for an answer we know: ask
        // unconditionally next time. A failure that never reached the
        // manifest (network, 401, 5xx) says nothing about it — keep it.
        val validatorIsStale = outcome.httpStatus == 200 || outcome.httpStatus == 304
        return PollMemory(
            nextPollAtMs = nowMs + pollDelayMs(failures),
            etag = if (validatorIsStale) null else memory.etag,
            etagVerdict = if (validatorIsStale) null else memory.etagVerdict,
            failures = failures,
        )
    }

    /**
     * How long until the next poll after [consecutiveFailures] polls in a row
     * proved nothing: 15 s, 15 s, 30 s, then 60 s for as long as it lasts.
     * Always inside [POLL_INTERVAL_MS]‥[MAX_BACKOFF_MS].
     */
    fun pollDelayMs(consecutiveFailures: Int): Long {
        if (consecutiveFailures <= 1) return POLL_INTERVAL_MS
        val doublings = minOf(consecutiveFailures - 1, 8)
        return minOf(POLL_INTERVAL_MS shl doublings, MAX_BACKOFF_MS)
    }

    /** A validator safe to send back as a header value, or null. */
    internal fun usableEtag(raw: String?): String? {
        val v = raw?.trim() ?: return null
        if (v.isEmpty() || v.length > MAX_ETAG_CHARS) return null
        // Visible ASCII only: nothing that could end the header line.
        return v.takeIf { s -> s.all { it.code in 0x21..0x7E } }
    }

    // ─── what a verdict may cause ────────────────────────────────────

    /**
     * Rule 1 + rule 2 in one line: the ONLY thing the watch ever does is
     * raise, and only for a live alert while the panel is off.
     */
    fun actionFor(verdict: AlertVerdict, panelInteractive: Boolean): WatchAction =
        if (verdict == AlertVerdict.ALERT && !panelInteractive) WatchAction.RAISE else WatchAction.NONE

    /**
     * Feed one verdict for one face.
     *
     *  • UNKNOWN changes nothing.
     *  • NO_ALERT is remembered (it is the floor a later confirmation is
     *    measured from) and NEVER releases anything. An episode the page
     *    already settled is closed; one still waiting on the page stays open,
     *    marked server-cleared, so the page still gets the reload that makes
     *    it look again — the page is the only thing that can lower the hold
     *    the watch raised, and it only reports a release it has not already
     *    latched.
     *  • ALERT with the panel on is the page's business. With the panel off
     *    it raises — on every poll, because a re-raise re-enforces a visible
     *    screen — and opens a new episode when there is none, or when the
     *    last one was for an alert the server has since cleared ("a new alert
     *    resets the budget").
     */
    fun onVerdict(state: FaceWatch, verdict: AlertVerdict, nowMs: Long, panelInteractive: Boolean): VerdictStep =
        when (verdict) {
            AlertVerdict.UNKNOWN -> VerdictStep(state, WatchAction.NONE, openedEpisode = false)
            AlertVerdict.NO_ALERT -> {
                val ep = state.episode
                val next = when {
                    ep == null -> null
                    ep.settled != null -> null
                    else -> ep.copy(serverCleared = true)
                }
                VerdictStep(
                    state.copy(episode = next, lastNoAlertAtMs = nowMs),
                    WatchAction.NONE,
                    openedEpisode = false,
                )
            }
            AlertVerdict.ALERT -> {
                val action = actionFor(verdict, panelInteractive)
                val ep = state.episode
                when {
                    action != WatchAction.RAISE -> VerdictStep(state, WatchAction.NONE, openedEpisode = false)
                    ep != null && !ep.serverCleared -> VerdictStep(state, WatchAction.RAISE, openedEpisode = false)
                    else -> VerdictStep(
                        state.copy(
                            episode = AlertEpisode(
                                openedAtMs = nowMs,
                                confirmFloorMs = state.lastNoAlertAtMs ?: Long.MIN_VALUE,
                            ),
                        ),
                        WatchAction.RAISE,
                        openedEpisode = true,
                    )
                }
            }
        }

    // ─── confirm, or reload ──────────────────────────────────────────

    /**
     * What the confirm-or-reload machine wants for one face (rule 4).
     *
     * Order matters:
     *  1. no open, unsettled episode → nothing;
     *  2. the hold is no longer held → the PAGE released it on a live
     *     manifest (nothing else can), so the page is alive and has spoken;
     *  3. the page raised at or after the episode's floor → confirmed;
     *  4. inside the confirmation window → wait;
     *  5. a load of the page started less than [RELOAD_MIN_GAP_MS] ago —
     *     ours, the watchdog's, or the Activity's own cold start — → wait.
     *     Every load gets its minute; a slow cold bundle is never restarted
     *     by the thing meant to rescue it (the C-P0-2 lesson);
     *  6. the budget is spent → give up (the hold stays);
     *  7. otherwise → reload.
     */
    fun followUp(state: FaceWatch, f: FollowUpFacts): FollowUp {
        val ep = state.episode ?: return FollowUp.Idle
        if (ep.settled != null) return FollowUp.Idle
        if (!f.holdHeld) return FollowUp.PageCleared
        if (f.pageRaisedAtMs != null && f.pageRaisedAtMs >= ep.confirmFloorMs) return FollowUp.Confirmed

        val sinceOpened = f.nowMs - ep.openedAtMs
        if (sinceOpened in 0 until CONFIRM_WINDOW_MS) return FollowUp.Wait(CONFIRM_WINDOW_MS - sinceOpened)

        val lastLoadAt = latest(state.lastReloadAtMs, f.pageLoadStartedAtMs)
        if (lastLoadAt != null) {
            val sinceLoad = f.nowMs - lastLoadAt
            if (sinceLoad in 0 until RELOAD_MIN_GAP_MS) return FollowUp.Wait(RELOAD_MIN_GAP_MS - sinceLoad)
        }
        if (ep.reloads >= MAX_RELOADS_PER_ALERT) return FollowUp.GaveUp
        return FollowUp.Reload
    }

    /** The state after the caller performed the reload [followUp] asked for. */
    fun afterReload(state: FaceWatch, nowMs: Long): FaceWatch {
        val ep = state.episode ?: return state
        return state.copy(episode = ep.copy(reloads = ep.reloads + 1), lastReloadAtMs = nowMs)
    }

    /** The state after an episode settled. */
    fun settle(state: FaceWatch, how: Settled): FaceWatch {
        val ep = state.episode ?: return state
        return state.copy(episode = ep.copy(settled = how))
    }

    /** The state after an episode ended (the page released the hold). */
    fun close(state: FaceWatch): FaceWatch = state.copy(episode = null)

    /** Is this face's alert one the SERVER still reports (as far as the watch last saw)? */
    fun alertLive(state: FaceWatch): Boolean = state.episode?.serverCleared == false

    // ─── the player on the glass ─────────────────────────────────────

    /**
     * Should the watch launch the player now?
     *
     * A woken panel shows whatever was on top when it went off. That is the
     * player on every healthy screen — but only the page can draw the alert,
     * so while an alert is live and the player is not resumed the watch
     * brings it forward: at most once per [RELAUNCH_MIN_GAP_MS],
     * [MAX_RELAUNCHES_PER_ALERT] times. (Android may refuse a launch from the
     * background; the count is what keeps a refused one from becoming a
     * loop.)
     */
    fun relaunchDue(mem: RelaunchMemory, nowMs: Long, alertLive: Boolean, playerInForeground: Boolean): Boolean {
        if (!alertLive || playerInForeground) return false
        if (mem.attempts >= MAX_RELAUNCHES_PER_ALERT) return false
        val last = mem.lastAtMs ?: return true
        val since = nowMs - last
        return since < 0 || since >= RELAUNCH_MIN_GAP_MS
    }

    // ─── the CPU ─────────────────────────────────────────────────────

    /**
     * Must the CPU be held awake?
     *
     * Only while the panel is off AND the watch has work: a box whose panel
     * is off and that holds no wake lock is free to suspend, and a suspended
     * box polls nothing. With the panel on the CPU is up anyway and the lock
     * is let go at once.
     */
    fun holdCpu(panelInteractive: Boolean, hasWork: Boolean): Boolean = !panelInteractive && hasWork

    // ─── small pure helpers ──────────────────────────────────────────

    private fun latest(a: Long?, b: Long?): Long? = when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }

    /**
     * base64url → bytes, with or without padding; null on anything else.
     * Hand-rolled because `java.util.Base64` needs API 26 and minSdk is 24,
     * and `android.util.Base64` would make this file untestable on a JVM.
     */
    internal fun base64UrlDecode(text: String): ByteArray? {
        val s = text.trimEnd('=')
        if (s.length % 4 == 1) return null
        val out = ByteArray(s.length * 3 / 4)
        var o = 0
        var acc = 0
        var bits = 0
        for (c in s) {
            val v = when (c) {
                in 'A'..'Z' -> c - 'A'
                in 'a'..'z' -> c - 'a' + 26
                in '0'..'9' -> c - '0' + 52
                '-' -> 62
                '_' -> 63
                else -> return null
            }
            acc = (acc shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out[o++] = ((acc shr bits) and 0xFF).toByte()
            }
        }
        return out
    }

    /**
     * The string value of top-level member [name] of a JSON object, or null
     * (absent, not a string, longer than [maxLen], or not a well-formed
     * object). The last occurrence wins, as it does for `JSON.parse`.
     */
    internal fun topLevelString(json: ByteArray, name: String, maxLen: Int): String? = try {
        val scan = JsonScan(ByteArrayInputStream(json), json.size.toLong() + 1L)
        var found: String? = null
        var wellFormed = scan.firstToken() == JsonScan.LBRACE
        if (wellFormed) {
            var b = scan.nextToken()
            if (b != JsonScan.RBRACE) {
                while (true) {
                    if (b != JsonScan.QUOTE) throw JsonScan.Malformed("expected a member name")
                    val key = scan.string(name.length)
                    if (scan.nextToken() != JsonScan.COLON) throw JsonScan.Malformed("expected ':'")
                    val v = scan.nextToken()
                    if (key == name) {
                        found = if (v == JsonScan.QUOTE) {
                            scan.string(maxLen)
                        } else {
                            scan.skipValue(v, depth = 1)
                            null
                        }
                    } else {
                        scan.skipValue(v, depth = 1)
                    }
                    val sep = scan.nextToken()
                    if (sep == JsonScan.RBRACE) break
                    if (sep != JsonScan.COMMA) throw JsonScan.Malformed("expected ',' or '}'")
                    b = scan.nextToken()
                }
            }
            wellFormed = scan.nextToken() == JsonScan.END
        }
        if (wellFormed) found else null
    } catch (_: JsonScan.Malformed) {
        null
    } catch (_: JsonScan.TooLarge) {
        null
    }
}
