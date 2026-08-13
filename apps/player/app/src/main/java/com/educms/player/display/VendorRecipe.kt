package com.educms.player.display

import java.io.File

/**
 * Data-driven vendor display support: adding a new signage vendor is a
 * DB row, not an APK release.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️  THE RECIPE IS UNTRUSTED INPUT. THIS FILE IS THE SECURITY BOUNDARY
 *     OF THE ENTIRE DISPLAY-CONTROL FEATURE.
 * ═════════════════════════════════════════════════════════════════════
 *
 * A recipe tells the player to FIRE BROADCASTS and WRITE SYSFS on a
 * device that is often a device-owner-provisioned kiosk. It arrives over
 * the authenticated device channel and is cached to prefs — which means
 * it can also arrive from:
 *
 *   * a compromised or mis-configured control plane,
 *   * a stale prefs blob written by an OLDER build with weaker rules,
 *   * anything that reaches the JS bridge (per WebAppBridge's header the
 *     legacy `addJavascriptInterface` surface is exposed to EVERY frame
 *     the WebView loads, including operator-authored board HTML).
 *
 * So the allowlist below is NATIVE and no recipe can widen it:
 *
 *   1. **sysfs** — the path must canonicalize (symlinks resolved, `..`
 *      collapsed) to something strictly UNDER `/sys/class/backlight/` or
 *      `/sys/class/leds/`. Nothing else, ever. `..` is additionally
 *      refused before canonicalization as defence in depth.
 *   2. **broadcast** — the action must start with an allowlisted VENDOR
 *      prefix. `android.*` is deliberately absent: `android.intent.action`
 *      contains MASTER_CLEAR, FACTORY_RESET and ACTION_SHUTDOWN. There is
 *      no field for an explicit component or package, and the executor
 *      never calls setPackage()/setComponent(), so a recipe cannot
 *      target a specific privileged receiver. Extras are limited to the
 *      three typed forms below.
 *   3. **settings** — writes are confined to the `Settings.System`
 *      namespace. Never Secure, never Global (Global holds
 *      adb_enabled, device_provisioned, airplane_mode_on…).
 *   4. **no shell execution of any kind.** There is no `exec` kind, and
 *      no code in this package calls Runtime.exec / ProcessBuilder.
 *      (The sibling SerialPortBridge learned this the hard way — see its
 *      AND-003 note; it now execs an argv array, never `sh -c`.)
 *
 * A recipe that fails ANY check is REJECTED WHOLE and logged. It is
 * never partially applied — [RecipeParser.parse] only ever hands back a
 * fully-validated immutable object, and [RecipeValidator.validate] is
 * re-run at LOAD time and again at EXECUTION time so a blob persisted by
 * an older build can never be honoured (the same "re-check at the point
 * of use" pattern the OTA host allowlist uses).
 *
 * Everything in this file is pure Kotlin — no `android.*` import — so
 * the adversarial tests in `app/src/test` run on a plain JVM and can
 * never be skipped for want of an emulator.
 */

// ─────────────────────────────────────────────────────────────────────
// model
// ─────────────────────────────────────────────────────────────────────

enum class RecipeExtraType { INT, STRING, BOOL }

/** Where an extra's / a value's content comes from. */
enum class RecipeValueSource { PERCENT, LITERAL }

/** Inclusive device scale a 0..100 percent is mapped onto. */
data class RecipeScale(val min: Int, val max: Int)

data class RecipeExtra(
    val key: String,
    val type: RecipeExtraType,
    val from: RecipeValueSource,
    val literal: String? = null,
    val scale: RecipeScale? = null,
)

sealed class RecipeStep {

    /**
     * `{action, extras:[…]}` — an implicit broadcast to a vendor control
     * service. No component, no package: implicit only.
     */
    data class Broadcast(
        val action: String,
        val extras: List<RecipeExtra>,
    ) : RecipeStep()

    /** `{path, value | valueFrom:"percent", scale?}` */
    data class Sysfs(
        val path: String,
        val literal: String?,
        val fromPercent: Boolean,
        val scale: RecipeScale?,
    ) : RecipeStep()

    /** `{key, valueFrom:"percent", scale?}` — Settings.System only. */
    data class SettingsWrite(
        val key: String,
        val scale: RecipeScale?,
    ) : RecipeStep()

    val kind: String
        get() = when (this) {
            is Broadcast -> "broadcast"
            is Sysfs -> "sysfs"
            is SettingsWrite -> "settings"
        }
}

data class RecipeMatch(
    val manufacturer: String? = null,
    val model: String? = null,
    val board: String? = null,
) {
    /**
     * Case-insensitive exact match on every field that is PRESENT. An
     * all-null match matches every device — intentional, that is how a
     * "this is the only box we ship" tenant configures one recipe.
     */
    fun matches(manufacturer: String, model: String, board: String): Boolean {
        if (this.manufacturer != null && !this.manufacturer.equals(manufacturer, ignoreCase = true)) return false
        if (this.model != null && !this.model.equals(model, ignoreCase = true)) return false
        if (this.board != null && !this.board.equals(board, ignoreCase = true)) return false
        return true
    }
}

data class VendorRecipe(
    val vendorId: String,
    val match: RecipeMatch,
    val brightness: RecipeStep? = null,
    val blank: RecipeStep? = null,
    val wake: RecipeStep? = null,
) {
    fun stepFor(capability: Capability): RecipeStep? = when (capability) {
        Capability.BRIGHTNESS -> brightness
        Capability.BLANK -> blank
        Capability.WAKE -> wake
        else -> null
    }

    fun declaredCapabilities(): Set<Capability> {
        val out = mutableSetOf<Capability>()
        if (brightness != null) out += Capability.BRIGHTNESS
        if (blank != null) out += Capability.BLANK
        if (wake != null) out += Capability.WAKE
        return out
    }
}

// ─────────────────────────────────────────────────────────────────────
// the allowlist
// ─────────────────────────────────────────────────────────────────────

object RecipeAllowlist {

    /**
     * The ONLY filesystem roots a recipe may write to. Trailing slash is
     * load-bearing: it makes `/sys/class/backlightEVIL` fail the prefix
     * test, and it makes the root DIRECTORY itself (`/sys/class/leds`)
     * non-writable — only nodes strictly beneath it qualify.
     */
    val SYSFS_ROOTS: List<String> = listOf(
        "/sys/class/backlight/",
        "/sys/class/leds/",
    )

    /**
     * Vendor namespaces a broadcast action may live in.
     *
     * `android.` and `com.android.` are deliberately ABSENT. So are bare
     * top-level namespaces — every entry ends in a dot so that
     * `com.tcl.` cannot be satisfied by `com.tclEVIL.doSomething`.
     */
    val BROADCAST_PREFIXES: List<String> = listOf(
        "com.gv.",
        "com.goodview.",
        "com.good_view.",
        "com.novastar.",
        "com.nova.",
        "com.xixun.",
        "com.tcl.",
        "com.tclking.",
        "com.rockchip.",
        "com.amlogic.",
        "com.allwinner.",
        "com.mstar.",
        "com.hisense.",
        "com.philips.",
        "com.samsung.signage.",
        "com.lg.signage.",
        // Our own namespace, for bench tests and for a Manager-side
        // receiver if BLANK/REBOOT ever move there (see the objection
        // recorded in DeviceAdminBlankProvider).
        "com.educms.display.",
    )

    const val MAX_PATH_LEN = 256
    const val MAX_ACTION_LEN = 128
    const val MAX_KEY_LEN = 64
    const val MAX_LITERAL_LEN = 128
    const val MAX_EXTRAS = 8
    const val MAX_MATCH_LEN = 128
    const val MAX_VENDOR_ID_LEN = 64

    /** Widest device scale we will accept. Guards against overflow. */
    const val MAX_SCALE_VALUE = 1_000_000

    private val VENDOR_ID_RE = Regex("^[A-Za-z0-9_.-]{1,$MAX_VENDOR_ID_LEN}$")
    private val ACTION_RE = Regex("^[A-Za-z0-9_.]{1,$MAX_ACTION_LEN}$")
    private val EXTRA_KEY_RE = Regex("^[A-Za-z0-9_.]{1,$MAX_KEY_LEN}$")
    private val SETTINGS_KEY_RE = Regex("^[A-Za-z0-9_]{1,$MAX_KEY_LEN}$")
    private val MATCH_RE = Regex("^[A-Za-z0-9 ._+()\\-/]{1,$MAX_MATCH_LEN}$")

    fun isVendorId(s: String) = VENDOR_ID_RE.matches(s)
    fun isBroadcastActionShape(s: String) = ACTION_RE.matches(s)
    fun isExtraKey(s: String) = EXTRA_KEY_RE.matches(s)
    fun isSettingsKey(s: String) = SETTINGS_KEY_RE.matches(s)
    fun isMatchToken(s: String) = MATCH_RE.matches(s)

    fun hasAllowedBroadcastPrefix(action: String) = BROADCAST_PREFIXES.any { action.startsWith(it) }

    /**
     * THE sysfs gate. Returns the canonical path when the target is
     * provably under an allowlisted root, or null when it is not.
     *
     * Rejects, in order: blank, over-length, any whitespace or control
     * byte (see [hasUnsafeChar] — a smuggled newline could split a log
     * line or a shell-ish consumer downstream, and no real sysfs node
     * name contains a space), non-absolute, any literal `..` segment, a
     * canonicalization that throws, and finally anything whose CANONICAL
     * form is not strictly beneath a root. The literal `..` check is
     * redundant with canonicalization by design: if a future JVM or a
     * hostile filesystem layout ever made canonicalPath lenient, the
     * cheap textual check still holds the line.
     */
    fun canonicalSysfsPath(raw: String): String? {
        val path = raw.trim()
        if (path.isEmpty() || path.length > MAX_PATH_LEN) return null
        if (hasUnsafeChar(path)) return null
        if (!path.startsWith("/")) return null
        // Any `..` segment, in any position.
        if (path.split('/').any { it == ".." }) return null

        val canonical = try {
            File(path).canonicalPath
        } catch (t: Throwable) {
            return null
        }
        if (canonical.length > MAX_PATH_LEN) return null

        val underRoot = SYSFS_ROOTS.any { root ->
            canonical.startsWith(root) && canonical.length > root.length
        }
        return if (underRoot) canonical else null
    }

    /**
     * True when [s] contains any byte that has no business in a device
     * path, an intent action, or a literal value: ASCII space, tab, NUL,
     * CR, LF, DEL, every other C0 control byte, and Unicode whitespace
     * such as NBSP.
     *
     * Written with `isWhitespace()` and codepoint comparisons rather
     * than a list of character literals ON PURPOSE. The first version of
     * this check was `it == ' ' || it == '\n' || it == '\r'`, and the
     * space literal reached disk as a raw NUL byte — so the compiled
     * check tested `it == <NUL>` and let
     * `/sys/class/backlight/panel0/bright ness` straight through. It
     * compiled clean and only the adversarial unit test caught it. Same
     * shape as the 2026-05-09 Safari bug in CLAUDE.md, where a literal
     * LF byte inside a regex literal killed the whole holiday bridge in
     * WebKit for two months. Do not reintroduce character literals here.
     */
    fun hasUnsafeChar(s: String): Boolean =
        s.any { it.isWhitespace() || it.code < 0x20 || it.code == 0x7F }

    fun isScale(scale: RecipeScale?): Boolean {
        val s = scale ?: return true
        if (s.min < 0 || s.max <= s.min) return false
        if (s.max > MAX_SCALE_VALUE) return false
        return true
    }
}

// ─────────────────────────────────────────────────────────────────────
// validation
// ─────────────────────────────────────────────────────────────────────

sealed class RecipeCheck {
    data class Valid(val recipe: VendorRecipe) : RecipeCheck()
    data class Rejected(val reason: String) : RecipeCheck()

    val valid: Boolean get() = this is Valid
    fun recipeOrNull(): VendorRecipe? = (this as? Valid)?.recipe
}

object RecipeValidator {

    /**
     * Validate a whole recipe. ANY failure rejects the WHOLE recipe —
     * we never keep the "good half", because a recipe whose blank step
     * was dropped is a screen that turns off and never comes back on.
     */
    fun validate(recipe: VendorRecipe): RecipeCheck {
        if (!RecipeAllowlist.isVendorId(recipe.vendorId)) {
            return RecipeCheck.Rejected("vendorId is not a safe identifier")
        }
        recipe.match.manufacturer?.let {
            if (!RecipeAllowlist.isMatchToken(it)) return RecipeCheck.Rejected("match.manufacturer has illegal characters")
        }
        recipe.match.model?.let {
            if (!RecipeAllowlist.isMatchToken(it)) return RecipeCheck.Rejected("match.model has illegal characters")
        }
        recipe.match.board?.let {
            if (!RecipeAllowlist.isMatchToken(it)) return RecipeCheck.Rejected("match.board has illegal characters")
        }

        val steps = listOf(
            "brightness" to recipe.brightness,
            "blank" to recipe.blank,
            "wake" to recipe.wake,
        )
        if (steps.all { it.second == null }) {
            return RecipeCheck.Rejected("recipe declares no brightness/blank/wake step")
        }
        steps.forEach { (name, step) ->
            if (step != null) {
                val why = validateStep(step)
                if (why != null) return RecipeCheck.Rejected("$name: $why")
            }
        }
        return RecipeCheck.Valid(recipe)
    }

    /** Returns null when the step is acceptable, else the rejection reason. */
    fun validateStep(step: RecipeStep): String? = when (step) {
        is RecipeStep.Broadcast -> validateBroadcast(step)
        is RecipeStep.Sysfs -> validateSysfs(step)
        is RecipeStep.SettingsWrite -> validateSettings(step)
    }

    private fun validateBroadcast(step: RecipeStep.Broadcast): String? {
        val action = step.action
        if (!RecipeAllowlist.isBroadcastActionShape(action)) {
            return "broadcast action is empty, over-long, or has illegal characters"
        }
        if (action.contains("..")) return "broadcast action contains '..'"
        if (!RecipeAllowlist.hasAllowedBroadcastPrefix(action)) {
            return "broadcast action '$action' is not in an allowlisted vendor namespace"
        }
        if (step.extras.size > RecipeAllowlist.MAX_EXTRAS) {
            return "too many extras (${step.extras.size} > ${RecipeAllowlist.MAX_EXTRAS})"
        }
        val seen = HashSet<String>()
        step.extras.forEach { extra ->
            if (!RecipeAllowlist.isExtraKey(extra.key)) return "extra key '${extra.key}' is not a safe identifier"
            if (!seen.add(extra.key)) return "duplicate extra key '${extra.key}'"
            if (!RecipeAllowlist.isScale(extra.scale)) return "extra '${extra.key}' has an invalid scale"
            when (extra.from) {
                RecipeValueSource.LITERAL -> {
                    val lit = extra.literal ?: return "extra '${extra.key}' is literal but carries no value"
                    if (lit.length > RecipeAllowlist.MAX_LITERAL_LEN) return "extra '${extra.key}' literal is over-long"
                    if (RecipeAllowlist.hasUnsafeChar(lit)) {
                        return "extra '${extra.key}' literal contains control bytes"
                    }
                    when (extra.type) {
                        RecipeExtraType.INT ->
                            if (lit.trim().toIntOrNull() == null) return "extra '${extra.key}' is int but literal is not an integer"
                        RecipeExtraType.BOOL ->
                            if (lit.trim().lowercase() !in setOf("true", "false")) {
                                return "extra '${extra.key}' is bool but literal is not true/false"
                            }
                        RecipeExtraType.STRING -> Unit
                    }
                }
                RecipeValueSource.PERCENT -> {
                    // A percent is a number. Handing it to a bool extra is
                    // always a config error, and silently coercing it is
                    // how a "set 0% brightness" becomes "power off".
                    if (extra.type == RecipeExtraType.BOOL) {
                        return "extra '${extra.key}' cannot take a percent as a boolean"
                    }
                }
            }
        }
        return null
    }

    private fun validateSysfs(step: RecipeStep.Sysfs): String? {
        val canonical = RecipeAllowlist.canonicalSysfsPath(step.path)
            ?: return "sysfs path '${step.path.take(64)}' is not under ${RecipeAllowlist.SYSFS_ROOTS.joinToString(" or ")}"
        if (canonical.isEmpty()) return "sysfs path canonicalized to nothing"
        if (!RecipeAllowlist.isScale(step.scale)) return "sysfs scale is invalid"
        if (!step.fromPercent) {
            val lit = step.literal ?: return "sysfs step has neither a literal value nor valueFrom:percent"
            if (lit.isEmpty() || lit.length > RecipeAllowlist.MAX_LITERAL_LEN) return "sysfs literal is empty or over-long"
            if (RecipeAllowlist.hasUnsafeChar(lit)) return "sysfs literal contains control bytes"
        }
        return null
    }

    private fun validateSettings(step: RecipeStep.SettingsWrite): String? {
        if (!RecipeAllowlist.isSettingsKey(step.key)) {
            return "settings key '${step.key.take(32)}' is not a safe Settings.System identifier"
        }
        if (!RecipeAllowlist.isScale(step.scale)) return "settings scale is invalid"
        return null
    }
}
