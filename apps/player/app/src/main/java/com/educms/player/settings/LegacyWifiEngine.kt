package com.educms.player.settings

import com.educms.player.settings.DeviceSettingsPolicy.Outcome
import com.educms.player.settings.DeviceSettingsPolicy.Status
import com.educms.player.settings.WifiSetupPolicy.Journal
import com.educms.player.settings.WifiSetupPolicy.NetKey

/**
 * What the Android 9-and-older Wi-Fi path needs from Android — and nothing
 * more. [LegacyWifiNetworks] is the real one; `LegacyWifiEngineTest` drives
 * [LegacyWifiEngine] through a fake, so the never-strand ORDER is tested
 * without a device.
 */
internal interface LegacyWifiPort {
    /** Is the Wi-Fi radio on? null = unreadable. */
    fun radioOn(): Boolean?

    /** Every saved network (never a secret); null = unreadable. */
    fun configured(): List<WifiSetupPolicy.SavedNetwork>?

    /** `addNetwork`; the new network id, or -1. */
    fun add(value: DesiredValue.WifiValue): Int

    /** `updateNetwork` on one of VenueOS's own networks; the id, or -1. */
    fun update(networkId: Int, value: DesiredValue.WifiValue): Int

    /** `enableNetwork(id, connect)`. */
    fun enable(networkId: Int, connect: Boolean): Boolean

    /** `removeNetwork` — only ever called with one of VenueOS's own networks. */
    fun remove(networkId: Int): Boolean

    /** `disableNetwork` — only ever called with one of VenueOS's own networks, when it cannot be removed. */
    fun disable(networkId: Int): Boolean

    /** `saveConfiguration` — persists the saved list on Android 7 (a no-op from 8). */
    fun saveConfiguration(): Boolean

    fun reconnect(): Boolean

    /** Does the screen's DEFAULT network (its traffic) run over Wi-Fi? null = unreadable. */
    fun defaultIsWifi(): Boolean?

    /** Did VenueOS's own server answer, over the Wi-Fi network, within a few seconds? */
    fun reachesServerOverWifi(): Boolean
}

/** Where the legacy path keeps its two facts. Both writes are synchronous. */
internal interface WifiStateStore {
    /** The networks VenueOS added — the ONLY ones it ever updates or removes. */
    fun ledger(): Set<NetKey>
    fun putLedger(keys: Set<NetKey>): Boolean

    /** The switch being proved, if any — written BEFORE the switch. */
    fun journal(): Journal?
    fun putJournal(journal: Journal?): Boolean
}

/**
 * ANDROID 9 AND OLDER (API ≤ 28) — save the network, and switch to it only
 * where that is the only way the operator's network gets used, with proof
 * (2026-10-23). The order of every step below is the never-strand rule; read
 * [WifiSetupPolicy]'s header first.
 *
 *  1. VenueOS CLAIMS the network in its ledger before adding it (a crash can
 *     never leave a VenueOS network VenueOS does not know about), adds it
 *     enabled WITHOUT a connect request, and persists it.
 *  2. A name another app or a person already saved is left alone
 *     (`wifi-exists`); so is the password of the network the screen is on.
 *  3. No switch when the screen's traffic does not ride Wi-Fi: Android joins
 *     the saved network when it needs Wi-Fi (`wifi-saved`).
 *  4. When the traffic rides ANOTHER Wi-Fi network, the way back is written
 *     to disk (the journal) before the connect request. The switch is kept
 *     only once VenueOS's server answers over the new network
 *     ([WifiSetupPolicy.proofStep]); otherwise [rollBack].
 *  5. Only then are VenueOS's OTHER networks removed — never the one in use,
 *     never one VenueOS did not add.
 *
 * Android 7 detail ([WifiSetupPolicy.SELECT_KEEPS_OTHERS_SDK]): a connect
 * request disables every other saved network in the Wi-Fi daemon until the
 * framework enables them again, and a save while that is so would persist
 * it. So nothing here saves after a connect request, and both [commit] and
 * [rollBack] enable those networks again first.
 */
internal class LegacyWifiEngine(
    private val port: LegacyWifiPort,
    private val store: WifiStateStore,
    private val sdk: Int,
    private val log: (String) -> Unit = {},
) {

    /** What one look at a switch in progress saw. */
    data class Observed(
        val onOurNetwork: Boolean,
        val reachedServer: Boolean,
        /** Disabled by Android (a wrong password does that) or gone from the list. */
        val ourNetworkGone: Boolean,
        val onAnotherNetwork: Boolean,
    )

    fun apply(id: String, value: DesiredValue.WifiValue, nowElapsedMs: Long, boot: Int): Outcome {
        if (value.security == "wpa3") return Outcome.Error(DeviceSettingCodes.WIFI_SECURITY)
        // Never a secured network without its passphrase: an update would write an empty one.
        if (value.security != "open" && value.passphrase.isNullOrEmpty()) return Outcome.Error(DeviceSettingCodes.NEEDS_SECRET)
        // One switch at a time (the policy guards this too, rule 2w).
        if (store.journal() != null) return Outcome.Held(Status.PENDING, DeviceSettingCodes.WIFI_SWITCHING)
        // Below Android 8 a network can be added only while the radio runs (rule 6w waits for it).
        if (port.radioOn() == false) return Outcome.Held(Status.WAITING, DeviceSettingCodes.WIFI_OFF)

        val key = NetKey(value.ssid, value.security)
        val before = port.configured() ?: return Outcome.Error(DeviceSettingCodes.WIFI_ERROR)
        val ours = store.ledger()
        val current = before.firstOrNull { it.current }?.networkId
        val defaultWifi = port.defaultIsWifi()
        val existing = before.firstOrNull { it.key == key }

        val networkId: Int
        if (existing != null) {
            // ⚠️ Never a network a person or the vendor saved.
            if (key !in ours) {
                log("a network named like this one is already saved here, not by VenueOS — left alone")
                return Outcome.Error(DeviceSettingCodes.WIFI_EXISTS)
            }
            // ⚠️ Never the password of the network the screen is on right now.
            if (!WifiSetupPolicy.mayRewrite(existing.networkId, current, defaultWifi)) {
                log("VenueOS's network is the one in use — not rewritten")
                removeOlder(key, current)
                return Outcome.Landed(DeviceSettingCodes.WIFI_JOINED)
            }
            networkId = port.update(existing.networkId, value)
            if (networkId < 0) return Outcome.Error(DeviceSettingCodes.WIFI_ERROR)
        } else {
            // Claimed BEFORE it exists.
            if (!store.putLedger(ours + key)) return Outcome.Error(DeviceSettingCodes.WIFI_ERROR)
            networkId = port.add(value)
            if (networkId < 0) {
                store.putLedger(ours)
                val now = port.configured()
                val takenNow = now?.any { it.key == key } == true
                return Outcome.Error(if (takenNow) DeviceSettingCodes.WIFI_EXISTS else DeviceSettingCodes.WIFI_ERROR)
            }
        }
        // Enabled WITHOUT a connect request, and persisted BEFORE any switch.
        port.enable(networkId, connect = false)
        port.saveConfiguration()

        return when (WifiSetupPolicy.legacyNext(networkId, current, defaultWifi)) {
            WifiSetupPolicy.Next.JOINED -> {
                removeOlder(key, networkId)
                Outcome.Landed(DeviceSettingCodes.WIFI_JOINED)
            }
            WifiSetupPolicy.Next.SAVED -> {
                removeOlder(key, current)
                Outcome.Landed(DeviceSettingCodes.WIFI_SAVED)
            }
            WifiSetupPolicy.Next.SWITCH -> switchTo(id, networkId, key, before, current!!, ours, nowElapsedMs, boot)
        }
    }

    private fun switchTo(
        id: String,
        networkId: Int,
        key: NetKey,
        before: List<WifiSetupPolicy.SavedNetwork>,
        currentId: Int,
        ours: Set<NetKey>,
        nowElapsedMs: Long,
        boot: Int,
    ): Outcome {
        val previous = before.firstOrNull { it.networkId == currentId }
        val journal = Journal(
            id = id,
            networkId = networkId,
            key = key,
            previousId = currentId,
            previousOurs = previous?.key?.let { it in ours } == true,
            enabledBefore = before.filter { it.enabled && it.networkId != networkId }.map { it.networkId },
            startedElapsedMs = nowElapsedMs,
            boot = boot,
        )
        // ⚠️ The way back is on disk BEFORE the connect request — or there is no switch.
        if (!store.putJournal(journal)) {
            log("switch journal could not be persisted — saved, not switched")
            return Outcome.Landed(DeviceSettingCodes.WIFI_SAVED)
        }
        if (!port.enable(networkId, connect = true)) {
            store.putJournal(null)
            log("Android refused the connect request — saved, not switched")
            return Outcome.Landed(DeviceSettingCodes.WIFI_SAVED)
        }
        log("switching to VenueOS's network; kept only once VenueOS's server answers over it")
        return Outcome.Held(Status.PENDING, DeviceSettingCodes.WIFI_SWITCHING)
    }

    /** One look at a switch in progress. Reaches for the server only while on VenueOS's network. */
    fun observe(journal: Journal): Observed {
        val saved = port.configured()
        val ours = saved?.firstOrNull { it.networkId == journal.networkId }
        val current = saved?.firstOrNull { it.current }?.networkId
        val onOurs = current == journal.networkId
        return Observed(
            onOurNetwork = onOurs,
            reachedServer = onOurs && port.reachesServerOverWifi(),
            ourNetworkGone = saved != null && (ours == null || !ours.enabled),
            onAnotherNetwork = current != null && current != journal.networkId,
        )
    }

    /**
     * Proved: every network the connect request disabled (Android 7) comes
     * back, and only then do VenueOS's older networks go. Nothing is saved
     * here — VenueOS's network was persisted before the switch.
     */
    fun commit(journal: Journal): Outcome {
        val restored = restoreOthers(journal)
        if (restored) {
            removeOlder(journal.key, journal.networkId)
        } else {
            log("not every other network came back enabled — VenueOS's older networks are kept")
        }
        log("switch proved: VenueOS's server answered over the new network")
        return Outcome.Landed(DeviceSettingCodes.WIFI_JOINED)
    }

    /**
     * Not proved: put the screen back. Order matters on Android 7, where the
     * removal below SAVES the list: the other networks are enabled again
     * first, so no disabled network is ever persisted. VenueOS's new network
     * is removed — an unproven network is never left where Android could
     * join it later and strand the screen — and VenueOS reconnects to the
     * previous network when it is its own; otherwise Android's own selection
     * picks it (it is saved and enabled).
     */
    fun rollBack(journal: Journal, code: String): Outcome {
        restoreOthers(journal)
        if (port.remove(journal.networkId)) {
            store.putLedger(store.ledger() - journal.key)
        } else {
            // Still VenueOS's own; at least Android must not join it again.
            log("VenueOS's new network could not be removed — disabled instead")
            port.disable(journal.networkId)
        }
        if (journal.previousOurs && journal.previousId >= 0) port.enable(journal.previousId, connect = true)
        port.reconnect()
        log("switched back ($code)")
        return Outcome.Error(code)
    }

    /** Android 7 only: undo the connect request's "disable every other network". */
    private fun restoreOthers(journal: Journal): Boolean {
        if (sdk >= WifiSetupPolicy.SELECT_KEEPS_OTHERS_SDK) return true
        var all = true
        for (other in journal.enabledBefore) {
            if (other != journal.networkId && !port.enable(other, connect = false)) all = false
        }
        return all
    }

    /** VenueOS's OTHER networks, never [keep], never the one in use — and the ledger follows. */
    private fun removeOlder(keep: NetKey, inUseId: Int?) {
        val saved = port.configured() ?: return
        val ours = store.ledger()
        var ledger = ours
        for (n in WifiSetupPolicy.removable(saved, ours, keep, inUseId)) {
            val k = n.key ?: continue
            if (port.remove(n.networkId)) ledger = ledger - k
        }
        // A claim with no network behind it (someone removed it) is dropped too.
        val present = saved.mapNotNull { it.key }.toSet()
        ledger = ledger.filter { it == keep || it in present }.toSet()
        if (ledger != ours) store.putLedger(ledger)
    }

    /** Facts for the report: VenueOS's network on this unit, and whether the screen is on it. */
    fun ourNetwork(): Pair<String?, Boolean?> {
        val saved = port.configured() ?: return null to null
        val ours = store.ledger()
        val mine = saved.filter { n -> n.key?.let { it in ours } == true }
        val current = mine.firstOrNull { it.current }
        return (current ?: mine.lastOrNull())?.key?.ssid to (current != null)
    }
}
