package com.educms.player.usb

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * The USB import against real folders and real zips, laid out exactly as the
 * API's `POST /usb-export/bundle` writes them (usb-export.controller.ts).
 */
class UsbPackageTest {
    // A throwaway test key built at runtime (a literal hex string reads as a secret to gitleaks).
    private val key = (0 until 32).joinToString("") { "%02x".format(it * 7 % 256) }
    private val tenant = "tenant-1"
    private lateinit var stick: File
    private lateinit var device: File

    @Before
    fun setUp() {
        stick = Files.createTempDirectory("stick").toFile()
        device = Files.createTempDirectory("device").toFile()
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** files: name→bytes. Returns (manifestBytes, entries relative to edu-cms-content). */
    private fun pkg(
        version: String = "1000",
        files: List<ByteArray> = listOf("picture-one".toByteArray(), "video-two".toByteArray()),
        tenantId: String = tenant,
        signWith: String = key,
        tamper: (JSONObject) -> Unit = {},
    ): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        val assets = JSONArray()
        files.forEachIndexed { i, bytes ->
            val h = sha(bytes)
            val path = "assets/$h.${if (i == 0) "png" else "mp4"}"
            out[path] = bytes
            assets.put(JSONObject().put("url", "https://cdn.test/$i").put("sha256", h).put("localPath", path).put("sizeBytes", bytes.size))
        }
        val m = JSONObject()
            .put("schema", UsbPackage.SCHEMA).put("bundleVersion", version).put("tenantId", tenantId)
            .put("assets", assets)
            .put("playlists", JSONArray().put(JSONObject().put("id", "pl").put("items", JSONArray())))
        tamper(m)
        val mb = m.toString().toByteArray()
        out["manifest.json"] = mb
        out["manifest.sig"] = UsbPackage.hmacHex(signWith, mb).toByteArray()
        return out
    }

    private fun writeFolder(root: File, entries: Map<String, ByteArray>): File {
        val dir = File(root, UsbPackage.FOLDER)
        for ((p, b) in entries) File(dir, p).apply { parentFile!!.mkdirs() }.writeBytes(b)
        return dir
    }

    private fun writeZip(file: File, entries: Map<String, ByteArray>, wrap: String = ""): File {
        ZipOutputStream(FileOutputStream(file)).use { z ->
            for ((p, b) in entries) {
                z.putNextEntry(ZipEntry("$wrap${UsbPackage.FOLDER}/$p"))
                z.write(b)
                z.closeEntry()
            }
        }
        return file
    }

    private fun importer(free: Long = Long.MAX_VALUE) = UsbImporter(device) { free }

    @Test
    fun `imports the downloaded zip as-is — nobody unzips anything`() {
        val zip = writeZip(File(stick, "VenueOS-USB-Lobby.zip"), pkg())
        val found = UsbPackageFinder.candidates(listOf(stick))
        assertEquals(listOf(zip.path), found.map { it.path })
        val out = UsbBundleSource.open(found[0])!!.use { importer().import(it, key, tenant) }
        assertTrue(out is UsbImporter.Outcome.Imported)
        out as UsbImporter.Outcome.Imported
        assertEquals("1000", out.bundleVersion)
        assertEquals(2, out.assetCount)
        val live = File(device, UsbPackage.CACHE_DIR)
        assertTrue(File(live, "manifest.json").isFile)
        assertEquals("1000", importer().currentVersion())
        assertEquals(2, File(live, "assets").listFiles()!!.size)
    }

    @Test
    fun `imports an unpacked folder, and one zipped inside an extra folder`() {
        writeFolder(stick, pkg())
        val folder = UsbPackageFinder.candidates(listOf(stick)).single()
        assertTrue(UsbBundleSource.open(folder)!!.use { importer().import(it, key, tenant) } is UsbImporter.Outcome.Imported)

        val other = Files.createTempDirectory("stick2").toFile()
        val sub = File(other, "Downloads").apply { mkdirs() }
        writeZip(File(sub, "pkg.zip"), pkg(version = "2000"), wrap = "VenueOS-USB-Lobby/")
        val nested = UsbPackageFinder.candidates(listOf(other)).single()
        val out = UsbBundleSource.open(nested)!!.use { importer().import(it, key, tenant) }
        assertTrue(out is UsbImporter.Outcome.Imported)
        assertEquals("2000", importer().currentVersion())
    }

    @Test
    fun `the same package left in the stick is not copied again`() {
        val zip = writeZip(File(stick, "a.zip"), pkg())
        UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
        val again = UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
        assertTrue(again is UsbImporter.Outcome.AlreadyCurrent)
    }

    @Test
    fun `refuses a package signed with another key, for another organization, or edited`() {
        fun rejected(entries: Map<String, ByteArray>): String {
            val dir = Files.createTempDirectory("s").toFile()
            val zip = writeZip(File(dir, "x.zip"), entries)
            val out = UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
            assertTrue(out is UsbImporter.Outcome.Rejected)
            return (out as UsbImporter.Outcome.Rejected).outcome
        }
        assertEquals("REJECTED_SIGNATURE", rejected(pkg(signWith = "f".repeat(64))))
        assertEquals("REJECTED", rejected(pkg(tenantId = "other")))
        val edited = pkg().toMutableMap()
        edited["manifest.json"] = String(edited["manifest.json"]!!).replace("1000", "9999").toByteArray()
        assertEquals("REJECTED_SIGNATURE", rejected(edited))
        assertFalse(File(device, UsbPackage.CACHE_DIR).exists())
    }

    @Test
    fun `a swapped file is refused and the previous import keeps playing`() {
        val good = writeZip(File(stick, "good.zip"), pkg(version = "1000"))
        UsbBundleSource.open(good)!!.use { importer().import(it, key, tenant) }

        val bad = pkg(version = "2000").toMutableMap()
        val victim = bad.keys.first { it.startsWith("assets/") }
        bad[victim] = "something else".toByteArray()
        val dir = Files.createTempDirectory("s").toFile()
        val zip = writeZip(File(dir, "bad.zip"), bad)
        val out = UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
        assertEquals("REJECTED_HASH", (out as UsbImporter.Outcome.Rejected).outcome)
        assertEquals("1000", importer().currentVersion())
        assertFalse(File(device, "${UsbPackage.CACHE_DIR}.staging").exists())
    }

    @Test
    fun `refuses paths that escape the package, or a name that is not its digest`() {
        val evil = pkg { m ->
            m.getJSONArray("assets").getJSONObject(0).put("localPath", "../../shared_prefs/x.xml")
        }
        val zip = writeZip(File(stick, "evil.zip"), evil)
        val out = UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
        assertTrue(out is UsbImporter.Outcome.Rejected)
        assertNull(UsbPackage.safeLocalPath("assets/${"a".repeat(64)}.png", "b".repeat(64)))
    }

    @Test
    fun `refuses when the screen does not have the space, copying nothing`() {
        val zip = writeZip(File(stick, "a.zip"), pkg())
        val out = UsbBundleSource.open(zip)!!.use { importer(free = 1000).import(it, key, tenant) }
        assertTrue(out is UsbImporter.Outcome.Rejected)
        assertFalse(File(device, UsbPackage.CACHE_DIR).exists())
    }

    @Test
    fun `a screen with no key verifies nothing`() {
        val zip = writeZip(File(stick, "a.zip"), pkg())
        val out = UsbBundleSource.open(zip)!!.use { importer().import(it, "", tenant) }
        assertTrue(out is UsbImporter.Outcome.Rejected)
    }

    @Test
    fun `a zip that is not ours is ignored`() {
        val f = File(stick, "photos.zip")
        ZipOutputStream(FileOutputStream(f)).use { z -> z.putNextEntry(ZipEntry("a.jpg")); z.write(1); z.closeEntry() }
        assertNull(UsbBundleSource.open(f))
    }

    @Test
    fun `forget removes every trace`() {
        val zip = writeZip(File(stick, "a.zip"), pkg())
        UsbBundleSource.open(zip)!!.use { importer().import(it, key, tenant) }
        importer().forget()
        assertNull(importer().currentVersion())
    }

    @Test
    fun `numeric versions compare as numbers`() {
        assertTrue(UsbPackage.compareVersions("10000", "9999") > 0)
        assertTrue(UsbPackage.compareVersions("1", "2") < 0)
    }

    @Test
    fun `Range parsing covers what a video element and the precache send`() {
        assertEquals(0L..99L, UsbRange.parse("bytes=0-", 100))
        assertEquals(10L..19L, UsbRange.parse("bytes=10-19", 100))
        assertEquals(90L..99L, UsbRange.parse("bytes=-10", 100))
        assertEquals(50L..99L, UsbRange.parse("bytes=50-500", 100))
        assertNull(UsbRange.parse("bytes=200-", 100))
        assertNull(UsbRange.parse(null, 100))
        assertNull(UsbRange.parse("items=1-2", 100))
    }
}
