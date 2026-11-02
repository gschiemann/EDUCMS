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
 * exported action `com.ifpdos.opensdk.SERVICE_MANAGER`) and drives the OS's
 * OWN power state — the same standby the remote's power key enters:
 *
 *   SLEEP  `APITools.PowerOff()`, t982 branch:
 *            if (SDKDeviceHelper.I.isScreenOn()) SDKSystemHelper.I.powerOff();
 *          → `CmdGetScreenStatus`, then `CmdPowerOff(-1)`.
 *   WAKE   `APITools.PowerOn()`, t982 branch:
 *            if (!SDKDeviceHelper.I.isScreenOn()) sendKeyEvent(KEYCODE_SEEWO_POWER);
 *          → `CmdGetScreenStatus`, then `CmdSendKeyEvent(5000)`.
 *
 * Their app keeps running through that standby (their on-schedule is a
 * `java.util.Timer` in their own process, and their cloud "power on" arrives
 * over the network), so the page and the native alert watch stay alive.
 *
 * 1.1.52–1.1.56 sent `CmdSetScreenStatus(false)` instead: the MCU backlight
 * switched off behind the OS's back. On a GUQ that left the power LED
 * blinking blue/red and the panel recoverable only by unplugging it (fleet
 * kill switch `PLAYER_VENDOR_BACKLIGHT=off`, 2026-10-30). Goodview's CMS never
 * sends that command on this panel family, and neither does this file now.
 *
 * Deliberately NOT copied: Goodview's `onScreenStateChanged(isScreenOn=true)`
 * REBOOTS the device (`SDKSystemHelper.I.reboot()`) every time the panel
 * comes back on. A reboot on an alert wake would cost minutes; we keep the
 * process and its page.
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

    /**
     * The power state query. Goodview's CMS reads it before EVERY power call
     * (`APITools.PowerOff` / `PowerOn`: `SDKDeviceHelper.I.isScreenOn()`).
     */
    const val CMD_GET_SCREEN_STATUS = "com.seewo.sdk.internal.command.device.CmdGetScreenStatus"

    /**
     * SLEEP, as Goodview's CMS does it on a t982: `SDKSystemHelper.I.powerOff()`
     * → `new CmdPowerOff(-1)` (`timeCount = -1`: no countdown dialog). This is
     * the OS's own power-off — the IFPDOS standby the remote's power key
     * enters — not a backlight switch behind the OS's back.
     */
    const val CMD_POWER_OFF = "com.seewo.sdk.internal.command.system.CmdPowerOff"

    /** `CmdPowerOff.timeCount` as `SDKSystemHelper.powerOff()` sends it. */
    const val POWER_OFF_TIME_COUNT = -1

    /**
     * WAKE, as Goodview's CMS does it on a t982: `SDKSystemHelper.I
     * .sendKeyEvent(SDKKeyEvent.KEYCODE_SEEWO_POWER)` → `new CmdSendKeyEvent(5000)`.
     * The power key is a TOGGLE, which is why it is only ever sent after the
     * status query read OFF.
     */
    const val CMD_SEND_KEY_EVENT = "com.seewo.sdk.internal.command.system.CmdSendKeyEvent"

    /** `SDKKeyEvent.KEYCODE_SEEWO_POWER`. */
    const val KEYCODE_SEEWO_POWER = 5000

    /**
     * After one of OUR power commands the panel takes a moment to change state
     * and the status query can still read the old one. Inside this window no
     * second power command is sent on a stale reading — a second power KEY
     * would toggle the panel straight back.
     */
    const val POWER_SETTLE_MS = 6_000L

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

    /** `SDKRequest` for `CmdPowerOff(-1)` — fastjson writes the public field `timeCount`. */
    fun powerOffRequest(): String = request(
        CMD_POWER_OFF,
        JSONObject().put("timeCount", POWER_OFF_TIME_COUNT),
    )

    /** `SDKRequest` for `CmdSendKeyEvent(5000)` — fastjson names it from `getKeyCode()`. */
    fun powerKeyRequest(): String = request(
        CMD_SEND_KEY_EVENT,
        JSONObject().put("keyCode", KEYCODE_SEEWO_POWER),
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

    // ─── the power sequence ──────────────────────────────────────────

    enum class PowerStep {
        /** The panel already reads the wanted state: send nothing (Goodview's own guard). */
        ALREADY,
        /** Send the power command (OFF: `CmdPowerOff`, ON: the power key). */
        SEND,
        /** One of our own commands is still taking effect: send nothing now. */
        SETTLING,
        /** The state could not be read: send nothing — the power key is a toggle. */
        UNKNOWN,
    }

    /**
     * What to do for one sleep / wake, from the status read just before it.
     *
     * Goodview's CMS: OFF only `if (isScreenOn())`, ON only `if (!isScreenOn())`.
     * Two additions, both refusals: an unreadable state sends nothing (their
     * client would press the toggle blind), and inside [POWER_SETTLE_MS] of
     * our own last command a reading is not trusted to justify another one.
     *
     * @param msSinceLastCommand since OUR last power command, or null if none.
     * @param lastCommandOn the direction of that command.
     */
    fun powerStep(
        wantOn: Boolean,
        screenOn: Boolean?,
        msSinceLastCommand: Long?,
        lastCommandOn: Boolean?,
        idempotent: Boolean = false,
    ): PowerStep {
        // A backend whose commands are SETTERS (the RK3576 box's
        // `setDeviceShallowOnoff`, [RkSdkApiPolicy]) cannot be toggled the
        // wrong way, so an UNREADABLE state still sends (never dark under an
        // alert) and nothing waits out a settle window. But a reading that
        // already matches sends NOTHING (1.1.60): on that box the wake setter
        // brings the panel back by REBOOTING it, so a wake sent to a box that
        // reads on — every process start under an alert hold, every
        // heartbeat power-on retry after the reboot — rebooted it again.
        // Goodview's own CMS guards on the same getter.
        if (idempotent) return if (screenOn != null && screenOn == wantOn) PowerStep.ALREADY else PowerStep.SEND
        if (screenOn == null) return PowerStep.UNKNOWN
        val settling = msSinceLastCommand != null && msSinceLastCommand in 0 until POWER_SETTLE_MS
        if (settling && lastCommandOn != wantOn) return PowerStep.SETTLING
        if (screenOn == wantOn) return PowerStep.ALREADY
        return if (settling) PowerStep.SETTLING else PowerStep.SEND
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
