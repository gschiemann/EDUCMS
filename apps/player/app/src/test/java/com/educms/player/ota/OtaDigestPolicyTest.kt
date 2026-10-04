package com.educms.player.ota

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class OtaDigestPolicyTest {
    @Test fun `a well-formed sha256 is acceptable in either case`() {
        assertTrue(OtaDigestPolicy.acceptable("a".repeat(64)))
        assertTrue(OtaDigestPolicy.acceptable("0123456789ABCDEF".repeat(4)))
    }

    @Test fun `no digest, a short one or a non-hex one is refused`() {
        assertFalse(OtaDigestPolicy.acceptable(null))
        assertFalse(OtaDigestPolicy.acceptable(""))
        assertFalse(OtaDigestPolicy.acceptable("abc123"))
        assertFalse(OtaDigestPolicy.acceptable("g".repeat(64)))
        assertFalse(OtaDigestPolicy.acceptable("a".repeat(65)))
    }

    @Test fun `the worker refuses before it downloads, and never skips verification`() {
        val src = File("src/main/java/com/educms/player/ota/OtaUpdateWorker.kt").readText()
        val refuse = src.indexOf("OtaDigestPolicy.acceptable(expectedSha)")
        val download = src.indexOf("getExternalFilesDir(null), \"updates\"")
        assertTrue("the digest gate exists", refuse > 0)
        assertTrue("and runs before the download directory is even opened", download > refuse)
        assertFalse("verification is unconditional", src.contains("if (expectedSha.isNotEmpty())"))
    }
}
