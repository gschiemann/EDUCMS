package com.educms.player.ota

import android.content.Context
import android.content.pm.PackageInstaller
import android.os.SystemClock
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.io.File

/**
 * Persists the one [PendingInstallConfirmation.Record] (1.1.46). A small file
 * written synchronously, so it survives the process being killed behind the
 * dialog and a reboot; an in-memory copy answers the hot reads
 * ([MainActivity.installPromptOutstanding] is read by every recovery actor).
 */
object PendingInstallStore {
    private const val TAG = "PendingInstallStore"
    private const val FILE = "ota_install_confirmation.json"

    @Volatile private var appCtx: Context? = null
    @Volatile private var cached: PendingInstallConfirmation.Record? = null
    @Volatile private var loaded = false

    /** Called from `PlayerApp.onCreate`. Clears a record the install satisfied. */
    fun init(ctx: Context) {
        appCtx = ctx.applicationContext
        val r = read(ctx)
        if (r != null && PendingInstallConfirmation.landed(r, BuildConfig.VERSION_CODE)) {
            clear(ctx, "v${r.versionName} is installed")
        }
    }

    private fun file(ctx: Context) = File(ctx.applicationContext.filesDir, FILE)

    fun read(ctx: Context): PendingInstallConfirmation.Record? {
        if (loaded) return cached
        cached = try {
            val f = file(ctx)
            if (!f.isFile) null else JSONObject(f.readText()).let { j ->
                PendingInstallConfirmation.Record(
                    sessionId = j.optInt("sessionId", 0),
                    versionCode = j.optInt("versionCode", 0),
                    versionName = j.optString("versionName", ""),
                    pushKey = j.optString("pushKey", "").ifBlank { null },
                    launchedAtWallMs = j.optLong("launchedAtWallMs", 0L),
                    launchedAtElapsedMs = j.optLong("launchedAtElapsedMs", 0L),
                ).takeIf { it.versionCode > 0 && it.launchedAtWallMs > 0L }
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "read failed: ${t.message}")
            null
        }
        loaded = true
        return cached
    }

    /** Rule 1 — the confirmation for our own session [sessionId] was launched. */
    fun noteLaunched(ctx: Context, sessionId: Int, versionCode: Int, versionName: String, pushKey: String?) {
        val r = PendingInstallConfirmation.Record(
            sessionId = sessionId,
            versionCode = versionCode,
            versionName = versionName,
            pushKey = pushKey,
            launchedAtWallMs = System.currentTimeMillis(),
            launchedAtElapsedMs = SystemClock.elapsedRealtime(),
        )
        try {
            val j = JSONObject()
                .put("sessionId", r.sessionId)
                .put("versionCode", r.versionCode)
                .put("versionName", r.versionName)
                .put("pushKey", r.pushKey ?: "")
                .put("launchedAtWallMs", r.launchedAtWallMs)
                .put("launchedAtElapsedMs", r.launchedAtElapsedMs)
            val f = file(ctx)
            val tmp = File(f.parentFile, "$FILE.tmp")
            tmp.writeText(j.toString())
            if (!tmp.renameTo(f)) f.writeText(j.toString())
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "write failed: ${t.message}")
        }
        cached = r
        loaded = true
        PlayerLogger.i(TAG, "install confirmation launched — session=$sessionId v$versionName push=${pushKey ?: "-"}; recovery held off")
    }

    private const val PREFS = "edu_player_ota_confirm"
    private const val K_COMMITTED = "committed_session"
    private const val K_COMMITTED_PUSH = "committed_push"

    /** The worker committed our own session [sessionId] (the only one whose status counts). */
    fun noteCommitted(ctx: Context, sessionId: Int, pushKey: String?) {
        runCatching {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt(K_COMMITTED, sessionId)
                .putString(K_COMMITTED_PUSH, pushKey ?: lastCommittedPushKey(ctx))
                .commit()
        }
    }

    /**
     * The confirmation of our own update [versionCode] was (re-)raised from the
     * foreground (resume / the update card's OK): persist it as launched now,
     * against the session we committed last.
     */
    fun noteRaisedFromForeground(ctx: Context, versionCode: Int) {
        val session = runCatching {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(K_COMMITTED, 0)
        }.getOrDefault(0)
        val name = OtaAttemptStore.read(ctx)?.takeIf { it.versionCode == versionCode }?.versionName ?: "$versionCode"
        noteLaunched(ctx, session, versionCode, name, lastCommittedPushKey(ctx))
    }

    /** The push identity our last commit answered (a push is answered once). */
    fun lastCommittedPushKey(ctx: Context): String? = runCatching {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_COMMITTED_PUSH, null)
    }.getOrNull()

    /**
     * Is a status for our own session [sessionId] about the session we
     * committed last? A session we abandoned to re-open the dialog (rule 3)
     * reports ABORTED afterwards, and that must not land as FAILED on the
     * fresh attempt. Unknown ids (a ROM that omits them) count as current.
     */
    fun isCurrentSession(ctx: Context, sessionId: Int): Boolean {
        if (sessionId <= 0) return true
        val committed = runCatching {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(K_COMMITTED, 0)
        }.getOrDefault(0)
        return committed <= 0 || committed == sessionId
    }

    fun clear(ctx: Context, reason: String) {
        val had = read(ctx) != null
        runCatching { file(ctx).delete() }
        cached = null
        loaded = true
        if (had) PlayerLogger.i(TAG, "install confirmation record cleared ($reason)")
    }

    /** Clear only if [sessionId] is the one on record (a stale abandoned session changes nothing). */
    fun clearIfSession(ctx: Context, sessionId: Int, reason: String) {
        if (PendingInstallConfirmation.settledBy(read(ctx), sessionId)) clear(ctx, reason)
    }

    /**
     * Rule 2, for the readers that have no Context
     * (`MainActivity.installPromptOutstanding`). False before [init].
     */
    fun holdsRecoveryNow(): Boolean {
        val ctx = appCtx ?: return false
        val emergency = runCatching { com.educms.player.display.DisplayEmergency.isHeld(ctx) }.getOrDefault(true)
        return PendingInstallConfirmation.holdsRecovery(
            read(ctx), emergency, System.currentTimeMillis(), SystemClock.elapsedRealtime(),
        )
    }

    /** An emergency hold is up (fail-safe: unreadable = held). */
    fun emergencyHeldNow(): Boolean {
        val ctx = appCtx ?: return false
        return runCatching { com.educms.player.display.DisplayEmergency.isHeld(ctx) }.getOrDefault(true)
    }

    /**
     * Rules 3–4 — abandon every session of OURS that is still open (the
     * buried confirmation dies with it). Best-effort; a session that already
     * finished throws and is skipped.
     */
    fun abandonOwnSessions(ctx: Context, reason: String): Int {
        var n = 0
        runCatching {
            val installer: PackageInstaller = ctx.packageManager.packageInstaller
            for (s in installer.mySessions) {
                if (s.appPackageName != null && s.appPackageName != ctx.packageName) continue
                runCatching { installer.abandonSession(s.sessionId); n += 1 }
            }
        }.onFailure { PlayerLogger.w(TAG, "abandon failed: ${it.message}") }
        PlayerLogger.i(TAG, "abandoned $n own install session(s) — $reason")
        return n
    }
}
