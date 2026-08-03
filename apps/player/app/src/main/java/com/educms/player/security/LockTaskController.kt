package com.educms.player.security

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * Android **lock task mode** for the kiosk shell — the structural answer to
 * "somebody physically at the screen escapes the WebView into the OS".
 *
 * ============================================================
 * WHY THIS EXISTS (2026-08-03)
 * ============================================================
 *
 * A hallway display's whole job is to be reachable by the lockdown /
 * weather / evacuation channel. A student with a $10 USB keyboard could
 * previously HOME out of the player into the OEM launcher, or reach the
 * player's own on-screen info overlay and unpair the screen — either way
 * taking that display off the emergency channel with nobody noticing.
 *
 * AND-004 briefly tried to solve this ONE LAYER TOO LATE, with an
 * on-device operator-PIN prompt in front of the destructive *bridge*
 * methods. That was reverted (see `OperatorPinGate`'s header): the unpair
 * runs SERVER-FIRST, so the gate protected nothing, and it failed CLOSED
 * with no provisioning path — permanently disabling the operator's only
 * on-device escape hatch on every deployed screen.
 *
 * Lock task mode fixes the actual problem: while the task is locked the
 * OS itself refuses HOME, Recents, the status bar and the notification
 * shade. There is nothing to gate, because there is nowhere to go.
 *
 * ============================================================
 * ⚠️ WE ARE A GUEST ON THE DEVICE, NOT THE HOST
 * ============================================================
 *
 * Read the long comment on `<activity android:name=".MainActivity">` in
 * `AndroidManifest.xml` before touching this file. On an OEM signage box
 * (Goodview / NovaStar / TCL) that ships its own CMS launcher, we are an
 * app the vendor's CMS starts. Pinning ourselves there would strand the
 * operator inside our app with the vendor's CMS, network settings and
 * reboot flow unreachable. **That must never happen.**
 *
 * So engagement requires BOTH of these, checked live on every attempt:
 *
 *  1. **The Manager companion is genuinely DEVICE OWNER**
 *     (`DevicePolicyManager.isDeviceOwnerApp`). Device owner can only be
 *     set on a freshly-factory-reset device via
 *     `adb shell dpm set-device-owner …` — i.e. it is proof that somebody
 *     deliberately provisioned this box as an EduCMS kiosk. This is the
 *     same signal `PlayerApp.maybeEnableKioskHomeAlias()` already uses to
 *     decide whether we may act as the HOME launcher.
 *
 *  2. **Manager has explicitly allow-listed us for lock task**
 *     (`DevicePolicyManager.isLockTaskPermitted`). Only a device owner /
 *     profile owner can put a package on that list, which Manager does in
 *     `ManagerApp.allowPlayerLockTask()`.
 *
 * Gate 2 is not redundant — it is what keeps us out of the DANGEROUS
 * variant of this API. `startLockTask()` on a NON-allow-listed package
 * silently degrades to **screen pinning** (`LOCK_TASK_MODE_PINNED`): the
 * "App is pinned" system dialog, no status bar, and an exit gesture
 * (hold Back + Overview) that **does not exist on a signage remote**.
 * That is exactly the trap the old `onResume()` comment warned about,
 * and it is why unconditional `startLockTask()` was removed years ago.
 * We never call `startLockTask()` unless gate 2 says the call will land
 * in the real, DO-managed `LOCK_TASK_MODE_LOCKED`.
 *
 * ============================================================
 * HOW AN OPERATOR GETS BACK OUT (all three are live)
 * ============================================================
 *
 *  1. **On-screen, no tools — the primary path.** The player's info
 *     overlay → "Exit to device home" runs
 *     `WebAppBridge.exitToDeviceHome()`, whose MainActivity lambda now
 *     calls [disengage] FIRST. Without that call `finishAffinity()` is a
 *     no-op inside a locked task and the operator is stuck; with it, the
 *     existing four-step OEM-launcher handoff works exactly as before.
 *
 *     Note the asymmetry: **`unpair` deliberately does NOT unpin.** It
 *     reloads our own page to the pairing splash and never tries to
 *     leave the task, so it does not need to — and making it unpin would
 *     hand the exact escalation this file exists to stop ("unpair, then
 *     walk out of the app") to whoever is standing at the screen.
 *
 *  2. **Automatic, when the screen is durably broken.** [disengage] is
 *     called by MainActivity's freshness watchdog after
 *     `WATCHDOG_UNPIN_AFTER_FAILURES` consecutive failed ticks (~30 min
 *     of a page that will not load). A kiosk whose WebView is dead cannot
 *     render the overlay in path 1, so pinning it would be a soft brick —
 *     this is the valve that makes that impossible. It re-engages by
 *     itself on the next successful page load.
 *
 *  3. **Technician, over ADB.** Removing the device owner drops gate 1
 *     and Android exits the locked task immediately:
 *
 *         adb shell dpm remove-active-admin \
 *           com.educms.manager/com.educms.manager.AdminReceiver
 *
 *     (append `.debug` to the package for a debug Manager). A blunter
 *     `adb shell pm uninstall com.educms.player` also works.
 *
 *  4. **MDM / provisioning kill switch, no code change.** Setting the
 *     `edu_player` SharedPreferences boolean [PREF_OPT_OUT] to `true`
 *     makes [engageIfPermitted] a permanent no-op on that device.
 *
 * A crash does NOT brick the device: the OS ends a locked task when its
 * activity stack dies, and on a DO-provisioned kiosk Player is the HOME
 * app, so the system relaunches it with a system-initiated launch. If it
 * cannot come back up, we never re-engage (engagement happens only after
 * a *successful* page load — see [engageIfPermitted]'s caller), so the
 * operator lands on a normal, fully-navigable device.
 *
 * ============================================================
 * WHAT THIS DELIBERATELY DOES NOT TOUCH
 * ============================================================
 *
 *  - **The emergency overlay.** It is rendered by the web player inside
 *    OUR WebView, in OUR activity. Lock task never sees it. Same for the
 *    `showUrlOverlay` WebView, the recovery overlay and every dialog —
 *    all are in-activity.
 *  - **OTA install + relaunch.** We only pin when Manager is device
 *    owner, and a DO's `PackageInstaller` session honours
 *    `USER_ACTION_NOT_REQUIRED` — installs are silent, so no third-party
 *    UI has to appear over a locked task. The install kills our process,
 *    which ends the locked task; the OS relaunches HOME (= Player) and we
 *    re-engage after the new build's first successful page load.
 *  - **`openSettingsForManager()`.** While locked, the OS will refuse to
 *    launch Settings. That is accepted, not a regression: that deep-link
 *    exists to grant "install unknown apps" on NON-device-owner boxes,
 *    and on a non-DO box we never pin in the first place.
 */
object LockTaskController {

    private const val TAG = "LockTaskController"
    private const val PREFS = "edu_player"

    /**
     * MDM / provisioning escape valve. When `true` in the `edu_player`
     * SharedPreferences, this device never pins, whatever the policy
     * state says. Deliberately has NO operator-facing UI — it exists so a
     * field problem can be defused without shipping an APK.
     */
    const val PREF_OPT_OUT = "lock_task_opt_out"

    /** Manager package ids, release + debug. Mirrors `PlayerApp`. */
    private val MANAGER_PACKAGES = arrayOf(
        "com.educms.manager",
        "com.educms.manager.debug",
    )

    /**
     * Live lock-task state of this task. `true` for BOTH the DO-managed
     * `LOCK_TASK_MODE_LOCKED` we ask for and the degraded
     * `LOCK_TASK_MODE_PINNED` we never ask for — reporting either as
     * "pinned" is what makes this useful as fleet telemetry: a screen
     * showing `lockTask:true` with `deviceOwner` absent would be a real
     * finding.
     *
     * Surfaced through `MainActivity.deviceInfoJson()` → the web player's
     * `deviceInfo()` bridge call, so the dashboard can answer "is this
     * screen actually locked down?" without anybody walking to it.
     *
     * Safe on any thread (binder call) and total — never throws.
     */
    fun isActive(activity: Activity): Boolean = try {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        am != null && am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "lockTaskModeState probe failed: ${t.message}")
        false
    }

    /**
     * Enter lock task mode when — and only when — every gate in this
     * file's header passes. Total: returns `false` and logs instead of
     * throwing, because nothing here may ever be able to take a hallway
     * kiosk down.
     *
     * MUST be called on the UI thread from a RESUMED activity;
     * `startLockTask()` throws `IllegalStateException` otherwise. The one
     * caller is `MainActivity.onResume()` / its page-load-success hook.
     *
     * Idempotent — a second call while already locked is a no-op.
     *
     * @return true when the task is locked after this call (including the
     *         "already locked" case).
     */
    fun engageIfPermitted(activity: Activity): Boolean {
        try {
            if (isOptedOut(activity)) {
                PlayerLogger.i(TAG, "lock task skipped — $PREF_OPT_OUT is set on this device")
                return false
            }
            if (isActive(activity)) return true

            val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE)
                as? DevicePolicyManager
            if (dpm == null) {
                PlayerLogger.i(TAG, "lock task skipped — no DevicePolicyManager on this ROM")
                return false
            }

            // ── Gate 1: this is a deliberately provisioned EduCMS kiosk,
            //    not an OEM-CMS box where we are a guest.
            val managerIsDeviceOwner = MANAGER_PACKAGES.any { pkg ->
                try {
                    dpm.isDeviceOwnerApp(pkg)
                } catch (t: Throwable) {
                    false
                }
            }
            if (!managerIsDeviceOwner) {
                PlayerLogger.i(
                    TAG,
                    "lock task skipped — Manager is not device owner (OEM-CMS guest box, or unprovisioned)",
                )
                return false
            }

            // ── Gate 2: the device owner has allow-listed us, so
            //    startLockTask() will give us LOCK_TASK_MODE_LOCKED and
            //    NOT the un-exitable-on-a-remote screen-pinning variant.
            val permitted = try {
                dpm.isLockTaskPermitted(activity.packageName)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "isLockTaskPermitted threw: ${t.message}")
                false
            }
            if (!permitted) {
                PlayerLogger.w(
                    TAG,
                    "lock task skipped — ${activity.packageName} is not on the device owner's " +
                        "lock-task allowlist. Manager sets it in ManagerApp.allowPlayerLockTask(); " +
                        "this resolves itself once Manager next boots.",
                )
                return false
            }

            activity.startLockTask()
            PlayerLogger.i(
                TAG,
                "LOCK TASK ENGAGED — HOME / Recents / status bar are now blocked at the OS level " +
                    "(state=${stateName(activity)})",
            )
            return true
        } catch (t: Throwable) {
            // IllegalStateException when the activity isn't resumed,
            // SecurityException on an odd ROM, anything else — never fatal.
            PlayerLogger.w(TAG, "startLockTask failed — continuing unpinned: ${t.message}")
            return false
        }
    }

    /**
     * Leave lock task mode. Safe (and silent) when we were never in it.
     *
     * ⚠️ Every locally-initiated way OUT of the player must call this
     * FIRST — inside a locked task `finishAffinity()` and a HOME intent
     * are both no-ops, so skipping it strands the operator. Current
     * callers: `onExitToDeviceHome`, `unpairAndRestart`, and the
     * watchdog's durably-broken-page valve.
     *
     * @param reason logged verbatim so the log tail says WHY a screen
     *        came unpinned.
     */
    fun disengage(activity: Activity, reason: String) {
        try {
            if (!isActive(activity)) return
            activity.stopLockTask()
            PlayerLogger.i(TAG, "LOCK TASK RELEASED — $reason")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "stopLockTask failed ($reason): ${t.message}")
        }
    }

    // ─── internals ──────────────────────────────────────────────

    private fun isOptedOut(ctx: Context): Boolean = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(PREF_OPT_OUT, false)
    } catch (t: Throwable) {
        false
    }

    /** Human-readable state for the log line. Never throws. */
    private fun stateName(activity: Activity): String = try {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        when (am?.lockTaskModeState) {
            ActivityManager.LOCK_TASK_MODE_LOCKED -> "LOCKED"
            ActivityManager.LOCK_TASK_MODE_PINNED -> "PINNED"
            ActivityManager.LOCK_TASK_MODE_NONE -> "NONE"
            else -> "unknown"
        }
    } catch (t: Throwable) {
        "unknown"
    }
}
