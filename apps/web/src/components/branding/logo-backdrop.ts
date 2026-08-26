/**
 * logo-backdrop — the tenant logo's BACKGROUND treatment, shared by every
 * surface that paints the brand mark.
 *
 * Operator (2026-08-25): "we should have a logo background picker but do
 * our best to get it right … just add another picker like we already have
 * just have 3 now."
 *
 * Before this, each render site independently ran `useLogoTone()` and
 * hard-coded the same two-way choice ("light logo → brand-primary chip,
 * dark logo → transparent/slate"). That was a guess with no operator
 * override, and it boxed marks that shouldn't be boxed. Now:
 *
 *   - The SERVER computes a default per logo candidate during the scrape
 *     (apps/api/src/branding/logo-colors.ts `suggestLogoBackground`) and
 *     ships it on the candidate. Same rules, same inputs.
 *   - The operator can override in the wizard's third picker.
 *   - The choice persists as `palette.logoBackground` — a KEY inside the
 *     existing `TenantBranding.palette` Json column, so no migration.
 *   - Every render site calls `logoBackdrop()` so they can never drift.
 *
 * Keep `suggestBackgroundForTone` in sync with the server's
 * `suggestLogoBackground` — same contract as palette-client.ts vs
 * color-utils.ts. Pure module: no runtime imports, no DOM, no hooks — only
 * a type-only React import (erased at compile) for CSSProperties.
 */

import type { CSSProperties } from 'react';

export const LOGO_BACKGROUNDS = ['transparent', 'white', 'dark', 'primary', 'tile'] as const;
export type LogoBackground = (typeof LOGO_BACKGROUNDS)[number];

/** Operator-facing labels for the wizard's third picker. */
export const LOGO_BACKGROUND_LABELS: Record<LogoBackground, string> = {
  transparent: 'None',
  white: 'White',
  dark: 'Dark',
  primary: 'Brand',
  tile: 'Tile',
};

/** One-line "why you'd pick this" copy, shown as the control's title. */
export const LOGO_BACKGROUND_HINTS: Record<LogoBackground, string> = {
  transparent: 'No backing — the mark sits directly on the surface',
  white: 'A white card behind the mark',
  dark: 'A near-black card — best for white or pale marks',
  primary: 'A chip in your brand primary color',
  tile: 'A soft rounded tile in your lightest brand tint',
};

export function isLogoBackground(v: unknown): v is LogoBackground {
  return typeof v === 'string' && (LOGO_BACKGROUNDS as readonly string[]).includes(v);
}

/** The tone signal produced by `useLogoTone`. */
export type LogoTone = 'light' | 'dark' | 'unknown';

/**
 * Client-side default for a mark we only know the TONE of (the manual
 * upload / pasted-URL path, where there is no server analysis).
 *
 * Mirrors the server's luminance rules at the tone granularity the browser
 * canvas gives us:
 *   unknown → 'primary'      (most un-analyzable marks are white-on-
 *                             transparent wordmarks; this is exactly the
 *                             treatment that shipped before this feature,
 *                             so the unknown case is a no-op)
 *   light   → 'primary'      (a brand chip carries a pale mark)
 *   dark    → 'transparent'  (reads fine on light chrome; boxing looks cheap)
 */
export function suggestBackgroundForTone(tone: LogoTone): LogoBackground {
  if (tone === 'dark') return 'transparent';
  return 'primary';
}

/**
 * Resolve the chosen background into the style + classes a render site
 * applies to the logo's wrapper.
 *
 * `inkClass` matters for inline SVGs that paint with `currentColor` — the
 * wrapper's text color is what they inherit, so a dark backing must set
 * white ink and a light backing must set dark ink.
 */
export function logoBackdrop(
  background: LogoBackground | null | undefined,
  tone: LogoTone = 'unknown',
): { style: CSSProperties; className: string; inkClass: string; padded: boolean } {
  // No stored choice → fall back to the tone-based default, which is what
  // every one of these surfaces already did before the picker existed.
  const bg: LogoBackground = isLogoBackground(background) ? background : suggestBackgroundForTone(tone);

  switch (bg) {
    case 'transparent':
      return { style: {}, className: '', inkClass: 'text-slate-800', padded: false };
    case 'white':
      return {
        style: { background: '#ffffff' },
        className: 'border border-slate-200',
        inkClass: 'text-slate-800',
        padded: true,
      };
    case 'dark':
      return {
        style: { background: '#111827' },
        className: '',
        inkClass: 'text-white',
        padded: true,
      };
    case 'tile':
      return {
        style: { background: 'var(--brand-primary-soft, #eef2ff)' },
        className: 'border border-black/5',
        inkClass: 'text-slate-800',
        padded: true,
      };
    case 'primary':
    default:
      return {
        style: { background: 'var(--brand-primary, #4f46e5)' },
        className: '',
        inkClass: 'text-white',
        padded: true,
      };
  }
}

/**
 * Read the persisted choice off a branding row / preview palette.
 * Tolerates every shape the caller might hold (full branding object, bare
 * palette, null) so call sites stay one-liners.
 */
export function readLogoBackground(source: unknown): LogoBackground | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;
  const direct = obj.logoBackground;
  if (isLogoBackground(direct)) return direct;
  const palette = obj.palette;
  if (palette && typeof palette === 'object') {
    const nested = (palette as Record<string, unknown>).logoBackground;
    if (isLogoBackground(nested)) return nested;
  }
  return null;
}
