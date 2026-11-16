package com.educms.player.diagnostics

/**
 * THE PANEL'S HARDWARE SERIAL NUMBER — the pure half (2026-11-16).
 *
 * Android hides the serial from ordinary apps, and this fleet takes no device
 * owner (product decision 2026-08-13, `DeviceOwnerRebootProvider`), so this is
 * BEST EFFORT. [read] tries, in order, and records which one answered:
 *
 *   1. `device-owner` — `Build.getSerial()`, only when THIS package is device
 *      owner (API 26+). Not true on today's fleet; free if it ever is.
 *   2. `build-serial` — `Build.SERIAL`, below Android 8 only (on 8+ it reads
 *      "unknown" for an app targeting 28+, which we do). The Android 7.1
 *      Rockchip class.
 *   3. `get-serial`   — `Build.getSerial()` on Android 8–9 when READ_PHONE_STATE
 *      is already granted. The manifest does not declare that permission (no
 *      runtime prompt on an unattended screen, ever), so this rung is dormant
 *      unless a future build adds it.
 *   4. `prop:<key>`   — `android.os.SystemProperties.get` for [PROPERTY_KEYS].
 *      AOSP's SELinux policy denies `ro.serialno` / `ro.boot.serialno` to
 *      untrusted apps from Android 10; vendor builds differ, so this is the
 *      rung that decides Android 9, 11 and 13 panels — on the glass, not here.
 *
 * Every value is trimmed and must be printable ASCII, 1–[MAX_LEN] characters
 * and not a placeholder (`unknown`, `0123456789ABCDEF`, one repeated
 * character…) — the API applies the same rules again. Nothing usable →
 * `Result(null, "none")`. Every rung is caught: a SecurityException, a missing
 * method or a hostile ROM only moves on to the next one. No Android import, so
 * the JVM test covers all of it.
 */
object HardwareSerialPolicy {

    const val HEADER = "x-venueos-hardware-serial"
    const val MAX_LEN = 64

    /** Read in this order; vendor keys are candidates, unverified on our fleet. */
    val PROPERTY_KEYS = listOf(
        "ro.serialno",
        "ro.boot.serialno",
        "ro.vendor.serialno",
        "persist.sys.serialno",
        "ril.serialnumber",
    )

    private val PLACEHOLDERS = setOf(
        "unknown", "null", "none", "n/a", "na", "undefined", "default", "serial", "serialno",
        "0123456789abcdef", "0123456789", "1234567890", "1234567890abcdef", "abcdef0123456789",
    )

    /** What the device can be asked; every lambda may throw. */
    class Sources(
        val sdkInt: Int,
        val isDeviceOwner: () -> Boolean,
        val hasReadPhoneState: () -> Boolean,
        /** `Build.getSerial()` (API 26+). */
        val getSerial: () -> String?,
        /** `Build.SERIAL`. */
        val legacySerial: () -> String?,
        /** `SystemProperties.get(key)`. */
        val property: (String) -> String?,
    )

    data class Result(val serial: String?, val source: String)

    fun isPlaceholder(value: String): Boolean {
        val v = value.trim().lowercase()
        if (v.isEmpty()) return true
        if (v in PLACEHOLDERS) return true
        return v.all { it == v[0] }
    }

    /** The serial as reported, or null when it is not a usable one. */
    fun normalize(raw: String?): String? {
        val v = raw?.trim() ?: return null
        if (v.isEmpty() || v.length > MAX_LEN) return null
        if (!v.all { it.code in 0x20..0x7E }) return null
        if (isPlaceholder(v)) return null
        return v
    }

    private inline fun attempt(block: () -> String?): String? =
        try { normalize(block()) } catch (_: Throwable) { null }

    private inline fun check(block: () -> Boolean): Boolean =
        try { block() } catch (_: Throwable) { false }

    fun read(src: Sources): Result {
        if (src.sdkInt >= 26 && check(src.isDeviceOwner)) {
            attempt(src.getSerial)?.let { return Result(it, "device-owner") }
        }
        if (src.sdkInt < 26) {
            attempt(src.legacySerial)?.let { return Result(it, "build-serial") }
        }
        if (src.sdkInt in 26..28 && check(src.hasReadPhoneState)) {
            attempt(src.getSerial)?.let { return Result(it, "get-serial") }
        }
        for (key in PROPERTY_KEYS) {
            attempt { src.property(key) }?.let { return Result(it, "prop:$key") }
        }
        return Result(null, "none")
    }

    /** The header body: `{"v":1,"s":"…","src":"…"}`, or `{"v":1,"src":"none"}`. */
    fun headerValue(result: Result): String {
        val serial = result.serial?.let { normalize(it) }
        return if (serial == null) {
            "{\"v\":1,\"src\":\"none\"}"
        } else {
            "{\"v\":1,\"s\":\"${jsonEscape(serial)}\",\"src\":\"${jsonEscape(result.source)}\"}"
        }
    }

    /** Values are printable ASCII already; only the quote and backslash need escaping. */
    private fun jsonEscape(v: String): String = v.replace("\\", "\\\\").replace("\"", "\\\"")
}
