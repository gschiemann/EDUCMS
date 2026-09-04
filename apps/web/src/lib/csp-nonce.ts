/**
 * SEC-010 (2026-09-04) — the per-request CSP nonce, and how each side reads it.
 *
 * `proxy.ts` mints one nonce per dashboard document request, puts it on the
 * REQUEST as `Content-Security-Policy: script-src 'self' 'nonce-<n>'` (which is
 * how Next threads it onto its own inline bootstrap / flight scripts) and on the
 * RESPONSE as the enforced policy. Everything in this file exists so the two
 * ends agree on the format and so the browser side can recover the value.
 *
 * WHY THE CLIENT NEEDS IT AT ALL: the AI-designer boards render through
 * `<iframe srcdoc>`, and an `about:srcdoc` document INHERITS its embedder's
 * policy on top of its own. Measured in Chromium, WebKit and Gecko on
 * 2026-09-04: a srcdoc script carrying a nonce the PARENT policy does not list
 * is blocked in all three; carrying the parent's own nonce, it runs in all
 * three. So `designer-safe-srcdoc.ts` stamps the page nonce rather than a
 * fresh one, and reads it from here.
 */

/** Bytes of entropy per nonce. 16 is the usual CSP recommendation (128 bits). */
const NONCE_BYTES = 16;

/**
 * Mint a nonce. Runs in the edge runtime (`proxy.ts`), so this uses Web Crypto
 * only — no `node:crypto`.
 */
export function mintCspNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Request header carrying the nonce, for any server component that wants it. */
export const CSP_NONCE_HEADER = 'x-nonce';

/**
 * Read the nonce this document was served under, from the browser.
 *
 * There is no server plumbing here on purpose. Next stamps `nonce` on the
 * script tags it emits, so the value is already in the DOM and one query
 * recovers it — no context provider threaded through the builder, no prop
 * drilled to every preview, and nothing new that can hydrate-mismatch.
 *
 * `getAttribute('nonce')` returns '' in every browser that implements nonce
 * hiding (Chrome 61+, Firefox 75+, Safari 15.4+); the IDL property still
 * returns the value. Both are read, newest form first, so this works either
 * side of that change.
 *
 * Returns '' when there is no nonce — on the player and the static board
 * routes, which are deliberately outside the enforced policy, and during SSR.
 * Callers must treat '' as "no page nonce", never as an error.
 */
export function readCspNonce(): string {
  if (typeof document === 'undefined') return '';
  try {
    const el = document.querySelector('script[nonce]') as HTMLScriptElement | null;
    if (!el) return '';
    return el.nonce || el.getAttribute('nonce') || '';
  } catch {
    return '';
  }
}
