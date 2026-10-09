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

/** Direct native output per face, avoiding browser/GL copies.
 * Prepare inspects the file/capabilities only. Both HTML players must commit
 * before either native decoder is allocated. One failed output retires the pair.
 */
internal class SharedVideoRenderer(
    private val file: File,
    private val descriptor: SharedVideoDescriptor,
    private val outputs: List<Output>,
    private val current: () -> Boolean,
    private val ready: () -> Unit,
    private val failed: (String) -> Unit,
    private val codecInfo: (Int, String) -> Unit,
    private val looped: (Int) -> Unit,
) {
    data class Output(val surface: Surface, val width: Int, val height: Int,
        val descriptor: SharedVideoDescriptor, val rendered: (Long, Long, Long) -> Unit)
    private val stopped = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    private val callbacks = Handler(Looper.getMainLooper())
    private val codecNames = mutableMapOf<Int,String>()

    fun prepare() {
        try {
            checkCurrent()
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(file.absolutePath)
                val format = extractor.getTrackFormat(videoTrack(extractor))
                validate(format)
                for (output in outputs) {
                    require(output.surface.isValid && output.width > 0 && output.height > 0)
                    codecNames[output.descriptor.faceIndex] = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
                        !info.isEncoder && SharedVideoCodecPolicy.hardwareName(info.name) &&
                            info.supportedTypes.any { it.equals("video/avc",true) } &&
                            runCatching { info.getCapabilitiesForType("video/avc").isFormatSupported(format) }.getOrDefault(false)
                    }?.name ?: error("hardware-codec-unavailable")
                }
            } finally { extractor.release() }
            checkCurrent(); ready()
        } catch (_: Exception) { fail("native-prepare") }
    }

    fun start() {
        if (!started.compareAndSet(false,true) || stopped.get()) return
        outputs.forEach { output -> Thread({ decode(output) },"native-video-face-${output.descriptor.faceIndex}")
            .apply { isDaemon = true; start() } }
    }
    private fun videoTrack(e: MediaExtractor): Int = (0 until e.trackCount).firstOrNull {
        e.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == "video/avc"
    } ?: error("avc-track")
    private fun validate(format: MediaFormat) {
        require(format.getInteger(MediaFormat.KEY_WIDTH) == descriptor.width &&
            format.getInteger(MediaFormat.KEY_HEIGHT) == descriptor.height) { "coded-size" }
        require(!format.containsKey(MediaFormat.KEY_ROTATION) || format.getInteger(MediaFormat.KEY_ROTATION) == 0) { "container-rotation" }
    }
    private fun decode(output: Output) {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            checkCurrent(); extractor.setDataSource(file.absolutePath)
            val track = videoTrack(extractor); extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track); validate(format)
            // Public API: clockwise output rotation, separate from container rotation (zero in v1).
            format.setInteger(MediaFormat.KEY_ROTATION,SharedVideoTransform.degrees(
                output.descriptor.orientation,output.descriptor.rotation,output.width,output.height))
            val c = MediaCodec.createByCodecName(codecNames[output.descriptor.faceIndex] ?: error("codec-not-prepared")); codec = c
            codecInfo(output.descriptor.faceIndex,c.name); c.configure(format,output.surface,null,0)
            c.setOnFrameRenderedListener({ own,pts,nanos ->
                if (own === c && !stopped.get() && current() && output.surface.isValid) output.rendered(nanos,pts,0)
            },callbacks)
            c.start(); c.setVideoScalingMode(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT)
            val info = MediaCodec.BufferInfo()
            var inputDone = false; var originNs = 0L; var firstPts = 0L
            var lastProgress = SystemClock.elapsedRealtime()
            while (!stopped.get() && current()) {
                require(output.surface.isValid) { "output-detached" }
                if (!inputDone) {
                    val index = c.dequeueInputBuffer(10_000)
                    if (index >= 0) {
                        val buffer = c.getInputBuffer(index) ?: error("codec-input")
                        val size = extractor.readSampleData(buffer,0)
                        if (size < 0) {
                            c.queueInputBuffer(index,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
                        } else { c.queueInputBuffer(index,0,size,extractor.sampleTime,0); extractor.advance() }
                    }
                }
                val index = c.dequeueOutputBuffer(info,10_000)
                if (index >= 0) {
                    if (SharedVideoCodecPolicy.render(info.size,info.flags)) {
                        if (originNs == 0L) { originNs = System.nanoTime(); firstPts = info.presentationTimeUs }
                        val due = originNs + (info.presentationTimeUs-firstPts)*1000
                        while (!stopped.get() && current() && due-System.nanoTime() > 2_000_000L) Thread.sleep(1)
                        checkCurrent(); c.releaseOutputBuffer(index,maxOf(due,System.nanoTime()))
                        lastProgress = SystemClock.elapsedRealtime()
                    } else c.releaseOutputBuffer(index,false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        extractor.seekTo(0,MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                        c.flush(); inputDone = false; originNs = 0L; looped(output.descriptor.faceIndex)
                    }
                }
                require(SystemClock.elapsedRealtime()-lastProgress < 15_000) { "codec-stalled" }
            }
        } catch (_: Exception) { if (!stopped.get()) fail("codec-failed") }
        finally { runCatching { codec?.stop() }; runCatching { codec?.release() }; runCatching { extractor.release() } }
    }
    fun stop() { stopped.set(true) }
    private fun fail(reason: String) { stop(); failed(reason) }
    private fun checkCurrent() { check(!stopped.get() && current()) { "session-retired" } }
}

internal object SharedVideoCodecPolicy {
    /** Surface output can have size zero. Empty EOS and codec config are not frames. */
    fun render(size: Int,flags: Int): Boolean = flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 &&
        (flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM == 0 || size > 0)
    fun hardwareName(name: String): Boolean {
        val n = name.lowercase()
        return (n.startsWith("omx.") || n.startsWith("c2.")) &&
            !n.startsWith("omx.google.") && !n.startsWith("c2.android.") && !n.contains(".sw.")
    }
}
