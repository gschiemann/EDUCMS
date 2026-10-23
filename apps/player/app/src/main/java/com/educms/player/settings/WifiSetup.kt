package com.educms.player.settings

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.setup.PageDecision
import com.educms.player.setup.SettingsPagePolicy
import com.educms.player.setup.SetupFactsReader
import java.util.concurrent.atomic.AtomicBoolean

/**
 * THE Wi-Fi engine (2026-10-23): one way to put this screen on a network,
 * whoever asks — the dashboard (through `DeviceSettingsAppliers`, behind
 * [DeviceSettingsPolicy]) or a person at the screen (through [WifiConnect],
 * for the on-screen menu that will sit on top of this). Same mechanism
 * choice ([WifiSetupPolicy.route]), same never-strand rule, same outcome
 * codes.
 *
 * Android 9 and older: [LegacyWifiEngine] over [LegacyWifiNetworks], with the
 * switch proved on its own thread ([startProof]) and recovered after a crash
 * or a reboot ([maintain]). Android 10+: [Api29WifiSuggestions] /
 * [Api33WifiSuggestions], or Android's save dialog ([WifiSavePrompt]).
 *
 * Identities: the dashboard's are `r<revision>`; a person's are `m<n>`
 * ([WifiConnect]). A finished switch or dialog is recorded against the
 * identity it was for, and only if that identity is still the one asked for.
 */
internal object WifiSetup {

    private const val TAG = "DeviceSettings"

    /** How long the answer to "does this screen have the save dialog?" is kept. */
    private const val DIALOG_PAGE_TTL_MS = 30 * 60_000L

    private val MANAGER_PACKAGES = setOf("com.educms.manager", "com.educms.manager.debug")

    @Volatile private var dialogPage: Pair<Long, ComponentName?>? = null
    private val proving = AtomicBoolean(false)

    private val sdk: Int get() = Build.VERSION.SDK_INT

    // ─────────────────────────────────────────────────────────────────
    // facts — the heartbeat's report and the capability verdict
    // ─────────────────────────────────────────────────────────────────

    fun hasWifi(ctx: Context): Boolean {
        val app = ctx.applicationContext
        return runCatching { app.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI) }.getOrDefault(false) &&
            wifiManager(app) != null
    }

    /**
     * Android's approval of VenueOS's networks. Below Android 10 there is none
     * to give — VenueOS's saved networks need no approval — so it reads
     * `approved`; Android 10 and 11 never say (`unknown`).
     */
    fun approval(ctx: Context): String = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            runCatching { Api31WifiApproval.approval(ctx) }.getOrDefault(DeviceSettingsFacts.WIFI_UNKNOWN)
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> DeviceSettingsFacts.WIFI_UNKNOWN
        else -> DeviceSettingsFacts.WIFI_APPROVED
    }

    fun wpa3Supported(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            runCatching { Api29WifiSuggestions.wpa3Supported(ctx) }.getOrDefault(false)

    /** Does Android's save-network dialog open here — a SYSTEM Settings page, never a browser? */
    fun dialogAvailable(ctx: Context): Boolean = dialogComponent(ctx) != null

    /**
     * The component that answers the save dialog, resolved the way the setup
     * checklist resolves its pages (`SettingsPagePolicy`): `resolveActivity`
     * first, then the ROM's own list; a browser, a search app, the chooser or
     * one of our own apps is refused. Binder calls: never on the main thread.
     */
    private fun dialogComponent(ctx: Context): ComponentName? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        val now = SystemClock.elapsedRealtime()
        dialogPage?.let { (at, component) -> if (now - at in 0 until DIALOG_PAGE_TTL_MS) return component }
        val app = ctx.applicationContext
        val component = runCatching {
            val browsers = SetupFactsReader.browserPackages(app)
            val resolution = SetupFactsReader.resolve(app, Api30WifiAddNetworks.pageIntent(), browsers)
            when (val d = SettingsPagePolicy.decide(resolution, MANAGER_PACKAGES + app.packageName)) {
                is PageDecision.Open -> ComponentName(d.handler.packageName, d.handler.activityName)
                is PageDecision.Refuse -> {
                    PlayerLogger.i(TAG, "no usable save-network dialog here: ${d.code}")
                    null
                }
            }
        }.getOrNull()
        dialogPage = now to component
        return component
    }

    fun facts(ctx: Context): DeviceSettingsWire.WifiFacts? {
        val app = ctx.applicationContext
        if (!hasWifi(app)) return null
        val legacy = sdk < WifiSetupPolicy.SUGGESTION_SDK
        return DeviceSettingsWire.WifiFacts(
            via = WifiSetupPolicy.via(sdk),
            radio = runCatching { wifiManager(app)?.isWifiEnabled }.getOrNull(),
            dialog = dialogAvailable(app),
            wpa3 = wpa3Supported(app),
            joined = if (legacy) runCatching { legacyEngine(app).ourNetwork().second }.getOrNull() else null,
        )
    }

    fun observed(ctx: Context): DeviceSettingsWire.WifiObserved? {
        val app = ctx.applicationContext
        if (wifiManager(app) == null) return null
        val ssid = runCatching {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> Api33WifiSuggestions.ourSsid(app)
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> Api29WifiSuggestions.ourSsid(app)
                else -> legacyEngine(app).ourNetwork().first
            }
        }.getOrNull()
        return DeviceSettingsWire.WifiObserved(ssid = ssid, approval = approval(app))
    }

    /** Rules 2w and 6w read this: what is in progress outside the item's record. */
    fun progress(ctx: Context): DeviceSettingsPolicy.WifiProgress {
        val app = ctx.applicationContext
        val legacy = sdk < WifiSetupPolicy.SUGGESTION_SDK
        val result = runCatching { WifiSavePrompt.lastResult(app) }.getOrNull()
        return DeviceSettingsPolicy.WifiProgress(
            legacyRadioOn = if (legacy) runCatching { LegacyWifiNetworks(app).radioOn() }.getOrNull() else null,
            switchingId = if (legacy) runCatching { PrefsWifiStateStore(app).journal()?.id }.getOrNull() else null,
            dialogStagedId = runCatching { WifiSavePrompt.stagedId(app) }.getOrNull(),
            dialogResultId = result?.first,
            dialogResult = result?.second,
            approval = approval(app),
        )
    }

    // ─────────────────────────────────────────────────────────────────
    // the one engine
    // ─────────────────────────────────────────────────────────────────

    /**
     * Put the screen on [value]. Called with the attempt already persisted
     * (dashboard) or after [WifiConnect]'s own checks (a person). Never
     * throws for anything Android does; the caller maps a throw to `error`.
     */
    fun connect(ctx: Context, id: String, value: DesiredValue.WifiValue): DeviceSettingsPolicy.Outcome {
        val app = ctx.applicationContext
        val dialog = dialogAvailable(app)
        return when (val route = WifiSetupPolicy.route(sdk, value, approval(app), dialog, wpa3Supported(app))) {
            WifiSetupPolicy.Route.Legacy -> {
                val outcome = legacyEngine(app).apply(id, value, SystemClock.elapsedRealtime(), bootCount(app))
                if (outcome is DeviceSettingsPolicy.Outcome.Held && outcome.why == DeviceSettingCodes.WIFI_SWITCHING) {
                    startProof(app)
                }
                outcome
            }
            WifiSetupPolicy.Route.Suggest -> suggest(app, id, value, dialog)
            WifiSetupPolicy.Route.Dialog -> stageDialog(app, id, value)
            is WifiSetupPolicy.Route.Refuse -> DeviceSettingsPolicy.Outcome.Error(route.code)
        }
    }

    private fun suggest(app: Context, id: String, value: DesiredValue.WifiValue, dialog: Boolean): DeviceSettingsPolicy.Outcome {
        val added = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> Api33WifiSuggestions.replace(app, value)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> Api29WifiSuggestions.add(app, value, defaultIsWifi(app))
            else -> return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.API_LEVEL)
        }
        return when (added) {
            Api29WifiSuggestions.Added.Accepted -> WifiSetupPolicy.suggestionLanded(sdk, approval(app))
            is Api29WifiSuggestions.Added.Refused ->
                // Declined suggestions: where Android's save dialog opens, a
                // person at the screen can still save it.
                if (added.code == DeviceSettingCodes.WIFI_REJECTED && dialog) stageDialog(app, id, value)
                else DeviceSettingsPolicy.Outcome.Error(added.code)
        }
    }

    private fun stageDialog(app: Context, id: String, value: DesiredValue.WifiValue): DeviceSettingsPolicy.Outcome {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_NO_DIALOG)
        val component = dialogComponent(app) ?: return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_NO_DIALOG)
        val (suggestion, problem) = Api29WifiSuggestions.build(value)
        if (suggestion == null) return DeviceSettingsPolicy.Outcome.Error(problem ?: DeviceSettingCodes.WIFI_ERROR)
        val request = Api30WifiAddNetworks.request(suggestion, component)
        if (WifiConnect.isLocal(id)) {
            // A person asked from the screen itself: their press IS the
            // confirmation — Android's dialog goes up now, no card first.
            WifiConnect.raiseDialog(app, id, request)
        } else {
            WifiSavePrompt.stage(id, value.ssid, request)
        }
        return DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.WAITING, DeviceSettingCodes.WIFI_DIALOG)
    }

    // ─────────────────────────────────────────────────────────────────
    // Android 9 and older: the switch proof, and its recovery
    // ─────────────────────────────────────────────────────────────────

    /**
     * Every heartbeat loop, whether or not the server can be reached: a switch
     * journal left by a process that died (or by a reboot) is proved or
     * undone; a staged dialog nobody answered in time is recorded. Cheap when
     * there is nothing to do (one prefs read).
     */
    fun maintain(ctx: Context) {
        val app = ctx.applicationContext
        runCatching { WifiSavePrompt.stagedId(app) } // records an expired stage
        if (sdk >= WifiSetupPolicy.SUGGESTION_SDK) return
        if (PrefsWifiStateStore(app).journal() != null) startProof(app)
    }

    /** The operator moved on (a new network, or none): a staged dialog for any other identity goes. */
    @Suppress("UNUSED_PARAMETER") // the context is the engine's calling convention; the stage is in memory
    fun reconcile(ctx: Context, desiredId: String?) {
        runCatching { WifiSavePrompt.keepOnly(desiredId) }
    }

    private fun startProof(app: Context) {
        if (!proving.compareAndSet(false, true)) return
        val worker = Thread({
            try {
                prove(app)
            } catch (t: Throwable) {
                PlayerLogger.e(TAG, "wifi switch proof failed", t)
            } finally {
                proving.set(false)
            }
        }, "venueos-wifi-proof")
        worker.isDaemon = true
        worker.start()
    }

    private fun prove(app: Context) {
        val store = PrefsWifiStateStore(app)
        val journal = store.journal() ?: return
        val engine = legacyEngine(app)
        val resumedAt = SystemClock.elapsedRealtime()
        val deadline = WifiSetupPolicy.proofDeadline(journal, resumedAt, bootCount(app))
        var ever = false
        while (true) {
            val now = SystemClock.elapsedRealtime()
            val seen = engine.observe(journal)
            ever = ever || seen.onOurNetwork
            when (
                val verdict = WifiSetupPolicy.proofStep(
                    sinceStartMs = now - resumedAt,
                    remainingMs = deadline - now,
                    onOurNetwork = seen.onOurNetwork,
                    everOnOurNetwork = ever,
                    reachedServer = seen.reachedServer,
                    // Unreadable reads as HELD: the alert wins, the screen goes back.
                    emergencyHeld = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true),
                    ourNetworkGone = seen.ourNetworkGone,
                    onAnotherNetwork = seen.onAnotherNetwork,
                )
            ) {
                WifiSetupPolicy.Proof.Wait -> Thread.sleep(WifiSetupPolicy.PROOF_POLL_MS)
                WifiSetupPolicy.Proof.Proven -> {
                    finish(app, journal, engine.commit(journal))
                    return
                }
                is WifiSetupPolicy.Proof.RollBack -> {
                    finish(app, journal, engine.rollBack(journal, verdict.code))
                    return
                }
            }
        }
    }

    /** Record the outcome against its identity FIRST, then drop the journal. */
    private fun finish(app: Context, journal: WifiSetupPolicy.Journal, outcome: DeviceSettingsPolicy.Outcome) {
        if (WifiConnect.isLocal(journal.id)) {
            WifiConnect.complete(app, journal.id, outcome)
        } else {
            DeviceSettings.finishWifi(app, journal.id, outcome)
        }
        PrefsWifiStateStore(app).putJournal(null)
    }

    // ─────────────────────────────────────────────────────────────────

    private fun legacyEngine(app: Context) = LegacyWifiEngine(
        port = LegacyWifiNetworks(app),
        store = PrefsWifiStateStore(app),
        sdk = sdk,
        log = { PlayerLogger.i(TAG, "wifi: $it") },
    )

    private fun wifiManager(app: Context): WifiManager? =
        runCatching { app.getSystemService(Context.WIFI_SERVICE) as? WifiManager }.getOrNull()

    fun defaultIsWifi(ctx: Context): Boolean? = runCatching {
        val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return null
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return null
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }.getOrNull()

    /** `Settings.Global.BOOT_COUNT`; -1 when unreadable. */
    fun bootCount(ctx: Context): Int =
        runCatching { Settings.Global.getInt(ctx.applicationContext.contentResolver, Settings.Global.BOOT_COUNT) }
            .getOrDefault(-1)
}
