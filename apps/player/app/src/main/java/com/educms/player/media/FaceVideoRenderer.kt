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
 *
 * Protocol 3 (2026-10-12) adds two modes on the same decoder loop:
 *  • [holdFirst]: the first picture is rendered at once and HELD — the clock
 *    does not start until [release] (the page's `play`), so a pre-rolled
 *    next slide waits behind the page with its first frame already on its
 *    surface, and the hand-off costs no decode latency;
 *  • [loop] = false: the clip plays ONCE; at end-of-stream [ended] fires and
 *    the decoder is kept idle (not released) so the surface keeps the LAST
 *    picture until the session is stopped — the next slide fades in over it.
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
    private val loop: Boolean = true,
    private val holdFirst: Boolean = false,
    private val firstFrame: () -> Unit = {},
    private val ended: () -> Unit = {},
) {
    private val stopped = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    @Volatile private var released = !holdFirst
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
            val hardwareAvc = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { info ->
                !info.isEncoder && SharedVideoCodecPolicy.hardwareName(info.name) &&
                    info.supportedTypes.any { it.equals("video/avc", true) }
            }
            // Strict first. Then the size-and-rate check in EITHER orientation:
            // Amlogic decoders advertise landscape sizes (≤ 4096×2304) and fail
            // isFormatSupported for a portrait 2160×3338 stream that the very same
            // decoder plays in the WebView (field 2026-10-12, M43 + L55VEC). A real
            // decode failure still ends the session; the page then stays on web.
            val fps = d.fps.toDouble()
            val info = hardwareAvc.firstOrNull { info ->
                runCatching { info.getCapabilitiesForType("video/avc").isFormatSupported(format) }.getOrDefault(false)
            } ?: hardwareAvc.firstOrNull { info ->
                runCatching {
                    val v = info.getCapabilitiesForType("video/avc").videoCapabilities
                    v.areSizeAndRateSupported(d.width, d.height, fps) || v.areSizeAndRateSupported(d.height, d.width, fps)
                }.getOrDefault(false)
            } ?: hardwareAvc.firstOrNull { info ->
                // Rockchip decoders only report sizes aligned to 16, so a
                // 1080×1668 portrait copy "fails" the size check while the same
                // decoder plays it in the WebView (field 2026-10-13, DH43
                // rk3288 Android 7). Accept it when the 16-aligned size fits in
                // either orientation — a native signage player (Goodview) never
                // asks at all. A real decode failure still ends the session.
                runCatching {
                    val v = info.getCapabilitiesForType("video/avc").videoCapabilities
                    val aw = (d.width + 15) / 16 * 16
                    val ah = (d.height + 15) / 16 * 16
                    v.isSizeSupported(aw, ah) || v.isSizeSupported(ah, aw)
                }.getOrDefault(false)
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

    /** Protocol 3: let a held first frame go — the clock starts now. */
    fun release() { released = true }

    fun stop() { stopped.set(true); released = true }

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
            // A decoder the box cannot open right now (another session holds
            // the hardware, a transient OMX refusal) is not a fault of the file.
            val c = try {
                MediaCodec.createByCodecName(codecName ?: error("codec-not-prepared")).also { codec = it }
            } catch (e: IllegalStateException) { throw IllegalStateException("decoder-unavailable", e) }
                catch (e: java.io.IOException) { throw IllegalStateException("decoder-unavailable", e) }
            try {
                c.configure(format, surface, null, 0)
                c.setOnFrameRenderedListener({ own, pts, nanos ->
                    if (own === c && !stopped.get() && current() && surface.isValid) rendered(nanos, pts)
                }, callbacks)
                c.start(); c.setVideoScalingMode(FaceVideoPolicy.scalingMode(d.fit))
            } catch (e: MediaCodec.CodecException) { throw IllegalStateException(if (e.isTransient || e.isRecoverable) "decoder-unavailable" else "codec-failed", e) }
                catch (e: IllegalStateException) { throw IllegalStateException("decoder-unavailable", e) }
            val frameUs = (1_000_000.0 / d.fps).toLong().coerceAtLeast(1)
            val frameNs = frameUs * 1000
            val timeline = LoopTimeline(frameUs)
            val info = MediaCodec.BufferInfo()
            var originNs = 0L; var firstPts = 0L; var previousDropped = false
            var inputDone = false; var heldOnce = false
            var lastProgress = SystemClock.elapsedRealtime()
            while (!stopped.get() && current()) {
                require(surface.isValid) { "output-detached" }
                val input = if (inputDone) -1 else c.dequeueInputBuffer(10_000)
                if (input >= 0) {
                    val buffer = c.getInputBuffer(input) ?: error("codec-input")
                    var size = extractor.readSampleData(buffer, 0)
                    if (size < 0 && loop) {
                        // End of this lap on INPUT: rewind and keep feeding.
                        require(timeline.wrap()) { "empty-lap" }
                        extractor.seekTo(0, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                        looped()
                        size = extractor.readSampleData(buffer, 0)
                        require(size >= 0) { "empty-lap" }
                    }
                    if (size < 0) {
                        // Play once: tell the decoder the clip is over, then drain.
                        c.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        c.queueInputBuffer(input, 0, size, timeline.queue(extractor.sampleTime), 0)
                        extractor.advance()
                    }
                }
                val index = c.dequeueOutputBuffer(info, 10_000)
                if (index >= 0) {
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    if (SharedVideoCodecPolicy.render(info.size, info.flags)) {
                        if (holdFirst && !heldOnce) {
                            // First picture: show it now, then wait for the page's `play`.
                            heldOnce = true
                            c.releaseOutputBuffer(index, true)
                            firstFrame()
                            while (!released && !stopped.get() && current()) Thread.sleep(5)
                            check(!stopped.get() && current()) { "session-retired" }
                            originNs = System.nanoTime(); firstPts = info.presentationTimeUs
                            lastProgress = SystemClock.elapsedRealtime()
                        } else {
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
                        }
                    } else c.releaseOutputBuffer(index, false)
                    if (eos) {
                        // The last picture stays on the surface; the decoder idles until stop.
                        ended()
                        while (!stopped.get() && current()) Thread.sleep(50)
                        return
                    }
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
