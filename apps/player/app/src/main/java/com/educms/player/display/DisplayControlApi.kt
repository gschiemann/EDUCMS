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
 * `WebAppBridge` additionally refuses the two MUTATING methods over the
 * legacy transport whenever the origin-scoped `NativeBridgeChannel` is
 * live on this device — see the note there.
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
    fun applyJson(ctx: Context, json: String?): String = try {
        val app = ctx.applicationContext
        val obj = JSONObject(json ?: "")
        val name = normalizeActionName(obj.optString("action", ""))
        val revert = if (obj.has("revertAfterMs")) {
            obj.optLong("revertAfterMs", 0L).takeIf { it > 0 }
        } else {
            null
        }

        when (name) {
            "KEEP", "CANCELREVERT" -> {
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
            )
            "SETVOLUME" -> run(app, DisplayAction.SetVolume(obj.optInt("percent", -1)), revert)
            "BLANK" -> run(app, DisplayAction.Blank, revert)
            "WAKE" -> run(app, DisplayAction.Wake, revert)
            "REBOOT" -> run(app, DisplayAction.Reboot, null)
            else -> errorJson("bad-action", "unknown action '${name.take(32)}'")
        }
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "applyJson failed: ${t.message}")
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
    fun setScheduleJson(ctx: Context, json: String?): String = try {
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

    private fun run(ctx: Context, action: DisplayAction, revertAfterMs: Long?): String {
        // Percent actions arriving with no/invalid `percent` are refused
        // rather than defaulted — a defaulted 0 is a dark screen.
        val badPercent = (action is DisplayAction.SetBrightness && action.percent < 0) ||
            (action is DisplayAction.SetVolume && action.percent < 0)
        if (badPercent) return errorJson("bad-percent", "percent must be 0..100")

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

    /** "set_brightness" / "setBrightness" / "SET-BRIGHTNESS" → "SETBRIGHTNESS". */
    internal fun normalizeActionName(raw: String): String =
        raw.uppercase().filter { it.isLetterOrDigit() }

    internal fun errorJson(code: String, message: String): String = JSONObject()
        .put("ok", false)
        .put("code", code)
        .put("message", message.take(200))
        .toString()
}
