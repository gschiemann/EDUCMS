/**
 * network.ts — the renderer's network policy: Chromium gets NO network.
 *
 * Four independent layers, so no single mistake opens a path out:
 *
 *   1. REQUEST INTERCEPTION (this file's `routeRequest`). Every request the
 *      page makes is answered locally or aborted:
 *        • the board document itself, from memory, once;
 *        • `data:` / `blob:` URLs (in-page bytes — nothing to fetch);
 *        • Google Fonts CSS and font files, generated from / served out of the
 *          fonts bundled in the image;
 *        • any other navigation → 204, which cancels it without committing an
 *          error page, so a board cannot navigate itself away from the render;
 *        • everything else → aborted and reported in metrics.blockedRequests.
 *   2. A CSP RESPONSE HEADER on the board document (`BOARD_CSP`):
 *      `connect-src 'none'` closes fetch/XHR/WebSocket/EventSource/beacons
 *      before they exist — WebSockets are not visible to interception at all —
 *      and `worker-src` / `manifest-src` / `object-src` / `form-action` close
 *      the other side doors. Violations are captured in the page and reported.
 *   3. LAUNCH FLAGS (`networkLockdownArgs`): every host maps to NOTFOUND, and
 *      the proxy is a dead loopback port with the implicit loopback bypass
 *      REMOVED, so anything that somehow escaped interception — a popup, a
 *      preconnect, a request to 127.0.0.1 — dies on a refused connection.
 *      WebRTC is held to proxied UDP only, i.e. to nothing.
 *   4. NO DEVTOOLS SOCKET: Chromium is driven over a pipe (`pipe: true`), so
 *      there is no remote-debugging port for anything else to connect to.
 *
 * `test/integration/network-lockdown.test.ts` proves layer 1+2 together and
 * layer 3 on its own against a local HTTP/UDP listener that must receive
 * nothing.
 */
import type { FontCatalog } from './fonts/catalog.js';
import { parseGoogleFontsUrl } from './fonts/google-css.js';
import type { BlockedRequest } from './contract.js';

/**
 * Where the board document "lives". `.invalid` can never resolve (RFC 2606);
 * the document is fulfilled from memory by interception. https so the page is
 * a secure context, like the production player.
 */
export const BOARD_ORIGIN = 'https://board.vosr.invalid';
export const BOARD_URL = `${BOARD_ORIGIN}/`;

/**
 * Sent with the board document. Deliberately narrow: it closes every
 * non-rendering channel and leaves img/style/font/frame to interception, so a
 * blocked image is REPORTED by URL rather than silently refused. It combines
 * with (never replaces) whatever CSP the board carries in a <meta>.
 */
export const BOARD_CSP = [
  "connect-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');

/** A dead proxy: loopback, a port nothing listens on (TCP 9, "discard"). */
export const DEAD_PROXY = 'http://127.0.0.1:9';

/** Chromium flags for layer 3. See the header. */
export function networkLockdownArgs(): string[] {
  return [
    '--host-resolver-rules=MAP * ~NOTFOUND',
    `--proxy-server=${DEAD_PROXY}`,
    // Chromium bypasses the proxy for loopback implicitly; `<-loopback>`
    // removes that exemption, so 127.0.0.1 / localhost / [::1] go to the dead
    // proxy too — the renderer's own port included.
    '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-pings',
    '--dns-prefetch-disable',
    // Speculative loads that could run outside the page's own interception.
    '--disable-features=Prerender2,SpeculationRulesPrefetchFuture,NetworkPrediction,PreloadMediaEngagementData,MediaRouter,Translate,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater',
  ];
}

export type RouteDecision =
  | { action: 'document' }
  | { action: 'allow' }
  | { action: 'google-css'; url: string }
  | { action: 'font-file'; path: string }
  | { action: 'cancel-navigation' }
  | { action: 'block'; reason: BlockedRequest['reason'] };

export interface RouteInput {
  url: string;
  resourceType: string;
  isNavigation: boolean;
  isMainFrame: boolean;
  /** Has the board document already been served once? */
  documentServed: boolean;
}

/** Decide what happens to one intercepted request. Pure. */
export function routeRequest(input: RouteInput, catalog: Pick<FontCatalog, 'resolveFontPath'>): RouteDecision {
  const { url, isNavigation, isMainFrame, documentServed } = input;
  if (isNavigation) {
    if (isMainFrame && !documentServed && url === BOARD_URL) return { action: 'document' };
    return { action: 'cancel-navigation' };
  }
  const lower = url.slice(0, 8).toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('blob:')) return { action: 'allow' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { action: 'block', reason: 'network' };
  }
  if (parsed.protocol === 'https:' && parsed.hostname === 'fonts.googleapis.com') {
    return parseGoogleFontsUrl(url) ? { action: 'google-css', url } : { action: 'block', reason: 'font' };
  }
  if (parsed.protocol === 'https:' && parsed.hostname === 'fonts.gstatic.com') {
    // Query strings and fragments play no part in which file is served.
    const file = catalog.resolveFontPath(parsed.pathname);
    return file ? { action: 'font-file', path: file } : { action: 'block', reason: 'font' };
  }
  return { action: 'block', reason: 'network' };
}

/** Keep blocked-request URLs short and free of payload: never echo a data: body. */
export function summariseUrl(url: string, max = 200): string {
  if (/^data:/i.test(url)) {
    const comma = url.indexOf(',');
    const head = comma === -1 ? url.slice(0, 40) : url.slice(0, Math.min(comma, 60));
    return `${head},… (${Math.round(url.length / 1024)} KB)`;
  }
  let out = '';
  for (const ch of url.slice(0, max)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return url.length > max ? `${out}…` : out;
}
