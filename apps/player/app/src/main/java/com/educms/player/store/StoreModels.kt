package com.educms.player.store

import org.json.JSONArray
import org.json.JSONObject

/**
 * One verification record (§5.4): a file is verified while its size, mtime and
 * inode still match what was hashed. A reboot re-hashes nothing; a moved,
 * rewritten or replaced file is unverified until it is re-hashed.
 */
internal data class StoreRecord(
    val tenant: String,
    /** The content digest, or a lane file's stable-key digest. */
    val id: String,
    val lane: Boolean,
    /** The digest of the stored bytes (for content files, equal to [id]). */
    val sha256: String,
    val size: Long,
    val mtime: Long,
    val inode: Long,
    val verifiedAt: Long,
    /** The stable key it was fetched from ("" when adopted from a local copy). */
    val sourceKey: String,
    val lastUsedAt: Long,
) {
    val key: String get() = key(tenant, id, lane)

    fun toJson(): JSONObject = JSONObject().put("t", tenant).put("id", id).put("lane", lane).put("sha", sha256)
        .put("size", size).put("mtime", mtime).put("ino", inode).put("vat", verifiedAt).put("src", sourceKey).put("used", lastUsedAt)

    companion object {
        fun key(tenant: String, id: String, lane: Boolean) = if (lane) "$tenant/u/$id" else "$tenant/$id"

        fun parse(j: JSONObject): StoreRecord? = runCatching {
            val r = StoreRecord(j.getString("t"), j.getString("id"), j.optBoolean("lane"), j.getString("sha"), j.getLong("size"),
                j.getLong("mtime"), j.optLong("ino"), j.getLong("vat"), j.optString("src", ""), j.optLong("used"))
            r.takeIf { StoreNames.isTenant(it.tenant) && StoreNames.isSha(it.id) && StoreNames.isSha(it.sha256) && it.size >= 0 && (it.lane || it.id == it.sha256) }
        }.getOrNull()
    }
}

/** A content file the face's OWN authenticated manifest names (identity + where to fetch it). */
internal data class ContentItem(val sha256: String, val url: String, val stableKey: String, val size: Long, val mime: String?) {
    /** Native plays MP4 video; phase 1 stores video only (images and documents stay with the worker until phase 2). */
    val video: Boolean get() = mime?.lowercase()?.startsWith("video/") ?: VIDEO_PATH.containsMatchIn(stableKey)

    fun toJson(): JSONObject = JSONObject().put("sha", sha256).put("url", url).put("size", size).put("mime", mime ?: JSONObject.NULL)

    companion object {
        private val VIDEO_PATH = Regex("\\.(mp4|m4v|mov)$", RegexOption.IGNORE_CASE)

        /** Null unless every field is valid AND the URL is on the storage allowlist. */
        fun of(sha: Any?, size: Any?, url: Any?, mime: Any?, storageAllowed: (String) -> Boolean): ContentItem? {
            val s = StoreNames.shaOrNull(sha as? String) ?: return null
            val n = (size as? Number)?.toLong() ?: return null
            val u = url as? String ?: return null
            if (n <= 0 || n > StorePolicy.MAX_FILE_BYTES || !storageAllowed(u)) return null
            val key = StoreNames.stableKey(u) ?: return null
            val m = (mime as? String)?.takeIf { it.length in 1..100 }
            return ContentItem(s, u, key, n, m)
        }

        fun parse(j: JSONObject, storageAllowed: (String) -> Boolean): ContentItem? =
            of(j.opt("sha"), j.opt("size"), j.opt("url"), if (j.isNull("mime")) null else j.opt("mime"), storageAllowed)
    }
}

/** The store's last AUTHENTICATED read of one face's manifest, persisted so an offline boot keeps it. */
internal data class FaceSource(
    val face: Int,
    val screenId: String,
    val tenant: String,
    val etag: String?,
    /** Manifest order, unique by digest. */
    val items: List<ContentItem>,
    /** The server's own native selection for this face (`nativeVideo.asset.sha256`), if any. */
    val nativeSha: String?,
    val enrolled: Boolean,
    val fetchedAt: Long,
) {
    fun item(sha: String): ContentItem? = items.firstOrNull { it.sha256 == sha }

    fun toJson(): JSONObject = JSONObject().put("face", face).put("screen", screenId).put("tenant", tenant)
        .put("etag", etag ?: JSONObject.NULL).put("native", nativeSha ?: JSONObject.NULL).put("enrolled", enrolled)
        .put("at", fetchedAt).put("items", JSONArray().also { a -> items.forEach { a.put(it.toJson()) } })

    companion object {
        fun parse(j: JSONObject, storageAllowed: (String) -> Boolean): FaceSource? = runCatching {
            val tenant = StoreNames.tenantOrNull(j.getString("tenant")) ?: return null
            val a = j.optJSONArray("items") ?: JSONArray()
            val items = (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let { o -> ContentItem.parse(o, storageAllowed) } }
            FaceSource(j.getInt("face"), j.getString("screen"), tenant, if (j.isNull("etag")) null else j.optString("etag"),
                items, StoreNames.shaOrNull(if (j.isNull("native")) null else j.optString("native")), j.optBoolean("enrolled"), j.optLong("at"))
        }.getOrNull()
    }
}

/**
 * One emergency asset: content-addressed when the server published a digest,
 * the URL-keyed lane when it did not (key = the stable key's digest).
 */
internal data class EmergencyEntry(val key: String, val sha256: String?, val url: String, val stableKey: String, val size: Long) {
    val lane: Boolean get() = sha256 == null

    fun toJson(): JSONObject = JSONObject().put("sha", sha256 ?: JSONObject.NULL).put("url", url).put("size", size)

    companion object {
        /** Null when the URL is not a storage URL the store may fetch. A malformed digest is a null digest (the lane), as the worker treats it. */
        fun of(sha: String?, url: String?, size: Long, storageAllowed: (String) -> Boolean): EmergencyEntry? {
            val u = url ?: return null
            if (!storageAllowed(u)) return null
            val key = StoreNames.stableKey(u) ?: return null
            val s = StoreNames.shaOrNull(sha)
            return EmergencyEntry(s ?: StoreNames.laneId(key), s, u, key, size.coerceIn(0L, StorePolicy.MAX_FILE_BYTES))
        }

        fun parse(j: JSONObject, storageAllowed: (String) -> Boolean): EmergencyEntry? =
            of(if (j.isNull("sha")) null else j.optString("sha"), j.optString("url", ""), j.optLong("size"), storageAllowed)
    }
}

internal data class EmergencySet(val hash: String, val entries: List<EmergencyEntry>) {
    fun toJson(): JSONObject = JSONObject().put("hash", hash).put("entries", JSONArray().also { a -> entries.forEach { a.put(it.toJson()) } })

    companion object {
        fun parse(j: JSONObject?, storageAllowed: (String) -> Boolean): EmergencySet? = runCatching {
            if (j == null) return null
            val hash = j.getString("hash")
            val a = j.getJSONArray("entries")
            EmergencySet(hash, (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let { o -> EmergencyEntry.parse(o, storageAllowed) } })
        }.getOrNull()
    }
}

/**
 * THE PINNED EMERGENCY SET (§5.5, §7 E3) — life-safety, so every transition is a
 * pure function with one test per guarantee (`EmergencyPinTest`):
 *
 * - RAISE-NEVER-RELEASE: [raise] and [onFresh] only ever ADD pins. The pinned
 *   set shrinks in exactly one place — [tryCommit], when a fresh, non-empty set
 *   from the server of record is COMPLETE on disk (commit-then-unpin). A cached
 *   manifest, an offline boot, a failed fetch can never unpin.
 * - EMPTY = NO DATA: [onFresh] of an empty list changes nothing (F5).
 * - The set-hash ([reportedHash]) moves only at commit, i.e. only when every
 *   file of the set is on disk.
 * - Null-digest files are keyed by URL: once present they are current, and only
 *   a URL change replaces them (F4) — presence, never content, is checked.
 */
internal data class EmergencyState(
    val committed: EmergencySet? = null,
    val pending: EmergencySet? = null,
    val pinned: Set<String> = emptySet(),
) {
    fun onFresh(set: EmergencySet): EmergencyState {
        if (set.entries.isEmpty()) return this
        if (pending == null && committed?.hash == set.hash) return this
        if (pending?.hash == set.hash) return this
        return copy(pending = set, pinned = pinned + set.entries.map { it.key })
    }

    fun raise(keys: Collection<String>): EmergencyState = if (pinned.containsAll(keys)) this else copy(pinned = pinned + keys)

    fun tryCommit(present: (EmergencyEntry) -> Boolean): EmergencyState {
        val p = pending ?: return this
        if (!p.entries.all(present)) return this
        return EmergencyState(committed = p, pending = null, pinned = p.entries.map { it.key }.toSet())
    }

    fun complete(present: (EmergencyEntry) -> Boolean): Boolean =
        committed != null && pending == null && committed.entries.all(present)

    /** The set-hash the store reports: the last COMPLETE set's, never a pending one's. */
    fun reportedHash(): String? = committed?.hash

    fun knows(hash: String): Boolean = committed?.hash == hash || pending?.hash == hash

    /** Every file the store must hold, newest set first (missing ones are fetched before any content). */
    fun wanted(): List<EmergencyEntry> {
        val seen = HashSet<String>()
        return ((pending?.entries ?: emptyList()) + (committed?.entries ?: emptyList())).filter { seen.add(it.key) }
    }

    fun toJson(): String = JSONObject().put("v", 1)
        .put("committed", committed?.toJson() ?: JSONObject.NULL)
        .put("pending", pending?.toJson() ?: JSONObject.NULL)
        .put("pinned", JSONArray(pinned.sorted())).toString()

    companion object {
        fun parse(text: String, storageAllowed: (String) -> Boolean): EmergencyState? = runCatching {
            val j = JSONObject(text)
            if (j.optInt("v") != 1) return null
            val a = j.optJSONArray("pinned") ?: JSONArray()
            EmergencyState(
                EmergencySet.parse(j.optJSONObject("committed"), storageAllowed),
                EmergencySet.parse(j.optJSONObject("pending"), storageAllowed),
                (0 until a.length()).map { a.getString(it) }.filter { StoreNames.isSha(it) }.toSet(),
            )
        }.getOrNull()
    }
}

/** Parsers for the store's two authenticated sources (§5.2). */
internal object StoreSourceParser {
    const val MAX_ITEMS = 512

    sealed class ManifestRead {
        data class Content(val source: FaceSource) : ManifestRead()
        /** An alert is live: the content set is NOT replaced (the intent survives the alert); its media is raised into the pins. */
        data class Alert(val tenant: String, val media: List<EmergencyEntry>) : ManifestRead()
    }

    fun manifest(
        j: JSONObject, face: Int, expectedScreen: String, etag: String?, now: Long,
        storageAllowed: (String) -> Boolean, enrolledBy: (JSONObject) -> Boolean,
    ): ManifestRead {
        val tenant = StoreNames.tenantOrNull(j.optString("tenantId", "")) ?: error("manifest-tenant")
        require(j.optString("screenId", "").equals(expectedScreen, ignoreCase = true)) { "manifest-identity" }
        val playlists = j.optJSONArray("playlists") ?: JSONArray()
        if (j.optBoolean("isEmergency", false)) {
            val media = LinkedHashMap<String, EmergencyEntry>()
            forEachItem(playlists) { item ->
                val size = item.optLong("asset_size", 0L)
                EmergencyEntry.of(if (item.isNull("asset_hash")) null else item.optString("asset_hash"), item.optString("url", ""), size, storageAllowed)
                    ?.let { e -> media.putIfAbsent(e.key, e) }
            }
            return ManifestRead.Alert(tenant, media.values.toList())
        }
        val items = LinkedHashMap<String, ContentItem>()
        forEachItem(playlists) { item ->
            if (items.size < MAX_ITEMS) ContentItem.of(item.opt("asset_hash"), item.opt("asset_size"), item.opt("url"),
                if (item.isNull("mime_type")) null else item.opt("mime_type"), storageAllowed)?.let { c -> items.putIfAbsent(c.sha256, c) }
        }
        var nativeSha: String? = null
        j.optJSONObject("nativeVideo")?.optJSONObject("asset")?.let { a ->
            ContentItem.of(a.opt("sha256"), a.opt("size"), a.opt("url"), "video/mp4", storageAllowed)?.let { c ->
                nativeSha = c.sha256
                items.putIfAbsent(c.sha256, c)
            }
        }
        return ManifestRead.Content(FaceSource(face, expectedScreen, tenant, etag, items.values.toList(), nativeSha, enrolledBy(j), now))
    }

    private fun forEachItem(playlists: JSONArray, each: (JSONObject) -> Unit) {
        for (p in 0 until minOf(playlists.length(), 64)) {
            val items = playlists.optJSONObject(p)?.optJSONArray("items") ?: continue
            for (i in 0 until minOf(items.length(), MAX_ITEMS)) items.optJSONObject(i)?.let(each)
        }
    }

    /**
     * `GET /screens/:id/emergency-assets`. Null = NO DATA (wrong tenant or
     * screen, malformed); an empty set is returned as-is and is ALSO no data to
     * [EmergencyState.onFresh].
     */
    fun emergencyAssets(j: JSONObject, expectedTenant: String, expectedScreen: String, storageAllowed: (String) -> Boolean): EmergencySet? {
        if (StoreNames.tenantOrNull(j.optString("tenantId", "")) != expectedTenant) return null
        if (!j.optString("screenId", "").equals(expectedScreen, ignoreCase = true)) return null
        val a = j.optJSONArray("assets") ?: return null
        val entries = LinkedHashMap<String, EmergencyEntry>()
        for (i in 0 until minOf(a.length(), MAX_ITEMS)) {
            val o = a.optJSONObject(i) ?: continue
            EmergencyEntry.of(if (o.isNull("sha256")) null else o.optString("sha256"), o.optString("url", ""), o.optLong("size", 0L), storageAllowed)
                ?.let { entries.putIfAbsent(it.key, it) }
        }
        val list = entries.values.toList()
        val hash = StoreNames.shaOrNull(j.optString("setHash", "")) ?: setHashOf(list)
        return EmergencySet(hash, list)
    }

    /** The server's own set-hash formula (sorted `url:sha|…`), used only when the answer carries none. */
    fun setHashOf(entries: List<EmergencyEntry>): String =
        Hashing.hex(java.security.MessageDigest.getInstance("SHA-256").digest(
            entries.map { "${it.url}:${it.sha256 ?: "null"}" }.sorted().joinToString("|").toByteArray(Charsets.UTF_8)))
}
