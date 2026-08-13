package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * The JS-bridge facade. Everything the web player can ask the display
 * layer to do goes through exactly these three methods, and every one of
 * them takes/returns a JSON STRING so there is no Kotlin↔JS object
 * marshalling to get wrong (the same convention `ctsSerial*` uses).
 *
 * ⚠️ TRUST BOUNDARY. Per `WebAppBridge`'s header, the legacy
 * `addJavascriptInterface` surface is exposed to EVERY frame the WebView
 * loads — including operator-authored board HTML. So every argument that
 * reaches here is attacker-controlled and is validated NATIVELY:
 *
 *   * the brightness floor is applied in [DisplayLimits], not in React;
 *   * the recipe allowlist is [RecipeAllowlist], not a server-side check;
 *   * an action naming a capability this box does not expose is REFUSED
 *     here, not merely hidden in the dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ TRUSTED vs UNTRUSTED TRANSPORT
 * ─────────────────────────────────────────────────────────────────────
 * Every mutating entry point takes a `trusted` flag. It is true ONLY for
 * `NativeBridgeChannel`, which has already verified the exact origin and
 * that the caller is the main frame. The legacy `addJavascriptInterface`
 * object — reachable from EVERY frame, including operator-authored board
 * HTML — always passes false, and untrusted callers get only the
 * RECOVERY-direction subset ([isRecoveryAction]).
 *
 * That split, rather than "refuse the legacy transport when the channel
 * is live", is the 2026-08-13 fix: the old gate was a no-op on exactly
 * the oldest boxes, because when the channel CANNOT attach the gate
 * evaluated false and let everything through. It protected the modern
 * devices and left the wall-mounted LED controllers exposed.
 */
object DisplayControlApi {

    private const val TAG = "DisplayControl"

    /**
     * What can this box actually do, and by which mechanism.
     *
     * ```json
     * { "ok": true,
     *   "capabilities": { "BRIGHTNESS": "software-dim", "BLANK": "software-dim",
     *                     "WAKE": "software-dim", "VOLUME": "audiomanager" },
     *   "state": { "brightnessPercent": 80, "volumePercent": 40, "blanked": false,
     *              "deviceVolumePercent": 40 },
     *   "minSafeBrightness": 5,
     *   "pendingRevertInMs": 24500,
     *   "schedules": 2,
     *   "recipe": "goodview-ecbox",
     *   "warnings": [] }
     * ```
     *
     * REBOOT is ABSENT from `capabilities` on a box that cannot do it —
     * the dashboard must render controls from this map and nothing else.
     */
    fun capabilitiesJson(ctx: Context): String = try {
        val app = ctx.applicationContext
        val caps = JSONObject()
        DisplayControlRegistry.capabilities(app).forEach { (capability, providerId) ->
            caps.put(capability.name, providerId)
        }
        val config = DisplayConfigStore.load(app)
        val state = JSONObject()
            .put("brightnessPercent", DisplayPrefs.brightnessPercent(app))
            .put("volumePercent", DisplayPrefs.volumePercent(app))
            .put("blanked", DisplayPrefs.blanked(app))
        AudioManagerProvider.currentPercent(app)?.let { state.put("deviceVolumePercent", it) }

        val out = JSONObject()
            .put("ok", true)
            .put("capabilities", caps)
            .put("state", state)
            .put("minSafeBrightness", DisplayLimits.MIN_SAFE_BRIGHTNESS)
            .put("schedules", config.schedules.size)
            .put("recipe", config.recipe?.vendorId ?: JSONObject.NULL)

        DisplayGuard.peek(app)?.let {
            out.put("pendingRevertInMs", (it.dueAtEpochMs - System.currentTimeMillis()).coerceAtLeast(0))
        }
        out.put("pendingReverts", DisplayGuard.peekAll(app).size)
        // ⚠️ Surfaced so the dashboard can SAY why blank/dim is refused
        // rather than showing an unexplained error. A hold never expires
        // on its own, so `emergencyHeldSinceMs` is also how ops notice a
        // screen stuck lit because the page died mid-alert.
        if (DisplayEmergency.isHeld(app)) {
            out.put("emergencyHold", true)
            out.put("emergencyHeldSinceMs", DisplayEmergency.heldSinceMs(app))
        } else {
            out.put("emergencyHold", false)
        }
        if (config.warnings.isNotEmpty()) {
            out.put("warnings", org.json.JSONArray(config.warnings))
        }
        out.toString()
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "capabilitiesJson failed: ${t.message}")
        errorJson("exception", t.message ?: t.javaClass.simpleName)
    }

    /**
     * Apply one immediate action.
     *
     * ```json
     * {"action":"SET_BRIGHTNESS","percent":40,"allowBlack":false,"revertAfterMs":30000}
     * {"action":"SET_VOLUME","percent":30,"revertAfterMs":30000}
     * {"action":"BLANK","revertAfterMs":60000}
     * {"action":"WAKE"}
     * {"action":"REBOOT"}
     * {"action":"KEEP"}     ← cancels a pending dead-man revert
     * ```
     *
     * `revertAfterMs` is clamped to 1 s … 1 h. The dashboard is expected
     * to send one on every operator TEST; the scheduler never does.
     */
    fun applyJson(ctx: Context, json: String?, trusted: Boolean): String = try {
        val app = ctx.applicationContext
        val obj = JSONObject(json ?: "")
        val name = normalizeActionName(obj.optString("action", ""))
        val revert = if (obj.has("revertAfterMs")) {
            obj.optLong("revertAfterMs", 0L).takeIf { it > 0 }
        } else {
            null
        }

        when (name) {
            "KEEP", "CANCELREVERT" ->
                // KEEP makes a change PERMANENT by disarming its
                // dead-man. That is squarely a risk-direction operation —
                // an untrusted frame could blank a screen and then keep
                // it — so it is trusted-only.
                if (!trusted) {
                    refuseUntrusted("KEEP")
                } else {
                    DisplayGuard.cancel(app)
                    JSONObject().put("ok", true).put("action", "KEEP").toString()
                }
            "SETBRIGHTNESS" -> run(
                app,
                DisplayAction.SetBrightness(
                    percent = obj.optInt("percent", -1),
                    allowBlack = obj.optBoolean("allowBlack", false),
                ),
                revert,
                trusted,
            )
            "SETVOLUME" -> run(app, DisplayAction.SetVolume(obj.optInt("percent", -1)), revert, trusted)
            "BLANK" -> run(app, DisplayAction.Blank, revert, trusted)
            "WAKE" -> run(app, DisplayAction.Wake, revert, trusted)
            "REBOOT" -> run(app, DisplayAction.Reboot, null, trusted)
            else -> errorJson("bad-action", "unknown action '${name.take(32)}'")
        }
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "applyJson failed: ${t.message}")
        errorJson("exception", t.message ?: t.javaClass.simpleName)
    }

    /**
     * ⚠️ LIFE SAFETY. Report whether an emergency alert is active on this
     * screen, so the display layer can refuse to hide it.
     *
     * Called by the web player on the WS OVERRIDE / ALL_CLEAR handlers
     * AND on every manifest poll carrying an `emergency` field — the
     * second one is what covers a screen with no WebSocket riding the
     * HTTP polling backstop. Idempotent: re-reporting the same state is
     * a cheap no-op, which is what makes per-poll calling safe.
     *
     * `active=true` is accepted from ANY transport (it can only make a
     * dark screen visible). `active=false` is a mutating,
     * risk-direction operation and is trusted-only — otherwise a hostile
     * board could clear a genuine hold and let the schedule blank the
     * screen mid-lockdown.
     */
    fun emergencyHoldJson(ctx: Context, active: Boolean, trusted: Boolean): String = try {
        val app = ctx.applicationContext
        if (!active && !trusted) {
            refuseUntrusted("EMERGENCY_HOLD_RELEASE")
        } else {
            val persisted = DisplayEmergency.setHold(app, active)
            JSONObject()
                .put("ok", true)
                .put("emergencyHold", DisplayEmergency.isHeld(app))
                .put("persisted", persisted)
                .toString()
        }
    } catch (t: Throwable) {
        PlayerLogger.e(TAG, "emergencyHoldJson FAILED", t)
        errorJson("exception", t.message ?: t.javaClass.simpleName)
    }

    /**
     * Install the manifest's `display` block: schedule rows + brightness
     * policy + vendor recipe. Persists it, re-resolves the provider
     * chain (a new recipe can promote BRIGHTNESS off the software floor)
     * and re-arms the alarm.
     *
     * Returns what was accepted and — importantly — what was REFUSED, so
     * an operator who configured a vendor recipe that the native
     * allowlist rejected finds out instead of silently getting software
     * dim forever.
     */
    fun setScheduleJson(ctx: Context, json: String?, trusted: Boolean): String {
        // Trusted-only, unconditionally. A schedule row is a STANDING
        // instruction to blank the panel every night — strictly worse
        // than a one-off blank, which at least carries a dead-man.
        if (!trusted) return refuseUntrusted("SET_SCHEDULE")
        return try {
            val app = ctx.applicationContext
            val config = DisplayConfigStore.save(app, json)
            DisplayControlRegistry.invalidate()
            DisplayScheduler.armAndApply(app)
            JSONObject()
                .put("ok", true)
                .put("schedules", config.schedules.size)
                .put("recipe", config.recipe?.vendorId ?: JSONObject.NULL)
                .put("warnings", org.json.JSONArray(config.warnings))
                .toString()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "setScheduleJson failed: ${t.message}")
            errorJson("exception", t.message ?: t.javaClass.simpleName)
        }
    }

    /**
     * Re-assert the persisted state when an Activity window appears.
     *
     * A scheduled blank can fire while the Activity is dead — the
     * software floor records the intent and returns
     * "deferred — no window attached". This is what makes that promise
     * good the moment a window exists again.
     */
    fun onWindowAttached(ctx: Context) {
        val app = ctx.applicationContext
        runCatching {
            // ⚠️ LIFE SAFETY, AND IT MUST BE FIRST. Without this the
            // persisted `blanked=true` below would re-apply the blank on
            // EVERY process start — so a screen that died mid-lockdown
            // came back black over the alert. The hold is persisted for
            // exactly this moment.
            if (DisplayEmergency.isHeld(app)) {
                PlayerLogger.e(
                    TAG,
                    "window attached during an ACTIVE EMERGENCY — forcing a visible screen, not the persisted blank",
                )
                DisplayEmergency.enforceNow(app)
                return@runCatching
            }
            if (DisplayPrefs.blanked(app)) {
                PlayerLogger.i(TAG, "window attached while blanked — re-applying blank")
                DisplayControlRegistry.apply(app, DisplayAction.Blank, revertAfterMs = null)
                return@runCatching
            }
            // Only re-drive brightness when it is NOT the firmware
            // default. Pushing 100% on every Activity start would fight
            // a vendor's own ambient/auto setting on boxes we do not
            // otherwise touch.
            val pct = DisplayPrefs.brightnessPercent(app)
            if (pct < 100) {
                PlayerLogger.i(TAG, "window attached — re-applying brightness $pct%")
                DisplayControlRegistry.apply(app, DisplayAction.SetBrightness(pct), revertAfterMs = null)
            }
        }.onFailure { PlayerLogger.w(TAG, "onWindowAttached failed: ${it.message}") }
    }

    // ─── internals ──────────────────────────────────────────────────

    private fun run(ctx: Context, action: DisplayAction, revertAfterMs: Long?, trusted: Boolean): String {
        // Percent actions arriving with no/invalid `percent` are refused
        // rather than defaulted — a defaulted 0 is a dark screen.
        val badPercent = (action is DisplayAction.SetBrightness && action.percent < 0) ||
            (action is DisplayAction.SetVolume && action.percent < 0)
        if (badPercent) return errorJson("bad-percent", "percent must be 0..100")

        if (!trusted && !isRecoveryAction(ctx, action)) {
            return refuseUntrusted(action.describe())
        }

        return when (val result = DisplayControlRegistry.apply(ctx, action, revertAfterMs)) {
            is ActionResult.Ok -> JSONObject()
                .put("ok", true)
                .put("capability", action.capability.name)
                .put("provider", result.providerId)
                .put("detail", result.detail ?: JSONObject.NULL)
                .put("revertAfterMs", revertAfterMs ?: JSONObject.NULL)
                .toString()
            is ActionResult.Unsupported -> errorJson("unsupported", result.reason)
            is ActionResult.Failed -> errorJson("failed", result.reason)
        }
    }

    /**
     * ⚠️ THE UNTRUSTED-TRANSPORT ALLOWLIST — fail-open for recovery,
     * fail-closed for risk.
     *
     * The legacy `addJavascriptInterface` object is materialised in every
     * frame the WebView loads, including operator-authored EXTERNAL_HTML
     * board iframes. A hostile board must not be able to blank, dim,
     * reboot or permanently keep a change on a screen nobody can reach
     * without a ladder — but it also must not be able to LOCK OUT the
     * one thing that gets a dark screen back, because the previous gate
     * (refuse when the channel is live) inverted exactly that way: it
     * protected the modern boxes and left the oldest LED controllers
     * wide open.
     *
     * So the untrusted subset is precisely the actions that can only ever
     * make the screen MORE visible:
     *
     *   * WAKE — always;
     *   * SET_BRIGHTNESS that RAISES (or holds) the current level, with
     *     allowBlack=false;
     *   * nothing else. BLANK, REBOOT, KEEP, SET_VOLUME, any
     *     allowBlack, any lowering, and SET_SCHEDULE are trusted-only.
     */
    internal fun isRecoveryAction(ctx: Context, action: DisplayAction): Boolean =
        isRecoveryAction(DisplayPrefs.brightnessPercent(ctx.applicationContext), action)

    /** Pure form, so the allowlist is unit-testable on a plain JVM. */
    internal fun isRecoveryAction(currentPercent: Int, action: DisplayAction): Boolean = when (action) {
        DisplayAction.Wake -> true
        is DisplayAction.SetBrightness -> !action.allowBlack && action.percent >= currentPercent
        else -> false
    }

    private fun refuseUntrusted(what: String): String {
        PlayerLogger.w(
            TAG,
            "REFUSED '$what' on the untrusted every-frame transport — only recovery-direction " +
                "actions (wake, raise brightness) are reachable there",
        )
        return errorJson(
            "insecure-transport",
            "use the origin-scoped bridge channel — only wake / raise-brightness are allowed here",
        )
    }

    /** "set_brightness" / "setBrightness" / "SET-BRIGHTNESS" → "SETBRIGHTNESS". */
    internal fun normalizeActionName(raw: String): String =
        raw.uppercase().filter { it.isLetterOrDigit() }

    internal fun errorJson(code: String, message: String): String = JSONObject()
        .put("ok", false)
        .put("code", code)
        .put("message", message.take(200))
        .toString()
}
