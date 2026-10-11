package com.educms.player.heartbeat

import android.content.Context
import android.content.SharedPreferences
import android.os.PowerManager
import android.os.SystemClock
import com.educms.player.MainActivity
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayAction
import com.educms.player.display.DisplayControlRegistry
import com.educms.player.display.SleepProof
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.RelaunchEscalation
import com.educms.player.setup.SetupCeremony
import com.educms.player.standby.UserStandby
import org.json.JSONObject

/** Heartbeat-owned recovery. It never writes a credential or changes an emergency hold. */
object NativePowerControl {
    const val HEADER = "x-venueos-native-runtime"
    private const val COMMAND = "native_power_on_command"
    private const val ATTEMPTS = "native_power_on_attempts"
    private const val ATTEMPT_AT = "native_power_on_attempt_elapsed_ms"
    private const val ACK = "native_power_on_ack"
    private const val STANDBY_AT_ATTEMPT = "native_power_on_standby_identity"
    private const val SUPPRESSED = "native_power_on_suppressed"

    /**
     * The native runtime report the heartbeat carries in [HEADER].
     *
     * Schema 1, extended additively on 2026-10-11 (every new field is optional
     * on the server, so an old API simply drops them):
     *  • `sleep` — what this panel can do to turn itself off and what the last
     *    attempt PROVED ([SleepProof.reportJson]): the resolved blank
     *    mechanism, whether a screensaver was seen to replace a sleep, whether
     *    the accessibility sleep service is on, the last blank's observed
     *    outcome, and the last after-alert restore. Evidence the dashboard
     *    states as such — never content health, never a claim the glass is dark
     *    beyond what `interactive` showed.
     *  • `powerOnAttempts` — how many times the last power-on was applied.
     * The whole header stays far below the server's 1 KiB parse limit.
     */
    fun report(ctx: Context, prefs: SharedPreferences): String {
        val out = JSONObject()
            .put("schema", 1)
            .put("interactive", interactive(ctx) ?: JSONObject.NULL)
            .put("foreground", MainActivity.isInForeground)
            .put("standbySinceMs", UserStandby.activeRecord(ctx)?.sinceWallMs ?: JSONObject.NULL)
            .put("elapsedRealtimeMs", SystemClock.elapsedRealtime())
            .put("powerOnAck", prefs.getString(ACK, null) ?: JSONObject.NULL)
        runCatching { out.put("powerOnAttempts", prefs.getInt(ATTEMPTS, 0).coerceIn(0, 9)) }
        runCatching { SleepProof.reportJson(ctx)?.let { out.put("sleep", it) } }
            .onFailure { PlayerLogger.w("NativePowerControl", "sleep facts unavailable: ${it.message}") }
        return out.toString()
    }

    /**
     * Is an applied power-on still waiting for its proof (Android interactive
     * AND the player in front)? While it is, the heartbeat stays at full
     * cadence — see [NativePowerOnPolicy.ACK_WINDOW_MS].
     */
    fun awaitingProof(ctx: Context): Boolean = runCatching {
        val prefs = ctx.applicationContext.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        NativePowerOnPolicy.awaitingProof(memory(prefs), SystemClock.elapsedRealtime()) != null
    }.getOrDefault(false)

    @Synchronized
    fun accept(ctx: Context, prefs: SharedPreferences, reply: JSONObject) {
        val control = reply.optJSONObject("nativeControl") ?: return
        if (control.optInt("schema") != 1) return
        // A reply for another screen must not drive this panel. This is a
        // read of the canonical credential, not another token store.
        val expected = NativeAlertWatchPolicy.screenIdOf(prefs.getString("device_token", null)) ?: return
        if (reply.optString("screenId") != expected) return
        val command = control.optString("powerOnRequestedAt", "").takeIf { it.isNotBlank() }
        if (command == null) {
            // The server stopped repeating the command (five-minute TTL), but
            // this device may have applied it and not yet seen the proof.
            acknowledgeIfObserved(ctx, prefs)
            return
        }
        if (!beginAttempt(ctx, prefs, command)) return
        val result = runCatching {
            DisplayControlRegistry.apply(ctx.applicationContext, DisplayAction.Wake, revertAfterMs = null)
        }.getOrNull()
        // Wake alone can leave the OEM launcher visible. Bring our existing
        // task forward only for this explicit, persisted operator command.
        // The ordinary heartbeat never launches an Activity, and an install
        // confirmation or a bounded setup trip is still allowed to finish.
        if (result?.ok == true && !MainActivity.isInForeground &&
            !MainActivity.installPromptOutstanding && !SetupCeremony.relaunchShouldYield(ctx)) {
            runCatching { RelaunchEscalation.launchNow(ctx.applicationContext, "native-power-on") }
                .onFailure { PlayerLogger.w("NativePowerControl", "power-on foreground dispatch failed: ${it.message}") }
        }
        PlayerLogger.i("NativePowerControl", "operator power-on id=$command result=$result")
        // Provider acceptance and launch dispatch are not completion. A later
        // heartbeat observes interactive AND foreground before ACK; web
        // render/frame telemetry separately proves assigned content resumed.
    }

    /** The live push and native fallback consume ONE persisted command. */
    @Synchronized
    fun beginWebPowerOn(ctx: Context, json: JSONObject, trusted: Boolean): Boolean? {
        if (!trusted || !json.has("nativePowerOnRequestedAt")) return null
        val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
        val expected = NativeAlertWatchPolicy.screenIdOf(prefs.getString("device_token", null)) ?: return false
        if (json.optString("screenId") != expected) return false
        return beginAttempt(ctx, prefs, json.optString("nativePowerOnRequestedAt", ""))
    }

    private fun memory(prefs: SharedPreferences) = NativePowerOnPolicy.Memory(
        command = prefs.getString(COMMAND, null),
        attempts = prefs.getInt(ATTEMPTS, 0),
        lastAttemptElapsedMs = prefs.getLong(ATTEMPT_AT, 0L),
        acknowledged = prefs.getString(ACK, null),
        standbyIdentity = prefs.getString(STANDBY_AT_ATTEMPT, null),
        suppressed = prefs.getString(SUPPRESSED, null),
    )

    private fun interactive(ctx: Context): Boolean? = runCatching {
        (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
    }.getOrNull()

    /** Compare event identity, never device wall-clock order — see [beginAttempt]. */
    private fun standbyIdentity(ctx: Context): String? = UserStandby.activeRecord(ctx)?.let {
        "${it.bootCount}:${it.sinceElapsedMs}:${it.sinceWallMs}"
    }

    /**
     * ACK an already-applied command the server is no longer repeating. Never
     * applies anything: it only records that the proof was observed. A newer
     * physical OFF still cancels it, exactly as on the normal path.
     */
    private fun acknowledgeIfObserved(ctx: Context, prefs: SharedPreferences) {
        val memory = memory(prefs)
        val pending = NativePowerOnPolicy.awaitingProof(memory, SystemClock.elapsedRealtime()) ?: return
        if (NativePowerOnPolicy.supersededByStandby(pending, memory, standbyIdentity(ctx))) {
            prefs.edit().putString(SUPPRESSED, pending).commit()
            PlayerLogger.i("NativePowerControl", "operator power-on id=$pending superseded by a later standby; no ACK")
            return
        }
        if (NativePowerOnPolicy.mayAcknowledge(pending, memory, interactive(ctx), MainActivity.isInForeground) &&
            prefs.edit().putString(ACK, pending).commit()
        ) {
            PlayerLogger.i(
                "NativePowerControl",
                "operator power-on id=$pending observed interactive and player foreground (after the server's TTL)",
            )
        }
    }

    private fun beginAttempt(ctx: Context, prefs: SharedPreferences, command: String?): Boolean {
        val memory = memory(prefs)
        // Compare event identity, never device wall-clock order. Including
        // boot count and both recorded times also distinguishes a NEW off
        // after reboot (elapsedRealtime alone would run backwards).
        val standbyIdentity = standbyIdentity(ctx)
        if (NativePowerOnPolicy.supersededByStandby(command, memory, standbyIdentity)) {
            prefs.edit().putString(SUPPRESSED, command).commit()
            PlayerLogger.i("NativePowerControl", "operator power-on id=$command superseded by a later standby; no retry")
            return false
        }
        val interactive = interactive(ctx)
        // Check proof BEFORE the retry budget: the third attempt can finish
        // asynchronously. Its next heartbeat must still be able to ACK it.
        if (NativePowerOnPolicy.mayAcknowledge(command, memory, interactive, MainActivity.isInForeground)) {
            if (prefs.edit().putString(ACK, command).commit()) {
                PlayerLogger.i("NativePowerControl", "operator power-on id=$command observed interactive and player foreground")
            }
            return false
        }
        val now = SystemClock.elapsedRealtime()
        if (!NativePowerOnPolicy.mayApply(command, memory, now)) return false
        val next = NativePowerOnPolicy.beforeApply(command!!, memory, now, standbyIdentity)
        // Persist the bounded attempt BEFORE touching the display. A crash
        // must not turn a still-pending command into an unlimited wake loop.
        if (!prefs.edit().putString(COMMAND, next.command)
                .putInt(ATTEMPTS, next.attempts).putLong(ATTEMPT_AT, now)
                .putString(STANDBY_AT_ATTEMPT, next.standbyIdentity).commit()) {
            PlayerLogger.e("NativePowerControl", "power-on skipped: attempt could not be persisted")
            return false
        }
        PlayerLogger.i("NativePowerControl", "operator power-on id=$command attempt=${next.attempts} persisted")
        return true
    }
}
