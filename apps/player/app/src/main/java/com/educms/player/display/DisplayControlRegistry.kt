package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * Resolves each [Capability] to exactly ONE provider, once, and caches
 * the answer. Everything that drives the panel — the JS bridge, the
 * on-device scheduler, the dead-man revert — goes through
 * [DisplayControlRegistry.apply], so the clamp, the guard and the audit
 * log cannot be bypassed by adding a new caller.
 *
 * PRIORITY (fixed; do not reorder without re-reading the safety notes on
 * each provider):
 *
 * ```
 * BRIGHTNESS   VendorRecipe → SysfsBacklight → SettingsBrightness → SoftwareDim
 * BLANK / WAKE VendorRecipe → DeviceAdminBlank → ScreenTimeout → SoftwareDim
 * VOLUME       AudioManager
 * REBOOT       DeviceOwnerReboot          (device owner only — no fallback exists)
 * ```
 *
 * BRIGHTNESS and BLANK/WAKE ALWAYS resolve, because SoftwareDim is an
 * unconditional floor — the probe verdict names the MECHANISM, never
 * whether the capability exists. VOLUME resolves on every box with an
 * AudioManager.
 *
 * REBOOT resolves to NOTHING on today's fleet and that is the correct,
 * intended outcome: the product decision (2026-08-13) is that we do NOT
 * provision this app as Android device owner, and `dpm.reboot()` has no
 * lower-privilege equivalent at any level. [capabilities] therefore
 * OMITS REBOOT and the dashboard must not render the button.
 * [DeviceOwnerRebootProvider] stays in the chain because it lights up by
 * itself the day a manufacturer ships us preinstalled/platform-signed —
 * see its header.
 *
 * ⚠️ [DisplayEmergency] gates this class. Read that file before touching
 * [apply].
 */
object DisplayControlRegistry {

    private const val TAG = "DisplayControl"

    private val CHAINS: Map<Capability, List<DisplayControlProvider>> = mapOf(
        Capability.BRIGHTNESS to listOf(
            VendorRecipeProvider,
            SysfsBacklightProvider,
            SettingsBrightnessProvider,
            SoftwareDimProvider,
        ),
        Capability.BLANK to listOf(
            VendorRecipeProvider,
            DeviceAdminBlankProvider,
            ScreenTimeoutBlankProvider,
            SoftwareDimProvider,
        ),
        Capability.WAKE to listOf(
            VendorRecipeProvider,
            DeviceAdminBlankProvider,
            ScreenTimeoutBlankProvider,
            SoftwareDimProvider,
        ),
        Capability.VOLUME to listOf(AudioManagerProvider),
        Capability.REBOOT to listOf(DeviceOwnerRebootProvider),
    )

    @Volatile
    private var resolvedCache: Map<Capability, DisplayControlProvider>? = null

    /**
     * Capability → resolved provider id, e.g.
     * `{"BRIGHTNESS":"software-dim","BLANK":"software-dim","VOLUME":"audiomanager"}`.
     *
     * The dashboard keys its per-screen UI off THIS, not off a boolean:
     * "software-dim" must be surfaced as "dims the image only — this box
     * exposes no backlight control" rather than as a real backlight
     * slider, and a capability that is absent here must not be rendered
     * at all.
     */
    fun capabilities(ctx: Context): Map<Capability, String> =
        resolve(ctx).mapValues { it.value.id }

    fun providerFor(ctx: Context, capability: Capability): DisplayControlProvider? =
        resolve(ctx)[capability]

    /**
     * THE single entry point.
     *
     * @param revertAfterMs when non-null, a dead-man revert is armed
     *        BEFORE the action is applied. Operator TEST actions always
     *        pass one; scheduled actions never do.
     */
    fun apply(ctx: Context, rawAction: DisplayAction, revertAfterMs: Long? = null): ActionResult {
        val app = ctx.applicationContext
        val action = DisplayLimits.normalize(rawAction)
        if (action != rawAction) {
            PlayerLogger.i(TAG, "clamped ${rawAction.describe()} → ${action.describe()}")
        }

        // ── ⚠️ LIFE-SAFETY GATE — must be the FIRST thing that runs ──
        // Checked here, before the provider is resolved and before the
        // dead-man guard is armed, because this is the single entry
        // point the bridge, the on-device scheduler AND the dead-man
        // revert all go through. Refusing here means a blank cannot
        // reach the panel from ANY of them while an alert is up, and a
        // refused action leaves no pending record behind.
        DisplayEmergency.refusalReason(app, action)?.let { why ->
            PlayerLogger.e(TAG, "REFUSED ${action.describe()} — $why")
            return ActionResult.Failed(why, EMERGENCY_HOLD_ID)
        }

        val provider = resolve(app)[action.capability]
            ?: return ActionResult.Unsupported("this device exposes no ${action.capability} control").also {
                PlayerLogger.w(TAG, "REFUSED ${action.describe()} — no provider for ${action.capability}")
            }

        // ── dead-man revert is armed BEFORE the apply, never after ──
        if (revertAfterMs != null) {
            when (val armed = DisplayGuard.arm(app, action, revertAfterMs)) {
                is DisplayGuard.ArmResult.Refused ->
                    return ActionResult.Failed("dead-man revert could not be armed: ${armed.reason}", provider.id)
                DisplayGuard.ArmResult.NotApplicable, DisplayGuard.ArmResult.Armed -> Unit
            }
        }

        val result = try {
            provider.apply(app, action)
        } catch (t: Throwable) {
            PlayerLogger.e(TAG, "provider ${provider.id} threw on ${action.describe()}", t)
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, provider.id)
        }

        PlayerLogger.i(TAG, "${action.describe()} via ${provider.id} → $result")

        if (result.ok) recordState(app, action)

        // The alarm is armed whenever a RECORD was committed, regardless
        // of the apply outcome. A provider can mutate state and THEN
        // fail — DeviceAdminBlankProvider drops FLAG_KEEP_SCREEN_ON
        // before lockNow(), so a SecurityException there leaves the panel
        // free to sleep. Arming only on success left that record on disk
        // with no timer, so the restore waited for the next process
        // start, which on a healthy kiosk can be days. Reverting to an
        // unchanged prior state is a harmless no-op; not reverting a
        // half-applied one is a dark screen.
        if (revertAfterMs != null) DisplayGuard.scheduleRevertAlarm(app)

        // NOTE: a failed apply deliberately LEAVES the pending record in
        // place, for the same reason.
        return result
    }

    /** Mirror what is now on the panel so a later revert has a target. */
    private fun recordState(ctx: Context, action: DisplayAction) {
        when (action) {
            is DisplayAction.SetBrightness -> {
                DisplayPrefs.setBrightnessPercent(ctx, action.percent)
                // A brightness change only un-blanks when the SAME
                // mechanism drives both — which is true of the software
                // floor (its SetBrightness literally calls
                // setBlackout(false)) and of nothing else. On a box whose
                // blank is a vendor power broadcast and whose brightness
                // is a sysfs write, inferring blanked=false here made the
                // mirror LIE: the panel was still powered off, the
                // dashboard said it was awake, and onWindowAttached then
                // declined to re-blank or wake it.
                if (action.percent > 0 && brightnessImpliesUnblank(ctx)) {
                    DisplayPrefs.setBlanked(ctx, false)
                }
            }
            is DisplayAction.SetVolume -> DisplayPrefs.setVolumePercent(ctx, action.percent)
            DisplayAction.Blank -> DisplayPrefs.setBlanked(ctx, true)
            DisplayAction.Wake -> DisplayPrefs.setBlanked(ctx, false)
            DisplayAction.Reboot -> Unit
        }
    }

    /**
     * True only when BOTH brightness and blank resolve to the software
     * floor, the one provider whose SetBrightness genuinely un-blanks.
     */
    private fun brightnessImpliesUnblank(ctx: Context): Boolean {
        val resolved = resolve(ctx)
        return resolved[Capability.BRIGHTNESS] === SoftwareDimProvider &&
            resolved[Capability.BLANK] === SoftwareDimProvider
    }

    private fun resolve(ctx: Context): Map<Capability, DisplayControlProvider> {
        resolvedCache?.let { return it }
        synchronized(this) {
            resolvedCache?.let { return it }
            val app = ctx.applicationContext
            val out = LinkedHashMap<Capability, DisplayControlProvider>()
            CHAINS.forEach { (capability, chain) ->
                val winner = chain.firstOrNull { provider ->
                    try {
                        capability in provider.supports(app)
                    } catch (t: Throwable) {
                        PlayerLogger.w(TAG, "provider ${provider.id}.supports() threw: ${t.message}")
                        false
                    }
                }
                if (winner != null) out[capability] = winner
            }
            PlayerLogger.i(
                TAG,
                "resolved " + out.entries.joinToString(", ") { "${it.key}=${it.value.id}" }.ifEmpty { "(nothing)" },
            )
            resolvedCache = out
            return out
        }
    }

    /**
     * Drop the resolution cache.
     *
     * Called when the vendor recipe changes (a new recipe can move
     * BRIGHTNESS from software-dim to a real mechanism), after a sysfs
     * write fails with EACCES, and — the case this was MISSING for —
     * from `MainActivity.onResume`.
     *
     * WRITE_SETTINGS is an appop the operator grants OUT OF PROCESS,
     * either by tapping through `Settings.ACTION_MANAGE_WRITE_SETTINGS`
     * or by a one-shot `adb shell appops set <pkg> WRITE_SETTINGS allow`.
     * Neither restarts us. Without an invalidate on resume the registry
     * kept reporting the pre-grant answer until the process next died,
     * so [SettingsBrightnessProvider] and [ScreenTimeoutBlankProvider]
     * were effectively unreachable in the field. resolve() is a handful
     * of stats and one canWrite() call, so re-running it per resume is
     * cheap.
     */
    fun invalidate() {
        resolvedCache = null
        SysfsBacklightProvider.invalidate()
    }

    /** Provider id reported when the emergency interlock refuses an action. */
    const val EMERGENCY_HOLD_ID = "emergency-hold"
}
