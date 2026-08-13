package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject

/**
 * The manifest's `display` block, as the device sees it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WIRE SHAPE
 * ─────────────────────────────────────────────────────────────────────
 * ```json
 * {
 *   "version": 1,
 *   "timezone": "America/Los_Angeles",
 *   "brightness": { "defaultPercent": 80 },
 *   "schedules": [
 *     { "id": "s1", "daysOfWeek": ["Mon","Tue","Wed","Thu","Fri"],
 *       "onTime": "07:00", "offTime": "22:00",
 *       "timezone": "America/Los_Angeles", "isActive": true }
 *   ],
 *   "recipe": {
 *     "vendorId": "goodview-ecbox",
 *     "match": { "manufacturer": "Goodview", "model": "ECBox3576" },
 *     "brightness": { "kind": "sysfs", "path": "/sys/class/backlight/panel0/brightness",
 *                     "valueFrom": "percent", "scale": [0, 255] },
 *     "blank":  { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
 *                 "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "0" } ] },
 *     "wake":   { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
 *                 "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] }
 *   }
 * }
 * ```
 *
 * `daysOfWeek` accepts the three-letter names the rest of this repo uses
 * for `Schedule.daysOfWeek` ("Mon,Tue,Wed" — see
 * `apps/web/src/app/player/page.tsx`), a JSON array of those names, or a
 * JSON array of 0..6 integers (0 = Sunday, matching `Date.getDay()`).
 *
 * ─────────────────────────────────────────────────────────────────────
 * MANIFEST-CACHE RULE (CLAUDE.md rule 7) — READ BEFORE EXTENDING
 * ─────────────────────────────────────────────────────────────────────
 * This block is part of the ETag-hashed manifest payload, so it must
 * carry ONLY STABLE fields. Schedule rows, a brightness policy and a
 * vendor recipe are stable. A "next fire time", a device clock, or any
 * per-request value is NOT, and adding one would bust every 304 fleet-
 * wide and re-create the 25 GB/mo Supabase egress the manifest hot-cache
 * was built to kill. The device computes its own next fire time from
 * these rows; it never receives one.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PARSE POSTURE
 * ─────────────────────────────────────────────────────────────────────
 * Malformed SCHEDULE rows are dropped individually — a typo in one row
 * must not disarm the other four, and a dropped row means "this rule
 * does nothing", which is the safe reading.
 *
 * A malformed RECIPE is rejected WHOLE, because a recipe with its
 * `wake` step silently dropped is a screen that turns off and never
 * comes back. Same reason `onTime == offTime` drops the row instead of
 * guessing between "always on" and "never on".
 */
data class DisplayConfig(
    val version: Int = 1,
    val schedules: List<DisplaySchedule> = emptyList(),
    val defaultBrightnessPercent: Int? = null,
    val recipe: VendorRecipe? = null,
    /** Human-readable notes about what we refused, for the ops report. */
    val warnings: List<String> = emptyList(),
) {
    companion object {
        val EMPTY = DisplayConfig()
    }
}

object DisplayConfigParser {

    private const val TAG = "DisplayConfig"

    /** Never throws. A block we cannot read at all becomes EMPTY. */
    fun parse(raw: String?): DisplayConfig {
        if (raw.isNullOrBlank()) return DisplayConfig.EMPTY
        val root = try {
            JSONObject(raw)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "display block is not JSON — ignoring (${raw.length} chars)")
            return DisplayConfig(warnings = listOf("display block is not valid JSON"))
        }
        val warnings = mutableListOf<String>()

        val defaultTz = root.optString("timezone", "").trim().ifEmpty { null }
        val schedules = parseSchedules(root.optJSONArray("schedules"), defaultTz, warnings)

        val brightness = root.optJSONObject("brightness")
        val defaultBrightness = brightness?.let {
            if (it.has("defaultPercent")) it.optInt("defaultPercent", -1).takeIf { p -> p in 0..100 } else null
        }

        val recipe = root.optJSONObject("recipe")?.let { obj ->
            when (val check = RecipeParser.parseObject(obj)) {
                is RecipeCheck.Valid -> check.recipe
                is RecipeCheck.Rejected -> {
                    // Loud: a rejected recipe means an operator configured
                    // vendor control and is not getting it.
                    PlayerLogger.e(TAG, "VENDOR RECIPE REJECTED WHOLE — ${check.reason}")
                    warnings += "recipe rejected: ${check.reason}"
                    null
                }
            }
        }

        return DisplayConfig(
            version = root.optInt("version", 1),
            schedules = schedules,
            defaultBrightnessPercent = defaultBrightness,
            recipe = recipe,
            warnings = warnings,
        )
    }

    private fun parseSchedules(
        arr: JSONArray?,
        defaultTz: String?,
        warnings: MutableList<String>,
    ): List<DisplaySchedule> {
        if (arr == null) return emptyList()
        val out = mutableListOf<DisplaySchedule>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i)
            if (obj == null) {
                warnings += "schedule[$i] is not an object"
                continue
            }
            if (obj.has("isActive") && !obj.optBoolean("isActive", true)) continue

            val id = obj.optString("id", "schedule-$i").take(64)
            // optString(name) yields "" for a missing key, which
            // parseHHmm rejects — so a schedule row with no times is
            // dropped rather than defaulted to midnight.
            val on = DisplayScheduleMath.parseHHmm(obj.optString("onTime"))
            val off = DisplayScheduleMath.parseHHmm(obj.optString("offTime"))
            if (on == null || off == null) {
                warnings += "schedule '$id' dropped — onTime/offTime is not HH:mm"
                continue
            }
            if (on == off) {
                // Ambiguous between "always on" and "never on"; on a
                // wall-mounted screen one of those readings is a dark
                // display nobody can reach. Refuse to guess.
                warnings += "schedule '$id' dropped — onTime equals offTime"
                continue
            }
            val days = parseDays(obj.opt("daysOfWeek"))
            if (days.isEmpty()) {
                warnings += "schedule '$id' dropped — no valid days of week"
                continue
            }
            val tz = obj.optString("timezone", "").trim().ifEmpty { defaultTz }
            if (tz.isNullOrEmpty()) {
                warnings += "schedule '$id' dropped — no timezone (screen timezone is required)"
                continue
            }
            out += DisplaySchedule(
                id = id,
                daysOfWeek = days,
                onMinuteOfDay = on,
                offMinuteOfDay = off,
                timezone = tz,
            )
        }
        return out
    }

    /** Accepts a JSON array of ints/names, or a "Mon,Tue" string. */
    internal fun parseDays(value: Any?): Set<Int> {
        val out = sortedSetOf<Int>()
        when (value) {
            is JSONArray -> for (i in 0 until value.length()) {
                val token = value.opt(i)
                val day = when (token) {
                    is Int -> if (token in 0..6) token else null
                    is Number -> token.toInt().takeIf { it in 0..6 }
                    else -> DisplayScheduleMath.parseDayToken(token?.toString())
                }
                if (day != null) out += day
            }
            is String -> value.split(",", " ", ";")
                .mapNotNull { DisplayScheduleMath.parseDayToken(it) }
                .forEach { out += it }
            else -> Unit
        }
        return out
    }
}

/**
 * JSON → [VendorRecipe] → [RecipeValidator]. The ONLY way a recipe
 * object is ever constructed from untrusted text: validation is part of
 * the parse, so there is no code path that yields an unvalidated recipe.
 */
object RecipeParser {

    fun parse(raw: String?): RecipeCheck {
        if (raw.isNullOrBlank()) return RecipeCheck.Rejected("recipe is empty")
        val obj = try {
            JSONObject(raw)
        } catch (t: Throwable) {
            return RecipeCheck.Rejected("recipe is not valid JSON")
        }
        return parseObject(obj)
    }

    fun parseObject(obj: JSONObject): RecipeCheck {
        return try {
            val vendorId = obj.optString("vendorId", "").trim()
            if (vendorId.isEmpty()) return RecipeCheck.Rejected("recipe has no vendorId")

            val matchObj = obj.optJSONObject("match")
            val match = RecipeMatch(
                manufacturer = matchObj?.optString("manufacturer", "")?.trim()?.ifEmpty { null },
                model = matchObj?.optString("model", "")?.trim()?.ifEmpty { null },
                board = matchObj?.optString("board", "")?.trim()?.ifEmpty { null },
            )

            val brightness = parseStep(obj.optJSONObject("brightness"))
            val blank = parseStep(obj.optJSONObject("blank"))
            val wake = parseStep(obj.optJSONObject("wake"))

            // A step object that was PRESENT but unparseable rejects the
            // whole recipe rather than silently becoming "no step".
            if (obj.has("brightness") && obj.optJSONObject("brightness") != null && brightness == null) {
                return RecipeCheck.Rejected("brightness step has an unknown or malformed kind")
            }
            if (obj.has("blank") && obj.optJSONObject("blank") != null && blank == null) {
                return RecipeCheck.Rejected("blank step has an unknown or malformed kind")
            }
            if (obj.has("wake") && obj.optJSONObject("wake") != null && wake == null) {
                return RecipeCheck.Rejected("wake step has an unknown or malformed kind")
            }

            RecipeValidator.validate(
                VendorRecipe(
                    vendorId = vendorId,
                    match = match,
                    brightness = brightness,
                    blank = blank,
                    wake = wake,
                ),
            )
        } catch (t: Throwable) {
            RecipeCheck.Rejected("recipe parse threw: ${t.message ?: t.javaClass.simpleName}")
        }
    }

    private fun parseStep(obj: JSONObject?): RecipeStep? {
        if (obj == null) return null
        return when (obj.optString("kind", "").trim().lowercase()) {
            "broadcast" -> RecipeStep.Broadcast(
                action = obj.optString("action", "").trim(),
                extras = parseExtras(obj.optJSONArray("extras")),
            )
            "sysfs" -> {
                val fromPercent = obj.optString("valueFrom", "").trim().equals("percent", ignoreCase = true)
                RecipeStep.Sysfs(
                    path = obj.optString("path", "").trim(),
                    literal = obj.optString("value", "").trim().ifEmpty { null },
                    fromPercent = fromPercent,
                    scale = parseScale(obj.optJSONArray("scale")),
                )
            }
            "settings" -> RecipeStep.SettingsWrite(
                key = obj.optString("key", "").trim(),
                scale = parseScale(obj.optJSONArray("scale")),
            )
            else -> null
        }
    }

    private fun parseExtras(arr: JSONArray?): List<RecipeExtra> {
        if (arr == null) return emptyList()
        val out = mutableListOf<RecipeExtra>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val type = when (o.optString("type", "").trim().lowercase()) {
                "int" -> RecipeExtraType.INT
                "bool", "boolean" -> RecipeExtraType.BOOL
                else -> RecipeExtraType.STRING
            }
            val from = when (o.optString("from", "").trim().lowercase()) {
                "percent" -> RecipeValueSource.PERCENT
                else -> RecipeValueSource.LITERAL
            }
            out += RecipeExtra(
                key = o.optString("key", "").trim(),
                type = type,
                from = from,
                literal = o.optString("value", "").trim().ifEmpty { null },
                scale = parseScale(o.optJSONArray("scale")),
            )
        }
        return out
    }

    private fun parseScale(arr: JSONArray?): RecipeScale? {
        if (arr == null || arr.length() != 2) return null
        val min = arr.opt(0)
        val max = arr.opt(1)
        if (min !is Number || max !is Number) return null
        return RecipeScale(min.toInt(), max.toInt())
    }
}

/**
 * Persist + reload the `display` block.
 *
 * The RAW JSON is what we store, and it is re-parsed AND re-validated on
 * every load. Storing the parsed object would mean trusting a blob that
 * an older build with weaker rules may have written; re-validating on
 * read is how a device that took a bad recipe under an older APK
 * self-heals the moment it takes this one (the same shape as
 * `HostAllowlist.sanitizePersistedApiRoot`).
 */
object DisplayConfigStore {

    private const val TAG = "DisplayConfig"

    @Volatile
    private var cache: DisplayConfig? = null

    @Volatile
    private var cachedRaw: String? = null

    fun load(ctx: Context): DisplayConfig {
        val raw = DisplayPrefs.configJson(ctx)
        val hit = cache
        if (hit != null && cachedRaw == raw) return hit
        val parsed = DisplayConfigParser.parse(raw)
        cache = parsed
        cachedRaw = raw
        return parsed
    }

    /**
     * Validate then persist. Returns the parsed config so the caller can
     * report how many schedule rows were accepted and what was refused.
     * A block whose schedules ALL fail still persists — the operator
     * needs the warnings to be visible, and an empty schedule list means
     * "no opinion", never "blank the screen".
     */
    fun save(ctx: Context, raw: String?): DisplayConfig {
        val parsed = DisplayConfigParser.parse(raw)
        DisplayPrefs.setConfigJson(ctx, raw)
        cache = parsed
        cachedRaw = raw
        PlayerLogger.i(
            TAG,
            "display config saved — ${parsed.schedules.size} schedule(s), " +
                "recipe=${parsed.recipe?.vendorId ?: "none"}, ${parsed.warnings.size} warning(s)",
        )
        parsed.warnings.forEach { PlayerLogger.w(TAG, "config warning: $it") }
        return parsed
    }

    /** Drop the in-memory cache (tests, and after an external prefs edit). */
    fun invalidate() {
        cache = null
        cachedRaw = null
    }
}
