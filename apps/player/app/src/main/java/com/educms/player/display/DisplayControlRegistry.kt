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
 * BLANK / WAKE VendorRecipe → DeviceAdminBlank → SoftwareDim
 * VOLUME       AudioManager
 * REBOOT       DeviceOwnerReboot          (device owner only — no fallback exists)
 * ```
 *
 * BRIGHTNESS and BLANK/WAKE ALWAYS resolve, because SoftwareDim is an
 * unconditional floor. VOLUME resolves on every box with an
 * AudioManager. REBOOT frequently resolves to NOTHING, and that is the
 * correct outcome — [capabilities] then omits it and the dashboard must
 * not render the button.
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
            SoftwareDimProvider,
        ),
        Capability.WAKE to listOf(
            VendorRecipeProvider,
            DeviceAdminBlankProvider,
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

        if (result.ok) {
            recordState(app, action)
            if (revertAfterMs != null) DisplayGuard.scheduleRevertAlarm(app)
        }
        // NOTE: a failed apply deliberately LEAVES the pending record in
        // place. Reverting to the prior state is a no-op when nothing
        // changed, and is exactly right when the provider changed
        // something before it threw. Clearing here would trade a
        // harmless no-op for a permanently dark screen.
        return result
    }

    /** Mirror what is now on the panel so a later revert has a target. */
    private fun recordState(ctx: Context, action: DisplayAction) {
        when (action) {
            is DisplayAction.SetBrightness -> {
                DisplayPrefs.setBrightnessPercent(ctx, action.percent)
                if (action.percent > 0) DisplayPrefs.setBlanked(ctx, false)
            }
            is DisplayAction.SetVolume -> DisplayPrefs.setVolumePercent(ctx, action.percent)
            DisplayAction.Blank -> DisplayPrefs.setBlanked(ctx, true)
            DisplayAction.Wake -> DisplayPrefs.setBlanked(ctx, false)
            DisplayAction.Reboot -> Unit
        }
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
     * Drop the resolution cache. Called when the vendor recipe changes
     * (a new recipe can move BRIGHTNESS from software-dim to a real
     * mechanism) and after a sysfs write fails with EACCES.
     */
    fun invalidate() {
        resolvedCache = null
        SysfsBacklightProvider.invalidate()
    }
}
