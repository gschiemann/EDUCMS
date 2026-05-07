package com.educms.manager

import android.annotation.SuppressLint
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * API-34 (Android 14 / UpsideDownCake) class that locks update
 * ownership of the installed package to the calling installer
 * (Manager) by setting
 * PackageInstaller.SessionParams.setRequestUpdateOwnership(true).
 *
 * Why this matters: without ownership lock, ANY app holding
 * INSTALL_PACKAGES (e.g. Play Store, Samsung Galaxy Store, vendor
 * pre-installed app stores) can silently update Player out from
 * under us. With ownership lock, only Manager (and the user via
 * the system Install dialog) can update Player. This prevents:
 *   - A vendor app store pulling a stale Play-Store-published
 *     APK over our latest OTA build
 *   - An OEM "system update" path replacing Player with whatever
 *     the OEM thinks should be on the device
 *
 * Same ART-verifier-safe isolation pattern as Api31SilentInstall:
 * setRequestUpdateOwnership is API 34+, so this class MUST live
 * in its own file with @RequiresApi(34). Loading it on a pre-34
 * device would crash the process with VerifyError.
 *
 * Call site pattern (in OtaInstaller.installApk):
 *
 *   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
 *       Api34UpdateOwnership.configure(params)
 *   }
 *
 * v1.0.52 — added per docs/research/ANDROID_KIOSK_BEST_PRACTICES.md
 * recommendation #2.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
object Api34UpdateOwnership {

    @SuppressLint("NewApi")
    fun configure(params: PackageInstaller.SessionParams) {
        // setRequestUpdateOwnership(true) — the system grants ownership
        // to the caller IF no other app currently owns updates for the
        // target package. This is true for a fresh first-install of
        // Player, OR for an existing Player that has no current update
        // owner (the default state on pre-34 systems / sideloaded APKs).
        // If a different app DOES currently own updates, the system
        // ignores this flag silently — the install still proceeds, but
        // ownership doesn't transfer. That's fine; we'll have ownership
        // for any kiosk we install fresh from v1.0.52 forward.
        params.setRequestUpdateOwnership(true)
    }
}
