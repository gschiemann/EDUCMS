package com.educms.manager

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.util.Log

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

    override fun onCreate(): Boolean {
        Log.i(TAG, "PlayerHealthProvider created")
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
                val cursor = MatrixCursor(arrayOf(COL_TIMESTAMP, COL_VERSION_NAME, COL_PID))
                heartbeat?.let { hb ->
                    cursor.addRow(arrayOf<Any>(hb.timestampMs, hb.versionName, hb.pid))
                }
                cursor
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
        heartbeat = Heartbeat(timestampMs = ts, versionName = name, pid = pid)
        // Optimistic — operator sees in logs that Player is alive.
        // Throttle would help but heartbeats are 30s apart so
        // log volume is fine.
        Log.d(TAG, "heartbeat in: ts=$ts version=$name pid=$pid")
        return uri
    }

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun getType(uri: Uri): String? = when (matcher.match(uri)) {
        CODE_HEARTBEAT -> "vnd.android.cursor.item/vnd.com.educms.manager.heartbeat"
        else -> null
    }

    private data class Heartbeat(
        val timestampMs: Long,
        val versionName: String,
        val pid: Int,
    )

    companion object {
        private const val TAG = "PlayerHealthProvider"
        const val AUTHORITY = "com.educms.manager.health"
        const val PATH_HEARTBEAT = "heartbeat"

        const val COL_TIMESTAMP = "timestamp_ms"
        const val COL_VERSION_NAME = "version_name"
        const val COL_PID = "pid"

        private const val CODE_HEARTBEAT = 1

        val URI_HEARTBEAT: Uri = Uri.parse("content://$AUTHORITY/$PATH_HEARTBEAT")

        private val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
            addURI(AUTHORITY, PATH_HEARTBEAT, CODE_HEARTBEAT)
        }
    }
}
