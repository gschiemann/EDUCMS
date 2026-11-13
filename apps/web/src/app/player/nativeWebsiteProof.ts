/**
 * nativeWebsiteProof — what the page may say about a website slide that the
 * Android app shows in its own view (2026-11-13).
 *
 * On the APK a website item is not drawn by this page: `showUrlOverlay` hands
 * the URL to a second, top-level Android WebView laid over it. Until now the
 * page marked the slide ready the moment it handed the URL over, so the render
 * proof read `pl:…` — "showing content" — over a view that had loaded a page
 * with nothing in it. A customer screen sat white for hours while the fleet
 * read healthy (2026-11-11).
 *
 * An APK that has the `urlOverlayReport` bridge method reports what that view
 * is doing with an `edu-url-overlay-state` window event:
 *
 *   loading  the URL was taken; the main frame has not been proven yet
 *   drawn    the document holds visible content (text, a sized picture, video,
 *            canvas or frame…). Not a claim that it is the RIGHT content.
 *   blank    the document held nothing visible on two looks 12 s apart; the
 *            APK reloads it a bounded number of times and keeps saying blank
 *   failed   the main frame did not load (network, HTTP error, certificate)
 *   unknown  the APK could not read the document; nothing is claimed
 *
 * This module is the page's half: pure, no React, no DOM beyond the event's
 * `detail`. The rules:
 *   - only `drawn` and `unknown` count as "shown". `unknown` keeps exactly the
 *     reading every APK had before this ("handed over"): a probe that cannot
 *     run must not turn a working screen into a problem on the dashboard.
 *   - `blank` and `failed` are proved under their own idle signatures, so
 *     nothing downstream can read them as content on the glass (player rule 5).
 *   - a report is believed only for the URL this page handed over.
 *
 * An APK without the method, and every browser, never reaches this module's
 * decisions: the page keeps its old behaviour there. So does every screen when
 * the server's kill switch is thrown (`PLAYER_WEBSITE_PROOF=off` →
 * `playback.websiteProof: 'off'` in the manifest): the page stops asking, and
 * the APK does nothing for a page that does not ask — no probe, no reload.
 *
 * Failure direction: every fault lands on "handed over", the reading before
 * this existed — a probe that cannot run reports `unknown`; a report that does
 * not parse or names another URL is dropped; an APK that never answers leaves
 * the slide at `idle:content-loading`, which is true (nothing was proven).
 */

/** The window event the APK dispatches into the player page. Must match `UrlOverlayDrawProofPolicy.STATE_EVENT`. */
export const URL_OVERLAY_STATE_EVENT = 'edu-url-overlay-state';

/** The bridge method whose presence means "this APK reports the website view's state". */
export const URL_OVERLAY_REPORT_METHOD = 'urlOverlayReport';

export type WebsiteViewState = 'loading' | 'drawn' | 'blank' | 'failed' | 'unknown';

/** What the page holds for the slide on glass; `none` = no website slide is with a reporting viewer. */
export type WebsiteProof = 'none' | WebsiteViewState;

export interface WebsiteViewReport {
  url: string;
  state: WebsiteViewState;
  /** Reloads the APK has spent on a blank document for this URL. */
  attempts: number;
}

/**
 * What the page passes to `urlOverlayReport` instead of a URL to stand the
 * APK's proof down. Must match `UrlOverlayDrawProofPolicy.STAND_DOWN`.
 */
export const WEBSITE_PROOF_STAND_DOWN = 'off';

/**
 * The server's kill switch (`PLAYER_WEBSITE_PROOF=off`), read from the
 * manifest's `playback` block: true = thrown, false = not thrown, null = this
 * manifest does not say (an emergency manifest, an older cached one) — keep
 * what was known.
 */
export function websiteProofSwitchedOff(playback: unknown): boolean | null {
  if (!playback || typeof playback !== 'object') return null;
  return (playback as { websiteProof?: unknown }).websiteProof === 'off';
}

/** Render-proof signatures for a website slide that is not showing content. */
export const WEBSITE_BLANK_SIG = 'idle:website-blank';
export const WEBSITE_FAILED_SIG = 'idle:website-failed';
/** The existing "first item still opening" signature — a website being loaded is exactly that. */
const CONTENT_LOADING_SIG = 'idle:content-loading';

const STATES: readonly WebsiteViewState[] = ['loading', 'drawn', 'blank', 'failed', 'unknown'];

/** The event's `detail`, or null when it is not exactly a report. Never throws. */
export function parseWebsiteViewReport(detail: unknown): WebsiteViewReport | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as { url?: unknown; state?: unknown; attempts?: unknown };
  if (typeof d.url !== 'string' || d.url.length === 0 || d.url.length > 2048) return null;
  if (typeof d.state !== 'string' || STATES.indexOf(d.state as WebsiteViewState) === -1) return null;
  const n = typeof d.attempts === 'number' && isFinite(d.attempts) ? Math.floor(d.attempts) : 0;
  return { url: d.url, state: d.state as WebsiteViewState, attempts: n < 0 ? 0 : n > 99 ? 99 : n };
}

/** The APK trims the URL it is handed; compare the same way. */
function sameTarget(target: string | null, url: string): boolean {
  return target !== null && target.trim() === url;
}

/**
 * A report for the slide on glass, or null: the event was malformed, or it is
 * about a URL this page is not showing (a late event from the previous slide).
 */
export function acceptWebsiteViewReport(target: string | null, detail: unknown): WebsiteViewReport | null {
  const report = parseWebsiteViewReport(detail);
  return report && sameTarget(target, report.url) ? report : null;
}

/**
 * What the page holds for `target` given the last report it accepted. A URL
 * that was just handed over and has no report of its own yet is `loading`.
 */
export function websiteProofFor(target: string | null, report: WebsiteViewReport | null): WebsiteProof {
  if (target === null) return 'none';
  return report && sameTarget(target, report.url) ? report.state : 'loading';
}

/** May the slide count as on the glass (`mediaReady`)? */
export function websiteCountsAsShown(proof: WebsiteProof): boolean {
  return proof === 'drawn' || proof === 'unknown';
}

/**
 * The idle render-proof signature for a website slide that is not showing
 * content, or null when the proof does not hold the slide back.
 */
export function websiteProofSig(proof: WebsiteProof): string | null {
  switch (proof) {
    case 'loading':
      return CONTENT_LOADING_SIG;
    case 'blank':
      return WEBSITE_BLANK_SIG;
    case 'failed':
      return WEBSITE_FAILED_SIG;
    default:
      return null;
  }
}
