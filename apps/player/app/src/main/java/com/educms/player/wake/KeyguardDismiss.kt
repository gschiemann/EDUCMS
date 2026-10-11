package com.educms.player.wake

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * GET PAST THE KEYGUARD A DEVICE-ADMIN LOCK LEAVES BEHIND (2026-10-11).
 *
 * `DevicePolicyManager.lockNow()` sleeps the panel AND engages the keyguard.
 * On the fleet that keyguard is swipe/none (the provider declines the tier on
 * a secure lock), and `MainActivity` has always walked through it with
 * `android:showWhenLocked` + the deprecated `FLAG_DISMISS_KEYGUARD`. Since
 * API 26 the supported way to ask is `KeyguardManager.requestDismissKeyguard`
 * FROM THE ACTIVITY, and `Activity.setShowWhenLocked(true)` (API 27) is the
 * live form of the manifest attribute. Both are re-asserted on every resume
 * and on every window-flag wake, so the moment the Activity is in front the
 * keyguard — if any — is asked to go, with a callback that says whether it
 * did.
 *
 * Never on a SECURE keyguard: that needs a person's credential, and asking
 * would only show a PIN screen on a wall. Never more than once per
 * [MIN_GAP_MS] — a keyguard that will not dismiss is reported, not polled.
 * API-26 symbols are isolated so the verifier never resolves them on the
 * Android 7.1 panels.
 */
object KeyguardDismiss {

    private const val TAG = "KeyguardDismiss"
    const val MIN_GAP_MS = 5_000L

    @Volatile private var lastRequestAtMs = 0L

    /** @return true when a dismissal was requested. */
    fun requestIfLocked(activity: Activity, why: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return runCatching {
            val km = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return false
            if (!km.isKeyguardLocked) return false
            if (km.isDeviceSecure) {
                PlayerLogger.w(TAG, "PLAYER_WAKE_KEYGUARD_SECURE ($why) — a secure keyguard is up; nothing can dismiss it remotely")
                return false
            }
            val now = SystemClock.elapsedRealtime()
            if (lastRequestAtMs != 0L && now >= lastRequestAtMs && now - lastRequestAtMs < MIN_GAP_MS) return false
            lastRequestAtMs = now
            Api26KeyguardDismiss.request(activity, km, why)
            true
        }.getOrElse {
            PlayerLogger.w(TAG, "keyguard dismissal request failed ($why): ${it.message}")
            false
        }
    }
}

@RequiresApi(Build.VERSION_CODES.O)
private object Api26KeyguardDismiss {
    fun request(activity: Activity, km: KeyguardManager, why: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) activity.setShowWhenLocked(true)
        PlayerLogger.i("KeyguardDismiss", "PLAYER_WAKE_KEYGUARD requested dismissal ($why)")
        km.requestDismissKeyguard(
            activity,
            object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    PlayerLogger.i("KeyguardDismiss", "keyguard dismissed ($why)")
                }

                override fun onDismissCancelled() {
                    PlayerLogger.w("KeyguardDismiss", "keyguard dismissal cancelled ($why)")
                }

                override fun onDismissError() {
                    PlayerLogger.w("KeyguardDismiss", "keyguard dismissal error ($why)")
                }
            },
        )
    }
}
