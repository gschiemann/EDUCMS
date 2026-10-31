package com.educms.player.usb

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
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
 * files and real zips (UsbPackageTest, UsbPackageFinderTest). [UsbAutoImport]
 * is the Android glue that finds the stick, asks this code to import, and
 * tells the page.
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
 *
 * WHERE OPERATORS ACTUALLY PUT IT (2026-10-26, M43 on site): Safari unzips a
 * download by default, and because the zip holds ONE folder, macOS's Archive
 * Utility unpacks it as `edu-cms-content` — and the NEXT download as
 * `edu-cms-content 2` (checked with Archive Utility itself). So a package
 * folder is any folder named `edu-cms-content…` that holds manifest.json, or
 * any folder holding BOTH manifest.json and manifest.sig, at the top of the
 * drive or up to two folders down ([UsbPackageFinder]). The signature check
 * is what makes a folder a VenueOS package; its name never does.
 */
object UsbPackage {
    const val SCHEMA = "edu-cms-usb-bundle/v1"
    const val FOLDER = "edu-cms-content"
    const val MANIFEST = "manifest.json"
    const val SIGNATURE = "manifest.sig"
    const val CACHE_DIR = "usb-cache"
    const val MAX_MANIFEST_BYTES = 16L * 1024 * 1024
    const val MAX_ASSETS = 4096
    /** Free space kept back after an import, so the stick can never fill the box. */
    const val SPACE_MARGIN_BYTES = 256L * 1024 * 1024
    /** The longest playlist name the card shows (a label is operator text). */
    const val MAX_LABEL_CHARS = 80

    private val LOCAL_PATH = Regex("^(assets|emergency)/([0-9a-f]{64})\\.([a-z0-9]{1,5})$")
    private val KEY_HEX = Regex("^[0-9a-fA-F]{64}$")

    fun isKey(hex: String?): Boolean = hex != null && KEY_HEX.matches(hex)

    /** `edu-cms-content`, `edu-cms-content 2`, `edu-cms-content (1)` — what a browser or a copy names it. */
    fun isPackageFolderName(name: String): Boolean = name.lowercase().startsWith(FOLDER)

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

    /**
     * What the card calls the package: the label the dashboard gave the
     * download (the playlist's name), else the first playlist's name. Words
     * only — never used to decide anything. Control characters dropped, length
     * capped.
     */
    fun displayName(manifest: JSONObject): String? {
        val raw = manifest.optString("bundleLabel", "").ifBlank {
            manifest.optJSONArray("playlists")?.optJSONObject(0)?.optString("name", "") ?: ""
        }
        val clean = raw.filter { it >= ' ' && it != '\u007f' }.trim()
        if (clean.isEmpty()) return null
        return if (clean.length <= MAX_LABEL_CHARS) clean else clean.take(MAX_LABEL_CHARS - 1).trimEnd() + "…"
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

/** A package on the stick: a folder or a zip. Paths are relative to the package folder. */
interface UsbBundleSource : AutoCloseable {
    /** Stable identity of what was read (so a stick left in is not re-read every minute). */
    val identity: String
    fun open(relativePath: String): InputStream?
    override fun close() {}

    companion object {
        /** A package folder, or a .zip that holds one; null otherwise. */
        fun open(candidate: File): UsbBundleSource? = when {
            candidate.isDirectory -> DirBundleSource.of(candidate)
            candidate.isFile && candidate.name.lowercase().endsWith(".zip") -> ZipBundleSource.of(candidate)
            else -> null
        }
    }
}

class DirBundleSource private constructor(private val root: File) : UsbBundleSource {
    private val rootPath = root.canonicalPath + File.separator
    override val identity: String = "dir:${root.path}|${File(root, UsbPackage.MANIFEST).let { "${it.length()}|${it.lastModified()}" }}"

    override fun open(relativePath: String): InputStream? {
        val f = runCatching { File(root, relativePath).canonicalFile }.getOrNull() ?: return null
        if (!f.path.startsWith(rootPath) || !f.isFile) return null
        return runCatching { f.inputStream() }.getOrNull()
    }

    companion object {
        fun of(dir: File): DirBundleSource? =
            if (File(dir, UsbPackage.MANIFEST).isFile) DirBundleSource(dir) else null
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
        /** Deepest `…/manifest.json` looked at inside a zip: `a/b/edu-cms-content/manifest.json`. */
        private const val MAX_SLASHES = 3
        private const val MAX_ENTRIES = 20_000

        /**
         * The zip, when it holds a package: a `manifest.json` at most two
         * folders down whose folder is an `edu-cms-content…` folder or has
         * `manifest.sig` beside it. The shallowest one wins.
         */
        fun of(file: File): ZipBundleSource? {
            val zip = runCatching { ZipFile(file) }.getOrNull() ?: return null
            val prefix = runCatching { findPrefix(zip) }.getOrNull()
            if (prefix == null) {
                runCatching { zip.close() }
                return null
            }
            return ZipBundleSource(file, zip, prefix)
        }

        private fun findPrefix(zip: ZipFile): String? {
            val manifests = ArrayList<String>()
            val signatures = HashSet<String>()
            val entries = zip.entries()
            var seen = 0
            while (entries.hasMoreElements() && seen < MAX_ENTRIES) {
                val e = entries.nextElement()
                seen++
                if (e.isDirectory) continue
                val name = e.name
                if (name.startsWith("__MACOSX/") || name.contains("/__MACOSX/")) continue
                val slashes = name.count { it == '/' }
                if (slashes > MAX_SLASHES) continue
                val base = name.substringAfterLast('/')
                when (base) {
                    UsbPackage.MANIFEST -> manifests += name
                    UsbPackage.SIGNATURE -> signatures += name
                }
            }
            return manifests
                .map { it.removeSuffix(UsbPackage.MANIFEST) }
                .filter { prefix ->
                    val folder = prefix.trimEnd('/').substringAfterLast('/')
                    UsbPackage.isPackageFolderName(folder) || (prefix + UsbPackage.SIGNATURE) in signatures
                }
                .minWithOrNull(compareBy<String>({ it.count { c -> c == '/' } }, { if (it.trimEnd('/').substringAfterLast('/') == UsbPackage.FOLDER) 0 else 1 }, { it }))
        }
    }
}

/**
 * Where a package might be on a mounted stick (2026-10-26 rewrite). Bounded:
 * a stick full of photo folders costs at most [MAX_LISTINGS] directory
 * listings per drive, and likely places are looked at first.
 *
 *   • a .zip anywhere from the top of the drive to two folders down;
 *   • a package FOLDER there: named `edu-cms-content…` with a manifest.json
 *     inside, or any folder with manifest.json AND manifest.sig inside
 *     (renamed by the operator, or a second Safari download);
 *   • the drive itself when the package's contents were copied to its top.
 *
 * Every candidate is only a candidate: [UsbImporter.verify] decides.
 */
object UsbPackageFinder {
    /** Folders below the top of the drive that may hold a package: top, one down, two down. */
    const val MAX_DEPTH = 2
    private const val MAX_ENTRIES = 400
    private const val MAX_SUBDIRS = 40
    private const val MAX_LISTINGS = 120

    /** Never worth opening: Android's, Windows' and macOS's own housekeeping. */
    private val SKIP_DIRS = setOf("lost.dir", "android", "system volume information", "\$recycle.bin", "__macosx")

    fun candidates(volumeRoots: List<File>): List<File> {
        val out = LinkedHashMap<String, File>()
        for (root in volumeRoots) scanDrive(root, out)
        return out.values.toList()
    }

    /** A folder that holds a package itself. */
    fun isPackageFolder(dir: File): Boolean {
        if (!File(dir, UsbPackage.MANIFEST).isFile) return false
        return UsbPackage.isPackageFolderName(dir.name) || File(dir, UsbPackage.SIGNATURE).isFile
    }

    private fun scanDrive(root: File, out: MutableMap<String, File>) {
        // The contents copied straight onto the drive (manifest.json at the top).
        if (File(root, UsbPackage.MANIFEST).isFile && File(root, UsbPackage.SIGNATURE).isFile) out[root.path] = root
        var listings = 0
        var level = listOf(root)
        for (depth in 0..MAX_DEPTH) {
            val next = ArrayList<File>()
            for (dir in level) {
                if (listings >= MAX_LISTINGS) return
                listings++
                val entries = dir.listFiles() ?: continue
                val children = entries.asSequence().take(MAX_ENTRIES)
                    .filter { !it.name.startsWith(".") }
                    .sortedWith(likelyFirst)
                    .toList()
                for (f in children) {
                    if (f.isFile) {
                        if (f.name.lowercase().endsWith(".zip")) out.putIfAbsent(f.path, f)
                    }
                }
                var descended = 0
                for (d in children) {
                    if (!d.isDirectory || d.name.lowercase() in SKIP_DIRS) continue
                    if (isPackageFolder(d)) {
                        out.putIfAbsent(d.path, d)
                    } else if (depth < MAX_DEPTH && descended < MAX_SUBDIRS) {
                        next += d
                        descended++
                    }
                }
            }
            level = next
            if (level.isEmpty()) return
        }
    }

    /** VenueOS's own names first, then the newest: Safari's folder from a minute ago beats last year's photos. */
    private val likelyFirst = Comparator<File> { a, b ->
        val pa = priority(a)
        val pb = priority(b)
        if (pa != pb) pa - pb else b.lastModified().compareTo(a.lastModified())
    }

    private fun priority(f: File): Int {
        val n = f.name.lowercase()
        return when {
            UsbPackage.isPackageFolderName(n) -> 0
            n.startsWith("venueos") -> 1
            n == "download" || n == "downloads" -> 2
            else -> 3
        }
    }
}

/**
 * Which package on a stick wins (2026-10-26). Every candidate's manifest and
 * signature is checked — files are copied only for the winner — and the
 * NEWEST verified bundle version wins, so a stick that holds last week's
 * download beside today's plays today's. A package that fails verification
 * never wins, however new it claims to be.
 */
object UsbSelection {
    class Round(
        /** The newest verified package, or null. */
        val best: Pair<File, UsbImporter.Verdict.Ok>?,
        /** (identity, verdict) of every refused package. */
        val refused: List<Pair<String, UsbImporter.Verdict.Rejected>>,
        /** At least one candidate opened as a package (a folder with a manifest, or a zip holding one). */
        val openedAny: Boolean,
    )

    /** [skip] = identities already handled (a stick left in is not re-read every minute). */
    fun verifyAll(
        candidates: List<File>,
        importer: UsbImporter,
        keyHex: String,
        tenantId: String,
        skip: (String) -> Boolean = { false },
        onRefused: (File, UsbImporter.Verdict.Rejected) -> Unit = { _, _ -> },
    ): Round {
        var best: Pair<File, UsbImporter.Verdict.Ok>? = null
        var openedAny = false
        val refused = ArrayList<Pair<String, UsbImporter.Verdict.Rejected>>()
        for (c in candidates) {
            val src = runCatching { UsbBundleSource.open(c) }.getOrNull() ?: continue
            openedAny = true
            src.use {
                if (skip(it.identity)) return@use
                when (val v = importer.verify(it, keyHex, tenantId)) {
                    is UsbImporter.Verdict.Ok -> {
                        val current = best
                        if (current == null || UsbPackage.compareVersions(v.bundleVersion, current.second.bundleVersion) > 0) best = c to v
                    }
                    is UsbImporter.Verdict.Rejected -> {
                        onRefused(c, v)
                        refused += it.identity to v
                    }
                }
            }
        }
        return Round(best, refused, openedAny)
    }
}

/**
 * Verify + import. [filesDir] is the app's private storage; the live import is
 * `filesDir/usb-cache/` (what [UsbCacheIndex] and the page read).
 */
class UsbImporter(private val filesDir: File, private val freeBytes: (File) -> Long = { it.usableSpace }) {

    /** Why a package was refused, in the words the card uses. */
    enum class Reject {
        /** Another organization's package: its manifest names another tenant. */
        OTHER_ORG,
        /** Ours (or unattributable) but the signature or a file's checksum does not match. */
        UNVERIFIED,
        /** The drive could not be read (pulled out, I/O error). */
        UNREADABLE,
        /** Not enough free space on this screen. */
        NO_SPACE,
        /** This screen could not write its own storage. */
        DEVICE,
    }

    sealed class Verdict {
        class Ok(
            val manifestBytes: ByteArray,
            val bundleVersion: String,
            val assets: List<Asset>,
            val label: String?,
        ) : Verdict()
        /** [outcome] is the fine forensic code (REJECTED_SIGNATURE, REJECTED_HASH, REJECTED_TENANT, REJECTED). */
        class Rejected(val outcome: String, val reason: String, val kind: Reject) : Verdict()
    }

    class Asset(val sha256: String, val localPath: String, val sizeBytes: Long)

    sealed class Outcome {
        class Imported(val bundleVersion: String, val assetCount: Int, val totalBytes: Long, val emergencyAssets: Int, val label: String?) : Outcome()
        class AlreadyCurrent(val bundleVersion: String, val label: String?) : Outcome()
        class Rejected(val outcome: String, val reason: String, val kind: Reject, val neededBytes: Long = 0L) : Outcome()
    }

    /** Copy progress, after each file: files done, files in all, bytes done, bytes in all. */
    fun interface Progress {
        fun onProgress(filesDone: Int, filesTotal: Int, bytesDone: Long, bytesTotal: Long)
    }

    private val live get() = File(filesDir, UsbPackage.CACHE_DIR)

    /** The bundle version currently imported, or null. */
    fun currentVersion(): String? = runCatching {
        JSONObject(File(live, "state.json").readText()).optString("bundleVersion", "").ifEmpty { null }
    }.getOrNull()

    /** Signature, schema, tenant and every path — reads only manifest.json + manifest.sig. */
    fun verify(source: UsbBundleSource, keyHex: String, tenantId: String): Verdict {
        if (!UsbPackage.isKey(keyHex)) return Verdict.Rejected("REJECTED", "no valid key on this screen", Reject.UNVERIFIED)
        val manifestBytes = try {
            source.open(UsbPackage.MANIFEST)?.use { readCapped(it, UsbPackage.MAX_MANIFEST_BYTES) }
        } catch (e: IOException) {
            return Verdict.Rejected("REJECTED", "could not read manifest.json (${e.javaClass.simpleName})", Reject.UNREADABLE)
        } ?: return Verdict.Rejected("REJECTED", "manifest.json missing, unreadable or too large", Reject.UNREADABLE)
        val parsed = runCatching { JSONObject(String(manifestBytes, Charsets.UTF_8)) }.getOrNull()
        val sig = try {
            source.open(UsbPackage.SIGNATURE)?.use { readCapped(it, 1024) }?.toString(Charsets.UTF_8)?.trim()
        } catch (e: IOException) {
            return Verdict.Rejected("REJECTED", "could not read manifest.sig (${e.javaClass.simpleName})", Reject.UNREADABLE)
        }
        if (sig == null || !UsbPackage.constantTimeEq(UsbPackage.hmacHex(keyHex, manifestBytes), sig.lowercase())) {
            // The words only: an unsigned claim decides nothing. A manifest that
            // names another organization was signed with that organization's
            // key, which is why it cannot match ours.
            val claimed = parsed?.optString("tenantId", "").orEmpty()
            if (claimed.isNotEmpty() && claimed != tenantId) {
                return Verdict.Rejected("REJECTED_TENANT", "package is for another organization", Reject.OTHER_ORG)
            }
            return Verdict.Rejected(
                "REJECTED_SIGNATURE",
                if (sig == null) "manifest.sig missing" else "signature does not match this organization's key",
                Reject.UNVERIFIED,
            )
        }
        val m = parsed ?: return Verdict.Rejected("REJECTED", "manifest.json is not JSON", Reject.UNVERIFIED)
        if (m.optString("schema") != UsbPackage.SCHEMA) return Verdict.Rejected("REJECTED", "unsupported package", Reject.UNVERIFIED)
        if (m.optString("tenantId") != tenantId) {
            return Verdict.Rejected("REJECTED_TENANT", "package is for another organization", Reject.OTHER_ORG)
        }
        val version = m.optString("bundleVersion", "")
        if (version.isEmpty()) return Verdict.Rejected("REJECTED", "package has no version", Reject.UNVERIFIED)
        val arr = m.optJSONArray("assets") ?: return Verdict.Rejected("REJECTED", "package has no files", Reject.UNVERIFIED)
        if (arr.length() > UsbPackage.MAX_ASSETS) return Verdict.Rejected("REJECTED", "package has too many files", Reject.UNVERIFIED)
        val assets = ArrayList<Asset>(arr.length())
        val seen = HashSet<String>()
        for (i in 0 until arr.length()) {
            val a = arr.optJSONObject(i) ?: return Verdict.Rejected("REJECTED", "bad file entry $i", Reject.UNVERIFIED)
            val sha = a.optString("sha256", "").lowercase()
            val path = UsbPackage.safeLocalPath(a.optString("localPath", ""), sha)
                ?: return Verdict.Rejected("REJECTED", "bad file path in entry $i", Reject.UNVERIFIED)
            val size = a.optLong("sizeBytes", -1L)
            if (size < 0) return Verdict.Rejected("REJECTED", "bad file size in entry $i", Reject.UNVERIFIED)
            if (seen.add(path)) assets.add(Asset(sha, path, size))
        }
        return Verdict.Ok(manifestBytes, version, assets, UsbPackage.displayName(m))
    }

    /**
     * Import a verified package. Copies into a staging folder, verifying each
     * file's SHA-256 and size as it streams, then swaps it in with renames.
     * The previous import keeps serving until the swap.
     */
    fun import(source: UsbBundleSource, keyHex: String, tenantId: String, progress: Progress? = null): Outcome {
        val v = verify(source, keyHex, tenantId)
        if (v is Verdict.Rejected) return Outcome.Rejected(v.outcome, v.reason, v.kind)
        v as Verdict.Ok
        if (currentVersion() == v.bundleVersion) return Outcome.AlreadyCurrent(v.bundleVersion, v.label)

        val total = v.assets.sumOf { it.sizeBytes }
        if (freeBytes(filesDir) < total + UsbPackage.SPACE_MARGIN_BYTES) {
            return Outcome.Rejected(
                "REJECTED",
                "not enough free space on this screen (${total / (1024 * 1024)} MB needed)",
                Reject.NO_SPACE,
                neededBytes = total + UsbPackage.SPACE_MARGIN_BYTES,
            )
        }
        val staging = File(filesDir, "${UsbPackage.CACHE_DIR}.staging")
        staging.deleteRecursively()
        if (!staging.mkdirs()) return Outcome.Rejected("REJECTED", "cannot write to this screen's storage", Reject.DEVICE)
        try {
            var emergency = 0
            var done = 0L
            progress?.onProgress(0, v.assets.size, 0L, total)
            for ((index, a) in v.assets.withIndex()) {
                val src = source.open(a.localPath)
                    ?: return fail(staging, "REJECTED", "file missing from the package: ${a.localPath}", Reject.UNVERIFIED)
                val dest = File(staging, a.localPath)
                dest.parentFile?.mkdirs()
                val (sha, size) = src.use { copyHashing(it, dest, a.sizeBytes + 1) }
                if (size != a.sizeBytes || !UsbPackage.constantTimeEq(sha, a.sha256)) {
                    return fail(staging, "REJECTED_HASH", "file does not match its checksum: ${a.localPath}", Reject.UNVERIFIED)
                }
                if (a.localPath.startsWith("emergency/")) emergency++
                done += size
                progress?.onProgress(index + 1, v.assets.size, done, total)
            }
            File(staging, UsbPackage.MANIFEST).writeBytes(v.manifestBytes)
            val state = JSONObject()
                .put("bundleVersion", v.bundleVersion)
                .put("ingestedAt", System.currentTimeMillis())
                .put("assetCount", v.assets.size)
                .put("emergencyCount", emergency)
                .put("totalBytes", total)
            v.label?.let { state.put("label", it) }
            File(staging, "state.json").writeText(state.toString())

            val old = File(filesDir, "${UsbPackage.CACHE_DIR}.old")
            old.deleteRecursively()
            val liveDir = live
            if (liveDir.exists() && !liveDir.renameTo(old)) return fail(staging, "REJECTED", "cannot replace the previous USB content", Reject.DEVICE)
            if (!staging.renameTo(liveDir)) {
                old.renameTo(liveDir)
                return fail(staging, "REJECTED", "cannot activate the USB content", Reject.DEVICE)
            }
            old.deleteRecursively()
            return Outcome.Imported(v.bundleVersion, v.assets.size, total, emergency, v.label)
        } catch (e: Exception) {
            return fail(staging, "REJECTED", "could not read the stick (${e.javaClass.simpleName})", Reject.UNREADABLE)
        }
    }

    /**
     * The person asked for this package again (a fresh insertion or "Import
     * from USB") and it is already on the screen: nothing is copied, only the
     * import time moves on, which is how the page knows it is the newest thing
     * a person did (usbPackage.ts — a server publish since then no longer
     * retires it). False when there is nothing imported to stamp.
     */
    fun restamp(nowMs: Long = System.currentTimeMillis()): Boolean = runCatching {
        val stateFile = File(live, "state.json")
        if (!stateFile.isFile) return false
        val state = JSONObject(stateFile.readText()).put("ingestedAt", nowMs)
        val tmp = File(live, "state.json.tmp")
        tmp.writeText(state.toString())
        tmp.renameTo(stateFile)
    }.getOrDefault(false)

    /** Remove every trace of USB content (unpair). */
    fun forget() {
        for (n in listOf(UsbPackage.CACHE_DIR, "${UsbPackage.CACHE_DIR}.staging", "${UsbPackage.CACHE_DIR}.old")) {
            File(filesDir, n).deleteRecursively()
        }
    }

    private fun fail(staging: File, outcome: String, reason: String, kind: Reject): Outcome {
        staging.deleteRecursively()
        return Outcome.Rejected(outcome, reason, kind)
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
