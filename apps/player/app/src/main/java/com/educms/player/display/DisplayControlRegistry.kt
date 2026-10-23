package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger
import com.educms.player.standby.UserStandby
import com.educms.player.wake.WakeRecovery

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
 * BRIGHTNESS   NovaStarTaurus → VendorRecipe → SysfsBacklight → SettingsBrightness → SoftwareDim
 * BLANK / WAKE NovaStarTaurus → VendorRecipe → DeviceAdminBlank → AccessibilityLock → ScreenTimeout → SoftwareDim
 * VOLUME       AudioManager
 * REBOOT       DeviceOwnerReboot          (device owner only — no fallback exists)
 * ```
 *
 * [NovaStarTaurusProvider] is a SKELETON as of 1.1.15 — it never resolves,
 * so today's answers are unchanged. See the note on CHAINS below.
 *
 * BRIGHTNESS and BLANK/WAKE ALWAYS resolve, because SoftwareDim is an
 * unconditional floor — the probe verdict names the MECHANISM, never
 * whether the capability exists. VOLUME resolves on every box with an
 * AudioManager.
 *
 * ⚠️ BLANK and WAKE also FALL THROUGH on failure ([fallsThroughOnFailure]).
 * The head of both chains is [VendorRecipeProvider], whose `supports()` is
 * declarative — it believes a DB row. A single mis-specified vendor action
 * therefore used to disable WAKE on every matching SKU while every layer
 * reported success, which on a wall-mounted screen is a truck roll. The
 * other capabilities keep the strict single-provider rule.
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

    // ⚠️ [NovaStarTaurusProvider] HEADS BRIGHTNESS / BLANK / WAKE and
    // resolves to NOTHING today (2026-09-02, v1.1.15). On a NovaStar Taurus
    // it is the only mechanism that can reach the LED at all — brightness
    // and screen power live in NovaStar's own control plane, not in
    // Settings.System or /sys/class/backlight — so this is where it belongs
    // the day its client exists. Its `supports()` is empty in this build by
    // construction (`CLIENT_LINKED = false`), which makes the position a
    // provable no-op: every chain below resolves exactly as it did in
    // 1.1.14 on every box in the fleet. Read that file's drop-in checklist
    // before flipping anything.
    private val CHAINS: Map<Capability, List<DisplayControlProvider>> = mapOf(
        Capability.BRIGHTNESS to listOf(
            NovaStarTaurusProvider,
            VendorRecipeProvider,
            SysfsBacklightProvider,
            SettingsBrightnessProvider,
            SoftwareDimProvider,
        ),
        Capability.BLANK to listOf(
            NovaStarTaurusProvider,
            VendorRecipeProvider,
            DeviceAdminBlankProvider,
            AccessibilityLockProvider,
            ScreenTimeoutBlankProvider,
            SoftwareDimProvider,
        ),
        Capability.WAKE to listOf(
            NovaStarTaurusProvider,
            VendorRecipeProvider,
            DeviceAdminBlankProvider,
            AccessibilityLockProvider,
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
     * @param allowProvider (2026-10-11) when non-null, only providers whose
     *        id it accepts may run — the resolved one is skipped for the
     *        next accepted provider in the same chain, and the fall-through
     *        skips the rest. The after-alert restore uses it so an
     *        unattended darkening never takes a mechanism that has latched
     *        panels into a vendor standby (see `standby.RestoreBlankPolicy`).
     *        Null = the unchanged behaviour every other caller gets.
     * @param wakeSource (2026-10-11) who is asking for a WAKE — named in the
     *        wake timeline and the `PLAYER_WAKE_*` markers (`dead-man-revert`,
     *        `command`, `schedule-on`, `emergency`, `power-on`, `standby-end`).
     *        Every Wake, named or not, starts [WakeRecovery]'s bounded
     *        foreground check once the provider and the backstop have run.
     */
    fun apply(
        ctx: Context,
        rawAction: DisplayAction,
        revertAfterMs: Long? = null,
        allowProvider: ((String) -> Boolean)? = null,
        wakeSource: String? = null,
    ): ActionResult {
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

        // ── USER STANDBY (2026-10-03, player 1.1.21) ──
        // A WAKE is a deliberate "be visible" — the dashboard's Turn on (it
        // reaches this device as WAKE), the schedule's ON trigger, a dead-man
        // restore — so it ends a person's remote standby before the provider
        // turns the panel on. A BLANK is OURS: it is recorded BEFORE the
        // provider runs, so the ACTION_SCREEN_OFF a device-admin lock fires at
        // once is never mistaken for somebody's remote.
        when (action) {
            DisplayAction.Wake -> {
                // 2026-10-11 — a blank still being checked is judged NOW,
                // before this wake changes the answer (a dead-man revert or a
                // Turn on can land inside the screen-timeout settle window).
                runCatching { SleepProof.beforeWake(app) }
                UserStandby.end(app, "a WAKE command")
                // 1.1.23 — a WAKE COMMAND during an alert means the panel
                // stays on after the all-clear (last command wins). The
                // alert's own wake runs inside UserStandby.duringOwnWake and
                // does not count.
                // (1.1.51 — the same call also notes a wake COMMAND during a
                // hold for the pre-hold blank restore, RestoreBlankAfterAlertPolicy.)
                UserStandby.noteDeliberateWake(app)
            }
            DisplayAction.Blank -> UserStandby.noteOwnBlank()
            else -> Unit
        }

        val chain = CHAINS[action.capability].orEmpty()
        val resolved = resolve(app)[action.capability]
        val provider = (
            if (allowProvider == null || resolved == null || allowProvider(resolved.id)) {
                resolved
            } else {
                chain.firstOrNull { p ->
                    p !== resolved && allowProvider(p.id) && action.capability in supportsQuietly(app, p)
                }.also {
                    PlayerLogger.i(
                        TAG,
                        "${action.describe()}: ${resolved.id} is not allowed for this caller — using ${it?.id ?: "nothing"}",
                    )
                }
            }
            )
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

        // Snapshot the mirror BEFORE the apply mutates it — the post-apply
        // re-assert below has to ask "was THIS action a darkening one",
        // and after recordState every request compares equal to itself.
        val beforePercent = DisplayPrefs.brightnessPercent(app)

        var result = try {
            provider.apply(app, action)
        } catch (t: Throwable) {
            PlayerLogger.e(TAG, "provider ${provider.id} threw on ${action.describe()}", t)
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, provider.id)
        }

        PlayerLogger.i(TAG, "${action.describe()} via ${provider.id} → $result")

        // ── ⚠️ RECOVERY-DIRECTION FALL-THROUGH (BLANK / WAKE only) ──
        // The resolved provider is normally the whole answer. For BLANK and
        // WAKE it must not be, because [VendorRecipeProvider] heads both
        // chains on a purely DECLARATIVE supports() — one mis-typed action
        // string in one DB row (a firmware revision, a bring-up guess: the
        // expected state for a feature whose whole point is "a new vendor
        // is a DB row") otherwise disabled WAKE on every matching SKU, with
        // every layer reporting success and a dark wall-mounted screen at
        // the end of it. Contract C4's named worst outcome, from one row.
        //
        // So a non-Ok BLANK/WAKE keeps walking the chain until something
        // takes, and [SoftwareDimProvider] is an unconditional floor at the
        // end of both. Risk-direction capabilities (BRIGHTNESS, VOLUME,
        // REBOOT) keep the strict single-provider rule: falling through
        // there could apply a DIFFERENT mechanism's idea of "20%" on top of
        // a half-applied first attempt.
        if (!result.ok && fallsThroughOnFailure(action.capability)) {
            for (next in chain) {
                if (next === provider) continue
                if (allowProvider != null && !allowProvider(next.id)) continue
                if (action.capability !in supportsQuietly(app, next)) continue
                PlayerLogger.w(
                    TAG,
                    "${action.describe()} did not take via ${provider.id} ($result) — " +
                        "falling through to ${next.id}",
                )
                result = try {
                    next.apply(app, action)
                } catch (t: Throwable) {
                    PlayerLogger.e(TAG, "provider ${next.id} threw on ${action.describe()}", t)
                    ActionResult.Failed(t.message ?: t.javaClass.simpleName, next.id)
                }
                PlayerLogger.i(TAG, "${action.describe()} via ${next.id} → $result")
                if (result.ok) break
            }
        }

        // ── ⚠️ EVERY WAKE GETS THE SOFTWARE BACKSTOP ──
        // Belt and braces for the one direction where being wrong costs a
        // truck roll. A vendor WAKE we could not PROVE was delivered still
        // reports Ok — on an Android 11+ box, package-visibility filtering
        // makes "no receiver installed" indistinguishable from "receiver
        // we cannot see" — so the fall-through above never runs for it.
        //
        // DELIBERATELY NOT `SoftwareDimProvider.apply(Wake)`: that also
        // re-drives window brightness to the mirrored percent, which on a
        // box whose BRIGHTNESS is a real backlight would stack a 40%
        // composition dim on top of a 40% backlight (16% on the glass)
        // every time anything woke the screen. The backstop is exactly the
        // un-hiding half — hide the overlay, re-flag KEEP_SCREEN_ON,
        // re-assert the wake flags, and poke the panel awake if the OS
        // already slept it. All idempotent, none of them touch a level the
        // operator chose.
        if (action == DisplayAction.Wake && provider !== SoftwareDimProvider) {
            runCatching {
                DisplayWindowBridge.withHooks { h ->
                    h.setBlackout(false)
                    h.setKeepScreenOn(true)
                    h.requestWake()
                }
                // The one mechanism that turns an already-slept panel back
                // on from a Context — a live window is not required.
                ScreenWakeLock.pokeScreen(app)
            }.onFailure { PlayerLogger.w(TAG, "software wake backstop failed: ${it.message}") }
        } else if (action == DisplayAction.Wake) {
            // USER STANDBY (2026-10-03) — the software floor's WAKE only
            // re-flags the window, and a window cannot turn on a panel the OS
            // has already put to sleep (a person's remote-off, an OS timeout).
            // Before this, Turn on did nothing to a remote-slept panel whose
            // WAKE resolved to software-dim.
            runCatching { ScreenWakeLock.pokeScreenIfAsleep(app) }
                .onFailure { PlayerLogger.w(TAG, "software-dim wake poke failed: ${it.message}") }
        }

        // ── 2026-10-11 — A WAKE IS NOT OVER UNTIL THE PLAYER IS IN FRONT ──
        // Turning the panel on is one act; whatever Android then shows is
        // another. Every wake path (the dead-man revert, Turn on, the
        // schedule's ON, the alert raise, the end of a standby) now hands
        // off to one bounded check that brings the EXISTING Activity
        // forward if the panel is on and it is not resumed — never a page
        // reload, never into a dark panel, never over a person's standby.
        if (action == DisplayAction.Wake) {
            runCatching { WakeRecovery.afterWake(app, wakeSource ?: "registry") }
                .onFailure { PlayerLogger.w(TAG, "wake foreground check could not start: ${it.message}") }
        }

        if (result.ok) recordState(app, action)

        // 2026-10-11 — a BLANK that claims a real sleep is CHECKED afterwards
        // (SleepProof): did Android actually go non-interactive, or did a
        // screensaver start instead? Bookkeeping only — it schedules a read
        // and never drives the panel during an alert.
        val blankedVia = (result as? ActionResult.Ok)?.providerId
        if (action == DisplayAction.Blank && blankedVia != null) {
            runCatching { SleepProof.expect(app, blankedVia) }
                .onFailure { PlayerLogger.w(TAG, "sleep check could not be scheduled: ${it.message}") }
        }

        // ── ⚠️ LIFE-SAFETY RE-ASSERT — the other half of the gate ──
        // The gate at the top is check-then-act across a thread boundary:
        // a 22:00 scheduled blank can read isHeld()==false, pass, and land
        // its effect AFTER a lockdown OVERRIDE engages the hold on the
        // bridge worker thread. MainActivity's UI-thread hook guard closes
        // that for the window overlay; this closes it for every mechanism
        // the looper cannot gate — a device-admin lockNow(), a shortened
        // screen-off timeout, a vendor power broadcast.
        //
        // Cannot recurse: enforceNow only ever applies Wake and
        // SetBrightness(100), neither of which is a darkening action.
        if (DisplayEmergency.isDarkeningAction(beforePercent, action) && DisplayEmergency.isHeld(app)) {
            PlayerLogger.e(
                TAG,
                "${action.describe()} RACED the emergency hold — it engaged mid-apply; re-asserting a visible screen",
            )
            runCatching { DisplayEmergency.enforceNow(app) }
                .onFailure { PlayerLogger.e(TAG, "post-apply emergency re-assert failed", it) }
        }

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

    /**
     * Which capabilities keep walking the chain when the resolved
     * provider does not deliver.
     *
     * Pure, so the rule that decides whether a mis-typed vendor recipe
     * bricks WAKE fleet-wide has a test that cannot be skipped for want
     * of an emulator.
     *
     * BLANK is included alongside WAKE even though blanking is
     * risk-direction: falling through there lands on the software floor,
     * which is a black overlay and nothing more — recoverable by any
     * WAKE. The thing that must never happen is a BLANK that half-takes
     * and a WAKE that then cannot undo it, which is what a single-provider
     * WAKE produced.
     */
    internal fun fallsThroughOnFailure(capability: Capability): Boolean =
        capability == Capability.BLANK || capability == Capability.WAKE

    /** `supports()` without letting a throwing provider abort the walk. */
    private fun supportsQuietly(ctx: Context, provider: DisplayControlProvider): Set<Capability> = try {
        provider.supports(ctx)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "provider ${provider.id}.supports() threw during fall-through: ${t.message}")
        emptySet()
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
