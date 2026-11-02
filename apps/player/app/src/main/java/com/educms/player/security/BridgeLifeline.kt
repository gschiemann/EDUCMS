package com.educms.player.security

import com.educms.player.media.BroadcastBanner
import org.json.JSONArray

/** Scheduling only, after the channel's origin/main-frame/method gates.
 * Never put displayApply, schedules, file/network I/O or media preparation
 * here: one face's slow work must not delay the other face's emergency.
 * SharedVideoHost handles a validated banner before every media path and
 * returns immediately. It must precede its typed hold on the same executor,
 * or the hold correctly falls back to a full takeover and stops playback. */
internal object BridgeLifeline {
    fun accepts(method: String, args: JSONArray): Boolean {
        if (method == "displayEmergencyHold") return true
        if (method != "sharedVideoPrepare") return false
        val raw = args.opt(0) as? String ?: return false
        return BroadcastBanner.parse(raw) != null
    }
}
