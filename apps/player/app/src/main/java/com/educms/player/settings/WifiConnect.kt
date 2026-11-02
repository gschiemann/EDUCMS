package com.educms.player.settings

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * THE way to connect this screen to a Wi-Fi network FROM THE SCREEN
 * (2026-10-23) — the entry point VenueOS's own on-screen settings menu will
 * call with a network from [WifiScan] or one a person typed. That menu is
 * built separately, on top of this; nothing here draws anything.
 *
 * ONE ENGINE: it runs [WifiSetup.connect], exactly what a dashboard push
 * runs — the same mechanism per Android version, the same never-strand rule
 * (add first, VenueOS's own networks only, a switch kept only once VenueOS's
 * server answered over it), the same outcome codes ([DeviceSettingCodes]).
 * What differs is only who asked, so:
 *   • the identity is a person's (`m<n>`), never the dashboard's (`r<n>`);
 *     a person's network does not become the dashboard's desired setting;
 *   • the "wait a minute after the panel woke" rule does not apply (a person
 *     is standing at it), but an alert still wins: nothing starts while one
 *     is held;
 *   • where Android's save dialog is the mechanism, it is raised at once —
 *     the person's press in the menu is the confirmation (no extra card).
 *
 * The passphrase rides [Request] into the engine and nowhere else; it is
 * never logged and never written down.
 */
object WifiConnect {

    private const val TAG = "WifiConnect"
    private const val KEY_COUNTER = "local.counter"

    /** A network to join: from a scan (name + security) or typed by a person. */
    data class Request(
        val ssid: String,
        /** `open` | `wpa2` | `wpa3`. */
        val security: String,
        val hidden: Boolean = false,
        val passphrase: String? = null,
        /** Save it through Android's dialog (Android 11+, where offered) instead of suggesting it. */
        val permanent: Boolean = false,
    ) {
        override fun toString(): String =
            "Request(security=$security, hidden=$hidden, permanent=$permanent, " +
                "passphrase=${if (passphrase == null) "none" else "***"})"
    }

    /**
     * What happened, in the device-settings vocabulary: [status] is
     * `applied` | `waiting` | `pending` | `failed` | `unsupported`, [code] the
     * same `why` the dashboard shows (`wifi-joined`, `wifi-switching`, …).
     * A `pending` / `waiting` result is followed by another when it settles.
     */
    data class Result(
        val id: String,
        val status: String,
        val code: String?,
        /**
         * Android's save dialog found the network ALREADY saved (2026-10-26):
         * Settings connected to nothing, so the screen hands over to Android's
         * Wi-Fi list instead of waiting for a switch that is not coming.
         */
        val alreadySaved: Boolean = false,
    ) {
        val settled: Boolean get() = status == "applied" || status == "failed" || status == "unsupported"
    }

    fun interface Listener {
        /** Always on the main thread. */
        fun onResult(result: Result)
    }

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "venueos-wifi-connect").apply { isDaemon = true } }
    private val listeners = ConcurrentHashMap<String, Listener>()
    @Volatile private var host: WeakReference<Activity>? = null

    /**
     * Join [request]. Returns the identity the [listener]'s results carry.
     * Never blocks the caller; every Android call runs on a worker thread.
     */
    fun connect(activity: Activity, request: Request, listener: Listener): String {
        val app = activity.applicationContext
        host = WeakReference(activity)
        val id = nextId(app)
        listeners[id] = listener
        val value = DesiredValue.WifiValue(
            ssid = request.ssid,
            security = request.security,
            hidden = request.hidden,
            passphrase = request.passphrase?.takeIf { it.isNotEmpty() },
            permanent = request.permanent,
        )
        worker.execute {
            val outcome = try {
                run(app, id, value)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "connect $id failed: ${t.message}")
                DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.ERROR)
            }
            deliver(id, outcome)
        }
        return id
    }

    /** The checks a dashboard push gets from the policy, for a person at the screen. */
    private fun run(app: Context, id: String, value: DesiredValue.WifiValue): DeviceSettingsPolicy.Outcome {
        if (!DeviceSettingDomains.valid(DeviceSettingKey.WIFI, value)) {
            return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.INVALID_VALUE)
        }
        if (value.security != "open" && value.passphrase == null) {
            return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.NEEDS_SECRET)
        }
        // ⚠️ An alert wins. Unreadable reads as held.
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) {
            return DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.WAITING, DeviceSettingCodes.WAIT_EMERGENCY)
        }
        if (!WifiSetup.hasWifi(app)) return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.NO_WIFI)
        val progress = WifiSetup.progress(app)
        if (progress.legacyRadioOn == false) {
            return DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.WAITING, DeviceSettingCodes.WIFI_OFF)
        }
        if (progress.switchingId != null) {
            return DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.PENDING, DeviceSettingCodes.WIFI_SWITCHING)
        }
        return WifiSetup.connect(app, id, value)
    }

    // ── completions from the engine ─────────────────────────────────────

    fun isLocal(id: String): Boolean = id.startsWith("m")

    /** A switch proved or undone, or a dialog answered, for a person's identity. */
    internal fun complete(ctx: Context, id: String, outcome: DeviceSettingsPolicy.Outcome, alreadySaved: Boolean = false) =
        deliver(id, outcome, alreadySaved)

    /** The engine wants Android's save dialog raised for a person's identity. */
    internal fun raiseDialog(ctx: Context, id: String, request: Intent) {
        val app = ctx.applicationContext
        main.post {
            val activity = host?.get()
            if (activity == null || activity.isFinishing) {
                WifiSavePrompt.recordAnswer(app, id, DeviceSettingCodes.WIFI_NO_DIALOG)
            } else {
                WifiSavePrompt.raiseNow(activity, id, request)
            }
        }
    }

    private fun deliver(id: String, outcome: DeviceSettingsPolicy.Outcome, alreadySaved: Boolean = false) {
        val result = Result(id, statusOf(outcome), whyOf(outcome), alreadySaved)
        PlayerLogger.i(
            TAG,
            "wifi $id: ${result.status}${result.code?.let { " ($it)" } ?: ""}${if (alreadySaved) " (already saved)" else ""}",
        )
        val listener = if (result.settled) listeners.remove(id) else listeners[id]
        listener ?: return
        main.post { runCatching { listener.onResult(result) } }
    }

    /** The outcome as the dashboard's status vocabulary says it. */
    internal fun statusOf(outcome: DeviceSettingsPolicy.Outcome): String = when (outcome) {
        DeviceSettingsPolicy.Outcome.Done, is DeviceSettingsPolicy.Outcome.Landed -> DeviceSettingsPolicy.Status.APPLIED.wire
        is DeviceSettingsPolicy.Outcome.Held -> outcome.status.wire
        is DeviceSettingsPolicy.Outcome.Error -> when (outcome.code) {
            in DeviceSettingCodes.CAPABILITY_REASONS -> DeviceSettingsPolicy.Status.UNSUPPORTED.wire
            else -> DeviceSettingsPolicy.Status.FAILED.wire
        }
    }

    internal fun whyOf(outcome: DeviceSettingsPolicy.Outcome): String? = when (outcome) {
        DeviceSettingsPolicy.Outcome.Done -> null
        is DeviceSettingsPolicy.Outcome.Landed -> outcome.why
        is DeviceSettingsPolicy.Outcome.Held -> outcome.why
        is DeviceSettingsPolicy.Outcome.Error -> outcome.code
    }

    @Synchronized
    private fun nextId(app: Context): String {
        val prefs = app.getSharedPreferences(PrefsWifiStateStore.PREFS, Context.MODE_PRIVATE)
        val n = (prefs.getLong(KEY_COUNTER, 0L) % 9_999_999_999L) + 1L
        prefs.edit().putLong(KEY_COUNTER, n).commit()
        return "m$n"
    }
}
