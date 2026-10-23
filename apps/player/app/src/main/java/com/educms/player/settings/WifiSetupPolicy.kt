package com.educms.player.settings

import android.annotation.SuppressLint
import android.net.wifi.WifiManager
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * WI-FI ON EVERY ANDROID CLASS (2026-10-23) — the PURE decisions.
 *
 * The owner: "Build WiFi for every machine we possibly can … parity across
 * all machines if possible and just a few exceptions if required." The fleet
 * runs Android 7.1 to 14; each Android gives a NORMAL app (no device owner, no
 * hidden API, no vendor service) a different best mechanism, so the mechanism
 * is chosen here from the Android version and what the unit reports — never
 * by an operator setting:
 *
 *  • Android 9 and older (API ≤ 28): `WifiManager.addNetwork` /
 *    `enableNetwork` / `saveConfiguration`. Deprecated for apps that TARGET
 *    Android 10, but the platform below Android 10 does not know that rule, so
 *    the calls work there, silently. VenueOS SAVES the network, and switches
 *    to it only where the screen's traffic rides another Wi-Fi network — and
 *    then keeps it only once it has reached its own server over it
 *    ([proofStep]); otherwise it switches back ([LegacyWifiEngine.rollBack]).
 *  • Android 10 and up: a network SUGGESTION — silent once Android's one-time
 *    approval is given (Android 12+ lets an app read that approval; Android 10
 *    and 11 do not).
 *  • Android 11 and up, where a system Settings page answers it: Android's own
 *    "save network" dialog, which a person at the screen confirms once — when
 *    the operator asks for the network to be SAVED permanently, or when this
 *    screen declined VenueOS's suggestions.
 *
 * ⚠️ NEVER STRAND A SCREEN (the rule every function below serves):
 *   • the new network is added first; only afterwards are networks VenueOS
 *     itself added removed, and never one the screen is using;
 *   • a network a person or the vendor saved is never touched — not updated,
 *     not removed, not disabled (on Android 7 a connect request disables the
 *     others for a moment; [LegacyWifiEngine] puts them back);
 *   • the credentials of the network the screen is on right now are never
 *     rewritten — a wrong password could not be undone (the old one is not
 *     readable);
 *   • a switch that is not proved within [PROOF_WINDOW_MS] is undone, and is
 *     never retried on its own.
 *
 * No `android.*` call is made here — only compile-time constants, which the
 * compiler copies in — so every rule has a JVM test (`WifiSetupPolicyTest`).
 */
object WifiSetupPolicy {

    /** Android 10: suggestions begin; the saved-network calls stop working for an app that targets 10+. */
    const val SUGGESTION_SDK = 29

    /** Android 11: Android's save-network dialog and an app's own suggestion list. */
    const val DIALOG_SDK = 30

    /** Android 12: an app can read whether its suggestions were approved. */
    const val APPROVAL_SDK = 31

    /**
     * Android 8: a connect request (`enableNetwork(id, true)`) no longer
     * disables every other saved network. Below it, it does — until the
     * framework or VenueOS enables them again.
     */
    const val SELECT_KEEPS_OTHERS_SDK = 26

    const val VIA_LEGACY = "legacy"
    const val VIA_SUGGESTION = "suggestion"

    fun via(sdk: Int): String = if (sdk < SUGGESTION_SDK) VIA_LEGACY else VIA_SUGGESTION

    // ─────────────────────────────────────────────────────────────────
    // Which mechanism
    // ─────────────────────────────────────────────────────────────────

    sealed class Route {
        /** Android 9 and older: save it (and, where safe, switch to it with proof). */
        object Legacy : Route()

        /** A network suggestion. */
        object Suggest : Route()

        /** Android's save-network dialog, confirmed by a person at the screen. */
        object Dialog : Route()

        /** Nothing on this unit can do it; [code] says why. */
        data class Refuse(val code: String) : Route()
    }

    /**
     * @param approval Android's approval of VenueOS's suggestions as last read
     *        (`rejected` only where Android said so).
     * @param dialogAvailable the save dialog opens here ([DIALOG_SDK]+ and a
     *        system Settings page answers it — `SettingsPagePolicy`).
     * @param wpa3Supported Android reports WPA3-Personal (SAE) support.
     */
    fun route(
        sdk: Int,
        value: DesiredValue.WifiValue,
        approval: String,
        dialogAvailable: Boolean,
        wpa3Supported: Boolean,
    ): Route = when {
        // WPA3 needs Android 10 and hardware that says it can.
        value.security == "wpa3" && (sdk < SUGGESTION_SDK || !wpa3Supported) ->
            Route.Refuse(DeviceSettingCodes.WIFI_SECURITY)
        // Below Android 10 every network is saved for good anyway — "permanent" changes nothing.
        sdk < SUGGESTION_SDK -> Route.Legacy
        value.permanent ->
            if (dialogAvailable) Route.Dialog else Route.Refuse(DeviceSettingCodes.WIFI_NO_DIALOG)
        // Declined suggestions close only the suggestion path.
        approval == DeviceSettingsFacts.WIFI_REJECTED ->
            if (dialogAvailable) Route.Dialog else Route.Refuse(DeviceSettingCodes.WIFI_REJECTED)
        else -> Route.Suggest
    }

    // ─────────────────────────────────────────────────────────────────
    // Suggestions: what an accepted suggestion MEANS on this Android
    // ─────────────────────────────────────────────────────────────────

    /**
     * Android 10 and 11 never say whether someone allowed VenueOS's networks,
     * so "suggested" is all that can be said there. On Android 12+ a pending
     * (or not yet reported) approval WAITS, and rule 2w of the policy records
     * the approval the moment Android reports it.
     */
    fun suggestionLanded(sdk: Int, approval: String): DeviceSettingsPolicy.Outcome = when {
        sdk < APPROVAL_SDK -> DeviceSettingsPolicy.Outcome.Landed(DeviceSettingCodes.WIFI_SUGGESTED)
        approval == DeviceSettingsFacts.WIFI_APPROVED -> DeviceSettingsPolicy.Outcome.Landed(DeviceSettingCodes.WIFI_SAVED)
        else -> DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.WAITING, DeviceSettingCodes.WIFI_APPROVAL)
    }

    /**
     * `addNetworkSuggestions` status → the code to report; null = accepted.
     * The constants are copied in at compile time, so this runs on any
     * Android — it never touches an API-33 symbol at run time.
     */
    @SuppressLint("InlinedApi")
    fun suggestionRefusal(status: Int): String? = when (status) {
        WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS,
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE,
        -> null
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_APP_DISALLOWED -> DeviceSettingCodes.WIFI_REJECTED
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_EXCEEDS_MAX_PER_APP -> DeviceSettingCodes.WIFI_LIMIT
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_INVALID -> DeviceSettingCodes.WIFI_INVALID
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_NOT_ALLOWED,
        WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_RESTRICTED_BY_ADMIN,
        -> DeviceSettingCodes.WIFI_RESTRICTED
        else -> DeviceSettingCodes.WIFI_ERROR
    }

    /**
     * May VenueOS remove its OLDER suggestions now? On Android 13+ the removal
     * LINGERS (a connection on the old one is kept while it is in use). Below
     * 13 a removal disconnects at once, and Android does not let an app see
     * which network it is on — so there it waits until Wi-Fi is not carrying
     * the screen's traffic at all (a cable, or no Wi-Fi connection).
     */
    fun mayRemoveOlderSuggestions(sdk: Int, defaultIsWifi: Boolean?): Boolean =
        sdk >= 33 || defaultIsWifi == false

    // ─────────────────────────────────────────────────────────────────
    // Android's save-network dialog
    // ─────────────────────────────────────────────────────────────────

    /** How long a staged dialog waits for a person at the screen. */
    const val DIALOG_WINDOW_MS = 60 * 60_000L

    /** How long VenueOS's own card stays up without an answer before it steps back. */
    const val CARD_WINDOW_MS = 2 * 60_000L

    /** After Back (or the card timing out), how long before the card is offered again. */
    const val CARD_COOLDOWN_MS = 5 * 60_000L

    /** A raised dialog has this long to pause the player — or Android refused to show it. */
    const val DIALOG_VERIFY_MS = 6_000L

    /** How long the background relaunch paths keep off the glass while a person is in the dialog. */
    const val DIALOG_YIELD_MS = 10 * 60_000L

    fun dialogExpired(stagedAtElapsedMs: Long, nowElapsedMs: Long): Boolean {
        val age = nowElapsedMs - stagedAtElapsedMs
        return age < 0L || age >= DIALOG_WINDOW_MS
    }

    /**
     * Put VenueOS's "Save Wi-Fi network" card up? Only for a PERSON — the
     * player calls this from local input, never on its own — and never over
     * an alert, a pinned task, a standby panel or another card.
     */
    fun mayOfferCard(
        staged: Boolean,
        expired: Boolean,
        foreground: Boolean,
        interactive: Boolean,
        emergencyHeld: Boolean,
        lockTask: Boolean,
        standby: Boolean,
        otherCardShowing: Boolean,
        cooldownUntilElapsedMs: Long,
        nowElapsedMs: Long,
    ): Boolean =
        staged && !expired && foreground && interactive && !emergencyHeld && !lockTask && !standby &&
            !otherCardShowing && nowElapsedMs >= cooldownUntilElapsedMs

    /** Keep the card up? Never over an alert; never past [CARD_WINDOW_MS]. */
    fun keepCard(emergencyHeld: Boolean, shownForMs: Long): Boolean =
        !emergencyHeld && shownForMs in 0L until CARD_WINDOW_MS

    /** Did the dialog come up? Raising it pauses the player. */
    fun dialogAppeared(raisedAtElapsedMs: Long, lastPausedAtElapsedMs: Long): Boolean =
        raisedAtElapsedMs > 0L && lastPausedAtElapsedMs >= raisedAtElapsedMs

    /** No person answers a dialog this fast: a cancel inside it is Android closing the dialog itself. */
    const val DIALOG_MIN_HUMAN_MS = 1_500L

    /**
     * Android's answer for the ONE network VenueOS asked it to save.
     * RESULT_OK means the person approved it; the per-network list (when the
     * build sends one) says whether Android stored it. A cancel that came back
     * before anyone could have read the dialog is Android refusing to show it.
     */
    @SuppressLint("InlinedApi")
    fun dialogResult(resultOk: Boolean, perNetwork: List<Int>?, upForMs: Long): String = when {
        !resultOk && upForMs in 0L until DIALOG_MIN_HUMAN_MS -> DeviceSettingCodes.WIFI_NO_DIALOG
        !resultOk -> DeviceSettingCodes.WIFI_DECLINED
        perNetwork.isNullOrEmpty() -> DeviceSettingCodes.WIFI_SAVED
        perNetwork[0] == Settings.ADD_WIFI_RESULT_SUCCESS ||
            perNetwork[0] == Settings.ADD_WIFI_RESULT_ALREADY_EXISTS -> DeviceSettingCodes.WIFI_SAVED
        else -> DeviceSettingCodes.WIFI_ERROR
    }

    /**
     * Must the background relaunch paths (watchdog, wake, post-update) leave
     * the glass alone? While a person may still be working in the dialog —
     * bounded, and NEVER during an alert.
     */
    fun relaunchShouldYield(raisedAtElapsedMs: Long, answered: Boolean, nowElapsedMs: Long, emergencyHeld: Boolean): Boolean =
        !emergencyHeld && !answered && raisedAtElapsedMs > 0L && nowElapsedMs >= raisedAtElapsedMs &&
            nowElapsedMs - raisedAtElapsedMs < DIALOG_YIELD_MS

    // ─────────────────────────────────────────────────────────────────
    // Android 9 and older: save, switch where needed, prove or switch back
    // ─────────────────────────────────────────────────────────────────

    /** A network by what identifies it to Android: its name and its security. */
    data class NetKey(val ssid: String, val security: String)

    /** One network Android has saved, as `getConfiguredNetworks` reads it (no secret is ever read). */
    data class SavedNetwork(
        val networkId: Int,
        /** null = a name VenueOS can never have written (hex SSID, unknown security). */
        val key: NetKey?,
        val enabled: Boolean,
        /** Android's `Status.CURRENT`: the network this unit is associated with. */
        val current: Boolean,
    )

    enum class Next {
        /** It IS the network the screen is on: nothing to switch. */
        JOINED,

        /** Saved; the screen's traffic does not ride Wi-Fi (or it cannot tell), so nothing is switched. */
        SAVED,

        /** The screen's traffic rides ANOTHER Wi-Fi network: switch, prove, or switch back. */
        SWITCH,
    }

    /**
     * After VenueOS's network is saved and enabled. Anything unreadable
     * resolves to [Next.SAVED] — the direction in which nothing can strand.
     */
    fun legacyNext(networkId: Int, currentId: Int?, defaultIsWifi: Boolean?): Next = when {
        currentId != null && currentId == networkId -> Next.JOINED
        currentId == null || defaultIsWifi != true -> Next.SAVED
        else -> Next.SWITCH
    }

    /**
     * May VenueOS rewrite one of ITS networks in place (new password, hidden
     * flag)? Not while it is the network the screen's traffic may be riding:
     * a wrong password would take the screen offline, and the old one cannot
     * be read back to undo it.
     */
    fun mayRewrite(existingId: Int, currentId: Int?, defaultIsWifi: Boolean?): Boolean =
        currentId != existingId || defaultIsWifi == false

    /**
     * VenueOS's OTHER networks that may go now: only networks VenueOS added
     * (its own ledger), never [keep], never the one in use.
     */
    fun removable(saved: List<SavedNetwork>, ours: Set<NetKey>, keep: NetKey, inUseId: Int?): List<SavedNetwork> =
        saved.filter { n ->
            val key = n.key
            key != null && key in ours && key != keep && !n.current && n.networkId != inUseId
        }

    /** What VenueOS keeps on disk while a switch is being proved — no secret. */
    data class Journal(
        /** The setting's identity (`r<revision>`) the switch is for. */
        val id: String,
        val networkId: Int,
        val key: NetKey,
        /** The network the screen was on; -1 = unknown. */
        val previousId: Int,
        /** That network is one VenueOS added (so VenueOS may reconnect to it). */
        val previousOurs: Boolean,
        /** Every network that was enabled before — on Android 7 a connect request disables them. */
        val enabledBefore: List<Int>,
        val startedElapsedMs: Long,
        val boot: Int,
    )

    /** The whole window a switch has to prove itself in. */
    const val PROOF_WINDOW_MS = 60_000L

    /** How often the proof looks. */
    const val PROOF_POLL_MS = 3_000L

    /** Android 8+ falls back to another network by itself after a failed join; past this, stop waiting. */
    const val FELL_BACK_AFTER_MS = 20_000L

    /** A proof resumed after the process died gets at least this long. */
    const val RESUME_GRACE_MS = 15_000L

    sealed class Proof {
        /** On VenueOS's network, and VenueOS's server answered over it: keep it. */
        object Proven : Proof()

        object Wait : Proof()

        /** Switch back; [code] is what the operator is told. */
        data class RollBack(val code: String) : Proof()
    }

    /**
     * One look at a switch in progress.
     *
     * ⚠️ An alert outranks the switch: the screen goes straight back to the
     * network it was on (life safety first — the all-clear must reach it).
     */
    fun proofStep(
        sinceStartMs: Long,
        remainingMs: Long,
        onOurNetwork: Boolean,
        everOnOurNetwork: Boolean,
        reachedServer: Boolean,
        emergencyHeld: Boolean,
        ourNetworkGone: Boolean,
        onAnotherNetwork: Boolean,
    ): Proof = when {
        emergencyHeld -> Proof.RollBack(DeviceSettingCodes.WAIT_EMERGENCY)
        onOurNetwork && reachedServer -> Proof.Proven
        // Android gave up on it (a wrong password disables it) or it vanished.
        ourNetworkGone -> Proof.RollBack(DeviceSettingCodes.WIFI_NO_CONNECT)
        sinceStartMs >= FELL_BACK_AFTER_MS && onAnotherNetwork && !everOnOurNetwork ->
            Proof.RollBack(DeviceSettingCodes.WIFI_NO_CONNECT)
        remainingMs <= 0L ->
            Proof.RollBack(if (everOnOurNetwork) DeviceSettingCodes.WIFI_UNREACHABLE else DeviceSettingCodes.WIFI_NO_CONNECT)
        else -> Proof.Wait
    }

    /**
     * When a proof (started now, or resumed after the process died) must have
     * succeeded. A switch that outlived a reboot gets a fresh window: the
     * network stack came up again from scratch.
     */
    fun proofDeadline(journal: Journal, resumedAtElapsedMs: Long, boot: Int): Long =
        if (journal.boot == boot && journal.startedElapsedMs <= resumedAtElapsedMs) {
            maxOf(journal.startedElapsedMs + PROOF_WINDOW_MS, resumedAtElapsedMs + RESUME_GRACE_MS)
        } else {
            resumedAtElapsedMs + PROOF_WINDOW_MS
        }

    // ── on disk: the ledger of VenueOS's networks and the switch journal ──

    fun encodeLedger(keys: Set<NetKey>): String {
        val a = JSONArray()
        keys.sortedWith(compareBy({ it.ssid }, { it.security }))
            .forEach { a.put(JSONObject().put("ssid", it.ssid).put("security", it.security)) }
        return a.toString()
    }

    fun decodeLedger(raw: String?): Set<NetKey> = runCatching {
        if (raw.isNullOrBlank()) return emptySet()
        val a = JSONArray(raw)
        (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            val ssid = o.optString("ssid", "").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            val security = o.optString("security", "").takeIf { it in DeviceSettingDomains.WIFI_SECURITY }
                ?: return@mapNotNull null
            NetKey(ssid, security)
        }.toSet()
    }.getOrDefault(emptySet())

    fun encodeJournal(j: Journal): String = JSONObject()
        .put("id", j.id)
        .put("net", j.networkId)
        .put("ssid", j.key.ssid)
        .put("security", j.key.security)
        .put("prev", j.previousId)
        .put("prevOurs", j.previousOurs)
        .put("enabled", JSONArray(j.enabledBefore))
        .put("started", j.startedElapsedMs)
        .put("boot", j.boot)
        .toString()

    fun decodeJournal(raw: String?): Journal? = runCatching {
        if (raw.isNullOrBlank()) return null
        val o = JSONObject(raw)
        // `r…` the dashboard's identities, `m…` a person's at the screen (WifiConnect).
        val id = o.optString("id", "").takeIf { Regex("^[rm]\\d{1,10}$").matches(it) } ?: return null
        val net = o.optInt("net", -1).takeIf { it >= 0 } ?: return null
        val ssid = o.optString("ssid", "").takeIf { it.isNotEmpty() } ?: return null
        val security = o.optString("security", "").takeIf { it in DeviceSettingDomains.WIFI_SECURITY } ?: return null
        val enabled = o.optJSONArray("enabled")?.let { a -> (0 until a.length()).map { a.optInt(it, -1) }.filter { it >= 0 } }
            ?: emptyList()
        Journal(
            id = id,
            networkId = net,
            key = NetKey(ssid, security),
            previousId = o.optInt("prev", -1),
            previousOurs = o.optBoolean("prevOurs", false),
            enabledBefore = enabled,
            startedElapsedMs = o.optLong("started", 0L),
            boot = o.optInt("boot", -1),
        )
    }.getOrNull()
}
