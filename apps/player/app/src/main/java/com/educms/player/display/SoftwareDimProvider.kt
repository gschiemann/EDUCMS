package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * The always-available floor. Every box has a Window, so BRIGHTNESS,
 * BLANK and WAKE ALWAYS resolve to something even on a locked-down OEM
 * ROM that exposes no backlight node, no Settings write and no admin.
 *
 * ⚠️ WHAT IT ACTUALLY DOES — and what the dashboard must SAY it does.
 * This dims COMPOSITION, not the panel: on an LCD the backlight stays
 * lit, so there is no power saving and a fully "blanked" screen is a
 * black image, not an off screen. On an emissive LED wall it genuinely
 * reduces light output. The dashboard is required to surface this
 * honestly ("dims the image only — this box exposes no backlight
 * control") rather than pretending it is a real backlight control; that
 * is why [DisplayControlRegistry.capabilities] reports the resolved
 * provider id per capability instead of a bare boolean.
 *
 * It NEVER fails. When no Activity window is attached (a scheduled blank
 * that fires while the process is up but the Activity is dead) the
 * desired state is still persisted and re-applied on the next window
 * attach, so the result is Ok-with-detail rather than Failed — a
 * failure here would make the registry look for a fallback that does
 * not exist.
 */
object SoftwareDimProvider : DisplayControlProvider {

    private const val TAG = "SoftwareDim"

    override val id: String = "software-dim"

    override fun supports(ctx: Context): Set<Capability> =
        setOf(Capability.BRIGHTNESS, Capability.BLANK, Capability.WAKE)

    override fun apply(ctx: Context, action: DisplayAction): ActionResult = when (action) {
        is DisplayAction.SetBrightness -> {
            val attached = DisplayWindowBridge.withHooks { h ->
                // A blanked screen that is handed a brightness change is
                // being un-blanked by the operator's intent.
                if (action.percent > 0) h.setBlackout(false)
                h.setWindowBrightness(action.percent / 100f)
            }
            PlayerLogger.i(TAG, "brightness ${action.percent}% (window ${if (attached) "attached" else "detached"})")
            ActionResult.Ok(id, if (attached) null else "deferred — no window attached")
        }

        DisplayAction.Blank -> {
            val attached = DisplayWindowBridge.withHooks { h ->
                // KEEP_SCREEN_ON must go first or the compositor keeps
                // the panel lit behind the overlay on some ROMs.
                h.setKeepScreenOn(false)
                h.setWindowBrightness(0f)
                h.setBlackout(true)
            }
            PlayerLogger.i(TAG, "blank (window ${if (attached) "attached" else "detached"})")
            ActionResult.Ok(id, if (attached) null else "deferred — no window attached")
        }

        DisplayAction.Wake -> {
            val restore = DisplayPrefs.brightnessPercent(ctx).coerceAtLeast(DisplayLimits.MIN_SAFE_BRIGHTNESS)
            val attached = DisplayWindowBridge.withHooks { h ->
                h.setBlackout(false)
                h.setKeepScreenOn(true)
                h.setWindowBrightness(restore / 100f)
                h.requestWake()
            }
            PlayerLogger.i(TAG, "wake → ${restore}% (window ${if (attached) "attached" else "detached"})")
            ActionResult.Ok(id, if (attached) null else "deferred — no window attached")
        }

        is DisplayAction.SetVolume -> ActionResult.Unsupported("software-dim does not control volume")
        DisplayAction.Reboot -> ActionResult.Unsupported("software-dim cannot reboot")
    }
}
