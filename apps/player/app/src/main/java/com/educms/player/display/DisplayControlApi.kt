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
     *   "serverMinSafeBrightness": 5,
     *   "pendingRevertInMs": 24500,
     *   "schedules": 2,
     *   "recipe": "goodview-ecbox",
     *   "recipeCatalog": 4,
     *   "warnings": [] }
     * ```
     *
     * `recipe` is the catalog row this box MATCHED (null when none fits
     * its `Build.*`); `recipeCatalog` is how many rows the manifest
     * carried, so "null out of 4" is distinguishable from "none configured".
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
            // What this box actually MATCHED out of the catalog, plus how
            // big the catalog was — "recipe: null, catalog: 4" is the
            // signature of a match block that does not fit this Build.*,
            // which is otherwise indistinguishable from "no recipes".
            .put("recipe", VendorRecipeProvider.activeRecipe(app)?.vendorId ?: JSONObject.NULL)
            .put("recipeCatalog", config.recipes.size)
            // Reported, not enforced — the binding floor is the native
            // constant above. See DisplayConfig.serverMinSafeBrightnessPercent.
            .put("serverMinSafeBrightness", config.serverMinSafeBrightnessPercent ?: JSONObject.NULL)

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
     * cheap, which is what makes per-poll calling safe. (A re-raise is
     * NOT a no-op any more — it re-enforces; see [DisplayEmergency
     * .enforceNow]. It stays cheap because every step of the enforce is
     * a set-to-a-known-value.)
     *
     * ═════════════════════════════════════════════════════════════════
     * BOTH DIRECTIONS ARE ACCEPTED ON THE UNTRUSTED TRANSPORT — and that
     * is a deliberate 2026-08-14 reversal of the original rule.
     * ═════════════════════════════════════════════════════════════════
     * `active=true` was always ungated: it can only make a dark screen
     * visible. `active=false` was trusted-only, on the reasoning that a
     * hostile board could clear a genuine hold and let the schedule
     * blank the screen mid-lockdown. That reasoning does not survive
     * contact with the fleet, for two independent reasons:
     *
     *  1. **It bricked the feature on the oldest boxes.** On a Chromium
     *     83-87 NovaStar Taurus — an explicitly supported production
     *     target (CLAUDE.md rule 10) that is in the pilot fleet TODAY —
     *     `WebViewFeature.WEB_MESSAGE_LISTENER` is unavailable, so
     *     `NativeBridgeChannel.attach()` returns false and
     *     `window.EduCmsNativeChannel` never exists. EVERY call from the
     *     player, including the all-clear, arrives here with
     *     trusted=false. The first alert therefore engaged a hold that
     *     nothing could ever lift: panel pinned at 100% forever, every
     *     schedule blank and every brightness lowering refused for the
     *     life of the install, deferred dead-man reverts never firing,
     *     and no operator-reachable recovery short of a factory reset.
     *     A hold that cannot be released is not a safety feature.
     *
     *  2. **Release is recovery-direction, so it gains an attacker
     *     nothing.** Clearing the hold does not darken anything; it only
     *     returns the layer to normal operation. And on that same
     *     untrusted transport every darkening action is STILL refused by
     *     [isRecoveryAction] — BLANK, any brightness lowering, any
     *     allowBlack, KEEP and SET_SCHEDULE are all trusted-only. So a
     *     hostile board that clears a hold unlocks precisely nothing it
     *     can then use. The worst it can do is let a legitimate,
     *     operator-configured schedule run, which is the normal state of
     *     the product.
     *
     * Contract C4, applied consistently: fail-open for recovery,
     * fail-closed for risk. Raising is fail-safe, releasing is recovery,
     * and BOTH belong on the recovery side of the line. The release is
     * logged at WARN with its transport so the forensic trail still
     * shows exactly which surface cleared a life-safety hold.
     */
    /**
     * @param faceIndex which PANE of this box is reporting (2026-09-16,
     *   double-sided displays). 0 — the primary — is what every
     *   single-sided screen and every pre-face web bundle sends, so the
     *   default is exactly today's behaviour. The hold is a refcount over
     *   faces: it stands while ANY face holds, which is what stops side
     *   B's routine all-clear from releasing side A's live lockdown. See
     *   [DisplayEmergency.setHold].
     */
    fun emergencyHoldJson(
        ctx: Context,
        active: Boolean,
        trusted: Boolean,
        faceIndex: Int = DisplayEmergency.PRIMARY_FACE,
    ): String = try {
        val app = ctx.applicationContext
        if (!active && !trusted) {
            PlayerLogger.w(
                TAG,
                "emergency hold RELEASE accepted on the untrusted every-frame transport " +
                    "(face $faceIndex) — " +
                    "release is recovery-direction and every darkening action stays trusted-only there; " +
                    "refusing it is what pinned Chromium-83 boxes lit forever",
            )
        }
        val persisted = DisplayEmergency.setHold(app, faceIndex, active)
        JSONObject()
            .put("ok", true)
            .put("emergencyHold", DisplayEmergency.isHeld(app))
            .put("holdingFaces", org.json.JSONArray(DisplayEmergency.holdingFaces(app).sorted()))
            .put("persisted", persisted)
            .toString()
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
                .put("recipe", VendorRecipeProvider.activeRecipe(app)?.vendorId ?: JSONObject.NULL)
                .put("recipeCatalog", config.recipes.size)
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

        // ── P1/P2 (2026-08-25, v1.1.5) — SAMPLE THE PANEL AROUND THE APPLY ──
        //
        // The operator's problem, stated exactly: the server cannot tell
        // "the panel did it" from "the panel silently did nothing".
        // `delivered:true` only ever meant the fan-out was up, and both of
        // this fleet's real failure modes are silent — a
        // `Settings.System.SCREEN_BRIGHTNESS` write that returns true and
        // moves nothing (G43 / Mobile A-Frame), and a `software-dim` that
        // dims OUR composition while the backlight stays lit.
        //
        // So we read every brightness value this uid can read immediately
        // before and immediately after, and ship BOTH. `changed` then
        // answers, per hardware model and with nobody on site, the one
        // question a mechanism's own success/failure return cannot: did the
        // glass move? A `false` on an `ok:true` apply is precisely the
        // silent no-op, and it is now visible in the fleet report.
        //
        // Bounded to the actions that can move a backlight so a VOLUME or
        // KEEP costs nothing.
        val wantsEvidence = action is DisplayAction.SetBrightness ||
            action == DisplayAction.Blank ||
            action == DisplayAction.Wake
        val before = if (wantsEvidence) safeSample(ctx) else null

        val result = DisplayControlRegistry.apply(ctx, action, revertAfterMs)
        val after = if (wantsEvidence) safeSample(ctx) else null
        val backstop = windowBrightnessBackstop(ctx, action, result, before, after)

        return when (result) {
            is ActionResult.Ok -> JSONObject()
                .put("ok", true)
                .put("capability", action.capability.name)
                .put("provider", result.providerId)
                // `mechanism` is `provider` under the name the dashboard,
                // the verdict and the server-side proven/unproven allowlists
                // all use. Both are emitted: `provider` is what every
                // shipped consumer reads, `mechanism` is what the outcome
                // report speaks.
                .put("mechanism", result.providerId)
                .put("detail", result.detail ?: JSONObject.NULL)
                .put("revertAfterMs", revertAfterMs ?: JSONObject.NULL)
                .also { attachEvidence(it, before, after, backstop) }
                .toString()
            is ActionResult.Unsupported ->
                JSONObject(errorJson("unsupported", result.reason))
                    .put("capability", action.capability.name)
                    .also { attachEvidence(it, before, after, backstop) }
                    .toString()
            is ActionResult.Failed ->
                JSONObject(errorJson("failed", result.reason))
                    .put("capability", action.capability.name)
                    // A Failed carries the provider that failed — which is
                    // the single most useful field on the whole report,
                    // because it names the mechanism to stop trying on this
                    // hardware class.
                    .put("mechanism", result.providerId ?: JSONObject.NULL)
                    .put("provider", result.providerId ?: JSONObject.NULL)
                    .also { attachEvidence(it, before, after, backstop) }
                    .toString()
        }
    }

    /**
     * Fold the before/after brightness snapshots onto an outcome document.
     *
     * `changed` compares the two verbatim: any difference in a readable
     * Settings key or backlight node counts. False positives are not a
     * concern here (nothing else writes these while we hold the moment) and
     * a false NEGATIVE is the interesting signal, which is the direction
     * that must not be smoothed over.
     */
    private fun attachEvidence(
        out: JSONObject,
        before: JSONObject?,
        after: JSONObject?,
        backstop: JSONObject? = null,
    ) {
        if (before == null || after == null) {
            if (backstop != null) runCatching { out.put("backstop", backstop) }
            return
        }
        runCatching {
            val evidence = JSONObject()
                .put("before", before)
                .put("after", after)
                .put("changed", before.toString() != after.toString())
                // Was anything readable AT ALL on this panel? Without this
                // an unreadable box and a box that genuinely did not move
                // both report `changed:false`, and only one of those is a
                // defect. See [evidenceIsReadable].
                .put("readable", evidenceIsReadable(before))
            if (backstop != null) evidence.put("backstop", backstop)
            out.put("evidence", evidence)
        }
    }

    /**
     * Does this panel expose ANY brightness value to our uid?
     *
     * `changed:false` means two completely different things depending on
     * the answer: on a readable panel it is the SILENT NO-OP we are hunting
     * (a mechanism reported success and moved nothing); on an unreadable
     * one it is simply "we cannot see", and treating that as a defect —
     * or, worse, acting on it — would be guessing.
     */
    private fun evidenceIsReadable(sample: JSONObject): Boolean = try {
        val nodes = sample.optJSONObject("nodes")
        val settings = sample.optJSONObject("settings")
        val anyNode = nodes != null && nodes.length() > 0
        val anySetting = settings != null && settings.keys().asSequence().any {
            !settings.isNull(it)
        }
        anyNode || anySetting
    } catch (t: Throwable) {
        false
    }

    /**
     * ── P2 (2026-08-25, v1.1.5) — THE WINDOW-BRIGHTNESS ATTEMPT ─────────
     *
     * THE FIELD FACT THIS ANSWERS. On the G43 / Mobile A-Frame class the
     * backlight node is READ-ONLY and a `Settings.System.SCREEN_BRIGHTNESS`
     * write is a silent no-op — it returns true and the glass does not
     * move. And there is a cruel wrinkle: granting WRITE_SETTINGS on such a
     * panel makes brightness WORSE, because `SettingsBrightnessProvider`
     * then WINS the chain ahead of `SoftwareDimProvider`, whose
     * `setWindowBrightness` is a real, permission-free backlight REQUEST
     * that those panels may well honour. BRIGHTNESS does not fall through
     * on failure (only BLANK/WAKE do — `fallsThroughOnFailure`), and the
     * settings write does not even report failure, so nothing existed to
     * catch it.
     *
     * So: when a non-window mechanism claims success and the panel's own
     * readable values say NOTHING MOVED, we make one more attempt through
     * the window, and we report both attempts. `WindowManager.LayoutParams
     * .screenBrightness` needs no permission, touches only our own window,
     * cannot latch anything, and is undone by the next brightness command
     * — it is the safest mechanism in the stack.
     *
     * ⚠️ THREE GUARDS, EACH LOAD-BEARING:
     *   1. Only when the primary mechanism is NOT already the software
     *      floor. Re-driving window brightness on top of a mechanism that
     *      just set it is pointless.
     *   2. Only when evidence is READABLE. On a panel we cannot read,
     *      `changed:false` is ignorance, not a defect — and stacking a
     *      window dim on a working sysfs backlight is the 16%-on-the-glass
     *      bug the WAKE backstop's header already warns about.
     *   3. Only for SetBrightness, and through [DisplayLimits.normalize],
     *      so the MIN_SAFE floor still applies. A backstop must never be
     *      the thing that blacks a screen.
     *
     * DELIBERATELY NOT PROMOTED TO A CHAIN POSITION. v1.1.5 ATTEMPTS and
     * REPORTS; if the field data says window brightness drives these
     * panels, v1.1.6 makes it the default for that hardware class on
     * evidence rather than on this comment's hunch.
     */
    private fun windowBrightnessBackstop(
        ctx: Context,
        action: DisplayAction,
        result: ActionResult,
        before: JSONObject?,
        after: JSONObject?,
    ): JSONObject? {
        if (action !is DisplayAction.SetBrightness) return null
        if (!result.ok) return null
        if (before == null || after == null) return null
        if (!evidenceIsReadable(before)) return null
        if (before.toString() != after.toString()) return null
        val providerId = (result as? ActionResult.Ok)?.providerId
        if (providerId == null || providerId == SoftwareDimProvider.id) return null

        // ⚠️ LIFE SAFETY, belt AND braces. This is the one place in the
        // package that calls a provider DIRECTLY instead of going through
        // DisplayControlRegistry, so it does not inherit the registry's
        // emergency gate. Reaching here already implies the registry
        // ACCEPTED the action (result.ok), and a hold that engaged
        // mid-apply would have moved the readable values via enforceNow and
        // so failed the `changed` test above — but a re-check is two lines
        // and the alternative is reasoning about a race on a lockdown
        // screen. If an alert is up, this backstop simply does not run.
        if (DisplayEmergency.isHeld(ctx.applicationContext)) {
            PlayerLogger.w(TAG, "window-brightness backstop skipped — an emergency hold is active")
            return null
        }

        return try {
            PlayerLogger.w(
                TAG,
                "brightness via $providerId reported OK but no readable value moved — " +
                    "attempting the permission-free window-brightness request as a backstop",
            )
            val safe = DisplayLimits.normalize(action)
            val attempt = SoftwareDimProvider.apply(ctx, safe)
            val settled = safeSample(ctx)
            JSONObject()
                .put("mechanism", SoftwareDimProvider.id)
                .put("reason", "primary-mechanism-moved-nothing")
                .put("primaryMechanism", providerId)
                .put("ok", attempt.ok)
                .put("after", settled ?: JSONObject.NULL)
                .put(
                    "changed",
                    if (settled == null) JSONObject.NULL else after.toString() != settled.toString(),
                )
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "window-brightness backstop failed: ${t.message}")
            JSONObject().put("mechanism", SoftwareDimProvider.id).put("ok", false)
                .put("error", t.message ?: t.javaClass.simpleName)
        }
    }

    /** Evidence is never worth failing an apply for. */
    private fun safeSample(ctx: Context): JSONObject? = try {
        DisplayCapabilityProbe.brightnessSample(ctx)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "brightness sample failed: ${t.message}")
        null
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
