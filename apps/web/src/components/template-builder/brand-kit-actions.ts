/**
 * Pure helpers for the Brand tab (owner, 2026-10-12: "branding page is still
 * useless, I can't do anything but add a logo"). The tab is ACTION-FIRST:
 * every button does one thing to the canvas regardless of what is selected.
 * Everything here is free of React and the store so it is unit-testable.
 */
import type { MediaDimensions } from './media-sizing';
import type { Zone } from './types';

/** Widgets whose visible copy reads zone-level `color` / `fontFamily`. */
export const BRAND_TEXT_WIDGETS = new Set(['TEXT', 'RICH_TEXT', 'TICKER', 'ANNOUNCEMENT']);

export interface ZoneGeometry { x: number; y: number; width: number; height: number }

export interface BrandPaletteLike {
  primary?: string | null;
  primaryHover?: string | null;
  accent?: string | null;
  ink?: string | null;
  surface?: string | null;
  surfaceAlt?: string | null;
  logoBackground?: string | null;
}

export interface BrandKitLike {
  logoUrl?: string | null;
  logoSvgInline?: string | null;
  palette?: BrandPaletteLike | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  displayName?: string | null;
  sourceUrl?: string | null;
}

// ── Is there a brand at all? ─────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** `#abc` → `#aabbcc`; anything that is not a hex colour → null. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return null;
}

/** The brand's colours, named, distinct, in the order the tab shows them. */
export type BrandColorKey = 'primary' | 'accent' | 'ink' | 'surface' | 'surfaceAlt' | 'primaryHover';
export const BRAND_COLOR_ORDER: BrandColorKey[] = ['primary', 'accent', 'ink', 'surface', 'surfaceAlt', 'primaryHover'];

export function brandColors(palette: BrandPaletteLike | null | undefined): Array<{ key: BrandColorKey; hex: string }> {
  const out: Array<{ key: BrandColorKey; hex: string }> = [];
  for (const key of BRAND_COLOR_ORDER) {
    const hex = normalizeHex(palette?.[key]);
    if (hex && !out.some((c) => c.hex === hex)) out.push({ key, hex });
  }
  return out;
}

/**
 * A kit counts as "set up" when it carries at least ONE of: a logo, a colour,
 * a font. Anything less and the tab shows only the "Set up your brand" card —
 * there is nothing to apply, so "Brand this template" must not be offered.
 */
export function hasBrand(kit: BrandKitLike | null | undefined): boolean {
  if (!kit) return false;
  if (kit.logoUrl) return true;
  if (kit.fontHeading || kit.fontBody) return true;
  return brandColors(kit.palette).length > 0;
}

/** The organisation brand (Settings → Brand & appearance) in the kit shape. */
export function kitFromTenantBranding(b: (BrandKitLike & { palette?: unknown }) | null | undefined): BrandKitLike | null {
  if (!b) return null;
  return {
    logoUrl: b.logoUrl ?? null,
    logoSvgInline: b.logoSvgInline ?? null,
    palette: (b.palette as BrandPaletteLike | null) ?? null,
    fontHeading: b.fontHeading ?? null,
    fontBody: b.fontBody ?? null,
    displayName: b.displayName ?? null,
    sourceUrl: b.sourceUrl ?? null,
  };
}

// ── Colour maths ─────────────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix `a` toward `b` by `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The first of `preferred` that reads on `bg` at `min` contrast; otherwise
 * whichever of white / the brand ink (or near-black) reads better.
 */
export function readableOn(bg: string, preferred: Array<string | null | undefined>, min = 4.5, ink?: string | null): string {
  for (const p of preferred) {
    const h = normalizeHex(p);
    if (h && contrastRatio(h, bg) >= min) return h;
  }
  const dark = normalizeHex(ink) && contrastRatio(normalizeHex(ink)!, bg) >= 3 ? normalizeHex(ink)! : '#0f172a';
  return contrastRatio('#ffffff', bg) >= contrastRatio(dark, bg) ? '#ffffff' : dark;
}

/** The colour text sits on: the solid bg, else the first stop of the gradient, else white. */
export function backgroundBaseColor(meta: { bgColor?: string | null; bgGradient?: string | null }): string {
  const grad = typeof meta.bgGradient === 'string' ? meta.bgGradient : '';
  if (grad) {
    const stops = grad.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || [];
    if (stops.length >= 2) return mixHex(normalizeHex(stops[0])!, normalizeHex(stops[stops.length - 1])!, 0.5);
    if (stops.length === 1) return normalizeHex(stops[0])!;
  }
  return normalizeHex(meta.bgColor) ?? '#ffffff';
}

export function brandGradient(from: string, to: string, angle = 135): string {
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}

// ── Ready-made backgrounds ──────────────────────────────────────────────

export interface BrandBackground {
  id: string;
  /** i18n key under brandKitPanel.bg.* */
  labelKey: 'solid' | 'gradientDiagonal' | 'gradientDeep' | 'gradientInk' | 'dark' | 'light';
  /** The brand colour name a solid uses (for the label). */
  colorKey?: BrandColorKey;
  bgColor: string;
  bgGradient: string;
  /** CSS `background` for the tile preview. */
  preview: string;
}

/**
 * Backgrounds generated from the brand colours: every brand colour as a solid,
 * up to three two-colour gradients, and one dark + one light brand option.
 * Duplicate looks are dropped so the grid never shows the same tile twice.
 */
export function brandBackgrounds(palette: BrandPaletteLike | null | undefined): BrandBackground[] {
  const colors = brandColors(palette);
  if (colors.length === 0) return [];
  const by = (k: BrandColorKey) => colors.find((c) => c.key === k)?.hex ?? null;
  const primary = by('primary') ?? colors[0].hex;
  const accent = by('accent') ?? colors.find((c) => c.hex !== primary && c.key !== 'ink' && c.key !== 'surface' && c.key !== 'surfaceAlt')?.hex ?? null;
  const ink = by('ink');
  const out: BrandBackground[] = [];
  const push = (b: BrandBackground) => {
    if (!out.some((o) => o.bgColor === b.bgColor && o.bgGradient === b.bgGradient)) out.push(b);
  };

  for (const c of colors) {
    push({ id: `solid-${c.key}`, labelKey: 'solid', colorKey: c.key, bgColor: c.hex, bgGradient: '', preview: c.hex });
  }
  if (accent) {
    const g = brandGradient(primary, accent);
    push({ id: 'gradient-diagonal', labelKey: 'gradientDiagonal', bgColor: primary, bgGradient: g, preview: g });
  }
  {
    const deep = mixHex(primary, '#000000', 0.45);
    const g = brandGradient(primary, deep, 180);
    push({ id: 'gradient-deep', labelKey: 'gradientDeep', bgColor: primary, bgGradient: g, preview: g });
  }
  if (ink && ink !== primary && luminance(ink) < 0.2) {
    const g = brandGradient(ink, primary, 160);
    push({ id: 'gradient-ink', labelKey: 'gradientInk', bgColor: ink, bgGradient: g, preview: g });
  }
  {
    const dark = mixHex(primary, '#05070d', 0.82);
    push({ id: 'dark', labelKey: 'dark', bgColor: dark, bgGradient: '', preview: dark });
  }
  {
    const light = mixHex(primary, '#ffffff', 0.92);
    push({ id: 'light', labelKey: 'light', bgColor: light, bgGradient: '', preview: light });
  }
  return out;
}

// ── Logo placement ──────────────────────────────────────────────────────

export type LogoPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export const LOGO_PLACEMENTS: LogoPlacement[] = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'];

/** A logo's natural size: 14% of the short side tall, width capped at 28% of the canvas. */
export function logoSize(source: MediaDimensions | null, canvas: MediaDimensions): { width: number; height: number } {
  const short = Math.min(canvas.width, canvas.height);
  const aspect = source && source.width > 0 && source.height > 0 ? source.width / source.height : 1;
  let h = short * 0.14;
  let w = h * aspect;
  const maxW = canvas.width * 0.28;
  if (w > maxW) { w = maxW; h = w / aspect; }
  return { width: (w / canvas.width) * 100, height: (h / canvas.height) * 100 };
}

/**
 * Where a box of `size` (canvas %) goes for `placement`, with an equal PIXEL
 * margin (3% of the short side) from the edges it touches.
 */
export function placeBox(placement: LogoPlacement, size: { width: number; height: number }, canvas: MediaDimensions): ZoneGeometry {
  const margin = Math.min(canvas.width, canvas.height) * 0.03;
  const mx = (margin / canvas.width) * 100;
  const my = (margin / canvas.height) * 100;
  const w = Math.min(size.width, 100);
  const h = Math.min(size.height, 100);
  const left = mx;
  const right = 100 - w - mx;
  const top = my;
  const bottom = 100 - h - my;
  const cx = (100 - w) / 2;
  const cy = (100 - h) / 2;
  const pos: Record<LogoPlacement, [number, number]> = {
    'top-left': [left, top],
    'top-right': [right, top],
    'bottom-left': [left, bottom],
    'bottom-right': [right, bottom],
    center: [cx, cy],
  };
  const [x, y] = pos[placement];
  return { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h };
}

/** Kept for callers of the original corner placement. */
export function logoCornerGeometry(source: MediaDimensions | null, canvas: MediaDimensions): ZoneGeometry {
  return placeBox('top-left', logoSize(source, canvas), canvas);
}

/** Which of the five placements a zone is currently at (null = somewhere else). */
export function currentPlacement(zone: ZoneGeometry, canvas: MediaDimensions): LogoPlacement | null {
  for (const p of LOGO_PLACEMENTS) {
    const g = placeBox(p, zone, canvas);
    if (Math.abs(g.x - zone.x) < 0.6 && Math.abs(g.y - zone.y) < 0.6) return p;
  }
  return null;
}

// ── Text styles ─────────────────────────────────────────────────────────

export type BrandTextStyle = 'heading' | 'subheading' | 'body' | 'caption' | 'cta';
export const BRAND_TEXT_STYLES: BrandTextStyle[] = ['heading', 'subheading', 'body', 'caption', 'cta'];

const TEXT_STYLE_SPEC: Record<BrandTextStyle, { width: number; height: number; fontSize: number; bold: boolean; font: 'heading' | 'body' }> = {
  heading: { width: 70, height: 18, fontSize: 48, bold: true, font: 'heading' },
  subheading: { width: 60, height: 12, fontSize: 34, bold: true, font: 'heading' },
  body: { width: 56, height: 14, fontSize: 24, bold: false, font: 'body' },
  caption: { width: 44, height: 8, fontSize: 16, bold: false, font: 'body' },
  cta: { width: 26, height: 11, fontSize: 28, bold: true, font: 'heading' },
};

const overlaps = (a: ZoneGeometry, b: ZoneGeometry) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The vertical slot nearest the centre where a box does not cover a text box
 * already on the canvas: the centre, then alternately below / above it.
 * Everything taken → the centre (better on top than off the canvas).
 */
function freeY(x: number, width: number, height: number, taken: ZoneGeometry[]): number {
  const centre = (100 - height) / 2;
  const step = height + 2;
  const candidates = [centre];
  for (let i = 1; i <= 8; i++) candidates.push(centre + i * step, centre - i * step);
  for (const y of candidates) {
    if (y < 0 || y > 100 - height) continue;
    if (!taken.some((t) => overlaps({ x, y, width, height }, t))) return y;
  }
  return centre;
}

/**
 * A text box for one of the brand text styles, CENTRED on the canvas, in the
 * brand font at the style's size, coloured so it reads on the current
 * background (heading/subheading prefer the brand primary, then accent;
 * body/caption prefer the brand ink). The call-to-action is a filled pill in
 * the brand primary with a readable label.
 *
 * `taken` = text boxes already on the canvas: the new box takes the free slot
 * nearest the centre, so a Heading then a Call to action stack instead of
 * covering each other.
 */
export function brandTextZone(
  style: BrandTextStyle,
  kit: BrandKitLike,
  bgHex: string,
  sampleText: string,
  taken: ZoneGeometry[] = [],
): ZoneGeometry & { config: Record<string, unknown> } {
  const spec = TEXT_STYLE_SPEC[style];
  const p = kit.palette || {};
  const fontHeading = kit.fontHeading || kit.fontBody || null;
  const fontBody = kit.fontBody || kit.fontHeading || null;
  const font = spec.font === 'heading' ? fontHeading : fontBody;
  const x = (100 - spec.width) / 2;
  const y = freeY(x, spec.width, spec.height, taken);
  const config: Record<string, unknown> = {
    content: sampleText,
    fontSize: spec.fontSize,
    alignment: 'center',
    ...(font ? { fontFamily: font } : {}),
    ...(spec.bold ? { bold: true } : {}),
  };
  if (style === 'cta') {
    const fill = normalizeHex(p.primary) ?? normalizeHex(p.accent) ?? '#1e293b';
    config.bgColor = fill;
    config.color = readableOn(fill, [p.surface, '#ffffff'], 4.5, p.ink);
    config.borderRadius = 9999;
  } else if (style === 'heading' || style === 'subheading') {
    config.color = readableOn(bgHex, [p.primary, p.accent, p.ink], 3, p.ink);
  } else {
    config.color = readableOn(bgHex, [p.ink], 4.5, p.ink);
  }
  return { x, y, width: spec.width, height: spec.height, config };
}

// ── "Brand this template" ───────────────────────────────────────────────

/** What "Brand this template" will do with THIS kit — shown before the click. */
export type BrandChecklistItem = 'logo' | 'fonts' | 'colors' | 'background';
export function brandChecklist(kit: BrandKitLike): BrandChecklistItem[] {
  const out: BrandChecklistItem[] = [];
  if (kit.logoUrl) out.push('logo');
  if (kit.fontHeading || kit.fontBody) out.push('fonts');
  if (brandColors(kit.palette).length > 0) out.push('colors');
  if (brandTemplateBackground(kit)) out.push('background');
  return out;
}

/** The template background "Brand this template" sets (null = leave it). */
export function brandTemplateBackground(kit: BrandKitLike): { bgColor: string; bgGradient: string; bgImage: string } | null {
  const p = kit.palette || {};
  const primary = normalizeHex(p.primary);
  const accent = normalizeHex(p.accent);
  const surface = normalizeHex(p.surface) ?? normalizeHex(p.surfaceAlt);
  if (primary && accent && primary !== accent) return { bgGradient: brandGradient(primary, accent), bgColor: surface || primary, bgImage: '' };
  if (surface) return { bgGradient: '', bgColor: surface, bgImage: '' };
  if (primary) return { bgGradient: '', bgColor: primary, bgImage: '' };
  return null;
}

/** Image-slot keys packaged boards use for the organisation logo. */
export const BOARD_LOGO_SLOTS = ['brand.logo', 'school.logo'];

/**
 * The branded config for ONE zone — what "Brand this template" writes. Pure:
 * returns a new config object (equal by value to the old one when nothing
 * applies). Widgets the kit does not model only get keys they already have.
 */
export function brandZoneConfig(zone: Pick<Zone, 'widgetType' | 'defaultConfig'>, kit: BrandKitLike): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...(zone.defaultConfig || {}) };
  const palette = kit.palette || {};
  const fontHeading = kit.fontHeading || null;
  const fontBody = kit.fontBody || fontHeading;
  const logoUrl = kit.logoUrl || null;
  const primary = normalizeHex(palette.primary);
  const accent = normalizeHex(palette.accent);
  const ink = normalizeHex(palette.ink);
  const surface = normalizeHex(palette.surface);
  const surfaceAlt = normalizeHex(palette.surfaceAlt);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(cfg, k);
  const contrastOn = (hex: string) => readableOn(hex, [], 4.5, ink);

  switch (zone.widgetType) {
    case 'LOGO':
      if (logoUrl) { cfg.assetUrl = logoUrl; cfg.logoUrl = logoUrl; }
      if (primary) cfg.accentColor = primary;
      if (ink) cfg.color = ink;
      break;
    case 'TEXT':
    case 'RICH_TEXT':
      if (fontHeading) cfg.fontFamily = fontHeading;
      if (ink) cfg.color = ink;
      break;
    case 'ANNOUNCEMENT':
      if (fontBody) cfg.fontFamily = fontBody;
      if (ink) cfg.color = ink;
      if (surfaceAlt || surface) cfg.bgColor = surfaceAlt || surface;
      if (primary) cfg.accentColor = primary;
      break;
    case 'TICKER':
      if (primary) { cfg.bgColor = primary; cfg.color = contrastOn(primary); }
      if (fontBody) cfg.fontFamily = fontBody;
      break;
    case 'CLOCK':
      if (primary) cfg.accentColor = primary;
      if (ink) cfg.color = ink;
      break;
    case 'WEATHER':
      if (ink) cfg.color = ink;
      if (primary) cfg.accentColor = primary;
      if (surface) cfg.bgColor = surface;
      break;
    case 'COUNTDOWN':
      if (primary) cfg.color = primary;
      if (surface) cfg.bgColor = surface;
      if (fontHeading) cfg.fontFamily = fontHeading;
      break;
    case 'BELL_SCHEDULE':
    case 'LUNCH_MENU':
    case 'CALENDAR':
    case 'STAFF_SPOTLIGHT':
      if (primary) { cfg.headerBg = primary; cfg.headerColor = contrastOn(primary); }
      if (ink) cfg.color = ink;
      if (surface) cfg.bgColor = surface;
      if (fontBody) cfg.fontFamily = fontBody;
      break;
    case 'SCOREBOARD':
    case 'SCORE_HOME':
    case 'SCORE_AWAY':
    case 'GAME_CLOCK':
    case 'GAME_SEGMENT':
    case 'GAME_STAT':
      // Score/clock keep their high-contrast white on the dark board.
      if (fontHeading) cfg.fontFamily = fontHeading;
      if (primary && has('accentColor')) cfg.accentColor = primary;
      if (logoUrl && String(cfg.variant || '') === 'sb-team-logo-home') cfg.logoUrl = logoUrl;
      break;
    case 'EXTERNAL_HTML': {
      // Packaged / AI boards read a `brand` override the in-iframe shim maps
      // to CSS vars. ACCENT + FONTS only — boards ship a deliberate,
      // contrast-balanced theme (often dark), and forcing the brand's light
      // surface + dark ink onto it broke header contrast (2a2ca1c9).
      const b: Record<string, unknown> = { ...((cfg.brand as Record<string, unknown> | undefined) || {}) };
      if (primary) b.primary = primary;
      if (accent || primary) b.accent = accent || primary;
      if (fontHeading) b.fontDisplay = fontHeading;
      if (fontBody) b.fontBody = fontBody;
      if (Object.keys(b).length > 0) cfg.brand = b;
      // The organisation logo into the board's logo slot(s). A slot key the
      // board does not have is ignored by the shim.
      if (logoUrl) {
        const img: Record<string, unknown> = { ...((cfg.imageOverrides as Record<string, unknown> | undefined) || {}) };
        for (const k of BOARD_LOGO_SLOTS) img[k] = logoUrl;
        cfg.imageOverrides = img;
      }
      break;
    }
    default:
      if (ink && has('color')) cfg.color = ink;
      if (surface && has('bgColor')) cfg.bgColor = surface;
      if (fontBody && has('fontFamily')) cfg.fontFamily = fontBody;
      if (primary && has('accentColor')) cfg.accentColor = primary;
      break;
  }
  return cfg;
}

/** A colour on one zone: text colour or background (boards via `brand`). */
export function colorPatchConfig(zone: Pick<Zone, 'widgetType' | 'defaultConfig'>, hex: string, target: 'text' | 'background'): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...(zone.defaultConfig || {}) };
  if (zone.widgetType === 'EXTERNAL_HTML') {
    cfg.brand = { ...((cfg.brand as Record<string, unknown> | undefined) || {}), [target === 'text' ? 'text' : 'background']: hex };
  } else {
    cfg[target === 'text' ? 'color' : 'bgColor'] = hex;
  }
  return cfg;
}

/** Is this zone a text widget for the Text section's colour swatches? */
export function isTextZone(zone: Pick<Zone, 'widgetType'> | null | undefined): boolean {
  return !!zone && BRAND_TEXT_WIDGETS.has(zone.widgetType);
}
