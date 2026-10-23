package com.educms.player.display

import com.educms.player.standby.RestoreBlankPolicy
import org.json.JSONObject

/**
 * TRUE STANDBY ON A GOODVIEW GUQ (Amlogic t982, IFPDOS firmware) — the rules
 * (player 1.1.52, 2026-10-23).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY A FOURTH BLANK MECHANISM
 * ═════════════════════════════════════════════════════════════════════
 * Every blank this package had put the panel to sleep by putting ANDROID to
 * sleep (a device-admin lock, the accessibility sleep, the screen-off
 * timeout) or by covering the picture with black while the backlight stayed
 * lit (the software floor). The first family is the standby-alert hole: a
 * slept Android is a dead web page, and on an Android 11 IFPDOS panel it has
 * latched into a vendor standby that ignored WAKE (the G43, 2026-08-25). The
 * second saves no power and is not "off".
 *
 * The panel vendor's own player does neither. On a t982 it binds the IFPDOS
 * OpenSDK control service that ships on the panel (`com.seewo.mcuservice`,
 * exported action `com.ifpdos.opensdk.SERVICE_MANAGER`) and asks the MCU to
 * switch the panel's backlight off — `SDKDeviceHelper.setScreenStatus(false)`
 * — while Android, the app and its WebView keep running. That is what the
 * glass needs: DARK, with the page alive and the native alert watch polling,
 * so an alert turns the backlight back on in well under a second.
 *
 * The wire shapes below were reconstructed statically from the vendor's own
 * player (jadx over CloudSign-V3.1.8-GVBOX, never run), as cited in
 * `docs/research/2026-10-23-guq-enhancements/01-report.md`:
 *  • bind `Intent(SERVICE_MANAGER_ACTION).setPackage(SERVICE_PACKAGE)` →
 *    `ISDKServiceManager` (descriptor [SERVICE_MANAGER_DESCRIPTOR]),
 *    transaction [TX_GET_SERVICE] `getService(String): IBinder`;
 *  • `getService("opensdk")` → `ISDKService` ([SDK_SERVICE_DESCRIPTOR]),
 *    transaction [TX_GET_TOKEN] `getToken(packageName, null): String` and
 *    [TX_SEND_MESSAGE] `sendMessage(token, requestJson): String`;
 *  • a request is `SDKRequest` as fastjson writes it — `requestName` = the
 *    command's class name, `paramsJson` = the command's own fields; a reply is
 *    `SDKResponse` — `status` (SUCCESS | HANDLER_NOT_FOUND | SERVICE_NOT_FOUND
 *    | SDK_NOT_CONNECTED), `responseName`, `paramsJson`.
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE RULES (every one has a JVM test: VendorBacklightPolicyTest,
 * VendorBacklightEngineTest)
 * ═════════════════════════════════════════════════════════════════════
 *  1. AUTO-DETECTED, NO SETTING (owner rule 2026-10-18). The mechanism is used
 *     when — and only when — the vendor service is installed, binds, hands out
 *     a token and ANSWERS a probe on this device. Absent, refused, silent or
 *     answering "handler not found" ⇒ the chain falls through to exactly the
 *     mechanisms it used yesterday. A device that has proven the service once
 *     ([supports] `seenBefore`) is trusted through the next boot's probe so a
 *     persisted blank is not re-applied by a worse mechanism at process start.
 *  2. BOUNDED, OFF THE MAIN THREAD. Every binder call runs on one worker with
 *     a budget ([BIND_TIMEOUT_MS], [CALL_TIMEOUT_MS]); a call that outlives
 *     its budget is a FAILURE, never a hang, and the registry falls through.
 *  3. EMERGENCY FIRST. `DisplayEmergency.enforceNow` asks for the backlight
 *     ON before it drives a single window hook, on the worker, and never
 *     waits for it ([emergencyOnWanted]). A failed or hanging vendor call can
 *     delay nothing that draws the alert — the registry WAKE that follows is
 *     bounded by `EmergencyPaintPolicy.WAKE_BUDGET_MS` as before.
 *  4. A FAULT STEPS ASIDE FOR DARKENING ONLY. If the backlight could not be
 *     turned back ON after we turned it off, this mechanism stops offering
 *     BLANK for the rest of the process ([supports] `faulted`) so no further
 *     blank can strand the panel; WAKE keeps trying, because nothing else can
 *     light a backlight the MCU holds off.
 *  5. THE KILL SWITCH ONLY REMOVES (lead-only, `PLAYER_VENDOR_BACKLIGHT`): the
 *     manifest's `display.vendorBacklight: false` disables the mechanism for a
 *     screen or the fleet; absent, `true` or garbage changes nothing.
 *  6. A FALL-THROUGH FROM THIS MECHANISM NEVER TAKES A LATCH-PRONE LOCK on
 *     hardware where one has latched ([fallThroughAllows] = RestoreBlankPolicy):
 *     a vendor blank that fails on a GUQ must not become a `lockNow()` on the
 *     very firmware class that latched the G43.
 *
 * Pure — no `android.*` — so every rule has a test that cannot be skipped for
 * want of an emulator.
 */
object VendorBacklightPolicy {

    const val PROVIDER_ID = "vendor-backlight"

    // ─── the vendor service, as the vendor's own player reaches it ──

    const val SERVICE_PACKAGE = "com.seewo.mcuservice"
    const val SERVICE_MANAGER_ACTION = "com.ifpdos.opensdk.SERVICE_MANAGER"
    const val SERVICE_MANAGER_DESCRIPTOR = "com.seewo.sdk.internal.model.ISDKServiceManager"
    const val SDK_SERVICE_DESCRIPTOR = "com.seewo.sdk.internal.model.ISDKService"
    const val SDK_SERVICE_NAME = "opensdk"

    /** `ISDKServiceManager.getService(String): IBinder`. */
    const val TX_GET_SERVICE = 1

    /** `ISDKService.getToken(String packageName, String unused): String`. */
    const val TX_GET_TOKEN = 1

    /** `ISDKService.sendMessage(String token, String requestJson): String`. */
    const val TX_SEND_MESSAGE = 3

    const val CMD_SET_SCREEN_STATUS = "com.seewo.sdk.internal.command.device.CmdSetScreenStatus"
    const val CMD_GET_SCREEN_STATUS = "com.seewo.sdk.internal.command.device.CmdGetScreenStatus"

    const val STATUS_SUCCESS = "SUCCESS"
    const val STATUS_HANDLER_NOT_FOUND = "HANDLER_NOT_FOUND"

    // ─── budgets ─────────────────────────────────────────────────────

    /** Bind + `getService` + `getToken`, together. The vendor's own client retries a failed bind every 3 s. */
    const val BIND_TIMEOUT_MS = 5_000L

    /** One `sendMessage` round trip. An MCU command answers in tens of milliseconds. */
    const val CALL_TIMEOUT_MS = 1_500L

    /**
     * How long an APPLY through the registry may wait in total (connect if
     * needed, the command, the readback). Inside `EmergencyPaintPolicy
     * .WAKE_BUDGET_MS` (2 s) so the alert path's own bound is never the one
     * that fires first on a healthy service.
     */
    const val APPLY_BUDGET_MS = 1_900L

    /** A probe that could not reach the service is tried again after this. */
    const val PROBE_RETRY_MS = 60_000L

    /** Probes a process gives up after (the next process start probes again). */
    const val MAX_PROBES = 5

    // ─── detection ───────────────────────────────────────────────────

    enum class Detection(val wire: String) {
        /** Not asked yet, or being asked. */
        PROBING("probing"),
        /** Bound, token issued, the screen-status probe answered. */
        AVAILABLE("available"),
        /** The vendor package is not installed on this box — most of the fleet. */
        ABSENT("absent"),
        /** Installed, but the bind, the token or the probe did not complete in budget. */
        UNREACHABLE("unreachable"),
        /** Answered, but the screen-status command is not handled on this firmware. */
        UNSUPPORTED("unsupported"),
    }

    /**
     * May this mechanism offer BLANK / WAKE right now?
     *
     * @param detection what the probe found so far.
     * @param seenBefore the service answered on this device in an earlier
     *        process (persisted). While a probe is still running that is what
     *        keeps a persisted blank from being re-applied by a worse
     *        mechanism at process start (rule 1); `apply` then waits for the
     *        bind, bounded, or fails through.
     * @param killSwitchOff `display.vendorBacklight === false` (rule 5).
     * @param faulted the backlight could not be turned back on in this process
     *        (rule 4) — darkening steps aside, wake does not.
     */
    fun supports(
        detection: Detection,
        seenBefore: Boolean,
        killSwitchOff: Boolean,
        faulted: Boolean,
    ): Set<Capability> {
        if (killSwitchOff) return emptySet()
        val reachable = detection == Detection.AVAILABLE || (detection == Detection.PROBING && seenBefore)
        if (!reachable) return emptySet()
        return if (faulted) setOf(Capability.WAKE) else setOf(Capability.BLANK, Capability.WAKE)
    }

    /** Is a probe worth running (again)? */
    fun probeDue(detection: Detection, probes: Int, lastProbeAtMs: Long?, nowMs: Long): Boolean = when (detection) {
        Detection.AVAILABLE, Detection.ABSENT, Detection.UNSUPPORTED -> false
        Detection.PROBING -> probes == 0 || (lastProbeAtMs != null && nowMs - lastProbeAtMs >= PROBE_RETRY_MS)
        Detection.UNREACHABLE -> probes < MAX_PROBES && (lastProbeAtMs == null || nowMs - lastProbeAtMs >= PROBE_RETRY_MS)
    }

    // ─── the wire ────────────────────────────────────────────────────

    /**
     * `SDKRequest` for `CmdSetScreenStatus(isOn, isAllowIntercept = true)`.
     *
     * fastjson names the command's properties from its getters: `isOn()` →
     * `on`, `isIsAllowIntercept()` → `isAllowIntercept`. `isOn` is written as
     * well: fastjson's deserialiser smart-matches an `is`-prefixed key onto
     * the same property, so a firmware that serialised the field name instead
     * of the getter name still reads the value, and an unknown key is ignored.
     */
    fun setScreenStatusRequest(on: Boolean): String = request(
        CMD_SET_SCREEN_STATUS,
        JSONObject().put("on", on).put("isOn", on).put("isAllowIntercept", true),
    )

    /** `SDKRequest` for `CmdGetScreenStatus` — no fields. */
    fun getScreenStatusRequest(): String = request(CMD_GET_SCREEN_STATUS, JSONObject())

    private fun request(name: String, params: JSONObject): String =
        JSONObject().put("requestName", name).put("paramsJson", params.toString()).toString()

    /** One `SDKResponse`, decoded. */
    data class Reply(val status: String, val responseName: String?, val paramsJson: String?) {
        val ok: Boolean get() = status == STATUS_SUCCESS
    }

    /** Decode a `sendMessage` reply; null when it is not an SDKResponse at all. */
    fun parseReply(json: String?): Reply? {
        if (json.isNullOrBlank()) return null
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return null
        val status = o.optString("status", "").trim()
        if (status.isEmpty()) return null
        return Reply(
            status = status.take(32),
            responseName = o.optString("responseName", "").trim().ifEmpty { null }?.take(64),
            paramsJson = o.optString("paramsJson", "").trim().ifEmpty { null },
        )
    }

    /**
     * `RespBooleanResult.result` from a successful reply's params, or null
     * when the reply is not a success or carries no boolean.
     */
    fun booleanResult(reply: Reply?): Boolean? {
        if (reply == null || !reply.ok) return null
        val p = reply.paramsJson ?: return null
        val o = runCatching { JSONObject(p) }.getOrNull() ?: return null
        if (!o.has("result")) return null
        return when (val v = o.opt("result")) {
            is Boolean -> v
            is String -> when {
                v.equals("true", ignoreCase = true) -> true
                v.equals("false", ignoreCase = true) -> false
                else -> null
            }
            else -> null
        }
    }

    /** What the probe's reply means for [Detection]. */
    fun detectionFrom(probe: Reply?): Detection = when {
        probe == null -> Detection.UNREACHABLE
        probe.ok -> Detection.AVAILABLE
        probe.status == STATUS_HANDLER_NOT_FOUND -> Detection.UNSUPPORTED
        else -> Detection.UNREACHABLE
    }

    // ─── emergency ───────────────────────────────────────────────────

    /**
     * Should an enforce ask for the backlight ON (rule 3)?
     *
     * The first enforce of a hold period (`!quiet`) always asks when the
     * mechanism is reachable — the MCU may hold the backlight off for a reason
     * that is not ours (a vendor timer). A quiet per-poll re-raise asks only
     * while OUR record says the backlight is off, so a long alert on a lit
     * panel costs the MCU nothing.
     */
    fun emergencyOnWanted(reachable: Boolean, darkByUs: Boolean, quiet: Boolean): Boolean =
        reachable && (darkByUs || !quiet)

    // ─── fall-through (rule 6) ───────────────────────────────────────

    /**
     * May the registry's BLANK fall-through take [nextProviderId] after
     * [failedProviderId] did not deliver? Only a failed vendor-backlight blank
     * is constrained — to mechanisms that cannot latch on this Android
     * (`RestoreBlankPolicy`). Every other fall-through is unchanged.
     */
    fun fallThroughAllows(failedProviderId: String, nextProviderId: String, sdkInt: Int, model: String?): Boolean =
        failedProviderId != PROVIDER_ID || RestoreBlankPolicy.allows(nextProviderId, sdkInt, model)

    // ─── the sleep proof ─────────────────────────────────────────────

    /**
     * What a vendor blank PROVED: the MCU's own readback after the command.
     * `true` = the backlight reads off; `false` = it still reads on; null =
     * no readback (unknown, never "off").
     */
    fun blankOutcome(backlightOffConfirmed: Boolean?): String = when (backlightOffConfirmed) {
        true -> SleepProofPolicy.OUTCOME_OFF
        false -> SleepProofPolicy.OUTCOME_ON
        null -> SleepProofPolicy.OUTCOME_UNKNOWN
    }
}
