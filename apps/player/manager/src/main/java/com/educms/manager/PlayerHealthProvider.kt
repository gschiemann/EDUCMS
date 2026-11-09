package com.educms.manager

import android.content.ContentProvider
import android.content.ContentValues
import android.content.SharedPreferences
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.util.Log
import com.educms.manager.health.ManagerHealth
import com.educms.manager.health.ManagerHealthReport
import com.educms.manager.health.ManagerReports

/**
 * Cross-process IPC channel for Player ↔ Manager communication.
 *
 * Player writes a heartbeat row every 30s with:
 *   - timestamp (System.currentTimeMillis())
 *   - player_version_name (BuildConfig.VERSION_NAME)
 *   - player_pid (the process id of the running Player)
 *
 * WatchdogService reads the row every 30s and asks: is the timestamp
 * older than 90s? If yes for 3 consecutive checks, it concludes
 * Player is dead and force-restarts MainActivity.
 *
 * Why a ContentProvider and not a Service binder or Socket?
 * - Survives process death cleanly. Manager's process can die, the
 *   provider is reinstated next read; values are stored in a tiny
 *   in-memory backing map that's reseeded by Player's next write.
 * - Cross-UID safe. Two apps signed with the same key, mediated
 *   through android:permission, no manual auth handshake to
 *   maintain.
 * - Plays nice with Android 11+ scoped queries thanks to the
 *   <queries> tag in Player's manifest pointing at Manager's
 *   package.
 *
 * URIs:
 *   content://com.educms.manager.health/heartbeat
 *     INSERT — Player writes its current heartbeat (replaces any
 *              previous value)
 *     QUERY  — Manager reads the most recent heartbeat row
 *     UPDATE/DELETE — not used; insert acts as upsert
 *
 * Schema returned by query():
 *   columns: [timestamp_ms, version_name, pid]
 *   rows:    1 (or 0 if Player has never written one)
 */
class PlayerHealthProvider : ContentProvider() {

    @Volatile
    private var heartbeat: Heartbeat? = null

    /**
     * 2026-05-04 — Manager-v1.0.13 OTA-survival fix.
     *
     * Operator (Goodview kiosk): "i have never once been able to upgrade
     * from one version to another, forget about silent upgrade it just
     * doesnt ever fucking work". Triage agent traced this to the
     * @Volatile heartbeat being PROCESS-MEMORY-ONLY. When Manager dies
     * during its OWN self-update, the heartbeat row is wiped. New
     * Manager boots, reads heartbeat → null. WatchdogService sees
     * sawNewBoot=false and rolls Player back even though Player kept
     * heartbeating fine the whole time.
     *
     * Fix: persist heartbeats to SharedPreferences. onCreate seeds the
     * @Volatile from prefs (so a fresh Manager process can answer
     * queries about Player's last-known state immediately). Every
     * insert() writes through to prefs (so the next Manager process
     * boot survives even if it happens between heartbeats).
     */
    private val PREFS_NAME = "edu_player_health"
    private val PREFS_KEY_TS = "hb_ts"
    private val PREFS_KEY_VER = "hb_version"
    private val PREFS_KEY_PID = "hb_pid"
    private val PREFS_KEY_FP = "hb_fingerprint"
    // 2026-11-08 — PREFS_RELAY / PREFS_KEY_RELAY live in the companion so
    // ManagerReports can read them from outside the provider instance.

    private fun prefs(): SharedPreferences? =
        context?.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)

    override fun onCreate(): Boolean {
        Log.i(TAG, "PlayerHealthProvider created")
        // Seed the @Volatile from disk so a Manager-process restart
        // doesn't wipe the heartbeat from WatchdogService's POV. Without
        // this seed, the immediate post-boot tick would see ts==0 and
        // mistakenly classify Player as dead.
        try {
            val p = prefs()
            val ts = p?.getLong(PREFS_KEY_TS, 0L) ?: 0L
            if (ts > 0L) {
                heartbeat = Heartbeat(
                    timestampMs = ts,
                    versionName = p?.getString(PREFS_KEY_VER, "unknown") ?: "unknown",
                    pid = p?.getInt(PREFS_KEY_PID, 0) ?: 0,
                    fingerprint = p?.getString(PREFS_KEY_FP, null),
                    relay = p?.getInt(PREFS_KEY_RELAY, 0) ?: 0,
                )
                Log.i(TAG, "seeded heartbeat from prefs: ts=$ts version=${heartbeat?.versionName}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "prefs seed failed: ${e.message}")
        }
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        return when (matcher.match(uri)) {
            CODE_HEARTBEAT -> {
                // 2026-04-28 — schema extended with COL_FINGERPRINT
                // (Plan + Kotlin reviewer P1-F): ManagerSelfUpdateWorker
                // and OtaWorker need Player's deviceFingerprint to
                // address the same dashboard screen row. Settings.Secure.
                // ANDROID_ID is per-(signing-key + package + user) on
                // Android 8+, so Manager and Player derive DIFFERENT
                // values even though they share a signing key — they
                // were creating ghost rows on the dashboard.
                //
                // Strict-additive change: legacy v1.0.2 callers query
                // with projection=null (= "all columns") and got back
                // a cursor with [timestamp, version, pid]. The new
                // cursor adds COL_FINGERPRINT after pid. Old callers
                // accessing by column NAME (getColumnIndex) keep
                // working; old callers accessing by column INDEX
                // would break, but our only consumer (WatchdogService)
                // uses names — verified.
                val cursor = MatrixCursor(arrayOf(
                    COL_TIMESTAMP, COL_VERSION_NAME, COL_PID, COL_FINGERPRINT,
                ))
                heartbeat?.let { hb ->
                    cursor.addRow(arrayOf<Any>(
                        hb.timestampMs, hb.versionName, hb.pid, hb.fingerprint ?: "",
                    ))
                }
                cursor
            }
            // 2026-11-08 — the companion's own health facts (schema 1, see
            // health/ManagerHealthReport). One row, built on every read, so
            // the Player always carries what is true NOW.
            CODE_MANAGER_HEALTH -> {
                val ctx = context ?: return null
                MatrixCursor(arrayOf(COL_SCHEMA, COL_REPORT_JSON)).apply {
                    addRow(arrayOf<Any>(ManagerHealthReport.SCHEMA, ManagerHealth.snapshotJson(ctx)))
                }
            }
            // 2026-11-08 — reports queued for the Player's signed relay
            // (health/ManagerReportOutbox), oldest first.
            CODE_REPORTS -> {
                val ctx = context ?: return null
                MatrixCursor(arrayOf(COL_REPORT_ID, COL_REPORT_KIND, COL_REPORT_BODY, COL_REPORT_AT)).apply {
                    ManagerReports.pending(ctx).forEach { e -> addRow(arrayOf<Any>(e.id, e.kind, e.body, e.atMs)) }
                }
            }
            else -> null
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? {
        if (matcher.match(uri) != CODE_HEARTBEAT) return null
        val v = values ?: return null
        val ts = v.getAsLong(COL_TIMESTAMP) ?: System.currentTimeMillis()
        val name = v.getAsString(COL_VERSION_NAME) ?: "unknown"
        val pid = v.getAsInteger(COL_PID) ?: 0
        // Fingerprint is OPTIONAL on insert so v1.0.17- Player APKs
        // (which don't write the column) keep working — they'll just
        // not populate the heartbeat fingerprint, and Manager's worker
        // falls back to its own ANDROID_ID. v1.0.18+ Player will
        // write it, enabling the shared-row OTA path.
        val fp = v.getAsString(COL_FINGERPRINT)
        // 2026-11-08 — `relay` = 1 when this Player will relay our reports on
        // its signed channel. Absent (every Player before this build) = 0, so
        // the Manager keeps posting anonymously to an old Player's screen.
        val relay = if (v.getAsInteger(COL_RELAY) == 1) 1 else 0
        heartbeat = Heartbeat(timestampMs = ts, versionName = name, pid = pid, fingerprint = fp, relay = relay)
        Log.d(TAG, "heartbeat in: ts=$ts version=$name pid=$pid fp=${fp?.take(20)}")
        // 2026-05-04 — Persist through to SharedPreferences so the
        // next Manager process boot can re-read this heartbeat WITHOUT
        // waiting for Player's next 30s tick. This is the load-bearing
        // fix for the "every OTA gets quarantined" bug.
        try {
            prefs()?.edit()
                ?.putLong(PREFS_KEY_TS, ts)
                ?.putString(PREFS_KEY_VER, name)
                ?.putInt(PREFS_KEY_PID, pid)
                ?.putString(PREFS_KEY_FP, fp)
                ?.putInt(PREFS_KEY_RELAY, relay)
                ?.apply()
        } catch (e: Exception) {
            Log.w(TAG, "prefs write failed: ${e.message}")
        }
        return uri
    }

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    /**
     * 2026-11-08 — the Player acknowledges relayed reports:
     * DELETE content://…/reports with selectionArgs = [highest acknowledged id].
     * Every other URI deletes nothing, as before.
     */
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int {
        if (matcher.match(uri) != CODE_REPORTS) return 0
        val ctx = context ?: return 0
        val acked = selectionArgs?.firstOrNull()?.toLongOrNull() ?: return 0
        if (acked <= 0L) return 0
        return ManagerReports.ack(ctx, acked)
    }

    override fun getType(uri: Uri): String? = when (matcher.match(uri)) {
        CODE_HEARTBEAT -> "vnd.android.cursor.item/vnd.com.educms.manager.heartbeat"
        CODE_MANAGER_HEALTH -> "vnd.android.cursor.item/vnd.com.educms.manager.health"
        CODE_REPORTS -> "vnd.android.cursor.dir/vnd.com.educms.manager.report"
        else -> null
    }

    private data class Heartbeat(
        val timestampMs: Long,
        val versionName: String,
        val pid: Int,
        val fingerprint: String?,
        val relay: Int = 0,
    )

    companion object {
        private const val TAG = "PlayerHealthProvider"
        const val AUTHORITY = "com.educms.manager.health"
        const val PATH_HEARTBEAT = "heartbeat"

        const val COL_TIMESTAMP = "timestamp_ms"
        const val COL_VERSION_NAME = "version_name"
        const val COL_PID = "pid"
        // Added 2026-04-28 — Player's deviceFingerprint, written on
        // every heartbeat from v1.0.18+. Empty for older Player APKs
        // until they upgrade. Consumed by ManagerSelfUpdateWorker +
        // OtaWorker so all OTA API calls address the same screen row
        // the cloud heartbeat populates. See ManagerSelfUpdateWorker.
        const val COL_FINGERPRINT = "device_fingerprint"

        // 2026-11-08 — the Player tells us it relays our reports (1) or not (0/absent).
        const val COL_RELAY = "relay"

        // 2026-11-08 — Manager health and the signed-report relay. The Player
        // mirrors these strings (ManagerHeartbeatPublisher); change both in lockstep.
        const val PATH_MANAGER_HEALTH = "manager-health"
        const val PATH_REPORTS = "reports"
        const val COL_SCHEMA = "schema"
        const val COL_REPORT_JSON = "report_json"
        const val COL_REPORT_ID = "id"
        const val COL_REPORT_KIND = "kind"
        const val COL_REPORT_BODY = "body_json"
        const val COL_REPORT_AT = "created_ms"

        private const val PREFS_RELAY = "edu_player_health"
        private const val PREFS_KEY_TS_SHARED = "hb_ts"
        private const val PREFS_KEY_RELAY = "hb_relay"

        /**
         * (last Player heartbeat ms, relay flag) from the persisted row, read
         * in-process by ManagerReports. Never throws; unknown = (0, 0) = anonymous.
         */
        fun readRelayState(ctx: android.content.Context): Pair<Long, Int> = try {
            val p = ctx.applicationContext.getSharedPreferences(PREFS_RELAY, android.content.Context.MODE_PRIVATE)
            p.getLong(PREFS_KEY_TS_SHARED, 0L) to p.getInt(PREFS_KEY_RELAY, 0)
        } catch (_: Exception) {
            0L to 0
        }

        private const val CODE_HEARTBEAT = 1
        private const val CODE_MANAGER_HEALTH = 2
        private const val CODE_REPORTS = 3

        val URI_HEARTBEAT: Uri = Uri.parse("content://$AUTHORITY/$PATH_HEARTBEAT")

        private val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
            addURI(AUTHORITY, PATH_HEARTBEAT, CODE_HEARTBEAT)
            addURI(AUTHORITY, PATH_MANAGER_HEALTH, CODE_MANAGER_HEALTH)
            addURI(AUTHORITY, PATH_REPORTS, CODE_REPORTS)
        }
    }
}
