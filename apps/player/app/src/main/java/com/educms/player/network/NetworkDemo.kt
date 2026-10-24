package com.educms.player.network

import android.os.Handler
import com.educms.player.settings.DeviceSettingsWire
import com.educms.player.settings.WifiScanPolicy

/**
 * A scripted stand-in for the network — for screenshots and design review
 * on an emulator (2026-10-24), where there is one open Wi-Fi network and no
 * way to drive a real join to every outcome.
 *
 * ⚠️ DEBUG BUILDS ONLY. Instances are made solely by the debug source set's
 * `NetworkScreenDemo` (src/debug); the release source set's returns null, so
 * no release APK can ever show an invented network or a fake result. In a
 * demo the screen calls NONE of the engine — no scan, no join, no probe, no
 * Android page — and everything it shows still goes through the real
 * presentation path ([NetworkScreenView.onConnectResult] and friends).
 */
internal class NetworkDemo(
    initialStatus: DeviceSettingsWire.NetStatus,
    /** What the scan answers; null = a scan that never answers (the loading state). */
    val access: WifiScanPolicy.Access?,
    val networks: List<WifiScanPolicy.Network>,
    initialVenueos: Boolean?,
    /** The fake engine's timeline after Connect, for the chosen network. */
    private val script: (target: String) -> List<Beat>,
    /** How long a "saved" join is watched before the screen says Saved (shortened for review). */
    val watchMs: Long = 6_000L,
    /**
     * Close the screen this long after it opens through the REAL alert path
     * (`NetworkScreen.REASON_ALERT`) — to review the "carry on where you left
     * off" resume without raising a real emergency.
     */
    val alertAfterMs: Long? = null,
) {
    class Beat(
        val atMs: Long,
        val status: DeviceSettingsWire.NetStatus? = null,
        val venueos: Boolean? = null,
        /** An engine answer: the status vocabulary and the why code. */
        val result: Pair<String, String?>? = null,
    )

    @Volatile private var status: DeviceSettingsWire.NetStatus = initialStatus

    @Volatile private var venueos: Boolean? = initialVenueos

    fun statusNow(): DeviceSettingsWire.NetStatus = status

    fun venueosNow(): Boolean? = venueos

    /** Play the join on [main]; [onResult] gets each engine answer. Cancelled with the handler's callbacks. */
    fun play(main: Handler, target: String, onResult: (String, String?) -> Unit) {
        for (beat in script(target)) {
            main.postDelayed({
                beat.status?.let { status = it }
                beat.venueos?.let { venueos = it }
                beat.result?.let { (st, code) -> onResult(st, code) }
            }, beat.atMs)
        }
    }

    internal companion object {
        fun network(ssid: String, rssi: Int, security: String, connected: Boolean = false, saved: Boolean = false) =
            WifiScanPolicy.Network(
                ssid = ssid,
                bars = WifiScanPolicy.bars(rssi),
                rssi = rssi,
                security = security,
                savedBy = if (saved || connected) WifiScanPolicy.SAVED_VENUEOS else null,
                connected = connected,
            )
    }
}
