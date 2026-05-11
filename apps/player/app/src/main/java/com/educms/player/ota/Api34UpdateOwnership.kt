package com.educms.player.ota

import android.annotation.SuppressLint
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * API-34 (Android 14 / UpsideDownCake) update-ownership lock for
 * Player's own self-install sessions.
 *
 * setRequestUpdateOwnership(true) — the system grants ownership to
 * the caller IF no other app currently owns updates for the target
 * package. Once locked, only Player can update Player on Android 14+
 * — vendor app stores, OEM "system updates", and other installers
 * can't silently regress Player to an older build.
 *
 * Same ART verifier safety pattern as Api31SilentInstall: API-34
 * symbol isolated in a @RequiresApi(34) object so older Android ART
 * never resolves the symbol at class-load time.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
object Api34UpdateOwnership {

    @SuppressLint("NewApi")
    fun configure(params: PackageInstaller.SessionParams) {
        params.setRequestUpdateOwnership(true)
    }
}
