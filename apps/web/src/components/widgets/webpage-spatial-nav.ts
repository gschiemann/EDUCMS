/**
 * Spatial-navigation BRIDGE for the WEBPAGE proxy iframe (parent side).
 *
 * 2026-05-07 — operator: "when I use the Goodview CMS player and push a
 * URL, the remote control is able to essentially tab around the website
 * so I can select buttons without a mouse or keyboard, using up and down
 * on the remote it highlights the different links on the website. Our
 * player doesn't do that at all."
 *
 * ─── WHAT CHANGED 2026-08-02 (security wave, INJ-001a) ────────────────────
 *
 * This module used to hold the shim SOURCE and inject it with
 * `iframe.contentWindow.eval(SHIM_JS)`. That only worked because the proxied
 * frame was same-origin with the app — and that same-origin reachability was
 * the vulnerability: anything running in the proxied page (upstream JS, or
 * script an attacker got into it) lived in OUR origin, with read access to
 * `parent.document`, the device token in localStorage, and the player's own
 * state. The WEBPAGE iframe is now sandboxed WITHOUT `allow-same-origin`, so
 * that reach is gone — and so is `contentWindow.eval`.
 *
 * The feature did NOT go away. The shim is now baked into the proxied document
 * server-side (`apps/api/src/proxy/spatial-nav-shim.ts`), and this file is the
 * PARENT half of a hardened postMessage channel:
 *
 *   parent -> frame  { vosnav: 'vosnav/1', cmd: <FIXED ENUM> }
 *   frame  -> parent { vosnav: 'vosnav/1', evt: 'ready' | 'result', ... }
 *
 * SECURITY NOTES FOR ANYONE EDITING THIS FILE
 *  • A null-origin sandboxed frame reports `event.origin === "null"`, so an
 *    origin check on the PARENT side is worthless here. The load-bearing
 *    check is `event.source === iframe.contentWindow` — never remove it, and
 *    never "relax" it to an origin comparison.
 *  • The command vocabulary is a FIXED ENUM. Never add a command that carries
 *    code, a selector, a URL, or any other payload. There is no eval path in
 *    either half of this protocol and there must never be one.
 *  • Outbound posts use targetOrigin '*' because the frame is opaque and no
 *    other value can ever match. That is safe only because we post to ONE
 *    specific `contentWindow` and the payload is a bare enum with no secrets.
 *  • The shim installs INERT. It only wakes on `arm`, which is why the
 *    dashboard's WEBPAGE preview iframes (which also route through the proxy)
 *    never get the focus-stealing behaviour that caused the 2026-06-08
 *    "every menu click needs two clicks" fire. Callers must keep gating
 *    `attachSpatialNavBridge` to real display surfaces.
 */

/** Protocol namespace. Byte-identical to the API's `VOSNAV_NS`. */
export const VOSNAV_NS = 'vosnav/1';

export type VosNavCommand =
  | 'arm'
  | 'disarm'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate';

/** The complete command vocabulary — the shim ignores anything else. */
export const VOSNAV_COMMANDS: readonly VosNavCommand[] = [
  'arm',
  'disarm',
  'up',
  'down',
  'left',
  'right',
  'activate',
];

/** Frame -> parent event names we will act on. Anything else is dropped. */
export const VOSNAV_EVENTS = ['ready', 'result'] as const;
export type VosNavEvent = (typeof VOSNAV_EVENTS)[number];

/** Keyboard/remote key -> nav command. Returns null for keys we don't own. */
export function commandForKey(key: string): VosNavCommand | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
      return 'activate';
    default:
      return null;
  }
}

/**
 * Validate an inbound `message` event as a frame->parent protocol message from
 * THIS iframe. Exported so the protocol is unit-testable without a DOM harness.
 *
 * Order matters: the source check is first because it is the only check that
 * can distinguish our frame from any other frame on the page (a null-origin
 * frame's `event.origin` is the useless string "null", and any page can post
 * an object with our namespace in it).
 */
export function isVosNavFrameMessage(
  ev: Pick<MessageEvent, 'source' | 'data'>,
  iframe: HTMLIFrameElement | null,
): boolean {
  const expected = iframe?.contentWindow ?? null;
  if (!expected) return false;
  if (ev.source !== expected) return false;
  const d = ev.data as unknown;
  if (!d || typeof d !== 'object') return false;
  const msg = d as { vosnav?: unknown; evt?: unknown };
  if (msg.vosnav !== VOSNAV_NS) return false;
  if (typeof msg.evt !== 'string') return false;
  return (VOSNAV_EVENTS as readonly string[]).indexOf(msg.evt) !== -1;
}

/** Post one enum command into the frame. No-op if the frame is gone. */
export function postSpatialNavCommand(
  iframe: HTMLIFrameElement | null,
  cmd: VosNavCommand,
): boolean {
  const win = iframe?.contentWindow;
  if (!win) return false;
  if (VOSNAV_COMMANDS.indexOf(cmd) === -1) return false;
  try {
    // '*' is required: an opaque (sandboxed, no allow-same-origin) frame has
    // no origin any other targetOrigin value could match. Safe here — one
    // specific contentWindow, payload is a bare enum.
    win.postMessage({ vosnav: VOSNAV_NS, cmd }, '*');
    return true;
  } catch {
    return false;
  }
}

type BridgeState = { detach: () => void };

const BRIDGE_KEY = '__vosNavBridge';

/**
 * Arm the server-injected shim inside `iframe` and start forwarding remote /
 * keyboard navigation into it.
 *
 * CALL ONLY ON REAL DISPLAY SURFACES (player / board / overlay / ribbon /
 * scorebug / panic). On the dashboard the shim must stay inert — see the
 * 2026-06-08 note above.
 *
 * Idempotent per element: re-attaching detaches the previous bridge first, so
 * an iframe that reloads (interactive-mode link click) does not accumulate
 * window listeners.
 *
 * Returns a detach function. The bridge also self-detaches once the iframe
 * leaves the document, so playlist churn cannot leak listeners.
 */
export function attachSpatialNavBridge(iframe: HTMLIFrameElement | null): boolean {
  if (!iframe || typeof window === 'undefined') return false;

  const holder = iframe as HTMLIFrameElement & { [BRIDGE_KEY]?: BridgeState };
  try {
    holder[BRIDGE_KEY]?.detach();
  } catch {
    /* previous bridge already gone */
  }

  let detached = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (detached) return;
    if (!iframe.isConnected) {
      detach();
      return;
    }
    // If focus is inside a text field on the PARENT surface, typing wins.
    const ae = document.activeElement;
    const tag = (ae?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (ae as HTMLElement | null)?.isContentEditable) {
      return;
    }
    const cmd = commandForKey(e.key);
    if (!cmd) return;
    if (postSpatialNavCommand(iframe, cmd)) {
      // Nothing else on the display surfaces binds arrows/Enter (verified by
      // grep over player/page.tsx + components/player), so swallowing them
      // keeps the parent document from scrolling behind the frame.
      e.preventDefault();
    }
  };

  const onMessage = (ev: MessageEvent) => {
    if (detached) return;
    if (!iframe.isConnected) {
      detach();
      return;
    }
    if (!isVosNavFrameMessage(ev, iframe)) return;
    const evt = (ev.data as { evt: VosNavEvent }).evt;
    if (evt === 'ready') {
      // A fresh document inside the frame (first load, or an in-frame
      // navigation in interactive mode) announces itself inert — re-arm it.
      postSpatialNavCommand(iframe, 'arm');
    }
    // 'result' is telemetry only; there is deliberately nothing to do with it
    // beyond leaving the door open for a future HUD. Never branch on frame
    // data into anything privileged.
  };

  function detach() {
    if (detached) return;
    detached = true;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('message', onMessage);
    try {
      delete holder[BRIDGE_KEY];
    } catch {
      /* ignore */
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('message', onMessage);
  holder[BRIDGE_KEY] = { detach };

  // Arm immediately (the shim is already installed — it is injected in <head>
  // by the proxy, so it exists before this `load` handler runs) and once more
  // shortly after, to cover a frame that is still parsing.
  postSpatialNavCommand(iframe, 'arm');
  window.setTimeout(() => {
    if (!detached && iframe.isConnected) postSpatialNavCommand(iframe, 'arm');
  }, 300);

  // Hand keyboard focus to the frame so a remote press lands on the shim's own
  // in-frame keydown handler (the fast path). `focus()` is one of the few
  // cross-origin-accessible Window members, so this still works on the
  // sandboxed null-origin frame.
  try {
    iframe.contentWindow?.focus();
  } catch {
    /* opaque-origin guard */
  }

  return true;
}

/** Tear down a bridge previously attached to this iframe. */
export function detachSpatialNavBridge(iframe: HTMLIFrameElement | null): void {
  const holder = iframe as (HTMLIFrameElement & { [BRIDGE_KEY]?: BridgeState }) | null;
  try {
    holder?.[BRIDGE_KEY]?.detach();
  } catch {
    /* ignore */
  }
}
