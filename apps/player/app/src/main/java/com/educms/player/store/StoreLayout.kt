package com.educms.player.store

import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest

/**
 * Layout, naming and isolation (design §5.1).
 *
 * ```
 * filesDir/content-store-v1/
 *   index.json                         the store's records (atomic + fsynced)
 *   .work.json                         the crash guard's in-flight marker
 *   <tenantId>/                        UUID-validated; one directory per tenant
 *     <sha256>                         content-addressed, verified bytes only
 *     u/<sha256(stableKey)>            the URL-keyed lane (emergency files with no digest)
 *     .staging/<id>.<nonce>.part(.json) chunked download state
 *     .emergency.json(.bak)            the pinned emergency set (life-safety, kept apart from the index)
 * ```
 *
 * NO PATH SEGMENT EVER COMES FROM A URL. Every name below is a validated
 * 64-hex digest, a validated UUID or a fixed constant; a URL only ever becomes
 * a [StoreNames.stableKey], and the lane file is named by that key's SHA-256.
 */
internal object StoreNames {
    const val ROOT = "content-store-v1"
    const val INDEX = "index.json"
    const val WORK = ".work.json"
    const val STAGING = ".staging"
    const val LANE = "u"
    const val EMERGENCY = ".emergency.json"

    private val SHA = Regex("^[a-f0-9]{64}$")
    private val UUID = Regex("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
    private val NONCE = Regex("^[a-f0-9]{16}$")

    fun isSha(value: String?): Boolean = value != null && SHA.matches(value)
    fun isTenant(value: String?): Boolean = value != null && UUID.matches(value)
    fun isNonce(value: String?): Boolean = value != null && NONCE.matches(value)

    /** A UUID as the store names its directory (lowercase), or null. */
    fun tenantOrNull(raw: String?): String? = raw?.trim()?.lowercase()?.takeIf { UUID.matches(it) }

    /** A lowercase digest, or null. Uppercase input is accepted and normalised; nothing else is. */
    fun shaOrNull(raw: String?): String? = raw?.trim()?.lowercase()?.takeIf { SHA.matches(it) }

    /**
     * scheme + host + port + path, with the query and fragment stripped exactly
     * as the service worker strips them (player-005: a signed URL's token
     * rotates, the object does not). Null for anything that is not a plain
     * https URL with a clean path.
     */
    fun stableKey(url: String?): String? = runCatching {
        val u = URI(url!!.trim())
        val host = u.host?.lowercase() ?: return null
        if (u.scheme?.lowercase() != "https" || u.rawUserInfo != null) return null
        val path = u.rawPath ?: return null
        if (!path.startsWith("/") || path.contains("..") || path.contains('\\') || path.contains("//")) return null
        val port = if (u.port == -1 || u.port == 443) "" else ":${u.port}"
        "https://$host$port$path"
    }.getOrNull()

    /** The lane file name for a stable key: its SHA-256, never a URL segment. */
    fun laneId(stableKey: String): String = Hashing.hex(MessageDigest.getInstance("SHA-256").digest(stableKey.toByteArray(Charsets.UTF_8)))
}

internal class StoreLayout(filesDir: File) {
    val root = File(filesDir, StoreNames.ROOT)
    val index = File(root, StoreNames.INDEX)
    val work = File(root, StoreNames.WORK)

    fun tenantDir(tenant: String): File {
        require(StoreNames.isTenant(tenant)) { "store-tenant" }
        return File(root, tenant)
    }

    /** A content file is named by its digest alone. */
    fun contentFile(tenant: String, sha256: String): File {
        require(StoreNames.isSha(sha256)) { "store-digest" }
        return File(tenantDir(tenant), sha256)
    }

    /** A lane file is named by the digest of its stable key. */
    fun laneFile(tenant: String, laneId: String): File {
        require(StoreNames.isSha(laneId)) { "store-lane" }
        return File(File(tenantDir(tenant), StoreNames.LANE), laneId)
    }

    fun fileFor(tenant: String, id: String, lane: Boolean): File = if (lane) laneFile(tenant, id) else contentFile(tenant, id)

    fun stagingDir(tenant: String): File = File(tenantDir(tenant), StoreNames.STAGING)

    fun partFile(tenant: String, id: String, nonce: String): File {
        require(StoreNames.isSha(id) && StoreNames.isNonce(nonce)) { "store-staging" }
        return File(stagingDir(tenant), "$id.$nonce.part")
    }

    fun partMeta(tenant: String, id: String, nonce: String): File = File(partFile(tenant, id, nonce).path + ".json")

    fun emergencyFile(tenant: String): File = File(tenantDir(tenant), StoreNames.EMERGENCY)

    /** The tenant directories on disk (validated names only; anything else under the root is ignored). */
    fun tenantsOnDisk(): List<String> = root.listFiles()?.filter { it.isDirectory && StoreNames.isTenant(it.name) }?.map { it.name } ?: emptyList()
}

internal object Hashing {
    fun hex(value: ByteArray): String {
        val out = StringBuilder(value.size * 2)
        for (b in value) {
            val v = b.toInt() and 0xff
            out.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
        }
        return out.toString()
    }
    private val HEX = "0123456789abcdef".toCharArray()
}

/**
 * Crash-safe small-file writes: temp → fsync → rename. [withBackup] keeps the
 * previous good copy as `.bak` (the emergency set uses it: a torn write can
 * never lose the pins).
 */
internal object AtomicFiles {
    fun write(target: File, text: String, withBackup: Boolean = false) {
        val dir = target.parentFile ?: error("store-path")
        require(dir.isDirectory || dir.mkdirs()) { "store-unavailable" }
        val tmp = File(dir, target.name + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(text.toByteArray(Charsets.UTF_8))
            out.flush()
            out.fd.sync()
        }
        if (withBackup && target.isFile) {
            val bak = File(dir, target.name + ".bak")
            bak.delete()
            target.renameTo(bak)
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            require(tmp.renameTo(target)) { "store-publish" }
        }
    }

    /** [target] parsed, else (with [withBackup]) its `.bak` parsed; a torn or corrupt copy is skipped, never thrown. */
    fun <T> read(target: File, withBackup: Boolean = false, parse: (String) -> T?): T? {
        val candidates = if (withBackup) listOf(target, File(target.parentFile, target.name + ".bak")) else listOf(target)
        for (f in candidates) {
            val value = runCatching { if (f.isFile) parse(f.readText(Charsets.UTF_8)) else null }.getOrNull()
            if (value != null) return value
        }
        return null
    }
}
