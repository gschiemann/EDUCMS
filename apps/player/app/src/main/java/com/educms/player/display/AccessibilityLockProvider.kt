package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * BLANK/WAKE through [SleepAccessibilityService] — a real sleep, the power
 * key's own path, for boxes with no device admin. Sits AFTER the device-admin
 * tier and BEFORE the screen-timeout one.
 *
 * Same honesty and safety rules as [DeviceAdminBlankProvider]:
 *  • declines unless the service is actually bound (a person turned it on);
 *  • declines on a box with a SECURE screen lock — the lock action engages
 *    the keyguard, and a PIN keyguard cannot be dismissed remotely;
 *  • WAKE is the device-admin wake: window flags + a wake lock that needs no
 *    window ([ScreenWakeLock.pokeScreen]).
 *
 * Like every native blank it is reached only through
 * [DisplayControlRegistry.apply], so the emergency interlock refuses it
 * during an alert. The dashboard's POWER_OFF stays refused on it until a
 * supervised on-site round trip proves it per model (API types:
 * `DISPLAY_POWER_UNPROVEN_MECHANISMS`).
 */
object AccessibilityLockProvider : DisplayControlProvider {

    private const val TAG = "A11yLockBlank"

    override val id: String = "accessibility-lock"

    override fun supports(ctx: Context): Set<Capability> = when {
        !SleepAccessibilityService.isConnected() -> emptySet()
        DeviceAdminBlankProvider.secureKeyguardBlocks(ctx) -> emptySet()
        else -> setOf(Capability.BLANK, Capability.WAKE)
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult = when (action) {
        DisplayAction.Blank -> blank(ctx)
        DisplayAction.Wake -> wake(ctx)
        else -> ActionResult.Unsupported("accessibility-lock only handles blank/wake")
    }

    private fun blank(ctx: Context): ActionResult {
        if (!SleepAccessibilityService.isConnected()) {
            return ActionResult.Unsupported("the VenueOS sleep accessibility service is not turned on")
        }
        if (DeviceAdminBlankProvider.secureKeyguardBlocks(ctx)) {
            return ActionResult.Unsupported("a secure screen lock is set — the panel would wake to a keyguard")
        }
        // A window holding KEEP_SCREEN_ON is released first, exactly as
        // before a device-admin lockNow().
        DisplayWindowBridge.withHooks { it.setKeepScreenOn(false) }
        return if (SleepAccessibilityService.lockScreen()) {
            PlayerLogger.i(TAG, "lock-screen action — panel sleeping via $id")
            ActionResult.Ok(id)
        } else {
            DisplayWindowBridge.withHooks { it.setKeepScreenOn(true) }
            ActionResult.Failed("the system refused the lock-screen action", id)
        }
    }

    private fun wake(ctx: Context): ActionResult {
        val attached = DisplayWindowBridge.withHooks { h ->
            h.setBlackout(false)
            h.setKeepScreenOn(true)
            h.requestWake()
        }
        ScreenWakeLock.pokeScreen(ctx)
        return ActionResult.Ok(id, if (attached) null else "deferred — no window attached")
    }
}
