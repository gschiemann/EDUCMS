package com.educms.player.display

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.educms.player.logging.PlayerLogger
import java.io.File

/**
 * Executes a validated [VendorRecipe] — the top of the BRIGHTNESS and
 * BLANK/WAKE chains, so a vendor-specific mechanism always beats a
 * generic one.
 *
 * ⚠️ EVERY step is re-validated by [RecipeValidator] IMMEDIATELY BEFORE
 * it is executed, even though the recipe was already validated at parse
 * time and again at load time. This is the same "re-check at the point of
 * use" discipline `OtaUpdateWorker` applies to `api_root`: a value
 * persisted by an OLDER build with weaker rules must never be honoured
 * just because it is already in prefs. The cost is a regex match; the
 * thing it prevents is an attacker-authored sysfs write.
 *
 * Explicitly NOT done here, and each omission is load-bearing:
 *   * `intent.setPackage(...)` / `setComponent(...)` — a recipe must not
 *     be able to aim a broadcast at a specific privileged receiver.
 *   * `sendOrderedBroadcast` with a result receiver — no data comes back.
 *   * any permission string on the send — we broadcast in the clear to
 *     whatever vendor service is listening, exactly as the vendor's own
 *     control app would.
 *   * `Runtime.exec` / `ProcessBuilder` — there is no shell path in this
 *     package at all.
 */
object VendorRecipeProvider : DisplayControlProvider {

    private const val TAG = "VendorRecipe"

    override val id: String = "vendor-recipe"

    override fun supports(ctx: Context): Set<Capability> {
        val recipe = activeRecipe(ctx) ?: return emptySet()
        return recipe.declaredCapabilities()
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        val capability = action.capability
        val recipe = activeRecipe(ctx)
            ?: return ActionResult.Unsupported("no vendor recipe matches this device")
        val step = recipe.stepFor(capability)
            ?: return ActionResult.Unsupported("recipe '${recipe.vendorId}' declares no $capability step")

        // ── point-of-use re-validation ──────────────────────────────
        // The CAPABILITY is passed, not just the step: the rule that a
        // BRIGHTNESS step must be percent-derived is what keeps the
        // MIN_SAFE floor from being bypassed by a literal, and it only
        // exists at this granularity. Re-checking without it would let a
        // blob persisted by an older build slip a literal through here.
        RecipeValidator.validateStep(step, capability)?.let { why ->
            PlayerLogger.e(TAG, "REJECTED at execution — recipe '${recipe.vendorId}' $capability step: $why")
            return ActionResult.Failed("recipe step rejected by the native allowlist: $why", id)
        }

        val percent = when (action) {
            is DisplayAction.SetBrightness -> action.percent
            DisplayAction.Blank -> 0
            DisplayAction.Wake -> 100
            else -> return ActionResult.Unsupported("vendor recipes do not handle ${action.describe()}")
        }
        // Only a BRIGHTNESS action gets the "never write the scale
        // minimum" floor. Blank/wake are SUPPOSED to reach the extremes —
        // that is what they mean.
        val floorScaleMin = when (action) {
            is DisplayAction.SetBrightness -> !action.allowBlack
            else -> false
        }

        return when (step) {
            is RecipeStep.Broadcast -> sendBroadcast(ctx, recipe.vendorId, step, percent, floorScaleMin)
            is RecipeStep.Sysfs -> writeSysfs(recipe.vendorId, step, percent, floorScaleMin)
            is RecipeStep.SettingsWrite -> writeSettings(ctx, recipe.vendorId, step, percent, floorScaleMin)
        }
    }

    /**
     * Map a percent onto a device scale, refusing to land ON the scale
     * minimum unless the caller explicitly allowed black.
     *
     * Mirrors [SysfsBacklightProvider]'s `coerceAtLeast(1)` and
     * [SettingsBrightnessProvider]'s identical floor. On many panels the
     * scale minimum is not "very dim", it is OFF — and on some it latches
     * the backlight driver off until a power cycle, which on a
     * wall-mounted screen is a truck roll.
     */
    private fun scaleWithFloor(percent: Int, min: Int, max: Int, floorScaleMin: Boolean): Int {
        val value = DisplayLimits.scale(percent, min, max)
        return if (floorScaleMin && max > min) value.coerceAtLeast(min + 1) else value
    }

    /**
     * The recipe from the persisted `display` block, IF it matches this
     * device. Re-parsed and re-validated by [DisplayConfigStore]; a
     * recipe that fails validation is dropped whole, so this returns
     * null rather than a half-usable object.
     */
    private fun activeRecipe(ctx: Context): VendorRecipe? {
        val recipe = DisplayConfigStore.load(ctx).recipe ?: return null
        return if (recipe.match.matches(Build.MANUFACTURER, Build.MODEL, Build.BOARD)) recipe else null
    }

    // ─── executors ──────────────────────────────────────────────────

    private fun sendBroadcast(
        ctx: Context,
        vendorId: String,
        step: RecipeStep.Broadcast,
        percent: Int,
        floorScaleMin: Boolean,
    ): ActionResult = try {
        // Implicit intent, action only. No package, no component — see
        // the header for why that is deliberate.
        val intent = Intent(step.action)
        step.extras.forEach { extra ->
            when (extra.from) {
                RecipeValueSource.PERCENT -> {
                    val scale = extra.scale
                    val value = scaleWithFloor(percent, scale?.min ?: 0, scale?.max ?: 100, floorScaleMin)
                    when (extra.type) {
                        RecipeExtraType.INT -> intent.putExtra(extra.key, value)
                        RecipeExtraType.STRING -> intent.putExtra(extra.key, value.toString())
                        // Rejected at validation; unreachable.
                        RecipeExtraType.BOOL -> Unit
                    }
                }
                RecipeValueSource.LITERAL -> {
                    val lit = extra.literal.orEmpty().trim()
                    when (extra.type) {
                        RecipeExtraType.INT -> intent.putExtra(extra.key, lit.toInt())
                        RecipeExtraType.BOOL -> intent.putExtra(extra.key, lit.equals("true", ignoreCase = true))
                        RecipeExtraType.STRING -> intent.putExtra(extra.key, lit)
                    }
                }
            }
        }
        ctx.applicationContext.sendBroadcast(intent)
        PlayerLogger.i(TAG, "recipe '$vendorId' broadcast ${step.action} (${step.extras.size} extras, $percent%)")
        ActionResult.Ok(id, "broadcast ${step.action}")
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "recipe '$vendorId' broadcast failed: ${t.message}")
        ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
    }

    private fun writeSysfs(
        vendorId: String,
        step: RecipeStep.Sysfs,
        percent: Int,
        floorScaleMin: Boolean,
    ): ActionResult {
        // Third gate on the same path: validateStep above proved it is
        // under an allowlisted root; this call gives us the CANONICAL
        // string that we actually open, so we never open the raw one.
        val canonical = RecipeAllowlist.canonicalSysfsPath(step.path)
            ?: return ActionResult.Failed("sysfs path rejected by the native allowlist", id)
        val value = if (step.fromPercent) {
            val scale = step.scale
            scaleWithFloor(percent, scale?.min ?: 0, scale?.max ?: 255, floorScaleMin).toString()
        } else {
            step.literal.orEmpty().trim()
        }
        if (value.isEmpty()) return ActionResult.Failed("recipe produced an empty sysfs value", id)
        return try {
            File(canonical).writeText(value)
            PlayerLogger.i(TAG, "recipe '$vendorId' wrote '$value' → $canonical")
            ActionResult.Ok(id, "sysfs $canonical=$value")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "recipe '$vendorId' sysfs write to $canonical failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    private fun writeSettings(
        ctx: Context,
        vendorId: String,
        step: RecipeStep.SettingsWrite,
        percent: Int,
        floorScaleMin: Boolean,
    ): ActionResult {
        val app = ctx.applicationContext
        if (!SettingsBrightnessProvider.canWrite(app)) {
            return ActionResult.Unsupported("WRITE_SETTINGS not granted — operator must allow it in Settings")
        }
        val scale = step.scale
        val value = scaleWithFloor(percent, scale?.min ?: 0, scale?.max ?: 255, floorScaleMin)
        return try {
            // Settings.System ONLY. Never Secure, never Global — see the
            // allowlist header.
            val wrote = Settings.System.putInt(app.contentResolver, step.key, value)
            if (!wrote) return ActionResult.Failed("Settings.System.putInt('${step.key}') returned false", id)
            PlayerLogger.i(TAG, "recipe '$vendorId' set Settings.System.${step.key}=$value")
            ActionResult.Ok(id, "settings ${step.key}=$value")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "recipe '$vendorId' settings write failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }
}
