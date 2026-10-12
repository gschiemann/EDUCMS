package com.educms.player.media

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ONE face, ONE verified file, ONE hardware decoder straight into that face's
 * own Surface — protocol 2 (see FaceVideoPolicy.kt). [prepare] only inspects
 * the file and picks a hardware AVC decoder; no codec is allocated until the
 * page has surrendered its own HTML decoder and committed ([start]), so the
 * box never holds more decoders than it did before the hand-off.
 *
 * Repetition is SEAMLESS: no end-of-stream, no flush, no re-prime — the
 * extractor rewinds and the next lap is queued on a continuing timeline
 * ([LoopTimeline]). Any exception ends the session; the page then plays the
 * same file in the browser (automatic fallback).
 */
internal class FaceVideoRenderer(
    private val file: File,
    private val d: FaceVideoDescriptor,
    private val surface: Surface,
    private val degrees: Int,
    private val current: () -> Boolean,
    private val failed: (String) -> Unit,
    private val rendered: (Long, Long) -> Unit,
    private val looped: () -> Unit,
    private val dropped: () -> Unit,
) {
    private val stopped = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    private val callbacks = Handler(Looper.getMainLooper())
    var codecName: String? = null; private set
    /** The decoder's own advertised concurrent-instance limit (0 = unknown). */
    var advertisedInstances: Int = 0; private set

    /** Throws a reason code on anything this box cannot play natively. */
    fun prepare() {
        check(!stopped.get() && current()) { "session-retired" }
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            val format = extractor.getTrackFormat(videoTrack(extractor))
            validate(format)
            val info = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
                !info.isEncoder && SharedVideoCodecPolicy.hardwareName(info.name) &&
                    info.supportedTypes.any { it.equals("video/avc", true) } &&
                    runCatching { info.getCapabilitiesForType("video/avc").isFormatSupported(format) }.getOrDefault(false)
            } ?: error("hardware-codec-unavailable")
            codecName = info.name
            advertisedInstances = runCatching { info.getCapabilitiesForType("video/avc").maxSupportedInstances }.getOrDefault(0)
        } finally { extractor.release() }
        check(!stopped.get() && current()) { "session-retired" }
    }

    fun start() {
        if (stopped.get() || !started.compareAndSet(false, true)) return
        Thread({ decode() }, "native-video-face-${d.faceIndex}").apply { isDaemon = true; start() }
    }

    fun stop() { stopped.set(true) }

    private fun videoTrack(e: MediaExtractor): Int = (0 until e.trackCount).firstOrNull {
        e.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == "video/avc"
    } ?: error("avc-track")

    private fun validate(format: MediaFormat) {
        require(format.getInteger(MediaFormat.KEY_WIDTH) == d.width &&
            format.getInteger(MediaFormat.KEY_HEIGHT) == d.height) { "coded-size" }
        require(!format.containsKey(MediaFormat.KEY_ROTATION) || format.getInteger(MediaFormat.KEY_ROTATION) == 0) { "container-rotation" }
    }

    private fun decode() {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            check(!stopped.get() && current()) { "session-retired" }
            extractor.setDataSource(file.absolutePath)
            val track = videoTrack(extractor); extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track); validate(format)
            // Clockwise output rotation onto THIS face's physical panel.
            format.setInteger(MediaFormat.KEY_ROTATION, degrees)
            val c = MediaCodec.createByCodecName(codecName ?: error("codec-not-prepared")); codec = c
            c.configure(format, surface, null, 0)
            c.setOnFrameRenderedListener({ own, pts, nanos ->
                if (own === c && !stopped.get() && current() && surface.isValid) rendered(nanos, pts)
            }, callbacks)
            c.start(); c.setVideoScalingMode(FaceVideoPolicy.scalingMode(d.fit))
            val frameUs = (1_000_000.0 / d.fps).toLong().coerceAtLeast(1)
            val frameNs = frameUs * 1000
            val timeline = LoopTimeline(frameUs)
            val info = MediaCodec.BufferInfo()
            var originNs = 0L; var firstPts = 0L; var previousDropped = false
            var lastProgress = SystemClock.elapsedRealtime()
            while (!stopped.get() && current()) {
                require(surface.isValid) { "output-detached" }
                val input = c.dequeueInputBuffer(10_000)
                if (input >= 0) {
                    val buffer = c.getInputBuffer(input) ?: error("codec-input")
                    var size = extractor.readSampleData(buffer, 0)
                    if (size < 0) {
                        // End of this lap on INPUT: rewind and keep feeding.
                        require(timeline.wrap()) { "empty-lap" }
                        extractor.seekTo(0, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                        looped()
                        size = extractor.readSampleData(buffer, 0)
                        require(size >= 0) { "empty-lap" }
                    }
                    c.queueInputBuffer(input, 0, size, timeline.queue(extractor.sampleTime), 0)
                    extractor.advance()
                }
                val index = c.dequeueOutputBuffer(info, 10_000)
                if (index >= 0) {
                    if (SharedVideoCodecPolicy.render(info.size, info.flags)) {
                        if (originNs == 0L) { originNs = System.nanoTime(); firstPts = info.presentationTimeUs }
                        val due = originNs + (info.presentationTimeUs - firstPts) * 1000
                        while (!stopped.get() && current() && due - System.nanoTime() > 2_000_000L) Thread.sleep(1)
                        check(!stopped.get() && current()) { "session-retired" }
                        val now = System.nanoTime()
                        if (FaceVideoPolicy.shouldDrop(now - due, frameNs, previousDropped)) {
                            c.releaseOutputBuffer(index, false); previousDropped = true; dropped()
                        } else {
                            c.releaseOutputBuffer(index, maxOf(due, now)); previousDropped = false
                        }
                        lastProgress = SystemClock.elapsedRealtime()
                    } else c.releaseOutputBuffer(index, false)
                }
                require(SystemClock.elapsedRealtime() - lastProgress < 15_000) { "codec-stalled" }
            }
        } catch (e: Exception) {
            if (!stopped.get()) { stop(); failed(FaceVideoReasons.code(e, "codec-failed")) }
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }; runCatching { extractor.release() }
        }
    }
}

/** Exception → a bounded diagnostic code. Never native exception text, URLs or credentials. */
internal object FaceVideoReasons {
    private val code = Regex("[a-z0-9-]{1,64}")
    fun code(e: Throwable, fallback: String): String = e.message?.takeIf { code.matches(it) } ?: fallback
}
