package com.educms.player.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Heat and load facts: every number bounded, every unreadable input → omitted. */
class DeviceLoadMathTest {

    @Test fun processCpuIsShareOfAllCoresAndBounded() {
        assertEquals(25, DeviceLoadMath.cpuPercent(cpuMs = 1_000, wallMs = 1_000, cores = 4))
        assertEquals(100, DeviceLoadMath.cpuPercent(cpuMs = 9_000, wallMs = 1_000, cores = 4))
        assertEquals(0, DeviceLoadMath.cpuPercent(cpuMs = 0, wallMs = 60_000, cores = 8))
        assertNull(DeviceLoadMath.cpuPercent(cpuMs = 10, wallMs = 0, cores = 4))
        assertNull(DeviceLoadMath.cpuPercent(cpuMs = -1, wallMs = 10, cores = 4))
        assertNull(DeviceLoadMath.cpuPercent(cpuMs = 10, wallMs = 10, cores = 0))
    }

    @Test fun procStatDeltasGiveTheWholeDevicesShare() {
        val a = DeviceLoadMath.parseProcStat("cpu  100 0 100 700 100 0 0 0 0 0")!!
        val b = DeviceLoadMath.parseProcStat("cpu  200 0 200 1300 100 0 0 0 0 0")!!
        // +200 busy of +800 total.
        assertEquals(25, DeviceLoadMath.systemCpuPercent(a, b))
        assertNull("a counter reset is not a sample", DeviceLoadMath.systemCpuPercent(b, a))
        assertNull(DeviceLoadMath.parseProcStat("cpu0 1 2 3 4"))
        assertNull(DeviceLoadMath.parseProcStat("intr 1 2 3"))
        assertNull(DeviceLoadMath.parseProcStat(null))
        assertNull(DeviceLoadMath.parseProcStat("cpu  1 2"))
    }

    @Test fun thermalZonesInMilliOrWholeDegreesAndImplausibleOnesDropped() {
        assertEquals(61, DeviceLoadMath.zoneCelsius(61_000))
        assertEquals(61, DeviceLoadMath.zoneCelsius(61))
        assertEquals(-5, DeviceLoadMath.zoneCelsius(-5_000))
        assertNull(DeviceLoadMath.zoneCelsius(400_000))
        assertNull(DeviceLoadMath.zoneCelsius(-273_000))
        assertNull("deci-degrees from a battery zone are not °C", DeviceLoadMath.zoneCelsius(999))
    }

    @Test fun headroomIsRoundedAndNaNIsUnknown() {
        assertEquals(0.42, DeviceLoadMath.headroom(0.4231f)!!, 1e-9)
        assertEquals(10.0, DeviceLoadMath.headroom(42f)!!, 1e-9)
        assertNull(DeviceLoadMath.headroom(Float.NaN))
        assertNull(DeviceLoadMath.headroom(-1f))
        assertNull(DeviceLoadMath.headroom(Float.POSITIVE_INFINITY))
    }

    @Test fun memoryInMegabytesBounded() {
        assertEquals(2048, DeviceLoadMath.megabytes(2048L * 1024 * 1024))
        assertEquals(0, DeviceLoadMath.megabytes(1000))
        assertNull(DeviceLoadMath.megabytes(-1))
        assertEquals(1_048_576, DeviceLoadMath.megabytes(Long.MAX_VALUE))
    }
}
