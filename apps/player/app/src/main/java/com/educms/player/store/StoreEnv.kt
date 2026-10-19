package com.educms.player.store

import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

internal interface StoreClock {
    fun nowMs(): Long
    fun sleep(ms: Long)
}

/**
 * The faces' canonical device credentials, READ-ONLY (rule 3: one token store
 * per side, written only by server-accepted mints — never by the store).
 */
internal interface StoreCredentials {
    /** Every face that may hold a credential (0, or 0 and 1 on a double-sided unit). */
    fun faces(): List<Int>
    fun token(face: Int): String?
    /** The persisted API origin (`https://host`, validated), or null. */
    fun apiBase(): String?
}

internal interface StoreDisk {
    fun usableBytes(dir: File): Long
    /** The file's inode (0 when it cannot be read). Part of a verification record (§5.4). */
    fun inode(file: File): Long
    /** A hard link (zero copy), used to adopt USB files without taking them from the USB interceptor. */
    fun link(from: File, to: File): Boolean
}

/**
 * Everything the store needs from the outside world, injected so every rule is
 * JVM-testable with a fake clock, a fake HTTP server and a temp directory.
 */
internal class StoreEnv(
    val clock: StoreClock,
    val http: StoreHttp,
    val credentials: StoreCredentials,
    val disk: StoreDisk,
    /** The screen a device token names (`NativeAlertWatchPolicy.screenIdOf`), or null. */
    val screenIdOf: (String?) -> String?,
    /** The API host allowlist (`HostAllowlist.isApiHost`): the ONLY host a device token is ever sent to. */
    val apiHostAllowed: (String) -> Boolean,
    /** The storage allowlist (`SharedVideoSourcePolicy.allowed`): the only host bytes are fetched from. */
    val storageAllowed: (String) -> Boolean,
    /** The device class allows native-first at all (the class table's `nativeFirst`; stream B's DeviceClassPolicy). */
    val classAllows: () -> Boolean = { true },
    /**
     * Whether a face's authenticated (non-emergency) manifest enrols it in native-first
     * (`PLAYER_NATIVE_FIRST`, stream C). Ships DARK: absent = not enrolled.
     */
    val enrolledBy: (JSONObject) -> Boolean = { it.optBoolean("nativeFirst", false) },
    val verifyBytesPerSec: Long = StorePolicy.VERIFY_BYTES_PER_SEC,
    val log: (String) -> Unit = {},
)

/**
 * Streamed SHA-256 of the bytes ON DISK, 64 KiB at a time, never a whole-file
 * buffer, rate-limited so a verify never starves playback reads. [keepGoing]
 * is polled per block (an emergency pre-empts a content verify).
 */
internal class DiskHasher(private val clock: StoreClock, private val bytesPerSec: Long) {
    private val hashed = java.util.concurrent.atomic.AtomicInteger()

    /** Files hashed by this process (tests read it: "a reboot re-hashes nothing"). */
    val hashedFiles: Int get() = hashed.get()

    fun sha256(file: File, keepGoing: () -> Boolean = { true }): String? {
        val digest = MessageDigest.getInstance("SHA-256")
        val start = clock.nowMs()
        FileInputStream(file).use { input ->
            var total = 0L
            val block = ByteArray(64 * 1024)
            while (true) {
                if (!keepGoing()) return null
                val n = input.read(block)
                if (n < 0) break
                digest.update(block, 0, n)
                total += n
                if (bytesPerSec > 0) {
                    val due = total * 1000L / bytesPerSec
                    val elapsed = clock.nowMs() - start
                    if (due > elapsed) clock.sleep(due - elapsed)
                }
            }
        }
        hashed.incrementAndGet()
        return Hashing.hex(digest.digest())
    }
}
