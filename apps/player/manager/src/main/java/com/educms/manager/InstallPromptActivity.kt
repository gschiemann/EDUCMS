package com.educms.manager

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log

/**
 * Transparent trampoline activity for Manager-driven install prompts.
 *
 * v1.0.6 — operator (2026-04-29): "we gave the player the allow
 * permissions when really it might be the manager that needs to
 * permissions". Architectural fix: Manager IS the install agent;
 * Manager needs its own install-unknown-apps permission AND a
 * foreground Activity to host the system Install dialog.
 *
 * Why this exists: Manager has NO user-facing Activity — it's a
 * daemon (WatchdogService FGS + receivers + content provider). So
 * when its OtaWorker fires PackageInstaller.commit() and gets
 * STATUS_PENDING_USER_ACTION back, OtaInstallReceiver's old code
 * tried `context.startActivity(promptIntent)` directly — which
 * Android 11+ Background Activity Launch silently DROPS for
 * activities started from BroadcastReceivers / non-foregrounded
 * contexts on signage ROMs. Player got the same fix in v1.0.22 by
 * trampolining through its already-foregrounded MainActivity, but
 * Manager has no MainActivity to trampoline through.
 *
 * Fix: surface the install prompt via a high-priority Notification
 * with `setFullScreenIntent` pointing here. Full-screen-intent
 * notifications are the documented Android pattern for "launch an
 * Activity from background" — they bypass BAL because the user
 * interacted with the notification (tap or auto-fire on lock-
 * screen). This Activity is transparent + finishes itself the
 * moment it dispatches the prompt → user never sees Manager's UI,
 * only the system Install dialog.
 *
 * Also handles the install-unknown-apps permission gate: if Manager
 * doesn't have the permission yet, Activity deep-links to Settings
 * first and re-fires bootstrap on return (via OtaWorker) once
 * granted.
 */
class InstallPromptActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // We're transparent + we finish() in every branch, so no
        // setContentView. Make sure the activity isn't shown briefly.
        // The android:theme="@android:style/Theme.Translucent.NoTitleBar"
        // declared in the manifest keeps us invisible across all
        // OEM ROMs.

        // Step 1: do we have install-unknown-apps permission?
        // canRequestPackageInstalls is API 26+; below that, the
        // permission is granted at install via the manifest entry.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            Log.i(TAG, "install-unknown-apps NOT granted to Manager — opening Settings")
            try {
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(settingsIntent)
            } catch (e: Exception) {
                Log.w(TAG, "could not open install-sources settings: ${e.message}")
            }
            // Manager's WatchdogService + periodic OtaWorker will
            // re-fire the install attempt soon after the user
            // returns from Settings. This activity's job is done.
            finish()
            return
        }

        // Step 2: dispatch the install prompt the receiver handed us.
        @Suppress("DEPRECATION")
        val promptIntent: Intent? = intent.getParcelableExtra(EXTRA_INSTALL_PROMPT)
        if (promptIntent == null) {
            Log.w(TAG, "InstallPromptActivity launched without EXTRA_INSTALL_PROMPT — bailing")
            finish()
            return
        }
        promptIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        try {
            startActivity(promptIntent)
            Log.i(TAG, "system Install dialog launched (BAL bypass via full-screen-intent)")
        } catch (e: Exception) {
            Log.e(TAG, "install prompt launch failed: ${e.message}", e)
        }
        finish()
    }

    companion object {
        private const val TAG = "InstallPromptActivity"
        const val ACTION = "com.educms.manager.LAUNCH_INSTALL_PROMPT"
        const val EXTRA_INSTALL_PROMPT = "install_prompt_intent"
    }
}
