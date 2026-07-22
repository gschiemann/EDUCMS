/**
 * Branding — shared types + SSR fetch helper.
 *
 * The shape mirrors `TenantBranding` in the Prisma schema plus the
 * `BrandingPreview` DTO returned by the scraper, minus heavy fields.
 */

import { API_URL } from './api-url';
import { contrastRatio, ensureReadableOnWhite } from './brand-contrast';

export interface BrandPalette {
  primary: string;
  primaryHover?: string;
  primaryActive?: string;
  primarySoft?: string;
  primaryInk?: string;
  accent?: string;
  accentHover?: string;
  accentSoft?: string;
  accentInk?: string;
  ink?: string;
  inkMuted?: string;
  surface?: string;
  surfaceAlt?: string;
  border?: string;
  success?: string;
  warn?: string;
  danger?: string;
  ramp?: Record<string, string>;
}

export interface TenantBranding {
  id?: string;
  tenantId?: string;
  displayName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  logoSvgInline?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  palette?: BrandPalette | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  fontHeadingUrl?: string | null;
  fontBodyUrl?: string | null;
  heroImages?: Array<{ url: string }> | null;
  sourceUrl?: string | null;
  scrapedAt?: string | null;
}

/** Fetch current tenant branding by slug. Returns null on 404 / any error. */
export async function getBrandingBySlug(slug: string): Promise<TenantBranding | null> {
  try {
    const res = await fetch(`${API_URL}/branding/public/by-slug/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Convert a palette to a block of `--brand-*` CSS custom property
 * assignments. Safe for server render — no escaping of untrusted data
 * is needed because every value is a hex/URL that we've already
 * validated (palettes are derived from parseColor → rgbToHex).
 *
 * Still, we belt-and-suspenders sanitize: hex colors must match the
 * regex, URLs are wrapped in url("...") with quote escaping.
 */
export function paletteToCssVars(b: TenantBranding | null | undefined): string {
  if (!b) return '';
  const p: BrandPalette = (b.palette || {}) as BrandPalette;
  const decl: string[] = [];

  const hex = (v?: string | null) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : null;
  const safe = (name: string, v?: string | null) => {
    const h = hex(v);
    if (h) decl.push(`${name}: ${h};`);
  };

  safe('--brand-primary', p.primary);
  safe('--brand-primary-hover', p.primaryHover);
  safe('--brand-primary-active', p.primaryActive);
  safe('--brand-primary-soft', p.primarySoft);
  safe('--brand-primary-ink', p.primaryInk);
  safe('--brand-accent', p.accent);
  safe('--brand-accent-hover', p.accentHover);
  safe('--brand-accent-soft', p.accentSoft);
  safe('--brand-accent-ink', p.accentInk);
  safe('--brand-ink', p.ink);
  safe('--brand-ink-muted', p.inkMuted);
  safe('--brand-surface', p.surface);
  safe('--brand-surface-alt', p.surfaceAlt);
  safe('--brand-border', p.border);
  safe('--brand-success', p.success);
  safe('--brand-warn', p.warn);
  safe('--brand-danger', p.danger);

  // Fonts — only allow a conservative set of characters so nothing
  // exotic makes it into a style tag.
  const FONT_RE = /^[a-zA-Z0-9 \-_,'"]{1,80}$/;
  const heading = b.fontHeading && FONT_RE.test(b.fontHeading) ? `"${b.fontHeading}"` : null;
  const body = b.fontBody && FONT_RE.test(b.fontBody) ? `"${b.fontBody}"` : null;
  if (heading) decl.push(`--brand-font-heading: ${heading}, ui-sans-serif, system-ui, sans-serif;`);
  if (body) decl.push(`--brand-font-body: ${body}, ui-sans-serif, system-ui, sans-serif;`);

  return decl.join('\n');
}

// ── default-palette derivation ─────────────────────────────────
// Build a complete BrandPalette from a brand's three core colors.
// <BrandStyleInjector /> paints this when a tenant has no custom
// TenantBranding row yet — so a brand-new account looks like the
// VenueOS marketing site (indigo) from the very first login, instead
// of every component falling through to its own hard-coded CSS-var
// default (the stale emerald `#059669` look the operator flagged).
// The soft / active shades are derived by mixing toward white / black
// so the helper works for ANY brand color, not just indigo.

function _hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(f.slice(0, 2), 16) || 0,
    parseInt(f.slice(2, 4), 16) || 0,
    parseInt(f.slice(4, 6), 16) || 0,
  ];
}
function _rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Mix `hex` toward `target` ([r,g,b]) by `amount` (0–1). */
function _mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = _hexToRgb(hex);
  return _rgbToHex(
    r + (target[0] - r) * amount,
    g + (target[1] - g) * amount,
    b + (target[2] - b) * amount,
  );
}
const _WHITE: [number, number, number] = [255, 255, 255];
const _BLACK: [number, number, number] = [0, 0, 0];

export function brandDefaultPalette(colors: {
  primary: string;
  primaryHover: string;
  accent: string;
}): BrandPalette {
  return {
    primary: colors.primary,
    primaryHover: colors.primaryHover,
    primaryActive: _mix(colors.primary, _BLACK, 0.3),
    primarySoft: _mix(colors.primary, _WHITE, 0.9),
    primaryInk: '#ffffff',
    accent: colors.accent,
    accentHover: _mix(colors.accent, _BLACK, 0.15),
    accentSoft: _mix(colors.accent, _WHITE, 0.88),
    accentInk: '#ffffff',
    ink: '#0f172a',         // slate-900
    inkMuted: '#64748b',    // slate-500
    surface: '#ffffff',
    surfaceAlt: '#f8fafc',  // slate-50
    border: '#e2e8f0',      // slate-200
  };
}

// ── Usage-contrast guarantee (2026-07-22, VisionCore incident) ─────────────
// A beta tenant's scraper picked their site BACKGROUND (#fcf9e2 cream) as
// brand primary. The palette pipeline honestly validated ink-ON-primary
// (17.8:1 ✓) — but the chrome ALSO consumes primary AS text/icon color and
// as solid-button bg under white text via the Tailwind scale takeover in
// globals.css (indigo-500/600 ← --brand-primary). Cream in those ROLES is
// invisible (~1.06:1). Nobody checked the second pair.
//
// THE CONTRACT: the tenant's chosen color stays THEIRS (--brand-primary is
// never altered — decorative fills, washes, gradients keep full character),
// but the Tailwind workhorse shades are served CONTRAST-GUARANTEED
// derivatives of that hue: strong ≥4.5:1 vs white (text-on-white + white-
// text-on-it — contrast is symmetric), strongHover ≥5.2, stronger ≥7,
// mid ≥2.5 (decorative icons/hovers). A healthy dark brand passes untouched
// (derivation returns the input), so nobody else's dashboard shifts.
// Derived HERE (the one runtime painter — BrandStyleInjector) so every
// legacy/cached palette heals on next page load without a re-scrape. If the
// API ever persists palette.primaryStrong etc., those win (see below). Math
// is pinned by the CI gate apps/web/tools/check-brand-contrast.cjs (runs the
// literal VisionCore cream fixture).

export function cssVarsFromPalette(p: BrandPalette | null | undefined, fontHeading?: string | null, fontBody?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!p) return out;
  const hex = (v?: string) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : undefined;
  const set = (k: string, v?: string) => { const h = hex(v); if (h) out[k] = h; };
  set('--brand-primary', p.primary);
  set('--brand-primary-hover', p.primaryHover);
  set('--brand-primary-active', p.primaryActive);
  set('--brand-primary-soft', p.primarySoft);
  set('--brand-primary-ink', p.primaryInk);
  set('--brand-accent', p.accent);
  set('--brand-accent-hover', p.accentHover);
  set('--brand-accent-soft', p.accentSoft);
  set('--brand-accent-ink', p.accentInk);
  set('--brand-ink', p.ink);
  set('--brand-ink-muted', p.inkMuted);
  set('--brand-surface', p.surface);
  set('--brand-surface-alt', p.surfaceAlt);
  set('--brand-border', p.border);
  // Contrast-guaranteed workhorse shades (see contract above). Prefer values
  // the API already persisted (palette.primaryStrong etc.); derive locally
  // when absent so legacy/cached palettes heal too.
  const pAny = p as any;
  const pri = hex(p.primary);
  const acc = hex(p.accent);
  if (pri) {
    set('--brand-primary-mid', hex(pAny.primaryMid) ?? ensureReadableOnWhite(pri, 2.5));
    set('--brand-primary-strong', hex(pAny.primaryStrong) ?? ensureReadableOnWhite(pri, 4.5));
    set('--brand-primary-strong-hover', hex(pAny.primaryStrongHover) ?? ensureReadableOnWhite(pri, 5.2));
    set('--brand-primary-stronger', hex(pAny.primaryStronger) ?? ensureReadableOnWhite(pri, 7));
  }
  if (acc) {
    set('--brand-accent-mid', hex(pAny.accentMid) ?? ensureReadableOnWhite(acc, 2.5));
    set('--brand-accent-strong', hex(pAny.accentStrong) ?? ensureReadableOnWhite(acc, 4.5));
    set('--brand-accent-strong-hover', hex(pAny.accentStrongHover) ?? ensureReadableOnWhite(acc, 5.2));
    set('--brand-accent-stronger', hex(pAny.accentStronger) ?? ensureReadableOnWhite(acc, 7));
  }
  const FONT_RE = /^[a-zA-Z0-9 \-_,'"]{1,80}$/;
  if (fontHeading && FONT_RE.test(fontHeading)) out['--brand-font-heading'] = `"${fontHeading}", ui-sans-serif, system-ui, sans-serif`;
  if (fontBody && FONT_RE.test(fontBody)) out['--brand-font-body'] = `"${fontBody}", ui-sans-serif, system-ui, sans-serif`;
  return out;
}
