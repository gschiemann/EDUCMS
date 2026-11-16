package com.educms.player.diagnostics

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.educms.player.logging.PlayerLogger

/**
 * The panel's hardware serial — the Android glue (2026-11-16). Every rule is
 * in [HardwareSerialPolicy] (pure, `HardwareSerialPolicyTest`).
 *
 * Read ONCE per process, lazily, from the native heartbeat's IO thread — never
 * at boot, never on the main thread — and carried in its own header on the
 * signed heartbeat only (`HeartbeatService`), so a fault here can cost nothing
 * else. Never throws, never asks for a permission. Failure direction: nothing
 * readable → `{"v":1,"src":"none"}` → the dashboard says "Not available".
 */
object HardwareSerial {

    private const val TAG = "HardwareSerial"

    @Volatile private var cached: HardwareSerialPolicy.Result? = null

    fun headerValue(ctx: Context): String = HardwareSerialPolicy.headerValue(result(ctx))

    fun result(ctx: Context): HardwareSerialPolicy.Result {
        cached?.let { return it }
        val r = try {
            HardwareSerialPolicy.read(sources(ctx.applicationContext))
        } catch (_: Throwable) {
            HardwareSerialPolicy.Result(null, "none")
        }
        cached = r
        // The value itself is never logged — the source is enough to diagnose.
        PlayerLogger.i(TAG, "hardware serial source=${r.source} found=${r.serial != null}")
        return r
    }

    // HardwareIds: reading the serial is this object's whole purpose.
    // MissingPermission: getSerial() is only reached when we are device owner or
    // READ_PHONE_STATE is already granted; any SecurityException is caught.
    @SuppressLint("HardwareIds", "MissingPermission", "PrivateApi")
    private fun sources(ctx: Context) = HardwareSerialPolicy.Sources(
        sdkInt = Build.VERSION.SDK_INT,
        isDeviceOwner = {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            dpm?.isDeviceOwnerApp(ctx.packageName) == true
        },
        hasReadPhoneState = {
            ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        },
        getSerial = { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Build.getSerial() else null },
        legacySerial = {
            @Suppress("DEPRECATION")
            Build.SERIAL
        },
        property = { key ->
            val cls = Class.forName("android.os.SystemProperties")
            cls.getMethod("get", String::class.java).invoke(null, key) as? String
        },
    )
}
