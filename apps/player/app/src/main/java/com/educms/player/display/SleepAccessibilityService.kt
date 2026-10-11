package com.educms.player.display

import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import com.educms.player.logging.PlayerLogger
import java.lang.ref.WeakReference

/**
 * "VenueOS sleep" — a REAL panel sleep for a box that will not let us be a
 * device admin (2026-10-11).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY
 * ═════════════════════════════════════════════════════════════════════
 * VisionCore's and RIOT's X80s (Android 11, Android-TV settings app) cannot
 * open the device-admin activation screen (`DeviceAdminAdd` launch FAILED in
 * their setup report), and their screen-off timeout starts a screensaver
 * instead of sleeping (see [SleepProof]). The remote's power key does sleep
 * them, and that is the state a person expects "back to off" to mean.
 *
 * `AccessibilityService.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)`
 * (API 28) asks the system to do exactly what the power key does —
 * `PowerManager.goToSleep` plus the (swipe) keyguard — with no device admin.
 * It needs one thing nobody can grant remotely: a person turning the service
 * on in Settings → Accessibility (or one ADB command). Until then this
 * service is never bound, [isConnected] is false, [AccessibilityLockProvider]
 * declines, and nothing about the player changes.
 *
 * WHAT IT DOES NOT DO. It reads no screen content
 * (`canRetrieveWindowContent=false`), subscribes to one inert event type,
 * and has no other behaviour: its only method is [lockScreen]. Waking is not
 * its job — a wake lock does that ([ScreenWakeLock]), exactly as after a
 * device-admin `lockNow()`.
 */
class SleepAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = WeakReference(this)
        PlayerLogger.i(TAG, "VenueOS sleep service connected — the panel can be put to sleep without device admin")
        // A new BLANK mechanism just became available.
        runCatching { DisplayControlRegistry.invalidate() }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        clear()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        clear()
        super.onDestroy()
    }

    private fun clear() {
        if (instance?.get() === this) instance = null
        runCatching { DisplayControlRegistry.invalidate() }
        PlayerLogger.i(TAG, "VenueOS sleep service disconnected")
    }

    companion object {
        private const val TAG = "SleepA11y"

        /**
         * `AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN` (API 28). Spelled
         * as its value so no API-28 symbol is resolved on an older box.
         */
        internal const val GLOBAL_ACTION_LOCK_SCREEN = 8

        @Volatile private var instance: WeakReference<SleepAccessibilityService>? = null

        /** Is the service turned on and bound right now? */
        fun isConnected(): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && instance?.get() != null

        /** Sleep the panel the way the power key does. False when unavailable or refused. */
        fun lockScreen(): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
            val svc = instance?.get() ?: return false
            return runCatching { svc.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN) }
                .onFailure { PlayerLogger.w(TAG, "lock-screen action threw: ${it.message}") }
                .getOrDefault(false)
        }
    }
}
