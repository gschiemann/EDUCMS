package com.educms.player.face

/**
 * How many sides the SERVER says this display has (2026-09-19).
 *
 * THE MISSING HALF OF 1.1.18. The face host could put a second WebView on a
 * second panel, but nothing ever told it to — `face_count` could only be set
 * over adb, so the feature could not be switched on by anyone who is not
 * holding a cable. This is the activation path:
 *
 *   an operator clicks "Add the back side"
 *     → the API's `GET /screens/status/:fp` reply carries `faceCount`
 *     → the native heartbeat (which already reads that reply — it is how a
 *       forced OTA reaches a screen whose push channel is dead) parses it here
 *     → `face_count` is written, FaceHostController sees the change and syncs.
 *
 * No bridge method, no page, no frame: the count is decided by the server and
 * read by native over its own authenticated poll, so nothing running in a
 * WebView can make a box host anything.
 *
 * Deliberately NOT `org.json`: this must run in a plain JVM unit test, and the
 * field is one flat integer.
 */
internal object FaceActivation {

    /** The app's main SharedPreferences file — shared with HeartbeatService. */
    const val PREFS_NAME = "edu_player"

    /**
     * How many faces this box should host, primary included. WRITTEN only by
     * the native heartbeat from the server's reply; READ by FaceHostController.
     * Absent = 1, which is every screen in the fleet.
     */
    const val PREF_FACE_COUNT = "face_count"

    private val FIELD = Regex("\"faceCount\"\\s*:\\s*([0-9]{1,2})(?![0-9.eE])")

    /**
     * The side count in a heartbeat reply, clamped to what this build can host.
     *
     * `null` means THE REPLY DID NOT SAY — an older API, or a server whose count
     * failed and chose to say nothing. The caller must then leave the current
     * state alone: silence must never un-host a side that is playing.
     */
    fun faceCountFrom(body: String?): Int? {
        val text = body ?: return null
        val n = FIELD.find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return null
        if (n < 1) return null
        return n.coerceAtMost(FaceDisplayMap.MAX_FACES)
    }
}
