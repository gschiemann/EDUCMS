package com.educms.player.display

import android.content.Context
import android.provider.Settings
import com.educms.player.led.LedCanvasHost
import com.educms.player.logging.PlayerLogger
import java.io.File

/**
 * NovaStar Taurus LED control — THE SKELETON, not the client (2026-09-02,
 * player 1.1.15).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ═════════════════════════════════════════════════════════════════════
 * It is the LANDING PAD for the real NovaStar control layer: the chain
 * position, the availability rule, the allowlist of calls we will ever
 * make, and the drop-in checklist. It resolves to NOTHING on every box in
 * the fleet today and CANNOT be talked into resolving, because the native
 * client is not built ([CLIENT_LINKED] is a compile-time `false`).
 *
 * It is NOT a working provider. Nothing here opens a socket, loads a
 * library, or sends a command. `supports()` returns an empty set, so
 * `DisplayControlRegistry.resolve` walks straight past it to
 * `VendorRecipeProvider` exactly as it did in 1.1.14 — that no-op is the
 * contract [NovaStarTaurusProviderTest] pins.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY IT EXISTS AT ALL (the evidence, not a guess)
 * ═════════════════════════════════════════════════════════════════════
 * On a Taurus, LED brightness and screen power are NOT Android's. They
 * live in NovaStar's own control plane — `nova.priv.terminal.screen
 * .ScreenService`, reached through the T-SDK / ViplexCore native library
 * over TCP 16603. The same API family returns cabinet temperature,
 * receiving-card counts and an ambient-lux reading, and
 * `nvGetProductInfoAsync` reports `displayDevice:"LED"`. So
 * `Settings.System.SCREEN_BRIGHTNESS`, the kernel backlight nodes and a
 * device-admin `lockNow()` are all provably the WRONG LAYER on this box:
 * their writes can succeed and the glass will not move.
 *
 * Full research, with the vendor documentation quoted verbatim:
 * `docs/research/2026-09-01-taurus-brightness-power/01-control-surfaces.md`
 * (§1.4 auth, §1.5 brightness, §1.6 screen power, §1.9 the on-device
 * services) and `03-lan-protocol.md`.
 *
 * Until this file has a real client behind it, the probe reports
 * [DisplayCapabilityProbe.BRIGHTNESS_NOVASTAR_PENDING] on a poster —
 * "the layer is known, the client is not built" — which the server treats
 * as UNPROVEN and routes onto the soft overlay. That is the honest answer;
 * `software-dim` would have been a claim that our window dimmer owns the
 * panel's brightness, and on an LED wall driven by receiving cards it does
 * not.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ THE T-SDK DROP-IN CHECKLIST — what a future wave must supply
 * ═════════════════════════════════════════════════════════════════════
 *  1. LICENCE FIRST, CODE SECOND. NovaStar gates integrator access
 *     (the VNNOX OpenAPI onboarding says to ask a regional sales rep).
 *     Redistribution rights for `libviplexcore.so` inside a third-party
 *     APK are UNKNOWN and are a hard blocker. One email precedes all of
 *     the engineering below.
 *  2. Drop `libviplexcore.so` into `app/src/main/jniLibs/{arm64-v8a,
 *     armeabi-v7a}/` (both ABIs are vendor-supported) and add the JNI
 *     binding that turns each `nv*Async(const char* json, callback)` into
 *     a suspendable Kotlin call.
 *  3. Flip [CLIENT_LINKED] to true IN THE SAME COMMIT as the binding, and
 *     only then. It is the one switch that lets this provider resolve.
 *  4. Implement [apply] against the ALLOWLIST in [ALLOWED_SDK_CALLS] and
 *     nothing else. The loopback session shape, from the research doc:
 *        nvInit(credentials)                       — once per process
 *        nvSearchAppointIpAsync {"ip":"127.0.0.1"} — the vendor's own
 *                                                   documented embedded
 *                                                   addressing
 *        nvLoginAsync  {username:"admin", loginType:0,
 *                       password: operator secret, else "SN2008@+"
 *                       (terminal ≥ V4.6.0) or "123456"}
 *        …one command…
 *        nvLogoutAsync                             — ALWAYS, immediately
 *     Success is `logined:true && validation:true`; `logined:false,
 *     validation:true` means ANOTHER HOST IS LOGGED IN (ViPlex Express or
 *     an installer standing at the screen) and the dashboard must say so
 *     in those words.
 *  5. CONNECT / ACT / LOG OUT. The terminal permits ONE logged-in host, so
 *     a held session locks out the operator's own ViPlex tools. Never hold
 *     one idle.
 *  6. THREE STRIKES IS A REAL LOCKOUT. Three wrong passwords disable login
 *     for 60 s (error code 16) — for us AND for the human at the panel. A
 *     retry loop is therefore single-flight with backoff, and STOPS
 *     permanently on the first code 16 until an operator changes the
 *     stored secret. Same discipline as `attemptCredentialRecovery`.
 *  7. NEVER hardcode a default password as a silent fallback. Try the
 *     operator-supplied secret; if the documented default works, raise a
 *     dashboard warning that the screen is on its factory password.
 *     Knowledge of a default must not silently become a credential
 *     (DEVAUTH-01's rule, applied here).
 *  8. NO PERCEPTUAL GAMMA ON THIS PATH. `nvSetScreenBrightnessAsync`'s
 *     `ratio` is already a display-brightness ratio with the panel's own
 *     curve; pushing it through `DisplayLimits.perceptualBrightnessDuty`
 *     would make 50% read as 22%. Send the raw clamped percent, the way
 *     vendor-recipe scales already stay linear.
 *  9. VERDICT + CONTRACT IN THE SAME COMMIT. Wiring a resolving provider
 *     means [id] starts appearing in reports, so `DISPLAY_BRIGHTNESS_
 *     MECHANISMS` / `DISPLAY_BLANK_MECHANISMS` must already carry it
 *     (they do, as of this commit) and the two routing matrices
 *     (`display.service.spec.ts`, `displayControl.test.ts`) plus the web
 *     `brightnessNote` record must get a row saying whether it is PROVEN.
 *     It joins `DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS` only from observed
 *     behaviour on real glass — tests T1/T2/T4/T5 in the research doc.
 * 10. NOT IN THIS FILE, EVER: `nvFactoryResetAsync`,
 *     `nvClearAllMediaAsync`, `nvInstallAppAsync`, `nvUpgradeSystemAsync`,
 *     and `loginType:1` (the vendor's own "back-door" system-settings
 *     login, the gateway to immediate reboot and the destructive calls).
 *     They are reachable over the SAME authenticated session as
 *     brightness. Absent from the code is the security boundary — the
 *     same rule `RecipeAllowlist` enforces for vendor recipes.
 */
object NovaStarTaurusProvider : DisplayControlProvider {

    private const val TAG = "NovaStarTaurus"

    /**
     * The mechanism id this provider reports once it can drive the panel.
     *
     * Distinct from [DisplayCapabilityProbe.BRIGHTNESS_NOVASTAR_PENDING]
     * on purpose: `novastar-sdk` means "we drove the LED", the `-pending`
     * value means "this is the LED's layer and we cannot reach it yet".
     * Collapsing them would make an unbuilt client indistinguishable from
     * a working one in the fleet report.
     */
    override val id: String = "novastar-sdk"

    /**
     * Opt-in switch, off by default:
     *   adb shell settings put global venueos_novastar_sdk 1
     *
     * A global Settings row rather than a build flag so a single bench
     * unit can be armed without a special APK. It is necessary and NOT
     * sufficient — see [availability].
     */
    private const val ENABLE_SETTING = "venueos_novastar_sdk"

    /** The vendor library, if it were ever shipped inside the APK. */
    private const val LIBRARY_NAME = "libviplexcore.so"

    /**
     * Is a JNI binding for [LIBRARY_NAME] compiled into THIS build?
     *
     * ⚠️ Hardcoded `false`, and that is the entire safety story of this
     * file. Even a box with the global setting armed AND the library on
     * disk resolves [Availability.CLIENT_NOT_BUILT], so `supports()` is
     * empty and the registry's brightness/blank chains are byte-for-byte
     * what they were before this file existed. Flip it in the same commit
     * that adds the binding — never as "groundwork".
     */
    private const val CLIENT_LINKED = false

    /**
     * The COMPLETE set of vendor calls this integration will ever make.
     *
     * Declared here, in the code, for the reason `RecipeAllowlist` exists:
     * the same authenticated session that sets brightness can also factory
     * reset the box and wipe its media. An allowlist that lives in a
     * server payload can be widened by a server payload; one that lives in
     * the APK cannot. Anything not on this list must be absent from the
     * file, not merely unreached.
     */
    val ALLOWED_SDK_CALLS: List<String> = listOf(
        // session
        "nvInit",
        "nvSearchAppointIpAsync",
        "nvLoginAsync",
        "nvLogoutAsync",
        // brightness
        "nvSetBrightnessAdjustModeAsync",
        "nvSetScreenBrightnessAsync",
        "nvGetScreenBrightnessAsync",
        // screen power (blank / wake at the LED layer — NOT a mains cut)
        "nvSetScreenPowerModeAsync",
        "nvSetScreenPowerStateAsync",
        "nvGetScreenPowerStateAsync",
    )

    /** Why this provider is (or is not) usable on this box. */
    enum class Availability {
        /** Not a NovaStar poster — the wrong hardware entirely. */
        NOT_POSTER_CLASS,

        /** Poster, but nobody armed `venueos_novastar_sdk`. */
        DISABLED_BY_FLAG,

        /** Armed, but the vendor library is not in the APK. */
        LIBRARY_MISSING,

        /** Library present, but this build has no JNI binding for it. */
        CLIENT_NOT_BUILT,

        /** Everything is in place — the only value that lets us resolve. */
        READY,
    }

    /**
     * The availability rule, as a pure function so it can be tested
     * without an emulator, a Taurus, or a vendor library.
     *
     * Ordered most-fundamental-first so the reported reason is the one an
     * operator can act on: a Goodview panel is told it is the wrong
     * hardware, not that a library is missing.
     */
    fun availability(
        posterClass: Boolean,
        flagOn: Boolean,
        libraryPresent: Boolean,
        clientLinked: Boolean,
    ): Availability = when {
        !posterClass -> Availability.NOT_POSTER_CLASS
        !flagOn -> Availability.DISABLED_BY_FLAG
        !libraryPresent -> Availability.LIBRARY_MISSING
        !clientLinked -> Availability.CLIENT_NOT_BUILT
        else -> Availability.READY
    }

    /** Live availability on this device. Never throws. */
    fun availability(ctx: Context): Availability = availability(
        posterClass = runCatching { LedCanvasHost.isPosterClass(ctx) }.getOrDefault(false),
        flagOn = flagOn(ctx),
        libraryPresent = libraryPresent(ctx),
        clientLinked = CLIENT_LINKED,
    )

    /**
     * ⚠️ ALWAYS EMPTY IN THIS BUILD. `supports()` must be honest — a
     * provider that claims a capability it cannot perform is "coming soon
     * wearing a real-button costume", which this repo has a standing rule
     * against and which is exactly how one mis-declared vendor recipe
     * disabled WAKE on a whole SKU.
     *
     * When the client lands it returns {BRIGHTNESS, BLANK, WAKE} only
     * after a real loopback handshake has succeeded at least once (cached
     * with a TTL) — never off a `Build.MODEL` match.
     */
    override fun supports(ctx: Context): Set<Capability> {
        val state = availability(ctx)
        if (state != Availability.READY) return emptySet()
        // Unreachable while CLIENT_LINKED is false. Kept so the shape of
        // the eventual answer is visible, and so flipping the flag without
        // implementing `apply` fails loudly here rather than silently
        // returning Unsupported to a wall-mounted screen.
        PlayerLogger.w(TAG, "availability READY with no client implementation — refusing to claim support")
        return emptySet()
    }

    /**
     * Unreachable today: the registry only calls `apply` on a provider it
     * resolved, and this one never resolves. It answers Unsupported with
     * the live reason rather than throwing, so a future caller that
     * bypasses the registry gets a diagnosis instead of a crash.
     */
    override fun apply(ctx: Context, action: DisplayAction): ActionResult =
        ActionResult.Unsupported(describe(availability(ctx)))

    /** One line an operator can act on. Safe to log; carries no secret. */
    fun describe(state: Availability): String = when (state) {
        Availability.NOT_POSTER_CLASS ->
            "not a NovaStar LED controller — NovaStar screen control does not apply here"
        Availability.DISABLED_BY_FLAG ->
            "NovaStar screen control is off on this box (settings global $ENABLE_SETTING)"
        Availability.LIBRARY_MISSING ->
            "NovaStar screen control is unavailable — $LIBRARY_NAME is not installed on this player"
        Availability.CLIENT_NOT_BUILT ->
            "NovaStar screen control is not built into this player yet — the LED's brightness and " +
                "power live in NovaStar's own layer and this build cannot reach them"
        Availability.READY ->
            "NovaStar screen control is available"
    }

    private fun flagOn(ctx: Context): Boolean = runCatching {
        val v = Settings.Global.getString(ctx.contentResolver, ENABLE_SETTING)
        v == "1" || v.equals("true", ignoreCase = true)
    }.getOrDefault(false)

    /**
     * Is the vendor library actually inside this APK's native lib dir?
     *
     * A file stat, not a `System.loadLibrary` — probing must never load
     * closed-source native code as a side effect of asking a question.
     */
    private fun libraryPresent(ctx: Context): Boolean = runCatching {
        val dir = ctx.applicationInfo?.nativeLibraryDir ?: return@runCatching false
        File(dir, LIBRARY_NAME).isFile
    }.getOrDefault(false)
}
