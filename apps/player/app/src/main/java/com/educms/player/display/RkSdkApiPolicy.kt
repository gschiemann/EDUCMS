package com.educms.player.display

import org.json.JSONObject

/**
 * SLEEP / WAKE ON A GOODVIEW RK3576 HDMI BOX (EP6N class: `Build.DEVICE`
 * `rk3576_u`, model `EC3576`) — the second backend of the `vendor-backlight`
 * mechanism (player 1.1.58).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHAT GOODVIEW'S OWN CMS DOES ON THIS BOX
 * ═════════════════════════════════════════════════════════════════════
 * jadx over CloudSign-V3.1.8-GVBOX, `com.wuhan.goodview.gtv_master.utils
 * .APITools` (static reading, never run). `isRK3576()` is
 * `"rk3576_u".equals(Build.DEVICE) && ro.build.signway.board contains "EC3576"`;
 * `App.onCreate` binds `SdkApi.newInstance(this)` only on that box:
 *
 *   PowerOff():  … } else if (!SdkApi.getInstance().SystemCtrl()
 *                        .getDeviceShallowOnoff()) { return; }
 *                APKUtil.sendKeyCode(141);      // Instrumentation.sendKeyDownUpSync
 *   PowerOn():   if (… || isRK3576()) { reboot(App.getInstance()); return; }
 *                // reboot() → ((PowerManager) …).reboot(" ")
 *
 * So CloudSign reads the box's shallow-standby state through the box's own
 * control service, then INJECTS key 141 into the system to sleep, and wakes
 * by REBOOTING. Both halves need privileges this app does not and must not
 * have: the CloudSign APK is signed with the AOSP platform key (cert SHA-256
 * c8a2e9bc…92ab8) and holds `INJECT_EVENTS` and `REBOOT`. No HDMI-CEC call
 * exists anywhere in it.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHAT WE DO INSTEAD (no system signature, no device owner)
 * ═════════════════════════════════════════════════════════════════════
 * The same control service CloudSign reads exposes the setter next to the
 * getter (`ISdkApiInterface`, AIDL stub in CloudSign):
 *
 *   bind  Intent([SERVICE_ACTION]).setPackage([SERVICE_PACKAGE])
 *   tx [TX_GET_SHALLOW_ONOFF] `boolean getDeviceShallowOnoff()`   (true = on)
 *   tx [TX_SET_SHALLOW_ONOFF] `void setDeviceShallowOnoff(boolean)`
 *
 * Sleep = `setDeviceShallowOnoff(false)`, wake = `setDeviceShallowOnoff(true)`,
 * each followed by one readback of the getter. A SETTER, not a toggle: the
 * wake is sent whatever the reading says, so a stale or unreadable state can
 * never leave a panel dark under an alert ([VendorBacklightPolicy.powerStep]
 * `idempotent`). Wake never reboots — an alert must not wait minutes.
 *
 * Auto-detected like the GUQ backend: used only when the package is
 * installed, binds, and the GETTER answers (a read-only probe). A service
 * that refuses an unprivileged caller (`SecurityException`) reads
 * UNSUPPORTED and the chain falls through to today's mechanisms.
 *
 * UNVERIFIED ON GLASS: that this service accepts our uid, and that
 * `setDeviceShallowOnoff(false)` is the same standby key 141 enters.
 *
 * Pure — no `android.*`.
 */
object RkSdkApiPolicy {

    const val BACKEND = "rk-sdkapi"

    const val SERVICE_PACKAGE = "com.sdkapi.sdkapiservice"
    const val SERVICE_ACTION = "com.sdkapi.sdkapiservice.service.sdkapiservice"
    const val DESCRIPTOR = "com.sdkapi.sdkapiservice.ISdkApiInterface"

    /** `ISdkApiInterface.setDeviceShallowOnoff(boolean)` (Stub.onTransact case 37). */
    const val TX_SET_SHALLOW_ONOFF = 37

    /** `ISdkApiInterface.getDeviceShallowOnoff(): boolean` (Stub.onTransact case 38). */
    const val TX_GET_SHALLOW_ONOFF = 38

    /** One request from the engine, as this service's transactions. */
    sealed class Op {
        object Read : Op()
        data class Set(val on: Boolean) : Op()
    }

    /**
     * Map one of the engine's requests ([VendorBacklightPolicy.getScreenStatusRequest],
     * [VendorBacklightPolicy.powerOffRequest], [VendorBacklightPolicy.powerKeyRequest])
     * onto this service. Null for anything else — never guessed.
     */
    fun opFor(requestJson: String): Op? {
        val name = runCatching { JSONObject(requestJson).optString("requestName", "") }.getOrDefault("")
        return when (name) {
            VendorBacklightPolicy.CMD_GET_SCREEN_STATUS -> Op.Read
            VendorBacklightPolicy.CMD_POWER_OFF -> Op.Set(on = false)
            VendorBacklightPolicy.CMD_SEND_KEY_EVENT -> Op.Set(on = true)
            else -> null
        }
    }

    /** The reply the engine reads, for a getter result. */
    fun readReply(on: Boolean): String = reply(VendorBacklightPolicy.STATUS_SUCCESS, JSONObject().put("result", on))

    /** The reply the engine reads, for an accepted setter. */
    fun setReply(): String = reply(VendorBacklightPolicy.STATUS_SUCCESS, JSONObject())

    /** The service exists but will not serve this caller, or does not know the call: settled, never retried. */
    fun refusedReply(): String = reply(VendorBacklightPolicy.STATUS_HANDLER_NOT_FOUND, null)

    private fun reply(status: String, params: JSONObject?): String =
        JSONObject().put("status", status).put("paramsJson", params?.toString() ?: "").toString()

    /**
     * Which backend the `vendor-backlight` mechanism uses on this box. The GUQ's
     * MCU service wins wherever it is installed (unchanged behaviour); the
     * RK3576 service is used only on a box that ships it and not the MCU one.
     */
    fun backendFor(seewoInstalled: Boolean, sdkApiInstalled: Boolean): String =
        if (!seewoInstalled && sdkApiInstalled) BACKEND else SEEWO_BACKEND

    const val SEEWO_BACKEND = "seewo"
}
