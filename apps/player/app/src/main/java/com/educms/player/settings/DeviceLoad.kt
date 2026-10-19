package com.educms.player.settings

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import androidx.annotation.RequiresApi
import java.io.File

/**
 * HEAT AND LOAD, AS FACTS (2026-10-18, lead's scope addition): so stutter from
 * a hot or starved box is visible on the dashboard before it shows on the
 * glass. READ ONLY — nothing here is acted on, by this unit or the server.
 *
 * Numbers only, every one bounded ([DeviceLoadMath]); no string the device
 * makes up ever leaves it (a thermal zone's name is not reported). Each fact
 * is read on its own and simply omitted when this unit will not give it:
 *   • Android's thermal status (API 29+) and the time it last changed, and
 *     its 10-second thermal headroom forecast (API 30+);
 *   • the player process's CPU share since the previous report;
 *   • the whole device's CPU share, where `/proc/stat` is readable (it is not
 *     for apps on most Android 8+ builds);
 *   • available / total memory and Android's low-memory flag;
 *   • the hottest readable `/sys/class/thermal/thermal_zone<N>/temp`, when the
 *     vendor exposes one.
 */
object DeviceLoad {

    private const val MAX_ZONES = 16

    @Volatile private var lastProcCpuMs: Long = -1L
    @Volatile private var lastProcAtMs: Long = -1L
    @Volatile private var lastStat: DeviceLoadMath.CpuTicks? = null

    fun sample(ctx: Context): DeviceLoadMath.Load {
        val app = ctx.applicationContext
        var load = DeviceLoadMath.Load()
        val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null) {
            load = load.copy(
                thermalStatus = safe { Api29Thermal.status(pm) }?.takeIf { it in 0..6 },
                thermalChangedAtMs = Api29Thermal.lastChangeWallMs(pm),
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && pm != null) {
            load = load.copy(headroom = safe { DeviceLoadMath.headroom(Api30Thermal.headroom(pm)) })
        }

        // The player process: CPU time since the previous sample over wall
        // time, shared across the cores. The first sample uses the process's
        // whole life, which is honest about what it is (an average).
        safe {
            val nowMs = SystemClock.elapsedRealtime()
            val cpuMs = Process.getElapsedCpuTime()
            val prevCpu = lastProcCpuMs
            val prevAt = lastProcAtMs
            val (dCpu, dWall) = if (prevCpu >= 0 && prevAt in 0 until nowMs) {
                (cpuMs - prevCpu) to (nowMs - prevAt)
            } else {
                cpuMs to (nowMs - Process.getStartElapsedRealtime())
            }
            lastProcCpuMs = cpuMs
            lastProcAtMs = nowMs
            DeviceLoadMath.cpuPercent(dCpu, dWall, Runtime.getRuntime().availableProcessors())
        }?.let { load = load.copy(processCpuPercent = it) }

        safe { DeviceLoadMath.parseProcStat(File("/proc/stat").bufferedReader().use { it.readLine() }) }
            ?.let { ticks ->
                val prev = lastStat
                lastStat = ticks
                if (prev != null) DeviceLoadMath.systemCpuPercent(prev, ticks)?.let { load = load.copy(systemCpuPercent = it) }
            }

        safe {
            val am = app.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return@safe null
            ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        }?.let { mi ->
            load = load.copy(
                memAvailMb = DeviceLoadMath.megabytes(mi.availMem),
                memTotalMb = DeviceLoadMath.megabytes(mi.totalMem),
                memLow = mi.lowMemory,
            )
        }

        safe {
            val readings = (0 until MAX_ZONES).mapNotNull { i ->
                val f = File("/sys/class/thermal/thermal_zone$i/temp")
                if (!f.exists() || !f.canRead()) null
                else safe { DeviceLoadMath.zoneCelsius(f.readText().trim().take(12).toLong()) }
            }
            if (readings.isEmpty()) null else readings
        }?.let { load = load.copy(socCelsius = it.maxOrNull(), thermalZones = it.size) }

        return load
    }

    private inline fun <T> safe(body: () -> T): T? = try {
        body()
    } catch (t: Throwable) {
        null
    }
}

/** API 29 symbols, isolated so an older ART never resolves them (see `Api31SilentInstall`). */
@RequiresApi(Build.VERSION_CODES.Q)
internal object Api29Thermal {
    @Volatile private var changedAtWallMs: Long? = null
    @Volatile private var lastSeen: Int? = null
    @Volatile private var listening = false

    fun status(pm: PowerManager): Int = pm.currentThermalStatus

    /**
     * Wall time of the last thermal status CHANGE seen since this process
     * started, or null. Android calls a new listener at once with the current
     * status; that first call is a reading, not a change, so it only seeds
     * [lastSeen].
     */
    fun lastChangeWallMs(pm: PowerManager): Long? {
        if (!listening) {
            synchronized(this) {
                if (!listening) {
                    runCatching {
                        pm.addThermalStatusListener { status ->
                            val prev = lastSeen
                            if (prev != null && prev != status) changedAtWallMs = System.currentTimeMillis()
                            lastSeen = status
                        }
                        listening = true
                    }
                }
            }
        }
        return changedAtWallMs
    }
}

@RequiresApi(Build.VERSION_CODES.R)
internal object Api30Thermal {
    /** Android's forecast 10 s ahead: 0 = no throttling, 1.0 = the severe threshold. NaN = unsupported. */
    fun headroom(pm: PowerManager): Float = pm.getThermalHeadroom(10)
}

/** The pure half: every bound and every conversion, tested on a JVM (`DeviceLoadMathTest`). */
object DeviceLoadMath {

    data class Load(
        /** `PowerManager.THERMAL_STATUS_*`: 0 none … 6 shutdown. */
        val thermalStatus: Int? = null,
        val thermalChangedAtMs: Long? = null,
        /** 0.00 … 10.00. */
        val headroom: Double? = null,
        val processCpuPercent: Int? = null,
        val systemCpuPercent: Int? = null,
        val memAvailMb: Int? = null,
        val memTotalMb: Int? = null,
        val memLow: Boolean? = null,
        val socCelsius: Int? = null,
        val thermalZones: Int? = null,
    )

    data class CpuTicks(val busy: Long, val total: Long)

    fun cpuPercent(cpuMs: Long, wallMs: Long, cores: Int): Int? {
        if (cpuMs < 0 || wallMs <= 0 || cores <= 0) return null
        return Math.round(100.0 * cpuMs / (wallMs.toDouble() * cores)).toInt().coerceIn(0, 100)
    }

    /** The aggregate `cpu` line of `/proc/stat`: user nice system idle iowait irq softirq steal … */
    fun parseProcStat(line: String?): CpuTicks? {
        if (line == null || !line.startsWith("cpu ")) return null
        val v = line.substring(4).trim().split(Regex("\\s+")).mapNotNull { it.toLongOrNull() }
        if (v.size < 4) return null
        val idle = v[3] + (v.getOrNull(4) ?: 0L)
        val total = v.take(8).sum()
        return CpuTicks(busy = total - idle, total = total)
    }

    fun systemCpuPercent(prev: CpuTicks, now: CpuTicks): Int? {
        val dTotal = now.total - prev.total
        val dBusy = now.busy - prev.busy
        if (dTotal <= 0 || dBusy < 0) return null
        return Math.round(100.0 * dBusy / dTotal).toInt().coerceIn(0, 100)
    }

    fun megabytes(bytes: Long): Int? =
        if (bytes < 0) null else (bytes / (1024L * 1024L)).coerceAtMost(1_048_576L).toInt()

    /**
     * A thermal zone's `temp`. Kernels report milli-°C (61000) and a few
     * report °C (61); anything outside −40…150 °C is not a SoC temperature
     * (a battery zone in deci-°C, a disabled zone) and is dropped.
     */
    fun zoneCelsius(raw: Long): Int? {
        val c = if (raw > 1000 || raw < -1000) raw / 1000.0 else raw.toDouble()
        return if (c in -40.0..150.0) Math.round(c).toInt() else null
    }

    fun headroom(raw: Float): Double? =
        if (raw.isNaN() || raw.isInfinite() || raw < 0f) null
        else Math.round(raw.toDouble().coerceAtMost(10.0) * 100.0) / 100.0
}
