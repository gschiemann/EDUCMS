package com.educms.player.setup

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.educms.player.display.DeviceAdminEnrollment
import org.json.JSONObject

/**
 * PERMISSIONS AS THE SYSTEM MENU SHOWS THEM (2026-10-05, player 1.1.23).
 *
 * The X80 owner: *"some of the items not checked are actually already enabled
 * when you pop up the menu … I think you're not mapped correctly on this media
 * player."* Two real causes, both in code:
 *
 *  1. "Background updates" (the Manager's install toggle) was hard-coded
 *     `isSatisfied = { false }` — "no unprivileged API reads another package's
 *     appop". `AppOpsManager.checkOpNoThrow(op, uid, pkg)` does read it for a
 *     package this app can see (the Manager is declared in `<queries>`), and
 *     that is exactly the mode the Settings toggle writes. The row was ○ with
 *     the toggle ON behind it, every time.
 *  2. Several Settings lists show BOTH apps — "VenueOS Manager" sorts right
 *     above "VenueOS Player" in Install unknown apps, Battery optimisation and
 *     Device admin apps — and the rows named "Venue OS Player" (with a space)
 *     while every list on the box says "VenueOS Player". A grant made on the
 *     Manager's line left the Player's row ○ with no explanation.
 *
 * So every permission is read FOR BOTH PACKAGES, the way the Settings screen
 * computes its own toggle (`AppState*Bridge`: the appop mode, and for
 * `MODE_DEFAULT` the install-time permission), the rows name the app by its
 * real label, a row whose permission the Manager holds and the Player does
 * not says so, and the raw per-permission, per-package facts ride the
 * capability report (`permissions`) so a box's real state is readable from
 * the dashboard instead of from a phone call.
 *
 * Pure decisions in [PermissionFactsMath] (JVM-tested); Android reads in
 * [PermissionFactsReader] (background thread only — binder calls).
 */

/** One permission, for one app, read the way the system menu shows it. */
data class GrantRead(
    /** What the Settings toggle shows. Null = this box would not tell us. */
    val granted: Boolean?,
    /** The app's manifest asks for it — Settings only LISTS apps that do. Null = unknown. */
    val requested: Boolean?,
    /** What was read, for the report: e.g. `canWrite+appop:allowed`. */
    val how: String,
)

/** One permission across both apps. */
data class PermissionRow(
    /** Stable id in the report: `installUnknownApps`, `writeSettings`, … */
    val id: String,
    /** The checklist step it backs, or null. */
    val stepKey: String?,
    val player: GrantRead,
    /** Null when the Manager companion is not installed. */
    val manager: GrantRead?,
)

object PermissionFactsMath {

    /** `AppOpsManager.MODE_*`, restated so this object stays android-free. */
    const val MODE_ALLOWED = 0
    const val MODE_IGNORED = 1
    const val MODE_ERRORED = 2
    const val MODE_DEFAULT = 3
    const val MODE_FOREGROUND = 4

    fun modeName(mode: Int): String = when (mode) {
        MODE_ALLOWED -> "allowed"
        MODE_IGNORED -> "ignored"
        MODE_ERRORED -> "errored"
        MODE_DEFAULT -> "default"
        MODE_FOREGROUND -> "foreground"
        else -> "mode-$mode"
    }

    /**
     * What a special-access toggle shows for an appop mode — the rule the
     * Settings app's own `AppState*Bridge` classes use: ALLOWED is on,
     * DEFAULT falls back to the install-time permission, anything else is
     * off. [permissionGranted] null (unread) under DEFAULT = unknown.
     */
    fun shownAsAllowed(mode: Int, permissionGranted: Boolean?): Boolean? = when (mode) {
        MODE_ALLOWED -> true
        MODE_DEFAULT -> permissionGranted
        else -> false
    }

    /**
     * The extra line a checklist row carries when the companion holds what
     * the Player needs — the X80's "I already switched that on" case. Null
     * whenever it does not apply: the Player holds it, the Manager does not,
     * or either answer is unknown (we never guess on the operator's behalf).
     */
    fun managerHoldsNote(row: PermissionRow, playerLabel: String, managerLabel: String): String? =
        if (row.player.granted == false && row.manager?.granted == true) {
            "Switched on for $managerLabel, not for $playerLabel — switch on $playerLabel too."
        } else {
            null
        }
}

/**
 * The Android reads. ⚠️ Binder calls — never on the main thread (the
 * `setup-facts` thread and the bridge thread only).
 */
internal object PermissionFactsReader {

    /** AppOps names. String form: the public int constants are not all public. */
    const val OP_REQUEST_INSTALL_PACKAGES = "android:request_install_packages"
    const val OP_WRITE_SETTINGS = "android:write_settings"
    const val OP_SYSTEM_ALERT_WINDOW = "android:system_alert_window"

    /** The Manager's device-admin receiver. Namespace-relative: no `.debug`. */
    private const val MANAGER_ADMIN_CLASS = "com.educms.manager.AdminReceiver"

    /** Every permission the setup card or the display layer depends on, for both apps. */
    fun read(ctx: Context, managerPkg: String?): List<PermissionRow> {
        val app = ctx.applicationContext
        val self = app.packageName
        return listOf(
            PermissionRow(
                id = "installUnknownApps",
                stepKey = SetupCeremonyMath.STEP_INSTALL_UNKNOWN,
                player = selfInstallRead(app),
                manager = managerPkg?.let {
                    appop(app, it, OP_REQUEST_INSTALL_PACKAGES, "android.permission.REQUEST_INSTALL_PACKAGES")
                },
            ),
            PermissionRow(
                id = "writeSettings",
                stepKey = SetupCeremonyMath.STEP_WRITE_SETTINGS,
                player = selfWithAppop(
                    app,
                    granted = safe { Settings.System.canWrite(app) },
                    reader = "canWrite",
                    op = OP_WRITE_SETTINGS,
                    permission = "android.permission.WRITE_SETTINGS",
                ),
                manager = managerPkg?.let {
                    appop(app, it, OP_WRITE_SETTINGS, "android.permission.WRITE_SETTINGS")
                },
            ),
            PermissionRow(
                id = "displayOverOtherApps",
                stepKey = SetupCeremonyMath.STEP_OVERLAY,
                player = selfWithAppop(
                    app,
                    granted = safe { Settings.canDrawOverlays(app) },
                    reader = "canDrawOverlays",
                    op = OP_SYSTEM_ALERT_WINDOW,
                    permission = "android.permission.SYSTEM_ALERT_WINDOW",
                ),
                manager = managerPkg?.let {
                    appop(app, it, OP_SYSTEM_ALERT_WINDOW, "android.permission.SYSTEM_ALERT_WINDOW")
                },
            ),
            PermissionRow(
                id = "batteryUnrestricted",
                stepKey = SetupCeremonyMath.STEP_BATTERY_EXEMPT,
                player = batteryRead(app, self),
                manager = managerPkg?.let { batteryRead(app, it) },
            ),
            PermissionRow(
                id = "deviceAdmin",
                stepKey = SetupCeremonyMath.STEP_DEVICE_ADMIN,
                player = adminRead(app, DeviceAdminEnrollment.adminComponent(app)),
                manager = managerPkg?.let { adminRead(app, ComponentName(it, MANAGER_ADMIN_CLASS)) },
            ),
            PermissionRow(
                id = "notifications",
                stepKey = null,
                player = GrantRead(
                    granted = safe { NotificationManagerCompat.from(app).areNotificationsEnabled() },
                    requested = null,
                    how = "areNotificationsEnabled",
                ),
                // There is no unprivileged read of another app's notification
                // switch. Said, not guessed.
                manager = managerPkg?.let { GrantRead(null, null, "unreadable:another-app") },
            ),
        )
    }

    /** The Manager's install toggle as Settings shows it, or null when unreadable. */
    fun managerInstallAllowed(ctx: Context, managerPkg: String): Boolean? =
        appop(ctx.applicationContext, managerPkg, OP_REQUEST_INSTALL_PACKAGES, "android.permission.REQUEST_INSTALL_PACKAGES")
            .granted

    /** Who the box's HOME is, as the resolver answers it. For the report. */
    fun homeJson(ctx: Context): JSONObject {
        val out = JSONObject()
        val pm = ctx.packageManager
        val res = safeAny {
            pm.resolveActivity(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                PackageManager.MATCH_DEFAULT_ONLY,
            )
        }
        out.put("defaultPackage", res?.activityInfo?.packageName ?: JSONObject.NULL)
        out.put("defaultActivity", res?.activityInfo?.name?.takeLast(120) ?: JSONObject.NULL)
        out.put("playerIsDefault", res?.activityInfo?.packageName == ctx.packageName)
        val alias = safeAny {
            pm.getComponentEnabledSetting(ComponentName(ctx.packageName, "com.educms.player.KioskHomeAlias"))
        }
        out.put("playerAliasEnabled", alias == PackageManager.COMPONENT_ENABLED_STATE_ENABLED)
        return out
    }

    /** The whole report section: labels, every row for both apps, HOME. */
    fun json(ctx: Context, playerLabel: String, managerPkg: String?, managerLabel: String?): JSONObject {
        val rows = read(ctx, managerPkg)
        val out = JSONObject()
        out.put("schema", 1)
        out.put("player", JSONObject().put("pkg", ctx.packageName).put("label", playerLabel))
        out.put(
            "manager",
            if (managerPkg == null) JSONObject.NULL
            else JSONObject().put("pkg", managerPkg).put("label", managerLabel ?: JSONObject.NULL),
        )
        val byId = JSONObject()
        for (row in rows) {
            val r = JSONObject()
                .put("step", row.stepKey ?: JSONObject.NULL)
                .put("player", grantJson(row.player))
                .put("manager", row.manager?.let { grantJson(it) } ?: JSONObject.NULL)
            PermissionFactsMath.managerHoldsNote(
                row,
                playerLabel,
                managerLabel ?: "the companion",
            )?.let { r.put("note", it) }
            byId.put(row.id, r)
        }
        out.put("rows", byId)
        out.put("home", homeJson(ctx))
        return out
    }

    private fun grantJson(g: GrantRead): JSONObject = JSONObject()
        .put("granted", g.granted ?: JSONObject.NULL)
        .put("requested", g.requested ?: JSONObject.NULL)
        .put("how", g.how.take(80))

    // ─── reads ────────────────────────────────────────────────────────

    private fun selfInstallRead(app: Context): GrantRead {
        val granted = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            true
        } else {
            safe { app.packageManager.canRequestPackageInstalls() }
        }
        val raw = appop(app, app.packageName, OP_REQUEST_INSTALL_PACKAGES, "android.permission.REQUEST_INSTALL_PACKAGES")
        return GrantRead(granted, raw.requested, "canRequestPackageInstalls+${raw.how}")
    }

    private fun selfWithAppop(
        app: Context,
        granted: Boolean?,
        reader: String,
        op: String,
        permission: String,
    ): GrantRead {
        val raw = appop(app, app.packageName, op, permission)
        return GrantRead(granted, raw.requested, "$reader+${raw.how}")
    }

    /**
     * The appop as Settings' toggle shows it, for any package this app can
     * see. `checkOpNoThrow(String, Int, String)` is the API-19 spelling of
     * `unsafeCheckOpNoThrow`; it never notes, never prompts.
     */
    @Suppress("DEPRECATION")
    private fun appop(app: Context, pkg: String, op: String, permission: String): GrantRead {
        val pm = app.packageManager
        val uid = safeAny { pm.getApplicationInfo(pkg, 0).uid }
            ?: return GrantRead(null, null, "not-installed")
        val requested = safeAny {
            pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS).requestedPermissions?.contains(permission) ?: false
        }
        val ops = app.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            ?: return GrantRead(null, requested, "unreadable:no-appops")
        val mode = try {
            ops.checkOpNoThrow(op, uid, pkg)
        } catch (t: Throwable) {
            return GrantRead(null, requested, "unreadable:${t.javaClass.simpleName}")
        }
        val permissionGranted = if (mode == PermissionFactsMath.MODE_DEFAULT) {
            safeAny { pm.checkPermission(permission, pkg) == PackageManager.PERMISSION_GRANTED }
        } else {
            null
        }
        return GrantRead(
            granted = PermissionFactsMath.shownAsAllowed(mode, permissionGranted),
            requested = requested,
            how = "appop:${PermissionFactsMath.modeName(mode)}" +
                (permissionGranted?.let { "+permission:${if (it) "granted" else "denied"}" } ?: ""),
        )
    }

    private fun batteryRead(app: Context, pkg: String): GrantRead {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return GrantRead(true, null, "pre-doze")
        val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return GrantRead(null, null, "unreadable:no-power-manager")
        val installed = safeAny { app.packageManager.getApplicationInfo(pkg, 0) } != null
        if (!installed) return GrantRead(null, null, "not-installed")
        return GrantRead(safe { pm.isIgnoringBatteryOptimizations(pkg) }, null, "isIgnoringBatteryOptimizations")
    }

    private fun adminRead(app: Context, component: ComponentName): GrantRead {
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return GrantRead(null, null, "unreadable:no-device-policy")
        val declared = safeAny {
            app.packageManager.getReceiverInfo(component, 0)
            true
        } ?: false
        if (!declared) return GrantRead(null, false, "no-admin-receiver")
        return GrantRead(safe { dpm.isAdminActive(component) }, true, "isAdminActive")
    }

    private inline fun safe(body: () -> Boolean): Boolean? = try {
        body()
    } catch (_: Throwable) {
        null
    }

    private inline fun <T> safeAny(body: () -> T): T? = try {
        body()
    } catch (_: Throwable) {
        null
    }
}
