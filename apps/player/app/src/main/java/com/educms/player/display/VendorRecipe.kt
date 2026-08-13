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
 *   1. **sysfs** — the CALLER-SUPPLIED path, lexically normalized, must
 *      have exactly the shape `<root><device>/<attribute>` where
 *      `<root>` is `/sys/class/backlight/` or `/sys/class/leds/`.
 *      Nothing else, ever. `..` is refused textually, and symlink
 *      resolution is then applied as DEFENCE IN DEPTH — the resolved
 *      path must land under a class root or under `/sys/devices/`,
 *      which is where every real sysfs class symlink points. See
 *      [RecipeAllowlist.canonicalSysfsPath] for the ordering and for
 *      the 2026-08-13 bug that came from getting it backwards.
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

    /**
     * Where a sysfs class symlink is allowed to RESOLVE to. Every real
     * `/sys/class/<subsystem>/<dev>` entry is a symlink into the device tree, so this is
     * the normal, expected destination — see [canonicalSysfsPath].
     */
    val SYSFS_RESOLVED_ROOTS: List<String> = listOf("/sys/devices/")

    /** Widest device scale we will accept. Guards against overflow. */
    const val MAX_SCALE_VALUE = 1_000_000

    /**
     * Smallest span a BRIGHTNESS scale may have.
     *
     * [DisplayLimits.scale] rounds to nearest, so on a scale of span S
     * the MIN_SAFE floor of 5% maps to `min + round(S * 0.05)`. For that
     * to be strictly above `min` — i.e. for the floor to survive the
     * mapping at all — S must be at least 10. A recipe declaring
     * `scale: [0, 9]` silently turned "5%, the lowest we allow" into
     * `round(0.45)` = 0, which on a real backlight is OFF.
     */
    const val MIN_BRIGHTNESS_SCALE_SPAN = 10

    /** A single sysfs path segment: a device dir or an attribute name. */
    private val SYSFS_SEGMENT_RE = Regex("^[A-Za-z0-9_.:+-]{1,64}$")

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
     * THE sysfs gate. Returns the path we should actually open, or null.
     *
     * ═════════════════════════════════════════════════════════════════
     * ⚠️  THE 2026-08-13 BUG: THIS GATE REJECTED EVERY REAL BACKLIGHT
     * ═════════════════════════════════════════════════════════════════
     * v1 canonicalized first and then required the CANONICAL path to sit
     * under `/sys/class/backlight/` or `/sys/class/leds/`. But on every
     * Linux/Android kernel since 2.6.27 a `/sys/class/<subsystem>/<dev>` entry IS a
     * symlink into the device tree:
     *
     *     /sys/class/backlight/panel0
     *         -> ../../devices/platform/soc/backlight/panel0
     *
     * so `File.canonicalPath` resolved it to `/sys/devices/platform/...`
     * and the containment test failed. Every real path was rejected:
     * [SysfsBacklightProvider] found no node on ANY device, and every
     * `kind:"sysfs"` recipe was refused whole, so BRIGHTNESS fell all
     * the way to software dim fleet-wide. The unit test did not catch it
     * because `/sys` does not exist on the build host, where
     * `canonicalPath` degrades to lexical normalization — this repo's
     * own "green CI is not proof" trap.
     *
     * ─────────────────────────────────────────────────────────────────
     * THE GATE, IN ORDER (the shape test is on the CALLER-SUPPLIED path;
     * symlink resolution is kept as defence in depth, not as the gate)
     * ─────────────────────────────────────────────────────────────────
     *  1. blank / over-length → reject.
     *  2. any whitespace or control byte ([hasUnsafeChar]) → reject. A
     *     smuggled newline could split a log line, and no real sysfs
     *     node name contains a space.
     *  3. not absolute → reject.
     *  4. LEXICAL normalization: drop `.` and empty segments, and refuse
     *     ANY `..` segment textually. Nothing is resolved, so no
     *     filesystem layout can influence step 5.
     *  5. the normalized path must be exactly
     *     `<allowlisted root><device>/<attribute>` — two segments, each
     *     matching [SYSFS_SEGMENT_RE]. That is the shape of every real
     *     backlight/leds attribute (`panel0/brightness`,
     *     `lcd-backlight/bl_power`) and it makes traversal
     *     unrepresentable rather than merely filtered: there is no
     *     segment count in which a `..` or a nested escape could hide.
     *  6. DEFENCE IN DEPTH: canonicalize, and require the result to land
     *     either under an allowlisted class root (the build-host case,
     *     where nothing resolves) or under `/sys/devices/` (the real
     *     hardware case). A hostile symlink — say `panel0` pointing at
     *     `/etc` — resolves outside both and is still refused.
     *
     * Returns the CANONICAL path, which is what callers open. Callers
     * that cache a result and re-validate later must re-validate the
     * ORIGINAL class path, not the returned one (see
     * [SysfsBacklightProvider.Node]).
     */
    fun canonicalSysfsPath(raw: String): String? =
        canonicalSysfsPath(raw, SYSFS_ROOTS, SYSFS_RESOLVED_ROOTS)

    /**
     * Root-injectable form, so the adversarial tests can build a REAL
     * symlink farm under a temp dir and prove step 6 actually resolves.
     * Production always calls the two-root default above.
     */
    internal fun canonicalSysfsPath(
        raw: String,
        roots: List<String>,
        resolvedRoots: List<String>,
    ): String? {
        val path = raw.trim()
        if (path.isEmpty() || path.length > MAX_PATH_LEN) return null
        if (hasUnsafeChar(path)) return null
        if (!path.startsWith("/")) return null

        val segments = path.split('/')
        // Any `..` segment, in any position — refused textually so this
        // never depends on canonicalization behaving.
        if (segments.any { it == ".." }) return null
        val meaningful = segments.filter { it.isNotEmpty() && it != "." }
        val normalized = "/" + meaningful.joinToString("/")

        val root = roots.firstOrNull { normalized.startsWith(it) } ?: return null
        val tail = normalized.substring(root.length).split('/')
        // Exactly <device>/<attribute>. Not one (that is the device
        // directory itself), not three (which is how you walk out of a
        // class tree through `device/` back-links).
        if (tail.size != 2) return null
        if (tail.any { !SYSFS_SEGMENT_RE.matches(it) }) return null

        val canonical = try {
            File(normalized).canonicalPath
        } catch (t: Throwable) {
            return null
        }
        if (canonical.length > MAX_PATH_LEN) return null

        val landsSomewhereLegal = (roots + resolvedRoots).any { legal ->
            canonical.startsWith(legal) && canonical.length > legal.length
        }
        return if (landsSomewhereLegal) canonical else null
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
            Triple("brightness", recipe.brightness, Capability.BRIGHTNESS),
            Triple("blank", recipe.blank, Capability.BLANK),
            Triple("wake", recipe.wake, Capability.WAKE),
        )
        if (steps.all { it.second == null }) {
            return RecipeCheck.Rejected("recipe declares no brightness/blank/wake step")
        }
        steps.forEach { (name, step, capability) ->
            if (step != null) {
                val why = validateStep(step, capability)
                if (why != null) return RecipeCheck.Rejected("$name: $why")
            }
        }
        return RecipeCheck.Valid(recipe)
    }

    /**
     * Returns null when the step is acceptable, else the rejection
     * reason.
     *
     * ⚠️ [capability] is NOT optional decoration — it is what enforces
     * the MIN_SAFE brightness floor. A BRIGHTNESS step that writes a
     * LITERAL bypasses [DisplayLimits] entirely, because the clamped
     * percent is simply discarded. The real-world shape is
     * `{kind:"sysfs", path:".../bl_power", value:"4"}`
     * (FB_BLANK_POWERDOWN — a genuine vendor pattern): every
     * SetBrightness, INCLUDING SetBrightness(100), then powers the
     * backlight off, and the dead-man revert re-applies the same literal
     * so the guard actively re-creates the failure. Same bypass for
     * `kind:"broadcast"` whose extras are all literals (`state=0` on a
     * vendor SET_POWER action).
     *
     * So: a BRIGHTNESS step MUST be percent-derived. Literals belong to
     * blank/wake, where a constant is exactly what is wanted.
     *
     * The pass-through overload exists so a caller that genuinely has no
     * capability context still gets the shape checks; every production
     * call site passes one.
     */
    fun validateStep(step: RecipeStep, capability: Capability? = null): String? {
        val shape = when (step) {
            is RecipeStep.Broadcast -> validateBroadcast(step)
            is RecipeStep.Sysfs -> validateSysfs(step)
            is RecipeStep.SettingsWrite -> validateSettings(step)
        }
        if (shape != null) return shape
        if (capability == Capability.BRIGHTNESS) return validateBrightnessStep(step)
        return null
    }

    /** The MIN_SAFE-floor rules that only apply to a BRIGHTNESS step. */
    private fun validateBrightnessStep(step: RecipeStep): String? = when (step) {
        is RecipeStep.Sysfs -> when {
            !step.fromPercent ->
                "a brightness step must be percent-derived (valueFrom:\"percent\") — a literal " +
                    "value bypasses the MIN_SAFE brightness floor and the dead-man revert re-applies it"
            !isWideEnoughForFloor(step.scale) ->
                "brightness scale span is too narrow — ${DisplayLimits.MIN_SAFE_BRIGHTNESS}% would round " +
                    "to the scale minimum (need a span of at least ${RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN})"
            else -> null
        }
        is RecipeStep.Broadcast -> when {
            step.extras.none { it.from == RecipeValueSource.PERCENT } ->
                "a brightness broadcast must carry at least one percent-derived extra — an all-literal " +
                    "broadcast is a constant and bypasses the MIN_SAFE brightness floor"
            step.extras.any { it.from == RecipeValueSource.PERCENT && !isWideEnoughForFloor(it.scale) } ->
                "brightness scale span is too narrow — ${DisplayLimits.MIN_SAFE_BRIGHTNESS}% would round " +
                    "to the scale minimum (need a span of at least ${RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN})"
            else -> null
        }
        // Settings writes are percent-derived by construction.
        is RecipeStep.SettingsWrite ->
            if (!isWideEnoughForFloor(step.scale)) {
                "brightness scale span is too narrow — ${DisplayLimits.MIN_SAFE_BRIGHTNESS}% would round " +
                    "to the scale minimum (need a span of at least ${RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN})"
            } else {
                null
            }
    }

    /** A null scale means the provider default (0..255 / 0..100) — always wide enough. */
    private fun isWideEnoughForFloor(scale: RecipeScale?): Boolean {
        val s = scale ?: return true
        return (s.max - s.min) >= RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN
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
