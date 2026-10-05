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
import com.educms.player.BuildConfig
import com.educms.player.display.DeviceAdminEnrollment
import com.educms.player.display.DisplayEmergency
import com.educms.player.led.LedCanvasHost
import com.educms.player.led.LedSystemPromptBanner
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

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
 * ── v4, 2026-09-01 — ONE GRANT ADDED, ON FIELD EVIDENCE ───────────────
 *
 * | grant                        | verdict | evidence                        |
 * |------------------------------|---------|---------------------------------|
 * | overlay ("Display over other apps") | ADDED, CORE | Two Goodview panels (API 30 with a VENDOR device owner, API 33 with none) installed an OTA and never relaunched — the operator walked to each one. Android 10+ silently drops a background `startActivity` unless the app is HOME, is/has a device owner, or holds this. The device-owner slot is the vendor's and HOME is the guest step we ask for LAST, so this is the one route that is both available and cheap. Auto-skipped when already held or when the ROM ships no overlay page. |
 *
 * It is inserted BEFORE HOME, never after: HOME stays last for the reason
 * its own comment gives. And a screen that finished its ceremony before
 * this shipped gets ONE brief, self-closing offer of this single step on
 * the first boot after the upgrade — see the post-upgrade offer section
 * below and `SetupCeremonyMath`'s v4 block.
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
 * ── v7, 2026-10-05 (1.1.23) — THE X80 LOOP ──────────────────────────
 *
 * Owner on a VisionCore X80 (Goodview firmware on an RK3328), remote only:
 * Enter on the card opened a GOOGLE WEB PAGE, Back came back to the same
 * card, and the D-pad "could not get anywhere else" — power cycle the only
 * way out. Four rules came out of it:
 *
 *  - A button opens a page only when the ROM resolves its intent to a
 *    system Settings-type app, and it opens THAT component explicitly — no
 *    browser, no search app, no chooser. See [SettingsPagePolicy].
 *  - A step whose page this screen does not have is shown as "not available
 *    on this screen — skipped", never armed and never a button; a page that
 *    fails to open marks the step unavailable for this firmware instead of
 *    re-arming it (1.1.22 cleared the marker on a failure, which is a loop).
 *  - The second button is "Skip this step": it advances and the card stays.
 *    Back closes the card until the screen restarts (persisted).
 *  - While a person is away in a system screen we sent them to, the
 *    background relaunch paths do not pull the player over it
 *    ([yieldRelaunchToSetup] / `SetupCeremonyMath.SETUP_AWAY_YIELD_MS`).
 *
 * THREADING (v7): every PackageManager / DevicePolicyManager / PowerManager
 * read the card needs runs on ONE background thread (`setup-facts`) and the
 * result is posted back to the main thread, which only builds the model and
 * the views. A click is answered from the last facts the card was drawn
 * from — no binder call sits between a key press and the screen. Everything
 * else (the view, the timers, the markers) is main-thread-only as before.
 */
object SetupCeremony {

    private const val TAG = "SetupCeremony"
    private const val PREFS = "edu_player"

    /** Package names the Manager companion may be installed under. */
    private val MANAGER_PACKAGES = listOf("com.educms.manager", "com.educms.manager.debug")

    /**
     * How long a card with NOTHING left to do stays up before the screen
     * clears itself, and WHICH cards get a fuse at all, both live in
     * `SetupCeremonyMath.autoDismissMs` — one decision, unit-tested,
     * readable from the model.
     *
     * ⚠️ v1.1.12 (field report G65-A, 2026-09-01) retired the 12-second
     * "COMPLETE with optional outstanding" fuse that used to live here. A
     * card the operator still has work on does not close itself at all now;
     * its backstop is [IDLE_STAND_DOWN_MS] below. Do not reintroduce a
     * second timer here — the whole failure was a fuse the model could
     * not see.
     */

    /** Wall-clock of the last "Not now" / Back. See [telemetryJson]. */
    private const val KEY_DISMISSED_AT = "setupDismissedAtMs"

    /**
     * Back closed the card "until the screen restarts" (v1.1.23): the boot
     * count and `elapsedRealtime` at that moment. See
     * `SetupCeremonyMath.hiddenUntilReboot`.
     */
    private const val KEY_HIDDEN_BOOT = "setupHiddenBootCount"
    private const val KEY_HIDDEN_ELAPSED = "setupHiddenElapsedMs"

    /**
     * `setupUnavailable.<step>` = the `Build.FINGERPRINT` on which that step's
     * page refused to open. While the firmware is the same the step is shown
     * as unavailable and never armed; a firmware update asks again.
     */
    private const val KEY_UNAVAILABLE_PREFIX = "setupUnavailable."

    /** `setupSkipped.<step>` — the operator pressed "Skip this step". Telemetry only. */
    private const val KEY_SKIPPED_PREFIX = "setupSkipped."

    /**
     * Placeholders in a step's copy, replaced with the app's REAL label on
     * this box ("VenueOS Player"), so every row names the exact entry the
     * operator will see in the system list.
     */
    private const val PLAYER_TOKEN = "{player}"
    private const val MANAGER_TOKEN = "{manager}"
    private const val PLAYER_LABEL_FALLBACK = "VenueOS Player"
    private const val MANAGER_LABEL_FALLBACK = "VenueOS Manager"

    /** The relaunch-grant step's marker — also the key the offer renders. */
    private const val KEY_OVERLAY_STEP = "overlayPromptShown"

    /**
     * The versionCode the post-upgrade relaunch-grant offer last made a
     * decision for. 0 means "never decided", which is BOTH a fresh install
     * and the first boot of the build that introduced this marker — the two
     * are told apart by whether the screen has been through the ceremony
     * before. See `SetupCeremonyMath.shouldOfferRelaunchGrant`.
     */
    private const val KEY_RELAUNCH_GRANT_CHECK_VC = "last_relaunch_grant_check_vc"

    /** The versionCode an operator last tapped "Not now" on that offer. */
    private const val KEY_RELAUNCH_GRANT_DECLINED_VC = "relaunchGrantDeclinedVc"

    /**
     * How long the post-upgrade offer stays up unattended.
     *
     * It sits over LIVE SIGNAGE, so this is a fuse, not a dialog: 30 s is a
     * comfortable read of two lines plus a decision, and short enough that
     * an unattended panel is back to nothing-on-screen inside half a minute.
     * Auto-continuing is NOT a decline — it simply means nobody was there;
     * the offer is still marked as OFFERED so it cannot come back as a nag,
     * and the thing that tells a REMOTE operator is the RELAUNCH_BLOCKED
     * ota-state report, not another card on the glass.
     */
    private const val OFFER_COUNTDOWN_MS = 30_000L

    /** Countdown repaint cadence. One second, one TextView. */
    private const val OFFER_TICK_MS = 1_000L

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
     * until a human finishes it or explicitly skips it. Burning steps on a
     * timer is how a screen ends up permanently half-granted with nobody
     * ever told.
     */
    private const val IDLE_STAND_DOWN_MS = 10L * 60L * 1000L

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * The one thread every binder read for the card runs on (v1.1.23). Single
     * so reads never overlap; daemon so it can never hold a dying process.
     */
    private val factsExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "setup-facts").apply { isDaemon = true }
    }

    /**
     * The facts the card on glass was last drawn from. Written on the main
     * thread only (in [requestFacts]'s post), read by the click handlers —
     * which is what keeps every binder call off the path between a key press
     * and the screen.
     */
    @Volatile
    private var latestFacts: SetupFacts? = null

    /** Newest facts request; an older one that lands late is dropped. Main thread. */
    private var factsGeneration = 0L

    /** A FORCED request was superseded before it landed — the newer one inherits it. */
    private var forcedPending = false

    /**
     * `elapsedRealtime` when MainActivity paused with the card on glass — the
     * operator left it for a system screen (one of ours, or their own HOME
     * press). 0 = they did not, or they are back. Read cross-thread by the
     * relaunch paths; see [relaunchShouldYield].
     */
    @Volatile
    private var awayFromCardSinceMs: Long = 0L

    /**
     * The live checklist, weakly — a static strong reference to a View
     * pins its Activity. While it is attached the content root holds it;
     * once detached it is collectable. [detach] makes that deterministic.
     */
    private var viewRef: WeakReference<SetupChecklistView>? = null

    /**
     * Set by Back / "Done". Suppresses the checklist for the rest of this
     * process; Back ALSO persists "until the screen restarts" (v1.1.23), so a
     * process restart does not bring it straight back. The explicit re-open
     * routes ignore both.
     */
    private var hiddenForSession = false

    /**
     * Transient per-row messages from the last launch attempt ("this
     * panel hides the direct page…"). Describes what just happened, not
     * what is true, so it is deliberately not persisted. Main thread only.
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

    /**
     * The post-upgrade relaunch-grant offer has already had its ONE decision
     * this process. Not persisted — [KEY_RELAUNCH_GRANT_CHECK_VC] is what
     * makes it once-per-UPGRADE; this only stops the same resume-driven
     * check re-running on every Settings round-trip.
     */
    private var relaunchOfferDecided = false

    /** The card currently up is the post-upgrade offer, not the checklist. */
    private var offerActive = false

    /** `elapsedRealtime` the offer closes itself at. */
    private var offerDeadlineMs: Long = 0L

    /** What actually happened when we tried to open a grant's system page. */
    private sealed class LaunchResult {
        /** The exact page opened. */
        object Direct : LaunchResult()

        /** The direct page does not exist here; a broader page opened. */
        data class Fallback(val note: String) : LaunchResult()

        /**
         * Nothing opened. [pageMissing] = the page itself refused on this
         * firmware (the step becomes unavailable here); false = a rate limit
         * or a cooldown that says nothing about the page.
         */
        data class Failed(val note: String, val pageMissing: Boolean) : LaunchResult()
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
     *                    `{player}` / `{manager}` become the apps' real labels.
     * @param appliesTo   is this step meaningful on THIS box at all?
     * @param isSatisfied is the grant already held? Live state beats the pref.
     * @param direct      the page the button opens.
     * @param fallback    the broader page used when [direct] is missing or is
     *                    not a Settings app here; null = none.
     * @param fallbackNote what the row says when only [fallback] opens: which
     *                    entry to look for there.
     * @param beforeLaunch run just before the page opens (HOME enables our alias).
     * @param viaDeviceAdminEnrollment the page is opened by
     *                    [DeviceAdminEnrollment], which owns its debounce and
     *                    declined cooldown.
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
        val direct: (Context) -> Intent,
        val fallback: ((Context) -> Intent)? = null,
        val fallbackNote: String = "",
        val beforeLaunch: ((Activity) -> Unit)? = null,
        val viaDeviceAdminEnrollment: Boolean = false,
        val optional: Boolean = false,
        // ⚠️ `promptKeys` REMOVED IN 1.1.15. It carried "Press OK · Back to
        // skip" into the LED-poster banner, and the only hardware that
        // banner runs on has NO REMOTE — a NovaStar poster's sole input is a
        // USB mouse, and the pointer is invisible outside the 320 px column.
        // Telling an installer to press a key that does not exist is worse
        // than saying nothing. The banner now states what is open and gives
        // a clickable way back; see LedSystemPromptBanner. Do not
        // reintroduce key copy on this path.
    )

    // ─────────────────────────────────────────────────────────────────
    // the steps, in the order they are offered
    //
    // ⚠️ ORDER AND INTENTS ARE LOAD-BEARING AND UNCHANGED FROM v1. v7 only
    // changed HOW an intent is opened (explicitly, after asking the ROM what
    // answers it) — never which one.
    // ─────────────────────────────────────────────────────────────────

    private val STEPS: List<Step> = listOf(
        // 1 ─ Player installs its own updates. Everything OTA depends on it.
        Step(
            prefKey = "installPromptShown",
            name = "Install updates",
            why = "Lets $PLAYER_TOKEN install its own updates",
            hint = "Switch on $PLAYER_TOKEN, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Install unknown apps → $PLAYER_TOKEN.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O },
            isSatisfied = { ctx -> canRequestInstalls(ctx, ctx.packageName) },
            direct = { ctx -> installSourcesIntent(ctx.packageName) },
            fallback = { appsSettings() },
            fallbackNote = "This screen has no direct page — the button opens Apps; " +
                "look for \"Install unknown apps\" → $PLAYER_TOKEN.",
        ),
        // 2 ─ ADVANCED (demoted 2026-08-25 — see the header's per-grant
        //     table). The Manager companion installs Player updates in the
        //     background. Manager has no Activity of its own, so Player is
        //     the only process that can open Settings on its behalf.
        //
        //     ⚠️ v1.1.23 — IT IS READ NOW. Up to 1.1.22 this said "no
        //     unprivileged API can read another package's appop" and was a
        //     hard `false`, so the row sat at "○ Needed" with the Manager's
        //     toggle ON behind it — the X80 owner's "items not checked are
        //     already enabled when you pop up the menu". `AppOpsManager
        //     .checkOpNoThrow(op, uid, pkg)` reads exactly the mode that
        //     toggle writes, for any package this app can see (the Manager is
        //     in `<queries>`); see [PermissionFactsReader]. Where a ROM
        //     refuses the read, the answer is "unknown" and the row stays
        //     "○ Needed" (and tappable), as before.
        //
        //     WHY IT IS NO LONGER ON THE HAPPY PATH, in evidence:
        //       * ZERO Player-side runtime consumer. The grant is consumed
        //         inside the Manager APK (ManagerSelfUpdateWorker.kt:142
        //         `canRequestPackageInstalls()` → :150 "Manager update
        //         blocked"). Player's own OTA never touches it — see
        //         OtaUpdateWorker's v1.0.53 note: "Player ALWAYS runs the
        //         OTA flow (no more bailing when Manager is installed)",
        //         and step 1 above is the grant that path actually needs.
        //       * `isSatisfied` WAS a hard `false` (until v1.1.23), so on a
        //         WIDE rollout this row would have pinned every provisioned
        //         panel at "5 of 6" FOREVER. A completion count that cannot
        //         complete is worse than no count, and it is paid on every
        //         panel — and an unreadable answer still cannot complete.
        //       * Manager's silent-install value lands only where Manager is
        //         DEVICE OWNER (ManagerApp.kt:184/:250) — a factory-reset
        //         path this fleet has ruled out.
        //     It stays reachable under "Optional" for the Manager-owner
        //     deployments where it does still pay.
        Step(
            prefKey = "managerInstallPromptShown",
            name = "Background updates",
            why = "Lets $MANAGER_TOKEN (the companion service) apply updates with nobody at the screen",
            hint = "Switch on $MANAGER_TOKEN, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Install unknown apps → $MANAGER_TOKEN.",
            appliesTo = { ctx ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && installedManager(ctx) != null
            },
            isSatisfied = { ctx ->
                installedManager(ctx)?.let { PermissionFactsReader.managerInstallAllowed(ctx, it) } == true
            },
            direct = { ctx -> installSourcesIntent(installedManager(ctx) ?: MANAGER_PACKAGES.first()) },
            fallback = { appsSettings() },
            fallbackNote = "This screen has no direct page — the button opens Apps; " +
                "look for \"Install unknown apps\" → $MANAGER_TOKEN.",
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
        //     (already done); this is the grant itself. On the X80 the
        //     direct page is MISSING (launch = fallback, 2026-10-05) and the
        //     grant was made through the Apps page — the fallback earns its
        //     place.
        Step(
            prefKey = "writeSettingsPromptShown",
            name = "Brightness control",
            why = "Brightness control needs \"Modify system settings\" for $PLAYER_TOKEN",
            hint = "Switch on $PLAYER_TOKEN, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Modify system settings → $PLAYER_TOKEN.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> canWriteSettings(ctx) },
            direct = { ctx ->
                Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS)
                    .setData(Uri.parse("package:${ctx.packageName}"))
            },
            fallback = { appsSettings() },
            fallbackNote = "This screen has no direct page — the button opens Apps; " +
                "pick $PLAYER_TOKEN and look for \"Modify system settings\".",
        ),
        // 4 ─ Battery-optimisation exemption. A signage box is idle by
        //     definition, which is exactly what an OEM power-saver targets:
        //     deferred alarms (the on/off schedule), a frozen heartbeat, a
        //     killed OTA worker. Exempting us keeps the screen answering.
        Step(
            prefKey = "batteryExemptPromptShown",
            name = "Keep Venue OS running",
            why = "Stops battery saver pausing updates and on/off schedules for $PLAYER_TOKEN",
            hint = "Choose \"Allow\" for $PLAYER_TOKEN, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Battery optimization → " +
                "All apps → $PLAYER_TOKEN → Don't optimize.",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> isIgnoringBatteryOptimizations(ctx) },
            direct = { ctx -> batteryRequestIntent(ctx.packageName) },
            fallback = { Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) },
            fallbackNote = "This screen has no direct page — the button opens the battery list; " +
                "switch to All apps and pick $PLAYER_TOKEN.",
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
            why = "Real panel sleep on a schedule, by $PLAYER_TOKEN. Not needed for Blank — " +
                "that already works on every screen",
            hint = "Tap Activate on the system prompt. Can't find it? On many panels: " +
                "Settings → Security → Device admin apps → \"Turn this screen off\" ($PLAYER_TOKEN).",
            appliesTo = { true },
            isSatisfied = { ctx -> isActiveAdmin(ctx) },
            direct = { Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN) },
            fallback = { Intent(Settings.ACTION_SECURITY_SETTINGS) },
            fallbackNote = "This screen hides the direct prompt — the button opens Security; " +
                "look for \"Device admin apps\" → \"Turn this screen off\".",
            viaDeviceAdminEnrollment = true,
            optional = true,
        ),
        // 6 ─ SYSTEM_ALERT_WINDOW, "Display over other apps". ADDED
        //     2026-09-01, and placed HERE — immediately before HOME, never
        //     after it, because HOME is last by product decision (see the
        //     comment on step 7).
        //
        //     WHY IT EARNS ITS TAP, in evidence from the live fleet: two
        //     Goodview panels — one Android 11 carrying a VENDOR device owner
        //     that is not ours, one Android 13 with no device owner at all —
        //     installed an OTA and the app never relaunched. The operator
        //     walked to each panel. Android 10+ SILENTLY drops a
        //     `startActivity` from a background process (no exception, no
        //     result code) unless the app is the default HOME, holds THIS, or
        //     is / has a device owner. On this fleet the device-owner slot is
        //     already taken by the vendor and HOME is the guest step we ask
        //     for last — so this grant is the one route that is both
        //     available and cheap.
        //
        //     ⚠️ IT IS THE PAIR TO STEP 7, NOT A REPLACEMENT. HOME makes the
        //     OS relaunch us; this makes OUR OWN relaunch legal. A panel that
        //     grants either one comes back by itself; a panel that grants
        //     neither needs a human, which is what
        //     `RelaunchEscalation` now reports as RELAUNCH_BLOCKED instead of
        //     logging "relaunched …" over a dead screen.
        //
        //     ⚠️ WE DO NOT DRAW OVERLAYS AND MUST NOT START. The grant is
        //     held for the background-activity-start exemption alone. If a
        //     future change adds a real overlay window, re-audit this copy —
        //     the row promises exactly one thing.
        //
        //     ⚠️ ANDROID 11 OPENS THE LIST. From API 30 the page ignores the
        //     `package:` and shows every app; the hint says to pick ours.
        Step(
            prefKey = "overlayPromptShown",
            name = "Relaunch itself after updates",
            why = "Lets $PLAYER_TOKEN bring itself back on screen after updates — " +
                "hands-free updates need this",
            hint = "Pick $PLAYER_TOKEN if a list opens, switch it on, then press Back. " +
                "Can't find it? On many panels: " +
                "Settings → Apps → Special app access → Display over other apps → $PLAYER_TOKEN.",
            // No SDK floor to check — the overlay appop and its Settings
            // page are both API 23+ and this module's minSdk is 24. What CAN
            // be missing is the page itself: a ROM that ships no overlay
            // screen would dead-end this step at its final tap, which is
            // exactly what `appliesTo` is for.
            appliesTo = { ctx -> overlayPageResolves(ctx) },
            isSatisfied = { ctx -> canDrawOverlays(ctx) },
            direct = { ctx ->
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                    .setData(Uri.parse("package:${ctx.packageName}"))
            },
            fallback = { appsSettings() },
            fallbackNote = "This screen has no direct page — the button opens Apps; " +
                "look for \"Display over other apps\" → $PLAYER_TOKEN.",
        ),
        // 7 ─ HOME app. LAST on purpose: this is the step that registers us
        //     as a launcher candidate, and on an OEM-CMS box we are a guest.
        //     It is also what makes an OTA self-update come back on screen by
        //     itself (the OS only auto-relaunches HOME).
        Step(
            prefKey = "homeSetupPromptShown",
            name = "Come back after updates",
            why = "Makes $PLAYER_TOKEN the Home app, so it returns by itself after an update or reboot",
            hint = "Pick $PLAYER_TOKEN, then press Back. Can't find it? On many panels: " +
                "Settings → Apps → Default apps → Home app.",
            // Under a device owner HOME is pinned for us already.
            appliesTo = { ctx -> !managerIsDeviceOwner(ctx) },
            isSatisfied = { ctx -> isPlayerTheHomeApp(ctx) },
            direct = { Intent(Settings.ACTION_HOME_SETTINGS) },
            fallback = { Intent(Settings.ACTION_SETTINGS) },
            fallbackNote = "This screen has no direct page — the button opens Settings; " +
                "look for \"Home app\" under Apps → Default apps.",
            beforeLaunch = { act ->
                act.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putBoolean("kioskHomeOptIn", true).apply()
                enableKioskHomeAlias(act)
            },
        ),
    )

    // ─────────────────────────────────────────────────────────────────
    // the facts a card is drawn from
    // ─────────────────────────────────────────────────────────────────

    /**
     * Everything the card needs, read in ONE pass on the `setup-facts`
     * thread. The main thread only ever consumes a finished snapshot.
     */
    internal data class SetupFacts(
        val inputs: List<SetupCeremonyMath.ChecklistInput>,
        /** What each not-yet-held applicable step's button would open. */
        val routes: Map<String, SettingsPagePolicy.StepRoute>,
        val hardwareClass: SetupCeremonyMath.HardwareClass,
        val overlayGranted: Boolean,
        val isHomeApp: Boolean,
        val playerLabel: String,
        val managerLabel: String?,
        /** Packages that answer a plain https link here (web browsers). */
        val browsers: Set<String>,
        /** `Settings.Global.BOOT_COUNT` when read; -1 = this ROM keeps none. */
        val bootCount: Int,
        val readAtElapsedMs: Long,
        /** Every permission, for the Player AND the Manager (v1.1.23). */
        val permissions: List<PermissionRow> = emptyList(),
        /** The installed Manager package, or null. */
        val managerPackage: String? = null,
    ) {
        val states: List<StepState> get() = inputs.map { it.state }
    }

    /**
     * Read every step's live situation once, with its row copy attached.
     * Each probe is individually guarded — one OEM ROM throwing out of a
     * PackageManager call must not take the whole ceremony down with it.
     *
     * ⚠️ THE HARDWARE CLASS IS CONSULTED FIRST (2026-09-02, v1.1.15) and it
     * can only ever REMOVE a step. `notApplicableReason` is null for every
     * key on [SetupCeremonyMath.HardwareClass.GENERIC], so the `applies`
     * expression below is byte-identical to what it was on every non-poster
     * box; on a NovaStar poster every key answers non-null, so `applies` is
     * false for all seven, `nextKey` is null, `progress` is 0-of-0, and
     * [renderWith]'s adb-provisioned branch returns with nothing on screen.
     *
     * ⚠️ BINDER CALLS. Never on the main thread — see the THREADING note.
     */
    internal fun readFacts(ctx: Context): SetupFacts {
        val app = ctx.applicationContext
        val hardware = hardwareClass(app)
        val manager = installedManager(app)
        val playerLabel = SetupFactsReader.appLabel(app, app.packageName) ?: PLAYER_LABEL_FALLBACK
        val managerLabel = manager?.let { SetupFactsReader.appLabel(app, it) ?: MANAGER_LABEL_FALLBACK }
        val browsers = SetupFactsReader.browserPackages(app)
        val own = setOf(app.packageName) + MANAGER_PACKAGES
        val fingerprint = Build.FINGERPRINT
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val routes = LinkedHashMap<String, SettingsPagePolicy.StepRoute>()

        fun copy(text: String): String = text
            .replace(PLAYER_TOKEN, playerLabel)
            .replace(MANAGER_TOKEN, managerLabel ?: MANAGER_LABEL_FALLBACK)

        // v1.1.23 — every permission for BOTH apps, the way the Settings
        // toggles show them. A row whose permission the Manager holds and the
        // Player does not says so (the X80's "it is already switched on").
        val permissions = try {
            PermissionFactsReader.read(app, manager)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "reading permission facts failed: ${t.message}")
            emptyList()
        }
        val managerNotes: Map<String, String> = permissions.mapNotNull { row ->
            val key = row.stepKey ?: return@mapNotNull null
            PermissionFactsMath.managerHoldsNote(row, playerLabel, managerLabel ?: MANAGER_LABEL_FALLBACK)
                ?.let { key to it }
        }.toMap()

        val inputs = STEPS.map { step ->
            val notApplicable = SetupCeremonyMath.notApplicableReason(hardware, step.prefKey)
            val applies = notApplicable == null && safeBool { step.appliesTo(app) }
            val satisfied = safeBool { step.isSatisfied(app) }
            val route = if (applies && !satisfied) routeFor(app, step, browsers, own) else null
            if (route != null) routes[step.prefKey] = route
            val failedHere = try {
                prefs.getString(KEY_UNAVAILABLE_PREFIX + step.prefKey, null) == fingerprint
            } catch (_: Throwable) {
                false
            }
            val unavailableReason = when {
                !applies || satisfied -> null
                failedHere -> SetupCeremonyMath.UNAVAILABLE_LAUNCH_FAILED
                route != null && !route.available -> unavailableWords(route.refusal)
                else -> null
            }
            SetupCeremonyMath.ChecklistInput(
                state = StepState(
                    key = step.prefKey,
                    applies = applies,
                    satisfied = satisfied,
                    offered = wasOffered(app, step.prefKey),
                    optional = step.optional,
                    notApplicableReason = notApplicable,
                    unavailable = unavailableReason != null,
                    unavailableReason = unavailableReason,
                ),
                name = step.name,
                why = copy(step.why),
                hint = copy(step.hint),
                // The standing facts a row carries: which app holds the
                // grant (when it is the Manager and not the Player), and what
                // a fallback route opens. A transient launch note from the
                // main thread is laid over these at render.
                note = listOfNotNull(
                    managerNotes[step.prefKey]?.takeIf { !satisfied },
                    route?.takeIf { it.available && it.viaFallback }?.let { copy(step.fallbackNote) },
                ).joinToString(" ").ifBlank { null },
            )
        }
        return SetupFacts(
            inputs = inputs,
            routes = routes,
            hardwareClass = hardware,
            overlayGranted = safeBool { canDrawOverlays(app) },
            isHomeApp = safeBool { isPlayerTheHomeApp(app) },
            playerLabel = playerLabel,
            managerLabel = managerLabel,
            browsers = browsers,
            bootCount = SetupFactsReader.bootCount(app),
            readAtElapsedMs = SystemClock.elapsedRealtime(),
            permissions = permissions,
            managerPackage = manager,
        )
    }

    /**
     * The `permissions` section of the capability report (v1.1.23): every
     * permission the card or the display layer depends on, for BOTH apps,
     * read the way the system menu shows it, plus who the box's HOME is. Raw
     * facts — the card's own conclusions are in the `setup` section.
     *
     * PURE READ, never throws; bridge thread (binder calls).
     */
    fun permissionsJson(ctx: Context): JSONObject = try {
        val app = ctx.applicationContext
        val manager = installedManager(app)
        PermissionFactsReader.json(
            app,
            playerLabel = SetupFactsReader.appLabel(app, app.packageName) ?: PLAYER_LABEL_FALLBACK,
            managerPkg = manager,
            managerLabel = manager?.let { SetupFactsReader.appLabel(app, it) ?: MANAGER_LABEL_FALLBACK },
        )
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "permission facts failed: ${t.message}")
        JSONObject().put("error", t.message ?: t.javaClass.simpleName)
    }

    /** The route one step's button takes on this box. Background thread. */
    private fun routeFor(
        ctx: Context,
        step: Step,
        browsers: Set<String>,
        own: Set<String>,
    ): SettingsPagePolicy.StepRoute {
        val direct = try {
            SettingsPagePolicy.decide(SetupFactsReader.resolve(ctx, step.direct(ctx), browsers), own)
        } catch (t: Throwable) {
            SettingsPagePolicy.decide(IntentResolution(emptyList(), null), own)
        }
        val fallback = step.fallback?.let { builder ->
            try {
                SettingsPagePolicy.decide(SetupFactsReader.resolve(ctx, builder(ctx), browsers), own)
            } catch (t: Throwable) {
                null
            }
        }
        return SettingsPagePolicy.route(direct, fallback)
    }

    /** Plain words for a step this screen cannot do. */
    private fun unavailableWords(refusal: PageDecision.Refuse?): String = when (refusal?.code) {
        SettingsPagePolicy.REFUSE_NOT_SETTINGS -> {
            // "…sends this to com.android.chrome — not a Settings app" →
            // name the app as the box names it when we know it; the package
            // otherwise.
            val app = refusal.reason.substringAfter("sends this page to ", "")
                .substringBefore(" — ", "")
                .ifBlank { null }
            SetupCeremonyMath.unavailableNotSettings(app)
        }
        else -> SetupCeremonyMath.UNAVAILABLE_NO_PAGE
    }

    /**
     * Ask for fresh facts and continue on the main thread with them.
     *
     * The newest request wins: a slow read that lands after a newer one was
     * asked for is dropped, so a card can never be drawn from facts older
     * than the ones it was last drawn from. A superseded FORCED request hands
     * its force to the newer one — the operator's explicit "open setup" must
     * never be lost to a resume that happened to land a moment later.
     */
    private fun requestFacts(
        activity: Activity,
        forced: Boolean,
        then: (SetupFacts, Boolean) -> Unit,
    ) {
        val generation = ++factsGeneration
        forcedPending = forcedPending || forced
        val app = activity.applicationContext
        val ref = WeakReference(activity)
        try {
            factsExecutor.execute {
                val facts = try {
                    readFacts(app)
                } catch (t: Throwable) {
                    PlayerLogger.w(TAG, "reading setup facts failed: ${t.message}")
                    null
                }
                mainHandler.post {
                    if (generation != factsGeneration) return@post
                    val act = ref.get() ?: return@post
                    val force = forcedPending
                    forcedPending = false
                    if (facts == null) return@post
                    latestFacts = facts
                    if (act.isFinishing || act.isDestroyed) return@post
                    try {
                        then(facts, force)
                    } catch (t: Throwable) {
                        // Setup is never worth taking the player down for.
                        PlayerLogger.w(TAG, "setup render failed: ${t.message}")
                    }
                }
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not schedule a setup facts read: ${t.message}")
        }
    }

    /** The snapshot's inputs with this process's transient launch notes laid over them. */
    private fun withNotes(inputs: List<SetupCeremonyMath.ChecklistInput>): List<SetupCeremonyMath.ChecklistInput> =
        inputs.map { input ->
            val transient = notes[input.state.key]
            if (transient == null) input else input.copy(note = transient)
        }

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
    fun resume(activity: Activity, decorate: (View) -> Unit) {
        // ⚠️ v1.1.11 (TC22 field test, 2026-09-01): a LIVE offer card owns
        // its own lifetime — the 30 s fuse, its buttons, and the stand-down
        // guard. A resume cycle landing while it is up (a redundant relaunch
        // rung's onNewIntent, the Manager's install prompt stealing and
        // returning focus, a notification shade) must leave it alone.
        // Without this, the second resume fell through to render(), which
        // killed the fuse and replaced the card the operator was READING
        // with whatever the full-checklist model said — on TC22 that was a
        // near-instant flip back to content. The offer was then spent
        // (marked offered, once per versionCode), so it never came back.
        // Emergency safety is NOT weakened: the guard tick armed when the
        // card went up keeps enforcing mustStandDown the whole time.
        if (offerActive) return
        if (mustStandDown(activity)) return
        requestFacts(activity, forced = false) { facts, forced ->
            if (offerActive) return@requestFacts
            // 2026-09-01 — the post-upgrade relaunch-grant offer gets first
            // refusal, and ONLY from here. It is deliberately not reachable
            // from [open] (the explicit re-entry always shows the full list,
            // and an open that a resume superseded keeps its force) and it
            // hands back to the normal render whenever it is not due, so a
            // boot that has nothing to offer behaves exactly as before.
            if (!forced) {
                if (maybeOfferRelaunchGrant(activity, decorate)) return@requestFacts
            }
            renderWith(activity, decorate, forced = forced, afterLaunch = false, facts = facts)
        }
    }

    /**
     * Open the checklist on demand, even when nothing is outstanding and
     * even after Back closed it.
     *
     * This is the RE-ENTRY point for a partially-granted panel: a tech at
     * the box, the dashboard's "Open setup on this panel", or the
     * provisioning script, raises it with one line and no APK change (see
     * MainActivity's `ACTION_OPEN_SETUP` header). The emergency and
     * lock-task refusals still apply — nothing re-opens setup chrome over a
     * live alert.
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
        // The poster banner belongs to the ceremony; it never outlives it —
        // and a life-safety withdrawal takes EVERY piece of setup chrome
        // off the glass, this strip included.
        LedSystemPromptBanner.dismiss("setup chrome withdrawn")
        awayFromCardSinceMs = 0L
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
     *                    after Back closed it — the explicit re-open path.
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
        if (mustStandDown(activity)) return
        requestFacts(activity, forced) { facts, force ->
            renderWith(activity, decorate, forced = force, afterLaunch = afterLaunch, facts = facts)
        }
    }

    /** The body of [render], on the main thread, from one facts snapshot. */
    private fun renderWith(
        activity: Activity,
        decorate: (View) -> Unit,
        forced: Boolean,
        afterLaunch: Boolean,
        facts: SetupFacts,
    ) {
        try {
            if (mustStandDown(activity)) return

            // Whatever brought us here — a tap, a Settings round-trip, a
            // later resume — this is the full checklist, not the offer. Stop
            // the fuse before it can close a card the operator is using.
            endOfferMode()

            val inputs = withNotes(facts.inputs)
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
                logCompletionOnce(activity, facts)
                return
            }
            // v1.1.23 — Back holds until the screen restarts, across a
            // process restart too. Only an explicit re-open ignores it.
            if (armed != null && !forced && !alreadyUp &&
                (hiddenForSession || hiddenUntilReboot(activity, facts))
            ) {
                return
            }
            if (forced) {
                hiddenForSession = false
                clearHiddenUntilReboot(activity)
            }

            val view = ensureView(activity, decorate, facts)
            // Every render is a human moment — a first open, a tap, or a
            // return from Settings — so it resets the idle stand-down.
            lastTouchedAtMs = SystemClock.elapsedRealtime()
            val model = SetupCeremonyMath.buildModel(inputs)
            view.render(model)

            if (model.mode == SetupCeremonyMath.ChecklistMode.COMPLETE && !afterLaunch) {
                logCompletionOnce(activity, facts)
            }
            // WHICH cards close themselves is the model's call (see
            // `SetupCeremonyMath.autoDismissMs`): only a card with nothing
            // outstanding at all. A COMPLETE card with optional rows still
            // to do stays up and is bounded by [IDLE_STAND_DOWN_MS] instead
            // — the operator at G65 lost the optional section to the fuse
            // this removes. `afterLaunch` still suppresses every fuse: that
            // timer would run while the operator is away in Settings and the
            // card would be gone when they came back.
            val lingerMs = SetupCeremonyMath.autoDismissMs(model)
            if (lingerMs != null && !afterLaunch) {
                scheduleAutoDismiss(lingerMs)
            } else {
                mainHandler.removeCallbacks(autoDismiss)
            }
            armGuard()
        } catch (t: Throwable) {
            // Setup is never worth taking the player down for.
            PlayerLogger.w(TAG, "resume failed: ${t.message}")
        }
    }

    /**
     * The three reasons setup chrome must not be on this screen right now.
     *
     * Extracted 2026-09-01 so the post-upgrade offer is governed by exactly
     * the same refusals as the checklist — an alert must never have to be
     * defended twice, in two places, by two people remembering to.
     */
    private fun mustStandDown(activity: Activity): Boolean {
        if (activity.isFinishing || activity.isDestroyed) {
            detach(activity)
            return true
        }
        // ⚠️ Never put setup chrome over a live alert. v1 only refused
        // to OPEN a dialog here; a persistent full-screen checklist
        // has to withdraw as well, because it covers the WebView the
        // emergency renders in. Same rule, applied to a surface that
        // can outlive the moment it was shown.
        if (DisplayEmergency.isHeld(activity.applicationContext)) {
            logRefusal(activity, "emergency hold is active")
            withdrawNow()
            return true
        }
        // In lock-task the OS refuses to launch Settings at all, so every
        // step would dead-end at its final tap.
        if (isLockTaskActive(activity)) {
            logRefusal(activity, "lock task is active")
            withdrawNow()
            return true
        }
        return false
    }

    // ─────────────────────────────────────────────────────────────────
    // the post-upgrade relaunch-grant offer (2026-09-01)
    //
    // See SetupCeremonyMath's v4 block for WHY. Short version: two panels
    // installed an OTA and never came back on screen, because Android 10+
    // silently drops a background `startActivity` unless the app is HOME,
    // is/has a device owner, or holds "Display over other apps". The grant
    // is now a ceremony step — but a screen that finished its ceremony
    // BEFORE this shipped will never meet that step in a flow it already
    // completed, and that is exactly the fleet with the problem. So the
    // first resume after a package replace offers that one step, briefly.
    // ─────────────────────────────────────────────────────────────────

    /**
     * @return true when the offer took the screen (the caller must not
     *         render the checklist on top of it).
     *
     * Reads the facts the caller just fetched ([latestFacts]) — no binder
     * call here.
     */
    private fun maybeOfferRelaunchGrant(activity: Activity, decorate: (View) -> Unit): Boolean = try {
        val facts = latestFacts
        if (relaunchOfferDecided || facts == null) {
            false
        } else {
            val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val currentVc = BuildConfig.VERSION_CODE.toLong()
            val lastHandled = prefs.getLong(KEY_RELAUNCH_GRANT_CHECK_VC, 0L)
            if (lastHandled == currentVc) {
                // Already decided for this build on an earlier boot.
                relaunchOfferDecided = true
                false
            } else {
                val states = facts.states
                val offerFacts = SetupCeremonyMath.RelaunchGrantFacts(
                    lastHandledVc = lastHandled,
                    currentVc = currentVc,
                    // "Has this screen been through the ceremony before?" —
                    // `offered` and not `satisfied`, because an adb
                    // provisioning script can satisfy a grant on a screen
                    // that has never seen our checklist.
                    previouslyProvisioned = states.any {
                        it.key != KEY_OVERLAY_STEP && it.offered
                    },
                    overlayGranted = facts.overlayGranted,
                    isHomeApp = facts.isHomeApp,
                    declinedVc = prefs.getLong(KEY_RELAUNCH_GRANT_DECLINED_VC, 0L),
                    // A step that does not apply here is not a question to
                    // ask (2026-09-02): a ROM with no overlay Settings page,
                    // or a NovaStar poster where ViPlex's auto-launch
                    // already owns the relaunch. `renderRelaunchOffer` also
                    // refuses to paint in that case — this stops the offer
                    // being SPENT and mis-logged as "due" first. v1.1.23: a
                    // step this screen cannot do counts as not applying.
                    overlayStepApplies = states.firstOrNull {
                        it.key == KEY_OVERLAY_STEP
                    }?.let { it.applies && !it.unavailable } ?: false,
                )
                // ⚠️ THE FULL CHECKLIST OUTRANKS THE OFFER — but only for
                // work that is NOT this grant. A panel caught mid-ceremony by
                // an OTA still has a real armed step, and the list (which now
                // CONTAINS the relaunch-grant row in its proper place) is
                // strictly better than a 30-second card. But when the ONLY
                // thing armed is the new row itself, the list would park a
                // full checklist over a customer's live board on a 10-minute
                // fuse — for one grant, on a screen that was already finished.
                // That case is exactly what the brief 30-second offer is for.
                val armed = SetupCeremonyMath.nextKey(states)
                val ceremonyHasOtherWork = armed != null && armed != KEY_OVERLAY_STEP
                val due = SetupCeremonyMath.shouldOfferRelaunchGrant(offerFacts) &&
                    !ceremonyHasOtherWork

                // Recorded for THIS build either way — "handled" is the
                // decision, not the card. Without this a screen that declines
                // (or that we deliberately skip) re-runs the whole question on
                // every boot until the next upgrade.
                recordRelaunchGrantCheck(activity, currentVc)
                relaunchOfferDecided = true

                if (!due) {
                    PlayerLogger.i(
                        TAG,
                        "post-update relaunch-grant offer skipped — " +
                            "lastHandledVc=$lastHandled " +
                            "provisionedBefore=${offerFacts.previouslyProvisioned} " +
                            "overlay=${offerFacts.overlayGranted} home=${offerFacts.isHomeApp} " +
                            "stepApplies=${offerFacts.overlayStepApplies} " +
                            "declinedThisVc=${offerFacts.declinedVc == currentVc} " +
                            "otherWork=$ceremonyHasOtherWork",
                    )
                    false
                } else {
                    renderRelaunchOffer(activity, decorate)
                }
            }
        }
    } catch (t: Throwable) {
        // Never let this decide whether the player boots.
        PlayerLogger.w(TAG, "post-update relaunch-grant offer failed: ${t.message}")
        relaunchOfferDecided = true
        false
    }

    /** @return true when the card actually went on screen. */
    private fun renderRelaunchOffer(activity: Activity, decorate: (View) -> Unit): Boolean {
        if (mustStandDown(activity)) return false
        val facts = latestFacts ?: return false
        val input = facts.inputs.firstOrNull { it.state.key == KEY_OVERLAY_STEP }
        if (input == null || !input.state.applies || input.state.satisfied || input.state.unavailable) {
            // This ROM has no overlay page, or the grant is already held.
            return false
        }

        // ⚠️ PAINTING IT IS NOT OFFERING IT (v1.1.12, 2026-09-01).
        //
        // The [KEY_OVERLAY_STEP] offered-marker used to be written right
        // here, before the card was even on screen. An offer is something an
        // operator MEETS, and this card is painted into the loudest 60 seconds a
        // panel ever has: five independent relaunch actors fire in that
        // window (see the TC22 trace) and any one of them can recreate the
        // Activity out from under it. Spending the step on paint meant a
        // card that was destroyed in under a second still counted as asked
        // — the step went quiet forever and the panel that most needed the
        // grant was the one that never got to answer.
        //
        // The marker is now written where a DECISION happens:
        //   * [fire]                — the operator ran the grant.
        //   * [dismissByOperator]   — the operator tapped "Not now".
        //   * [offerTick] expiry    — nobody was there; the fuse burned out.
        // and NOT on Back ([hideByOperator]), which has burned nothing since
        // 2026-08-30, or on a card that was withdrawn without being seen.
        //
        // The anti-nag invariant is unchanged, because the case it guards —
        // an unattended card that auto-continues — still marks the step, on
        // expiry. What changes is that an INTERRUPTED card no longer counts
        // as an answer: the row stays outstanding and the normal checklist
        // arms it again on a later boot.

        val view = ensureView(activity, decorate, facts)
        lastTouchedAtMs = SystemClock.elapsedRealtime()
        offerActive = true
        offerDeadlineMs = SystemClock.elapsedRealtime() + OFFER_COUNTDOWN_MS
        view.render(
            SetupCeremonyMath.buildModel(
                withNotes(listOf(input)),
                headingOverride = SetupCeremonyMath.HEADING_AFTER_UPDATE,
                footnoteOverride = SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE,
                countdown = SetupCeremonyMath.countdownLine(
                    (OFFER_COUNTDOWN_MS / 1000L).toInt(),
                ),
                // On this card the second button is an answer about this
                // build ("Not now"), not a skip within a sequence.
                secondaryOverride = SetupCeremonyMath.NOT_NOW_LABEL,
            ),
        )
        mainHandler.removeCallbacks(autoDismiss)
        mainHandler.removeCallbacks(offerTick)
        mainHandler.postDelayed(offerTick, OFFER_TICK_MS)
        armGuard()
        PlayerLogger.i(
            TAG,
            "post-update relaunch-grant offered (vc=${BuildConfig.VERSION_CODE}, " +
                "closes in ${OFFER_COUNTDOWN_MS / 1000}s)",
        )
        return true
    }

    /**
     * Repaint the countdown, and close the card when it runs out.
     *
     * Auto-continue does NOT record a decline — nobody declined anything;
     * nobody was there. It DOES write the step's offered-marker (v1.1.12):
     * a card that stood its full 30 seconds unanswered is the "shown once"
     * this step needs, and marking it is what keeps the next boot from
     * opening the full checklist over live signage with the row armed. A
     * card torn down EARLY — a relaunch, an emergency hold, an Activity
     * recreate — writes nothing, because it was never met.
     */
    private val offerTick = object : Runnable {
        override fun run() {
            val view = viewRef?.get()
            val activity = view?.context as? Activity
            if (view == null || activity == null || !offerActive) {
                offerActive = false
                return
            }
            val remainingMs = offerDeadlineMs - SystemClock.elapsedRealtime()
            if (remainingMs <= 0L) {
                // THE FUSE BURNING OUT IS THE OFFER BEING SPENT (v1.1.12).
                // The card stood on glass for its full 30 seconds and nobody
                // answered — that IS the "shown once" this step needs, and
                // marking it here is what stops the next boot opening the
                // full checklist over live signage with this row armed. It
                // is deliberately the ONLY unattended path that marks: a
                // card torn down early by a relaunch, an emergency hold or
                // an Activity recreate was never met, and must not count.
                markOffered(activity, KEY_OVERLAY_STEP)
                PlayerLogger.i(
                    TAG,
                    "post-update relaunch-grant offer closed itself — nobody at the panel; " +
                        "it will not ask again until the next update",
                )
                offerActive = false
                detach(activity)
                return
            }
            // Round UP so a 30 s fuse reads "30s" on its first paint and
            // never flashes "0s" before it closes.
            view.updateCountdown(
                SetupCeremonyMath.countdownLine(((remainingMs + 999L) / 1000L).toInt()),
            )
            mainHandler.postDelayed(this, OFFER_TICK_MS)
        }
    }

    /** Leave offer mode without touching the view. */
    private fun endOfferMode() {
        offerActive = false
        mainHandler.removeCallbacks(offerTick)
    }

    private fun recordRelaunchGrantCheck(ctx: Context, vc: Long) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_RELAUNCH_GRANT_CHECK_VC, vc).apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist the relaunch-grant check: ${t.message}")
        }
    }

    /**
     * The explicit "Not now" on the offer card. Holds for THIS versionCode
     * only, so the question comes back after the next upgrade — a decline is
     * an answer about today's build, not a permanent opt-out.
     */
    private fun recordRelaunchGrantDecline(ctx: Context) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_RELAUNCH_GRANT_DECLINED_VC, BuildConfig.VERSION_CODE.toLong())
                .apply()
            PlayerLogger.i(
                TAG,
                "post-update relaunch-grant declined for vc=${BuildConfig.VERSION_CODE}",
            )
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist the relaunch-grant decline: ${t.message}")
        }
    }

    /**
     * The operator asked to run one step's grant.
     *
     * Answered from [latestFacts] — the facts the card on glass was drawn
     * from — so a key press costs no binder call and cannot be swallowed by
     * a slow PackageManager (v1.1.23).
     */
    private fun fire(activity: Activity, key: String, decorate: (View) -> Unit) {
        val step = STEPS.firstOrNull { it.prefKey == key } ?: return
        val facts = latestFacts
        if (facts == null) {
            render(activity, decorate, forced = true, afterLaunch = false)
            return
        }
        hiddenForSession = false
        val state = facts.inputs.firstOrNull { it.state.key == key }?.state

        // ── ADB-LESS PATH FIRST: never raise a dialog we do not need ──
        // (2026-09-02, 1.1.14). If the grant is ALREADY held, opening the
        // system page buys nothing and costs the operator a round trip into
        // a Settings screen they cannot see on an LED poster. Mark it
        // offered — it is satisfied, which is stronger — and re-render.
        // Live state beats the pref here exactly as it does in the model.
        if (state?.satisfied == true) {
            markOffered(activity, key)
            LedSystemPromptBanner.dismiss("grant already held — no system prompt needed")
            PlayerLogger.i(TAG, "step $key: already satisfied — no system page opened")
            render(activity, decorate, forced = true, afterLaunch = false)
            return
        }

        // ── v1.1.23: NOTHING TO OPEN IS NOT A BUTTON ──
        // The model never makes an unavailable row tappable, but a key press
        // can race a re-render. Say so and stay on the card — never open a
        // page we did not vet.
        val route = facts.routes[key]
        if (state?.unavailable == true || route == null || !route.available) {
            PlayerLogger.w(
                TAG,
                "step $key: nothing on this screen can open it " +
                    "(${route?.refusal?.reason ?: state?.unavailableReason ?: "no route"}) — not launching",
            )
            render(activity, decorate, forced = true, afterLaunch = false)
            return
        }

        // ── THE LED-POSTER ANNOUNCEMENT (2026-09-02, 1.1.14/1.1.15) ───
        // Android draws the page this step opens centred in the
        // controller's frame buffer, which on a 320×1080 poster is entirely
        // off the glass. Say IN THE COLUMN what is open and offer the
        // clickable way back, BEFORE we launch. No-op on every non-poster
        // device — there the page lands where it can be seen.
        //
        // ⚠️ NO KEY COPY IS PASSED (1.1.15): a poster has no remote, only a
        // mouse. It is also effectively unreachable on that hardware now —
        // every step is not-applicable there (SetupCeremonyMath's v6 block),
        // so a poster never launches a system page from the ceremony at all.
        // The call stays because THIS function is the one that opens system
        // pages, and the announcement belongs to the function, not to the
        // hardware that currently happens to reach it.
        LedSystemPromptBanner.announce(activity, step.name)

        // Marked BEFORE the launch, exactly as v1 marked before showing
        // its dialog: a process death with a system page up must not
        // leave the step un-offered forever (that is the nag-on-every-
        // boot bug). v1.1.23: and it is NEVER rolled back on a failure —
        // 1.1.22 cleared it, which re-armed the same step on the very next
        // render: the same button, the same dead page, forever.
        markOffered(activity, key)

        val result = try {
            launch(activity, step, route, facts)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "step $key: launch threw: ${t.message}")
            LaunchResult.Failed("This screen could not open that settings page.", pageMissing = true)
        }

        when (result) {
            is LaunchResult.Direct -> {
                notes.remove(key)
                recordLaunch(activity, key, LAUNCH_DIRECT)
                PlayerLogger.i(
                    TAG,
                    "step $key: launched grant UI ${route.handler?.packageName}/${route.handler?.activityName}",
                )
            }
            is LaunchResult.Fallback -> {
                notes[key] = result.note
                recordLaunch(activity, key, LAUNCH_FALLBACK)
                PlayerLogger.i(
                    TAG,
                    "step $key: direct page unavailable (${route.directRefusal?.reason}) — opened " +
                        "${route.handler?.packageName}/${route.handler?.activityName}",
                )
            }
            is LaunchResult.Failed -> {
                // Nothing opened, so the column must not claim a prompt is up.
                LedSystemPromptBanner.dismiss("launch failed — no system prompt opened")
                notes[key] = result.note
                recordLaunch(activity, key, LAUNCH_FAILED)
                if (result.pageMissing) markUnavailableOnThisFirmware(activity, key)
                PlayerLogger.w(TAG, "step $key: launch failed — ${result.note}")
            }
        }

        // Re-render immediately so the row tells the truth even in the
        // cases where we never leave the app (failed / rate-limited).
        render(activity, decorate, forced = true, afterLaunch = result !is LaunchResult.Failed)
    }

    /** Open [route] for [step]: explicitly, so no chooser and no other app can answer. */
    private fun launch(
        activity: Activity,
        step: Step,
        route: SettingsPagePolicy.StepRoute,
        facts: SetupFacts,
    ): LaunchResult {
        val handler = route.handler
            ?: return LaunchResult.Failed("Nothing on this screen opens this page.", pageMissing = true)
        val fallbackNote = step.fallbackNote
            .replace(PLAYER_TOKEN, facts.playerLabel)
            .replace(MANAGER_TOKEN, facts.managerLabel ?: MANAGER_LABEL_FALLBACK)
        if (step.viaDeviceAdminEnrollment && !route.viaFallback) {
            return requestDeviceAdmin(activity, step, route, fallbackNote, facts)
        }
        step.beforeLaunch?.invoke(activity)
        val base = if (route.viaFallback) step.fallback?.invoke(activity) else step.direct(activity)
        base ?: return LaunchResult.Failed("Nothing on this screen opens this page.", pageMissing = true)
        return try {
            activity.startActivity(explicit(base, handler))
            if (route.viaFallback) LaunchResult.Fallback(fallbackNote) else LaunchResult.Direct
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "page ${handler.packageName}/${handler.activityName} would not open: ${t.message}")
            LaunchResult.Failed("This screen would not open that settings page.", pageMissing = true)
        }
    }

    /** [intent] aimed at exactly [handler], in a new task. */
    private fun explicit(intent: Intent, handler: PageHandler): Intent =
        Intent(intent)
            .setClassName(handler.packageName, handler.activityName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * The remote's Back key — close the card until the screen restarts
     * (v1.1.23: persisted, so a process restart does not bring it straight
     * back). Since 2026-08-30 Back has never burned a step: the armed step is
     * untouched and re-offers on the next boot. Skipping is "Skip this step".
     */
    private fun hideByOperator(activity: Activity) {
        try {
            val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.edit()
                .putLong(KEY_DISMISSED_AT, System.currentTimeMillis())
                .putInt(KEY_HIDDEN_BOOT, latestFacts?.bootCount ?: -1)
                .putLong(KEY_HIDDEN_ELAPSED, SystemClock.elapsedRealtime())
                .apply()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not record the dismissal: ${t.message}")
        }
        PlayerLogger.i(TAG, "checklist closed by Back — armed step unchanged, re-offers after the next restart")
        hiddenForSession = true
        detach(activity)
    }

    /**
     * Back reached MainActivity instead of the card — focus had escaped to a
     * WebView behind it (v1.1.23). Same outcome as Back on the card: the
     * card closes, never a key that does nothing.
     *
     * @return true when a card was up and is now closed.
     */
    fun closeFromActivityBack(activity: Activity): Boolean {
        if (current(activity) == null) return false
        if (offerActive) {
            endOfferMode()
        }
        hideByOperator(activity)
        return true
    }

    /** "Done" on a card with nothing left armed, and "Not now" on the offer card. */
    private fun dismissByOperator(activity: Activity) {
        // On the post-upgrade offer card, "Not now" is a real answer about a
        // real build — persist it so the question holds until the NEXT
        // upgrade rather than coming back on the next boot.
        if (offerActive) recordRelaunchGrantDecline(activity)
        endOfferMode()
        // v1's "Later" semantics, preserved: deferring ADVANCES past the
        // armed step instead of stalling on it, so the sequence still
        // terminates. (On a "Done" card nothing is armed; on the offer card
        // this is the relaunch-grant row.)
        val armed = latestFacts?.let { SetupCeremonyMath.nextKey(it.states) }
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
     * "Skip this step" (v1.1.23) — advance past the armed step and STAY on
     * the card with the next one armed. The skipped row stays visible and
     * tappable (operator-initiated, so never a nag) and it is never armed
     * again on its own.
     */
    private fun skipByOperator(activity: Activity, decorate: (View) -> Unit) {
        val armed = latestFacts?.let { SetupCeremonyMath.nextKey(it.states) }
        if (armed != null) {
            markOffered(activity, armed)
            try {
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putBoolean(KEY_SKIPPED_PREFIX + armed, true).apply()
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "could not record the skip: ${t.message}")
            }
            notes.remove(armed)
            PlayerLogger.i(TAG, "step $armed: skipped by operator")
        }
        render(activity, decorate, forced = true, afterLaunch = false)
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
     * per-SKU fact worth knowing before the next site. v1.1.23 adds WHAT
     * each button opens on this ROM (`opens`), why a step is unavailable,
     * and the apps' real labels — the X80's Google page would have been on
     * the dashboard instead of a phone call.
     *
     * PURE READ. It prompts nothing, opens nothing, and must never throw:
     * a probe that can crash is a probe that gets removed. Called on the
     * bridge thread (the binder reads are why it must not be on main).
     */
    fun telemetryJson(ctx: Context): JSONObject = try {
        val facts = readFacts(ctx)
        val states = facts.states
        val (done, total) = SetupCeremonyMath.progress(states)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val steps = org.json.JSONArray()
        STEPS.forEach { step ->
            val state = states.firstOrNull { it.key == step.prefKey }
            val route = facts.routes[step.prefKey]
            steps.put(
                JSONObject()
                    .put("key", step.prefKey)
                    .put("name", step.name)
                    .put("applies", state?.applies ?: false)
                    // WHY it does not apply, when the hardware class is the
                    // reason (2026-09-02). Null on every generic Android
                    // box, and on a poster it is the difference between the
                    // dashboard reading "unprovisioned" and reading
                    // "finished — this grant belongs to NovaStar".
                    .put("reason", state?.notApplicableReason ?: JSONObject.NULL)
                    // ⚠️ For `managerInstallPromptShown` this is ALWAYS
                    // false and that is not a bug — no unprivileged API can
                    // read another package's appop. Read it together with
                    // `offered`/`launch` for that row, never alone.
                    .put("held", state?.satisfied ?: false)
                    .put("offered", state?.offered ?: false)
                    .put("optional", step.optional)
                    .put("launch", prefs.getString(launchKey(step.prefKey), null) ?: JSONObject.NULL)
                    .put("skipped", prefs.getBoolean(KEY_SKIPPED_PREFIX + step.prefKey, false))
                    .put("unavailable", state?.unavailableReason ?: JSONObject.NULL)
                    .put("opens", routeJson(route)),
            )
        }
        JSONObject()
            .put("granted", done)
            .put("required", total)
            .put("complete", done >= total)
            // Which applicability table produced the rows above. "GENERIC"
            // on every box that is not a NovaStar poster — i.e. the answer
            // every existing screen in the fleet reports.
            .put("hardwareClass", facts.hardwareClass.name)
            .put("dismissedAtMs", prefs.getLong(KEY_DISMISSED_AT, 0L).takeIf { it > 0L } ?: JSONObject.NULL)
            .put("hiddenUntilRestart", hiddenUntilReboot(ctx, facts))
            .put("playerLabel", facts.playerLabel)
            .put("managerLabel", facts.managerLabel ?: JSONObject.NULL)
            .put("browsers", org.json.JSONArray(facts.browsers.sorted().take(8)))
            .put("steps", steps)
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "setup telemetry failed: ${t.message}")
        JSONObject().put("error", t.message ?: t.javaClass.simpleName)
    }

    /** One step's route, for the report: what opens, or why nothing does. */
    private fun routeJson(route: SettingsPagePolicy.StepRoute?): Any {
        if (route == null) return JSONObject.NULL
        val out = JSONObject()
        val handler = route.handler
        if (handler != null) {
            out.put("package", handler.packageName)
                .put("activity", handler.activityName.takeLast(120))
                .put("via", if (route.viaFallback) "fallback" else "direct")
        }
        route.directRefusal?.let { out.put("directRefused", it.reason.take(160)) }
        route.refusal?.let { out.put("refused", it.reason.take(160)) }
        return out
    }

    /** A one-line summary for the log, from a snapshot. Pure read — no prompting. */
    private fun statusLine(facts: SetupFacts): String {
        val states = facts.states
        val (done, total) = SetupCeremonyMath.progress(states)
        // The COUNT is core-only (that is what "complete" means), but the
        // outstanding LIST names every applicable grant that is not held,
        // advanced ones marked with a trailing `?` and ones this screen
        // cannot do with a trailing `!`. A log line that hid the demoted
        // grants would make a panel that genuinely wants one look fully
        // provisioned — the count is the promise, the list is the truth.
        val outstanding = SetupCeremonyMath.applicable(states)
            .filterNot { it.satisfied }
            .joinToString(",") {
                when {
                    it.unavailable -> "${it.key}!"
                    it.optional -> "${it.key}?"
                    else -> it.key
                }
            }
        return "setup $done/$total granted" +
            if (outstanding.isEmpty()) "" else " (outstanding: $outstanding)"
    }

    /**
     * Which hardware class this box is, for the grant questions.
     *
     * Reads the SAME poster-class detector every native LED surface uses
     * (`LedCanvasHost.isPosterClass` → `LedCanvas.isPosterClass` over the
     * Build strings), so "this is a poster" cannot mean one thing to the
     * canvas pin and another to the ceremony. Guarded: an odd ROM throwing
     * out of a Build read must degrade to GENERIC — the behaviour every
     * panel had before v1.1.15 — never to a silent skip of every grant.
     */
    private fun hardwareClass(ctx: Context): SetupCeremonyMath.HardwareClass = try {
        if (LedCanvasHost.isPosterClass(ctx.applicationContext)) {
            SetupCeremonyMath.HardwareClass.NOVASTAR_POSTER
        } else {
            SetupCeremonyMath.HardwareClass.GENERIC
        }
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "hardware class read failed, treating as generic: ${t.message}")
        SetupCeremonyMath.HardwareClass.GENERIC
    }

    private fun logCompletionOnce(ctx: Context, facts: SetupFacts) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("setupCeremonyLogged", false)) return
        prefs.edit().putBoolean("setupCeremonyLogged", true).apply()
        PlayerLogger.i(TAG, "no steps outstanding — ${statusLine(facts)}")
    }

    private fun logRefusal(activity: Activity, reason: String) {
        if (current(activity) != null) {
            PlayerLogger.i(TAG, "checklist withdrawn — $reason")
        } else {
            PlayerLogger.i(TAG, "skipped — $reason")
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // the card and the relaunch paths (v1.1.23)
    // ─────────────────────────────────────────────────────────────────

    /**
     * MainActivity paused. If the card was on glass, a person just left it
     * for a system screen — one of ours, or their own HOME press — and the
     * background relaunch paths must keep their hands off the glass for a
     * while ([relaunchShouldYield]).
     */
    fun noteHostPaused() {
        awayFromCardSinceMs = if (isShowing()) SystemClock.elapsedRealtime() else 0L
    }

    /** MainActivity resumed: the person is back (or never left). */
    fun noteHostResumed() {
        awayFromCardSinceMs = 0L
    }

    /**
     * Must a background relaunch (Watchdog tick, post-OTA rung) leave the
     * glass alone right now? True while a person who left the setup card for
     * a system screen may still be working in it — bounded by
     * `SetupCeremonyMath.SETUP_AWAY_YIELD_MS`, and NEVER during an emergency.
     * Cheap, thread-safe, never throws.
     */
    fun relaunchShouldYield(ctx: Context): Boolean = try {
        SetupCeremonyMath.yieldRelaunchToSetup(
            awaySinceMs = awayFromCardSinceMs,
            nowElapsedMs = SystemClock.elapsedRealtime(),
            emergencyHeld = DisplayEmergency.isHeld(ctx.applicationContext),
        )
    } catch (_: Throwable) {
        false
    }

    // ─────────────────────────────────────────────────────────────────
    // the checklist view's lifecycle
    // ─────────────────────────────────────────────────────────────────

    /**
     * Is the checklist ON THE GLASS right now, for any Activity instance?
     *
     * 2026-09-02 (P0-2) — added for the boot diagnostic, which must never
     * raise itself over a ceremony an installer is actively working: two
     * full-screen cards fighting for D-pad focus on a panel whose only
     * input is a remote is the shape of the bug that bricked two units.
     * Deliberately instance-agnostic (unlike [current]): the question is
     * "is there setup chrome on this screen", not "is it mine".
     */
    fun isShowing(): Boolean = viewRef?.get()?.parent != null

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

    private fun ensureView(
        activity: Activity,
        decorate: (View) -> Unit,
        facts: SetupFacts,
    ): SetupChecklistView {
        current(activity)?.let { return it }
        val view = SetupChecklistView(
            activity,
            onGrant = { key -> fire(activity, key, decorate) },
            onSecondary = {
                // The offer card's second button is "Not now" (an answer
                // about this build); the checklist's is "Skip this step".
                if (offerActive) dismissByOperator(activity) else skipByOperator(activity, decorate)
            },
            onDone = { dismissByOperator(activity) },
            onBack = { hideByOperator(activity) },
            decorate = decorate,
        )
        // android.R.id.content is the frame `setContentView` fills, so
        // adding here lands ON TOP of the kiosk WebView without touching
        // activity_main.xml or its binding.
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        // 2026-09-02 (1.1.14) — pinned to the LED canvas on a poster-class
        // controller: TOP-LEFT, canvas-sized, because that column is the
        // only part of the 1920×1080 frame buffer the LED actually shows.
        // MATCH_PARENT everywhere else, byte-identical to before.
        LedCanvasHost.addPinned(root, view)
        view.requestFocus()
        viewRef = WeakReference(view)
        PlayerLogger.i(TAG, "checklist opened — ${statusLine(facts)}")
        return view
    }

    private val autoDismiss = Runnable {
        val view = viewRef?.get()
        val activity = view?.context as? Activity
        if (activity != null) {
            PlayerLogger.i(TAG, "checklist closed — ${latestFacts?.let { statusLine(it) } ?: "setup"}")
            detach(activity)
        }
    }

    /**
     * Idempotent — re-arming on every resume just resets the timer.
     *
     * Takes the delay rather than deciding it: whether a card self-closes,
     * and after how long, is `SetupCeremonyMath.autoDismissMs` — one
     * decision with a test, instead of a boolean whose meaning lived in a
     * ternary down here.
     */
    private fun scheduleAutoDismiss(delayMs: Long) {
        mainHandler.removeCallbacks(autoDismiss)
        mainHandler.postDelayed(autoDismiss, delayMs)
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
        endOfferMode()
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

    /**
     * The page refused to open on this exact firmware: show the step as
     * unavailable until the firmware changes. Replaces 1.1.22's
     * `clearOffered`, which re-armed the same dead step on the next render.
     */
    private fun markUnavailableOnThisFirmware(ctx: Context, key: String) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_UNAVAILABLE_PREFIX + key, Build.FINGERPRINT).apply()
            PlayerLogger.w(TAG, "step $key: marked unavailable on this firmware — it will not be armed again")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not persist unavailable marker for $key: ${t.message}")
        }
    }

    /** Did Back close the card during this boot of the box? Prefs read + the snapshot's boot count. */
    private fun hiddenUntilReboot(ctx: Context, facts: SetupFacts): Boolean = try {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        SetupCeremonyMath.hiddenUntilReboot(
            hiddenBootCount = prefs.getInt(KEY_HIDDEN_BOOT, -1),
            hiddenElapsedMs = prefs.getLong(KEY_HIDDEN_ELAPSED, 0L),
            nowBootCount = facts.bootCount,
            nowElapsedMs = SystemClock.elapsedRealtime(),
        )
    } catch (_: Throwable) {
        false
    }

    private fun clearHiddenUntilReboot(ctx: Context) {
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (prefs.contains(KEY_HIDDEN_ELAPSED)) {
                prefs.edit().remove(KEY_HIDDEN_BOOT).remove(KEY_HIDDEN_ELAPSED).apply()
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not clear the hidden marker: ${t.message}")
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

    /** The Apps list — the broadest page every "Special app access" lives under. */
    private fun appsSettings(): Intent = Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)

    private fun installSourcesIntent(pkg: String): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).setData(Uri.parse("package:$pkg"))

    /**
     * The single-dialog request needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in
     * the manifest (declared). Some OEM ROMs strip that Activity entirely —
     * the step then falls back to the whitelist LIST screen, which always
     * exists, rather than dead-ending. The fallback is REPORTED, not silent.
     */
    @Suppress("BatteryLife") // sanctioned: a kiosk is mains-powered and must never be dozed
    private fun batteryRequestIntent(pkg: String): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(Uri.parse("package:$pkg"))

    private fun canRequestInstalls(ctx: Context, pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true
        else if (pkg != ctx.packageName) false // unanswerable for another package
        else ctx.packageManager.canRequestPackageInstalls()
    } catch (_: Throwable) {
        false
    }

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

    /**
     * "Display over other apps" — held, or not. `canDrawOverlays` is API
     * 23+ and this module's minSdk is 24, so there is no version to guard.
     */
    private fun canDrawOverlays(ctx: Context): Boolean = try {
        Settings.canDrawOverlays(ctx.applicationContext)
    } catch (_: Throwable) {
        false
    }

    /**
     * Does this ROM ship the overlay-permission page at all?
     *
     * ⚠️ THE TRADE-OFF, stated so it is not re-litigated. This question is
     * asked with `resolveActivity` and the failure directions are one-sided:
     * a false negative only SKIPS the step, which leaves the panel exactly
     * where it is today (a human walks over after an update) and never
     * breaks anything that works. Offering a step that dead-ends at its
     * final tap is the outcome worth avoiding, because on a wide rollout it
     * is paid on every panel. (v1.1.23: the `<queries>` block now declares
     * this action, so API 30+ visibility filtering no longer hides it.)
     */
    private fun overlayPageResolves(ctx: Context): Boolean = try {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            .setData(Uri.parse("package:${ctx.packageName}"))
        ctx.packageManager.resolveActivity(intent, 0) != null
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
     * Device-admin enrolment goes through [DeviceAdminEnrollment], which
     * owns the prompt debounce and the declined cooldown and answers with
     * a JSON verdict rather than throwing. Translate that verdict:
     *
     *  - ok            → the system prompt is up.
     *  - prompt-unavailable → the known live case (a stripped ROM, or a
     *    locked task) where the ADD_DEVICE_ADMIN activity refuses to
     *    launch. THIS is the operator's "one menu wasnt even visible":
     *    open Security settings (vetted, explicit) and name what to look for.
     *  - anything else → its own rate limit, not a missing page. Say what
     *    it said; do not open some other screen and pretend.
     */
    private fun requestDeviceAdmin(
        activity: Activity,
        step: Step,
        route: SettingsPagePolicy.StepRoute,
        fallbackNote: String,
        facts: SetupFacts,
    ): LaunchResult {
        val handler = route.handler
            ?: return LaunchResult.Failed("Nothing on this screen opens this page.", pageMissing = true)
        val raw = DeviceAdminEnrollment.requestEnrollment(
            activity,
            DeviceAdminEnrollment.SOURCE_INTENT,
            ComponentName(handler.packageName, handler.activityName),
        )
        PlayerLogger.i(TAG, "device-admin enrolment from ceremony: $raw")
        val verdict = try {
            JSONObject(raw)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "unreadable enrolment verdict: ${t.message}")
            return LaunchResult.Failed("Could not open the screen-off permission.", pageMissing = false)
        }
        if (verdict.optBoolean("ok", false)) return LaunchResult.Direct

        val message = verdict.optString("message")
            .ifBlank { "This panel would not show the screen-off prompt." }
        if (verdict.optString("code") != "prompt-unavailable") {
            return LaunchResult.Failed(message, pageMissing = false)
        }
        // The prompt itself will not open here. The vetted fallback, if this
        // ROM has one, is the Security page — opened explicitly like every
        // other page, never as an implicit intent.
        val security = step.fallback?.invoke(activity)
            ?: return LaunchResult.Failed(message, pageMissing = true)
        val securityRoute = SettingsPagePolicy.decide(
            SetupFactsReader.resolve(activity, security, facts.browsers),
            setOf(activity.packageName) + MANAGER_PACKAGES,
        )
        val securityHandler = (securityRoute as? PageDecision.Open)?.handler
            ?: return LaunchResult.Failed(message, pageMissing = true)
        return try {
            activity.startActivity(explicit(security, securityHandler))
            LaunchResult.Fallback(fallbackNote)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "security settings unavailable: ${t.message}")
            LaunchResult.Failed(message, pageMissing = true)
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
     *
     * ⚠️ REFUSED OUTRIGHT ON A NOVASTAR POSTER (2026-09-02, v1.1.15). The
     * HOME role on that controller belongs to `com.nova.launcher`, and
     * ViPlex's "auto launch on startup" is what brings the player back —
     * taking the role would displace the vendor's own launcher on the
     * vendor's own box. The HOME step does not even apply there, so this
     * call is already unreachable from the ceremony; the guard is here
     * because `enableKioskHomeAlias` is a capability, and a capability that
     * must never fire on a hardware class refuses at the capability, not at
     * every future caller that remembers to ask.
     */
    private fun enableKioskHomeAlias(ctx: Context) {
        SetupCeremonyMath.homeRoleRefusal(hardwareClass(ctx))?.let { why ->
            PlayerLogger.i(TAG, "KioskHomeAlias REFUSED — $why")
            return
        }
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
