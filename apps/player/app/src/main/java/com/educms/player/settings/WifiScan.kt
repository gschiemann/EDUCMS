package com.educms.player.settings

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.educms.player.display.DisplayEmergency
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.LockTaskController
import java.util.concurrent.Executors

/**
 * NEARBY WI-FI NETWORKS (2026-10-23) — what VenueOS's on-screen Network
 * screen lists. Rules in [WifiScanPolicy]; read its header for why location
 * is asked for on every Android version.
 *
 *  • Bounded and throttled: one scan request per [WifiScanPolicy.MIN_SCAN_GAP_MS]
 *    (inside Android 9+'s own 4-per-2-minutes), a [WifiScanPolicy.SCAN_TIMEOUT_MS]
 *    wait, at most [WifiScanPolicy.MAX_NETWORKS] rows; one scan at a time.
 *  • Never on the emergency path: only a person's request on the Network
 *    screen starts one, and nothing starts while an alert is held.
 *  • Every result says WHY it may be empty ([WifiScanPolicy.Access]) — a
 *    switched-off Location is never shown as "no networks".
 */
object WifiScan {

    private const val TAG = "WifiScan"
    private const val REQUEST_CODE = 4712
    private const val KEY_ASKED = "scan.asked"

    data class Result(
        val access: WifiScanPolicy.Access,
        val networks: List<WifiScanPolicy.Network>,
        /** A scan finished just now (false = the list Android already had). */
        val fresh: Boolean,
    )

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "venueos-wifi-scan").apply { isDaemon = true } }
    private val waiting = mutableListOf<(Result) -> Unit>()
    @Volatile private var lastStartElapsedMs = 0L
    private var inFlight = false

    private fun wm(app: Context): WifiManager? = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    private fun granted(app: Context): Set<String> = WifiScanPolicy.permissions()
        .filter { runCatching { app.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }.getOrDefault(false) }
        .toSet()

    @Suppress("DEPRECATION") // LOCATION_MODE: the read below Android 9, where isLocationEnabled does not exist.
    private fun locationOn(app: Context): Boolean? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            (app.getSystemService(Context.LOCATION_SERVICE) as? LocationManager)?.isLocationEnabled
        } else {
            Settings.Secure.getInt(app.contentResolver, Settings.Secure.LOCATION_MODE) != Settings.Secure.LOCATION_MODE_OFF
        }
    }.getOrNull()

    /** Can the list be read right now — and if not, why. */
    fun access(activity: Activity?, ctx: Context): WifiScanPolicy.Access {
        val app = ctx.applicationContext
        val rationale = activity != null && WifiScanPolicy.permissions().any {
            runCatching { activity.shouldShowRequestPermissionRationale(it) }.getOrDefault(false)
        }
        return WifiScanPolicy.access(
            sdk = Build.VERSION.SDK_INT,
            hasWifi = WifiSetup.hasWifi(app),
            radioOn = runCatching { wm(app)?.isWifiEnabled }.getOrNull(),
            granted = granted(app),
            locationOn = locationOn(app),
            emergencyHeld = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true),
            askedBefore = prefs(app).getBoolean(KEY_ASKED, false),
            rationale = rationale,
        )
    }

    /**
     * Ask Android for location — ONLY from a person's press on a focused
     * control (the Network screen's "Allow"). Android's own dialog follows;
     * Back there is "deny". Fire-and-forget: the screen reads [access] again
     * when it comes back. Refused during an alert or a pinned task.
     */
    fun requestPermission(activity: Activity, source: String): Boolean {
        val app = activity.applicationContext
        val held = runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)
        val pinned = runCatching { LockTaskController.isActive(activity) }.getOrDefault(true)
        if (!WifiScanPolicy.mayRequestPermission(held, pinned)) return false
        prefs(app).edit().putBoolean(KEY_ASKED, true).apply()
        PlayerLogger.i(TAG, "asking for location to list nearby networks ($source)")
        return runCatching { activity.requestPermissions(WifiScanPolicy.permissions().toTypedArray(), REQUEST_CODE); true }
            .getOrDefault(false)
    }

    /**
     * 1.1.59 — the setup list asked for location (in its one permission
     * dialog). Recorded so [access] tells "never asked" from "refused".
     */
    fun markAsked(ctx: Context) {
        prefs(ctx.applicationContext).edit().putBoolean(KEY_ASKED, true).apply()
    }

    /**
     * First launch: ask for location once, so no Wi-Fi join ever raises the dialog (2026-10-26).
     * ⚠️ 1.1.59: NO LONGER CALLED. Location is the setup list's one permission
     * dialog now (SetupCeremony STEP_RUNTIME), together with every other grant.
     */
    fun requestAtFirstLaunch(activity: Activity) {
        val app = activity.applicationContext
        if (!WifiScanPolicy.shouldAskAtLaunch(granted(app), prefs(app).getBoolean(KEY_ASKED, false))) return
        requestPermission(activity, "first launch")
    }

    /** List nearby networks; [onResult] runs on the main thread. */
    fun scan(activity: Activity?, ctx: Context, onResult: (Result) -> Unit) {
        val app = ctx.applicationContext
        val access = access(activity, app)
        if (access != WifiScanPolicy.Access.GRANTED) {
            main.post { onResult(Result(access, emptyList(), fresh = false)) }
            return
        }
        synchronized(waiting) {
            waiting.add(onResult)
            if (inFlight) return
            inFlight = true
        }
        val now = SystemClock.elapsedRealtime()
        if (!WifiScanPolicy.shouldStartScan(lastStartElapsedMs, now)) {
            worker.execute { finish(app, fresh = false) }
            return
        }
        lastStartElapsedMs = now
        var done = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                if (done) return
                done = true
                runCatching { app.unregisterReceiver(this) }
                worker.execute { finish(app, fresh = true) }
            }
        }
        runCatching {
            ContextCompat.registerReceiver(
                app,
                receiver,
                IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        }
        @Suppress("DEPRECATION") // still the only way to ask; Android throttles it, and so do we.
        val started = runCatching { wm(app)?.startScan() == true }.getOrDefault(false)
        main.postDelayed({
            if (done) return@postDelayed
            done = true
            runCatching { app.unregisterReceiver(receiver) }
            worker.execute { finish(app, fresh = false) }
        }, if (started) WifiScanPolicy.SCAN_TIMEOUT_MS else 0L)
    }

    private fun finish(app: Context, fresh: Boolean) {
        val result = try {
            Result(WifiScanPolicy.Access.GRANTED, read(app), fresh)
        } catch (e: SecurityException) {
            // Allowed a moment ago, not any more (or Location went off).
            Result(access(null, app), emptyList(), fresh = false)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "scan list unreadable: ${t.message}")
            Result(WifiScanPolicy.Access.GRANTED, emptyList(), fresh = false)
        }
        val callbacks = synchronized(waiting) {
            inFlight = false
            waiting.toList().also { waiting.clear() }
        }
        main.post { callbacks.forEach { runCatching { it(result) } } }
    }

    @Suppress("DEPRECATION") // ScanResult.SSID: the one field that names a network on every Android here.
    private fun read(app: Context): List<WifiScanPolicy.Network> {
        val wm = wm(app) ?: return emptyList()
        val raw = wm.scanResults.orEmpty().map { WifiScanPolicy.Raw(it.SSID, it.level, it.capabilities) }
        val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        val saved = if (legacy) LegacyWifiNetworks(app).configured().orEmpty() else emptyList()
        val ledger = PrefsWifiStateStore(app).ledger().map { it.ssid }.toSet()
        val ours: Set<String> = if (legacy) {
            saved.mapNotNull { it.key?.ssid }.filter { it in ledger }.toSet()
        } else {
            setOfNotNull(runCatching { WifiSetup.observed(app)?.ssid }.getOrNull())
        }
        // Android 10+ does not show a normal app the networks a person saved.
        val others = if (legacy) saved.mapNotNull { it.key?.ssid }.filter { it !in ours }.toSet() else emptySet()
        val connected = runCatching { NetworkStatus.read(app).ssid }.getOrNull()
        return WifiScanPolicy.networks(raw, ours, others, connected)
    }

    private fun prefs(app: Context) = app.getSharedPreferences(PrefsWifiStateStore.PREFS, Context.MODE_PRIVATE)

    /**
     * ONE scan request right after a network was suggested (2026-10-26), so
     * Android runs network selection now rather than on its own disconnected
     * schedule — which backs off to minutes on a box that has sat without
     * Wi-Fi (`WifiConnectivityManager`'s 20 → 40 → 80 → 160 s ladder). Every
     * scan result, ours included, feeds that selection. Same throttle as the
     * list ([WifiScanPolicy.MIN_SCAN_GAP_MS]); nothing while a scan is in
     * flight; never over an alert. Returns whether a scan was asked for.
     */
    fun nudge(ctx: Context, source: String): Boolean {
        val app = ctx.applicationContext
        if (runCatching { DisplayEmergency.isHeld(app) }.getOrDefault(true)) return false
        synchronized(waiting) { if (inFlight) return false }
        val now = SystemClock.elapsedRealtime()
        if (!WifiScanPolicy.shouldStartScan(lastStartElapsedMs, now)) return false
        lastStartElapsedMs = now
        @Suppress("DEPRECATION") // still the only way to ask; Android throttles it, and so do we.
        val started = runCatching { wm(app)?.startScan() == true }.getOrDefault(false)
        PlayerLogger.i(TAG, "scan nudge ($source): ${if (started) "asked" else "refused by Android"}")
        return started
    }

    /** Android's own location page, for a person who chose "don't ask again" or switched Location off. */
    fun locationSettingsIntent(): Intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
}
