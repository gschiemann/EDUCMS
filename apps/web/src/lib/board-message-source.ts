/**
 * Who may talk to the template editor through `postMessage` (2026-10-11,
 * launch security re-audit H-9).
 *
 * Packaged boards run in sandboxed NULL-ORIGIN iframes, so `event.origin` is
 * always the string "null" and proves nothing. The load-bearing check is the
 * SOURCE: a message is accepted only when it comes from
 *   - the window of an iframe that is in THIS document (a board on the canvas
 *     or in the properties preview), or
 *   - this window itself (the builder replays a click to the Properties panel
 *     after switching tabs — BuilderShell's `__replayed` message).
 * A popup, an opener, a parent that framed the dashboard, or any other window
 * that can obtain a reference to ours is refused.
 *
 * `selector` narrows the accepted iframes further when the caller knows which
 * frames are boards.
 */
export function isFromDocumentFrame(event: MessageEvent, selector = 'iframe'): boolean {
  const src = event.source as Window | null;
  if (!src) return false;
  if (typeof window !== 'undefined' && src === window) return true;
  if (typeof document === 'undefined') return false;
  const frames = document.querySelectorAll(selector);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as HTMLIFrameElement;
    try {
      if (f.contentWindow && f.contentWindow === src) return true;
    } catch {
      /* detached — ignore */
    }
  }
  return false;
}
