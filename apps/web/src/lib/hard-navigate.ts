/**
 * A full-page navigation that replaces the current history entry. One tiny
 * seam so components that must leave the app shell (sign-out from a gated
 * screen, the setup → two-step hand-off) can be tested without fighting
 * jsdom's non-configurable `window.location`.
 */
export function hardNavigate(url: string): void {
  window.location.replace(url);
}
