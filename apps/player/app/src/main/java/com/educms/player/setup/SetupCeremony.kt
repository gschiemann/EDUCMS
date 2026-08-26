package com.educms.player.setup

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import com.educms.player.display.DeviceAdminEnrollment
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * SetupCeremony — the guided first-boot walk-through.
 *
 * Operator direction: *"when someone runs our apk installer, it automates
 * the rest, makes us the home app, gives us permissions, and prepares for
 * OTA with zero to little interaction from a user onsite."*
 *
 * Android will not hand a sideloaded app these grants silently without
 * device owner — and the fleet decision is NO owner (every deployed box
 * already carries the vendor's, and a factory reset per screen is off the
 * table). What Android DOES allow is one system page per grant. So the
 * honest ceiling is: run the installer, open the app, and tap Allow a
 * handful of times while the app drives every step. This object is that
 * driver.
 *
 * ── v2, 2026-08-25 — SHELL CHANGE ONLY ────────────────────────────────
 *
 * Operator, having just walked a real panel through v1 (1.1.2 → 1.1.4):
 * *"the buttons to allow permissions are all over the place, not even in
 * a consistent menu, and one menu wasnt even visible i had to guess where
 * all admin permissions was …. why cant we pop one menu where we quickly
 * check everything we want and then it auto configures everything …. i
 * get it its only one time but its a lot for an end user."*
 *
 * ⚠️ THE PART WE CANNOT FIX, stated plainly so nobody re-litigates it:
 * there is no Android API that grants install-unknown-apps,
 * WRITE_SETTINGS, battery exemption, device-admin and the HOME default
 * from one dialog. Each is a separate system Activity a human must visit
 * and approve. Only device-owner provisioning changes that, and that
 * needs a factory reset per screen. One checkbox list that "auto
 * configures everything" is not buildable here.
 *
 * ⚠️ THE PART THAT WAS OURS, and is what v2 fixes: v1 was six
 * disconnected dialogs. Each one threw the operator at a vendor Settings
 * page and then vanished, so when a page turned out to be hidden on that
 * panel (the invisible "all admin permissions" menu) there was nothing to
 * come back to and no way to see how far they had got. v2 keeps ONE
 * persistent checklist on screen — every grant, live status, a progress
 * count, the next one armed, and a generic "can't find it?" path under
 * the armed row. Every Settings round-trip lands back in the same place,
 * one row further along. Same six grants, same intents, same order, same
 * skip rules; different shell.
 *
 * WHAT IT REPLACED ORIGINALLY. Before v1, the same grants lived as three
 * independent `maybePromptFor*` one-shots in MainActivity that all fired
 * from onCreate AT ONCE — dialogs stacking on top of each other on first
 * boot — and three of the highest-value grants had no prompt at all:
 * WRITE_SETTINGS (real Settings-path brightness + screen-timeout blank —
 * the exact reason the G43's brightness slider did nothing), battery
 * exemption (an OEM power-saver may freeze the heartbeat on an idle
 * kiosk), and device ADMIN (a real `lockNow()` panel-off instead of a
 * black overlay, no owner required).
 *
 * ── v3, 2026-08-25 — THE WIDE-ROLLOUT AUDIT ───────────────────────────
 *
 * v1.1.5 is the last build before the operator installs MANY panels across
 * MANY sites, so every remaining tap is multiplied by every panel. Each of
 * the six grants was re-audited against what it can actually reach on a
 * 2026-08-25 build — not what it bought when it was written. Two failed.
 *
 * | grant                        | verdict | evidence                        |
 * |------------------------------|---------|---------------------------------|
 * | 1 install-updates (Player)   | KEPT    | OtaUpdateWorker's PackageInstaller session is the self-update path; without the appop it silently no-ops on API 26+. |
 * | 2 install-updates (Manager)  | ADVANCED| No Player-side consumer at all — it is read inside the Manager APK (ManagerSelfUpdateWorker). AND `isSatisfied` can never be true (no API reads another package's appop), so it pinned every provisioned panel at "5 of 6" forever. |
 * | 3 modify-system-settings     | KEPT    | Three consumers, one of them the ONLY proven power class: Settings brightness, `ScreenTimeoutBlankProvider`'s real panel-off, and `vendor-recipe` `kind:"settings"` steps. |
 * | 4 battery exemption          | KEPT    | The only thing standing between an OEM power-saver and a frozen heartbeat / deferred on-off alarm / killed OTA worker on a box that is idle by definition. |
 * | 5 device admin               | ADVANCED| Its one consumer is `lockNow()`, and BOTH operator routes to it are shut: BLANK/WAKE are now a web overlay that is never forwarded to the bridge, and POWER_OFF refuses `device-admin` as UNPROVEN. It does NOT enable lock-task or reboot (both need device OWNER). Only the on-device schedule still reaches it. |
 * | 6 HOME                       | KEPT    | The OS only auto-relaunches HOME, which is what makes an OTA self-update come back on screen by itself. Already auto-skipped where a device owner pins HOME for us. |
 *
 * ⚠️ DEMOTED IS NOT REMOVED. An advanced grant is still listed, still
 * tappable, still carries its "can't find it?" path — a panel that
 * genuinely needs it has a route. What it loses is the right to arm
 * itself, to be the big button, and to count against "N of N". If a
 * future audit finds a demoted grant back on a live path, PROMOTE IT —
 * do not leave a checklist that under-asks.
 *
 * RULES (unchanged from v1 unless marked):
 *  - Pref keys for the three migrated steps are UNCHANGED
 *    (installPromptShown / managerInstallPromptShown /
 *    homeSetupPromptShown) so already-set-up screens never re-nag after
 *    the OTA that ships this.
 *  - A LIVE grant always beats the pref: a step whose permission is
 *    already held is skipped no matter what was or wasn't prompted. A
 *    screen where the installer pre-provisioned everything over adb shows
 *    NOTHING — see the ADB-PROVISIONED note in [render].
 *  - Offering advances the sequence, so a decline can never stall it and
 *    a reboot can never re-nag. In v2 the operator does the offering:
 *    firing a step (or "Not now") marks it, which is the same bound —
 *    after one pass the checklist stops coming back on its own.
 *  - Never over an emergency: while a life-safety hold is up the
 *    checklist refuses to open, and — v2 — TAKES ITSELF DOWN if it is
 *    already up. It sits on top of the WebView the alert renders in, so
 *    "don't open a new one" is not enough for a persistent surface.
 *  - Never during lock-task: the OS refuses to launch a Settings screen
 *    from a locked task, so every step would fail at the last inch.
 *  - HOME is last: it opts us in as a launcher candidate, the one step
 *    that touches the vendor CMS's own territory (see the long comment in
 *    AndroidManifest.xml). Everything cheaper and safer runs first.
 *
 * THREADING: everything here runs on the main thread — onResume, view
 * callbacks, the guard tick. No locking, and none is needed.
 */
object SetupCeremony {

    private const val TAG = "SetupCeremony"
    private const val PREFS = "edu_player"

    /** Package names the Manager companion may be installed under. */
    private val MANAGER_PACKAGES = listOf("com.educms.manager", "com.educms.manager.debug")

    /** How long "Setup complete ✓" stays up before the screen clears itself. */
    private const val COMPLETE_LINGER_MS = 4_000L

    /**
     * The same, when ADVANCED grants are still outstanding (v1.1.6).
     *
     * Operator, first install on v1.1.5: *"after you do the first 4
     * requirements it just launched so i didnt get to even do the optional
     * ones at all"*. Four seconds is enough to register a green tick and not
     * enough to read a two-line correction plus the way back — so the card
     * that has something to SAY gets long enough to say it.
     *
     * Still an auto-dismiss, deliberately: the operator's other standing
     * instruction is that setup must never become a blocking screen over
     * live signage. Twelve seconds is a slow read of two short lines, and
     * the same Back / "Done" that always worked still closes it instantly.
     */
    private const val COMPLETE_WITH_OPTIONAL_LINGER_MS = 12_000L

    /** Wall-clock of the last "Not now" / Back. See [telemetryJson]. */
    private const val KEY_DISMISSED_AT = "setupDismissedAtMs"

    /** [recordLaunch] outcomes — the vendor-lost evidence, persisted. */
    private const val LAUNCH_DIRECT = "direct"
    private const val LAUNCH_FALLBACK = "fallback"
    private const val LAUNCH_FAILED = "failed"

    /**
     * How often the open checklist re-checks that it is still allowed to
     * be on screen. An emergency hold can land while we are already
     * foregrounded — no onResume fires then — and this surface covers the
     * WebView the alert renders in. Same 2 s cadence as the manager-gate
     * poller; it only runs while the checklist is actually up.
     */
    private const val GUARD_TICK_MS = 2_000L

    /**
     * How long the checklist may sit untouched before it stands down.
     *
     * The screen it covers may be LIVE SIGNAGE — an OTA that adds a new
     * grant would otherwise park a full-screen setup panel over a
     * customer's board until somebody walks up to it. Ten minutes is long
     * enough for a person to actually work through six Settings pages
     * (each round-trip resets it) and short enough that an abandoned
     * panel is back on content within a class period.
     *
     * Standing down here deliberately does NOT advance the sequence: the
     * same step is armed next boot, so an unfinished setup keeps asking
     * until a human finishes it or explicitly taps "Not now". Burning
     * steps on a timer is how a screen ends up permanently half-granted
     * with nobody ever told.
     */
    private const val IDLE_STAND_DOWN_MS = 10L * 60L * 1000L

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * The live checklist, weakly — a static strong reference to a View
     * pins its Activity. While it is attached the content root holds it;
     * once detached it is collectable. [detach] makes that deterministic.
     */
    private var viewRef: WeakReference<SetupChecklistView>? = null

    /**
     * Set by "Not now" / Back. Suppresses the checklist for the rest of
     * this process only — a reboot brings it back if grants are still
     * outstanding, and the explicit re-open intent ignores it.
     */
    private var hiddenForSession = false

    /**
     * Transient per-row messages from the last launch attempt ("this
     * panel hides the direct page…"). Describes what just happened, not
     * what is true, so it is deliberately not persisted.
     */
    private val notes = mutableMapOf<String, String>()

    /**
     * `elapsedRealtime` of the last time a human did something here —
     * opened it, tapped a row, came back from Settings. Drives
     * [IDLE_STAND_DOWN_MS]. `elapsedRealtime`, never `currentTimeMillis`:
     * Android steps the wall clock on first NTP sync and a backwards step
     * would make a stale marker look fresh (same reasoning as
     * MainActivity's presence marker).
     */
    private var lastTouchedAtMs: Long = 0L

    /** What actually happened when we tried to open a grant's system page. */
    private sealed class LaunchResult {
        /** The exact page opened. */
        object Direct : LaunchResult()

        /** The direct page does not exist here; a broader page opened. */
        data class Fallback(val note: String) : LaunchResult()

        /** Nothing opened. */
        data class Failed(val note: String) : LaunchResult()
    }

    /**
     * One grant we can ask for.
     *
     * @param prefKey     once-per-install marker. UNCHANGED for migrated steps.
     * @param name        the row label — short, plain, no jargon.
     * @param why         one line: what breaks on this screen without it.
     * @param hint        what to do on the page, plus the GENERIC Android
     *                    path to find it by hand. Shown on the armed row
     *                    only. Deliberately generic — we do not know this
     *                    panel's vendor menu tree and must not invent one.
     * @param appliesTo   is this step meaningful on THIS box at all?
     * @param isSatisfied is the grant already held? Live state beats the pref.
     * @param launch      take the operator to the system UI that grants it,
     *                    and report what actually opened.
     * @param optional    ADVANCED — listed and tappable, never armed, never
     *                    counted. Each demotion must cite the CODE evidence
     *                    that the grant's capability is not reachable on the
     *                    happy path of a 2026-08-25 build.
     */
    private class Step(
        val prefKey: String,
        val name: String,
        val why: String,
        val hint: String,
        val appliesTo: (Context) -> Boolean,
        val isSatisfied: (Context) -> Boolean,
        val launch: (Activity) -> LaunchResult,
        val optional: Boolean = false,
    )

    // ─────────────────────────────────────────────────────────────────
    // the steps, in the order they are offered
    //
    // ⚠️ ORDER AND INTENTS ARE LOAD-BEARING AND UNCHANGED FROM v1.
    // ─────────────────────────────────────────────────────────────────

    private val STEPS: List<Step> = listOf(
        // 1 ─ Player installs its own updates. Everything OTA depends on it.
        Step(
            prefKey = "installPromptShown",
            name = "Install updates",
            why = "Lets this screen install its own updates",
            hint = "Switch it on, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Install unknown apps → Venue OS Player.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O },
            isSatisfied = { ctx -> canRequestInstalls(ctx, ctx.packageName) },
            launch = { act -> openInstallSources(act, act.packageName, "Venue OS Player") },
        ),
        // 2 ─ ADVANCED (demoted 2026-08-25 — see the header's per-grant
        //     table). The Manager companion installs Player updates in the
        //     background. Manager has no Activity of its own, so Player is
        //     the only process that can open Settings on its behalf.
        //
        //     ⚠️ NO LIVE CHECK IS POSSIBLE. `canRequestPackageInstalls()`
        //     answers for the CALLING package only; there is no unprivileged
        //     API to read another package's appop. So this is the one step
        //     whose pref is the only signal we have — deliberately, and it is
        //     why the pref is never cleared automatically. On the checklist
        //     it therefore stays "○ Needed" even after it has been granted;
        //     that is honest (we genuinely cannot tell) and it is why this
        //     row, like every other, stays tappable.
        //
        //     WHY IT IS NO LONGER ON THE HAPPY PATH, in evidence:
        //       * ZERO Player-side runtime consumer. The grant is consumed
        //         inside the Manager APK (ManagerSelfUpdateWorker.kt:142
        //         `canRequestPackageInstalls()` → :150 "Manager update
        //         blocked"). Player's own OTA never touches it — see
        //         OtaUpdateWorker's v1.0.53 note: "Player ALWAYS runs the
        //         OTA flow (no more bailing when Manager is installed)",
        //         and step 1 above is the grant that path actually needs.
        //       * `isSatisfied` is a hard `false`, so on a WIDE rollout this
        //         row pins every fully-provisioned panel at "5 of 6"
        //         FOREVER. A completion count that can never complete is
        //         worse than no count, and it is paid on every panel.
        //       * Manager's silent-install value lands only where Manager is
        //         DEVICE OWNER (ManagerApp.kt:184/:250) — a factory-reset
        //         path this fleet has ruled out.
        //     It stays reachable under "Optional" for the Manager-owner
        //     deployments where it does still pay.
        Step(
            prefKey = "managerInstallPromptShown",
            name = "Background updates",
            why = "Lets the companion service apply updates with nobody at the screen",
            hint = "Switch it on, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Install unknown apps → Venue OS Manager.",
            appliesTo = { ctx ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && installedManager(ctx) != null
            },
            isSatisfied = { false },
            launch = { act ->
                val pkg = installedManager(act)
                if (pkg == null) {
                    LaunchResult.Failed("The companion service is not installed on this screen.")
                } else {
                    openInstallSources(act, pkg, "Venue OS Manager")
                }
            },
            optional = true,
        ),
        // 3 ─ WRITE_SETTINGS. KEPT ON THE HAPPY PATH — re-audited
        //     2026-08-25 and it earns its tap three separate ways, only one
        //     of which is the brightness slider everyone thinks of:
        //
        //       a. `SettingsBrightnessProvider` (SCREEN_BRIGHTNESS +
        //          SCREEN_BRIGHTNESS_MODE, SettingsBrightnessProvider.kt:60-67).
        //          Field-proven a SILENT NO-OP on the G43 / Mobile A-Frame
        //          class — the write succeeds and the panel ignores it — but
        //          "silent no-op on two SKUs" is not "useless on hardware we
        //          have not met", and the wide rollout is exactly where we
        //          find out. v1.1.5 now REPORTS whether the write moved a
        //          readable node, so 1.1.6 can decide this on evidence.
        //       b. `ScreenTimeoutBlankProvider` (SCREEN_OFF_TIMEOUT,
        //          ScreenTimeoutBlankProvider.kt:105-109 / :172). A REAL
        //          panel-off that needs NO device admin, sitting at position
        //          3 of the BLANK chain — the direct, recoverable
        //          replacement for the grant demoted at step 5.
        //       c. `VendorRecipeProvider`'s `kind:"settings"` steps
        //          (VendorRecipeProvider.kt:307-308 gate, :315 write) — and
        //          `vendor-recipe` is the ONLY mechanism class the platform
        //          currently considers PROVEN for real panel power
        //          (packages/api-types/src/display-control.ts:400).
        //
        //     Declaring the permission in the manifest is a prerequisite
        //     (already done); this is the grant itself.
        Step(
            prefKey = "writeSettingsPromptShown",
            name = "Brightness control",
            why = "Brightness control needs \"Modify system settings\"",
            hint = "Switch it on, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Modify system settings → Venue OS Player.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> canWriteSettings(ctx) },
            launch = { act ->
                openWithFallback(
                    act,
                    Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS)
                        .setData(Uri.parse("package:${act.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    appsSettings(),
                    "This panel hides the direct page — opening Apps settings; " +
                        "look for \"Modify system settings\".",
                    "This panel would not open its Apps settings.",
                )
            },
        ),
        // 4 ─ Battery-optimisation exemption. A signage box is idle by
        //     definition, which is exactly what an OEM power-saver targets:
        //     deferred alarms (the on/off schedule), a frozen heartbeat, a
        //     killed OTA worker. Exempting us keeps the screen answering.
        Step(
            prefKey = "batteryExemptPromptShown",
            name = "Keep Venue OS running",
            why = "Stops battery saver pausing updates and on/off schedules",
            hint = "Choose \"Allow\", then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Battery optimization → " +
                "All apps → Venue OS Player → Don't optimize.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> isIgnoringBatteryOptimizations(ctx) },
            launch = { act -> requestBatteryExemption(act) },
        ),
        // 5 ─ ADVANCED (demoted 2026-08-25 — see the header's per-grant
        //     table). Device ADMIN, never owner. It turns a scheduled Blank
        //     from a black overlay on a lit backlight into a real
        //     `lockNow()` panel sleep.
        //
        //     WHY IT IS NO LONGER ON THE HAPPY PATH, in evidence. The ONLY
        //     consumer of an active-admin grant in this app is
        //     `DeviceAdminBlankProvider.lockNow()` (DeviceAdminBlankProvider
        //     .kt:142), and both operator-facing routes to it are now shut:
        //       * BLANK/WAKE became the SOFT pair on 2026-08-25. A soft
        //         frame is answered by the web overlay and is explicitly
        //         NEVER forwarded to the bridge (displayControl.ts, the
        //         `if (cmd.soft)` arm) — forwarding it is what fired the
        //         admin lock that latched two panels into a standby only a
        //         mains cycle cleared.
        //       * POWER_OFF/POWER_ON, the hard pair, REFUSE this mechanism
        //         by name: `DISPLAY_POWER_UNPROVEN_MECHANISMS =
        //         ['device-admin','device-owner']` →
        //         BLANK_MECHANISM_UNPROVEN (packages/api-types/src/
        //         display-control.ts). Only `vendor-recipe` is proven.
        //     And the two things it is often ASSUMED to buy, it does not:
        //     `LockTaskController` needs DEVICE OWNER for lock-task
        //     (LockTaskController.kt:209/:226) and `DeviceOwnerReboot`
        //     needs device owner for reboot (DeviceOwnerRebootProvider.kt:60)
        //     — a plain active admin grants neither.
        //
        //     WHAT IS LEFT, and why it stays REACHABLE rather than deleted:
        //     the on-device nightly schedule still resolves through the same
        //     registry (DisplayScheduler.kt → DisplayControlRegistry.apply),
        //     so on a panel with no vendor recipe this is the difference
        //     between a real sleep and a lit backlight behind black. A site
        //     that wants that can still tap this row. It just no longer
        //     costs a tap on every panel of a wide rollout for a mechanism
        //     the platform itself calls unproven.
        //
        //     DeviceAdminEnrollment owns the prompt debounce + declined
        //     cooldown; we only decide WHEN to offer it.
        Step(
            prefKey = "deviceAdminPromptShown",
            name = "Turn the screen off (advanced)",
            why = "Real panel sleep on a schedule. Not needed for Blank — " +
                "that already works on every screen",
            hint = "Tap Activate on the system prompt. Can't find it? On many panels: " +
                "Settings → Security → Device admin apps → \"Turn this screen off\".",
            appliesTo = { true },
            isSatisfied = { ctx -> isActiveAdmin(ctx) },
            launch = { act -> requestDeviceAdmin(act) },
            optional = true,
        ),
        // 6 ─ HOME app. LAST on purpose: this is the step that registers us
        //     as a launcher candidate, and on an OEM-CMS box we are a guest.
        //     It is also what makes an OTA self-update come back on screen by
        //     itself (the OS only auto-relaunches HOME).
        Step(
            prefKey = "homeSetupPromptShown",
            name = "Come back after updates",
            why = "Returns to the player by itself after an update or reboot",
            hint = "Pick Venue OS Player, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Default apps → Home app.",
            // Under a device owner HOME is pinned for us already.
            appliesTo = { ctx -> !managerIsDeviceOwner(ctx) },
            isSatisfied = { ctx -> isPlayerTheHomeApp(ctx) },
            launch = { act ->
                act.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putBoolean("kioskHomeOptIn", true).apply()
                enableKioskHomeAlias(act)
                openWithFallback(
                    act,
                    Intent(Settings.ACTION_HOME_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    Intent(Settings.ACTION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    "This panel hides the direct page — opening Settings; " +
                        "look for \"Home app\" under Apps → Default apps.",
                    "This panel would not open its Settings app.",
                )
            },
        ),
    )

    // ─────────────────────────────────────────────────────────────────
    // the driver
    // ─────────────────────────────────────────────────────────────────

    /**
     * Refresh the checklist, opening it if there is outstanding work.
     *
     * Safe to call from every `onResume` — that repetition is the whole
     * mechanism: each Settings round-trip ends in an onResume, which
     * re-reads every grant live and re-renders the list, which is what
     * makes six separate permissions feel like one flow with a home base
     * instead of six disconnected nags.
     *
     * @param decorate applies the kiosk remote-focus treatment to a
     *        focusable view. Passed in rather than duplicated so
     *        MainActivity's existing `applyRemoteFocus` stays the single
     *        implementation — OEM signage ROMs strip the default focus
     *        highlight, and a control nobody can reach with a remote is a
     *        dead end on a wall-mounted panel.
     */
    fun resume(activity: Activity, decorate: (View) -> Unit) =
        render(activity, decorate, forced = false, afterLaunch = false)

    /**
     * Open the checklist on demand, even when nothing is outstanding and
     * even after a "Not now".
     *
     * This is the RE-ENTRY point for a partially-granted panel: a tech at
     * the box, or the provisioning script, raises it with one line and no
     * APK change (see MainActivity's `ACTION_OPEN_SETUP` header). The
     * emergency and lock-task refusals still apply — nothing re-opens
     * setup chrome over a live alert.
     */
    fun open(activity: Activity, decorate: (View) -> Unit) =
        render(activity, decorate, forced = true, afterLaunch = false)

    /**
     * Drop the checklist and its timers. Call from `onDestroy` so a
     * destroyed Activity is never held by this singleton.
     *
     * No-op when the live checklist belongs to a DIFFERENT Activity
     * instance — a destroy arriving after a recreate must not take down
     * the new instance's screen.
     */
    fun detach(activity: Activity) {
        val view = viewRef?.get()
        if (view != null && view.context !== activity) return
        withdrawNow()
    }

    /**
     * Unconditional teardown — timers off, view out of the window, no
     * ownership check.
     *
     * ⚠️ This is what the emergency and lock-task paths call. A
     * life-safety withdrawal must never be gated on "does this view
     * belong to the Activity that noticed" — if setup chrome is on a
     * screen that is now showing an alert, it comes down, full stop.
     */
    private fun withdrawNow() {
        cancelTimers()
        val view = viewRef?.get()
        viewRef = null
        try {
            (view?.parent as? ViewGroup)?.removeView(view)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not remove the checklist: ${t.message}")
        }
    }

    /**
     * @param forced      show even when nothing is outstanding and even
     *                    after a "Not now" — the explicit re-open path.
     * @param afterLaunch we have just handed the operator off to a system
     *                    Settings page. Renders the row's new truth but
     *                    must NOT start the "Setup complete" countdown:
     *                    that timer would run while they are away and the
     *                    screen would be gone — with no confirmation, and
     *                    no list to fall back to if the grant did not
     *                    take. The countdown starts on their RETURN.
     */
    private fun render(
        activity: Activity,
        decorate: (View) -> Unit,
        forced: Boolean,
        afterLaunch: Boolean,
    ) {
        try {
            if (activity.isFinishing || activity.isDestroyed) {
                detach(activity)
                return
            }

            // ⚠️ Never put setup chrome over a live alert. v1 only refused
            // to OPEN a dialog here; a persistent full-screen checklist
            // has to withdraw as well, because it covers the WebView the
            // emergency renders in. Same rule, applied to a surface that
            // can outlive the moment it was shown.
            if (DisplayEmergency.isHeld(activity.applicationContext)) {
                logRefusal(activity, "emergency hold is active")
                withdrawNow()
                return
            }
            // In lock-task the OS refuses to launch Settings at all, so every
            // step would dead-end at its final tap.
            if (isLockTaskActive(activity)) {
                logRefusal(activity, "lock task is active")
                withdrawNow()
                return
            }

            val inputs = inputs(activity)
            val armed = SetupCeremonyMath.nextKey(inputs.map { it.state })
            val alreadyUp = current(activity) != null

            // ⚠️ THE ADB-PROVISIONED CASE. An installer that pre-granted
            // everything over adb — and any screen set up before this
            // shipped — reaches here with every step satisfied, so
            // `armed` is null, nothing is on screen, and nothing is put
            // on screen. Zero UI, byte-for-byte the same outcome as v1's
            // `nextStep() == null` branch. Do not "helpfully" show a
            // confirmation here; that would put a full-screen panel over
            // working signage on every boot of a healthy fleet.
            if (armed == null && !alreadyUp && !forced) {
                logCompletionOnce(activity)
                return
            }
            if (armed != null && hiddenForSession && !forced) return
            if (forced) hiddenForSession = false

            val view = ensureView(activity, decorate)
            // Every render is a human moment — a first open, a tap, or a
            // return from Settings — so it resets the idle stand-down.
            lastTouchedAtMs = SystemClock.elapsedRealtime()
            val model = SetupCeremonyMath.buildModel(inputs)
            view.render(model)

            if (model.mode == SetupCeremonyMath.ChecklistMode.COMPLETE && !afterLaunch) {
                logCompletionOnce(activity)
                scheduleAutoDismiss(model.optionalOutstanding > 0)
            } else {
                mainHandler.removeCallbacks(autoDismiss)
            }
            armGuard()
        } catch (t: Throwable) {
            // Setup is never worth taking the player down for.
            PlayerLogger.w(TAG, "resume failed: ${t.message}")
        }
    }

    /** The operator asked to run one step's grant. */
    private fun fire(activity: Activity, key: String, decorate: (View) -> Unit) {
        val step = STEPS.firstOrNull { it.prefKey == key } ?: return
        hiddenForSession = false

        // Marked BEFORE the launch, exactly as v1 marked before showing
        // its dialog: a process death with a system page up must not
        // leave the step un-offered forever (that is the nag-on-every-
        // boot bug). Rolled back below when nothing actually opened.
        markOffered(activity, key)

        val result = try {
            step.launch(activity)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "step $key: launch threw: ${t.message}")
            LaunchResult.Failed("This screen could not open that settings page.")
        }

        when (result) {
            is LaunchResult.Direct -> {
                notes.remove(key)
                recordLaunch(activity, key, LAUNCH_DIRECT)
                PlayerLogger.i(TAG, "step $key: launched grant UI")
            }
            is LaunchResult.Fallback -> {
                notes[key] = result.note
                recordLaunch(activity, key, LAUNCH_FALLBACK)
                PlayerLogger.i(TAG, "step $key: direct page missing — ${result.note}")
            }
            is LaunchResult.Failed -> {
                // Nothing was shown, so this step was never really
                // offered — clear the marker so it can be retried rather
                // than being silently lost forever.
                clearOffered(activity, key)
                notes[key] = result.note
                recordLaunch(activity, key, LAUNCH_FAILED)
                PlayerLogger.w(TAG, "step $key: launch failed — ${result.note}")
            }
        }

        // Re-render immediately so the row tells the truth even in the
        // cases where we never leave the app (failed / rate-limited).
        render(activity, decorate, forced = true, afterLaunch = result !is LaunchResult.Failed)
    }

    /** "Not now", or the remote's Back key. */
    private fun dismissByOperator(activity: Activity) {
        // v1's "Later" semantics, preserved: deferring ADVANCES past the
        // armed step instead of stalling on it, so the sequence still
        // terminates. After at most one pass every step is marked and the
        // checklist stops appearing on its own — exactly as v1 went quiet
        // once all six had been offered.
        val armed = SetupCeremonyMath.nextKey(snapshot(activity))
        if (armed != null) {
            markOffered(activity, armed)
            PlayerLogger.i(TAG, "step $armed: deferred by operator")
        }
        // P3 (2026-08-25) — "did somebody walk away from this?" is a
        // question only the panel can answer, and on a wide rollout it is
        // the difference between "that site is fine" and "that site has 40
        // half-provisioned screens". Recorded here and reported with the
        // capability probe; see [telemetryJson].
        try {
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_DISMISSED_AT, System.currentTimeMillis()).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not record the dismissal: ${t.message}")
        }
        hiddenForSession = true
        detach(activity)
    }

    /**
     * What this screen's setup actually achieved — the P3 half of the
     * v1.1.5 evidence wave, reported inside the display-capability probe
     * (see `DisplayCapabilityProbe`'s `setup` section) so it lands in
     * `screen_device_inventory` with no new endpoint and no manifest-path
     * cost.
     *
     * The question it answers, which nothing could answer before: on a
     * panel NOBODY IS STANDING NEXT TO, how far did the ceremony get, and
     * where did it get stuck? A `launch` of "fallback"/"failed" is the
     * vendor-lost case the operator hit by hand on the first install (the
     * invisible "all admin permissions" menu) — at fleet scale that is a
     * per-SKU fact worth knowing before the next site.
     *
     * PURE READ. It prompts nothing, opens nothing, and must never throw:
     * a probe that can crash is a probe that gets removed.
     */
    fun telemetryJson(ctx: Context): JSONObject = try {
        val states = snapshot(ctx)
        val (done, total) = SetupCeremonyMath.progress(states)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val steps = org.json.JSONArray()
        STEPS.forEach { step ->
            val state = states.firstOrNull { it.key == step.prefKey }
            steps.put(
                JSONObject()
                    .put("key", step.prefKey)
                    .put("name", step.name)
                    .put("applies", state?.applies ?: false)
                    // ⚠️ For `managerInstallPromptShown` this is ALWAYS
                    // false and that is not a bug — no unprivileged API can
                    // read another package's appop. Read it together with
                    // `offered`/`launch` for that row, never alone.
                    .put("held", state?.satisfied ?: false)
                    .put("offered", state?.offered ?: false)
                    .put("optional", step.optional)
                    .put("launch", prefs.getString(launchKey(step.prefKey), null) ?: JSONObject.NULL),
            )
        }
        JSONObject()
            .put("granted", done)
            .put("required", total)
            .put("complete", done >= total)
            .put("dismissedAtMs", prefs.getLong(KEY_DISMISSED_AT, 0L).takeIf { it > 0L } ?: JSONObject.NULL)
            .put("steps", steps)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "setup telemetry failed: ${t.message}")
        JSONObject().put("error", t.message ?: t.javaClass.simpleName)
    }

    /**
     * A one-line summary of where this screen stands, for the log and for
     * the diagnostics surface. Pure read — no prompting.
     */
    fun statusLine(ctx: Context): String {
        val states = snapshot(ctx)
        val (done, total) = SetupCeremonyMath.progress(states)
        // The COUNT is core-only (that is what "complete" means), but the
        // outstanding LIST names every applicable grant that is not held,
        // advanced ones marked with a trailing `?`. A log line that hid the
        // demoted grants would make a panel that genuinely wants one look
        // fully provisioned — the count is the promise, the list is the
        // truth.
        val outstanding = SetupCeremonyMath.applicable(states)
            .filterNot { it.satisfied }
            .joinToString(",") { if (it.optional) "${it.key}?" else it.key }
        return "setup $done/$total granted" +
            if (outstanding.isEmpty()) "" else " (outstanding: $outstanding)"
    }

    /**
     * Read every step's live situation once, with its row copy attached.
     * Each probe is individually guarded — one OEM ROM throwing out of a
     * PackageManager call must not take the whole ceremony down with it.
     */
    private fun inputs(ctx: Context): List<SetupCeremonyMath.ChecklistInput> = STEPS.map { step ->
        SetupCeremonyMath.ChecklistInput(
            state = StepState(
                key = step.prefKey,
                applies = safeBool { step.appliesTo(ctx) },
                satisfied = safeBool { step.isSatisfied(ctx) },
                offered = wasOffered(ctx, step.prefKey),
                optional = step.optional,
            ),
            name = step.name,
            why = step.why,
            hint = step.hint,
            note = notes[step.prefKey],
        )
    }

    private fun snapshot(ctx: Context): List<StepState> = inputs(ctx).map { it.state }

    private fun logCompletionOnce(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("setupCeremonyLogged", false)) return
        prefs.edit().putBoolean("setupCeremonyLogged", true).apply()
        PlayerLogger.i(TAG, "no steps outstanding — ${statusLine(ctx)}")
    }

    private fun logRefusal(activity: Activity, reason: String) {
        if (current(activity) != null) {
            PlayerLogger.i(TAG, "checklist withdrawn — $reason")
        } else {
            PlayerLogger.i(TAG, "skipped — $reason")
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // the checklist view's lifecycle
    // ─────────────────────────────────────────────────────────────────

    /** The live checklist for [activity], or null. */
    private fun current(activity: Activity): SetupChecklistView? {
        val view = viewRef?.get() ?: return null
        // A view belonging to a previous Activity instance, or one that
        // has already been removed from its window, is not ours to reuse.
        if (view.context !== activity || view.parent == null) {
            viewRef = null
            return null
        }
        return view
    }

    private fun ensureView(activity: Activity, decorate: (View) -> Unit): SetupChecklistView {
        current(activity)?.let { return it }
        val view = SetupChecklistView(
            activity,
            onGrant = { key -> fire(activity, key, decorate) },
            onSecondary = { dismissByOperator(activity) },
            decorate = decorate,
        )
        // android.R.id.content is the frame `setContentView` fills, so
        // adding here lands ON TOP of the kiosk WebView without touching
        // activity_main.xml or its binding.
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        root.addView(
            view,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        view.requestFocus()
        viewRef = WeakReference(view)
        PlayerLogger.i(TAG, "checklist opened — ${statusLine(activity)}")
        return view
    }

    private val autoDismiss = Runnable {
        val view = viewRef?.get()
        val activity = view?.context as? Activity
        if (activity != null) {
            PlayerLogger.i(TAG, "checklist closed — ${statusLine(activity)}")
            detach(activity)
        }
    }

    /** Idempotent — re-arming on every resume just resets the timer. */
    private fun scheduleAutoDismiss(hasOutstandingOptional: Boolean = false) {
        mainHandler.removeCallbacks(autoDismiss)
        mainHandler.postDelayed(
            autoDismiss,
            if (hasOutstandingOptional) COMPLETE_WITH_OPTIONAL_LINGER_MS else COMPLETE_LINGER_MS,
        )
    }

    /**
     * While the checklist is up, keep checking that it is still allowed
     * to be. An emergency hold can land with the app already foregrounded
     * — no onResume fires then — and this surface covers the alert.
     */
    private val guardTick = object : Runnable {
        override fun run() {
            val view = viewRef?.get()
            val activity = view?.context as? Activity
            if (activity == null || activity.isFinishing || activity.isDestroyed) {
                // The host went away without a detach — drop everything.
                withdrawNow()
                return
            }
            val held = try {
                DisplayEmergency.isHeld(activity.applicationContext)
            } catch (_: Throwable) {
                false
            }
            if (held || isLockTaskActive(activity)) {
                PlayerLogger.i(
                    TAG,
                    "checklist withdrawn — " +
                        if (held) "emergency hold is active" else "lock task is active",
                )
                detach(activity)
                return
            }
            // Stand down over an abandoned panel so setup chrome can
            // never camp on live signage. Does NOT advance the sequence
            // — see IDLE_STAND_DOWN_MS.
            val idleFor = SystemClock.elapsedRealtime() - lastTouchedAtMs
            if (lastTouchedAtMs > 0L && idleFor > IDLE_STAND_DOWN_MS) {
                PlayerLogger.i(
                    TAG,
                    "checklist stood down — untouched for ${idleFor / 1000}s; " +
                        "it will offer the same step on the next boot",
                )
                hiddenForSession = true
                detach(activity)
                return
            }
            mainHandler.postDelayed(this, GUARD_TICK_MS)
        }
    }

    private fun armGuard() {
        mainHandler.removeCallbacks(guardTick)
        mainHandler.postDelayed(guardTick, GUARD_TICK_MS)
    }

    private fun cancelTimers() {
        mainHandler.removeCallbacks(guardTick)
        mainHandler.removeCallbacks(autoDismiss)
    }

    // ─────────────────────────────────────────────────────────────────
    // markers
    // ─────────────────────────────────────────────────────────────────

    private fun wasOffered(ctx: Context, key: String): Boolean = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key, false)
    } catch (_: Throwable) {
        false
    }

    private fun markOffered(ctx: Context, key: String) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(key, true).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist marker $key: ${t.message}")
        }
    }

    /**
     * What happened the last time we tried to open this step's system page:
     * [LAUNCH_DIRECT] (the exact page opened), [LAUNCH_FALLBACK] (this
     * panel hides it; a broader page opened) or [LAUNCH_FAILED] (nothing
     * opened at all). PERSISTED, unlike the transient [notes] — the whole
     * value of "this SKU hides its Modify-system-settings page" is that it
     * survives to the fleet report and to the next site.
     */
    private fun recordLaunch(ctx: Context, key: String, outcome: String) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(launchKey(key), outcome).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist launch outcome for $key: ${t.message}")
        }
    }

    private fun launchKey(key: String): String = "setupLaunch.$key"

    private fun clearOffered(ctx: Context, key: String) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(key, false).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not clear marker $key: ${t.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // per-grant probes + launches — every one guarded, none may throw
    // ─────────────────────────────────────────────────────────────────

    private inline fun safeBool(body: () -> Boolean): Boolean = try {
        body()
    } catch (_: Throwable) {
        false
    }

    /**
     * Open [direct]; if this panel does not have that page, open the
     * closest BROADER page that always exists and say so on the row.
     *
     * ⚠️ Why a try/catch and not `resolveActivity`: from API 30 package
     * VISIBILITY filtering can return null for a Settings page that would
     * in fact open, and silently downgrading a working direct page to a
     * generic one is worse than the problem. A thrown
     * ActivityNotFoundException is the unambiguous signal, and it is the
     * same pattern the battery + HOME steps have always used.
     */
    private fun openWithFallback(
        activity: Activity,
        direct: Intent,
        fallback: Intent?,
        fallbackNote: String,
        failedNote: String,
    ): LaunchResult {
        try {
            activity.startActivity(direct)
            return LaunchResult.Direct
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "direct page ${direct.action} unavailable: ${t.message}")
        }
        if (fallback == null) return LaunchResult.Failed(failedNote)
        return try {
            activity.startActivity(fallback)
            LaunchResult.Fallback(fallbackNote)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "fallback page ${fallback.action} unavailable: ${t.message}")
            LaunchResult.Failed(failedNote)
        }
    }

    /** The Apps list — the broadest page every "Special app access" lives under. */
    private fun appsSettings(): Intent =
        Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun canRequestInstalls(ctx: Context, pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true
        else if (pkg != ctx.packageName) false // unanswerable for another package
        else ctx.packageManager.canRequestPackageInstalls()
    } catch (_: Throwable) {
        false
    }

    private fun openInstallSources(activity: Activity, pkg: String, label: String): LaunchResult =
        openWithFallback(
            activity,
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:$pkg"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            appsSettings(),
            "This panel hides the direct page — opening Apps settings; " +
                "look for \"Install unknown apps\" → $label.",
            "This panel would not open its Apps settings.",
        )

    private fun installedManager(ctx: Context): String? = MANAGER_PACKAGES.firstOrNull { pkg ->
        try {
            @Suppress("DEPRECATION")
            ctx.packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun canWriteSettings(ctx: Context): Boolean = try {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            Settings.System.canWrite(ctx.applicationContext)
    } catch (_: Throwable) {
        false
    }

    private fun isIgnoringBatteryOptimizations(ctx: Context): Boolean = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) true
        else {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false
        }
    } catch (_: Throwable) {
        false
    }

    /**
     * The single-dialog request needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in
     * the manifest (declared). Some OEM ROMs strip that Activity entirely —
     * fall back to the whitelist LIST screen, which always exists, rather
     * than dead-ending the step. Same two intents as v1; the difference is
     * that the fallback is now REPORTED instead of silent.
     */
    @Suppress("BatteryLife") // sanctioned: a kiosk is mains-powered and must never be dozed
    private fun requestBatteryExemption(activity: Activity): LaunchResult = openWithFallback(
        activity,
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${activity.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        "This panel hides the direct page — opening the battery list; " +
            "switch to All apps and pick Venue OS Player.",
        "This panel would not open its battery settings.",
    )

    /**
     * Device-admin enrolment goes through [DeviceAdminEnrollment], which
     * owns the prompt debounce and the declined cooldown and answers with
     * a JSON verdict rather than throwing. Translate that verdict:
     *
     *  - ok            → the system prompt is up.
     *  - prompt-unavailable → the known live case (a stripped ROM, or a
     *    locked task) where the ADD_DEVICE_ADMIN activity refuses to
     *    launch. THIS is the operator's "one menu wasnt even visible":
     *    open Security settings and name what to look for.
     *  - anything else → its own rate limit, not a missing page. Say what
     *    it said; do not open some other screen and pretend.
     */
    private fun requestDeviceAdmin(activity: Activity): LaunchResult {
        val raw = DeviceAdminEnrollment.requestEnrollment(
            activity,
            DeviceAdminEnrollment.SOURCE_INTENT,
        )
        PlayerLogger.i(TAG, "device-admin enrolment from ceremony: $raw")
        val verdict = try {
            JSONObject(raw)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "unreadable enrolment verdict: ${t.message}")
            return LaunchResult.Failed("Could not open the screen-off permission.")
        }
        if (verdict.optBoolean("ok", false)) return LaunchResult.Direct

        val message = verdict.optString("message")
            .ifBlank { "This panel would not show the screen-off prompt." }
        if (verdict.optString("code") != "prompt-unavailable") return LaunchResult.Failed(message)

        return try {
            activity.startActivity(
                Intent(Settings.ACTION_SECURITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            LaunchResult.Fallback(
                "This panel hides the direct prompt — opening Security settings; " +
                    "look for \"Device admin apps\".",
            )
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "security settings unavailable: ${t.message}")
            LaunchResult.Failed(message)
        }
    }

    private fun isActiveAdmin(ctx: Context): Boolean = try {
        DeviceAdminEnrollment.isActiveAdmin(ctx.applicationContext)
    } catch (_: Throwable) {
        false
    }

    private fun managerIsDeviceOwner(ctx: Context): Boolean = try {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE)
            as? android.app.admin.DevicePolicyManager
        dpm != null && MANAGER_PACKAGES.any { dpm.isDeviceOwnerApp(it) }
    } catch (_: Throwable) {
        false
    }

    private fun isPlayerTheHomeApp(ctx: Context): Boolean = try {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val res = ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        res?.activityInfo?.packageName == ctx.packageName
    } catch (_: Throwable) {
        false
    }

    /**
     * Enable our own KioskHomeAlias so Player becomes a selectable Home
     * candidate. Toggling our OWN component needs no permission. The alias
     * ships DISABLED precisely so we never register as a launcher on an
     * OEM-CMS box unless the operator opts in right here.
     *
     * The alias CLASS name is namespace-relative — it does NOT pick up the
     * `.debug` applicationIdSuffix — while the PACKAGE is the runtime
     * applicationId. Build the ComponentName from those two explicitly.
     */
    private fun enableKioskHomeAlias(ctx: Context) {
        try {
            ctx.packageManager.setComponentEnabledSetting(
                ComponentName(ctx.packageName, "com.educms.player.KioskHomeAlias"),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP,
            )
            PlayerLogger.i(TAG, "KioskHomeAlias enabled (operator opt-in)")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "enableKioskHomeAlias failed: ${t.message}")
        }
    }

    private fun isLockTaskActive(activity: Activity): Boolean = try {
        com.educms.player.security.LockTaskController.isActive(activity)
    } catch (_: Throwable) {
        false
    }
}
