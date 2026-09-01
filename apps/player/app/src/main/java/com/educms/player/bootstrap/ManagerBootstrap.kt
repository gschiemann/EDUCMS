package com.educms.player.bootstrap

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import com.educms.player.ota.Api31SilentInstall
import com.educms.player.ota.Api34UpdateOwnership
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Single-sideload UX (operator request 2026-04-27): the dashboard's
 * "Download Player APK" button gives ONE APK that brings everything,
 * including the Manager companion APK.
 *
 * v1.0.14 strategy:
 *   PRIMARY: Manager APK is bundled inside Player at build time
 *            (apps/player/app/src/main/assets/bundled/edu-cms-manager.apk
 *            via the Gradle bundleManagerApk task). On first launch,
 *            extract from assets to cache, install via PackageInstaller.
 *            No network needed; works the moment Player is sideloaded.
 *
 *   FALLBACK: If the bundled asset is missing for any reason (CI
 *             didn't copy it, dev build edge case), fall back to
 *             fetching from /api/v1/player/manager-apk/latest. Same
 *             behavior as v1.0.13 — useful as a safety net but no
 *             longer the primary path.
 *
 * Visible UI: shows on-screen toasts during install so the operator
 * sees what's happening. v1.0.13's silent failure mode was a real
 * UX problem — the operator had no way to tell whether bootstrap
 * had run, succeeded, or failed.
 *
 * Idempotent — checks if Manager is installed before doing anything,
 * so subsequent boots are no-ops.
 */
object ManagerBootstrap {
    private const val TAG = "ManagerBootstrap"
    private const val MANAGER_PKG = "com.educms.manager"
    private const val MANAGER_PKG_DEBUG = "com.educms.manager.debug"
    private const val BUNDLED_ASSET = "bundled/edu-cms-manager.apk"

    /** How long after a commit we check whether the companion actually moved. */
    private const val STALL_CHECK_DELAY_MS = 90_000L
    private val mainHandler = Handler(Looper.getMainLooper())

    fun bootstrapIfNeeded(ctx: Context) {
        // 2026-05-13 (Player v1.0.56) — operator deploying to an LED
        // poster (320×1080 single-poster mode) couldn't see the system
        // Install dialog the bootstrap fires. Two escape hatches:
        //
        //   /sdcard/edu-cms/skip-manager.txt — present (any contents):
        //     skip the Manager bootstrap entirely. Operator manually
        //     sideloaded Manager via ViPlex Express, or accepts running
        //     without the companion (kiosk lock-in / auto-update
        //     features become unavailable, but pairing + playback work
        //     normally).
        //
        // Operator drops the flag file via ViPlex Express → File
        // Transfer. The Player picks it up on next boot.
        if (shouldSkipBootstrap(ctx)) {
            PlayerLogger.i(TAG, "Skipping Manager bootstrap — /sdcard/edu-cms/skip-manager.txt present")
            return
        }
        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                bootstrapInternal(ctx)
            } catch (e: Exception) {
                PlayerLogger.w(TAG, "ManagerBootstrap failed (will retry next boot): ${e.message}")
                Log.w(TAG, "bootstrap failed", e)
                showToast(ctx, "Manager install failed — will retry on next launch")
                reportBlocked(ctx, "exception: ${e.message?.take(120)}")
            }
        }
    }

    /**
     * Check for the skip-bootstrap flag file. Looks in two locations
     * because ViPlex Express's file-push lands in different paths
     * depending on Taurus model + Android version:
     *
     *   /sdcard/edu-cms/skip-manager.txt
     *   /storage/emulated/0/edu-cms/skip-manager.txt
     *
     * Either presence is enough. Contents are ignored — file existence
     * alone is the signal. Operator can later remove the file (or just
     * uninstall + reinstall Player) to re-enable the bootstrap.
     */
    @Suppress("UNUSED_PARAMETER")
    private fun shouldSkipBootstrap(ctx: Context): Boolean {
        val candidates = listOf(
            "/sdcard/edu-cms/skip-manager.txt",
            "/storage/emulated/0/edu-cms/skip-manager.txt",
        )
        return candidates.any { path ->
            try { File(path).exists() } catch (_: Exception) { false }
        }
    }

    /**
     * 2026-04-28 (Player v1.0.20) — operator: "stop telling me to side
     * load you fucking cunt, fix your fucking apk". Surface bootstrap
     * failures to the dashboard so the operator can see WHY Manager
     * isn't installing instead of the system silently failing. State
     * 'INSTALL_BLOCKED' is rendered as a red banner on the dashboard
     * screen card so an admin glance reveals the issue immediately.
     *
     * Pre-existing /ota-state endpoint accepts this state via the
     * standard ALLOWED set (CHECKING / DOWNLOADING / VERIFYING /
     * INSTALLING / INSTALLED / ERROR). We use ERROR with a message
     * that explicitly mentions "Install Unknown Apps permission".
     */
    private fun reportBlocked(ctx: Context, reason: String) {
        postOtaState(
            ctx,
            "Manager install blocked: $reason. Settings → Apps → EduCMS Player → " +
                "Install unknown apps → Allow",
        )
    }

    /**
     * 2026-09-01 (TC22 F4) — the companion install was COMMITTED and the
     * installed version still has not moved. Same channel as
     * [reportBlocked] (the `/ota-state` row the dashboard renders on the
     * screen card), deliberately different copy.
     *
     * ⚠️ Until now `ManagerBootstrap` only ever reported on an EXCEPTION.
     * A commit whose confirmation was dropped, covered or declined produced
     * no error anywhere: the companion version silently stayed where it
     * was and the dashboard showed nothing wrong. That silence is half of
     * the TC22 report — "it asked… but it did not update it" was true and
     * invisible.
     *
     * Copy states what the evidence proves (rule 10): we committed a
     * session, N seconds passed, the installed version is unchanged. We
     * cannot see the glass, so it never claims a dialog is or was showing,
     * and it does not send anyone to grant a permission we have no evidence
     * is missing.
     */
    private fun reportStalled(ctx: Context, message: String) = postOtaState(ctx, message)

    /** The one best-effort `/ota-state` POST both reports ride. */
    private fun postOtaState(ctx: Context, message: String) {
        try {
            val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            val apiRoot = prefs.getString("api_root", null) ?: return
            val fp = prefs.getString("device_fingerprint", null) ?: return
            Thread {
                try {
                    val url = java.net.URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
                    val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                        requestMethod = "POST"
                        setRequestProperty("Content-Type", "application/json")
                        doOutput = true
                        connectTimeout = 5_000
                        readTimeout = 5_000
                    }
                    val payload = org.json.JSONObject().apply {
                        put("state", "ERROR")
                        put("message", message.take(400))
                    }
                    conn.outputStream.use { it.write(payload.toString().toByteArray()) }
                    conn.responseCode  // force-flush
                } catch (_: Exception) { /* swallow */ }
            }.start()
        } catch (_: Exception) { /* best-effort */ }
    }

    /**
     * After a commit, come back and CHECK. The install may need a human
     * tap; if it never happens, this is the only thing that says so.
     *
     * 90 s is sized against the real sequence: commit → status broadcast →
     * trampoline → system dialog → a person reads it and taps Install →
     * PackageInstaller does the work. Comfortably past that on the slowest
     * panel we ship to, and inside the 3-minute bound `MainActivity`'s
     * upgrade gate gives itself, so the report exists before the screen
     * gives up and goes back to playing.
     */
    private fun scheduleStallCheck(ctx: Context, targetPkg: String?, expectedVc: Int, source: String) {
        if (targetPkg == null || expectedVc <= 0) return
        val app = ctx.applicationContext
        mainHandler.postDelayed({
            val installed = readInstalledVersionCode(app, targetPkg)
            if (installed != null && installed >= expectedVc) {
                PlayerLogger.i(
                    TAG,
                    "companion install confirmed ($source): $targetPkg is now vc $installed",
                )
                return@postDelayed
            }
            val observed = "installed vc ${installed ?: "none"}, expected $expectedVc"
            PlayerLogger.w(
                TAG,
                "companion install STALLED ($source): committed ${STALL_CHECK_DELAY_MS / 1000}s " +
                    "ago and $observed",
            )
            reportStalled(
                app,
                "Companion update did not apply: the install was started " +
                    "${STALL_CHECK_DELAY_MS / 1000}s ago and $targetPkg is still on $observed. " +
                    "If a system Install dialog is waiting on this screen, choose Install; the " +
                    "screen keeps playing either way and retries on the next update check.",
            )
        }, STALL_CHECK_DELAY_MS)
    }

    /** Installed versionCode of one package, or null when absent. */
    @Suppress("DEPRECATION")
    private fun readInstalledVersionCode(ctx: Context, pkg: String): Int? = try {
        ctx.packageManager.getPackageInfo(pkg, 0).versionCode
    } catch (_: Exception) {
        null
    }

    private fun bootstrapInternal(ctx: Context) {
        // 2026-04-28 (Player v1.0.19) — version-aware bootstrap.
        // Operator: "i deleted the old manager so cant be" — they
        // sideloaded Player v1.0.18 expecting bundled Manager v1.0.3
        // to install, but the previous logic just skipped on ANY
        // installed Manager. Without forcing a re-install, the
        // operator was stuck on Manager v1.0.1 (which has no self-
        // update worker, no DEVICE_OWNER skip, no anti-spoof, none
        // of the v1.0.3 hardening).
        //
        // New behavior: extract bundled APK first, read its
        // versionCode + package id, compare to installed. Install
        // if installed is missing OR strictly older.
        val bundledFile = extractBundledManagerApk(ctx)
        if (bundledFile == null) {
            // No bundled APK — fall back to network fetch IF Manager
            // isn't installed at all. Don't network-fetch just to
            // upgrade an existing one; the network path can't tell
            // us the latest version cheaply.
            if (isManagerInstalled(ctx)) {
                PlayerLogger.i(TAG, "Manager installed + no bundled APK to compare — skipping bootstrap")
                return
            }
            PlayerLogger.w(TAG, "Manager not installed AND no bundled APK — falling back to network fetch")
            showToast(ctx, "Installing companion — downloading…")
            val downloaded = downloadManagerApk(ctx)
            if (downloaded != null) {
                installViaPackageInstaller(ctx, downloaded, "network")
            } else {
                PlayerLogger.w(TAG, "Network fallback failed — bootstrap will retry next boot")
                showToast(ctx, "Manager install failed (no network) — will retry")
            }
            return
        }

        // Bundled APK exists — compare versions.
        val bundledVc = readApkVersionCode(ctx, bundledFile)
        val installedVc = readInstalledManagerVersionCode(ctx)
        if (bundledVc <= 0) {
            PlayerLogger.w(TAG, "Couldn't read bundled APK version — falling back to install-if-missing")
            if (isManagerInstalled(ctx)) return
            installViaPackageInstaller(ctx, bundledFile, "bundled")
            return
        }
        if (installedVc != null && installedVc >= bundledVc) {
            PlayerLogger.i(
                TAG,
                "Manager already current (installed vc=$installedVc >= bundled vc=$bundledVc) — skipping",
            )
            return
        }

        val tag = if (installedVc == null) "bundled-fresh-install" else "bundled-upgrade-$installedVc-to-$bundledVc"
        PlayerLogger.i(TAG, "Installing Manager from bundled assets (${bundledFile.length()}b) — $tag")
        showToast(
            ctx,
            if (installedVc == null) "Installing companion (EduCMS Manager)…"
            else "Upgrading companion: vc $installedVc → $bundledVc",
        )
        installViaPackageInstaller(ctx, bundledFile, tag)
    }

    /**
     * 2026-09-01 (TC22 F2) — read the three facts a caller needs to decide
     * whether to HOLD CONTENT for a companion upgrade, without committing
     * to anything.
     *
     * ⚠️ Does real IO (extracts the ~2 MB bundled APK from assets so
     * PackageManager can parse it) — never call this on the main thread.
     * `MainActivity` runs it on Dispatchers.IO behind a bounded wait, so a
     * pathological filesystem cannot delay a boot indefinitely.
     *
     * Deliberately side-effect-free apart from that extraction (the same
     * cache file `bootstrapInternal` would write anyway): the decision is
     * the caller's, and re-extracting costs one local copy.
     */
    fun probeUpgrade(ctx: Context): ManagerUpgradeProbe {
        if (shouldSkipBootstrap(ctx)) {
            return ManagerUpgradeProbe(
                bundledVersionCode = 0,
                installedVersionCode = readInstalledManagerVersionCode(ctx),
                bootstrapSkipped = true,
            )
        }
        val bundled = extractBundledManagerApk(ctx)
        return ManagerUpgradeProbe(
            bundledVersionCode = if (bundled == null) 0 else readApkVersionCode(ctx, bundled),
            installedVersionCode = readInstalledManagerVersionCode(ctx),
            bootstrapSkipped = false,
        )
    }

    /** Read the versionCode of an APK file via PackageManager.getPackageArchiveInfo. */
    @Suppress("DEPRECATION")
    private fun readApkVersionCode(ctx: Context, apk: File): Int {
        return try {
            val info = ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
            info?.versionCode ?: 0
        } catch (_: Exception) { 0 }
    }

    /** Read the installed Manager APK's versionCode. Returns null if not installed. */
    @Suppress("DEPRECATION")
    private fun readInstalledManagerVersionCode(ctx: Context): Int? {
        val pm = ctx.packageManager
        for (pkg in listOf(MANAGER_PKG, MANAGER_PKG_DEBUG)) {
            try {
                return pm.getPackageInfo(pkg, 0).versionCode
            } catch (_: Exception) { /* not installed */ }
        }
        return null
    }

    /**
     * Copy the bundled Manager APK from assets into a real file
     * PackageInstaller can read. AGP-bundled assets aren't directly
     * file-accessible (they live inside the APK's zip), so we have
     * to extract.
     *
     * Returns null if the asset doesn't exist (older builds or
     * Gradle task didn't run).
     */
    private fun extractBundledManagerApk(ctx: Context): File? {
        return try {
            val outDir = File(ctx.cacheDir, "manager-bootstrap").apply { mkdirs() }
            val outFile = File(outDir, "manager.apk")
            ctx.assets.open(BUNDLED_ASSET).use { input ->
                outFile.outputStream().use { output -> input.copyTo(output) }
            }
            if (outFile.length() > 0) outFile else null
        } catch (e: Exception) {
            PlayerLogger.i(TAG, "no bundled Manager asset (${e.message})")
            null
        }
    }

    private fun downloadManagerApk(ctx: Context): File? {
        // For network fallback, hit Railway directly — Vercel routing
        // to /api/v1/* has been a moving target. Hardcoded production
        // URL is acceptable for a fallback path that should never run
        // on a properly-built APK.
        val managerApkUrl =
            "https://api-production-39a1.up.railway.app/api/v1/player/manager-apk/latest"
        val outDir = File(ctx.cacheDir, "manager-bootstrap").apply { mkdirs() }
        val outFile = File(outDir, "manager.apk")
        return try {
            val conn = (URL(managerApkUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 20_000
                readTimeout = 60_000
            }
            if (conn.responseCode !in 200..299) {
                PlayerLogger.w(TAG, "Manager APK fetch HTTP ${conn.responseCode}")
                return null
            }
            outFile.outputStream().use { out ->
                conn.inputStream.use { inp -> inp.copyTo(out) }
            }
            if (outFile.length() > 0) outFile else null
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager download failed: ${e.message}")
            null
        }
    }

    private fun isManagerInstalled(ctx: Context): Boolean {
        val pm = ctx.packageManager
        for (pkg in listOf(MANAGER_PKG, MANAGER_PKG_DEBUG)) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true
            } catch (_: Exception) { /* not installed */ }
        }
        return false
    }

    /**
     * Read the package id an APK file declares. Null when the archive
     * cannot be parsed — in which case the session is committed WITHOUT a
     * pinned target, exactly as it was before 2026-09-01. An unreadable
     * archive must degrade to the old behaviour, never fail the install.
     */
    @Suppress("DEPRECATION")
    private fun readApkPackageName(ctx: Context, apk: File): String? = try {
        ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)?.packageName
    } catch (_: Exception) {
        null
    }

    private fun installViaPackageInstaller(ctx: Context, apk: File, source: String) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)

            // ── 2026-09-01 (TC22 F3): A REAL INSTALL SESSION ────────
            //
            // This session was committed with NONE of the three things
            // every other installer in the codebase sets — no
            // setAppPackageName, no silent-install hint, no update-ownership
            // request (contrast OtaUpdateWorker.triggerInstall and
            // Manager's OtaInstaller.installApk, which set all three). So
            // the bundled-companion install could NEVER complete without a
            // human tap, on any device, no matter how the fleet was
            // provisioned — which is what put a system dialog on the glass
            // for the whole 60 s window in which the relaunch actors fire.
            //
            // 1. PIN THE TARGET. Also a security property: a session that
            //    names its package cannot be redirected to install
            //    something else if the staging file is swapped.
            val targetPkg = readApkPackageName(ctx, apk)
            if (targetPkg != null) {
                params.setAppPackageName(targetPkg)
            } else {
                PlayerLogger.w(TAG, "could not read the bundled APK's package id — committing unpinned")
            }

            // 2. SILENT WHERE WE HAVE EARNED IT. The system honours
            //    USER_ACTION_NOT_REQUIRED when the caller holds
            //    UPDATE_PACKAGES_WITHOUT_USER_ACTION (Player's manifest
            //    does, since v1.0.53) AND is installer-of-record for the
            //    target. Where Player bootstrapped the companion, both hold
            //    and the upgrade goes through with no dialog and no race at
            //    all. Where they do not, the system falls back to
            //    STATUS_PENDING_USER_ACTION — byte-for-byte today's path,
            //    so there is no configuration this can make worse.
            //
            //    Symbol isolation: setRequireUserAction is API 31+, kept in
            //    the @RequiresApi(31) Api31SilentInstall object so Android
            //    11 ART never resolves it at class-load time (the v1.0.20
            //    VerifyError).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Api31SilentInstall.configure(params)
            }

            // 3. UPDATE OWNERSHIP on Android 14+, so a vendor store or OEM
            //    "system update" cannot silently regress the companion.
            //    Granted only when nothing else owns updates for it.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                try {
                    Api34UpdateOwnership.configure(params)
                } catch (e: Exception) {
                    PlayerLogger.w(TAG, "update-ownership request failed (continuing): ${e.message}")
                }
            }
            PlayerLogger.i(
                TAG,
                "companion install session: target=${targetPkg ?: "unpinned"} " +
                    "silentHint=${Build.VERSION.SDK_INT >= Build.VERSION_CODES.S} " +
                    "sdk=${Build.VERSION.SDK_INT}",
            )

            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                // CRITICAL FIX (v1.0.15): reuse the EXISTING
                // OtaInstallReceiver (action com.educms.player.OTA_INSTALL_RESULT)
                // instead of inventing MANAGER_BOOTSTRAP_RESULT, which
                // had no listener registered. The OTA receiver already
                // knows how to handle STATUS_PENDING_USER_ACTION by
                // launching the system Install prompt as an activity.
                // Without this, install commits returned PENDING_USER_ACTION
                // to a broadcast nobody received → install silently
                // stalled. Operator on The Den (2026-04-27): "side
                // loaded the apk and no manager loaded anywhere".
                val resultIntent = Intent("com.educms.player.OTA_INSTALL_RESULT").apply {
                    setPackage(ctx.packageName)
                }
                val statusPi = PendingIntent.getBroadcast(
                    ctx,
                    sessionId,
                    resultIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(statusPi.intentSender)
                PlayerLogger.i(TAG, "Manager install session committed (id=$sessionId source=$source)")
                showToast(ctx, "Companion install committed (system prompt may appear)")
                // TC22 F4 — come back in 90 s and say whether it actually
                // applied. Before this, a commit whose confirmation was
                // dropped or declined reported NOTHING anywhere.
                scheduleStallCheck(ctx, targetPkg, readApkVersionCode(ctx, apk), source)
            }
        } catch (e: Exception) {
            PlayerLogger.w(TAG, "Manager install failed: ${e.message}", e)
            showToast(ctx, "Manager install error: ${e.message?.take(60)}")
        }
    }

    /**
     * Visible toast on the kiosk screen so the operator can SEE what
     * the bootstrap is doing. v1.0.13's silent failures left no trail.
     *
     * Uses LENGTH_LONG (~3.5s) so it's readable across the room.
     * Posts to main thread because Toast is UI.
     */
    private fun showToast(ctx: Context, message: String) {
        mainHandler.post {
            try {
                Toast.makeText(ctx.applicationContext, "EduCMS: $message", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Log.w(TAG, "showToast failed: ${e.message}")
            }
        }
    }
}


/**
 * What a [ManagerBootstrap.probeUpgrade] found. Plain data — no Context,
 * no IO — so the decision below can be tested without an emulator.
 *
 * @param bundledVersionCode   versionCode of the Manager APK shipped inside
 *                             this Player build; 0 when there is no bundled
 *                             asset (dev builds before `:app:bundleManagerApk`)
 *                             or its manifest could not be parsed.
 * @param installedVersionCode versionCode of the Manager on the device;
 *                             null when the companion is not installed at
 *                             all — that is the FIRST-INSTALL gate's case,
 *                             not this one.
 * @param bootstrapSkipped     /sdcard/edu-cms/skip-manager.txt is present;
 *                             the operator has opted this panel out.
 */
data class ManagerUpgradeProbe(
    val bundledVersionCode: Int,
    val installedVersionCode: Int?,
    val bootstrapSkipped: Boolean,
)

/** What to do about a companion upgrade, and — when we decline — why. */
enum class ManagerUpgradeDecision {
    /** Installed is current (or newer, or absent). Carry on playing. */
    NO_UPGRADE_AVAILABLE,

    /** Hold content, install the bundled companion, resume when it lands. */
    HOLD_AND_UPGRADE,

    /** skip-manager.txt — the operator opted this panel out. */
    SKIP_BOOTSTRAP_DISABLED,

    /** An alert is on the glass. Nothing may cover it. */
    SKIP_EMERGENCY_HELD,

    /** We already ran a hold for this exact target in this process. */
    SKIP_ALREADY_ATTEMPTED,

    /** A gate is already up — this is the idempotent second call. */
    SKIP_GATE_ALREADY_UP,
}

/**
 * The pure half of the TC22 F2 fix: *should this screen stop showing
 * content and update its companion first?*
 *
 * THE FIELD FAILURE. The operator ran an update and the Player upgraded but
 * the Manager did not: *"I think the screen keeps trying to play the
 * existing content before it gets to finish the updating process — it needs
 * to put the content on hold, do the upgrade, and then auto start the
 * content again."* They were reading the code correctly. `MainActivity`'s
 * gate was keyed on `readManagerVersion() != null` — a BINARY check, so a
 * STALE companion took the happy path: `loadPlayer()` first, bootstrap (and
 * its system install dialog) second, from the same `onCreate`, with nothing
 * holding anything.
 *
 * ⚠️ TWO REFUSALS THAT MATTER MORE THAN THE FEATURE:
 *
 *  • [SKIP_EMERGENCY_HELD]. A full-screen "Updating companion service…"
 *    overlay on top of a live lockdown alert is the worst thing this file
 *    could do. An alert outranks every upgrade, always.
 *  • [SKIP_ALREADY_ATTEMPTED]. The hold can be triggered by a routine
 *    CHECK_FOR_UPDATES, which a screen may receive repeatedly. One attempt
 *    per target version per process; after that the operator drives it with
 *    the gate's Retry button.
 */
object ManagerUpgradeMath {

    fun decide(
        probe: ManagerUpgradeProbe,
        emergencyHeld: Boolean,
        gateAlreadyShown: Boolean,
        holdAlreadyAttemptedForVc: Int,
    ): ManagerUpgradeDecision {
        if (probe.bootstrapSkipped) return ManagerUpgradeDecision.SKIP_BOOTSTRAP_DISABLED
        val bundled = probe.bundledVersionCode
        val installed = probe.installedVersionCode
        // No bundled asset, unreadable asset, companion missing entirely, or
        // already current/newer — none of those is an upgrade to hold for.
        // (Missing belongs to the first-install gate, which already holds.)
        if (bundled <= 0 || installed == null || installed >= bundled) {
            return ManagerUpgradeDecision.NO_UPGRADE_AVAILABLE
        }
        if (emergencyHeld) return ManagerUpgradeDecision.SKIP_EMERGENCY_HELD
        if (gateAlreadyShown) return ManagerUpgradeDecision.SKIP_GATE_ALREADY_UP
        if (holdAlreadyAttemptedForVc == bundled) return ManagerUpgradeDecision.SKIP_ALREADY_ATTEMPTED
        return ManagerUpgradeDecision.HOLD_AND_UPGRADE
    }
}
