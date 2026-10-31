package com.educms.player.usb

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Where operators actually put a package (2026-10-26, M43 on site). Every
 * layout here was made the way it happens: the API's zip as downloaded, the
 * folder Safari's Archive Utility unpacks it to (`edu-cms-content`, and
 * `edu-cms-content 2` for the next download — checked with Archive Utility
 * itself), a wrapper folder, a Downloads folder copied whole, and the junk a
 * Mac and Windows leave on a FAT stick.
 */
class UsbPackageFinderTest {
    // A throwaway test key built at runtime (a literal hex string reads as a secret to gitleaks).
    private val key = (0 until 32).joinToString("") { "%02x".format(it * 11 % 256) }
    private val tenant = "tenant-1"
    private lateinit var stick: File
    private lateinit var device: File

    @Before
    fun setUp() {
        stick = Files.createTempDirectory("stick").toFile()
        device = Files.createTempDirectory("device").toFile()
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** A package as the API builds it: entries relative to the package folder. */
    private fun pkg(
        version: String = "1000",
        label: String = "Lobby",
        tenantId: String = tenant,
        signWith: String = key,
        files: List<ByteArray> = listOf("slide-$version-a".toByteArray(), "slide-$version-b".toByteArray()),
    ): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        val assets = JSONArray()
        files.forEach { bytes ->
            val h = sha(bytes)
            val path = "assets/$h.png"
            out[path] = bytes
            assets.put(JSONObject().put("url", "https://cdn.test/$h").put("sha256", h).put("localPath", path).put("sizeBytes", bytes.size))
        }
        val m = JSONObject()
            .put("schema", UsbPackage.SCHEMA).put("bundleVersion", version).put("tenantId", tenantId)
            .put("bundleLabel", label)
            .put("assets", assets)
            .put("playlists", JSONArray().put(JSONObject().put("id", "pl").put("name", label).put("items", JSONArray())))
        val mb = m.toString(2).toByteArray()
        out[UsbPackage.MANIFEST] = mb
        out[UsbPackage.SIGNATURE] = UsbPackage.hmacHex(signWith, mb).toByteArray()
        out["README.txt"] = "VenueOS — USB playlist".toByteArray()
        return out
    }

    private fun folder(parent: File, name: String, entries: Map<String, ByteArray>): File {
        val dir = File(parent, name)
        for ((p, b) in entries) File(dir, p).apply { parentFile!!.mkdirs() }.writeBytes(b)
        return dir
    }

    private fun zip(file: File, entries: Map<String, ByteArray>, wrap: String = "${UsbPackage.FOLDER}/"): File {
        file.parentFile!!.mkdirs()
        ZipOutputStream(FileOutputStream(file)).use { z ->
            for ((p, b) in entries) {
                z.putNextEntry(ZipEntry("$wrap$p"))
                z.write(b)
                z.closeEntry()
            }
        }
        return file
    }

    private fun dir(vararg path: String): File = File(stick, path.joinToString(File.separator)).apply { mkdirs() }

    private fun found(): List<String> = UsbPackageFinder.candidates(listOf(stick)).map { it.relativeTo(stick).path }

    private fun importer() = UsbImporter(device) { Long.MAX_VALUE }

    /** Verify every candidate and import the winner — what UsbAutoImport does after the finder. */
    private fun importBest(): UsbImporter.Outcome? {
        val round = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant)
        val best = round.best ?: return null
        return UsbBundleSource.open(best.first)!!.use { importer().import(it, key, tenant) }
    }

    // ── the layouts operators make ─────────────────────────────────────

    @Test
    fun `the downloaded zip at the top of the drive`() {
        zip(File(stick, "VenueOS-USB-GGP-2026-10-26T16-19-59.zip"), pkg(label = "GGP"))
        assertEquals(listOf("VenueOS-USB-GGP-2026-10-26T16-19-59.zip"), found())
        val out = importBest() as UsbImporter.Outcome.Imported
        assertEquals("GGP", out.label)
    }

    @Test
    fun `the folder Safari unpacks the download to, at the top of the drive`() {
        folder(stick, UsbPackage.FOLDER, pkg())
        assertEquals(listOf(UsbPackage.FOLDER), found())
        assertTrue(importBest() is UsbImporter.Outcome.Imported)
    }

    @Test
    fun `a second Safari download is edu-cms-content 2 — still found`() {
        folder(stick, "edu-cms-content 2", pkg(version = "2000"))
        assertEquals(listOf("edu-cms-content 2"), found())
        assertEquals("2000", (importBest() as UsbImporter.Outcome.Imported).bundleVersion)
    }

    @Test
    fun `a package inside a wrapper folder named for the download`() {
        folder(dir("VenueOS-USB-GGP-2026-10-26T16-19-59"), UsbPackage.FOLDER, pkg())
        assertEquals(listOf("VenueOS-USB-GGP-2026-10-26T16-19-59/${UsbPackage.FOLDER}"), found())
        assertTrue(importBest() is UsbImporter.Outcome.Imported)
    }

    @Test
    fun `two folders down — a Downloads folder copied whole, as a folder or as the zip`() {
        folder(dir("Downloads", "VenueOS-USB-GGP-2026-10-26"), UsbPackage.FOLDER, pkg(version = "1000"))
        zip(File(dir("Backup", "Week 43"), "VenueOS-USB-Lobby.zip"), pkg(version = "900"))
        assertEquals(
            setOf("Downloads/VenueOS-USB-GGP-2026-10-26/${UsbPackage.FOLDER}", "Backup/Week 43/VenueOS-USB-Lobby.zip"),
            found().toSet(),
        )
    }

    @Test
    fun `three folders down is not looked at`() {
        folder(dir("a", "b", "c"), UsbPackage.FOLDER, pkg())
        zip(File(dir("a", "b", "c"), "VenueOS-USB-Lobby.zip"), pkg())
        assertEquals(emptyList<String>(), found())
    }

    @Test
    fun `a renamed package folder counts when its signature is beside the manifest`() {
        folder(stick, "GGP playlist", pkg())
        assertEquals(listOf("GGP playlist"), found())
        assertTrue(importBest() is UsbImporter.Outcome.Imported)
    }

    @Test
    fun `a folder holding someone else's manifest json alone is not a package`() {
        File(dir("my-web-app"), "manifest.json").writeText("""{"name":"PWA"}""")
        assertEquals(emptyList<String>(), found())
    }

    @Test
    fun `the package's contents copied straight onto the top of the drive`() {
        for ((p, b) in pkg()) File(stick, p).apply { parentFile!!.mkdirs() }.writeBytes(b)
        assertEquals(listOf(""), found())
        assertTrue(importBest() is UsbImporter.Outcome.Imported)
    }

    @Test
    fun `junk is ignored — hidden folders, AppleDouble files, system folders and an ordinary zip`() {
        folder(dir(".Trashes"), UsbPackage.FOLDER, pkg())
        folder(dir(".Spotlight-V100"), UsbPackage.FOLDER, pkg())
        folder(dir("System Volume Information"), UsbPackage.FOLDER, pkg())
        folder(dir("LOST.DIR"), UsbPackage.FOLDER, pkg())
        File(stick, "._VenueOS-USB-GGP.zip").writeBytes(byteArrayOf(0, 5, 22, 7))
        File(stick, ".DS_Store").writeBytes(byteArrayOf(0, 0, 0, 1))
        val photos = File(stick, "photos.zip")
        ZipOutputStream(FileOutputStream(photos)).use { z -> z.putNextEntry(ZipEntry("a.jpg")); z.write(1); z.closeEntry() }
        File(dir("Pictures"), "holiday.jpg").writeBytes(byteArrayOf(1, 2, 3))

        // An ordinary zip is a candidate (only opening it can tell) — and opens as nothing.
        assertEquals(listOf("photos.zip"), found())
        assertNull(UsbBundleSource.open(photos))
        val round = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant)
        assertNull(round.best)
        assertFalse(round.openedAny)
        assertNull(UsbImportPolicy.afterVerify(false, emptyList(), openedAny = true))
        assertEquals(UsbStage.NO_PACKAGE, UsbImportPolicy.afterVerify(false, emptyList(), round.openedAny))
    }

    @Test
    fun `an empty drive and an unreadable root find nothing`() {
        assertEquals(emptyList<String>(), found())
        assertEquals(emptyList<File>(), UsbPackageFinder.candidates(listOf(File(stick, "not-mounted"))))
    }

    // ── several packages on one stick ──────────────────────────────────

    @Test
    fun `two packages on one stick — the newest verified one wins, whatever their names`() {
        zip(File(stick, "VenueOS-USB-Lobby-old.zip"), pkg(version = "1761400000000", label = "Lobby"))
        folder(stick, "edu-cms-content 2", pkg(version = "1761495599000", label = "GGP"))
        folder(dir("VenueOS-USB-Menu"), UsbPackage.FOLDER, pkg(version = "1761300000000", label = "Menu"))
        val round = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant)
        assertEquals("1761495599000", round.best!!.second.bundleVersion)
        assertEquals("GGP", round.best!!.second.label)
        assertEquals("edu-cms-content 2", round.best!!.first.name)
    }

    @Test
    fun `a newer package that fails verification never beats an older good one`() {
        folder(stick, UsbPackage.FOLDER, pkg(version = "1000", label = "Good"))
        val forged = pkg(version = "9999", label = "Forged", signWith = "e".repeat(64))
        zip(File(stick, "VenueOS-USB-Forged.zip"), forged)
        val refused = mutableListOf<String>()
        val round = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant, onRefused = { f, _ -> refused += f.name })
        assertEquals("1000", round.best!!.second.bundleVersion)
        assertEquals(listOf("VenueOS-USB-Forged.zip"), refused)
        assertEquals(UsbImporter.Reject.UNVERIFIED, round.refused.single().second.kind)
    }

    @Test
    fun `a package already read is skipped, and nothing new is said about it`() {
        folder(stick, UsbPackage.FOLDER, pkg())
        val first = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant)
        val seen = setOf(UsbBundleSource.open(first.best!!.first)!!.use { it.identity })
        val again = UsbSelection.verifyAll(UsbPackageFinder.candidates(listOf(stick)), importer(), key, tenant, skip = { it in seen })
        assertNull(again.best)
        assertTrue(again.openedAny)
        assertNull(UsbImportPolicy.afterVerify(false, again.refused.map { it.second.kind }, again.openedAny))
    }

    // ── inside a zip ───────────────────────────────────────────────────

    @Test
    fun `a zip of a renamed or nested package folder opens — macOS's __MACOSX copies are ignored`() {
        val entries = pkg()
        val renamed = zip(File(stick, "renamed.zip"), entries, wrap = "edu-cms-content 2/")
        assertNotNull(UsbBundleSource.open(renamed))
        val nested = zip(File(stick, "nested.zip"), entries, wrap = "VenueOS-USB-GGP/edu-cms-content/")
        UsbBundleSource.open(nested)!!.use { assertTrue(importer().import(it, key, tenant) is UsbImporter.Outcome.Imported) }

        val mac = File(stick, "mac.zip")
        ZipOutputStream(FileOutputStream(mac)).use { z ->
            // Only the AppleDouble shadow: a manifest.json under __MACOSX must not make it a package.
            z.putNextEntry(ZipEntry("__MACOSX/edu-cms-content/manifest.json"))
            z.write("{}".toByteArray())
            z.closeEntry()
        }
        assertNull(UsbBundleSource.open(mac))
    }

    @Test
    fun `a zip holding a manifest with no signature beside it, in a folder of another name, is not ours`() {
        val f = File(stick, "site.zip")
        ZipOutputStream(FileOutputStream(f)).use { z ->
            z.putNextEntry(ZipEntry("public/manifest.json"))
            z.write("""{"name":"PWA"}""".toByteArray())
            z.closeEntry()
        }
        assertNull(UsbBundleSource.open(f))
    }
}
