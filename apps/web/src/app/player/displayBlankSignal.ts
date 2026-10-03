/**
 * displayBlankSignal — the page's soft BLANK, for the surfaces its black cover
 * cannot reach (2026-10-03).
 *
 * "Turn the screen off" (the dashboard's Blank, and the on/off schedule) paints
 * a black cover inside this page. A website shown by our Android app is not in
 * this page: it is a second, top-level Android WebView laid OVER it — the
 * playlist's website item (`showUrlOverlay`) and Website Tabs (`webTabsShow`).
 * The cover went up underneath, the site stayed on the glass, and the operator
 * saw a screen that ignored Off and its schedule whenever a URL was live.
 *
 * So a blank must also take the native site view down, and a wake must put it
 * back. The page owns the state; this module is how everything else hears it:
 *   - `nativeWebsiteTarget` — what the playlist's website overlay should show
 *     right now (null = hidden). Pure, so every reason to hide has a test.
 *   - `publishDisplayBlank` / `isDisplayBlanked` / DISPLAY_BLANK_EVENT — a flag
 *     and an event on `window` for widgets rendered deep in a template (Website
 *     Tabs), which share no React tree with the page.
 *
 * An emergency is not this module's business: it has its own hide (player rule
 * 11), and the alert draws above everything.
 */
export const DISPLAY_BLANK_EVENT = 'edu:display-blank';

type BlankWindow = Window & { __eduDisplayBlank?: boolean };

/** The page calls this whenever its soft blank turns on or off. */
export function publishDisplayBlank(on: boolean): void {
  try {
    (window as BlankWindow).__eduDisplayBlank = on;
    window.dispatchEvent(new CustomEvent(DISPLAY_BLANK_EVENT, { detail: { on } }));
  } catch { /* SSR / a hardened WebView: nothing to tell */ }
}

/** Is the screen blanked right now? A widget mounting DURING a blank asks this. */
export function isDisplayBlanked(): boolean {
  try { return (window as BlankWindow).__eduDisplayBlank === true; } catch { return false; }
}

export interface NativeWebsiteInput {
  /** `phase === 'playing'`. */
  playing: boolean;
  playbackStopped: boolean;
  emergency: boolean;
  /** The soft blank is on (dashboard Off, or the on/off schedule's off window). */
  blanked: boolean;
  /** The item on glass, if any. */
  item: { asset?: { mimeType?: string | null; fileUrl?: string | null } | null } | null | undefined;
  /** Its daypart window is open. */
  itemValid: boolean;
  apiRoot: string;
}

/** The URL the native website view should show for the playlist item on glass, or null to hide it. */
export function nativeWebsiteTarget(i: NativeWebsiteInput): string | null {
  if (!i.playing || i.playbackStopped || i.emergency || i.blanked) return null;
  if (!i.item || !i.itemValid || i.item.asset?.mimeType !== 'text/html') return null;
  const fileUrl = i.item.asset?.fileUrl || '';
  const url = fileUrl.startsWith('http') ? fileUrl : `${i.apiRoot}${fileUrl}`;
  return /^https?:\/\//i.test(url) ? url : null;
}
