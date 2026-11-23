/**
 * When may a new deploy reload an open dashboard tab on its own?
 *
 * Only when nobody can be interrupted by it: the tab is hidden, nothing is
 * dirty, no modal or overlay is open, no emergency is active, focus is not in
 * a text field, the browser is online, the reload timer fired on time, and
 * the route is not one that runs something live. Every
 * other case shows the "A new version is available" control and waits for
 * the operator (StaleBundleWatcher.tsx). Anything that cannot be read counts
 * as "do not reload".
 */

/** First check after mount, and after the tab becomes visible again. */
export const FIRST_CHECK_DELAY_MS = 30_000;
/** At most one /api/build-info check per interval, and only while visible. */
export const CHECK_INTERVAL_MS = 5 * 60_000;
/** How long the tab must stay hidden before an automatic reload. */
export const HIDDEN_RELOAD_DELAY_MS = 5 * 60_000;
/**
 * A reload timer that fires this much later than scheduled means the page
 * was suspended (a sleeping laptop, a backgrounded phone app) and may be
 * resuming in front of the operator, so it does not reload.
 */
export const LATE_TIMER_TOLERANCE_MS = 2 * 60_000;

/**
 * Routes that run something live. A deploy never reloads them on its own;
 * the operator reloads from the control when they are ready.
 */
const EXEMPT_ROUTES: readonly RegExp[] = [
  // The live game console, /[schoolId]/sports/[gameId] and everything under
  // it (the swim bridge). The static `sponsors` page is not a console.
  /^\/[^/]+\/sports\/(?!sponsors(?:\/|$))[^/]+(?:\/|$)/,
  // The emergency broadcast page, /[schoolId]/emergency/broadcast, and any
  // other page under /emergency.
  /^\/[^/]+\/emergency(?:\/|$)/,
  // Camera sync calibration: the group's screens are flashing a measured
  // pattern while it is open.
  /^\/[^/]+\/screens\/sync-calibrate(?:\/|$)/,
];

export function isAutoReloadExemptPath(pathname: string): boolean {
  return EXEMPT_ROUTES.some((re) => re.test(pathname));
}

/** An open modal, sheet, picker or popover rendered into the document. */
export const OPEN_OVERLAY_SELECTOR =
  '[aria-modal="true"], [role="dialog"], [role="alertdialog"], dialog[open]';

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden',
]);

/** Focus sits in a field the operator types into. */
export function isEditingElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  if ((el as HTMLElement).isContentEditable === true) return true;
  return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}

export interface AutoReloadState {
  visibilityState: string;
  pathname: string;
  unsavedWork: boolean;
  overlayOpenCount: number;
  emergencyActive: boolean;
  overlayInDocument: boolean;
  editing: boolean;
  /** False only when the browser reports it is offline. */
  online: boolean;
  /** How late the reload timer fired, in ms. */
  timerLateMs: number;
}

export type AutoReloadBlocker =
  | 'visible'
  | 'exempt-route'
  | 'unsaved-work'
  | 'overlay'
  | 'emergency'
  | 'editing'
  | 'offline'
  | 'resumed-late'
  | null;

/** Null when an automatic reload is allowed; otherwise the first reason it is not. */
export function autoReloadBlocker(s: AutoReloadState): AutoReloadBlocker {
  if (s.visibilityState !== 'hidden') return 'visible';
  if (isAutoReloadExemptPath(s.pathname)) return 'exempt-route';
  if (s.emergencyActive) return 'emergency';
  if (s.unsavedWork) return 'unsaved-work';
  if (s.overlayOpenCount > 0 || s.overlayInDocument) return 'overlay';
  if (s.editing) return 'editing';
  // The reload clears the shell cache first; offline it would leave an error page.
  if (!s.online) return 'offline';
  if (s.timerLateMs > LATE_TIMER_TOLERANCE_MS) return 'resumed-late';
  return null;
}

/** Read the document-side facts. A read that throws is "do not reload". */
export function readAutoReloadState(
  doc: Document,
  pathname: string,
  app: {
    unsavedWork: boolean;
    overlayOpenCount: number;
    emergencyActive: boolean;
    online: boolean;
    timerLateMs: number;
  },
): AutoReloadState {
  let overlayInDocument = true;
  let editing = true;
  try { overlayInDocument = doc.querySelector(OPEN_OVERLAY_SELECTOR) !== null; } catch { /* stays true */ }
  try { editing = isEditingElement(doc.activeElement); } catch { /* stays true */ }
  return {
    visibilityState: doc.visibilityState,
    pathname,
    unsavedWork: app.unsavedWork,
    overlayOpenCount: app.overlayOpenCount,
    emergencyActive: app.emergencyActive,
    overlayInDocument,
    editing,
    online: app.online,
    timerLateMs: app.timerLateMs,
  };
}
