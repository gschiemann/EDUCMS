package com.educms.player.setup

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import com.educms.player.display.DeviceAdminEnrollment
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger

/**
 * SetupCeremony — the guided first-boot walk-through (2026-08-24).
 *
 * Operator direction: *"when someone runs our apk installer, it automates
 * the rest, makes us the home app, gives us permissions, and prepares for
 * OTA with zero to little interaction from a user onsite."*
 *
 * Android will not hand a sideloaded app these grants silently without
 * device owner — and the fleet decision is NO owner (every deployed box
 * already carries the vendor's, and a factory reset per screen is off the
 * table). What Android DOES allow is one system dialog per grant. So the
 * honest ceiling is: run the installer, open the app, and tap Allow a
 * handful of times while the app drives every step. This object is that
 * driver.
 *
 * WHAT IT REPLACES. Before this, the same grants lived as three
 * independent `maybePromptFor*` one-shots in MainActivity that all fired
 * from onCreate AT ONCE — dialogs stacking on top of each other on first
 * boot — and three of the highest-value grants had no prompt at all:
 * WRITE_SETTINGS (real Settings-path brightness + screen-timeout blank —
 * the exact reason the G43's brightness slider did nothing), battery
 * exemption (an OEM power-saver may freeze the heartbeat on an idle
 * kiosk), and device ADMIN (a real `lockNow()` panel-off instead of a
 * black overlay, no owner required). The ceremony runs ONE dialog at a
 * time, in a fixed order, resuming after every Settings round-trip, until
 * the screen is fully prepared.
 *
 * RULES:
 *  - One dialog at a time, ever. Each step is OFFERED at most once per
 *    install; offering is what advances the sequence, so a decline can
 *    never stall it and a reboot can never re-nag.
 *  - Pref keys for the three migrated steps are UNCHANGED
 *    (installPromptShown / managerInstallPromptShown /
 *    homeSetupPromptShown) so already-set-up screens never re-nag after
 *    the OTA that ships this.
 *  - A LIVE grant always beats the pref: a step whose permission is
 *    already held is skipped no matter what was or wasn't prompted.
 *  - Never over an emergency: while a life-safety hold is up, the
 *    ceremony refuses to put a dialog over the alert.
 *  - Never during lock-task: the OS refuses to launch a Settings screen
 *    from a locked task, so every step would fail at the last inch.
 *  - HOME is last: it opts us in as a launcher candidate, the one step
 *    that touches the vendor CMS's own territory (see the long comment in
 *    AndroidManifest.xml). Everything cheaper and safer runs first.
 */
object SetupCeremony {

    private const val TAG = "SetupCeremony"
    private const val PREFS = "edu_player"

    /** Package names the Manager companion may be installed under. */
    private val MANAGER_PACKAGES = listOf("com.educms.manager", "com.educms.manager.debug")

    /** Guards against two dialogs ever being on screen at once. */
    @Volatile
    private var dialogShowing = false

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * One grant we can ask for.
     *
     * @param prefKey     once-per-install marker. UNCHANGED for migrated steps.
     * @param appliesTo   is this step meaningful on THIS box at all?
     * @param isSatisfied is the grant already held? Live state beats the pref.
     * @param launch      take the operator to the system UI that grants it.
     */
    private class Step(
        val prefKey: String,
        val title: String,
        val message: String,
        val actionLabel: String,
        val appliesTo: (Context) -> Boolean,
        val isSatisfied: (Context) -> Boolean,
        val launch: (Activity) -> Unit,
    )

    // ─────────────────────────────────────────────────────────────────
    // the steps, in the order they are offered
    // ─────────────────────────────────────────────────────────────────

    private val STEPS: List<Step> = listOf(
        // 1 ─ Player installs its own updates. Everything OTA depends on it.
        Step(
            prefKey = "installPromptShown",
            title = "Allow updates",
            message = "So this screen can install its own updates, allow Venue OS " +
                "to install apps. Tap Allow, switch it on, then press Back. " +
                "One-time setup.",
            actionLabel = "Allow",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O },
            isSatisfied = { ctx -> canRequestInstalls(ctx, ctx.packageName) },
            launch = { act -> openInstallSources(act, act.packageName) },
        ),
        // 2 ─ The Manager companion installs Player updates in the
        //     background. Manager has no Activity of its own, so Player is
        //     the only process that can open Settings on its behalf.
        //
        //     ⚠️ NO LIVE CHECK IS POSSIBLE. `canRequestPackageInstalls()`
        //     answers for the CALLING package only; there is no unprivileged
        //     API to read another package's appop. So this is the one step
        //     whose pref is the only signal we have — deliberately, and it is
        //     why the pref is never cleared automatically.
        Step(
            prefKey = "managerInstallPromptShown",
            title = "Allow background updates",
            message = "Venue OS installs updates through a companion service. " +
                "Allow it to install apps too, so updates apply without anyone " +
                "standing at the screen.",
            actionLabel = "Allow",
            appliesTo = { ctx ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && installedManager(ctx) != null
            },
            isSatisfied = { false },
            launch = { act -> installedManager(act)?.let { openInstallSources(act, it) } },
        ),
        // 3 ─ WRITE_SETTINGS. THE brightness fix: without this appop
        //     SettingsBrightnessProvider can never resolve, so a box with no
        //     writable sysfs backlight node (the G43) falls all the way to the
        //     software floor and the operator's brightness slider only dims
        //     the IMAGE. Also unlocks ScreenTimeoutBlankProvider's real
        //     panel-off. Declaring the permission in the manifest is a
        //     prerequisite (already done); this is the grant itself.
        Step(
            prefKey = "writeSettingsPromptShown",
            title = "Allow screen brightness control",
            message = "To set this screen's real brightness from the dashboard " +
                "— not just dim the picture — Venue OS needs permission to " +
                "change system settings. Tap Allow, switch it on, then press Back.",
            actionLabel = "Allow",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> canWriteSettings(ctx) },
            launch = { act ->
                act.startActivity(
                    Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS)
                        .setData(Uri.parse("package:${act.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            },
        ),
        // 4 ─ Battery-optimisation exemption. A signage box is idle by
        //     definition, which is exactly what an OEM power-saver targets:
        //     deferred alarms (the on/off schedule), a frozen heartbeat, a
        //     killed OTA worker. Exempting us keeps the screen answering.
        Step(
            prefKey = "batteryExemptPromptShown",
            title = "Keep Venue OS running",
            message = "Android's battery saver can pause background work on an " +
                "idle screen — which would delay updates and on/off schedules. " +
                "Tap Allow to let Venue OS keep running.",
            actionLabel = "Allow",
            appliesTo = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M },
            isSatisfied = { ctx -> isIgnoringBatteryOptimizations(ctx) },
            launch = { act -> requestBatteryExemption(act) },
        ),
        // 5 ─ Device ADMIN (never owner). This is what turns Blank from a
        //     black overlay on a lit backlight into a real `lockNow()` panel
        //     sleep — power actually saved. Needs no factory reset and
        //     coexists with the vendor's own admin.
        //
        //     DeviceAdminEnrollment owns the prompt debounce + declined
        //     cooldown; we only decide WHEN to offer it.
        Step(
            prefKey = "deviceAdminPromptShown",
            title = "Allow turning the screen off",
            message = "To really power this panel down on a schedule — instead " +
                "of showing a black picture with the backlight still on — Venue OS " +
                "needs screen-off permission. Tap Allow, then Activate.",
            actionLabel = "Allow",
            appliesTo = { true },
            isSatisfied = { ctx -> isActiveAdmin(ctx) },
            launch = { act ->
                val res = DeviceAdminEnrollment.requestEnrollment(
                    act,
                    DeviceAdminEnrollment.SOURCE_INTENT,
                )
                PlayerLogger.i(TAG, "device-admin enrolment from ceremony: $res")
            },
        ),
        // 6 ─ HOME app. LAST on purpose: this is the step that registers us
        //     as a launcher candidate, and on an OEM-CMS box we are a guest.
        //     It is also what makes an OTA self-update come back on screen by
        //     itself (the OS only auto-relaunches HOME).
        Step(
            prefKey = "homeSetupPromptShown",
            title = "Come back automatically after updates",
            message = "Set Venue OS as this screen's Home app so it returns by " +
                "itself after an update or a reboot — nobody has to walk up to " +
                "the screen. Tap Set as home, then pick Venue OS Player.",
            actionLabel = "Set as home",
            // Under a device owner HOME is pinned for us already.
            appliesTo = { ctx -> !managerIsDeviceOwner(ctx) },
            isSatisfied = { ctx -> isPlayerTheHomeApp(ctx) },
            launch = { act ->
                act.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putBoolean("kioskHomeOptIn", true).apply()
                enableKioskHomeAlias(act)
                openHomeSettings(act)
            },
        ),
    )

    // ─────────────────────────────────────────────────────────────────
    // the driver
    // ─────────────────────────────────────────────────────────────────

    /**
     * Offer the next outstanding setup step, if there is one.
     *
     * Safe to call from `onCreate` AND every `onResume` — that repetition
     * is the whole mechanism: each Settings round-trip ends in an onResume,
     * which offers the next step, which is what makes this feel like one
     * guided flow instead of six disconnected nags.
     *
     * @param decorate applies the kiosk remote-focus treatment to the
     *        dialog. Passed in rather than duplicated so MainActivity's
     *        existing `applyRemoteFocus` stays the single implementation —
     *        OEM signage ROMs strip the default focus highlight, and a
     *        dialog nobody can reach with a remote is a dead end on a
     *        wall-mounted panel.
     */
    fun resume(activity: Activity, decorate: (AlertDialog) -> Unit) {
        try {
            if (dialogShowing) return
            if (activity.isFinishing || activity.isDestroyed) return

            // ⚠️ Never put setup chrome over a live alert.
            if (DisplayEmergency.isHeld(activity.applicationContext)) {
                PlayerLogger.i(TAG, "skipped — emergency hold is active")
                return
            }
            // In lock-task the OS refuses to launch Settings at all, so every
            // step would dead-end at its final tap.
            if (isLockTaskActive(activity)) {
                PlayerLogger.i(TAG, "skipped — lock task is active")
                return
            }

            val next = nextStep(activity) ?: run {
                logCompletionOnce(activity)
                return
            }
            show(activity, next, decorate)
        } catch (t: Throwable) {
            // Setup is never worth taking the player down for.
            PlayerLogger.w(TAG, "resume failed: ${t.message}")
        }
    }

    /**
     * A one-line summary of where this screen stands, for the log and for
     * the diagnostics surface. Pure read — no prompting.
     */
    fun statusLine(ctx: Context): String {
        val states = snapshot(ctx)
        val (done, total) = SetupCeremonyMath.progress(states)
        val outstanding = SetupCeremonyMath.applicable(states)
            .filterNot { it.satisfied }
            .joinToString(",") { it.key }
        return "setup $done/$total granted" +
            if (outstanding.isEmpty()) "" else " (outstanding: $outstanding)"
    }

    /**
     * Read every step's live situation once. Each probe is individually
     * guarded — one OEM ROM throwing out of a PackageManager call must not
     * take the whole ceremony down with it.
     */
    private fun snapshot(ctx: Context): List<StepState> = STEPS.map { step ->
        StepState(
            key = step.prefKey,
            applies = safeBool { step.appliesTo(ctx) },
            satisfied = safeBool { step.isSatisfied(ctx) },
            offered = wasOffered(ctx, step.prefKey),
        )
    }

    private fun nextStep(ctx: Context): Step? {
        val key = SetupCeremonyMath.nextKey(snapshot(ctx)) ?: return null
        return STEPS.firstOrNull { it.prefKey == key }
    }

    private fun show(activity: Activity, step: Step, decorate: (AlertDialog) -> Unit) {
        // Position is computed over the steps that APPLY to this box, so the
        // count never promises a step this device will not be asked for.
        val states = snapshot(activity)
        val position = SetupCeremonyMath.positionOf(states, step.prefKey)
        val total = SetupCeremonyMath.applicable(states).size
        val heading = if (position > 0) {
            "${step.title}  (step $position of $total)"
        } else {
            step.title
        }

        // Marked BEFORE the dialog is shown: offering is what advances the
        // sequence, and a process death with the dialog up must not leave the
        // step un-offered forever (that is the nag-on-every-boot bug).
        markOffered(activity, step.prefKey)
        dialogShowing = true

        val dialog = AlertDialog.Builder(activity)
            .setTitle(heading)
            .setMessage(step.message)
            .setPositiveButton(step.actionLabel) { _, _ ->
                // The system UI we are about to open ends in an onResume,
                // which offers the next step. Nothing to schedule here.
                try {
                    step.launch(activity)
                    PlayerLogger.i(TAG, "step ${step.prefKey}: launched grant UI")
                } catch (t: Throwable) {
                    // Nothing was shown, so this step was never really
                    // offered — clear the marker so it can be retried on the
                    // next boot rather than being silently lost forever.
                    clearOffered(activity, step.prefKey)
                    PlayerLogger.w(TAG, "step ${step.prefKey}: launch failed: ${t.message}")
                }
            }
            .setNegativeButton("Later") { _, _ ->
                PlayerLogger.i(TAG, "step ${step.prefKey}: deferred by operator")
                // No Settings trip means no onResume, so the sequence would
                // stall here. Hand the next step forward ourselves — each one
                // is a distinct ask, so this reads as a wizard, not a nag,
                // and it is bounded by the once-per-install markers.
                mainHandler.post { resume(activity, decorate) }
            }
            .setOnDismissListener { dialogShowing = false }
            .setCancelable(true)
            .create()

        dialog.show()
        try {
            decorate(dialog)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "dialog decoration failed: ${t.message}")
        }
        PlayerLogger.i(TAG, "step ${step.prefKey}: offered ($position/$total)")
    }

    private fun logCompletionOnce(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("setupCeremonyLogged", false)) return
        prefs.edit().putBoolean("setupCeremonyLogged", true).apply()
        PlayerLogger.i(TAG, "no steps outstanding — ${statusLine(ctx)}")
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

    private fun canRequestInstalls(ctx: Context, pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true
        else if (pkg != ctx.packageName) false // unanswerable for another package
        else ctx.packageManager.canRequestPackageInstalls()
    } catch (_: Throwable) {
        false
    }

    private fun openInstallSources(activity: Activity, pkg: String) {
        activity.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:$pkg"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
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
     * than dead-ending the step.
     */
    @Suppress("BatteryLife") // sanctioned: a kiosk is mains-powered and must never be dozed
    private fun requestBatteryExemption(activity: Activity) {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:${activity.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "direct battery-exemption request unavailable: ${t.message}")
            activity.startActivity(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
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

    /** ACTION_HOME_SETTINGS is missing on some OEM ROMs — fall back. */
    private fun openHomeSettings(activity: Activity) {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Throwable) {
            activity.startActivity(
                Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    private fun isLockTaskActive(activity: Activity): Boolean = try {
        com.educms.player.security.LockTaskController.isActive(activity)
    } catch (_: Throwable) {
        false
    }
}
