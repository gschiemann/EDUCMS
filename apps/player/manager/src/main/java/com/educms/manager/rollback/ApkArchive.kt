package com.educms.manager.rollback

import android.content.Context
import android.util.Log
import java.io.File

/**
 * On-disk archive of installed Player APKs. Keeps the last two
 * versions so we can roll back if a new install fails first-boot.
 *
 * Archive layout under `<external-files>/apk-archive/`:
 *   edu-player-<versionCode>.apk         (each archived release)
 *   meta.txt                             (last_known_good_vc on
 *                                         first line; pending_vc
 *                                         on second; install_at_ms
 *                                         on third)
 *
 * The "previous APK" we'd ever need to restore is the one currently
 * running before an OTA — captured by [archivePackage] just before
 * install. After a successful first-boot heartbeat, the pending
 * version becomes "last known good" and old archives prune.
 */
object ApkArchive {
    private const val TAG = "ApkArchive"
    private const val DIR_NAME = "apk-archive"
    private const val PRUNE_KEEP = 2

    fun archiveDir(ctx: Context): File =
        File(ctx.getExternalFilesDir(null), DIR_NAME).apply { mkdirs() }

    /**
     * Copy the currently-installed APK for [packageName] (whichever
     * version is on disk right now) into our archive, named by its
     * versionCode. Returns the archived File on success, null on
     * failure (most commonly: package not installed).
     *
     * Safe to call repeatedly with the same package — the file
     * already exists, we just verify size and skip the copy. Idempotent.
     */
    fun archivePackage(ctx: Context, packageName: String): File? {
        return try {
            val pm = ctx.packageManager
            val info = pm.getPackageInfo(packageName, 0)
            @Suppress("DEPRECATION")
            val vc = info.versionCode
            val sourceDir = info.applicationInfo?.sourceDir
            if (sourceDir.isNullOrBlank()) {
                Log.w(TAG, "no sourceDir for $packageName")
                return null
            }
            val src = File(sourceDir)
            if (!src.exists() || !src.canRead()) {
                Log.w(TAG, "source APK unreadable: $sourceDir")
                return null
            }
            val dst = File(archiveDir(ctx), "edu-player-$vc.apk")
            if (dst.exists() && dst.length() == src.length()) {
                Log.i(TAG, "already archived: $dst (size matches)")
                return dst
            }
            src.copyTo(dst, overwrite = true)
            Log.i(TAG, "archived $packageName vc=$vc → $dst (${dst.length()}b)")
            dst
        } catch (e: Exception) {
            Log.w(TAG, "archive failed for $packageName: ${e.message}", e)
            null
        }
    }

    /** Returns the archived APK file for [vc], or null if not present. */
    fun get(ctx: Context, vc: Int): File? {
        val f = File(archiveDir(ctx), "edu-player-$vc.apk")
        return if (f.exists() && f.length() > 0) f else null
    }

    /**
     * Versions currently archived (sorted ascending). Useful for
     * debug logging + the "what would we roll back to?" decision.
     */
    fun listVersions(ctx: Context): List<Int> {
        return archiveDir(ctx).listFiles()
            ?.mapNotNull { f ->
                Regex("edu-player-(\\d+)\\.apk").find(f.name)?.groupValues?.get(1)?.toIntOrNull()
            }
            ?.sorted()
            ?: emptyList()
    }

    /**
     * Keep only the most recent PRUNE_KEEP archived APKs. Called
     * after a successful first-boot promotes the pending version to
     * last-known-good — older archives are no longer the rollback
     * target.
     */
    fun pruneOld(ctx: Context) {
        val versions = listVersions(ctx)
        if (versions.size <= PRUNE_KEEP) return
        val toDelete = versions.dropLast(PRUNE_KEEP)
        for (vc in toDelete) {
            get(ctx, vc)?.delete()?.also {
                if (it) Log.i(TAG, "pruned archived APK vc=$vc")
            }
        }
    }
}
