package com.educms.player.setup

/**
 * WHICH APP A SETUP BUTTON IS ALLOWED TO OPEN (2026-10-05, player 1.1.23).
 *
 * ── THE FIELD FAILURE ────────────────────────────────────────────────
 *
 * VisionCore "X80" (Rockchip RK3328, Android 11, a GOODVIEW firmware with
 * its own `com.goodview.settings` + `com.goodview.launcher`), owner on site,
 * remote only: *"pressing Enter on the setup card opens a Google web page
 * instead of a system Settings screen; Back returns to the same card; the
 * D-pad cannot get anywhere else"* — a loop with no way out but a power
 * cycle.
 *
 * Every row of the checklist used to end in `startActivity(<implicit
 * Settings intent>)` and nothing asked WHICH app the ROM would resolve it
 * to. A browser, a search app, or a chooser whose first entry is a browser
 * were launched exactly like a Settings page. There is no URL anywhere in
 * the setup code, so a web page on the glass can only come from how a ROM
 * resolves one of those implicit intents.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────
 *
 * A setup button opens a page only when the ROM resolves its intent to a
 * SYSTEM app that is not a web browser, not a search/assistant app, not the
 * Android chooser and not one of our own apps — and it then opens THAT
 * component explicitly, so no chooser can appear and no other app can
 * answer. Anything else is not a Settings page on this screen, and the row
 * says so in plain words instead of opening it.
 *
 * Pure: no Context, no PackageManager — [SetupFactsReader] reads the facts,
 * this decides. Every rule has a JVM test (SettingsPagePolicyTest).
 */

/** One app that can answer a Settings intent on this box. */
data class PageHandler(
    val packageName: String,
    val activityName: String,
    /** Part of the system image (`FLAG_SYSTEM` or an updated system app). */
    val systemApp: Boolean,
    /** Also answers a plain `https://` link — i.e. it is a web browser. */
    val browser: Boolean,
    /** What the app is called on this box, for the row's "opens …" line. */
    val label: String? = null,
)

/** What one intent resolves to on this box, as PackageManager reports it. */
data class IntentResolution(
    /** `queryIntentActivities(MATCH_DEFAULT_ONLY)`, in the ROM's own order. */
    val handlers: List<PageHandler>,
    /**
     * `resolveActivity(MATCH_DEFAULT_ONLY)` — the ROM's default. Null when
     * nothing resolves; the Android chooser shows up here as package
     * `android` when two or more apps answer and none is the default.
     */
    val defaultHandler: PageHandler?,
)

/** What a setup button may do with one intent. */
sealed class PageDecision {
    /** Open exactly this component. */
    data class Open(val handler: PageHandler) : PageDecision()

    /** Do not open anything. [code] is stable; [reason] is for the log + report. */
    data class Refuse(val code: String, val reason: String) : PageDecision()
}

object SettingsPagePolicy {

    /** Nothing on this box answers the intent at all. */
    const val REFUSE_NO_PAGE = "no-page"

    /** Something answers, but it is not a Settings page (a browser, a search app, a non-system app…). */
    const val REFUSE_NOT_SETTINGS = "not-a-settings-app"

    /** The Android chooser / resolver lives in the `android` package. Never a Settings page. */
    const val CHOOSER_PACKAGE = "android"

    /**
     * Web browsers, search and assistant apps that a ROM has been seen — or
     * could plausibly be configured — to hand a Settings intent to. The
     * generic test is [PageHandler.browser] (the app answers a plain https
     * link); this list catches the ones that do not, such as the Google
     * search app on a TV box, whose links are app-scoped.
     */
    val WEB_PACKAGES: Set<String> = setOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.chromium.chrome",
        "org.chromium.webview_shell",
        "com.android.browser",
        "com.google.android.googlequicksearchbox",
        "com.google.android.katniss",
        "com.google.android.apps.searchlite",
        "com.android.webview",
        "com.google.android.webview",
        "org.mozilla.firefox",
        "com.opera.browser",
        "com.microsoft.emmx",
        "com.amazon.cloud9",
    )

    /** May a setup button open this handler? */
    fun acceptable(handler: PageHandler, ownPackages: Set<String>): Boolean =
        handler.systemApp &&
            !handler.browser &&
            handler.packageName != CHOOSER_PACKAGE &&
            handler.packageName !in WEB_PACKAGES &&
            handler.packageName !in ownPackages

    /**
     * The decision for one intent.
     *
     * The ROM's default wins when it is acceptable — that is the page the
     * operator would have reached by hand. Otherwise the first acceptable
     * handler in the ROM's own order, which is what picks the Settings app
     * out of a "Settings or Chrome?" chooser. Otherwise nothing.
     */
    fun decide(resolution: IntentResolution, ownPackages: Set<String>): PageDecision {
        val default = resolution.defaultHandler
        if (default != null && acceptable(default, ownPackages)) return PageDecision.Open(default)
        resolution.handlers.firstOrNull { acceptable(it, ownPackages) }?.let { return PageDecision.Open(it) }
        val seen = (listOfNotNull(default) + resolution.handlers)
            .filter { it.packageName != CHOOSER_PACKAGE }
            .map { it.packageName }
            .distinct()
        return if (seen.isEmpty()) {
            PageDecision.Refuse(REFUSE_NO_PAGE, "nothing on this screen opens this page")
        } else {
            PageDecision.Refuse(
                REFUSE_NOT_SETTINGS,
                "this screen sends this page to ${seen.joinToString(", ")} — not a Settings app",
            )
        }
    }

    /**
     * One setup step's route: the page its button opens, worked out from the
     * direct intent first and the broader fallback second.
     */
    data class StepRoute(
        /** The component the button opens, or null when nothing acceptable exists. */
        val handler: PageHandler?,
        /** True when [handler] is the FALLBACK page (the direct one is missing or refused). */
        val viaFallback: Boolean,
        /** Why the direct page was not used — null when it was. */
        val directRefusal: PageDecision.Refuse?,
        /** Why nothing at all can be opened — null when something can. */
        val refusal: PageDecision.Refuse?,
    ) {
        val available: Boolean get() = handler != null
    }

    /** Combine the direct and fallback decisions into the step's route. */
    fun route(direct: PageDecision, fallback: PageDecision?): StepRoute = when {
        direct is PageDecision.Open -> StepRoute(direct.handler, false, null, null)
        fallback is PageDecision.Open ->
            StepRoute(fallback.handler, true, direct as PageDecision.Refuse, null)
        else -> StepRoute(
            handler = null,
            viaFallback = false,
            directRefusal = direct as PageDecision.Refuse,
            refusal = (fallback as? PageDecision.Refuse)?.let { fb ->
                // Report the more specific of the two: "Chrome answers this"
                // tells the lead more than "nothing answers the fallback".
                if (direct.code == REFUSE_NOT_SETTINGS) direct else fb
            } ?: direct,
        )
    }
}
