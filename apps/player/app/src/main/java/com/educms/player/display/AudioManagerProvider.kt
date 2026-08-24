package com.educms.player.display

import android.content.Context
import android.media.AudioManager
import com.educms.player.logging.PlayerLogger

/**
 * Volume. The one capability that works on every Android box with zero
 * permissions, zero vendor cooperation and zero risk — which is why the
 * probe's verdict reports `volume: "audiomanager"` on essentially
 * everything and why there is no fallback chain here.
 *
 * We drive STREAM_MUSIC only: that is the stream the WebView's media
 * playback uses, so it is the one an operator means by "turn the sound
 * down on the cafeteria screen".
 *
 * Note the deliberate asymmetry with the hardware remote: MainActivity's
 * onKeyDown passes KEYCODE_VOLUME_* to super so the OS still handles the
 * physical buttons. Those two paths are independent — a remote-control
 * volume change is not reflected in whatever the dashboard last set, and
 * the dashboard's mirror is refreshed from the device on the next
 * capabilities read rather than being treated as authoritative.
 */
object AudioManagerProvider : DisplayControlProvider {

    private const val TAG = "AudioVolume"

    override val id: String = "audiomanager"

    private fun am(ctx: Context): AudioManager? =
        ctx.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    override fun supports(ctx: Context): Set<Capability> =
        if (am(ctx) != null) setOf(Capability.VOLUME) else emptySet()

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        if (action !is DisplayAction.SetVolume) {
            return ActionResult.Unsupported("audiomanager only handles volume")
        }
        val manager = am(ctx) ?: return ActionResult.Unsupported("no AudioManager on this device")
        return try {
            val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            if (max <= 0) return ActionResult.Failed("STREAM_MUSIC reports max volume 0", id)
            val target = DisplayLimits.scale(action.percent, 0, max)
            // FLAG_SHOW_UI (2026-08-25) — operator: volume changed "in the
            // background... would be nice to see it as you adjusted it on
            // the screen". Flags=0 applied silently; this pops the OS
            // volume panel for ~2s on the glass. Both construction sites
            // (dashboard command, dead-man revert) are moments the level
            // genuinely changes, so on-screen feedback is honest for both
            // — there is no boot-time volume restore that would toast on
            // every restart.
            manager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI)
            PlayerLogger.i(TAG, "volume ${action.percent}% → $target/$max via $id")
            ActionResult.Ok(id, "$target/$max")
        } catch (t: Throwable) {
            // SecurityException here means the device is in a
            // Do-Not-Disturb policy state that blocks volume changes.
            PlayerLogger.w(TAG, "setStreamVolume failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    /** Live device volume as a percent, for the capabilities report. */
    fun currentPercent(ctx: Context): Int? = try {
        val manager = am(ctx)
        val max = manager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 0
        if (manager == null || max <= 0) null
        else Math.round(manager.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max)
    } catch (t: Throwable) {
        null
    }
}
