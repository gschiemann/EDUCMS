package com.educms.player.webtabs

/**
 * What a FRESH url-overlay WebView loads after its renderer died
 * (review P2-6, 2026-10-03, player 1.1.21). Pure — the caller supplies the
 * restorability rule, so this has a JVM test.
 *
 * THE BUG. The restore used only the last URL the dead view STARTED. That is
 * unrestorable in three ordinary cases — an http page the site navigated to,
 * the Website Tabs blocked/offline page (reported as about:blank / a data
 * document), and a death before the first page start after a hide — and the
 * fresh overlay then stayed VISIBLE and EMPTY. Worse, `urlOverlayCurrentUrl`
 * still equalled the asset or tab URL, so the page's next show of the same
 * URL returned early: a blank area until the item or tab changed, forever on
 * a one-item website playlist.
 *
 * THE RULE, in order:
 *   1. what the site was showing, if it is restorable;
 *   2. else the URL the player itself asked for (`urlOverlayCurrentUrl`),
 *      which was validated when it was shown;
 *   3. else nothing — the caller HIDES the view and CLEARS the current URL,
 *      so the page's next show of that URL is a real load, not a no-op.
 */
object OverlayRestore {

    fun target(
        lastStartedUrl: String?,
        currentUrl: String?,
        restorable: (String) -> Boolean,
    ): String? = listOfNotNull(lastStartedUrl, currentUrl)
        .map { it.trim() }
        .firstOrNull { it.isNotEmpty() && restorable(it) }
}
