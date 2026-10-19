package com.educms.player.media

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import com.educms.player.logging.PlayerLogger
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * THE DEVICE-CLASS POLICY TABLE, in code (plan 2026-10-17 §4C).
 *
 * Behaviour is a function of the box's CLASS — its SoC family, Android
 * version and WebView — never of a per-screen token somebody once typed into
 * an env list. One place answers, for this box:
 *  • does solo native video run at all ([Resolved.nativeSolo]);
 *  • how it is composed ([Resolved.composition], the one compositing contract
 *    of [SoloVideoLayer]: above the window or not native);
 *  • whether positioned slots (protocol 3 — a template VIDEO zone, a video
 *    inside a mixed playlist) run natively ([Resolved.protocol3]): on every
 *    class that runs solo video, on the same above-window contract (the
 *    slot's surface is above the window at the zone rect, parked beyond the
 *    display until its held first frame, revealed at `play`; the WebView
 *    stays opaque black beneath it). The one limitation: page content cannot
 *    draw OVER a native slot, so a zone another zone overlaps stays web
 *    (`zone-overlap`, decided by the API and the page, which know the
 *    template) and transitions between native items are hard cuts handed
 *    over by the held first frame;
 *  • which update path this box has ([Resolved.silentUpdate]): silent as its
 *    own installer of record on Android 12+, else a tap on the glass — the
 *    Manager is never device owner (owner decision 2026-10-17).
 *
 * The APK reports what it resolved on every `sharedVideoState` reply
 * (`device`), so the dashboard can show which class a screen is in and what
 * that class does — no new bridge method (CLAUDE.md player rule 9).
 *
 * Owner rule (2026-10-17): every screen runs the BEST engine for the viewer —
 * native on every class with a hardware AVC decoder (only a NovaStar Taurus
 * is web-only), and the web engine is the AUTOMATIC FALLBACK on a refused or
 * failed native session, never the first choice.
 *
 * The decision ([resolve]) is pure and tested per fleet class
 * (DeviceClassPolicyTest); [current] gathers the Build/WebView/installer
 * facts once per process. A fact that cannot be read is reported as unknown
 * (0 / empty), never invented.
 */
internal object DeviceClassPolicy {
    enum class Soc { AMLOGIC, ROCKCHIP, NOVASTAR, OTHER }

    /**
     * The path an update takes. Owner decision 2026-10-17: the Manager is
     * NEVER device owner, so there are exactly two: silent, or a tap on the
     * glass. (A NovaStar Taurus is updated by NovaStar's ViPlex layer, not by
     * our OTA at all; it reports `tap` like every other non-silent box.)
     */
    enum class SilentUpdate(val wire: String) {
        /** Android 12+ and this APK is its own installer of record (a previous OTA installed it): USER_ACTION_NOT_REQUIRED is honoured. */
        INSTALLER_OF_RECORD("installer-of-record"),
        /** Everything else: Android's own Install dialog needs a tap on the glass. */
        TAP("tap"),
    }

    /** What the box says about itself. Every string is already lower-cased by [resolve]. */
    data class Facts(
        val sdk: Int,
        val webviewMajor: Int = 0,
        val hardware: String = "",
        val board: String = "",
        val model: String = "",
        val device: String = "",
        val product: String = "",
        val manufacturer: String = "",
        /** The NovaStar TB poster class (LedCanvas.isPosterClass, or forced in a debug build). */
        val posterClass: Boolean = false,
        /** The installer of record of this APK is this APK (a previous OTA installed it). */
        val selfInstaller: Boolean = false,
    )

    data class Resolved(
        /** `<soc>/android-<N>` — what the box IS, derived, never typed. */
        val className: String,
        /** The plan §2 fleet class this maps to, when it is one we know. */
        val fleet: String?,
        val soc: Soc,
        val sdk: Int,
        val webviewMajor: Int,
        val nativeSolo: Boolean,
        /** How a solo session is composed; null = this class is never native. */
        val composition: SoloVideoLayer.Mode?,
        val protocol3: Boolean,
        val silentUpdate: SilentUpdate,
        /** The date this class passed the on-glass checklist on THIS compositing contract; null = unqualified. */
        val qualified: String?,
    ) {
        /** The mode a session on [face] gets, or null = refuse it (the caller names the reason). */
        fun composition(protocol: Int, face: Int): SoloVideoLayer.Mode? = when {
            protocol == 2 && nativeSolo -> SoloVideoLayer.mode(protocol, face, sdk)
            protocol == 3 && protocol3 -> SoloVideoLayer.mode(protocol, face, sdk)
            else -> null
        }

        /** The stable refusal for a session that may not run, or null when it may. */
        fun refusal(protocol: Int, face: Int): String? =
            if (composition(protocol, face) == null) SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE else null

        /** The advertised positioned-slot capability: 3 wherever the table runs slots. */
        val protocolMax: Int get() = if (protocol3) 3 else 2

        /** Bounded, for `sharedVideoState.device`; never free text from the ROM. */
        fun toJson(): JSONObject = JSONObject()
            .put("class", className.take(48))
            .put("fleet", fleet?.take(96) ?: JSONObject.NULL)
            .put("soc", soc.name.lowercase(Locale.ROOT))
            .put("sdk", sdk)
            .put("webviewMajor", webviewMajor)
            .put("nativeSolo", nativeSolo)
            .put("composition", composition?.name?.lowercase(Locale.ROOT) ?: JSONObject.NULL)
            .put("protocol3", protocol3)
            .put("silentUpdate", silentUpdate.wire)
            .put("qualified", qualified ?: JSONObject.NULL)
    }

    /**
     * 1.1.42 — what the DEFAULT display runs and offers (plan §4E, the pacing
     * finding): its active refresh rate and every supported mode as
     * `modeId:WxH@Hz`, bounded. Read live on every reply, never memoised: a
     * mode switch (experiment 5, or the panel itself) must show when it happens.
     */
    data class DisplayFacts(val refreshRate: Float, val activeMode: String, val supportedModes: List<String>) {
        fun writeTo(j: JSONObject): JSONObject = j
            .put("refreshRate", refreshRate.toDouble())
            .put("activeMode", activeMode.take(48))
            .put("supportedModes", JSONArray(supportedModes.take(DisplayModePolicy.MAX_MODES).map { it.take(48) }))
    }

    /** Never throws; null when the default display cannot be read. */
    fun displayFacts(ctx: Context): DisplayFacts? = runCatching {
        val dm = ctx.applicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return@runCatching null
        val d = dm.getDisplay(Display.DEFAULT_DISPLAY) ?: return@runCatching null
        val (active, modes) = DisplayModePolicy.read(d)
        DisplayFacts(d.refreshRate, active?.label() ?: "", DisplayModePolicy.labels(active, modes))
    }.getOrNull()

    /**
     * 1.1.43 — what the PANEL FIRMWARE says, read-only and bounded, beside
     * what Android's DisplayManager says (M43 and L55VEC list ONE Android mode
     * at 30 Hz while their Choreographer runs at 60 Hz: the ROM composes at
     * 60 and drives the link at 30 — only the firmware's own tables can say
     * what the link could do). Amlogic: `/sys/class/display/mode` (the mode
     * in force, e.g. `2160p30hz`) and `/sys/class/amhdmitx/amhdmitx0/disp_cap`
     * (one capability per line, `*` marks the current). Rockchip:
     * `/sys/class/graphics/fb0/modes` (`U:1920x1080p-60` per line). A path
     * that does not exist or cannot be read is simply absent; nothing is
     * written, nothing is invented, and every string is cut to the wire
     * bound and stripped to a safe character set before it leaves the box.
     */
    data class SysDisplayFacts(val mode: String?, val caps: List<String>) {
        val any: Boolean get() = mode != null || caps.isNotEmpty()
        fun writeTo(j: JSONObject): JSONObject = j.also {
            mode?.let { m -> it.put("sysDisplayMode", m) }
            if (caps.isNotEmpty()) it.put("sysDisplayCaps", JSONArray(caps))
        }

        companion object {
            const val MODE_MAX = 48
            const val CAP_MAX = 32
            const val CAPS_MAX = 16
            /** Bytes read from one file at most; the firmware tables are a few hundred bytes. */
            const val READ_MAX = 4096
            val MODE_PATHS: List<String> = listOf("/sys/class/display/mode")
            val CAP_PATHS: List<String> = listOf("/sys/class/amhdmitx/amhdmitx0/disp_cap", "/sys/class/graphics/fb0/modes")
            private val unsafe = Regex("[^A-Za-z0-9:_.*+/@-]")

            /** The first non-empty line, stripped and cut; null when there is none. */
            fun parseMode(raw: String?): String? =
                raw?.lineSequence()?.map { clean(it, MODE_MAX) }?.firstOrNull { it.isNotEmpty() }

            /** One capability per line, stripped, cut, de-duplicated, at most [CAPS_MAX]. */
            fun parseCaps(raw: String?): List<String> =
                raw?.lineSequence()?.map { clean(it, CAP_MAX) }?.filter { it.isNotEmpty() }?.distinct()?.take(CAPS_MAX)?.toList() ?: emptyList()

            private fun clean(line: String, max: Int): String = line.trim().replace(unsafe, "").take(max)

            /** Read through [read] (a bounded file read in production; a map in tests). Never throws. */
            fun read(read: (String) -> String? = ::readBounded): SysDisplayFacts = runCatching {
                val mode = MODE_PATHS.asSequence().mapNotNull { parseMode(read(it)) }.firstOrNull()
                val caps = CAP_PATHS.asSequence().map { parseCaps(read(it)) }.firstOrNull { it.isNotEmpty() } ?: emptyList()
                SysDisplayFacts(mode, caps)
            }.getOrDefault(SysDisplayFacts(null, emptyList()))

            /** At most [READ_MAX] bytes of a readable file; null when it is absent or unreadable. Never writes. */
            fun readBounded(path: String): String? = runCatching {
                val f = java.io.File(path)
                if (!f.isFile || !f.canRead()) return@runCatching null
                f.inputStream().use { input ->
                    val buf = ByteArray(READ_MAX)
                    var n = 0
                    while (n < READ_MAX) {
                        val r = input.read(buf, n, READ_MAX - n); if (r < 0) break
                        n += r
                    }
                    String(buf, 0, n, Charsets.US_ASCII)
                }
            }.getOrNull()
        }
    }

    @Volatile private var sysMemo: Pair<Long, SysDisplayFacts>? = null
    /** The firmware tables, re-read at most every 30 s (the page polls `sharedVideoState` twice a second). Never throws. */
    fun sysDisplayFacts(nowMs: Long = android.os.SystemClock.elapsedRealtime()): SysDisplayFacts {
        sysMemo?.let { (at, facts) -> if (nowMs - at < 30_000L) return facts }
        val facts = SysDisplayFacts.read()
        sysMemo = Pair(nowMs, facts)
        return facts
    }

    private val rockchip = Regex("^(?:rk[0-9]|rockchip)")
    private val amlogic = Regex("^(?:t9[0-9]{2}|s9[0-9]{2}|sc2|a311d|t7|t5d?)(?:[^a-z0-9]|$)")
    private val novastar = Regex("taurus|novastar|nova-star|rk356x_box|rk3568")

    private fun lower(vararg values: String): List<String> = values.map { it.trim().lowercase(Locale.ROOT) }.filter { it.isNotEmpty() }

    /** The SoC family, from any of the Build strings. NovaStar is checked first: a Taurus is a Rockchip too. */
    fun soc(f: Facts): Soc {
        val strings = lower(f.hardware, f.board, f.model, f.device, f.product, f.manufacturer)
        if (f.posterClass || strings.any { novastar.containsMatchIn(it) }) return Soc.NOVASTAR
        if (strings.any { rockchip.containsMatchIn(it) }) return Soc.ROCKCHIP
        if (strings.any { it.contains("amlogic") } || lower(f.hardware, f.board, f.device, f.product).any { amlogic.containsMatchIn(it) }) return Soc.AMLOGIC
        return Soc.OTHER
    }

    /**
     * The plan §2 fleet classes (2026-10-17). A label is documentation for the
     * dashboard; the policy columns below are decided by (soc, sdk) alone.
     */
    fun fleet(soc: Soc, sdk: Int): String? = when {
        soc == Soc.NOVASTAR -> "NovaStar Taurus LED (LED Poster 1-3, Foldable LED)"
        soc == Soc.AMLOGIC && sdk == 33 -> "Amlogic t982 / Android 13 (M43, L55VEC)"
        soc == Soc.AMLOGIC && sdk == 30 -> "Amlogic t982 / Android 11 - launch class (GUQ55, GUQ65, M86, G75, G43)"
        soc == Soc.ROCKCHIP && sdk == 25 -> "Rockchip rk3288 / Android 7.1 (DH43, Mobile A-Frame, SAR55, TC22, TC32)"
        soc == Soc.ROCKCHIP && sdk == 30 -> "Rockchip rk3328 / Android 11 (VisionCore X80)"
        soc == Soc.OTHER && sdk == 28 -> "Android 9 Commercial / Chrome 66 (G24, FUH43-L, FUH43-R)"
        else -> null
    }

    /**
     * Which classes have passed the on-glass checklist ON THIS CONTRACT. None
     * yet: 1.1.41 is qualified on Tuesday 2026-10-21 by the lead, class by
     * class, and this map is filled in from that evidence — never from CI.
     */
    private val QUALIFIED: Map<String, String> = emptyMap()

    fun resolve(f: Facts): Resolved {
        val soc = soc(f)
        val sdk = f.sdk
        val className = "${soc.name.lowercase(Locale.ROOT)}/android-${androidMajor(sdk)}"
        val nativeSolo = soc != Soc.NOVASTAR && SoloVideoLayer.mode(2, 0, sdk) != null
        val silentUpdate = if (sdk >= 31 && f.selfInstaller) SilentUpdate.INSTALLER_OF_RECORD else SilentUpdate.TAP
        return Resolved(
            className = className,
            fleet = fleet(soc, sdk),
            soc = soc,
            sdk = sdk,
            webviewMajor = f.webviewMajor,
            nativeSolo = nativeSolo,
            composition = if (nativeSolo) SoloVideoLayer.mode(2, 0, sdk) else null,
            // Positioned slots run wherever solo video does, on the same contract (owner rule 2026-10-17).
            protocol3 = nativeSolo,
            silentUpdate = silentUpdate,
            qualified = QUALIFIED[className],
        )
    }

    /** Android major from the API level; the table above is keyed by API level, this is for the class name. */
    fun androidMajor(sdk: Int): Int = when {
        sdk >= 34 -> 14; sdk == 33 -> 13; sdk == 32 || sdk == 31 -> 12; sdk == 30 -> 11; sdk == 29 -> 10
        sdk == 28 -> 9; sdk == 27 || sdk == 26 -> 8; sdk == 25 || sdk == 24 -> 7; else -> 0
    }

    /** `131.0.6778.39` → 131; anything unreadable → 0. */
    fun webviewMajor(versionName: String?): Int =
        Regex("^(\\d{1,4})").find((versionName ?: "").trim())?.groupValues?.get(1)?.toIntOrNull() ?: 0

    @Volatile private var memo: Resolved? = null

    /** The resolved policy for this box, gathered once per process. Never throws. */
    fun current(ctx: Context): Resolved {
        memo?.let { return it }
        val app = ctx.applicationContext
        val facts = Facts(
            sdk = Build.VERSION.SDK_INT,
            webviewMajor = webviewMajor(webviewVersion(app)),
            hardware = Build.HARDWARE ?: "",
            board = Build.BOARD ?: "",
            model = Build.MODEL ?: "",
            device = Build.DEVICE ?: "",
            product = Build.PRODUCT ?: "",
            manufacturer = Build.MANUFACTURER ?: "",
            posterClass = runCatching { com.educms.player.led.LedCanvasHost.isPosterClass(app) }.getOrDefault(false),
            selfInstaller = runCatching { installerOfRecord(app) == app.packageName }.getOrDefault(false),
        )
        val resolved = resolve(facts)
        memo = resolved
        val display = displayFacts(app)
        PlayerLogger.i("DeviceClassPolicy", "PLAYER_DEVICE_CLASS class=${resolved.className} fleet=${resolved.fleet ?: "unlisted"} " +
            "sdk=${resolved.sdk} webview=${resolved.webviewMajor} nativeSolo=${resolved.nativeSolo} " +
            "composition=${resolved.composition?.name?.lowercase(Locale.ROOT) ?: "none"} protocol3=${resolved.protocol3} " +
            "silentUpdate=${resolved.silentUpdate.wire} qualified=${resolved.qualified ?: "no"} " +
            "refresh=${display?.refreshRate ?: 0f} activeMode=${display?.activeMode ?: "unknown"} modes=${display?.supportedModes?.joinToString(";") ?: "unknown"}")
        return resolved
    }

    /** AndroidX resolves the provider on every API level we ship to (the framework call is API 26+). */
    private fun webviewVersion(ctx: Context): String? =
        runCatching { androidx.webkit.WebViewCompat.getCurrentWebViewPackage(ctx)?.versionName }.getOrNull()

    private fun installerOfRecord(ctx: Context): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            ctx.packageManager.getInstallerPackageName(ctx.packageName)
        }

}
