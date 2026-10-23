package com.educms.player.usb

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.zip.ZipFile
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * USB playlist packages — the pure half (2026-10-22, Greg: "our app auto
 * senses when someone puts the USB stick in and reads our playlist and retains
 * all the settings … none of this works at all").
 *
 * No Android imports: everything here runs in a JVM unit test against real
 * files and real zips (UsbPackageTest). [UsbAutoImport] is the Android glue
 * that finds the stick, asks this code to import, and tells the page.
 *
 * What a package is (built by the API, `POST /usb-export/bundle`):
 *
 *   edu-cms-content/manifest.json   schema 'edu-cms-usb-bundle/v1'
 *   edu-cms-content/manifest.sig    HMAC-SHA256(manifest.json, tenant key), hex
 *   edu-cms-content/assets/<sha256>.<ext>
 *
 * on the stick either as that FOLDER or as the downloaded .zip — the operator
 * never has to unzip. Nothing is copied until the signature, the tenant and
 * every path have been checked; every file is SHA-256 verified as it is
 * copied; a package that fails anywhere changes nothing on the device; a good
 * one replaces the previous import in one rename.
 */
object UsbPackage {
    const val SCHEMA = "edu-cms-usb-bundle/v1"
    const val FOLDER = "edu-cms-content"
    const val CACHE_DIR = "usb-cache"
    const val MAX_MANIFEST_BYTES = 16L * 1024 * 1024
    const val MAX_ASSETS = 4096
    /** Free space kept back after an import, so the stick can never fill the box. */
    const val SPACE_MARGIN_BYTES = 256L * 1024 * 1024

    private val LOCAL_PATH = Regex("^(assets|emergency)/([0-9a-f]{64})\\.([a-z0-9]{1,5})$")
    private val KEY_HEX = Regex("^[0-9a-fA-F]{64}$")

    fun isKey(hex: String?): Boolean = hex != null && KEY_HEX.matches(hex)

    /** Bundle versions are epoch-ms strings; compare as numbers when they are. */
    fun compareVersions(a: String, b: String): Int {
        val x = a.toLongOrNull()
        val y = b.toLongOrNull()
        return if (x != null && y != null) x.compareTo(y) else a.compareTo(b)
    }

    /** `assets/<sha>.<ext>` whose name IS its digest, else null. */
    fun safeLocalPath(localPath: String, sha256: String): String? {
        val m = LOCAL_PATH.matchEntire(localPath) ?: return null
        return if (m.groupValues[2] == sha256.lowercase()) localPath else null
    }

    fun hmacHex(keyHex: String, data: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(hexToBytes(keyHex), "HmacSHA256"))
        return toHex(mac.doFinal(data))
    }

    fun constantTimeEq(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    internal fun hexToBytes(hex: String): ByteArray {
        require(isKey(hex)) { "key must be 64 hex characters" }
        return ByteArray(hex.length / 2) { i -> ((Character.digit(hex[i * 2], 16) shl 4) + Character.digit(hex[i * 2 + 1], 16)).toByte() }
    }

    internal fun toHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }
}

/** A package on the stick: a folder or a zip. Paths are relative to `edu-cms-content/`. */
interface UsbBundleSource : AutoCloseable {
    /** Stable identity of what was read (so a stick left in is not re-read every minute). */
    val identity: String
    fun open(relativePath: String): InputStream?
    override fun close() {}

    companion object {
        /** A folder named `edu-cms-content`, or a .zip that holds one; null otherwise. */
        fun open(candidate: File): UsbBundleSource? = when {
            candidate.isDirectory -> DirBundleSource.of(candidate)
            candidate.isFile && candidate.name.lowercase().endsWith(".zip") -> ZipBundleSource.of(candidate)
            else -> null
        }
    }
}

class DirBundleSource private constructor(private val root: File) : UsbBundleSource {
    private val rootPath = root.canonicalPath + File.separator
    override val identity: String = "dir:${root.path}|${File(root, "manifest.json").let { "${it.length()}|${it.lastModified()}" }}"

    override fun open(relativePath: String): InputStream? {
        val f = runCatching { File(root, relativePath).canonicalFile }.getOrNull() ?: return null
        if (!f.path.startsWith(rootPath) || !f.isFile) return null
        return runCatching { f.inputStream() }.getOrNull()
    }

    companion object {
        fun of(dir: File): DirBundleSource? =
            if (File(dir, "manifest.json").isFile) DirBundleSource(dir) else null
    }
}

class ZipBundleSource private constructor(private val file: File, private val zip: ZipFile, private val prefix: String) : UsbBundleSource {
    override val identity: String = "zip:${file.path}|${file.length()}|${file.lastModified()}"

    override fun open(relativePath: String): InputStream? {
        if (relativePath.contains("..")) return null
        val entry = zip.getEntry(prefix + relativePath) ?: return null
        if (entry.isDirectory) return null
        return zip.getInputStream(entry)
    }

    override fun close() { runCatching { zip.close() } }

    companion object {
        /** The zip, when it holds `…edu-cms-content/manifest.json` (at the top or one folder down). */
        fun of(file: File): ZipBundleSource? {
            val zip = runCatching { ZipFile(file) }.getOrNull() ?: return null
            val marker = "${UsbPackage.FOLDER}/manifest.json"
            var prefix: String? = null
            val entries = zip.entries()
            var seen = 0
            while (entries.hasMoreElements() && seen < 20_000) {
                val name = entries.nextElement().name
                seen++
                if (name == marker || (name.endsWith("/$marker") && name.count { it == '/' } == 2)) {
                    prefix = name.removeSuffix("manifest.json")
                    break
                }
            }
            if (prefix == null) { runCatching { zip.close() }; return null }
            return ZipBundleSource(file, zip, prefix)
        }
    }
}

/** Where a package might be on a mounted stick. Bounded: a stick full of photos costs a few listings. */
object UsbPackageFinder {
    private const val MAX_ENTRIES = 400
    private const val MAX_SUBDIRS = 40

    fun candidates(volumeRoots: List<File>): List<File> {
        val out = ArrayList<File>()
        for (root in volumeRoots) {
            scanDir(root, out)
            val subdirs = (root.listFiles() ?: emptyArray()).asSequence()
                .take(MAX_ENTRIES)
                .filter { it.isDirectory && !it.name.startsWith(".") && it.name != UsbPackage.FOLDER }
                .take(MAX_SUBDIRS)
            for (d in subdirs) scanDir(d, out)
        }
        return out.distinctBy { it.path }
    }

    private fun scanDir(dir: File, out: MutableList<File>) {
        val bundle = File(dir, UsbPackage.FOLDER)
        if (File(bundle, "manifest.json").isFile) out.add(bundle)
        val entries = dir.listFiles() ?: return
        entries.asSequence().take(MAX_ENTRIES)
            .filter { it.isFile && !it.name.startsWith(".") && it.name.lowercase().endsWith(".zip") }
            .forEach { out.add(it) }
    }
}

/**
 * Verify + import. [filesDir] is the app's private storage; the live import is
 * `filesDir/usb-cache/` (what [UsbCacheIndex] and the page read).
 */
class UsbImporter(private val filesDir: File, private val freeBytes: (File) -> Long = { it.usableSpace }) {

    sealed class Verdict {
        class Ok(
            val manifestBytes: ByteArray,
            val bundleVersion: String,
            val assets: List<Asset>,
        ) : Verdict()
        class Rejected(val outcome: String, val reason: String) : Verdict()
    }

    class Asset(val sha256: String, val localPath: String, val sizeBytes: Long)

    sealed class Outcome {
        class Imported(val bundleVersion: String, val assetCount: Int, val totalBytes: Long, val emergencyAssets: Int) : Outcome()
        class AlreadyCurrent(val bundleVersion: String) : Outcome()
        class Rejected(val outcome: String, val reason: String) : Outcome()
    }

    private val live get() = File(filesDir, UsbPackage.CACHE_DIR)

    /** The bundle version currently imported, or null. */
    fun currentVersion(): String? = runCatching {
        JSONObject(File(live, "state.json").readText()).optString("bundleVersion", "").ifEmpty { null }
    }.getOrNull()

    /** Signature, schema, tenant and every path — reads only manifest.json + manifest.sig. */
    fun verify(source: UsbBundleSource, keyHex: String, tenantId: String): Verdict {
        if (!UsbPackage.isKey(keyHex)) return Verdict.Rejected("REJECTED", "no valid key on this screen")
        val manifestBytes = source.open("manifest.json")?.use { readCapped(it, UsbPackage.MAX_MANIFEST_BYTES) }
            ?: return Verdict.Rejected("REJECTED", "manifest.json missing or too large")
        val sig = source.open("manifest.sig")?.use { readCapped(it, 1024) }?.toString(Charsets.UTF_8)?.trim()
            ?: return Verdict.Rejected("REJECTED_SIGNATURE", "manifest.sig missing")
        if (!UsbPackage.constantTimeEq(UsbPackage.hmacHex(keyHex, manifestBytes), sig.lowercase())) {
            return Verdict.Rejected("REJECTED_SIGNATURE", "signature does not match this organization's key")
        }
        val m = runCatching { JSONObject(String(manifestBytes, Charsets.UTF_8)) }.getOrNull()
            ?: return Verdict.Rejected("REJECTED", "manifest.json is not JSON")
        if (m.optString("schema") != UsbPackage.SCHEMA) return Verdict.Rejected("REJECTED", "unsupported package")
        if (m.optString("tenantId") != tenantId) return Verdict.Rejected("REJECTED", "package is for another organization")
        val version = m.optString("bundleVersion", "")
        if (version.isEmpty()) return Verdict.Rejected("REJECTED", "package has no version")
        val arr = m.optJSONArray("assets") ?: return Verdict.Rejected("REJECTED", "package has no files")
        if (arr.length() > UsbPackage.MAX_ASSETS) return Verdict.Rejected("REJECTED", "package has too many files")
        val assets = ArrayList<Asset>(arr.length())
        val seen = HashSet<String>()
        for (i in 0 until arr.length()) {
            val a = arr.optJSONObject(i) ?: return Verdict.Rejected("REJECTED", "bad file entry $i")
            val sha = a.optString("sha256", "").lowercase()
            val path = UsbPackage.safeLocalPath(a.optString("localPath", ""), sha)
                ?: return Verdict.Rejected("REJECTED", "bad file path in entry $i")
            val size = a.optLong("sizeBytes", -1L)
            if (size < 0) return Verdict.Rejected("REJECTED", "bad file size in entry $i")
            if (seen.add(path)) assets.add(Asset(sha, path, size))
        }
        return Verdict.Ok(manifestBytes, version, assets)
    }

    /**
     * Import a verified package. Copies into a staging folder, verifying each
     * file's SHA-256 and size as it streams, then swaps it in with renames.
     * The previous import keeps serving until the swap.
     */
    fun import(source: UsbBundleSource, keyHex: String, tenantId: String): Outcome {
        val v = verify(source, keyHex, tenantId)
        if (v is Verdict.Rejected) return Outcome.Rejected(v.outcome, v.reason)
        v as Verdict.Ok
        if (currentVersion() == v.bundleVersion) return Outcome.AlreadyCurrent(v.bundleVersion)

        val total = v.assets.sumOf { it.sizeBytes }
        if (freeBytes(filesDir) < total + UsbPackage.SPACE_MARGIN_BYTES) {
            return Outcome.Rejected("REJECTED", "not enough free space on this screen (${total / (1024 * 1024)} MB needed)")
        }
        val staging = File(filesDir, "${UsbPackage.CACHE_DIR}.staging")
        staging.deleteRecursively()
        if (!staging.mkdirs()) return Outcome.Rejected("REJECTED", "cannot write to this screen's storage")
        try {
            var emergency = 0
            for (a in v.assets) {
                val src = source.open(a.localPath)
                    ?: return fail(staging, "REJECTED", "file missing from the package: ${a.localPath}")
                val dest = File(staging, a.localPath)
                dest.parentFile?.mkdirs()
                val (sha, size) = src.use { copyHashing(it, dest, a.sizeBytes + 1) }
                if (size != a.sizeBytes || !UsbPackage.constantTimeEq(sha, a.sha256)) {
                    return fail(staging, "REJECTED_HASH", "file does not match its checksum: ${a.localPath}")
                }
                if (a.localPath.startsWith("emergency/")) emergency++
            }
            File(staging, "manifest.json").writeBytes(v.manifestBytes)
            val state = JSONObject()
                .put("bundleVersion", v.bundleVersion)
                .put("ingestedAt", System.currentTimeMillis())
                .put("assetCount", v.assets.size)
                .put("emergencyCount", emergency)
                .put("totalBytes", total)
            File(staging, "state.json").writeText(state.toString())

            val old = File(filesDir, "${UsbPackage.CACHE_DIR}.old")
            old.deleteRecursively()
            val liveDir = live
            if (liveDir.exists() && !liveDir.renameTo(old)) return fail(staging, "REJECTED", "cannot replace the previous USB content")
            if (!staging.renameTo(liveDir)) {
                old.renameTo(liveDir)
                return fail(staging, "REJECTED", "cannot activate the USB content")
            }
            old.deleteRecursively()
            return Outcome.Imported(v.bundleVersion, v.assets.size, total, emergency)
        } catch (e: Exception) {
            return fail(staging, "REJECTED", "could not read the stick (${e.javaClass.simpleName})")
        }
    }

    /** Remove every trace of USB content (unpair). */
    fun forget() {
        for (n in listOf(UsbPackage.CACHE_DIR, "${UsbPackage.CACHE_DIR}.staging", "${UsbPackage.CACHE_DIR}.old")) {
            File(filesDir, n).deleteRecursively()
        }
    }

    private fun fail(staging: File, outcome: String, reason: String): Outcome {
        staging.deleteRecursively()
        return Outcome.Rejected(outcome, reason)
    }

    private fun readCapped(input: InputStream, cap: Long): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > cap) return null
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** Stream to [dest] hashing as it goes; stops after [cap] bytes (a lying size never fills the disk). */
    private fun copyHashing(input: InputStream, dest: File, cap: Long): Pair<String, Long> {
        val md = MessageDigest.getInstance("SHA-256")
        var total = 0L
        FileOutputStream(dest).use { out ->
            val buf = ByteArray(256 * 1024)
            while (total < cap) {
                val n = input.read(buf, 0, minOf(buf.size.toLong(), cap - total).toInt())
                if (n < 0) break
                md.update(buf, 0, n)
                out.write(buf, 0, n)
                total += n
            }
        }
        return UsbPackage.toHex(md.digest()) to total
    }
}

/** `Range: bytes=a-b` for one file — what a <video> sends. */
object UsbRange {
    /** Inclusive [start, end], or null for "whole file" / unsatisfiable-as-whole. */
    fun parse(header: String?, length: Long): LongRange? {
        if (header == null || length <= 0) return null
        val m = Regex("^\\s*bytes=(\\d*)-(\\d*)\\s*$").matchEntire(header) ?: return null
        val a = m.groupValues[1]
        val b = m.groupValues[2]
        return when {
            a.isEmpty() && b.isEmpty() -> null
            a.isEmpty() -> {
                val suffix = b.toLongOrNull() ?: return null
                if (suffix <= 0) null else maxOf(0L, length - suffix)..(length - 1)
            }
            else -> {
                val start = a.toLongOrNull() ?: return null
                if (start >= length) return null
                val end = if (b.isEmpty()) length - 1 else minOf(b.toLongOrNull() ?: return null, length - 1)
                if (end < start) null else start..end
            }
        }
    }
}
