package com.educms.manager

import android.annotation.SuppressLint
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * API-31 (Android 12 / S) class that enables silent installs for
 * DEVICE_OWNER kiosks by calling
 * PackageInstaller.SessionParams.setRequireUserAction(USER_ACTION_NOT_REQUIRED).
 *
 * CRITICAL: This class MUST remain in its own file and be annotated
 * @RequiresApi(31). Android's ART class verifier resolves every
 * symbol in a class at load time — even symbols inside if-blocks.
 * If setRequireUserAction or USER_ACTION_NOT_REQUIRED appeared in
 * the same class as code that runs on Android 11, ART would throw
 * VerifyError on Android 11 devices the moment the class is loaded,
 * crashing the entire process (this is exactly what happened in
 * v1.0.4 before the revert).
 *
 * By isolating API-31 symbols here and only loading this class when
 * Build.VERSION.SDK_INT >= Build.VERSION_CODES.S (checked at the
 * call site in OtaInstaller), the ART verifier on Android 11 never
 * tries to resolve these symbols — the class is never loaded on
 * pre-31 devices.
 *
 * Call site pattern (enforced in OtaInstaller.installApk):
 *
 *   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && AdminReceiver.isDeviceOwner(ctx)) {
 *       Api31SilentInstall.configure(params)
 *   }
 *
 * v1.0.8 — re-introduced behind this isolation pattern after
 * v1.0.4's crash on Android 11 caused a full revert (see comment
 * in OtaInstaller.kt line ~51).
 */
@RequiresApi(Build.VERSION_CODES.S)
object Api31SilentInstall {

    @SuppressLint("NewApi")
    fun configure(params: PackageInstaller.SessionParams) {
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
}
