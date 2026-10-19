package com.educms.player.settings

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.display.DisplayEmergency
import com.educms.player.display.DisplayPrefs
import com.educms.player.display.EmergencyBrightness
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * The desired-settings consumer (2026-10-18). Two entry points, both called
 * by `HeartbeatService` and nothing else:
 *
 *  • [report] — the [HEADER] value on every native heartbeat: what this unit
 *    can set, what Android reads back, and what happened to each identity.
 *  • [accept] — the heartbeat reply. When it carries this screen's
 *    `deviceSettings` block, the set is stored (without any passphrase) and
 *    every item goes through [DeviceSettingsPolicy].
 *
 * Silence is never a command: a reply without the block, or with a block for
 * another screen, changes nothing and applies nothing. See [DeviceSettingKey]
 * for the whole contract.
 */
object DeviceSettings {

    const val HEADER = "x-venueos-device-settings"
    private const val TAG = "DeviceSettings"

    /**
     * What the unit can do, what Android reads back, and the per-identity
     * acknowledgements — the header value. Never throws.
     */
    fun report(ctx: Context): String = try {
        val app = ctx.applicationContext
        val store = DeviceSettingsStore(app)
        val items = store.items()
        val acks = items.mapNotNull { item -> store.ack(item.key)?.let { item.key to it } }.toMap()
        DeviceSettingsWire.encodeReport(
            DeviceSettingsWire.Report(
                rev = store.rev(),
                need = DeviceSettingsPolicy.needsSecret(acks.values),
                sdk = Build.VERSION.SDK_INT,
                capabilities = DeviceSettingsProbe.capabilities(app),
                observed = DeviceSettingsFacts.forReport(DeviceSettingsProbe.observe(app)),
                acks = acks,
                load = runCatching { DeviceLoad.sample(app) }.getOrNull(),
            ),
        )
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "device settings report unavailable: ${t.message}")
        JSONObject().put("schema", DeviceSettingsWire.SCHEMA).put("rev", 0).toString()
    }

    /**
     * Fold a heartbeat reply in. Synchronized: one evaluation at a time, so a
     * prompt tick landing during a slow write cannot double-apply.
     */
    @Synchronized
    fun accept(ctx: Context, playerPrefs: SharedPreferences, reply: JSONObject) {
        val block = reply.optJSONObject("deviceSettings") ?: return
        // A reply for another screen must not drive this panel. A read of the
        // canonical credential (player rule 3), never a second token store.
        val expected = NativeAlertWatchPolicy.screenIdOf(playerPrefs.getString("device_token", null)) ?: return
        if (reply.optString("screenId") != expected) return
        val parsed = DeviceSettingsWire.parseReply(block) ?: return

        val app = ctx.applicationContext
        val store = DeviceSettingsStore(app)
        val items: List<DesiredItem> = when (parsed) {
            is DeviceSettingsWire.Reply.Same ->
                // Current only if it is the set we hold; otherwise wait for the full one.
                if (store.rev() == parsed.rev) store.items() else return
            is DeviceSettingsWire.Reply.Full -> {
                if (!store.replace(parsed.rev, parsed.items)) {
                    PlayerLogger.e(TAG, "desired settings rev ${parsed.rev} could not be stored — nothing applied")
                    return
                }
                parsed.items
            }
        }
        if (items.isEmpty()) return

        val capabilities = DeviceSettingsProbe.capabilities(app)
        val conditions = conditions(app)
        val boot = bootCount(app)
        var observed = DeviceSettingsProbe.observe(app)
        var changed = false
        for (item in items) {
            val step = evaluate(app, store, item, capabilities, conditions, boot, observed)
            changed = changed || step.changed
            // Read Android again only after something was written.
            step.observedAfter?.let { observed = it }
        }
        // Say what happened now rather than on the next periodic tick (bounded
        // by PromptTickPolicy) — the operator is usually watching the drawer.
        if (changed) HeartbeatService.requestPromptTick(app, "device-settings")
    }

    private class Step(val changed: Boolean, val observedAfter: DeviceSettingsFacts.Observation?)

    private fun evaluate(
        app: Context,
        store: DeviceSettingsStore,
        item: DesiredItem,
        capabilities: Map<DeviceSettingKey, String>,
        conditions: DeviceSettingsPolicy.Conditions,
        boot: Int,
        before: DeviceSettingsFacts.Observation,
    ): Step {
        val previous = store.ack(item.key)
        val decision = DeviceSettingsPolicy.decide(
            DeviceSettingsPolicy.Input(
                item = item,
                capability = capabilities[item.key] ?: DeviceSettingCodes.UNSUPPORTED,
                observedMatches = DeviceSettingsFacts.matches(item, before),
                previous = previous,
                conditions = conditions,
                nowElapsedMs = SystemClock.elapsedRealtime(),
                boot = boot,
            ),
        )
        return when (decision) {
            is DeviceSettingsPolicy.Decision.Report -> {
                if (decision.ack != previous) {
                    store.putAck(item.key, decision.ack)
                    PlayerLogger.i(TAG, "${item.key.wire} ${item.id}: ${decision.ack.status.wire}${decision.ack.why?.let { " ($it)" } ?: ""}")
                    Step(changed = true, observedAfter = null)
                } else {
                    Step(changed = false, observedAfter = null)
                }
            }
            is DeviceSettingsPolicy.Decision.Apply -> {
                // ⚠️ The attempt is on disk BEFORE the setting is touched: a
                // crash mid-write must not turn into an unbounded loop.
                if (!store.commitAck(item.key, decision.attempt)) {
                    PlayerLogger.e(TAG, "${item.key.wire} ${item.id}: attempt could not be persisted — not applied")
                    return Step(changed = false, observedAfter = null)
                }
                val outcome = DeviceSettingsAppliers.apply(app, item)
                val after = DeviceSettingsProbe.observe(app)
                val ack = DeviceSettingsPolicy.afterApply(
                    decision.attempt,
                    outcome,
                    DeviceSettingsFacts.matches(item, after),
                    System.currentTimeMillis(),
                )
                store.putAck(item.key, ack)
                PlayerLogger.i(
                    TAG,
                    "${item.key.wire} ${item.id}: attempt ${ack.attempts} → ${ack.status.wire}" +
                        "${ack.why?.let { " ($it)" } ?: ""} observed=${DeviceSettingsFacts.forReport(after)[item.key].describe()}",
                )
                Step(changed = true, observedAfter = after)
            }
        }
    }

    private fun Any?.describe(): String = when (this) {
        null -> "unreadable"
        is DeviceSettingsWire.WifiObserved -> "approval:$approval"
        else -> toString()
    }

    private fun conditions(app: Context): DeviceSettingsPolicy.Conditions {
        val now = SystemClock.elapsedRealtime()
        return DeviceSettingsPolicy.Conditions(
            // Unreadable hold state reads as HELD: the safe direction is to wait.
            emergencyHeld = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true),
            interactive = runCatching {
                (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
            }.getOrNull(),
            sinceWakeMs = runCatching { EmergencyBrightness.sinceWakeMs() }.getOrNull(),
            processAgeMs = now - runCatching { Process.getStartElapsedRealtime() }.getOrDefault(now),
            uptimeMs = now,
            blankedByUs = runCatching { DisplayPrefs.blanked(app) }.getOrDefault(true),
            timeoutBlankActive = runCatching { DisplayPrefs.priorScreenOffTimeoutMs(app) != null }.getOrDefault(true),
        )
    }

    /** `Settings.Global.BOOT_COUNT` (API 24); -1 when unreadable. */
    private fun bootCount(app: Context): Int =
        runCatching { Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)
}

/**
 * Where this unit keeps the desired set and the per-key records: its own
 * private prefs file, never `edu_player` (read by everything at boot).
 *
 * ⚠️ NO PASSPHRASE IS EVER WRITTEN HERE — [DeviceSettingsWire.encodeItems]
 * drops it. A Wi-Fi item that has not landed asks the server for it again.
 */
internal class DeviceSettingsStore(ctx: Context) {
    private val prefs: SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun rev(): Int = prefs.getInt(KEY_REV, 0)

    fun items(): List<DesiredItem> = DeviceSettingsWire.decodeItems(prefs.getString(KEY_ITEMS, null))

    fun ack(key: DeviceSettingKey): DeviceSettingsPolicy.Ack? =
        DeviceSettingsWire.decodeAck(prefs.getString(ackKey(key), null))

    /** Store a new desired set; records for settings no longer desired are dropped. */
    fun replace(rev: Int, items: List<DesiredItem>): Boolean {
        val wanted = items.map { it.key }.toSet()
        val edit = prefs.edit()
            .putInt(KEY_REV, rev)
            .putString(KEY_ITEMS, DeviceSettingsWire.encodeItems(items.map { it.copy(value = stripSecret(it.value)) }))
        DeviceSettingKey.values().filter { it !in wanted }.forEach { edit.remove(ackKey(it)) }
        return edit.commit()
    }

    fun putAck(key: DeviceSettingKey, ack: DeviceSettingsPolicy.Ack) {
        prefs.edit().putString(ackKey(key), DeviceSettingsWire.encodeAck(ack)).apply()
    }

    /** Synchronous — the one write that must be on disk before a setting is touched. */
    fun commitAck(key: DeviceSettingKey, ack: DeviceSettingsPolicy.Ack): Boolean =
        prefs.edit().putString(ackKey(key), DeviceSettingsWire.encodeAck(ack)).commit()

    private fun stripSecret(v: DesiredValue): DesiredValue =
        if (v is DesiredValue.WifiValue) v.withoutSecret() else v

    private fun ackKey(key: DeviceSettingKey) = "ack.${key.wire}"

    companion object {
        const val PREFS = "edu_device_settings"
        private const val KEY_REV = "rev"
        private const val KEY_ITEMS = "items"
    }
}
