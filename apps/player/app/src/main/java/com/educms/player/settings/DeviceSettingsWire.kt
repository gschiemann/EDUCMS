package com.educms.player.settings

import org.json.JSONObject

/**
 * The wire format between this unit and `GET /screens/status/:fp`
 * (2026-10-18). `org.json` only, so `DeviceSettingsWireTest` runs on a plain
 * JVM against the real parser.
 *
 * SERVER → UNIT, in the heartbeat reply:
 * ```json
 * "deviceSettings": { "schema": 1, "rev": 7, "same": true }
 * "deviceSettings": { "schema": 1, "rev": 7, "items": {
 *     "brightness": { "id": "r7", "v": 80 },
 *     "wifi": { "id": "r6", "v": { "ssid": "Lobby", "security": "wpa2", "hidden": false,
 *                                  "passphrase": "…" } } } }
 * ```
 * `same` = "the set you hold (rev 7) is current". The passphrase rides only
 * while this unit has not finished that Wi-Fi identity, and only to a caller
 * that proved this screen's device credential.
 *
 * UNIT → SERVER, in the [DeviceSettings.HEADER] request header (≤ 2 KiB):
 * ```json
 * { "schema": 1, "rev": 7, "need": false, "sdk": 33,
 *   "cap": { "brightness": "ok", "autoTime": "no-secure-settings", … },
 *   "obs": { "brightness": 80, "volume": 40, "screenOffTimeoutMs": 2147483647, … },
 *   "ack": { "brightness": { "id": "r7", "st": "applied", "n": 1, "at": 1760000000000 } } }
 * ```
 * `obs` is what Android READS BACK right now; a value it will not give is
 * omitted, never guessed.
 */
object DeviceSettingsWire {

    const val SCHEMA = 1
    /** The server refuses a longer header; this side never builds one. */
    const val MAX_REPORT_CHARS = 2048
    private const val MAX_ITEMS = 16
    private val ITEM_ID = Regex("^r\\d{1,10}$")

    sealed class Reply {
        abstract val rev: Int

        /** The set this unit already holds is current. */
        data class Same(override val rev: Int) : Reply()

        /** The whole desired set at [rev] (empty = manage nothing). */
        data class Full(override val rev: Int, val items: List<DesiredItem>) : Reply()
    }

    /** Parse the `deviceSettings` block, or null when it is absent or malformed. */
    fun parseReply(block: JSONObject?): Reply? {
        if (block == null || block.optInt("schema", -1) != SCHEMA) return null
        val rev = intOrNull(block.opt("rev"))?.takeIf { it >= 0 } ?: return null
        if (block.optBoolean("same", false)) return if (rev > 0) Reply.Same(rev) else null
        val items = block.optJSONObject("items") ?: return null
        return Reply.Full(rev, parseItems(items))
    }

    /** Items, keyed by wire name. Unknown keys are ignored (an older unit, a newer server). */
    fun parseItems(items: JSONObject): List<DesiredItem> {
        val out = ArrayList<DesiredItem>()
        val names = items.keys()
        var seen = 0
        while (names.hasNext() && seen < MAX_ITEMS) {
            val name = names.next()
            seen += 1
            val key = DeviceSettingKey.fromWire(name) ?: continue
            val entry = items.optJSONObject(name) ?: continue
            val id = entry.optString("id", "").takeIf { ITEM_ID.matches(it) } ?: continue
            out.add(DesiredItem(key, id, parseValue(key, entry.opt("v"))))
        }
        return out.sortedBy { it.key.ordinal }
    }

    /** A value of the wrong type becomes [DesiredValue.Invalid] — reported, never applied. */
    fun parseValue(key: DeviceSettingKey, raw: Any?): DesiredValue = when (key) {
        DeviceSettingKey.BRIGHTNESS, DeviceSettingKey.VOLUME, DeviceSettingKey.SCREEN_OFF_TIMEOUT ->
            intOrNull(raw)?.let { DesiredValue.IntValue(it) } ?: DesiredValue.Invalid
        DeviceSettingKey.ROTATION_LOCK, DeviceSettingKey.AUTO_TIME, DeviceSettingKey.AUTO_TIME_ZONE ->
            (raw as? Boolean)?.let { DesiredValue.BoolValue(it) } ?: DesiredValue.Invalid
        DeviceSettingKey.NTP_SERVER ->
            (raw as? String)?.takeIf { it.length <= 253 }?.let { DesiredValue.TextValue(it) } ?: DesiredValue.Invalid
        DeviceSettingKey.WIFI -> wifiValue(raw as? JSONObject) ?: DesiredValue.Invalid
    }

    private fun wifiValue(o: JSONObject?): DesiredValue.WifiValue? {
        if (o == null) return null
        val ssid = o.opt("ssid") as? String ?: return null
        val security = o.opt("security") as? String ?: return null
        if (ssid.length > 64 || security.length > 8) return null
        val hidden = o.opt("hidden") as? Boolean ?: false
        val passphrase = (o.opt("passphrase") as? String)?.takeIf { it.isNotEmpty() && it.length <= 64 }
        return DesiredValue.WifiValue(ssid, security, hidden, passphrase)
    }

    /** JSON numbers arrive as Integer, Long or Double; only an exact int in range is an int. */
    fun intOrNull(raw: Any?): Int? {
        if (raw !is Number) return null
        val d = raw.toDouble()
        if (d.isNaN() || d.isInfinite() || d != Math.floor(d)) return null
        if (d < Int.MIN_VALUE.toDouble() || d > Int.MAX_VALUE.toDouble()) return null
        return d.toInt()
    }

    // ── what this unit keeps: the set WITHOUT any passphrase ─────────────

    fun encodeItems(items: List<DesiredItem>): String {
        val o = JSONObject()
        items.forEach { item ->
            val v: Any? = when (val value = item.value) {
                is DesiredValue.IntValue -> value.value
                is DesiredValue.BoolValue -> value.value
                is DesiredValue.TextValue -> value.value
                is DesiredValue.WifiValue -> JSONObject()
                    .put("ssid", value.ssid)
                    .put("security", value.security)
                    .put("hidden", value.hidden)
                // ⚠️ no passphrase — ever. A Wi-Fi item that has not landed asks for it again.
                DesiredValue.Invalid -> JSONObject.NULL
            }
            o.put(item.key.wire, JSONObject().put("id", item.id).put("v", v ?: JSONObject.NULL))
        }
        return o.toString()
    }

    fun decodeItems(raw: String?): List<DesiredItem> = runCatching {
        if (raw.isNullOrBlank()) emptyList() else parseItems(JSONObject(raw))
    }.getOrDefault(emptyList())

    fun encodeAck(a: DeviceSettingsPolicy.Ack): String = JSONObject()
        .put("id", a.id)
        .put("st", a.status.wire)
        .put("why", a.why ?: JSONObject.NULL)
        .put("n", a.attempts)
        .put("el", a.lastAttemptElapsedMs)
        .put("boot", a.boot)
        .put("at", a.appliedAtWallMs ?: JSONObject.NULL)
        .toString()

    fun decodeAck(raw: String?): DeviceSettingsPolicy.Ack? = runCatching {
        if (raw.isNullOrBlank()) return null
        val o = JSONObject(raw)
        val id = o.optString("id", "").takeIf { ITEM_ID.matches(it) } ?: return null
        val status = DeviceSettingsPolicy.Status.fromWire(o.optString("st", "")) ?: return null
        DeviceSettingsPolicy.Ack(
            id = id,
            status = status,
            why = o.optString("why", "").takeIf { it.isNotEmpty() && it != "null" },
            attempts = o.optInt("n", 0).coerceIn(0, 99),
            lastAttemptElapsedMs = o.optLong("el", 0L),
            boot = o.optInt("boot", -1),
            appliedAtWallMs = o.optLong("at", 0L).takeIf { it > 0L },
        )
    }.getOrNull()

    // ── the report ────────────────────────────────────────────────────────

    /** The observed Wi-Fi state: our suggestion's SSID (null = none / unreadable) and its approval. */
    data class WifiObserved(val ssid: String?, val approval: String)

    data class Report(
        val rev: Int,
        val need: Boolean,
        val sdk: Int,
        val capabilities: Map<DeviceSettingKey, String>,
        /** Int / Boolean / String / [WifiObserved]; a missing key = unreadable. */
        val observed: Map<DeviceSettingKey, Any>,
        val acks: Map<DeviceSettingKey, DeviceSettingsPolicy.Ack>,
        /** Heat and load facts ([DeviceLoad]); read-only, never acted on. */
        val load: DeviceLoadMath.Load? = null,
    )

    fun encodeLoad(l: DeviceLoadMath.Load): JSONObject {
        val o = JSONObject()
        l.thermalStatus?.let { o.put("thermal", it) }
        l.thermalChangedAtMs?.let { o.put("thermalAt", it) }
        l.headroom?.let { o.put("headroom", it) }
        l.processCpuPercent?.let { o.put("cpu", it) }
        l.systemCpuPercent?.let { o.put("sysCpu", it) }
        l.memAvailMb?.let { o.put("memAvailMb", it) }
        l.memTotalMb?.let { o.put("memTotalMb", it) }
        l.memLow?.let { o.put("memLow", it) }
        l.socCelsius?.let { o.put("socC", it) }
        l.thermalZones?.let { o.put("zones", it) }
        return o
    }

    fun encodeReport(r: Report): String {
        val cap = JSONObject()
        r.capabilities.toSortedMap(compareBy { it.ordinal }).forEach { (k, v) -> cap.put(k.wire, v) }
        val obs = JSONObject()
        r.observed.toSortedMap(compareBy { it.ordinal }).forEach { (k, v) ->
            when (v) {
                is WifiObserved -> obs.put(
                    k.wire,
                    JSONObject().put("ssid", v.ssid ?: JSONObject.NULL).put("approval", v.approval),
                )
                is Int, is Boolean, is String -> obs.put(k.wire, v)
            }
        }
        val ack = JSONObject()
        r.acks.toSortedMap(compareBy { it.ordinal }).forEach { (k, a) ->
            val o = JSONObject().put("id", a.id).put("st", a.status.wire).put("n", a.attempts)
            a.why?.let { o.put("why", it) }
            a.appliedAtWallMs?.let { o.put("at", it) }
            ack.put(k.wire, o)
        }
        val out = JSONObject()
        out
            .put("schema", SCHEMA)
            .put("rev", r.rev)
            .put("need", r.need)
            .put("sdk", r.sdk)
            .put("cap", cap)
            .put("obs", obs)
            .put("ack", ack)
        r.load?.let { out.put("load", encodeLoad(it)) }
        val text = asciiJson(out.toString())
        // Bounded by construction (8 keys, a 253-char host, a 32-byte SSID);
        // the observed block is the one part that could ever grow, so it is
        // what gives way rather than the whole report.
        if (text.length <= MAX_REPORT_CHARS) return text
        out.put("obs", JSONObject())
        out.remove("load")
        return asciiJson(out.toString())
    }

    /**
     * An HTTP header value must be printable ASCII — Android's HttpURLConnection
     * (OkHttp underneath) THROWS on anything else, which would cost the whole
     * report for one SSID with an accent in it. JSON's own `\uXXXX` escape
     * carries every other character, and any JSON parser reads it back.
     */
    fun asciiJson(json: String): String {
        if (json.all { it.code in 0x20..0x7e }) return json
        val sb = StringBuilder(json.length + 16)
        for (ch in json) {
            if (ch.code in 0x20..0x7e) sb.append(ch) else sb.append("\\u").append(Integer.toHexString(ch.code).padStart(4, '0'))
        }
        return sb.toString()
    }
}
