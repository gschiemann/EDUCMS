package com.educms.player.display

import android.content.Context

/**
 * The WRITE half of the display-control layer — the mirror image of
 * [DisplayCapabilityProbe], which is deliberately read-only.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY A PROVIDER STACK AND NOT A VENDOR SDK
 * ─────────────────────────────────────────────────────────────────────
 * We control screen volume / brightness / blank / wake / reboot across
 * Goodview, NovaStar Taurus, TCL and whatever Android signage SoC comes
 * next, WITHOUT holding a per-vendor SDK. Every capability is resolved
 * at runtime to the best mechanism this particular box actually exposes,
 * tried in a fixed priority order (see [DisplayControlRegistry]). A box
 * that exposes nothing still resolves BRIGHTNESS and BLANK, because
 * [SoftwareDimProvider] is an always-available floor.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️  THE SAFETY PREMISE: THIS SCREEN IS BOLTED TO A WALL
 * ─────────────────────────────────────────────────────────────────────
 * Every remote action here can black out a display nobody can reach
 * without a ladder and a truck roll. Three rules are non-negotiable and
 * are enforced in code, not in comments:
 *
 *   1. [DisplayLimits.MIN_SAFE_BRIGHTNESS] — a remote SetBrightness
 *      below the floor is CLAMPED unless the action explicitly carries
 *      `allowBlack=true`.
 *   2. Dead-man revert — an action carrying `revertAfterMs` snapshots
 *      the prior state, PERSISTS the revert record with `commit()`
 *      BEFORE applying, and replays it on next process start. Operator
 *      TEST actions always carry one; scheduled actions never do.
 *   3. Every apply() is logged with the resolved provider id, so a
 *      dark screen has a forensic trail.
 */
enum class Capability {
    VOLUME,
    BRIGHTNESS,
    BLANK,
    WAKE,
    REBOOT,
}

/**
 * One remote instruction. `percent` values are ALWAYS 0..100 in this
 * type — every device-specific scale (0..255 Settings, 0..max_brightness
 * sysfs, 0..getStreamMaxVolume) is applied inside the provider, never at
 * the wire boundary.
 */
sealed class DisplayAction {

    /** 0..100. Clamped by [DisplayLimits.clampVolume]. */
    data class SetVolume(val percent: Int) : DisplayAction()

    /**
     * 0..100. Clamped UP to [DisplayLimits.MIN_SAFE_BRIGHTNESS] unless
     * [allowBlack]. `allowBlack` exists for the deliberate
     * "turn this poster off overnight" case; it must never be the
     * default, and the dashboard must never send it implicitly.
     */
    data class SetBrightness(
        val percent: Int,
        val allowBlack: Boolean = false,
    ) : DisplayAction()

    object Blank : DisplayAction()

    object Wake : DisplayAction()

    object Reboot : DisplayAction()

    /** Which capability this action needs a provider for. */
    val capability: Capability
        get() = when (this) {
            is SetVolume -> Capability.VOLUME
            is SetBrightness -> Capability.BRIGHTNESS
            Blank -> Capability.BLANK
            Wake -> Capability.WAKE
            Reboot -> Capability.REBOOT
        }

    /** Short, log-safe description. Never includes anything secret. */
    fun describe(): String = when (this) {
        is SetVolume -> "SetVolume($percent%)"
        is SetBrightness -> "SetBrightness($percent%${if (allowBlack) ", allowBlack" else ""})"
        Blank -> "Blank"
        Wake -> "Wake"
        Reboot -> "Reboot"
    }
}

/**
 * Outcome of one apply. `Unsupported` means "this box cannot do that at
 * all" (the dashboard must not have offered the control); `Failed` means
 * "the mechanism exists but the call did not take" (permission revoked,
 * SELinux denial, vendor app not installed).
 */
sealed class ActionResult {
    data class Ok(val providerId: String, val detail: String? = null) : ActionResult()
    data class Unsupported(val reason: String) : ActionResult()
    data class Failed(val reason: String, val providerId: String? = null) : ActionResult()

    val ok: Boolean get() = this is Ok
}

/**
 * One mechanism for driving the panel. Implementations are stateless
 * singletons; anything they cache is derived from the device, not from
 * the action.
 *
 * [supports] MUST be honest — returning a capability the box cannot
 * actually perform is what produces "Coming soon wearing a real-button
 * costume" in the dashboard, which this repo has a standing rule
 * against. When in doubt, return an empty set and let the chain fall
 * through to the software floor.
 */
interface DisplayControlProvider {
    val id: String

    fun supports(ctx: Context): Set<Capability>

    fun apply(ctx: Context, action: DisplayAction): ActionResult
}

/**
 * Pure clamp math. Deliberately free of any `android.*` reference so it
 * is unit-testable on a plain JVM — the MIN_SAFE floor is the single
 * most safety-critical line in this package and it must have a test that
 * cannot be skipped by an unavailable emulator.
 */
object DisplayLimits {

    /**
     * A remote 0% on an unreachable screen is a truck roll. Anything
     * below this is clamped up unless the caller explicitly opted into
     * blackness.
     */
    const val MIN_SAFE_BRIGHTNESS = 5

    /** Shortest dead-man revert we will honour (1 s). */
    const val MIN_REVERT_MS = 1_000L

    /** Longest dead-man revert we will honour (1 h). */
    const val MAX_REVERT_MS = 60L * 60 * 1000

    fun clampBrightness(percent: Int, allowBlack: Boolean): Int {
        val bounded = percent.coerceIn(0, 100)
        return if (allowBlack) bounded else bounded.coerceAtLeast(MIN_SAFE_BRIGHTNESS)
    }

    fun clampVolume(percent: Int): Int = percent.coerceIn(0, 100)

    fun clampRevertMs(ms: Long): Long = ms.coerceIn(MIN_REVERT_MS, MAX_REVERT_MS)

    /**
     * Map a 0..100 percent onto an arbitrary device scale, rounding to
     * nearest. `min` is returned for 0 and `max` for 100 exactly, so a
     * vendor scale of 1..255 never produces a 0 the panel reads as OFF.
     */
    fun scale(percent: Int, min: Int, max: Int): Int {
        if (max <= min) return min
        val p = percent.coerceIn(0, 100)
        return min + Math.round((max - min) * (p / 100.0)).toInt()
    }

    /**
     * Normalise an action to what we are actually willing to perform.
     * Applied at the registry boundary so EVERY entry point — bridge,
     * scheduler, dead-man revert — gets the same clamp.
     */
    fun normalize(action: DisplayAction): DisplayAction = when (action) {
        is DisplayAction.SetBrightness ->
            DisplayAction.SetBrightness(clampBrightness(action.percent, action.allowBlack), action.allowBlack)
        is DisplayAction.SetVolume ->
            DisplayAction.SetVolume(clampVolume(action.percent))
        else -> action
    }
}
