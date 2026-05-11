package com.educms.player.ota

import android.annotation.SuppressLint
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * API-31 (Android 12 / S) silent-install hint for Player's own
 * PackageInstaller sessions. Sister of Manager's Api31SilentInstall
 * but lives in the Player package so Player's OtaUpdateWorker can
 * use it without depending on Manager being installed.
 *
 * Tells the system: "this install does not require user action."
 * The system honors the hint when:
 *   - the calling app holds UPDATE_PACKAGES_WITHOUT_USER_ACTION
 *     (declared in Player's manifest as of v1.0.53), AND
 *   - the calling app is installer-of-record for the target package.
 *
 * For Player-self-update, "installer-of-record for the target" is
 * a chicken-and-egg: the FIRST Player install (sideload or initial
 * provisioning) records the sideloader/ADB/Manager as installer.
 * After Player installs ITSELF once via this code path, Player
 * becomes its own installer-of-record, and every subsequent install
 * passes the gate → silent.
 *
 * ART verifier safety: setRequireUserAction + USER_ACTION_NOT_REQUIRED
 * are API 31 symbols. Loading them on Android 11 would crash with
 * VerifyError (this is what bit v1.0.20). Isolating them in this
 * @RequiresApi(31) object means ART never tries to resolve them on
 * pre-31 devices.
 *
 * Call site (in OtaUpdateWorker.triggerInstall):
 *
 *   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
 *       Api31SilentInstall.configure(params)
 *   }
 */
@RequiresApi(Build.VERSION_CODES.S)
object Api31SilentInstall {

    @SuppressLint("NewApi")
    fun configure(params: PackageInstaller.SessionParams) {
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
}
