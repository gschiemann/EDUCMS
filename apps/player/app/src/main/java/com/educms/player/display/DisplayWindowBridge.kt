package com.educms.player.display

import com.educms.player.logging.PlayerLogger
import java.lang.ref.WeakReference

/**
 * The seam between the (Context-only) provider stack and the one thing
 * only the Activity can do: touch its own Window.
 *
 * [SoftwareDimProvider] needs `window.attributes.screenBrightness` and a
 * black overlay view; [DeviceAdminBlankProvider] needs FLAG_KEEP_SCREEN_ON
 * dropped before `lockNow()` (a window holding KEEP_SCREEN_ON re-wakes
 * on most ROMs, so blanking without clearing it is a no-op that LOOKS
 * like a vendor incompatibility); WAKE needs the FLAG_TURN_SCREEN_ON /
 * FLAG_DISMISS_KEYGUARD path MainActivity already sets once in onCreate.
 *
 * MainActivity registers a [Hooks] instance it holds as a field, and the
 * reference here is WEAK — if the Activity is destroyed without a clean
 * `clear()` (OEM ROM kill, OOM), the hooks are collected instead of
 * leaking the whole Activity + WebView.
 *
 * ⚠️ EVERY hook implementation MUST marshal to the UI thread itself.
 * Both bridge transports deliver off the UI thread: the legacy
 * `@JavascriptInterface` surface runs on WebView's "JavaBridge" thread,
 * and NativeBridgeChannel deliberately hops to a background executor to
 * preserve those semantics. AlarmManager receivers run on the main
 * thread, but the provider stack must not depend on which caller it got.
 */
object DisplayWindowBridge {

    private const val TAG = "DisplayWindow"

    /**
     * @param setWindowBrightness 0f..1f, or a negative value to hand
     *        brightness back to the system (BRIGHTNESS_OVERRIDE_NONE).
     * @param setBlackout show/hide the opaque black overlay.
     * @param setKeepScreenOn clear this BEFORE blanking, restore on wake.
     * @param requestWake re-assert TURN_SCREEN_ON / DISMISS_KEYGUARD.
     */
    class Hooks(
        val setWindowBrightness: (Float) -> Unit,
        val setBlackout: (Boolean) -> Unit,
        val setKeepScreenOn: (Boolean) -> Unit,
        val requestWake: () -> Unit,
    )

    @Volatile
    private var ref: WeakReference<Hooks>? = null

    fun register(hooks: Hooks) {
        ref = WeakReference(hooks)
        PlayerLogger.i(TAG, "window hooks registered")
    }

    fun clear() {
        ref = null
    }

    fun hooks(): Hooks? = ref?.get()

    /**
     * Run [body] against the hooks if a window is attached. Returns
     * false when there is no Activity right now — which is NOT an error:
     * a scheduled blank can fire while the Activity is dead, and the
     * desired state is persisted so [DisplayControlApi.onWindowAttached]
     * re-applies it the moment a window comes back.
     */
    inline fun withHooks(body: (Hooks) -> Unit): Boolean {
        val h = hooks() ?: return false
        return try {
            body(h)
            true
        } catch (t: Throwable) {
            PlayerLogger.w("DisplayWindow", "window hook threw: ${t.message}")
            false
        }
    }
}
