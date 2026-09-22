/**
 * A fresh, unguessable device identity for a browser player that has none.
 *
 * 2026-09-21 (launch re-audit F-02): this was `Date.now()` + 8 chars of
 * `Math.random()` — a non-cryptographic PRNG seeded from a timestamp anyone
 * can bracket, and a fingerprint is what `POST /screens/register` stamps
 * `status:'ONLINE'` on. `crypto.randomUUID` is what the rest of the app
 * already uses, and `player/layout.tsx` polyfills it from `getRandomValues`
 * for the Chromium-83 Taurus floor, so the CSPRNG path is the one every
 * real device takes. The last resort only exists so a fingerprint is never
 * thrown from, never for a real browser. The prefix is load-bearing: the
 * server keys `preview-` off it and existing rows keep `device-`.
 */
export function freshDeviceIdentity(prefix: 'device' | 'preview'): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (b) => (b + 256).toString(16).slice(1)).join('')}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}
