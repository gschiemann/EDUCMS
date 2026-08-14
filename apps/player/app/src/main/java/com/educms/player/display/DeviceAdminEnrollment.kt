package com.educms.player.display

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.educms.player.R
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * The enrolment ceremony for [PlayerAdminReceiver] — the one thing that
 * fires `ACTION_ADD_DEVICE_ADMIN`, and the only place allowed to.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ THE HARD RULE: NEVER AUTOMATIC, NEVER ON BOOT, NEVER TWICE
 * ═════════════════════════════════════════════════════════════════════
 * A signage box that pops an Android SECURITY dialog on a wall in front
 * of customers is worse than a screen that dims in software. So:
 *
 *   * [requestEnrollment] takes an **Activity** and a named **source**.
 *     There is no Context overload and no fire-and-forget variant, which
 *     makes it structurally impossible to call from a BroadcastReceiver,
 *     a Worker, the boot path, the schedule path or the manifest path.
 *   * Nothing in this package, in `PlayerApp`, in `BootReceiver`, in
 *     `DisplayScheduler` or in `DisplayControlApi` calls it. Grep before
 *     you add one.
 *   * A decline is remembered and suppresses re-prompting for
 *     [DeviceAdminEnrollmentMath.DECLINE_COOLDOWN_MS]. The operator is
 *     never stranded by that: `player_device_admin.xml` sets
 *     `android:visible="true"`, so Settings → Security → Device admin
 *     apps can enable it directly at any time, and
 *     [PlayerAdminReceiver.onEnabled] picks that up identically.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHAT ENROLMENT BUYS, EXACTLY
 * ═════════════════════════════════════════════════════════════════════
 * One thing: `DevicePolicyManager.lockNow()`, which sleeps the panel for
 * real (power saved, backlight off) instead of painting a black overlay
 * over a lit one. That promotes BLANK/WAKE from `software-dim` (or
 * `screen-timeout`, which needs the WRITE_SETTINGS appop) to
 * `device-admin` in [DisplayControlRegistry]. It does NOT grant reboot
 * (device-owner only, and we do not take device owner), does not grant
 * silent install, and does not let us manage anything else on the box.
 * The operator-facing copy in `strings.xml` says exactly that and no
 * more.
 *
 * API LEVEL: every symbol used here — `ACTION_ADD_DEVICE_ADMIN`,
 * `EXTRA_DEVICE_ADMIN`, `EXTRA_ADD_EXPLANATION`, `isAdminActive`,
 * `activeAdmins` — is API 8. Nothing is API 28+, so no @RequiresApi
 * isolation object is needed and the Android 7.1.2 (API 25) RK3288 in
 * the pilot fleet loads this class without an ART VerifyError.
 */
object DeviceAdminEnrollment {

    private const val TAG = "DeviceAdminEnroll"

    /** Sources, so the log line says WHO asked. Not security-bearing. */
    const val SOURCE_BRIDGE = "web-bridge"
    const val SOURCE_INTENT = "field-intent"

    // ─────────────────────────────────────────────────────────────────
    // reads — all total, none of them ever throw
    // ─────────────────────────────────────────────────────────────────

    fun adminComponent(ctx: Context): ComponentName = PlayerAdminReceiver.componentName(ctx)

    /**
     * The OS's answer, asked fresh every time.
     *
     * ⚠️ Deliberately `isAdminActive(ourComponent)` and NOT
     * "is there any active admin" — the force-lock policy is scoped to
     * the CALLING package, so a vendor CMS's admin grants us nothing.
     * Reading `activeAdminCount > 0` as "we can lockNow()" is precisely
     * the mis-reading [DeviceAdminBlankProvider]'s header was written to
     * prevent.
     */
    fun isActiveAdmin(ctx: Context): Boolean {
        val app = ctx.applicationContext
        val dpm = dpm(app) ?: return false
        return try {
            dpm.isAdminActive(adminComponent(app))
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "isAdminActive threw: ${t.message}")
            false
        }
    }

    fun record(ctx: Context): AdminEnrollmentRecord =
        DisplayPrefs.adminEnrollmentRecord(ctx.applicationContext, isActiveAdmin(ctx))

    fun state(ctx: Context, nowMs: Long = System.currentTimeMillis()): AdminEnrollmentState =
        DeviceAdminEnrollmentMath.state(record(ctx), nowMs)

    /**
     * READ-ONLY section for [DisplayCapabilityProbe]. Writes nothing —
     * the probe's safety contract is that it only observes, and a probe
     * that settled a pending prompt would be writing from a read.
     */
    fun probeJson(ctx: Context, nowMs: Long = System.currentTimeMillis()): JSONObject {
        val out = JSONObject()
        return try {
            val rec = record(ctx)
            val st = DeviceAdminEnrollmentMath.state(rec, nowMs)
            out.put("state", DeviceAdminEnrollmentMath.wireName(st))
            out.put("isActiveAdmin", rec.isActiveAdmin)
            out.put("component", adminComponent(ctx).flattenToShortString())
            out.put("promptedAtMs", rec.promptedAtMs.takeIf { it > 0L } ?: JSONObject.NULL)
            out.put("declinedAtMs", rec.declinedAtMs.takeIf { it > 0L } ?: JSONObject.NULL)
            out.put("enrolledAtMs", rec.enrolledAtMs.takeIf { it > 0L } ?: JSONObject.NULL)
            // The whole point, stated so the dashboard does not have to
            // infer it: one operator tap is all that stands between this
            // screen and a real panel-off blank.
            out.put("oneTapAvailable", !rec.isActiveAdmin)
            out
        } catch (t: Throwable) {
            out.put("error", t.message ?: t.javaClass.simpleName)
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // the ceremony
    // ─────────────────────────────────────────────────────────────────

    /**
     * Show the system "Activate device admin app?" dialog.
     *
     * @param activity the FOREGROUND Activity. Required, not incidental —
     *        see the hard rule in this file's header.
     * @param source   one of [SOURCE_BRIDGE] / [SOURCE_INTENT], for the log.
     * @return a JSON string in the same shape [DisplayControlApi] uses:
     *         `{"ok":true,"state":"prompt-pending"}` or
     *         `{"ok":false,"code":"recently-declined","message":"…"}`.
     */
    fun requestEnrollment(activity: Activity, source: String): String {
        val app = activity.applicationContext
        val now = System.currentTimeMillis()
        val rec = record(app)

        when (val decision = DeviceAdminEnrollmentMath.decide(rec, now)) {
            is PromptDecision.Refuse -> {
                PlayerLogger.i(
                    TAG,
                    "enrolment prompt NOT shown (source=$source, code=${decision.code}): ${decision.reason}",
                )
                return JSONObject()
                    .put("ok", false)
                    .put("code", decision.code)
                    .put("message", decision.reason)
                    .put("state", DeviceAdminEnrollmentMath.wireName(DeviceAdminEnrollmentMath.state(rec, now)))
                    .toString()
            }
            PromptDecision.Prompt -> Unit
        }

        val explanation = try {
            activity.getString(R.string.device_admin_add_explanation)
        } catch (t: Throwable) {
            "Lets your administrator turn this screen off on a schedule."
        }
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent(app))
            .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, explanation)

        // Marker written BEFORE the launch, on purpose. If the process
        // dies while the dialog is up, the next resume still has
        // something to settle; if we wrote it after, a kill in that
        // window would lose the record and the next request would
        // re-prompt — the nag this is built to prevent.
        DisplayPrefs.setAdminEnrollmentRecord(app, rec.copy(promptedAtMs = now))

        return try {
            activity.startActivity(intent)
            PlayerLogger.i(TAG, "device-admin enrolment prompt shown (source=$source)")
            JSONObject()
                .put("ok", true)
                .put("state", DeviceAdminEnrollmentMath.wireName(AdminEnrollmentState.PROMPT_PENDING))
                .toString()
        } catch (t: Throwable) {
            // Roll the marker back — nothing was ever shown, so there is
            // nothing to settle and no decline to remember.
            //
            // Known live case: while the kiosk is in lock-task mode the
            // OS refuses to launch a Settings/system activity at all
            // (same constraint `openSettingsForManager` documents). That
            // is an ActivityNotFound/SecurityException here, not a
            // decline, and the operator is told to use the Settings
            // toggle instead.
            DisplayPrefs.setAdminEnrollmentRecord(app, rec.copy(promptedAtMs = 0L))
            PlayerLogger.w(TAG, "could not show the enrolment prompt (source=$source): ${t.message}")
            JSONObject()
                .put("ok", false)
                .put("code", "prompt-unavailable")
                .put(
                    "message",
                    "this device would not show the setup dialog — enable it in " +
                        "Settings > Security > Device admin apps",
                )
                .toString()
        }
    }

    /**
     * Resolve an outstanding prompt. Called from `MainActivity.onResume`,
     * immediately before the [DisplayControlRegistry.invalidate] that
     * already lives there.
     *
     * Returns the state AFTER settling, so the caller can log a
     * transition without a second read.
     */
    fun settlePending(ctx: Context, nowMs: Long = System.currentTimeMillis()): AdminEnrollmentState {
        val app = ctx.applicationContext
        val rec = record(app)
        val settled = DeviceAdminEnrollmentMath.settle(rec, nowMs)
        if (settled == null) return DeviceAdminEnrollmentMath.state(rec, nowMs)

        DisplayPrefs.setAdminEnrollmentRecord(app, settled)
        val state = DeviceAdminEnrollmentMath.state(settled, nowMs)
        if (settled.isActiveAdmin) {
            PlayerLogger.i(TAG, "enrolment COMPLETED — BLANK can now use lockNow()")
            // Belt for the receiver's braces. `onEnabled` normally fires
            // first and has already invalidated; doing it again is a
            // handful of stats, and if the receiver was somehow missed
            // (a ROM that does not deliver it, an admin activated while
            // our process was dead) this is what makes the tier live
            // without a restart.
            invalidateRegistry()
        } else {
            PlayerLogger.i(TAG, "enrolment DECLINED — not re-prompting; BLANK stays on the fallback tier")
        }
        return state
    }

    // ─────────────────────────────────────────────────────────────────
    // receiver callbacks
    // ─────────────────────────────────────────────────────────────────

    /** From [PlayerAdminReceiver.onEnabled], however the admin got enabled. */
    fun onAdminEnabled(ctx: Context) {
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        runCatching {
            val rec = DisplayPrefs.adminEnrollmentRecord(app, isActiveAdmin = true)
            DisplayPrefs.setAdminEnrollmentRecord(
                app,
                rec.copy(
                    promptedAtMs = 0L,
                    declinedAtMs = 0L,
                    enrolledAtMs = if (rec.enrolledAtMs > 0L) rec.enrolledAtMs else now,
                ),
            )
        }.onFailure { PlayerLogger.w(TAG, "onAdminEnabled bookkeeping failed: ${it.message}") }
        invalidateRegistry()
    }

    /** From [PlayerAdminReceiver.onDisabled]. */
    fun onAdminDisabled(ctx: Context) {
        val app = ctx.applicationContext
        runCatching {
            val rec = DisplayPrefs.adminEnrollmentRecord(app, isActiveAdmin = false)
            // Clear enrolledAt but do NOT invent a decline: the operator
            // revoking an admin they once granted is not the same event
            // as refusing the dialog, and treating it as one would
            // silently arm the 5-minute cooldown on a screen where the
            // next thing that happens is usually a re-enrol.
            DisplayPrefs.setAdminEnrollmentRecord(app, rec.copy(promptedAtMs = 0L, enrolledAtMs = 0L))
        }.onFailure { PlayerLogger.w(TAG, "onAdminDisabled bookkeeping failed: ${it.message}") }
        invalidateRegistry()
    }

    // ─────────────────────────────────────────────────────────────────
    // internals
    // ─────────────────────────────────────────────────────────────────

    /**
     * ⚠️ THE "resolves the moment enrolment completes" STEP.
     * [DisplayControlRegistry] caches capability→provider for the life of
     * the process; without this the box keeps reporting the pre-enrolment
     * mechanism until it next dies.
     */
    private fun invalidateRegistry() {
        runCatching { DisplayControlRegistry.invalidate() }
            .onFailure { PlayerLogger.w(TAG, "registry invalidate failed: ${it.message}") }
    }

    private fun dpm(ctx: Context): DevicePolicyManager? = try {
        ctx.applicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
    } catch (t: Throwable) {
        null
    }
}
