package com.educms.player.ota

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.educms.player.MainActivity
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * RelaunchEscalation — one implementation of "come back on screen after an
 * OTA", and one honest report when Android will not let us.
 *
 * ── WHAT WENT WRONG (2026-09-01, two panels, verified on the fleet) ──────
 *
 * Two Goodview panels — one Android 11 carrying an OEM device owner that is
 * not ours, one Android 13 with no device owner at all — installed a player
 * OTA and the app never relaunched. The operator walked to each panel.
 *
 * Every relaunch path we ship ends in `startActivity` from a BACKGROUND
 * process, and Android 10+ SILENTLY DROPS that. Not an exception, not a
 * result code — nothing. The launch is legal only when the app is the
 * default HOME, holds SYSTEM_ALERT_WINDOW ("Display over other apps"), or is
 * / has a device owner. Neither panel had any of the three.
 *
 * ⚠️ THE COMMENT THAT MISLED US. `HeartbeatService`'s FGS trampoline reasons
 * from Android 14 BAL-grant semantics ("this FGS received the 20-second BAL
 * grant from the MY_PACKAGE_REPLACED broadcast"). That grant is an Android
 * 14 (API 34) construct. It does not exist on API 30 or 33, which is what
 * these two panels run — so the trampoline that was "verified on emulator"
 * proved a path that the actual fleet does not have. The FGS start still
 * works everywhere; only the ACTIVITY start it then performs is the part
 * that silently dies. That trampoline is kept (it is correct on 14+) and is
 * now the FIRST rung of this ladder rather than the whole story.
 *
 * ── WHAT THIS DOES ───────────────────────────────────────────────────────
 *
 * `attempt` is the single implementation, called from both relaunch paths
 * (PostInstallRelaunchWorker and HeartbeatService's EXTRA_LAUNCH_MAIN
 * branch). It launches, then PROVES the launch landed instead of assuming
 * it did, and escalates on the evidence:
 *
 *   1. launch (the existing per-API-34 PendingIntent/BAL path, unchanged)
 *   2. +8 s — [MainActivity.isInForeground] still false?
 *      a. we hold "Display over other apps" → ONE more `startActivity`
 *         (the overlay grant is what makes it legal), then +8 s again
 *      b. otherwise → straight to 3
 *   3. post ONE high-importance notification (channel "ota", full-screen +
 *      content intent to MainActivity), and POST `RELAUNCH_BLOCKED` to
 *      ota-state naming the capability this panel is actually missing.
 *
 * ⚠️ COPY STATES WHAT THE EVIDENCE PROVES. We can see: the install
 * completed, we called `startActivity`, and MainActivity did not report
 * foreground inside the window. We CANNOT see the glass, and we never
 * receive a "blocked" signal from the OS — so the report says what we did
 * and what we observed, then names the missing grant as the mechanism. It
 * never claims the screen is back.
 *
 * ⚠️ THIS RUNS IN A FRESH POST-UPGRADE PROCESS. Every step is best-effort
 * and individually caught: a relaunch helper that can throw is a relaunch
 * helper that takes the player down on the one boot that matters. It must
 * never block playback either — the launch is fire-and-forget and the
 * follow-ups are Handler callbacks.
 */
object RelaunchEscalation {

    private const val TAG = "RelaunchEscalation"

    /** SharedPreferences file + keys — the SAME ones OtaInstallReceiver reads. */
    private const val PREFS = "edu_player"
    private const val KEY_API_ROOT = "api_root"
    private const val KEY_FINGERPRINT = "device_fingerprint"

    /**
     * How long a launch is given to reach `onResume` before we call it
     * un-landed. 8 s is comfortably past a cold Activity start on the
     * slowest panel we ship to (a Chromium-83 Taurus after an OTA) and far
     * short of the operator's patience.
     */
    const val CHECK_DELAY_MS = 8_000L

    /**
     * Total wall time [attempt] may still be working after it returns:
     * first check, optional overlay retry, second check. Exposed so a
     * caller running in a WorkManager job can stay alive across it —
     * `doWork` returning is a licence for the OS to kill the process, and a
     * killed process silently drops the pending Handler callbacks.
     */
    const val ESCALATION_WINDOW_MS = CHECK_DELAY_MS * 2

    /** Notification id. 42 is the OTA install prompt, 1001 the heartbeat FGS. */
    private const val NOTIF_ID = 43

    /** Channel id, created by PlayerApp; re-created defensively before use. */
    private const val CHANNEL_OTA = "ota"

    /** The ota-state the server accepts for this outcome. */
    private const val STATE_RELAUNCH_BLOCKED = "RELAUNCH_BLOCKED"

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * A chain is mid-flight. Both callers can fire within seconds of each
     * other by design (the FGS trampoline immediately, the worker ~60 s
     * later — belt and suspenders), and two overlapping chains would mean
     * two notifications and two reports for one install.
     */
    @Volatile
    private var chainInFlight = false

    /**
     * We have already told the dashboard (and the operator) about this
     * process's blocked relaunch. Process-scoped on purpose: a later
     * genuine failure in a NEW process is a new fact worth reporting, but
     * within one post-upgrade process the answer cannot change and
     * repeating it is noise on a surface that must stay trustworthy.
     */
    @Volatile
    private var escalatedThisProcess = false

    /**
     * Launch the player and, if it does not land, escalate.
     *
     * Returns immediately. [source] names the caller in the log so a field
     * log says which rung fired ("post-install-worker", "fgs-package-replaced").
     */
    fun attempt(ctx: Context, source: String) {
        try {
            // ⚠️ v1.1.11 (TC22 field test, 2026-09-01): if the player is
            // ALREADY on glass there is nothing to relaunch — bail before
            // touching startActivity. Without this, the +60s worker rung
            // fires CLEAR_TOP into the live singleTask MainActivity, which
            // delivers onNewIntent + an onPause/onResume cycle ~a minute
            // after every install. That churn is what tore down the
            // post-upgrade grant card while the operator was READING it.
            // The check is the same fact the whole ladder trusts
            // (onResume-proven foreground), read at its cheapest point.
            if (MainActivity.isInForeground) {
                PlayerLogger.i(
                    TAG,
                    "relaunch attempt from $source skipped — MainActivity already foreground",
                )
                return
            }
            if (chainInFlight) {
                PlayerLogger.i(TAG, "relaunch attempt from $source skipped — a chain is already in flight")
                return
            }
            chainInFlight = true
            val launched = launchNow(ctx, source)
            if (!launched) {
                // Nothing to wait for: there is no launch intent at all, so
                // this is a broken install rather than a blocked launch.
                chainInFlight = false
                return
            }
            mainHandler.postDelayed({ firstCheck(ctx, source) }, CHECK_DELAY_MS)
        } catch (t: Throwable) {
            chainInFlight = false
            PlayerLogger.w(TAG, "relaunch attempt from $source failed: ${t.message}")
        }
    }

    /**
     * The launch itself — byte-for-byte the call PostInstallRelaunchWorker
     * has always made, including the Android-14 BAL PendingIntent path.
     *
     * @return false only when this package has NO launch intent (a broken
     *         install); true when the call was made. ⚠️ True is NOT proof
     *         the Activity started — that is the entire point of this file.
     */
    private fun launchNow(ctx: Context, source: String): Boolean {
        val launch = try {
            ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "launch intent lookup threw: ${t.message}")
            null
        }
        if (launch == null) {
            PlayerLogger.w(TAG, "no launch intent for ${ctx.packageName} — broken install?")
            return false
        }
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED,
        )
        try {
            // 2026-05-12 (Player v1.0.56) — Android 14+ BAL path. Cold-started
            // worker processes have no foregrounded activity and no recent BAL
            // grant, so a direct startActivity is refused by
            // ActivityTaskManager. PendingIntent +
            // setPendingIntentBackgroundActivityStartMode(MODE_ALLOWED) is the
            // documented request for that grant. Unchanged — on API 34+ it is
            // still the right call; on 30/33 it does not exist, which is why
            // the check below exists at all.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Api34BalLauncher.launchAllowingBackgroundStart(ctx, launch)
            } else {
                ctx.startActivity(launch)
            }
            PlayerLogger.i(TAG, "relaunch startActivity dispatched for ${ctx.packageName} (source=$source)")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "relaunch startActivity failed ($source): ${t.message}")
        }
        return true
    }

    /** +8 s: did it land? If not, take whichever rung the facts allow. */
    private fun firstCheck(ctx: Context, source: String) {
        try {
            val facts = readFacts(ctx, overlayRetryUsed = false)
            when (RelaunchEscalationMath.next(facts)) {
                RelaunchStage.SETTLED -> {
                    chainInFlight = false
                    PlayerLogger.i(TAG, "relaunch landed — MainActivity resumed (source=$source)")
                }
                RelaunchStage.RETRY_WITH_OVERLAY -> {
                    PlayerLogger.i(
                        TAG,
                        "no foreground ${CHECK_DELAY_MS / 1000}s after relaunch; " +
                            "\"Display over other apps\" is granted — retrying the launch once",
                    )
                    launchNow(ctx, "$source/overlay-retry")
                    mainHandler.postDelayed({ secondCheck(ctx, source, facts) }, CHECK_DELAY_MS)
                }
                RelaunchStage.ESCALATE -> {
                    chainInFlight = false
                    escalate(ctx, source, facts)
                }
            }
        } catch (t: Throwable) {
            chainInFlight = false
            PlayerLogger.w(TAG, "relaunch first check failed: ${t.message}")
        }
    }

    /** +8 s after the overlay retry: last word. */
    private fun secondCheck(ctx: Context, source: String, previous: RelaunchFacts) {
        chainInFlight = false
        try {
            val facts = readFacts(ctx, overlayRetryUsed = true)
            if (facts.foreground) {
                PlayerLogger.i(TAG, "relaunch landed on the overlay retry (source=$source)")
                return
            }
            escalate(ctx, source, facts)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "relaunch second check failed: ${t.message}")
            // Still say something rather than going quiet on the one path
            // whose whole job is to not go quiet.
            runCatching { escalate(ctx, source, previous.copy(overlayRetryUsed = true)) }
        }
    }

    /**
     * The screen did not come back. Tell the person at the panel (a
     * notification they can tap) AND the dashboard (an ota-state row a
     * remote operator can see), once per process.
     */
    private fun escalate(ctx: Context, source: String, facts: RelaunchFacts) {
        if (escalatedThisProcess) {
            PlayerLogger.i(TAG, "relaunch still not landed ($source) — already reported this process")
            return
        }
        escalatedThisProcess = true
        val message = RelaunchEscalationMath.blockedMessage(facts)
        PlayerLogger.w(TAG, "relaunch NOT landed ($source): $message")
        postRelaunchNotification(ctx)
        reportRelaunchBlocked(ctx, message)
    }

    /** Read every fact we can honestly observe. Each probe caught on its own. */
    private fun readFacts(ctx: Context, overlayRetryUsed: Boolean) = RelaunchFacts(
        foreground = MainActivity.isInForeground,
        canDrawOverlays = canDrawOverlays(ctx),
        isHomeApp = isHomeApp(ctx),
        deviceOwnerIsOurs = deviceOwnerIsOurs(ctx),
        overlayRetryUsed = overlayRetryUsed,
    )

    // `canDrawOverlays` is API 23+ and this module's minSdk is 24, so no
    // version guard is needed (lint's ObsoleteSdkInt agrees).
    private fun canDrawOverlays(ctx: Context): Boolean = try {
        Settings.canDrawOverlays(ctx.applicationContext)
    } catch (_: Throwable) {
        false
    }

    /**
     * Are WE the default HOME? Same idiom as SetupCeremony's HOME step —
     * resolve the HOME intent and compare packages. A HOME-default panel is
     * relaunched by the OS itself, which is why it never reaches this file
     * in anger.
     */
    private fun isHomeApp(ctx: Context): Boolean = try {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val res = ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        res?.activityInfo?.packageName == ctx.packageName
    } catch (_: Throwable) {
        false
    }

    /**
     * Is a device owner OURS (Player or the Manager companion)?
     *
     * ⚠️ Deliberately narrow, because it is the only question Android will
     * answer cheaply: `isDeviceOwnerApp` takes a package and there is no
     * unprivileged API for "who is the device owner". So a false here means
     * "not one of ours" — NOT "there is no device owner". On this fleet the
     * common case is precisely a VENDOR owner we are not, which grants us
     * nothing; saying more than this would be inventing evidence.
     */
    private fun deviceOwnerIsOurs(ctx: Context): Boolean = try {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE)
            as? android.app.admin.DevicePolicyManager
        dpm != null && listOf(
            ctx.packageName,
            "com.educms.manager",
            "com.educms.manager.debug",
        ).any { dpm.isDeviceOwnerApp(it) }
    } catch (_: Throwable) {
        false
    }

    /**
     * ONE notification, on the existing high-importance "ota" channel, with
     * a full-screen intent AND a content intent so it is tappable either
     * way. A fixed id, so a second post replaces rather than stacks.
     *
     * Degrades quietly and by design: the full-screen intent needs
     * USE_FULL_SCREEN_INTENT (auto-granted on the API 30/33 panels this
     * fixes; user-gated on 34+, where it falls back to a heads-up), and on
     * API 33+ POST_NOTIFICATIONS may never have been granted at all. Either
     * way the ota-state report below still reaches the dashboard — the
     * notification is the on-panel half, never the only half.
     */
    private fun postRelaunchNotification(ctx: Context) {
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_OTA,
                        "Player updates",
                        NotificationManager.IMPORTANCE_HIGH,
                    ),
                )
            }
            val open = Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pi = PendingIntent.getActivity(
                ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notif = NotificationCompat.Builder(ctx, CHANNEL_OTA)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("VenueOS updated")
                .setContentText("VenueOS updated — tap to bring signage back")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .setAutoCancel(true)
                .build()
            nm.notify(NOTIF_ID, notif)
            PlayerLogger.i(TAG, "posted the tap-to-return notification")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not post the tap-to-return notification: ${t.message}")
        }
    }

    /**
     * POST the outcome to ota-state. Same prefs, same URL shape, same
     * best-effort discipline as `OtaInstallReceiver.reportOtaError` — with
     * one deliberate difference: it runs on its OWN thread, because this is
     * reached from a main-thread Handler callback and a network call there
     * throws NetworkOnMainThreadException (an exception a `catch` would
     * swallow into permanent silence).
     */
    private fun reportRelaunchBlocked(ctx: Context, message: String) {
        val app = ctx.applicationContext
        Thread {
            try {
                val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val apiRoot = prefs.getString(KEY_API_ROOT, null) ?: return@Thread
                val fp = prefs.getString(KEY_FINGERPRINT, null) ?: return@Thread
                val url = URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 5_000
                    readTimeout = 5_000
                }
                val payload = JSONObject().apply {
                    put("state", STATE_RELAUNCH_BLOCKED)
                    put("message", message.take(400))
                }
                conn.outputStream.use { it.write(payload.toString().toByteArray()) }
                val rc = conn.responseCode
                if (rc !in 200..299) {
                    PlayerLogger.w(TAG, "ota-state $STATE_RELAUNCH_BLOCKED → HTTP $rc")
                } else {
                    PlayerLogger.i(TAG, "ota-state → $STATE_RELAUNCH_BLOCKED")
                }
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "ota-state $STATE_RELAUNCH_BLOCKED report failed: ${t.message}")
            }
        }.start()
    }
}

/** What escalation should do next. */
enum class RelaunchStage {
    /** MainActivity is resumed — the launch landed, nothing more to do. */
    SETTLED,

    /** Not landed, but the overlay grant makes another launch legal. */
    RETRY_WITH_OVERLAY,

    /** Not landed, and nothing left to try in software. */
    ESCALATE,
}

/**
 * Everything the decision is allowed to use, and nothing it is not.
 *
 * @param foreground        did MainActivity reach onResume? The ONLY proof.
 * @param canDrawOverlays   "Display over other apps" — one of the three
 *                          things that make a background activity start legal.
 * @param isHomeApp         are we the default HOME? Another of the three.
 * @param deviceOwnerIsOurs is Player/Manager the device owner? The third —
 *                          and false on this fleet, where the vendor owns it.
 * @param overlayRetryUsed  have we already spent the one overlay retry?
 */
data class RelaunchFacts(
    val foreground: Boolean,
    val canDrawOverlays: Boolean,
    val isHomeApp: Boolean,
    val deviceOwnerIsOurs: Boolean,
    val overlayRetryUsed: Boolean,
)

/**
 * The pure half of [RelaunchEscalation] — split out for the same reason
 * `SetupCeremonyMath` and `DisplayScheduleMath` are: the rules that decide
 * whether an operator gets a notification, and what that notification
 * claims, are worth a test that does not need an emulator.
 *
 * No Context, no Handler, no network.
 */
object RelaunchEscalationMath {

    fun next(facts: RelaunchFacts): RelaunchStage = when {
        facts.foreground -> RelaunchStage.SETTLED
        facts.canDrawOverlays && !facts.overlayRetryUsed -> RelaunchStage.RETRY_WITH_OVERLAY
        else -> RelaunchStage.ESCALATE
    }

    /**
     * What we tell the dashboard. Reads as: what we did, what we saw, why
     * Android is likely to have refused, and the one thing a human can do.
     *
     * ⚠️ It never says the screen is back, and never says the screen is
     * frozen — we cannot see the glass. "Did not report foreground" is
     * exactly what we measured.
     */
    fun blockedMessage(facts: RelaunchFacts): String {
        val observed = "Installed OK, but the player did not report foreground after " +
            (if (facts.overlayRetryUsed) "two relaunch attempts" else "a relaunch attempt") + "."
        val missing = buildList {
            if (!facts.canDrawOverlays) add("\"Display over other apps\"")
            if (!facts.isHomeApp) add("the Home-app default")
        }
        val why = when {
            missing.size == 2 ->
                " Android blocks a background app launch unless the app is the Home app, " +
                    "holds \"Display over other apps\", or is a device owner — this screen " +
                    "has none of the three."
            missing.size == 1 ->
                " This screen is missing ${missing.first()}, one of the grants that make a " +
                    "background app launch legal."
            facts.deviceOwnerIsOurs ->
                " This screen holds every grant we can check (Home, overlay, device owner), " +
                    "so the cause is not a missing permission."
            else ->
                " This screen holds every grant we can check (Home and overlay), so the " +
                    "cause is not a missing permission."
        }
        val fix = if (missing.isEmpty()) {
            " Tap the app once at the panel to bring it back."
        } else {
            " Grant it in setup (Screens → ⚙ → \"Open setup on this panel\"), " +
                "or tap the app once at the panel."
        }
        return observed + why + fix
    }
}
