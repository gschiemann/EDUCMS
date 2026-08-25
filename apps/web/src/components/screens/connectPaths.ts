/**
 * Connect-a-screen path model — pure, no React, no DOM.
 *
 * WHY THIS EXISTS (2026-08-25)
 * ---------------------------------------------------------------
 * The old "How to Connect a Screen" card on /screens described exactly one
 * flow: open the Player URL in a browser, read the code, type it here. That
 * describes the MINORITY of the real fleet. Operator, verbatim:
 *
 *   "the how to connect a screen section is worthless, because really they
 *    need to install an APK on their screen, or attach a media player 9
 *    times out of 10 .... the screen need to be rethought on how we serve
 *    that up to the admin to get screens going."
 *
 * So the card now asks what the operator is actually holding, and the
 * browser path is the THIRD option rather than the only one. This module
 * holds the parts of that decision that are pure logic — path identity,
 * ordering, persistence normalisation, and URL derivation — so they can be
 * unit-tested without mounting an 3k-line page.
 *
 * APK URL TRUTH (verified 2026-08-25, do not invent a replacement):
 *   `${API_URL}/player/apk/latest`  →  302  →  `/api/v1/player/apk/v/<vc>`
 *   → 200 application/vnd.android.package-archive
 * That controller is apps/api/src/player-ota/player-ota.controller.ts
 * (`@Get('apk/latest')` → `@Get('apk/v/:vc')`). It is zero-auth by design
 * (the binary is inert without a tenant pairing code, which IS auth'd), it
 * self-resolves the newest `player-v*` GitHub Release, and it streams the
 * bytes through Railway rather than GitHub's throttled anonymous CDN. It is
 * the SAME URL the Settings → Player APK download button already ships
 * (apps/web/src/app/[schoolId]/settings/page.tsx), so the QR here and that
 * button can never drift apart.
 */

export type ConnectPathId = 'android' | 'media-player' | 'browser';

/**
 * localStorage key holding the operator's last choice. Per-browser, NOT a
 * tenant setting — operator standing rule: "i dont want another fucking
 * setting." A district IT admin who only ever installs Android boxes should
 * find the card already on the Android path tomorrow; nobody had to
 * configure anything for that to happen.
 */
export const CONNECT_PATH_STORAGE_KEY = 'venueos.connectPath';

/** Android is the default because it is 9-in-10 of the real fleet. */
export const DEFAULT_CONNECT_PATH: ConnectPathId = 'android';

export interface ConnectPathMeta {
  id: ConnectPathId;
  /** Chooser tile title. */
  label: string;
  /** Chooser tile second line — what hardware this actually means. */
  hint: string;
  /** Optional tile badge. Only the Android path carries one. */
  badge?: string;
  /** True when this path installs the Player APK (Android + media player). */
  usesApk: boolean;
}

/**
 * Ordered for the chooser: most common first, browser last. The old card's
 * only flow is the last tile now — that ordering IS the fix.
 */
export const CONNECT_PATHS: readonly ConnectPathMeta[] = [
  {
    id: 'android',
    label: 'Android display or TV box',
    hint: 'Commercial signage panel or Android TV that runs apps itself',
    badge: 'Most common',
    usesApk: true,
  },
  {
    id: 'media-player',
    label: 'Attached media player',
    hint: 'An Android stick or box plugged into any TV’s HDMI port',
    usesApk: true,
  },
  {
    id: 'browser',
    label: 'Browser-capable display',
    hint: 'Smart panel, PC, Chromebook — anything with a web browser',
    usesApk: false,
  },
] as const;

const PATH_IDS: readonly ConnectPathId[] = CONNECT_PATHS.map((p) => p.id);

/**
 * Coerce whatever came back from localStorage into a real path id.
 * `localStorage.getItem` returns `string | null`, a different browser
 * profile may hold a value from a future build, and a hand-edited value can
 * be anything at all — every one of those falls back to the Android default
 * rather than rendering an empty card.
 */
export function normalizeConnectPath(raw: unknown): ConnectPathId {
  if (typeof raw !== 'string') return DEFAULT_CONNECT_PATH;
  const v = raw.trim().toLowerCase();
  return (PATH_IDS as readonly string[]).includes(v)
    ? (v as ConnectPathId)
    : DEFAULT_CONNECT_PATH;
}

export function connectPathMeta(id: ConnectPathId): ConnectPathMeta {
  return CONNECT_PATHS.find((p) => p.id === id) ?? CONNECT_PATHS[0];
}

/**
 * The live APK download endpoint, derived from the dashboard's API base.
 *
 * `apiBase` is `@/lib/api-url`'s `API_URL`, which already ends in `/api/v1`
 * (prod: `https://api-production-39a1.up.railway.app/api/v1`). Returns ''
 * for an unusable base so the caller can hide the QR instead of encoding a
 * broken link into a code someone will scan at a job site.
 */
export function apkDownloadUrl(apiBase: string | null | undefined): string {
  const base = (apiBase || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/player/apk/latest`;
}

/**
 * The phone-side pairing scanner (apps/web/src/app/pair/page.tsx). The
 * operator scans THIS with their phone to open the camera scanner, then
 * points the phone at the code the screen is showing.
 */
export function pairFromPhoneUrl(origin: string | null | undefined): string {
  const o = (origin || '').trim().replace(/\/+$/, '');
  return o ? `${o}/pair` : '/pair';
}

/**
 * A fleet that is past onboarding must not keep paying for onboarding
 * chrome — requirement #4: once ANY screen is paired the card collapses to
 * a one-line "Connect another screen" row. Non-numeric / negative counts
 * (loading, undefined) read as "nothing paired yet" so a first-run operator
 * always lands on the full card.
 */
export function shouldStartCollapsed(pairedCount: number | null | undefined): boolean {
  return typeof pairedCount === 'number' && Number.isFinite(pairedCount) && pairedCount > 0;
}
