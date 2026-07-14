/**
 * kiosk-frame-registry.ts — audit W0-02 (2026-07-13).
 *
 * The player used to accept `educms-action` postMessages from ANY window and
 * execute the action OBJECT carried in the message. Combined with AI-authored
 * board HTML executing in `sandbox="allow-scripts"` iframes, that meant model
 * (or prompt-injected) code could drive real player actions — URL overlays,
 * scene navigation, webhooks — with zero operator involvement.
 *
 * This registry is the parent-side source of truth that kills both holes:
 *
 *   1. SOURCE BINDING — every sandboxed board iframe registers its
 *      contentWindow here on mount. The player rejects any `educms-action`
 *      whose `event.source` is not a registered window (sibling frames,
 *      foreign windows, the page itself).
 *   2. KEY RESOLUTION — each registration carries the OPERATOR-SAVED action
 *      map for that zone (`config.actionOverrides`, wired in the builder).
 *      The player resolves the tapped `key` against THIS map and never
 *      executes an action object supplied by the frame. This is lossless:
 *      the in-iframe shim only ever fires for keys present in the same
 *      overrides map (`state.actions[key]`) — there are no HTML-baked
 *      default actions.
 *
 * WeakMap so a torn-down iframe's window can be garbage-collected even if a
 * teardown race skips unregister.
 */

export type KioskActionMap = Record<string, unknown>;

const frames = new WeakMap<object, KioskActionMap>();

/** Register (or refresh) a sandboxed board iframe's window + its saved action map. */
export function registerKioskFrame(win: Window | null | undefined, actions: KioskActionMap | null | undefined): void {
  if (!win) return;
  try {
    frames.set(win as unknown as object, actions && typeof actions === 'object' ? actions : {});
  } catch {
    /* non-object window proxy — nothing to register */
  }
}

/** Forget a frame (called on unmount; WeakMap also self-cleans on GC). */
export function unregisterKioskFrame(win: Window | null | undefined): void {
  if (!win) return;
  try { frames.delete(win as unknown as object); } catch { /* ignore */ }
}

/**
 * Resolve a message source to its registered action map.
 * Returns undefined for any window we did not mount ourselves — callers must
 * treat that as "reject the message".
 */
export function lookupKioskFrame(source: MessageEvent['source']): KioskActionMap | undefined {
  if (!source) return undefined;
  try { return frames.get(source as unknown as object); } catch { return undefined; }
}
