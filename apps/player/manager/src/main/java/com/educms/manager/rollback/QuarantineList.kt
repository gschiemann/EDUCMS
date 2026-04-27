package com.educms.manager.rollback

import android.content.Context
import android.util.Log

/**
 * Prefs-backed list of Player versionCodes that crashed on first
 * boot. OtaWorker consults this before downloading — if the API
 * returns latest=v1.0.14 and v1.0.14 is quarantined, skip and wait
 * for v1.0.15.
 *
 * Stored as a plain CSV string under "quarantined_vcs" in our
 * SharedPreferences. Set membership is small (typically 0-2
 * versions), so a CSV is fine and easier to debug than a JSON blob.
 *
 * Quarantine entries don't expire automatically. If a server-side
 * rebuild fixes a known-bad version, the operator can clear via
 * the dashboard (Phase 2.5: add a "Clear quarantine" button), or
 * via ADB:
 *   adb shell am broadcast -a com.educms.manager.CLEAR_QUARANTINE \
 *       -n com.educms.manager/.AdminReceiver
 * (Phase 2.5: implement that broadcast; for v1.0.0 the only escape
 * is uninstall + reinstall Manager, which clears prefs.)
 */
object QuarantineList {
    private const val TAG = "QuarantineList"
    private const val PREFS = "edu_manager_state"
    private const val KEY = "quarantined_vcs"
    private const val KEY_REASONS = "quarantine_reasons"

    fun isQuarantined(ctx: Context, vc: Int): Boolean = all(ctx).contains(vc)

    fun all(ctx: Context): List<Int> {
        val csv = prefs(ctx).getString(KEY, "") ?: ""
        return csv.split(",").mapNotNull { it.toIntOrNull() }
    }

    fun add(ctx: Context, vc: Int, reason: String) {
        val current = all(ctx).toMutableSet()
        if (!current.add(vc)) {
            Log.i(TAG, "vc=$vc already quarantined; reason update only")
        }
        val newCsv = current.joinToString(",")

        val reasons = prefs(ctx).getString(KEY_REASONS, "") ?: ""
        val reasonLine = "$vc:${reason.take(200).replace(',', ';').replace('\n', ' ')}"
        val newReasons = (reasons.split('\n').filter { it.isNotBlank() && !it.startsWith("$vc:") } + reasonLine)
            .joinToString("\n")

        prefs(ctx).edit()
            .putString(KEY, newCsv)
            .putString(KEY_REASONS, newReasons)
            .apply()
        Log.w(TAG, "QUARANTINED vc=$vc reason=\"${reason.take(120)}\"")
    }

    fun reasonsFor(ctx: Context, vc: Int): String? {
        val reasons = prefs(ctx).getString(KEY_REASONS, "") ?: return null
        return reasons.split('\n')
            .firstOrNull { it.startsWith("$vc:") }
            ?.substringAfter(':')
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().remove(KEY).remove(KEY_REASONS).apply()
        Log.i(TAG, "quarantine cleared")
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
