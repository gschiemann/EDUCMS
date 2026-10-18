package com.educms.player.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * DID THE PANEL ACTUALLY GO TO SLEEP? (2026-10-11)
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE FIELD FAILURE THIS ANSWERS
 * ═════════════════════════════════════════════════════════════════════
 * Player 1.1.23 puts a panel a person had turned off back to sleep after an
 * alert's all-clear. On VisionCore's X80 (Android 11, no device admin, the
 * Android-TV settings app) it did not: the screen stayed on. The restore DID
 * run — its blank resolves to [ScreenTimeoutBlankProvider] there, which
 * returned `Ok("screen off in 15s")` — and nothing ever asked whether the
 * panel then went off. Two things on that box can stop it:
 *
 *  • its inventory reports `screensaver_activate_on_sleep = 1` and
 *    `sleep_timeout = -1`: when the screen-off timeout expires Android starts
 *    a SCREENSAVER (a "dream") instead of sleeping, and with no sleep timeout
 *    the dream never ends. A dreaming panel is still `isInteractive`;
 *  • anything still holding the screen on (a window, a playing video's own
 *    keep-awake, the alert's 30 s wake lock) postpones the timeout.
 *
 * So every native BLANK that claims a real sleep is now CHECKED: after its
 * settle window this reads `PowerManager.isInteractive`, listens for
 * `ACTION_DREAMING_STARTED`, and records what it SAW as the last sleep
 * proof. The native heartbeat carries it to the dashboard, which states it
 * as evidence — "turned off (seen)", "a screensaver replaced the sleep",
 * "still on" — and never claims "off" for a black overlay.
 *
 * Two consequences follow from what is seen:
 *  • a screensaver that starts while OUR screen-timeout blank is in force is
 *    proof that mechanism cannot sleep this box. It is ended at once (a
 *    screensaver is not "off"; a black screen is closer), the screen-off
 *    timeout is put back so it cannot start again, the screen is covered
 *    with the black overlay, and [ScreenTimeoutBlankProvider] declines from
 *    then on ([timeoutBlankDeclined]) so the dashboard is told the truth;
 *  • after an all-clear restore that did not take, the screen is covered
 *    with black: "back to off" degrades to "back to black", which is the
 *    best this box can do without device admin or the accessibility sleep
 *    service ([AccessibilityLockProvider]).
 *
 * ⚠️ LIFE SAFETY. Nothing here can darken a screen during an alert:
 *  • [cover] is the blackout hook, which MainActivity refuses on the UI
 *    thread while a hold is engaged ([DisplayEmergency.blocksBlackout]), and
 *    every caller checks [DisplayEmergency.isHeld] first;
 *  • a screensaver that starts DURING a hold is ended by
 *    [DisplayEmergency.enforceNow] — raise-direction only.
 * The window brightness is never touched here: the WAKE backstop restores
 * the overlay but not the window level, so a dimmed window would outlive it.
 */
object SleepProof {

    private const val TAG = "SleepProof"
    private const val PREFS = "edu_player"

    private const val KEY_LAST_MECHANISM = "sleep_proof_last_mechanism"
    private const val KEY_LAST_OUTCOME = "sleep_proof_last_outcome"
    private const val KEY_LAST_AT = "sleep_proof_last_at_wall_ms"
    private const val KEY_RESTORE_DECISION = "sleep_proof_restore_decision"
    private const val KEY_RESTORE_OUTCOME = "sleep_proof_restore_outcome"
    private const val KEY_RESTORE_AT = "sleep_proof_restore_at_wall_ms"
    private const val KEY_DREAM_OBSERVED_AT = "sleep_proof_dream_observed_at_wall_ms"

    private class Pending(
        val providerId: String,
        val atElapsedMs: Long,
        @Volatile var forRestore: Boolean,
    )

    @Volatile private var pending: Pending? = null
    @Volatile private var dreamSeenWhilePending = false

    private val main: Handler by lazy { Handler(Looper.getMainLooper()) }

    // ─── expectations ────────────────────────────────────────────────

    /**
     * A native BLANK just succeeded via [providerId]. Called by
     * [DisplayControlRegistry.apply] after the mirror is recorded. Never
     * throws, never drives the panel by itself — only schedules the check.
     */
    fun expect(ctx: Context, providerId: String) {
        val app = ctx.applicationContext
        val immediate = SleepProofPolicy.immediateOutcomeFor(providerId)
        val settle = SleepProofPolicy.settleMsFor(providerId)
        if (immediate != null || settle == null) {
            // Nothing Android-visible to wait for: the software floor is a
            // black view; a vendor command leaves Android interactive by
            // design, so isInteractive cannot prove it either way.
            pending = null
            record(app, providerId, immediate ?: SleepProofPolicy.OUTCOME_UNKNOWN)
            return
        }
        val p = Pending(providerId, SystemClock.elapsedRealtime(), forRestore = false)
        pending = p
        dreamSeenWhilePending = false
        runCatching { main.postDelayed({ runCatching { check(app, p) } }, settle) }
            .onFailure { PlayerLogger.w(TAG, "could not schedule the sleep check: ${it.message}") }
    }

    /**
     * The blank that was just expected is the all-clear RESTORE of a person's
     * standby: when it does not take, cover the screen with black.
     */
    fun markForRestore(ctx: Context, providerId: String?) {
        val app = ctx.applicationContext
        val p = pending
        if (p != null) {
            p.forRestore = true
            recordRestore(app, "RESTORE", SleepProofPolicy.OUTCOME_PENDING)
        } else {
            // Nothing to wait for (see [expect]).
            recordRestore(
                app,
                "RESTORE",
                providerId?.let { SleepProofPolicy.immediateOutcomeFor(it) } ?: SleepProofPolicy.OUTCOME_UNKNOWN,
            )
        }
    }

    /** The all-clear decided NOT to put the panel back to sleep — say why. */
    fun noteRestoreDecision(ctx: Context, decision: String, outcome: String) {
        recordRestore(ctx.applicationContext, decision, outcome)
    }

    /**
     * A WAKE is about to run through the registry. If a blank is still being
     * checked, judge it on what the panel is doing right now — after the wake
     * the answer would always be "on". Never covers anything: a wake is coming.
     */
    fun beforeWake(ctx: Context) {
        val p = pending ?: return
        pending = null
        val app = ctx.applicationContext
        val interactive = runCatching {
            (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
        }.getOrNull()
        val outcome = SleepProofPolicy.outcome(interactive, dreamSeenWhilePending)
        record(app, p.providerId, outcome)
        if (p.forRestore) recordRestore(app, "RESTORE", outcome)
    }

    // ─── the screensaver ─────────────────────────────────────────────

    /** `ACTION_DREAMING_STARTED` — registered by [com.educms.player.standby.UserStandby.install]. */
    fun onDreamingStarted(ctx: Context) {
        val app = ctx.applicationContext
        if (pending != null) dreamSeenWhilePending = true
        // A screensaver over a live alert is a hidden alert. Raise-direction
        // only: enforceNow ends the dream (its wake lock wakes the panel).
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) {
            PlayerLogger.e(TAG, "a SCREENSAVER started during an active emergency alert — putting the alert back on the glass")
            runCatching { DisplayEmergency.enforceNow(app) }
                .onFailure { PlayerLogger.e(TAG, "emergency re-assert after a screensaver failed", it) }
            return
        }
        val blankProvider = runCatching {
            DisplayControlRegistry.providerFor(app, Capability.BLANK)?.id
        }.getOrNull()
        val p = pending
        if (!SleepProofPolicy.dreamProvesTimeoutCannotSleep(DisplayPrefs.blanked(app), blankProvider, p?.providerId)) {
            PlayerLogger.i(TAG, "a screensaver started (not during one of our blanks) — leaving it to the system")
            return
        }
        PlayerLogger.w(
            TAG,
            "the screen-off timeout started a SCREENSAVER instead of sleeping this panel — ending it, putting the " +
                "timeout back, covering with black; the screen-timeout blank is not used on this box from now on",
        )
        runCatching {
            prefs(app).edit().putLong(KEY_DREAM_OBSERVED_AT, System.currentTimeMillis()).commit()
        }
        runCatching { ScreenWakeLock.pokeScreen(app) }
        runCatching { ScreenTimeoutBlankProvider.restoreTimeout(app) }
        runCatching { DisplayControlRegistry.invalidate() }
        cover(app, "the screensaver replaced a sleep")
        pending = null
        record(app, p?.providerId ?: ScreenTimeoutBlankProvider.id, SleepProofPolicy.OUTCOME_DREAM)
        if (p?.forRestore == true) recordRestore(app, "RESTORE", SleepProofPolicy.OUTCOME_BLACK)
    }

    /** Has a screensaver been SEEN to replace this box's screen-timeout sleep? */
    fun dreamObserved(ctx: Context): Boolean = runCatching {
        prefs(ctx.applicationContext).getLong(KEY_DREAM_OBSERVED_AT, 0L) > 0L
    }.getOrDefault(false)

    /**
     * Should [ScreenTimeoutBlankProvider] decline on this box? Only on
     * observed evidence, and only while the screensaver is still configured
     * to start on sleep — an operator who turns the screensaver off gets the
     * mechanism back without anything else changing.
     */
    fun timeoutBlankDeclined(ctx: Context): Boolean {
        val app = ctx.applicationContext
        val observedAt = runCatching { prefs(app).getLong(KEY_DREAM_OBSERVED_AT, 0L) }.getOrDefault(0L)
        if (observedAt <= 0L) return false
        return SleepProofPolicy.timeoutBlankDeclined(
            dreamObservedAtMs = observedAt,
            screensaverEnabled = secureInt(app, "screensaver_enabled"),
            activateOnSleep = secureInt(app, "screensaver_activate_on_sleep"),
        )
    }

    // ─── the report ──────────────────────────────────────────────────

    /**
     * Compact facts for the native runtime report (`sleep` key). Short keys
     * on purpose — the whole header must stay well under 1 KiB:
     * `blank` resolved BLANK mechanism, `dream` screensaver seen replacing a
     * sleep, `a11y` accessibility sleep service on, `admin` this app is an
     * active device admin, `last` {m mechanism, o outcome, at wall ms},
     * `restore` {d decision, o outcome, at wall ms}.
     */
    fun reportJson(ctx: Context): JSONObject? {
        val app = ctx.applicationContext
        val p = prefs(app)
        val out = JSONObject()
        runCatching { DisplayControlRegistry.providerFor(app, Capability.BLANK)?.id }.getOrNull()
            ?.let { out.put("blank", it.take(32)) }
        out.put("dream", dreamObserved(app))
        out.put("a11y", SleepAccessibilityService.isConnected())
        runCatching { DeviceAdminBlankProvider.isOurAdminActive(app) }.getOrNull()?.let { out.put("admin", it) }
        val lastAt = p.getLong(KEY_LAST_AT, 0L)
        val lastM = p.getString(KEY_LAST_MECHANISM, null)
        val lastO = p.getString(KEY_LAST_OUTCOME, null)
        if (lastAt > 0L && lastM != null && lastO != null) {
            out.put("last", JSONObject().put("m", lastM.take(32)).put("o", lastO.take(16)).put("at", lastAt))
        }
        // How idle the box was when its last "person's" standby began, and
        // its own inactivity-sleep setting — equal values mean Android, not
        // a person, turned the panel off (seconds; -1 = unknown / disabled).
        val offAt = p.getLong(com.educms.player.standby.UserStandby.KEY_LAST_OFF_AT_WALL, 0L)
        // The box's own inactivity sleep setting (Settings.System.SCREEN_OFF_TIMEOUT, ms; -1 = unreadable
        // or disabled). 1.1.42 (lead, 2026-10-18): `blank` above is the mechanism WE would use, not what
        // happened — a reader took "blank: screen-timeout" for "Android's timeout turned it off".
        // `off` says only what the evidence proves about the last display-off that was not ours.
        val screenOffTimeoutMs = runCatching {
            Settings.System.getInt(app.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, -1)
        }.getOrDefault(-1)
        out.put("sotS", if (screenOffTimeoutMs > 0) (screenOffTimeoutMs / 1000).coerceAtMost(999_999_999) else -1)
        if (offAt > 0L) {
            val idle = p.getLong(com.educms.player.standby.UserStandby.KEY_LAST_OFF_IDLE_MS, -1L)
            val idleS = if (idle >= 0L) (idle / 1000L).coerceAtMost(999_999_999L) else -1L
            out.put("offIdleS", idleS)
            out.put("offAt", offAt)
            out.put("off", SleepProofPolicy.offCause(idleS, screenOffTimeoutMs.toLong()))
        }
        secureInt(app, "attentive_timeout")?.let { ms ->
            out.put("attS", if (ms > 0) (ms / 1000).coerceAtMost(999_999_999) else -1)
        }
        val rAt = p.getLong(KEY_RESTORE_AT, 0L)
        val rD = p.getString(KEY_RESTORE_DECISION, null)
        val rO = p.getString(KEY_RESTORE_OUTCOME, null)
        if (rAt > 0L && rD != null && rO != null) {
            out.put("restore", JSONObject().put("d", rD.take(40)).put("o", rO.take(16)).put("at", rAt))
        }
        return out
    }

    // ─── internals ───────────────────────────────────────────────────

    private fun check(app: Context, p: Pending) {
        if (pending !== p) return
        pending = null
        val interactive = runCatching {
            (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
        }.getOrNull()
        val outcome = SleepProofPolicy.outcome(interactive, dreamSeenWhilePending)
        record(app, p.providerId, outcome)
        PlayerLogger.i(TAG, "blank via ${p.providerId}: the panel is now '$outcome' (interactive=$interactive)")
        if (!p.forRestore) return
        val cover = SleepProofPolicy.coverAfterRestore(
            outcome = outcome,
            restoredStandbyActive = runCatching {
                com.educms.player.standby.UserStandby.restoredStandbyActive(app)
            }.getOrDefault(false),
            held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true),
            blanked = DisplayPrefs.blanked(app),
        )
        if (cover) {
            cover(app, "the all-clear restore via ${p.providerId} did not turn the panel off")
            recordRestore(app, "RESTORE", SleepProofPolicy.OUTCOME_BLACK)
        } else {
            recordRestore(app, "RESTORE", outcome)
        }
    }

    /** Black over the content. Refused on the UI thread while an alert is held. */
    private fun cover(app: Context, why: String) {
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) return
        val attached = DisplayWindowBridge.withHooks { it.setBlackout(true) }
        PlayerLogger.w(TAG, "covering the screen with black ($why; window ${if (attached) "attached" else "detached"})")
    }

    private fun record(app: Context, mechanism: String, outcome: String) {
        runCatching {
            prefs(app).edit()
                .putString(KEY_LAST_MECHANISM, mechanism)
                .putString(KEY_LAST_OUTCOME, outcome)
                .putLong(KEY_LAST_AT, System.currentTimeMillis())
                .apply()
        }
    }

    private fun recordRestore(app: Context, decision: String, outcome: String) {
        runCatching {
            prefs(app).edit()
                .putString(KEY_RESTORE_DECISION, decision)
                .putString(KEY_RESTORE_OUTCOME, outcome)
                .putLong(KEY_RESTORE_AT, System.currentTimeMillis())
                .apply()
        }
    }

    /** A Secure int, or null when absent or not readable by this app. */
    private fun secureInt(app: Context, key: String): Int? = runCatching {
        Settings.Secure.getString(app.contentResolver, key)?.trim()?.toIntOrNull()
    }.getOrNull()

    private fun prefs(app: Context) = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/**
 * The pure half of [SleepProof] — every rule with a JVM test.
 */
object SleepProofPolicy {
    /** Android went non-interactive: the panel really slept. */
    const val OUTCOME_OFF = "off"

    /** Still interactive after the settle window: nothing turned it off. */
    const val OUTCOME_ON = "on"

    /** A screensaver started instead of a sleep. */
    const val OUTCOME_DREAM = "dream"

    /** Only a black overlay — the backlight stays on. */
    const val OUTCOME_BLACK = "black"

    /** The check has not run yet. */
    const val OUTCOME_PENDING = "pending"

    const val OUTCOME_UNKNOWN = "unknown"

    /** Restore only: the all-clear deliberately left the panel on (a WAKE, the schedule, a reboot). */
    const val OUTCOME_KEPT_ON = "kept-on"

    /** Restore only: no blank mechanism accepted the restore. */
    const val OUTCOME_FAILED = "failed"

    /** The screen-off timeout (15 s) + the alert's own 30 s wake lock + margin. */
    const val SCREEN_TIMEOUT_SETTLE_MS = 60_000L

    /** The last display-off that was not ours: idle at least the system screen-off timeout, so Android's inactivity sleep is consistent with it. */
    const val OFF_SCREEN_TIMEOUT = "screen-timeout"
    /** The last display-off that was not ours, with less idle time than the system timeout (or no timeout): a power key, a vendor schedule, something else — not a timeout. */
    const val OFF_DISPLAY_OFF = "display-off"
    /** No input has been seen since the process started, so the idle time is unknown. */
    const val OFF_UNKNOWN = "unknown"

    /**
     * What the evidence proves about the last display-off that was not ours
     * (player rule 10: copy states what the evidence proves). "screen-timeout"
     * ONLY when the box had been idle for at least its own
     * `Settings.System.SCREEN_OFF_TIMEOUT`; a shorter idle time, or no readable
     * timeout, is a display-off by something else (the owner's remote at
     * 2026-10-18 03:35Z read `offIdleS: 3` — never a timeout). An unknown idle
     * time proves nothing.
     */
    fun offCause(idleS: Long, screenOffTimeoutMs: Long): String = when {
        idleS < 0L -> OFF_UNKNOWN
        screenOffTimeoutMs > 0L && idleS * 1000L >= screenOffTimeoutMs -> OFF_SCREEN_TIMEOUT
        else -> OFF_DISPLAY_OFF
    }

    /** A lock or vendor command sleeps at once; the margin is for slow firmware. */
    const val IMMEDIATE_SETTLE_MS = 15_000L

    /**
     * Mechanisms whose result `isInteractive` cannot judge, recorded at once:
     * the software floor is a black view (black); a vendor command — a
     * backlight write, a NovaStar blackout — leaves Android awake BY DESIGN,
     * so "interactive" says nothing about the glass (unknown, never "on").
     * Null = an Android sleep, checked after [settleMsFor].
     */
    fun immediateOutcomeFor(providerId: String): String? = when (providerId) {
        "software-dim" -> OUTCOME_BLACK
        "vendor-recipe", "novastar-sdk" -> OUTCOME_UNKNOWN
        else -> null
    }

    /** How long to wait before asking; null = nothing to wait for ([immediateOutcomeFor]). */
    fun settleMsFor(providerId: String): Long? = when (providerId) {
        "software-dim", "vendor-recipe", "novastar-sdk" -> null
        "screen-timeout" -> SCREEN_TIMEOUT_SETTLE_MS
        else -> IMMEDIATE_SETTLE_MS
    }

    /** A dream is interactive, so it is checked first. Unknown power state is "unknown", never "off". */
    fun outcome(interactive: Boolean?, dreamSeen: Boolean): String = when {
        dreamSeen -> OUTCOME_DREAM
        interactive == false -> OUTCOME_OFF
        interactive == true -> OUTCOME_ON
        else -> OUTCOME_UNKNOWN
    }

    /**
     * After an all-clear restore, cover with black only when the panel did
     * not go off, the person's restored standby still stands, OUR blank is
     * still in force, and no alert is held. Anything that ended the standby
     * in the meantime (the power key, a WAKE, the schedule) wins.
     */
    fun coverAfterRestore(
        outcome: String,
        restoredStandbyActive: Boolean,
        held: Boolean,
        blanked: Boolean,
    ): Boolean = !held && restoredStandbyActive && blanked && (outcome == OUTCOME_ON || outcome == OUTCOME_DREAM)

    /** Does a screensaver that just started prove the screen-timeout blank cannot sleep this box? */
    fun dreamProvesTimeoutCannotSleep(blanked: Boolean, blankProviderId: String?, pendingProviderId: String?): Boolean =
        blanked && (pendingProviderId == "screen-timeout" || blankProviderId == "screen-timeout")

    /**
     * Decline the screen-timeout blank when a screensaver was SEEN replacing
     * it, unless the box now says the screensaver is off (an explicit 0).
     * An unreadable setting keeps the observation decisive.
     */
    fun timeoutBlankDeclined(dreamObservedAtMs: Long, screensaverEnabled: Int?, activateOnSleep: Int?): Boolean =
        dreamObservedAtMs > 0L && screensaverEnabled != 0 && activateOnSleep != 0
}
