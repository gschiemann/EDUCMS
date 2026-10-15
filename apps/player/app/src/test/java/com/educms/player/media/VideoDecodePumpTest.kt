package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

class VideoDecodePumpTest {
    @Test fun delayedCodecMaintainsCadenceAndRecoversFromASchedulerHitch() {
        data class Packet(val ptsUs: Long, val readyNs: Long)
        val queued = java.util.ArrayDeque<Packet>()
        val clock = VideoFrameSchedule(33_333, 60f)
        var now = 1_000_000_000L
        var lastDecodeNs = now
        var inputPtsUs = 0L
        var submitted = 0
        var dropped = 0
        var maximumQueued = 0
        val pump = VideoDecodePump(
            feed = {
                if (queued.size == 8) false else {
                    lastDecodeNs = maxOf(lastDecodeNs, now) + 5_000_000
                    queued.add(Packet(inputPtsUs, lastDecodeNs))
                    inputPtsUs += 33_333
                    maximumQueued = maxOf(maximumQueued, queued.size)
                    true
                }
            },
            drain = {
                val packet = queued.peek()
                if (packet == null || packet.readyNs > now) false else {
                    val due = clock.due(packet.ptsUs, now)
                    if (due - now > clock.leadNs) false else {
                        clock.observe(due, now)
                        if (clock.shouldDrop(due, now)) dropped++ else {
                            clock.submitted(now, maxOf(due, now)); submitted++
                        }
                        queued.remove()
                        true
                    }
                }
            })
        // Five seconds, including one 300ms thread scheduling pause.
        repeat(4700) {
            if (it == 1000) now += 300_000_000
            pump.step()
            now += 1_000_000
        }
        assertTrue("bounded input queue", maximumQueued <= 8)
        assertTrue("real-time throughput recovers", submitted in 135..155)
        assertTrue("discard stale backlog, not every other later frame", dropped in 1..12)
        assertEquals("no continuing clock debt", 0L, clock.lastLateUs)
    }

    @Test fun fullInputNeverPreventsReadyOutputFromDraining() {
        var inputs = 4
        var decoded = 0
        val pump = VideoDecodePump(
            feed = { if (inputs < 4) { inputs++; true } else false },
            drain = { if (inputs > 0) { inputs--; decoded++; true } else false })
        repeat(20) { assertTrue(pump.step()) }
        assertEquals(80, decoded)
    }

    @Test fun reorderDecoderGetsSeveralPacketsBeforeItMustProduceAFrame() {
        var packets = 0
        var frames = 0
        val pump = VideoDecodePump(
            feed = { if (packets < 4) { packets++; true } else false },
            drain = { if (packets >= 3) { packets--; frames++; true } else false })
        repeat(11) { pump.step() }
        assertEquals(20, frames)
    }

    @Test fun pendingEarlyOutputStillAllowsInputFeedingAndWorkIsBounded() {
        var fed = 0
        var drained = 0
        val pump = VideoDecodePump({ fed++; true }, { drained++; false })
        assertTrue(pump.step())
        assertEquals(8, fed)
        assertEquals(1, drained)
        assertFalse(VideoDecodePump({ false }, { false }).step())
    }

    @Test fun sixtyHertzSurfaceGetsTwoVsyncsOfLeadWithoutChangingDueTimes() {
        val clock = VideoFrameSchedule(33_333, 60f)
        val start = 1_000_000_000L
        assertEquals(start, clock.due(0, start))
        assertEquals(33_333_333L, clock.leadNs)
        val due = clock.due(33_333, start + 1_000_000)
        assertEquals(start + 33_333_000L, due)
        assertTrue(due - (start + 1_000_000) <= clock.leadNs)
        assertEquals(due, clock.due(33_333, start + 500_000_000))
        assertEquals(50_000_000L, VideoFrameSchedule(33_333, 30f).leadNs)
        assertEquals(clock.leadNs, VideoFrameSchedule(33_333, Float.NaN).leadNs)
    }

    @Test fun transientLateQueueCatchesUpWithoutAlternatingLateRendersOrClockRebase() {
        for (stallMs in listOf(150L, 300L, 500L)) {
            val clock = VideoFrameSchedule(33_333, 60f)
            val start = 1_000_000_000L
            clock.start(0, start)
            val now = start + stallMs * 1_000_000
            var drops = 0
            var rendered = 0
            for (i in 1..20) {
                val due = clock.due(i * 33_333L, now)
                if (due - now > clock.leadNs) break
                clock.observe(due, now)
                if (clock.shouldDrop(due, now)) drops++
                else { clock.submitted(now); rendered++ }
            }
            assertTrue("a backlog should be discarded at $stallMs ms", drops > 0)
            assertTrue("don't render every other stale frame", rendered <= 5)
            val recovered = clock.due(1_000_000, start + 1_000_000_000)
            assertEquals(start + 1_000_000_000, recovered)
            assertFalse(clock.shouldDrop(recovered, start + 1_000_000_000))
        }
    }

    @Test fun persistentlySlowDecoderCannotDropEveryVisibleFrameForever() {
        val clock = VideoFrameSchedule(33_333, 60f)
        clock.start(0, 1_000_000_000)
        assertTrue(clock.shouldDrop(1_000_000_000, 1_200_000_000))
        assertFalse(clock.shouldDrop(1_000_000_000, 1_250_000_000))
        clock.submitted(1_250_000_000)
        assertTrue(clock.shouldDrop(1_000_000_000, 1_260_000_000))
    }

    @Test fun emptyEosWaitsForFutureLastPictureAndItsFullFramePeriod() {
        val clock = VideoFrameSchedule(33_333, 60f)
        val now = 1_000_000_000L
        val target = now + 30_000_000
        clock.start(0, now)
        clock.submitted(now, target)
        val eosDeadline = clock.endDeadline(now)
        assertEquals(target + 33_333_000, eosDeadline)
        assertTrue(now < eosDeadline)
        assertTrue(target < eosDeadline)
        // No frames: EOS has no future presentation to wait for.
        assertEquals(now, VideoFrameSchedule(33_333, 60f).endDeadline(now))
    }
}
