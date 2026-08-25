package com.educms.player.display

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.Build.VERSION_CODES
import android.hardware.usb.UsbManager
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * READ-ONLY probe of this device's display/audio/power control surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * We want the dashboard to control screen volume, brightness, blank/wake
 * and scheduled on/off across Goodview, NovaStar Taurus, TCL and whatever
 * Android signage SoC comes next — without holding a vendor SDK for each.
 * Before we can build that control layer we have to know what each box
 * actually exposes. This class answers that per-device, fleet-wide, with
 * no adb cable and no vendor NDA.
 *
 * It is the in-APK companion to `scripts/vendor-display-probe.sh`. The adb
 * script sees far more (system services, vendor intent filters, full
 * getprop) because a shell is not subject to app sandboxing; this class is
 * what we can see from inside the sandbox, on every screen in the fleet,
 * at any time. Run the script once on a bench unit to design the
 * integration; use this to verify the fleet matches.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️  SAFETY CONTRACT — THIS CLASS ONLY READS. IT MUST STAY THAT WAY.
 * ─────────────────────────────────────────────────────────────────────
 * No `Settings.*.putInt`, no `File.writeText`, no `sendBroadcast`, no
 * `DevicePolicyManager` mutator, no `AudioManager.setStreamVolume`, no
 * window/brightness mutation. Every method below is an observation.
 *
 * A probe that writes is a probe that can black out a wall-mounted screen
 * with no way back — the exact outcome we are trying to avoid. When we
 * build the actual control layer it goes in a SEPARATE class with an
 * explicit arm/confirm/auto-revert cycle. Do not "just add a setter here."
 *
 * Reflection is deliberately NOT used to reach hidden APIs
 * (`android.os.ServiceManager.listServices`, `IHardwareService`, etc.).
 * Those are on the non-SDK blocklist from API 28 up, so the call fails on
 * every modern box anyway, and on older boxes it invites the class-load
 * `VerifyError` failure mode this codebase has been burned by twice
 * (see `Api31SilentInstall`). Hidden-API surface is the adb script's job.
 *
 * API LEVEL NOTE: minSdk is 24. Everything called here is API ≤ 23 except
 * `Settings.System.canWrite` (23). Nothing from API 28+ is referenced at
 * all, so there is no @RequiresApi isolation object needed and no risk of
 * ART resolving a too-new symbol at class-load on an Android 11 Taurus.
 *
 * NOT WIRED INTO THE HEARTBEAT — ON PURPOSE. This result is pull-only
 * (`EduCmsNative.probeDisplay()` / diagnostics upload). It must never
 * become a per-poll field on the Screen row: high-frequency Screen
 * telemetry columns invalidate the manifest hot-cache and silently
 * re-create the 25 GB/mo Supabase egress that cache was built to kill
 * (see CLAUDE.md → manifest content cache, rule 7).
 */
object DisplayCapabilityProbe {

    private const val TAG = "DisplayProbe"

    /** Schema version — bump when fields change so server-side parsing can branch. */
    private const val SCHEMA = 1

    /**
     * The one verdict value that is NOT a [DisplayControlProvider.id]:
     * "this box genuinely cannot do it". Only `reboot`, `volume` and
     * `hardPowerOff` can ever carry it — BRIGHTNESS, BLANK and WAKE
     * always resolve to a mechanism (contract C3).
     */
    internal const val CAPABILITY_NONE = "none"

    /**
     * `hardPowerOff` has no provider (nothing in the registry can cut
     * panel power), so its non-"none" value is a probe-only finding: a
     * serial node exists, which MIGHT carry the panel's RS-232 command
     * set. It is a lead for field ops, never a capability claim.
     */
    internal const val HARD_POWER_OFF_SERIAL = "serial-candidate"

    /**
     * Kernel backlight nodes, in descending order of "this is the real
     * panel backlight". Presence alone is a finding; readability and
     * writability are separate findings (most boxes expose the node but
     * restrict it to root/system via SELinux).
     */
    private val BACKLIGHT_PATHS = listOf(
        "/sys/class/backlight",
        "/sys/class/leds/lcd-backlight",
        "/sys/class/leds/backlight",
        "/sys/class/graphics/fb0",
    )

    /**
     * Settings keys worth reporting verbatim. The wildcard scan below
     * catches vendor-invented keys; these are the standard ones whose
     * VALUES we want even when the name doesn't match the heuristic.
     */
    private val KNOWN_SETTINGS = listOf(
        Settings.System.SCREEN_BRIGHTNESS,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        Settings.System.SCREEN_OFF_TIMEOUT,
    )

    /** Substrings that make a vendor-invented Settings key interesting. */
    private val SETTINGS_HEURISTIC = listOf(
        "backlight", "bright", "panel", "lcd", "screen_off", "hdmi",
        "standby", "sleep", "schedule", "power_on", "power_off", "led_",
    )

    /**
     * Package-name prefixes that suggest a vendor control app. Targeted
     * `getPackageInfo` lookups are exempt from Android 11 package-visibility
     * filtering only when declared in `<queries>`; broad enumeration needs
     * QUERY_ALL_PACKAGES, which we grant in the DEBUG build only (see
     * `app/src/debug/AndroidManifest.xml`). On a release build this list
     * still works for anything the manifest `<queries>` block declares, and
     * `packagesEnumerable` in the output tells you which mode you got.
     */
    private val VENDOR_PREFIXES = listOf(
        "com.gv.", "com.goodview", "com.good_view",
        "com.novastar", "com.nova.", "com.xixun",
        "com.tcl.", "com.tclking",
        "com.rockchip", "com.amlogic", "com.allwinner", "com.mstar",
        "android.hardware.",
    )

    /**
     * Runs the full probe. Safe to call at any time from any thread; does
     * a handful of small filesystem stats and ContentResolver reads and
     * typically completes in well under 100 ms.
     *
     * Never throws — every section is independently guarded so one
     * unsupported call on an odd ROM cannot cost us the whole report.
     */
    fun probe(ctx: Context): JSONObject {
        val root = JSONObject()
        root.put("schema", SCHEMA)
        root.put("probedAt", System.currentTimeMillis())

        section(root, "build") { buildIdentity() }
        // 2026-08-25 (v1.1.5, P4) — the three per-panel facts that used to
        // need a site visit: is silent self-update armed, is device-owner
        // even possible, and which vendor CMS owns the box.
        section(root, "app") { appIdentity(ctx) }
        // 2026-08-25 (v1.1.5, P3) — what the first-boot ceremony actually
        // achieved on a panel nobody is standing next to.
        //
        // The `setup` package already depends on `display`
        // (DeviceAdminEnrollment / DisplayEmergency); this is the return
        // edge, and it is deliberate rather than an accident of layering:
        // the probe is the ONE device→server document, and giving setup its
        // own reporting path would mean a second endpoint, a second dedup
        // marker and a second thing to keep off the manifest hot path.
        section(root, "setup") { com.educms.player.setup.SetupCeremony.telemetryJson(ctx) }
        section(root, "admin") { adminState(ctx) }
        section(root, "brightness") { brightnessSurface(ctx) }
        section(root, "backlightNodes") { backlightNodes() }
        section(root, "settingsKeys") { vendorSettingsKeys(ctx) }
        section(root, "audio") { audioSurface(ctx) }
        section(root, "power") { powerSurface(ctx) }
        section(root, "displays") { displaySurface(ctx) }
        section(root, "features") { systemFeatures(ctx) }
        section(root, "vendorPackages") { vendorPackages(ctx) }
        section(root, "serial") { serialSurface(ctx) }
        section(root, "control") { resolvedControl(ctx) }

        root.put("verdict", verdict(root))
        return root
    }

    /** JSON string form, for the JS bridge / diagnostics upload. */
    fun probeJson(ctx: Context): String = try {
        probe(ctx).toString()
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "probe failed outright: ${t.message}")
        JSONObject().put("schema", SCHEMA).put("error", t.message ?: "unknown").toString()
    }

    // ─────────────────────────────────────────────────────────────────
    // sections
    // ─────────────────────────────────────────────────────────────────

    private fun buildIdentity() = JSONObject().apply {
        put("manufacturer", Build.MANUFACTURER)
        put("brand", Build.BRAND)
        put("model", Build.MODEL)
        put("device", Build.DEVICE)
        put("product", Build.PRODUCT)
        put("hardware", Build.HARDWARE)
        put("board", Build.BOARD)
        put("display", Build.DISPLAY)
        put("fingerprint", Build.FINGERPRINT)
        put("sdk", Build.VERSION.SDK_INT)
        put("release", Build.VERSION.RELEASE)
    }

    /**
     * ── P4 (2026-08-25, v1.1.5) — WHO INSTALLED US, AND CAN WE UPDATE ────
     *
     * Three questions that were previously only answerable with a cable:
     *
     *  1. **Is a silent self-update armed on this panel?** Android skips the
     *     install prompt only when the caller is API 31+, holds
     *     UPDATE_PACKAGES_WITHOUT_USER_ACTION (we do), and is
     *     INSTALLER-OF-RECORD for the target package. That last one is
     *     per-panel and depends entirely on how the APK first arrived —
     *     adb sideload, the OEM package installer, Manager, or a previous
     *     self-update. `silentUpdateArmed` is that whole conjunction, so a
     *     wide rollout can be triaged as "these N panels will need a tap on
     *     the next OTA" instead of discovered one truck roll at a time.
     *  2. **Is device owner even possible here?** Only one can exist per
     *     device; `admin.deviceOwnerPackage` (below) answers who holds it,
     *     which decides whether reboot / lock-task are ever on the table.
     *  3. **What is this build?** `versionName` / `versionCode` from the
     *     APK itself rather than from the URL the page happens to carry.
     */
    private fun appIdentity(ctx: Context): JSONObject {
        val out = JSONObject()
        out.put("packageName", ctx.packageName)
        out.put("versionName", safe { com.educms.player.BuildConfig.VERSION_NAME } ?: JSONObject.NULL)
        out.put("versionCode", safe { com.educms.player.BuildConfig.VERSION_CODE } ?: JSONObject.NULL)
        out.put("sdkInt", Build.VERSION.SDK_INT)

        val installer = safe {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                ctx.packageManager.getInstallerPackageName(ctx.packageName)
            }
        }
        out.put("installerOfRecord", installer ?: JSONObject.NULL)
        out.put("selfIsInstallerOfRecord", installer == ctx.packageName)
        out.put("canRequestPackageInstalls", canRequestInstalls(ctx))
        // ⚠️ A PREDICTION, not an observation — Android exposes no API that
        // says "your next commit will be silent". It is the documented
        // conjunction; a vendor ROM that has torn the behaviour out will
        // still prompt, which is exactly what the OTA state reports catch.
        out.put(
            "silentUpdateArmed",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && installer == ctx.packageName,
        )
        return out
    }

    private fun canRequestInstalls(ctx: Context): Boolean = safe {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true
        else ctx.packageManager.canRequestPackageInstalls()
    } ?: false

    /**
     * THE question for the control layer: is a device owner set, and is it
     * us? Device owner is what unlocks `DevicePolicyManager.reboot()` and
     * makes `lockNow()` (screen blank) dependable. Only ONE device owner
     * can exist per device — if the vendor CMS already holds it, our
     * Manager can never take it without a factory reset.
     *
     * `isDeviceOwnerApp(pkg)` is public API and accepts ANY package name,
     * so we can identify the holder by testing candidates — no @SystemApi
     * and no reflection required.
     */
    private fun adminState(ctx: Context): JSONObject {
        val out = JSONObject()
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE)
            as? android.app.admin.DevicePolicyManager
            ?: return out.put("available", false)

        out.put("available", true)
        out.put("selfIsDeviceOwner", safe { dpm.isDeviceOwnerApp(ctx.packageName) } ?: false)
        out.put("selfIsProfileOwner", safe { dpm.isProfileOwnerApp(ctx.packageName) } ?: false)

        // Our Manager companion — the APK we would actually provision.
        val managerPkgs = listOf("com.educms.manager", "com.educms.manager.debug")
        val managerOwner = managerPkgs.firstOrNull { safe { dpm.isDeviceOwnerApp(it) } == true }
        out.put("managerIsDeviceOwner", managerOwner != null)
        managerOwner?.let { out.put("managerOwnerPackage", it) }

        // Who else might hold it? Test every package we can see.
        val holder = safe {
            installedPackages(ctx).firstOrNull { p -> dpm.isDeviceOwnerApp(p) }
        }
        out.put("deviceOwnerPackage", holder ?: JSONObject.NULL)
        out.put("deviceOwnerDetected", holder != null)

        // Active device admins on the box, whoever owns them.
        //
        // ⚠️ READ THIS COUNT CORRECTLY. A vendor CMS very often registers
        // its own plain admin without taking device owner, so
        // `activeAdminCount > 0` says NOTHING about what WE can do: the
        // force-lock policy behind `lockNow()` is scoped to the calling
        // package. The field that answers "can this Player really blank
        // the panel" is `selfIsActiveAdmin` below — never this count.
        val admins = JSONArray()
        safe { dpm.activeAdmins }?.forEach { admins.put(it.flattenToShortString()) }
        out.put("activeAdmins", admins)
        out.put("activeAdminCount", admins.length())

        // ── OUR OWN device-ADMIN enrolment (2026-08-14) ──────────────
        //
        // The one-tap tier. When `enrollment.state` is "not-enrolled" or
        // "declined", this screen's BLANK is stuck on the screen-timeout
        // or software-dim fallback and ONE operator tap
        // (`ACTION_ADD_DEVICE_ADMIN`, or the Settings > Security >
        // Device admin apps toggle) promotes it to a real panel-off
        // `lockNow()`. That is the fleet question this section exists to
        // answer without anyone walking to a screen.
        //
        // Read-only, like every other section here:
        // `DeviceAdminEnrollment.probeJson` deliberately does NOT settle
        // a pending prompt (that write belongs to MainActivity.onResume).
        //
        // NOTE for whoever wires the dashboard: the persisted server-side
        // document keeps only the 6 enum verdict fields
        // (`normalizeCapabilityReport` in apps/api), so this block rides
        // the on-demand `probeDisplay()` call, not the stored report. The
        // stored signal for "enrolled" is `verdict.screenBlank ==
        // "device-admin"`, which the registry already produces.
        out.put("selfIsActiveAdmin", safe { DeviceAdminEnrollment.isActiveAdmin(ctx) } ?: false)
        out.put("selfAdminComponent", safe { DeviceAdminEnrollment.adminComponent(ctx).flattenToShortString() })
        out.put("enrollment", safe { DeviceAdminEnrollment.probeJson(ctx) } ?: JSONObject())
        // Why an ENROLLED screen can still be on the fallback tier: a
        // PIN/pattern/password on the box makes `lockNow()` a one-way
        // blank (see DeviceAdminBlankProvider.secureKeyguardBlocks).
        // Without this field that box looks like an unexplained "we did
        // the tap and nothing changed".
        out.put("secureKeyguardBlocksBlank", safe { DeviceAdminBlankProvider.secureKeyguardBlocks(ctx) } ?: true)

        return out
    }

    /**
     * The Settings.System brightness path. Two independent unknowns:
     *   1. can we WRITE it (needs the WRITE_SETTINGS appop), and
     *   2. does writing it actually move the panel backlight — which is
     *      vendor-dependent and NOT answerable by reading. That one needs
     *      a supervised actuation test on a bench unit.
     */
    private fun brightnessSurface(ctx: Context): JSONObject {
        val out = JSONObject()
        val cr = ctx.contentResolver

        out.put("canWriteSettings", safe { Settings.System.canWrite(ctx) } ?: false)

        val values = JSONObject()
        KNOWN_SETTINGS.forEach { key ->
            val v = safe { Settings.System.getInt(cr, key) }
            values.put(key, v ?: JSONObject.NULL)
        }
        out.put("values", values)

        // Window-level brightness always works and needs no permission, but
        // it only dims OUR window's composition — on an LCD the backlight
        // stays lit, so it saves no power. On an emissive LED wall it does
        // genuinely reduce output. Recorded as an always-available floor.
        out.put("windowBrightnessAvailable", true)

        return out
    }

    /**
     * ── P2 (2026-08-25, v1.1.5) — DID THE PANEL ACTUALLY MOVE? ───────────
     *
     * A compact snapshot of every brightness value this uid can READ:
     * `Settings.System`'s brightness keys, and the `brightness` / `bl_power`
     * files under each known backlight node.
     *
     * ⚠️ READABLE IS NOT WRITABLE, AND THAT ASYMMETRY IS THE WHOLE POINT.
     * Several panels in this fleet (the G43 / Mobile A-Frame class) expose a
     * backlight node we can read but not write, and accept a
     * `Settings.System.SCREEN_BRIGHTNESS` write that changes nothing on the
     * glass. Both failure modes are SILENT — the write returns true, the
     * dashboard paints success, and the only way anyone found out was to
     * stand in front of the screen. Sampling this before and after an apply
     * turns "the operator says it did nothing" into a number that either
     * moved or did not, per hardware model, with nobody on site.
     *
     * Deliberately bounded and cheap: a handful of small reads, no
     * directory walks beyond the same [BACKLIGHT_PATHS] the probe already
     * uses, every one individually guarded. Called on the display-control
     * path, so it must never throw and never block.
     */
    fun brightnessSample(ctx: Context): JSONObject {
        val out = JSONObject()
        val cr = ctx.applicationContext.contentResolver
        val settings = JSONObject()
        KNOWN_SETTINGS.forEach { key ->
            settings.put(key, safe { Settings.System.getInt(cr, key) } ?: JSONObject.NULL)
        }
        out.put("settings", settings)

        val nodes = JSONObject()
        safe {
            BACKLIGHT_PATHS.forEach { base ->
                val dir = File(base)
                if (!dir.exists()) return@forEach
                val candidates =
                    if (dir.isDirectory && base.endsWith("backlight") && base.contains("class/backlight")) {
                        dir.listFiles()?.toList().orEmpty()
                    } else {
                        listOf(dir)
                    }
                candidates.forEach { node ->
                    listOf("brightness", "bl_power").forEach { name ->
                        val file = File(node, name)
                        if (file.exists() && file.canRead()) {
                            val v = safe { file.readText().trim().take(16) }
                            if (v != null) nodes.put("${node.absolutePath}/$name", v)
                        }
                    }
                }
            }
        }
        out.put("nodes", nodes)
        return out
    }

    /**
     * Kernel backlight nodes. `canRead`/`canWrite` here are the JVM's view
     * of the DAC + SELinux for OUR uid, which is exactly the question we
     * care about: could the Player itself drive this node?
     */
    private fun backlightNodes(): JSONArray {
        val arr = JSONArray()
        BACKLIGHT_PATHS.forEach { base ->
            val dir = File(base)
            if (!dir.exists()) return@forEach

            // /sys/class/backlight is a directory OF device dirs; the leds
            // and graphics paths are the device dir itself.
            val candidates = if (dir.isDirectory && base.endsWith("backlight") && base.contains("class/backlight")) {
                dir.listFiles()?.toList() ?: emptyList()
            } else {
                listOf(dir)
            }

            candidates.forEach { node ->
                val entry = JSONObject()
                entry.put("path", node.absolutePath)
                entry.put("exists", node.exists())
                listOf("brightness", "max_brightness", "bl_power", "blank").forEach { f ->
                    val file = File(node, f)
                    if (file.exists()) {
                        val fo = JSONObject()
                        fo.put("readable", file.canRead())
                        fo.put("writable", file.canWrite())
                        // The SAME gate the control layer applies. A node
                        // that is writable but not allowlisted is one the
                        // provider will refuse — reporting only
                        // `writable` is what let the probe and the
                        // registry disagree. `writable && allowlisted` is
                        // the honest "we could drive this" answer.
                        fo.put(
                            "allowlisted",
                            RecipeAllowlist.canonicalSysfsPath("${node.absolutePath}/$f") != null,
                        )
                        fo.put("value", safe { file.readText().trim().take(32) } ?: JSONObject.NULL)
                        entry.put(f, fo)
                    }
                }
                arr.put(entry)
            }
        }
        return arr
    }

    /**
     * Wildcard scan of Settings.System / .Secure / .Global for
     * vendor-invented keys. Chinese commercial-display vendors very often
     * expose brightness/standby/schedule as a Settings row instead of
     * shipping an SDK — which would make our integration a one-line
     * `Settings.System.putInt` behind the WRITE_SETTINGS appop.
     *
     * Reading the settings provider needs no permission. Writing does.
     */
    private fun vendorSettingsKeys(ctx: Context): JSONObject {
        val out = JSONObject()
        val namespaces = mapOf(
            "system" to Settings.System.CONTENT_URI,
            "secure" to Settings.Secure.CONTENT_URI,
            "global" to Settings.Global.CONTENT_URI,
        )
        namespaces.forEach { (name, uri) ->
            val hits = JSONObject()
            safe {
                ctx.contentResolver.query(uri, arrayOf("name", "value"), null, null, null)
            }?.use { c ->
                val ni = c.getColumnIndex("name")
                val vi = c.getColumnIndex("value")
                if (ni >= 0) {
                    while (c.moveToNext()) {
                        val k = c.getString(ni) ?: continue
                        val lower = k.lowercase()
                        if (SETTINGS_HEURISTIC.any { lower.contains(it) }) {
                            val v = if (vi >= 0) c.getString(vi) else null
                            hits.put(k, v?.take(64) ?: JSONObject.NULL)
                        }
                    }
                }
            }
            out.put(name, hits)
        }
        return out
    }

    @Suppress("DEPRECATION")
    private fun audioSurface(ctx: Context): JSONObject {
        val out = JSONObject()
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return out.put("available", false)
        out.put("available", true)

        val streams = mapOf(
            "music" to AudioManager.STREAM_MUSIC,
            "system" to AudioManager.STREAM_SYSTEM,
            "notification" to AudioManager.STREAM_NOTIFICATION,
            "alarm" to AudioManager.STREAM_ALARM,
        )
        val arr = JSONObject()
        streams.forEach { (name, id) ->
            val o = JSONObject()
            o.put("current", safe { am.getStreamVolume(id) } ?: JSONObject.NULL)
            o.put("max", safe { am.getStreamMaxVolume(id) } ?: JSONObject.NULL)
            arr.put(name, o)
        }
        out.put("streams", arr)
        out.put("wiredHeadsetOn", safe { am.isWiredHeadsetOn } ?: false)
        out.put("musicActive", safe { am.isMusicActive } ?: false)
        // Volume needs no permission at all — this is the one capability we
        // can ship today on every vendor with zero risk.
        out.put("controllable", true)
        return out
    }

    private fun powerSurface(ctx: Context): JSONObject {
        val out = JSONObject()
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return out.put("available", false)
        out.put("available", true)
        out.put("interactive", safe { pm.isInteractive } ?: JSONObject.NULL)
        out.put("powerSaveMode", safe { pm.isPowerSaveMode } ?: JSONObject.NULL)
        // HDMI-CEC: if the framework service exists we may be able to tell an
        // attached panel to sleep/wake even when the SoC has no backlight
        // control of its own. The control APIs are @SystemApi, so presence
        // here is a lead for the device-owner path, not a green light.
        out.put("hdmiControlService", safe { ctx.getSystemService("hdmi_control") } != null)
        return out
    }

    @Suppress("DEPRECATION")   // Display.getWidth/getHeight — fine for a report
    private fun displaySurface(ctx: Context): JSONObject {
        val out = JSONObject()
        val dm = ctx.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
            ?: return out.put("available", false)
        out.put("available", true)
        val arr = JSONArray()
        safe { dm.displays }?.forEach { d ->
            val o = JSONObject()
            o.put("id", d.displayId)
            o.put("name", d.name)
            o.put("state", d.state)
            o.put("width", safe { d.width } ?: JSONObject.NULL)
            o.put("height", safe { d.height } ?: JSONObject.NULL)
            o.put("refreshRate", safe { d.refreshRate.toDouble() } ?: JSONObject.NULL)
            arr.put(o)
        }
        out.put("displays", arr)
        return out
    }

    private fun systemFeatures(ctx: Context): JSONObject {
        val out = JSONObject()
        val pm = ctx.packageManager
        listOf(
            "android.hardware.hdmi.cec",
            "android.hardware.usb.host",
            "android.hardware.touchscreen",
            "android.software.leanback",
            "android.hardware.type.television",
            "android.software.device_admin",
        ).forEach { f ->
            out.put(f, safe { pm.hasSystemFeature(f) } ?: false)
        }
        return out
    }

    /**
     * Vendor control apps present on the box. On a release build, Android
     * 11+ package-visibility filtering means we only see what the manifest
     * `<queries>` block declares — `enumerable` reports which mode we're in
     * so a short list isn't mistaken for "no vendor apps installed".
     * The debug build holds QUERY_ALL_PACKAGES and sees everything.
     */
    private fun vendorPackages(ctx: Context): JSONObject {
        val out = JSONObject()
        val all = installedPackages(ctx)
        // Precise rather than heuristic: below API 30 there is no filtering,
        // at/above it we see everything only with QUERY_ALL_PACKAGES (debug
        // build only). Anything else is a `<queries>`-scoped partial view.
        val unfiltered = Build.VERSION.SDK_INT < VERSION_CODES.R ||
            safe {
                ctx.checkSelfPermission("android.permission.QUERY_ALL_PACKAGES") ==
                    PackageManager.PERMISSION_GRANTED
            } == true
        out.put("enumerable", unfiltered)
        out.put("visibleCount", all.size)
        val arr = JSONArray()
        all.filter { p -> VENDOR_PREFIXES.any { p.startsWith(it) } }
            .sorted()
            .forEach { arr.put(it) }
        out.put("candidates", arr)
        return out
    }

    /**
     * RS-232 is the boring path that always works: every commercial panel
     * documents a serial command set for power/brightness/input/volume. We
     * already ship a USB-serial bridge (built for CTS swim timing), so a
     * serial node here means a fully vendor-independent control path.
     */
    private fun serialSurface(ctx: Context): JSONObject {
        val out = JSONObject()
        val nodes = JSONArray()
        File("/dev").listFiles { f -> f.name.startsWith("ttyUSB") || f.name.startsWith("ttyACM") || f.name.startsWith("ttyS") }
            ?.forEach { f ->
                nodes.put(JSONObject().apply {
                    put("path", f.absolutePath)
                    put("readable", f.canRead())
                    put("writable", f.canWrite())
                })
            }
        out.put("devNodes", nodes)

        val usb = ctx.getSystemService(Context.USB_SERVICE) as? UsbManager
        val devices = JSONArray()
        safe { usb?.deviceList }?.values?.forEach { d ->
            devices.put(JSONObject().apply {
                put("vendorId", d.vendorId)
                put("productId", d.productId)
                put("deviceName", d.deviceName)
                put("interfaceCount", safe { d.interfaceCount } ?: JSONObject.NULL)
            })
        }
        out.put("usbDevices", devices)
        return out
    }

    // ─────────────────────────────────────────────────────────────────
    // verdict — collapse the raw findings into what we can actually ship
    // ─────────────────────────────────────────────────────────────────

    /**
     * ⚠️ THE ONE RESOLVER. `DisplayControlRegistry` decides which
     * mechanism actually drives each capability; this section reports its
     * answer verbatim so the probe and the control layer cannot disagree.
     *
     * They USED to. The probe stat-ed `/sys/class/backlight/<dev>/
     * brightness` with `File.canWrite()` and reported `brightness:
     * "sysfs"`, while [SysfsBacklightProvider] additionally pushed the
     * same path through [RecipeAllowlist.canonicalSysfsPath] and dropped
     * it. Result: the dashboard lit up a real backlight slider on a box
     * whose BRIGHTNESS had silently fallen to software dim — "coming
     * soon wearing a real-button costume", from two code paths that a
     * comment claimed agreed "by construction". Deriving the verdict
     * from the registry is what makes that claim true.
     *
     * Still read-only: every `supports()` in the chain is a stat, a
     * prefs read or a `canWrite()` — the registry never drives the panel
     * to answer this.
     */
    private fun resolvedControl(ctx: Context): JSONObject {
        val out = JSONObject()
        val caps = JSONObject()
        DisplayControlRegistry.capabilities(ctx.applicationContext).forEach { (capability, providerId) ->
            caps.put(capability.name, providerId)
        }
        out.put("capabilities", caps)
        out.put("minSafeBrightness", DisplayLimits.MIN_SAFE_BRIGHTNESS)
        out.put("emergencyHold", DisplayEmergency.isHeld(ctx))
        return out
    }

    /**
     * Per-capability answer of the form: can we drive this TODAY on this
     * box, and by which mechanism. This is what the dashboard should key
     * its per-screen control UI off.
     *
     * ⚠️ The verdict names the MECHANISM, never whether the capability
     * exists. BRIGHTNESS, BLANK and WAKE ALWAYS resolve, because the
     * software floor cannot fail — so `screenBlank` is never `"none"`,
     * and a dashboard that hides the blank/wake buttons when it sees
     * `software-dim` is reading this wrong. REBOOT is the one capability
     * that genuinely can be absent, and on a non-device-owner fleet it
     * always is.
     *
     * ═════════════════════════════════════════════════════════════════
     * ⚠️ THE VOCABULARY IS `DisplayControlProvider.id`. NOTHING ELSE.
     * ═════════════════════════════════════════════════════════════════
     * Contract C5 (2026-08-14): the DEVICE's provider ids are
     * authoritative, and the server's zod enums are widened to accept
     * them. So the throw-fallback arms below emit the SAME strings the
     * registry would — `"sysfs-backlight"`, not `"sysfs"` — because a
     * verdict that speaks two vocabularies depending on whether
     * resolution threw is a 400 waiting to happen on the one screen
     * where it matters. The exhaustive set this method can emit:
     *
     * ```
     * volume        "audiomanager" | "none"
     * brightness    "vendor-recipe" | "sysfs-backlight" | "settings" | "software-dim"
     * screenBlank   "vendor-recipe" | "device-admin" | "screen-timeout" | "software-dim"
     * reboot        "device-owner" | "none"
     * hardPowerOff  "serial-candidate" | "none"          (no provider — probe-only)
     * deviceOwnerPath "held" | "blocked-other-owner" | "provisionable-after-factory-reset"
     * ```
     */
    private fun verdict(root: JSONObject): JSONObject {
        val v = JSONObject()
        // Registry-resolved answers, when the section landed. The raw
        // heuristics below are the fallback for a box where resolution
        // itself threw — never a second opinion.
        val resolved = root.optJSONObject("control")?.optJSONObject("capabilities")

        // Volume — AudioManager, no permission, every Android box.
        val audioOk = root.optJSONObject("audio")?.optBoolean("available") == true
        v.put(
            "volume",
            resolved?.optString("VOLUME")?.ifEmpty { null }
                ?: if (audioOk) AudioManagerProvider.id else CAPABILITY_NONE,
        )

        // Brightness — best available mechanism, most-real first.
        val nodes = root.optJSONArray("backlightNodes") ?: JSONArray()
        var writableNode = false
        for (i in 0 until nodes.length()) {
            val n = nodes.optJSONObject(i) ?: continue
            if (n.optJSONObject("brightness")?.optBoolean("writable") == true) writableNode = true
        }
        val canWriteSettings = root.optJSONObject("brightness")?.optBoolean("canWriteSettings") == true
        v.put(
            "brightness",
            resolved?.optString("BRIGHTNESS")?.ifEmpty { null } ?: when {
                // SysfsBacklightProvider.id — NOT the bare "sysfs" this
                // used to emit. See the vocabulary note above.
                writableNode -> SysfsBacklightProvider.id
                canWriteSettings -> SettingsBrightnessProvider.id
                else -> SoftwareDimProvider.id   // always available; dims composition only
            }
        )

        val admin = root.optJSONObject("admin")
        val isDo = admin?.optBoolean("managerIsDeviceOwner") == true ||
            admin?.optBoolean("selfIsDeviceOwner") == true

        // Screen blank/wake — ALWAYS available; this names the mechanism.
        v.put("screenBlank", resolved?.optString("BLANK")?.ifEmpty { null } ?: SoftwareDimProvider.id)

        // Reboot — device owner ONLY. No fallback exists at any privilege
        // level, and we deliberately do not take device owner, so on
        // today's fleet the registry omits it entirely.
        val resolvedReboot = resolved?.optString("REBOOT")?.ifEmpty { null }
        v.put(
            "reboot",
            resolvedReboot ?: when {
                resolved != null -> CAPABILITY_NONE
                isDo -> DeviceOwnerRebootProvider.id
                else -> CAPABILITY_NONE
            },
        )

        // Hard power-off — no public Android API at any privilege level.
        // Vendor service, RS-232 or CEC, or nothing.
        val serialNodes = root.optJSONObject("serial")?.optJSONArray("devNodes")?.length() ?: 0
        v.put("hardPowerOff", if (serialNodes > 0) HARD_POWER_OFF_SERIAL else CAPABILITY_NONE)

        // Can we even take device owner, if we don't have it?
        val doHeld = admin?.optBoolean("deviceOwnerDetected") == true
        v.put(
            "deviceOwnerPath", when {
                isDo -> "held"
                doHeld -> "blocked-other-owner"
                else -> "provisionable-after-factory-reset"
            }
        )

        return v
    }

    // ─────────────────────────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────────────────────────

    /** Enumerate visible packages; empty list rather than throwing. */
    private fun installedPackages(ctx: Context): List<String> = safe {
        ctx.packageManager.getInstalledPackages(0).mapNotNull { it.packageName }
    } ?: emptyList()

    /**
     * Run one section under its own guard. A section that blows up on an
     * odd ROM records the error and the rest of the report still lands —
     * a partial probe is worth far more than an exception.
     */
    private inline fun section(root: JSONObject, name: String, body: () -> Any) {
        try {
            root.put(name, body())
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "section '$name' failed: ${t.message}")
            root.put(name, JSONObject().put("error", t.message ?: t.javaClass.simpleName))
        }
    }

    /** Swallow anything a single probe call can throw; null means "unknown". */
    private inline fun <T> safe(body: () -> T): T? = try {
        body()
    } catch (t: Throwable) {
        null
    }
}
