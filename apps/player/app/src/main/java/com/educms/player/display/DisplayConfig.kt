package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject

/**
 * The manifest's `display` block, as the device sees it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WIRE SHAPE — MUST MATCH `DisplayManifestBlock` EXACTLY
 * ─────────────────────────────────────────────────────────────────────
 * The authority is `packages/api-types/src/display-control.ts`
 * (`DisplayManifestBlock`) as emitted by
 * `apps/api/src/display/display-manifest.ts` (`buildDisplayManifestBlock`):
 *
 * ```json
 * {
 *   "schedules": [
 *     { "id": "s1", "daysOfWeek": [1,2,3,4,5],
 *       "onTime": "07:00", "offTime": "22:00",
 *       "timezone": "America/Los_Angeles", "scope": "screen" }
 *   ],
 *   "brightness": { "minSafePercent": 5, "allowBlack": false },
 *   "vendorRecipes": [
 *     { "vendorId": "goodview-ecbox", "priority": 100, "recipe": {
 *         "vendorId": "goodview-ecbox",
 *         "match": { "manufacturer": "Goodview", "model": "ECBox3576" },
 *         "brightness": { "kind": "sysfs", "path": "/sys/class/backlight/panel0/brightness",
 *                         "valueFrom": "percent", "scale": [0, 255] },
 *         "blank":  { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
 *                     "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "0" } ] },
 *         "wake":   { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
 *                     "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] }
 *     } }
 *   ]
 * }
 * ```
 *
 * ⚠️ `vendorRecipes` IS THE NAME. THE DEVICE MOVED, NOT THE SERVER
 * (2026-08-14). This parser used to read a SINGULAR `recipe` object that
 * the server has never emitted, so a vendor recipe upsert returned 200,
 * wrote an AuditLog row, shipped in every manifest — and reached exactly
 * nothing. The server's shape is the right one and it is why it wins: it
 * ships the whole CATALOG, identical for every screen in the fleet, and
 * the DEVICE picks the row that fits its own `Build.*`. That is what
 * keeps the block independent of `Screen.displayCapabilities` and lets it
 * stay in the ETag-hashed, per-screen-cached manifest payload without
 * varying per screen. Matching on-device is [DisplayConfig.matchingRecipe].
 *
 * The singular `recipe` key is still accepted, as a single unprioritised
 * entry, so a hand-pushed config or a blob persisted by an older APK
 * keeps working. It is NOT the wire contract.
 *
 * `daysOfWeek` accepts the Int[] the server actually sends (0 = Sunday …
 * 6 = Saturday — contract C2, Prisma-authoritative), the three-letter
 * names the rest of this repo uses for `Schedule.daysOfWeek`
 * ("Mon,Tue,Wed"), or a JSON array of those names. `scope` is read and
 * ignored: precedence is already resolved server-side, and org.json
 * drops unknown keys, so it costs nothing.
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
/**
 * One row of the server's vendor-recipe CATALOG.
 *
 * `priority` mirrors `DisplayVendorRecipe.priority`; the server already
 * sorts by `priority desc, vendorId asc` and [DisplayConfig.matchingRecipe]
 * re-applies exactly that order so the device and the dashboard agree on
 * which row wins when two match the same box.
 */
data class VendorRecipeEntry(
    val vendorId: String,
    val priority: Int,
    val recipe: VendorRecipe,
)

data class DisplayConfig(
    val version: Int = 1,
    val schedules: List<DisplaySchedule> = emptyList(),
    val defaultBrightnessPercent: Int? = null,
    /**
     * `brightness.minSafePercent` as the server sent it.
     *
     * READ AND REPORTED, DELIBERATELY NOT ENFORCED HERE. The binding
     * floor stays [DisplayLimits.MIN_SAFE_BRIGHTNESS], a compile-time
     * constant on the device, because the whole point of a native floor
     * is that a compromised or mis-configured control plane cannot lower
     * it. Surfacing the server's number in
     * [DisplayControlApi.capabilitiesJson] is what lets the dashboard
     * show the two side by side instead of silently believing its own.
     */
    val serverMinSafeBrightnessPercent: Int? = null,
    /** The whole catalog; [matchingRecipe] picks this box's row. */
    val recipes: List<VendorRecipeEntry> = emptyList(),
    /** Human-readable notes about what we refused, for the ops report. */
    val warnings: List<String> = emptyList(),
) {
    /**
     * The highest-priority recipe whose `match` block fits this box, or
     * null.
     *
     * Pure — `Build.*` is passed IN rather than read here — so the
     * selection rule that decides whether a screen gets vendor power
     * control has a test that cannot be skipped for want of an emulator.
     * Nulls are coerced to "" so a ROM that reports no MODEL cannot NPE a
     * hallway kiosk; an all-null `match` still matches everything, which
     * is how a single-SKU tenant configures one recipe.
     */
    fun matchingRecipe(manufacturer: String?, model: String?, board: String?): VendorRecipe? =
        recipes
            .filter { it.recipe.match.matches(manufacturer.orEmpty(), model.orEmpty(), board.orEmpty()) }
            // Server order, re-applied: priority desc, then vendorId asc.
            .sortedWith(compareByDescending<VendorRecipeEntry> { it.priority }.thenBy { it.vendorId })
            .firstOrNull()
            ?.recipe

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
        val serverMinSafe = brightness?.let {
            if (it.has("minSafePercent")) it.optInt("minSafePercent", -1).takeIf { p -> p in 0..100 } else null
        }

        return DisplayConfig(
            version = root.optInt("version", 1),
            schedules = schedules,
            defaultBrightnessPercent = defaultBrightness,
            serverMinSafeBrightnessPercent = serverMinSafe,
            recipes = parseRecipes(root, warnings),
            warnings = warnings,
        )
    }

    /**
     * The `vendorRecipes` CATALOG (the wire contract), plus the legacy
     * singular `recipe` for back-compat.
     *
     * PARSE POSTURE, and it differs from the schedule rows on purpose: a
     * single malformed recipe is dropped INDIVIDUALLY here, because one
     * bad row in a fleet-wide catalog must not cost every OTHER vendor
     * its control. Inside one recipe nothing is partial — [RecipeParser]
     * still rejects a recipe WHOLE, since a recipe whose `wake` step was
     * silently dropped is a screen that turns off and never comes back.
     */
    private fun parseRecipes(root: JSONObject, warnings: MutableList<String>): List<VendorRecipeEntry> {
        val out = mutableListOf<VendorRecipeEntry>()

        val arr = root.optJSONArray("vendorRecipes")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val row = arr.optJSONObject(i)
                if (row == null) {
                    warnings += "vendorRecipes[$i] is not an object"
                    continue
                }
                // The recipe body is nested under `recipe`; the row's own
                // `vendorId`/`priority` are the catalog's, not the body's.
                val body = row.optJSONObject("recipe")
                if (body == null) {
                    warnings += "vendorRecipes[$i] carries no recipe object"
                    continue
                }
                val label = row.optString("vendorId", "").trim().ifEmpty { body.optString("vendorId", "?") }
                when (val check = RecipeParser.parseObject(body)) {
                    is RecipeCheck.Valid -> out += VendorRecipeEntry(
                        vendorId = check.recipe.vendorId,
                        priority = row.optInt("priority", 0),
                        recipe = check.recipe,
                    )
                    is RecipeCheck.Rejected -> {
                        // Loud: a rejected recipe means an operator
                        // configured vendor control and is not getting it.
                        PlayerLogger.e(TAG, "VENDOR RECIPE '$label' REJECTED WHOLE — ${check.reason}")
                        warnings += "recipe '$label' rejected: ${check.reason}"
                    }
                }
            }
        }

        root.optJSONObject("recipe")?.let { obj ->
            when (val check = RecipeParser.parseObject(obj)) {
                is RecipeCheck.Valid ->
                    // Lowest precedence: an explicit catalog row always
                    // beats a legacy singular one for the same box.
                    out += VendorRecipeEntry(check.recipe.vendorId, priority = Int.MIN_VALUE, recipe = check.recipe)
                is RecipeCheck.Rejected -> {
                    PlayerLogger.e(TAG, "VENDOR RECIPE REJECTED WHOLE — ${check.reason}")
                    warnings += "recipe rejected: ${check.reason}"
                }
            }
        }
        return out
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
                "${parsed.recipes.size} vendor recipe(s) in the catalog " +
                "[${parsed.recipes.joinToString(",") { it.vendorId }}], ${parsed.warnings.size} warning(s)",
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
