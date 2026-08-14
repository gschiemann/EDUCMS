package com.educms.player.display

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import com.educms.player.logging.PlayerLogger
import java.io.File

/**
 * Whether a broadcast action has an installed receiver — and whether the
 * answer can be trusted.
 *
 * [UNKNOWN] exists because Android 11+ package-visibility filtering makes
 * an empty `queryBroadcastReceivers` result ambiguous. Treating that as
 * ABSENT would silently demote every real vendor recipe on a modern box;
 * treating ABSENT as UNKNOWN would keep the fleet-wide brick. The two
 * cases have to stay distinguishable.
 */
internal enum class BroadcastPresence { PRESENT, ABSENT, UNKNOWN }

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

    /**
     * ⚠️ HONEST, NOT DECLARATIVE.
     *
     * This used to return `recipe.declaredCapabilities()` — i.e. it
     * believed a DB row. Combined with the registry binding BLANK/WAKE to
     * the FIRST provider that claims them and never falling through, one
     * mis-typed vendor action (a typo, a firmware revision, a bring-up
     * guess — the expected state for a feature whose whole point is "a
     * new vendor is a DB row") disabled WAKE on every matching SKU. An
     * implicit broadcast with no receiver is a SILENT NO-OP on Android:
     * it does not throw, so every layer reported success while a
     * wall-mounted screen stayed dark. Contract C4's named worst outcome.
     *
     * So a BROADCAST step only counts as support when a receiver for it
     * actually exists AND we can see the whole package list
     * ([broadcastPresence]). Sysfs and settings steps are unaffected —
     * both are re-validated and their failures are real exceptions.
     */
    override fun supports(ctx: Context): Set<Capability> {
        val recipe = activeRecipe(ctx) ?: return emptySet()
        // blank and wake almost always share ONE action (a vendor
        // SET_POWER with state=0/1), and the registry asks this once per
        // chain — so memoise per call rather than paying a binder round
        // trip for the same string three times.
        val seen = HashMap<String, BroadcastPresence>()
        return recipe.declaredCapabilities().filterTo(mutableSetOf()) { capability ->
            val step = recipe.stepFor(capability)
            if (step !is RecipeStep.Broadcast) {
                true
            } else {
                val presence = seen.getOrPut(step.action) { broadcastPresence(ctx, step.action) }
                if (presence == BroadcastPresence.ABSENT) {
                    PlayerLogger.w(
                        TAG,
                        "recipe '${recipe.vendorId}' declares $capability via ${step.action} but NO receiver " +
                            "is installed — not claiming it; the chain falls through to a generic mechanism",
                    )
                    false
                } else {
                    true
                }
            }
        }
    }

    /**
     * Can we see a receiver for this action, and can we trust the answer?
     *
     * Android 11+ package-visibility filtering means an empty result is
     * only conclusive when we can enumerate everything — below API 30 (no
     * filtering) or with `QUERY_ALL_PACKAGES` (the debug build). This is
     * the same precise test [DisplayCapabilityProbe.vendorPackages] uses
     * for its `enumerable` field, deliberately rather than a heuristic:
     * treating a FILTERED empty list as "no receiver" would silently
     * demote every real vendor recipe on modern boxes.
     */
    internal fun broadcastPresence(ctx: Context, action: String): BroadcastPresence = try {
        val app = ctx.applicationContext
        val pm = app.packageManager
        val receivers = pm.queryBroadcastReceivers(Intent(action), 0)
        when {
            receivers.isNotEmpty() -> BroadcastPresence.PRESENT
            visibilityIsComplete(app) -> BroadcastPresence.ABSENT
            else -> BroadcastPresence.UNKNOWN
        }
    } catch (t: Throwable) {
        // Never let a PackageManager hiccup demote a working recipe.
        PlayerLogger.w(TAG, "receiver lookup for '$action' failed: ${t.message}")
        BroadcastPresence.UNKNOWN
    }

    private fun visibilityIsComplete(ctx: Context): Boolean = try {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
            ctx.checkSelfPermission("android.permission.QUERY_ALL_PACKAGES") ==
            PackageManager.PERMISSION_GRANTED
    } catch (t: Throwable) {
        false
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
     * This box's recipe from the persisted `display` block's CATALOG, or
     * null.
     *
     * The manifest ships every tenant's recipes to every screen and the
     * DEVICE picks — see [DisplayConfig.matchingRecipe] for the selection
     * rule and `DisplayConfigParser`'s header for why the catalog shape is
     * the wire contract. Re-parsed and re-validated by [DisplayConfigStore]
     * on every load; a recipe that fails validation is dropped whole, so
     * this returns null rather than a half-usable object.
     */
    internal fun activeRecipe(ctx: Context): VendorRecipe? =
        DisplayConfigStore.load(ctx).matchingRecipe(Build.MANUFACTURER, Build.MODEL, Build.BOARD)

    // ─── executors ──────────────────────────────────────────────────

    private fun sendBroadcast(
        ctx: Context,
        vendorId: String,
        step: RecipeStep.Broadcast,
        percent: Int,
        floorScaleMin: Boolean,
    ): ActionResult {
        // ⚠️ AN UNHANDLED BROADCAST IS A FAILURE, NOT A SUCCESS.
        // `sendBroadcast` of an implicit intent with no matching receiver
        // is a silent no-op on Android — it does not throw. Returning Ok
        // for it is what let one mis-typed action string in one DB row
        // report "Wake succeeded" while a wall-mounted panel stayed dark
        // forever. Failing here is what makes the registry's BLANK/WAKE
        // fall-through reach the generic mechanism underneath.
        //
        // Only a CONCLUSIVE absence fails: on Android 11+ without
        // QUERY_ALL_PACKAGES an empty result may just be package-visibility
        // filtering, and demoting a working vendor recipe on that evidence
        // would be the same over-claim in the other direction.
        if (broadcastPresence(ctx, step.action) == BroadcastPresence.ABSENT) {
            PlayerLogger.e(
                TAG,
                "recipe '$vendorId' broadcast ${step.action} has NO installed receiver — " +
                    "refusing so the chain can fall through instead of silently doing nothing",
            )
            return ActionResult.Failed("no installed receiver for broadcast '${step.action}'", id)
        }
        return sendBroadcastNow(ctx, vendorId, step, percent, floorScaleMin)
    }

    private fun sendBroadcastNow(
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
