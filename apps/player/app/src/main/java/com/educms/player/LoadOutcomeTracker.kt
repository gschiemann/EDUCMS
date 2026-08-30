package com.educms.player

/**
 * Did this page load actually SUCCEED, or did it merely finish?
 * (2026-08-30 player reliability program, W2-3.)
 *
 * WHY THIS FILE EXISTS. `SafePlayerWebViewClient.onPageFinished` treated
 * every non-`about:blank` finish as a success and invoked
 * `onPageFinishedOk`, which clears the recovery loop, zeroes the watchdog
 * failure counter and engages lock task mode. But Chromium fires
 * `onPageFinished` for ERROR DOCUMENTS too — the "Webpage not available"
 * interstitial and any HTTP 4xx/5xx body are pages, and they finish
 * loading like any other. So a screen sitting on a 403 counted as
 * healthy, disarmed its own recovery, and pinned itself in lock task with
 * nothing on the glass.
 *
 * The fix is one bit of state, kept here rather than inline so the
 * contract is testable without a WebView: a main-frame error seen since
 * the last `onPageStarted` disqualifies the finish that follows it.
 *
 * Deliberately dumb: it does NOT try to classify errors or decide what to
 * do about them — the client owns which callbacks feed it (main frame
 * only; subresource failures are none of its business) and the activity
 * owns the response.
 */
class LoadOutcomeTracker {

    /** True once a main-frame error is seen; cleared by the next page start. */
    private var mainFrameErrorSinceStart: Boolean = false

    /** A new main-frame navigation began — this load is innocent again. */
    fun onPageStarted() {
        mainFrameErrorSinceStart = false
    }

    /** The main frame failed (net error, or an HTTP error document). */
    fun onMainFrameError() {
        mainFrameErrorSinceStart = true
    }

    /**
     * The page finished. Returns true when this finish counts as a real
     * success — i.e. no main-frame error arrived since the last
     * [onPageStarted].
     *
     * Finishing resets nothing: the next [onPageStarted] does that. That
     * matters because Chromium can finish an error document more than
     * once (redirect chains, soft reloads) and every one of those is
     * still the same failed navigation.
     */
    fun onPageFinished(): Boolean = !mainFrameErrorSinceStart
}
