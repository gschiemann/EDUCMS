package com.educms.player.ota

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * Catches the PackageInstaller.Session commit result and logs it.
 *
 * When PackageInstaller runs in confirm-required mode (non-device-owner
 * kiosks) it sends back an Intent carrying EXTRA_STATUS +
 * EXTRA_STATUS_MESSAGE and, if user consent is needed,
 * Intent.EXTRA_INTENT — a new ACTION_VIEW the user must approve.
 *
 * For completed installs, the result lands here with STATUS_SUCCESS;
 * we relaunch the Player so the kiosk does not strand itself on the
 * OEM launcher after the operator taps Install.
 */
class OtaInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)
        val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // 2026-04-28 (v1.0.22) — Android specialist audit found
                // Goodview Android 11's BAL (Background Activity Launch)
                // restrictions silently block startActivity() calls from
                // BroadcastReceivers on stripped signage ROMs. THIS is
                // why bundled-Manager-install has been silently failing
                // since v1.0.13 — STATUS_PENDING_USER_ACTION fires, our
                // receiver tries startActivity, OS blocks it without
                // throwing, no system Install prompt appears.
                //
                // Fix: trampoline through MainActivity (a foregrounded
                // user-visible Activity, satisfies BAL). MainActivity's
                // onNewIntent handler launches the Install prompt from
                // the foreground task chain.
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirm == null) {
                    PlayerLogger.w(TAG, "STATUS_PENDING_USER_ACTION but no EXTRA_INTENT")
                    reportOtaError(context, "Install stalled: user-action intent missing")
                    return
                }
                // Diagnostic: log component + resolveActivity result so
                // the dashboard / logcat shows whether Goodview's ROM
                // even has a system PackageInstaller activity registered.
                val resolved = try { confirm.resolveActivity(context.packageManager) } catch (_: Exception) { null }
                PlayerLogger.i(
                    TAG,
                    "PENDING_USER_ACTION received. component=${confirm.component} " +
                    "data=${confirm.data} package=${confirm.`package`} resolves=$resolved",
                )
                // Route through MainActivity trampoline. FLAG_ACTIVITY_NEW_TASK
                // + FLAG_ACTIVITY_SINGLE_TOP so we reuse the existing
                // MainActivity instance instead of spawning a duplicate.
                //
                // ⚠️ AND-006 (2026-08-01) — the confirm Intent is handed
                // over IN-PROCESS, never as an Intent extra. MainActivity
                // is exported, so an extra would let any app on the device
                // make us startActivity() an Intent of its choosing. This
                // receiver is a manifest receiver of the same package with
                // no android:process, so it always runs in MainActivity's
                // process and the static holder below is unreachable from
                // outside our UID.
                stagePendingInstallPrompt(
                    confirm,
                    targetPackageOf(intent),
                    installedVersionCodeOf(context, targetPackageOf(intent)),
                )
                val trampoline = Intent(context, com.educms.player.MainActivity::class.java).apply {
                    action = ACTION_LAUNCH_INSTALL_PROMPT
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                try {
                    context.startActivity(trampoline)
                    PlayerLogger.i(TAG, "trampoline through MainActivity dispatched")
                } catch (ex: Exception) {
                    PlayerLogger.e(TAG, "trampoline launch failed", ex)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                // TC22 F1 — SUCCESS is the strongest possible proof that the
                // confirmation is no longer on the glass: the package it was
                // asking about changed. Clear the relaunch hold BEFORE doing
                // anything else, so a genuinely-stranded screen is never
                // suppressed by a prompt that has already been answered.
                com.educms.player.MainActivity.noteInstallLanded(targetPackageOf(intent))
                // TC22 F4 — the staged confirmation survives a dropped
                // launch, but not the install actually landing. Re-showing
                // an Install dialog for a package that just updated is
                // nonsense the operator would have to dismiss.
                clearPendingInstallPrompt()
                PlayerLogger.i(TAG, "OTA install: SUCCESS; relaunching Player")
                val pending = goAsync()
                Thread {
                    try {
                        relaunchSelf(context)
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
            PackageInstaller.STATUS_FAILURE,
            PackageInstaller.STATUS_FAILURE_ABORTED,
            PackageInstaller.STATUS_FAILURE_BLOCKED,
            PackageInstaller.STATUS_FAILURE_CONFLICT,
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE,
            PackageInstaller.STATUS_FAILURE_INVALID,
            PackageInstaller.STATUS_FAILURE_STORAGE -> {
                // TC22 F1 — a terminal failure means the session is over, so
                // the confirmation cannot still be up. It is NOT by itself
                // permission to relaunch: on some ROMs the status lands while
                // the dialog is still being torn down, so the hold clears
                // only once MainActivity is back AND the prompt had a few
                // seconds on screen (see InstallPromptGate).
                com.educms.player.MainActivity.noteInstallStatusTerminal(targetPackageOf(intent))
                PlayerLogger.w(TAG, "OTA install FAILED (status=$status): $msg")
                reportOtaError(context, "Install failed: ${statusName(status)}${if (msg.isNotBlank()) " - $msg" else ""}")
            }
            else -> {
                PlayerLogger.w(TAG, "OTA install: unknown status=$status msg=$msg")
                reportOtaError(context, "Install returned unknown status=$status${if (msg.isNotBlank()) " - $msg" else ""}")
            }
        }
    }

    private fun reportOtaError(context: Context, message: String) {
        try {
            val prefs = context.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            val apiRoot = prefs.getString("api_root", null) ?: return
            val fp = prefs.getString("device_fingerprint", null) ?: return
            val url = java.net.URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
            }
            val payload = JSONObject().apply {
                put("state", "ERROR")
                put("message", message.take(400))
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            conn.responseCode
        } catch (_: Exception) { /* best-effort */ }
    }

    private fun relaunchSelf(context: Context) {
        for (attempt in 0..7) {
            // TC22 F1 — eight `startActivity` calls, one per second, is the
            // loudest of the relaunch actors and it ran completely blind. If
            // WE have a system install confirmation on the glass (the
            // companion upgrade raised from ManagerBootstrap), every one of
            // these pulls MainActivity in front of it. Re-read the fact on
            // EVERY attempt, not once at the top: the prompt can be raised
            // mid-loop.
            if (com.educms.player.MainActivity.installPromptOutstanding) {
                PlayerLogger.i(
                    TAG,
                    "relaunch attempt=$attempt skipped — a system install confirmation is " +
                        "outstanding; relaunching would bury it",
                )
                return
            }
            try {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    context.startActivity(launch)
                    PlayerLogger.i(TAG, "Player relaunched after OTA install (attempt=$attempt)")
                    return
                }
            } catch (ex: Exception) {
                PlayerLogger.w(TAG, "Player relaunch failed (attempt=$attempt): ${ex.message}")
            }
            try {
                Thread.sleep(1000)
            } catch (_: InterruptedException) {
                break
            }
        }
        reportOtaError(context, "Install succeeded but Player did not relaunch; reboot or open EduCMS Player")
    }

    private fun statusName(status: Int): String = when (status) {
        PackageInstaller.STATUS_FAILURE -> "FAILURE"
        PackageInstaller.STATUS_FAILURE_ABORTED -> "FAILURE_ABORTED"
        PackageInstaller.STATUS_FAILURE_BLOCKED -> "FAILURE_BLOCKED"
        PackageInstaller.STATUS_FAILURE_CONFLICT -> "FAILURE_CONFLICT"
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "FAILURE_INCOMPATIBLE"
        PackageInstaller.STATUS_FAILURE_INVALID -> "FAILURE_INVALID"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "FAILURE_STORAGE"
        else -> "UNKNOWN($status)"
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
        const val ACTION_LAUNCH_INSTALL_PROMPT = "com.educms.player.LAUNCH_INSTALL_PROMPT"

        /**
         * AND-006 — in-process hand-off of the system-minted install
         * confirmation Intent. Deliberately NOT an Intent extra:
         * MainActivity is exported, so an extra is caller-controllable by
         * any app on the device. Only code inside our own UID can write
         * here.
         */
        @Volatile
        private var pendingInstallPrompt: StagedInstallPrompt? = null

        fun stagePendingInstallPrompt(
            intent: Intent,
            targetPackage: String?,
            targetVersionCodeAtStage: Int,
        ) {
            pendingInstallPrompt = StagedInstallPrompt(
                intent = intent,
                targetPackage = targetPackage,
                targetVersionCodeAtStage = targetVersionCodeAtStage,
                stagedAtMs = android.os.SystemClock.elapsedRealtime(),
            )
        }

        /**
         * NON-destructive read (TC22 F4).
         *
         * ⚠️ This used to be `takePendingInstallPrompt` — single-use, one
         * reader, which nulled it. So a BAL-dropped launch, or a dialog the
         * operator covered, consumed the only copy and NOTHING re-staged
         * it: the bundled-companion upgrade could then be retried only by a
         * cold `onCreate`. The intent now survives until the install lands
         * or it goes stale, so `MainActivity` can re-show it — under a hard
         * cap, because a dialog a person cannot dismiss is a brick with
         * better manners. See [InstallPromptGate.shouldReissue].
         */
        fun peekPendingInstallPrompt(): StagedInstallPrompt? = pendingInstallPrompt

        /**
         * The installed versionCode of [pkg] right now, or -1 when it is
         * not installed / unreadable. Recorded at stage time so a later
         * read can prove whether the install this prompt was asking about
         * has since landed.
         */
        @Suppress("DEPRECATION")
        fun installedVersionCodeOf(ctx: Context, pkg: String?): Int = try {
            if (pkg == null) -1 else ctx.packageManager.getPackageInfo(pkg, 0).versionCode
        } catch (_: Exception) {
            -1
        }

        /** Drop a staged prompt without showing it (it landed, or went stale). */
        fun clearPendingInstallPrompt() {
            pendingInstallPrompt = null
        }

        /**
         * Which package is this status broadcast about?
         *
         * `EXTRA_PACKAGE_NAME` is populated by the platform for sessions
         * that named their target with `setAppPackageName` — which, as of
         * TC22 F3, is every session we commit. Null on a ROM that omits it;
         * a null target simply means "any observed package change counts",
         * which is the safe direction (it can only END a relaunch hold
         * early, never extend one).
         */
        fun targetPackageOf(statusIntent: Intent): String? = try {
            statusIntent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * The staged confirmation plus the two facts a caller needs to decide
 * anything about it: WHICH package it is asking about (so a later
 * PACKAGE_ADDED / version read can prove it landed) and WHEN it was staged
 * (so it can go stale).
 *
 * Top-level, like [RelaunchFacts], so the trampoline's signature reads as
 * `StagedInstallPrompt` rather than a nested-companion path.
 */
class StagedInstallPrompt(
    val intent: Intent,
    val targetPackage: String?,
    /** Installed versionCode of [targetPackage] when this was staged; -1 = unknown. */
    val targetVersionCodeAtStage: Int,
    val stagedAtMs: Long,
)
