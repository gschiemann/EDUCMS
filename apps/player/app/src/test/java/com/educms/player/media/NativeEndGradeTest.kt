package com.educms.player.media

import com.educms.player.media.NativeEndGrade.Grade
import org.junit.Assert.*
import org.junit.Test

/**
 * FAILURE GRADING, PHASE 0 (1.1.43; design §3.4, owner decision D7): every
 * end code the engine can emit has one grade, and only a real fault of a
 * verified file on this decoder may block native for a day. The page keeps
 * the same table (nativeSharedVideo.ts); its test reads this file.
 */
class NativeEndGradeTest {
    /** Every code the engine's sources emit, as the design's table grades it. */
    private val expected: Map<String, Grade> = mapOf(
        // The box, the page or the content moved on.
        "emergency-held" to Grade.TRANSIENT, "activity-paused" to Grade.TRANSIENT, "host-detached" to Grade.TRANSIENT,
        "document-retired" to Grade.TRANSIENT, "content-changed" to Grade.TRANSIENT, "peer-stopped" to Grade.TRANSIENT,
        "page-stopped" to Grade.TRANSIENT, "engine-switched" to Grade.TRANSIENT, "page-lease-expired" to Grade.TRANSIENT,
        "credential-changed" to Grade.TRANSIENT, "session-retired" to Grade.TRANSIENT, "selection-changed" to Grade.TRANSIENT,
        "superseded" to Grade.TRANSIENT, "skipped" to Grade.TRANSIENT, "hold-expired" to Grade.TRANSIENT,
        "decoder-budget" to Grade.TRANSIENT, "decoder-unavailable" to Grade.TRANSIENT, "output-detached" to Grade.TRANSIENT,
        "display-mode-reverted" to Grade.TRANSIENT, "host-replaced" to Grade.TRANSIENT,
        // Network, storage, authorization, manifest: never a verdict on the file.
        "authorization-failed" to Grade.NOT_READY, "credential-missing" to Grade.NOT_READY, "credential-identity" to Grade.NOT_READY,
        "api-root" to Grade.NOT_READY, "api-origin" to Grade.NOT_READY, "manifest-http-500" to Grade.NOT_READY,
        "manifest-http-503" to Grade.NOT_READY, "manifest-http-401" to Grade.NOT_READY, "manifest-too-large" to Grade.NOT_READY,
        "manifest-unreachable" to Grade.NOT_READY, "timeout" to Grade.NOT_READY, "source-failed" to Grade.NOT_READY,
        "media-http-502" to Grade.NOT_READY, "media-http-404" to Grade.NOT_READY, "media-redirect" to Grade.NOT_READY,
        "media-incomplete" to Grade.NOT_READY, "media-size" to Grade.NOT_READY, "media-publish" to Grade.NOT_READY,
        "media-cache-unavailable" to Grade.NOT_READY, "media-cache-corrupt" to Grade.NOT_READY, "media-cache-quota" to Grade.NOT_READY,
        "media-missing" to Grade.NOT_READY, "media-origin" to Grade.NOT_READY, "not-in-store" to Grade.NOT_READY,
        "store-full" to Grade.NOT_READY, "descriptor-version" to Grade.NOT_READY, "descriptor-identity" to Grade.NOT_READY,
        "descriptor-format" to Grade.NOT_READY, "descriptor-slot" to Grade.NOT_READY,
        // This box or this layout, never the file: web for this document.
        "composition-unavailable" to Grade.BOX, "protocol3-disabled" to Grade.BOX, "zone-overlap" to Grade.BOX, "protocol" to Grade.BOX,
        // A real fault of a verified file on this decoder.
        "codec-failed" to Grade.FAULT, "codec-stalled" to Grade.FAULT, "codec-input" to Grade.FAULT, "codec-not-prepared" to Grade.FAULT,
        "hardware-codec-unavailable" to Grade.FAULT, "output-stalled" to Grade.FAULT, "output-unavailable" to Grade.FAULT,
        "media-digest" to Grade.FAULT, "avc-track" to Grade.FAULT, "coded-size" to Grade.FAULT, "container-rotation" to Grade.FAULT,
        "empty-lap" to Grade.FAULT, "native-prepare" to Grade.FAULT,
    )

    @Test fun everyCodeInTheTableHasItsGrade() {
        for ((code, grade) in expected) assertEquals(code, grade, NativeEndGrade.grade(code))
        // Only faults block; transient and not-ready retry; a box verdict does neither.
        for ((code, grade) in expected) {
            assertEquals(code, grade == Grade.FAULT, NativeEndGrade.blocks(code))
            assertEquals(code, grade == Grade.TRANSIENT || grade == Grade.NOT_READY, NativeEndGrade.retries(code))
            assertEquals(code, grade == Grade.TRANSIENT || grade == Grade.NOT_READY, FaceVideoPolicy.transient(code))
        }
    }

    @Test fun anOfflineBootLeavesNoBlock() {
        // The manifest read fails offline: `FaceVideoReasons.code(e, "authorization-failed")` for an IOException
        // with free-text (the fallback), `timeout` for a SocketTimeoutException (its message IS a code).
        assertEquals("authorization-failed", FaceVideoReasons.code(java.io.IOException("Unable to resolve host \"api.example\""), "authorization-failed"))
        assertEquals("timeout", FaceVideoReasons.code(java.net.SocketTimeoutException("timeout"), "authorization-failed"))
        assertEquals("source-failed", FaceVideoReasons.code(java.net.ConnectException("Failed to connect to /10.0.0.1:443"), "source-failed"))
        for (offline in listOf("authorization-failed", "timeout", "source-failed", "manifest-http-503", "media-http-502", "media-incomplete", "credential-missing", "media-missing")) {
            assertFalse("$offline must never block native for a day", NativeEndGrade.blocks(offline))
            assertTrue("$offline is retried", NativeEndGrade.retries(offline))
        }
        // A short download is the network's (`media-incomplete`); only a full-length body with the wrong digest is the file's.
        assertEquals(Grade.NOT_READY, NativeEndGrade.grade("media-incomplete"))
        assertEquals(Grade.FAULT, NativeEndGrade.grade("media-digest"))
    }

    @Test fun aWebViewCrashThatReplacesTheHostRestartsNativeAndNeverBlocks() {
        // A renderer crash recreates the face's WebView, and FaceVideoBox.attach ends every session of the old host
        // `host-replaced`. Ungraded, that fell into FAULT: one plain WebView crash blocked native on the file for a
        // day. It is the box moving on — retried like any transient end, never a block.
        assertEquals(Grade.TRANSIENT, NativeEndGrade.grade("host-replaced"))
        assertTrue(NativeEndGrade.retries("host-replaced"))
        assertTrue(FaceVideoPolicy.transient("host-replaced"))
        assertFalse("a WebView crash must never block native on the file for a day", NativeEndGrade.blocks("host-replaced"))
        // … and it is the very code the engine emits on a host replacement.
        val box = generateSequence(java.io.File("").absoluteFile) { it.parentFile }
            .flatMap { sequenceOf(java.io.File(it, "src/main/java/com/educms/player/media/FaceVideoBox.kt"),
                java.io.File(it, "app/src/main/java/com/educms/player/media/FaceVideoBox.kt")) }
            .firstOrNull { it.isFile }
        org.junit.Assume.assumeTrue("FaceVideoBox.kt not on disk", box != null)
        assertTrue(box!!.readText().contains("stopSession(old, it, \"host-replaced\")"))
    }

    @Test fun theUnknownFailsClosedAndTheSetsAreDisjoint() {
        // No reason at all is transient (the page retries); a code nobody classified is a FAULT, so a new end code
        // must be graded here before it ships — never silently retried forever.
        assertEquals(Grade.TRANSIENT, NativeEndGrade.grade(null)); assertEquals(Grade.TRANSIENT, NativeEndGrade.grade(""))
        assertEquals(Grade.FAULT, NativeEndGrade.grade("something-new"))
        assertTrue(NativeEndGrade.blocks("something-new"))
        // The prefixes match families, not their names alone.
        assertEquals(Grade.NOT_READY, NativeEndGrade.grade("manifest-http-418")); assertEquals(Grade.FAULT, NativeEndGrade.grade("manifest-http"))
        val all = listOf(NativeEndGrade.TRANSIENT, NativeEndGrade.NOT_READY, NativeEndGrade.BOX, NativeEndGrade.FAULT)
        for (i in all.indices) for (j in all.indices) if (i != j) assertTrue("sets $i and $j overlap: ${all[i] intersect all[j]}", (all[i] intersect all[j]).isEmpty())
        for (set in all) for (code in set) assertTrue(code, Regex("^[a-z0-9-]{1,64}$").matches(code))
        for (prefix in NativeEndGrade.NOT_READY_PREFIXES) assertTrue(prefix, prefix.endsWith("-"))
        // Every code the engine emits is in the table (a grep of the sources is the web test's job; here the known ones).
        assertTrue(expected.keys.all { NativeEndGrade.grade(it) != Grade.FAULT || it in NativeEndGrade.FAULT })
    }
}
