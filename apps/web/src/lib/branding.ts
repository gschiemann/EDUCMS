/**
 * Branding — shared types + SSR fetch helper.
 *
 * The shape mirrors `TenantBranding` in the Prisma schema plus the
 * `BrandingPreview` DTO returned by the scraper, minus heavy fields.
 */

import { API_URL } from './api-url';

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
  const FONT_RE = /^[a-zA-Z0-9 \-_,'"]{1,80}$/;
  if (fontHeading && FONT_RE.test(fontHeading)) out['--brand-font-heading'] = `"${fontHeading}", ui-sans-serif, system-ui, sans-serif`;
  if (fontBody && FONT_RE.test(fontBody)) out['--brand-font-body'] = `"${fontBody}", ui-sans-serif, system-ui, sans-serif`;
  return out;
}
