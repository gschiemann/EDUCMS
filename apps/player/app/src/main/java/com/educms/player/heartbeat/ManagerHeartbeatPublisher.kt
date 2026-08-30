package com.educms.player.heartbeat

import android.content.ContentValues
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import com.educms.player.BuildConfig

/**
 * Player-side companion to the Manager APK's PlayerHealthProvider.
 *
 * Writes a heartbeat row into Manager's content provider every 30s.
 * If Manager is installed and watching, those writes confirm Player
 * is alive. If 3 consecutive writes are missed (or never happen
 * because Player is dead), Manager force-restarts MainActivity.
 *
 * Behavior when Manager is NOT installed:
 *   - The first ContentResolver.insert call throws SecurityException
 *     (no provider), or returns null (provider not found).
 *   - We log once and keep ticking — every 30s call is cheap, and
 *     the day Manager IS installed, our publisher just starts
 *     working without needing a Player update.
 *   - This is also the v1.0.12 → Manager-installed transition path:
 *     existing kiosks publish to a non-existent provider for a
 *     while, no harm done.
 *
 * Cadence is 30s — same as Player's existing API heartbeat — so the
 * two channels (cloud heartbeat and manager heartbeat) stay roughly
 * in lockstep. If the cloud is down, Manager keeps Player alive
 * locally; if Manager is missing, the cloud still tracks ONLINE.
 *
 * ── C-P2-15 (2026-08-30 deep audit) — NOT ON THE MAIN LOOPER ──────────
 *
 * `publishOnce` is a `ContentResolver.insert` into ANOTHER APP'S
 * provider: a synchronous cross-process binder transaction. It ran on
 * the UI thread every 30 s, so every stall on Manager's side — a slow
 * provider, a busy binder pool, Manager itself being killed or upgraded
 * mid-transaction — blocked the thread that draws the signage. On a
 * Taurus that is a visible hitch on the wall, every half minute, for a
 * write nothing on screen depends on. It now owns a [HandlerThread].
 * Cadence and every semantic are unchanged.
 */
class ManagerHeartbeatPublisher(private val ctx: Context) {

    /** C-P2-15 — our own looper thread; created in [start], torn down in [stop]. */
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    @Volatile
    private var stopped = false
    @Volatile
    private var loggedMissingProvider = false

    private val tick = object : Runnable {
        override fun run() {
            if (stopped) return
            try {
                publishOnce()
            } catch (e: Exception) {
                Log.w(TAG, "publishOnce threw: ${e.message}")
            }
            handler?.postDelayed(this, INTERVAL_MS)
        }
    }

    fun start() {
        if (thread != null) return   // idempotent; never stack two loopers
        Log.i(TAG, "starting Manager heartbeat publisher (interval=${INTERVAL_MS}ms)")
        stopped = false
        val t = HandlerThread(THREAD_NAME).also { it.start() }
        thread = t
        val h = Handler(t.looper)
        handler = h
        // Initial fire is immediate so a freshly-launched Player
        // appears alive to Manager within 1s rather than 30.
        h.post(tick)
    }

    fun stop() {
        stopped = true
        handler?.removeCallbacks(tick)
        // quitSafely so an insert already in flight is allowed to finish
        // rather than being abandoned mid-binder-transaction.
        runCatching { thread?.quitSafely() }
        handler = null
        thread = null
    }

    /**
     * Player's deviceFingerprint for OTA API calls — same `android-{ANDROID_ID}`
     * derivation MainActivity.loadPlayer() uses. Published into the
     * heartbeat ContentProvider so Manager's OTA workers can address
     * the SAME server-side screen row Player heartbeats with.
     *
     * Settings.Secure.ANDROID_ID is per-(signing-key + package + user)
     * on Android 8+ → Manager and Player derive different values from
     * their own contexts. Sharing through the IPC channel is the only
     * reliable way to keep the fleet on a single screen row.
     */
    @Suppress("DEPRECATION")
    private fun deriveFingerprint(): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                ctx.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }
        return if (androidId.isNotBlank()) "android-$androidId" else ""
    }

    private fun publishOnce() {
        val values = ContentValues().apply {
            put(COL_TIMESTAMP, System.currentTimeMillis())
            put(COL_VERSION_NAME, BuildConfig.VERSION_NAME)
            put(COL_PID, Process.myPid())
            // 2026-04-28 (Player v1.0.18+) — also publish our
            // deviceFingerprint so Manager's OTA workers can use the
            // SAME server-side screen row identity. Without this,
            // Manager's ANDROID_ID (different package id → different
            // scoped value on Android 8+) creates a ghost screen row
            // and /manager-update-check + /update-check return
            // 'no-screen-row' → uptoDate forever.
            //
            // Older Manager APKs (v1.0.2 and earlier) ignore unknown
            // ContentValues columns — strict-additive on the wire.
            put(COL_FINGERPRINT, deriveFingerprint())
        }
        try {
            val result = ctx.contentResolver.insert(URI_HEARTBEAT, values)
            if (result == null && !loggedMissingProvider) {
                // Manager not installed yet — totally fine, we just
                // become a no-op until it's deployed. Log once so a
                // quick logcat scan confirms the publisher is running
                // and not silently broken.
                Log.i(TAG, "Manager APK not installed (no provider) — heartbeat publisher is no-op for now")
                loggedMissingProvider = true
            }
        } catch (e: SecurityException) {
            if (!loggedMissingProvider) {
                Log.w(
                    TAG,
                    "no permission to write Manager health provider — " +
                        "Player and Manager probably signed with different keys " +
                        "(should not happen with the committed debug.keystore)",
                )
                loggedMissingProvider = true
            }
        } catch (e: IllegalArgumentException) {
            // Authority not registered — same situation as null
            // above on most Android versions.
            if (!loggedMissingProvider) {
                Log.i(TAG, "Manager provider authority not registered yet — publisher is no-op for now")
                loggedMissingProvider = true
            }
        }
    }

    companion object {
        private const val TAG = "ManagerHeartbeatPublisher"

        /** C-P2-15 — name the thread so it is identifiable in an ANR trace. */
        private const val THREAD_NAME = "edu-manager-heartbeat"

        // Mirror of Manager's PlayerHealthProvider constants. We
        // keep these as compile-time strings instead of importing
        // from the Manager module (which would create a build
        // dependency the wrong way around — Player should NOT
        // depend on Manager). Versioned protocol bump means: change
        // these constants in BOTH apps in lockstep, never one alone.
        private const val AUTHORITY = "com.educms.manager.health"
        private const val PATH_HEARTBEAT = "heartbeat"
        const val COL_TIMESTAMP = "timestamp_ms"
        const val COL_VERSION_NAME = "version_name"
        const val COL_PID = "pid"
        // Added 2026-04-28 — Player publishes its OTA fingerprint to
        // the cross-process heartbeat provider. Manager's OTA workers
        // read this so /update-check + /manager-update-check resolve
        // to the same Screen row Player heartbeats with. Without it,
        // Settings.Secure.ANDROID_ID's per-app scoping creates two
        // ghost screen rows on the dashboard.
        const val COL_FINGERPRINT = "device_fingerprint"

        private val URI_HEARTBEAT = android.net.Uri.parse(
            "content://$AUTHORITY/$PATH_HEARTBEAT",
        )

        // 30s — matches Player's existing cloud heartbeat cadence
        private const val INTERVAL_MS = 30_000L
    }
}
