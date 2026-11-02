package com.educms.player.settings

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import com.educms.player.R
import com.educms.player.display.DisplayEmergency
import com.educms.player.heartbeat.HeartbeatService
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.LockTaskController
import com.educms.player.standby.UserStandby
import java.lang.ref.WeakReference

/**
 * Android's save-network dialog, raised by a PERSON (2026-10-23).
 *
 * The heartbeat STAGES the request ([stage]) and reports "waiting for someone
 * at the screen". Nothing goes on the glass by itself — the owner's binding
 * rule for system prompts (`ota/UpdatePromptPolicy`): a video is never
 * interrupted for one. When a person uses the screen (a remote key or a touch
 * reaches MainActivity — [personPresent]), VenueOS's own card goes up:
 *
 *     Save Wi-Fi network "<name>"        [ Save network ]  [ Not now ]
 *
 * Remote-operable (player rule 15): focus is PARKED on "Save network" with the
 * Activity's visible highlight; Back takes the card down (it comes back on the
 * next use of the screen, after [WifiSetupPolicy.CARD_COOLDOWN_MS] — an escape
 * never burns the request); "Not now" is the person's no. OK raises Android's
 * own dialog from that press, for a result; Android's dialog is a system
 * Settings page, where Back cancels.
 *
 * Emergency first: the card is never offered during a hold, and leaves the
 * moment one starts (the request stays staged). While a person is in
 * Android's dialog the background relaunch paths keep off the glass
 * ([relaunchShouldYield]) — never during an alert.
 *
 * ⚠️ The staged request holds the passphrase IN MEMORY ONLY. It is never
 * written down; a process that dies loses it, and the unit asks the server
 * for the passphrase again. Results ([lastResult]) carry no secret.
 */
object WifiSavePrompt {

    private const val TAG = "WifiSavePrompt"
    private const val KEY_RESULT_ID = "dialog.resultId"
    private const val KEY_RESULT = "dialog.result"
    private const val KEY_RAISED_ID = "dialog.raisedId"

    private class Stage(val id: String, val ssid: String, val request: Intent, val stagedAtElapsedMs: Long)

    @Volatile private var stage: Stage? = null

    // ── the card (main thread only) ─────────────────────────────────────
    private val main = Handler(Looper.getMainLooper())
    private var host: WeakReference<Activity>? = null
    private var launcher: ActivityResultLauncher<Intent>? = null
    private var decorate: (View) -> Unit = {}
    private var foreground: () -> Boolean = { false }
    private var otherCardShowing: () -> Boolean = { false }
    private var lastPausedAt: () -> Long = { 0L }
    private var card: View? = null
    private var cardShownAtMs = 0L
    @Volatile private var cooldownUntilMs = 0L
    private const val PLAYER_PREFS = "edu_player"
    private var holdPrefs: android.content.SharedPreferences? = null
    private var holdListener: android.content.SharedPreferences.OnSharedPreferenceChangeListener? = null

    @Volatile private var raisedAtMs = 0L
    @Volatile private var raisedId: String? = null

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PrefsWifiStateStore.PREFS, Context.MODE_PRIVATE)

    // ─────────────────────────────────────────────────────────────────
    // the stage — any thread
    // ─────────────────────────────────────────────────────────────────

    /** Called by `WifiSetup` (heartbeat thread). Replaces any older stage: one card per unit. */
    internal fun stage(id: String, ssid: String, request: Intent) {
        stage = Stage(id, ssid, request, SystemClock.elapsedRealtime())
        cooldownUntilMs = 0L
        PlayerLogger.i(TAG, "save dialog staged for $id — waiting for a person at the screen")
    }

    /** The identity staged in this process, if its window is still open (an expired one is recorded). */
    internal fun stagedId(ctx: Context): String? {
        val s = stage ?: return null
        if (WifiSetupPolicy.dialogExpired(s.stagedAtElapsedMs, SystemClock.elapsedRealtime()) && raisedId != s.id) {
            record(ctx, s.id, DeviceSettingCodes.WIFI_NO_ANSWER)
            return null
        }
        return s.id
    }

    /** The last answer, by identity. */
    internal fun lastResult(ctx: Context): Pair<String, String>? {
        val p = prefs(ctx)
        val id = p.getString(KEY_RESULT_ID, null) ?: return null
        val code = p.getString(KEY_RESULT, null) ?: return null
        return id to code
    }

    /** The operator moved on (another network, or stopped managing Wi-Fi): drop a stage for any other identity. */
    internal fun keepOnly(id: String?) {
        val s = stage ?: return
        if (s.id == id) return
        stage = null
        main.post { if (card != null) hide("the saved network changed") }
        PlayerLogger.i(TAG, "staged save dialog ${s.id} dropped — the desired network changed")
    }

    // ─────────────────────────────────────────────────────────────────
    // the host — MainActivity, main thread
    // ─────────────────────────────────────────────────────────────────

    /** MainActivity.onResume. The launcher is registered once per Activity instance, before it started. */
    fun attach(
        activity: Activity,
        launcher: ActivityResultLauncher<Intent>,
        decorate: (View) -> Unit,
        foreground: () -> Boolean,
        otherCardShowing: () -> Boolean,
        lastPausedAt: () -> Long,
    ) {
        host = WeakReference(activity)
        this.launcher = launcher
        this.decorate = decorate
        this.foreground = foreground
        this.otherCardShowing = otherCardShowing
        this.lastPausedAt = lastPausedAt
    }

    fun detach(activity: Activity) {
        if (host?.get() !== activity) return
        hide("host destroyed")
        host = null
        launcher = null
        // The lambdas close over the Activity: none of them may outlive it.
        decorate = {}
        foreground = { false }
        otherCardShowing = { false }
        lastPausedAt = { 0L }
    }

    fun isShowing(): Boolean = card != null

    /**
     * A person used the screen (MainActivity.onUserInteraction). Posted, so
     * the key or touch that brought it is delivered as it always was.
     */
    fun personPresent(activity: Activity) {
        if (stage == null || card != null) return
        main.post { maybeOffer(activity) }
    }

    private fun maybeOffer(activity: Activity) {
        if (host?.get() !== activity || activity.isFinishing) return
        val app = activity.applicationContext
        val s = stage ?: return
        if (raisedId == s.id) return // Android's dialog is already up
        val now = SystemClock.elapsedRealtime()
        val expired = WifiSetupPolicy.dialogExpired(s.stagedAtElapsedMs, now)
        if (expired) {
            record(app, s.id, DeviceSettingCodes.WIFI_NO_ANSWER)
            return
        }
        val offer = WifiSetupPolicy.mayOfferCard(
            staged = true,
            expired = false,
            foreground = runCatching(foreground).getOrDefault(false),
            interactive = runCatching {
                (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive
            }.getOrNull() == true,
            emergencyHeld = heldNow(app),
            lockTask = runCatching { LockTaskController.isActive(activity) }.getOrDefault(true),
            standby = runCatching { UserStandby.isActive(app) }.getOrDefault(true),
            otherCardShowing = card != null || runCatching(otherCardShowing).getOrDefault(true),
            cooldownUntilElapsedMs = cooldownUntilMs,
            nowElapsedMs = now,
        )
        if (offer) show(activity, s)
    }

    private fun show(activity: Activity, s: Stage) {
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), activity.resources.displayMetrics).toInt()

        val save = Button(activity).apply {
            setAllCaps(false)
            text = activity.getString(R.string.wifi_card_save)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            setPadding(dp(32), dp(16), dp(32), dp(16))
        }
        val later = Button(activity).apply {
            setAllCaps(false)
            text = activity.getString(R.string.wifi_card_later)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setPadding(dp(24), dp(12), dp(24), dp(12))
        }
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(48), dp(48), dp(48), dp(48))
            addView(TextView(activity).apply {
                text = activity.getString(R.string.wifi_card_title)
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
                gravity = Gravity.CENTER
            })
            addView(TextView(activity).apply {
                text = activity.getString(R.string.wifi_card_body, s.ssid)
                setTextColor(0xFFD1D5DB.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                gravity = Gravity.CENTER
                setPadding(0, dp(16), 0, dp(32))
            })
            addView(save)
            addView(later, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(16) })
        }
        val view = FrameLayout(activity).apply {
            setBackgroundColor(0xE6111827.toInt())
            isClickable = true // touches meant for the content behind stay off it
            addView(column, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
            ))
        }
        decorate(save)
        decorate(later)
        val back = View.OnKeyListener { _, keyCode, event ->
            val isBack = keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE
            if (isBack && event.action == KeyEvent.ACTION_UP) {
                // An escape, not an answer: the request stays and comes back later.
                cooldownUntilMs = SystemClock.elapsedRealtime() + WifiSetupPolicy.CARD_COOLDOWN_MS
                hide("back")
            }
            isBack
        }
        save.setOnKeyListener(back)
        later.setOnKeyListener(back)
        save.setOnClickListener {
            hide("save pressed")
            raise(activity, s.id, s.request)
        }
        later.setOnClickListener {
            hide("not now")
            record(activity.applicationContext, s.id, DeviceSettingCodes.WIFI_DECLINED)
        }

        root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.bringToFront()
        card = view
        cardShownAtMs = SystemClock.elapsedRealtime()
        save.requestFocus()
        PlayerLogger.i(TAG, "save-network card shown for ${s.id} — focus parked on Save network")

        val app = activity.applicationContext
        // ⚠️ The alert wins at once: the hold's own write takes the card down
        // (the 1 s watch below is the belt).
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if ((key == null || key.startsWith("display_emergency_hold")) && heldNow(app)) {
                main.post { if (card === view) hide("an emergency hold started") }
            }
        }
        holdPrefs = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE).also {
            it.registerOnSharedPreferenceChangeListener(listener)
        }
        holdListener = listener
        val watch = object : Runnable {
            override fun run() {
                if (card !== view) return
                if (!WifiSetupPolicy.keepCard(heldNow(app), SystemClock.elapsedRealtime() - cardShownAtMs)) {
                    cooldownUntilMs = SystemClock.elapsedRealtime() + WifiSetupPolicy.CARD_COOLDOWN_MS
                    hide("emergency hold or no answer")
                } else {
                    main.postDelayed(this, 1_000L)
                }
            }
        }
        main.postDelayed(watch, 1_000L)
    }

    private fun hide(reason: String) {
        val v = card ?: return
        card = null
        holdListener?.let { l -> runCatching { holdPrefs?.unregisterOnSharedPreferenceChangeListener(l) } }
        holdListener = null
        holdPrefs = null
        runCatching { (v.parent as? ViewGroup)?.removeView(v) }
        PlayerLogger.i(TAG, "save-network card removed ($reason)")
    }

    /**
     * A person asked from VenueOS's own on-screen network screen
     * ([WifiConnect]): their press there IS the confirmation, so Android's
     * dialog goes up now, without the card. Main thread. Never over an alert.
     */
    internal fun raiseNow(activity: Activity, id: String, request: Intent) {
        if (heldNow(activity.applicationContext)) {
            recordAnswer(activity.applicationContext, id, DeviceSettingCodes.WAIT_EMERGENCY)
            return
        }
        raise(activity, id, request)
    }

    /** OK on the card (or a person's press on the network screen): Android's own dialog, for a result. */
    private fun raise(activity: Activity, id: String, request: Intent) {
        val app = activity.applicationContext
        val l = launcher
        if (l == null) {
            record(app, id, DeviceSettingCodes.WIFI_NO_DIALOG)
            return
        }
        raisedAtMs = SystemClock.elapsedRealtime()
        raisedId = id
        prefs(app).edit().putString(KEY_RAISED_ID, id).commit()
        try {
            l.launch(request)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "save-network dialog would not open: ${t.message}")
            record(app, id, DeviceSettingCodes.WIFI_NO_DIALOG)
            return
        }
        val raisedAt = raisedAtMs
        main.postDelayed({
            if (raisedId == id && raisedAtMs == raisedAt &&
                !WifiSetupPolicy.dialogAppeared(raisedAt, runCatching(lastPausedAt).getOrDefault(0L))
            ) {
                PlayerLogger.w(TAG, "save-network dialog did not come up within ${WifiSetupPolicy.DIALOG_VERIFY_MS} ms")
                record(app, id, DeviceSettingCodes.WIFI_NO_DIALOG)
            }
        }, WifiSetupPolicy.DIALOG_VERIFY_MS)
    }

    /** Record an answer that did not come from Android's dialog (an alert, no host). */
    internal fun recordAnswer(ctx: Context, id: String, code: String) = record(ctx, id, code)

    /** Android's answer (MainActivity's activity-result callback). */
    fun onResult(ctx: Context, resultCode: Int, data: Intent?) {
        val app = ctx.applicationContext
        val id = raisedId ?: prefs(app).getString(KEY_RAISED_ID, null) ?: return
        val upFor = if (raisedAtMs > 0L) SystemClock.elapsedRealtime() - raisedAtMs else Long.MAX_VALUE
        val perNetwork = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            Api30WifiAddNetworks.results(data)
        } else {
            null
        }
        val ok = resultCode == Activity.RESULT_OK
        record(
            app,
            id,
            WifiSetupPolicy.dialogResult(ok, perNetwork, upFor),
            alreadySaved = WifiSetupPolicy.dialogAlreadySaved(ok, perNetwork),
        )
    }

    /** Must the background relaunch paths keep off the glass right now? Never during an alert. */
    fun relaunchShouldYield(ctx: Context): Boolean = try {
        WifiSetupPolicy.relaunchShouldYield(
            raisedAtElapsedMs = raisedAtMs,
            answered = raisedId == null,
            nowElapsedMs = SystemClock.elapsedRealtime(),
            emergencyHeld = heldNow(ctx.applicationContext),
        )
    } catch (_: Throwable) {
        false
    }

    /** Write the answer down (no secret), drop the stage, and tell the dashboard now. */
    private fun record(ctx: Context, id: String, code: String, alreadySaved: Boolean = false) {
        val app = ctx.applicationContext
        prefs(app).edit()
            .putString(KEY_RESULT_ID, id)
            .putString(KEY_RESULT, code)
            .remove(KEY_RAISED_ID)
            .commit()
        if (stage?.id == id) stage = null
        if (raisedId == id) {
            raisedId = null
            raisedAtMs = 0L
        }
        main.post { if (card != null) hide("answered") }
        PlayerLogger.i(TAG, "save dialog $id: $code${if (alreadySaved) " (already saved — Android connects to nothing)" else ""}")
        if (WifiConnect.isLocal(id)) {
            // A person's request from the network screen: tell it, not the dashboard.
            val outcome = when (code) {
                DeviceSettingCodes.WIFI_SAVED -> DeviceSettingsPolicy.Outcome.Landed(code)
                DeviceSettingCodes.WAIT_EMERGENCY ->
                    DeviceSettingsPolicy.Outcome.Held(DeviceSettingsPolicy.Status.WAITING, code)
                else -> DeviceSettingsPolicy.Outcome.Error(code)
            }
            WifiConnect.complete(app, id, outcome, alreadySaved)
            return
        }
        runCatching { HeartbeatService.requestPromptTick(app, "wifi-dialog") }
    }

    /** Unreadable reads as HELD — the safe direction for anything over an alert. */
    private fun heldNow(app: Context): Boolean = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
}
