/**
 * brand-identity — the rebrand rule, as pure functions.
 *
 * A brand is more than colours: it is a name, a tagline, initials and a
 * logo. Until this module, "Apply to templates" re-tinted colours and fonts
 * but never wrote the organisation's name, tagline or logo, and because it
 * only filled blanks, a SECOND brand (a rebrand) never replaced anything
 * the first brand had stamped.
 *
 * The rule (mirrored by the web editor's brand-kit-actions.ts):
 *
 *   A field may be written when it is blank/absent, OR when it still equals
 *   what the template's PREVIOUS brand produced. The previous brand is the
 *   template's own `Template.brandKit` snapshot (written at clone time, by
 *   the per-template adopt, and by apply-to-templates itself). Comparison is
 *   case-insensitive and trimmed, so an HS widget's uppercased name still
 *   reads as brand-owned. Text an operator typed by hand (not blank, not the
 *   old brand) survives 'fill-blanks'; 'override' replaces regardless.
 *
 *   Only a value the brand actually has is ever written — an empty name,
 *   tagline or logo never blanks out existing content.
 *
 * No DB, no Nest: the controllers own transactions and audit rows.
 */

export type BrandApplyMode = 'fill-blanks' | 'override';

// ── Board (EXTERNAL_HTML) field keys ─────────────────────────────────
// `data-field` keys in apps/web/public/templates/**/*.html, applied by the
// in-iframe shim from cfg.textOverrides. A key a board does not carry is
// ignored by the shim, so writing every alias is safe. Deliberately NOT
// here: brand.tag, school.sub, brand.promise, brand.descriptor,
// school.systemName — those mean different things on different boards.
export const BOARD_NAME_FIELDS = [
  'brand.name',
  'school.name',
  'brand.restaurant',
] as const;
export const BOARD_TAGLINE_FIELDS = ['brand.tagline', 'school.motto'] as const;
export const BOARD_INITIALS_FIELDS = [
  'school.initials',
  'brand.initials',
  'brand.mark',
] as const;
export const BOARD_MONOGRAM_FIELDS = ['brand.monogram'] as const;
/** Board logo image slots (cfg.imageOverrides). */
export const BOARD_LOGO_SLOTS = ['brand.logo', 'school.logo'] as const;

/** The brand fields this module reads — a TenantBranding row or a Template.brandKit snapshot. */
export interface BrandLike {
  displayName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  palette?: Record<string, unknown> | null;
  fontHeading?: string | null;
  fontBody?: string | null;
}

export interface BrandIdentity {
  name: string | null;
  tagline: string | null;
  initials: string | null;
  monogram: string | null;
  logoUrl: string | null;
}

export type IdentityField = 'name' | 'tagline' | 'initials' | 'logo';
export type IdentityCounts = Record<IdentityField, number>;

export function emptyIdentityCounts(): IdentityCounts {
  return { name: 0, tagline: 0, initials: 0, logo: 0 };
}

const STOP_WORDS = /^(the|of|at|and|for|in|a|an)$/i;

/**
 * Initials from an organisation name: split on whitespace / - / _ / '/',
 * skip the/of/at/and/for/in/a/an, first letter of up to three words,
 * uppercase. "Buena Park High School" → "BPH"; "The Lincoln Academy" → "LA".
 */
export function deriveInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .split(/[\s\-_/]+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.test(w))
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/** The identity values a brand actually has (null where it has none). */
export function identityFromBrand(
  b: BrandLike | null | undefined,
): BrandIdentity {
  const name = str(b?.displayName);
  const initials = name ? deriveInitials(name) || null : null;
  return {
    name,
    tagline: str(b?.tagline),
    initials,
    monogram: initials ? initials[0] : null,
    logoUrl: str(b?.logoUrl),
  };
}

/** Read a `Template.brandKit` JSON value as a brand (null when it is not an object). */
export function brandKitAsBrand(raw: unknown): BrandLike | null {
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as BrandLike;
}

/**
 * The `Template.brandKit` snapshot for a tenant brand. One shape for the
 * clone paths and apply-to-templates, so the next rebrand can recognise
 * exactly what this brand stamped (including the tagline).
 */
export function brandKitSnapshot(
  b: {
    palette?: unknown;
    logoUrl?: string | null;
    logoSvgInline?: string | null;
    faviconUrl?: string | null;
    fontHeading?: string | null;
    fontBody?: string | null;
    fontHeadingUrl?: string | null;
    fontBodyUrl?: string | null;
    displayName?: string | null;
    tagline?: string | null;
    sourceUrl?: string | null;
    scrapedAt?: Date | string | null;
  },
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    palette: (b.palette as Record<string, unknown> | null) || {},
    logoUrl: b.logoUrl ?? null,
    logoSvgInline: b.logoSvgInline ?? null,
    faviconUrl: b.faviconUrl ?? null,
    fontHeading: b.fontHeading ?? null,
    fontBody: b.fontBody ?? null,
    fontHeadingUrl: b.fontHeadingUrl ?? null,
    fontBodyUrl: b.fontBodyUrl ?? null,
    displayName: b.displayName ?? null,
    tagline: b.tagline ?? null,
    sourceUrl: b.sourceUrl ?? null,
    scrapedAt: b.scrapedAt ? new Date(b.scrapedAt).toISOString() : null,
    inheritedAt: now.toISOString(),
    inheritedFrom: 'tenant-branding',
  };
}

// ── The brand-owned test ─────────────────────────────────────────────

export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v))
    return v.every((x) => typeof x !== 'string' || x.trim() === '');
  return false;
}

function sameText(
  current: unknown,
  candidate: string | null | undefined,
): boolean {
  if (!candidate) return false;
  let c: unknown = current;
  // An image slot may hold a one-item list.
  if (Array.isArray(c)) {
    const items = c.filter((x) => typeof x === 'string' && x.trim());
    if (items.length !== 1) return false;
    c = items[0];
  }
  return (
    typeof c === 'string' &&
    c.trim().toLowerCase() === candidate.trim().toLowerCase()
  );
}

/**
 * May `current` be replaced? 'override' → always. Otherwise when blank, or
 * when it equals one of the values the previous brand produced.
 */
export function isBrandOwned(
  current: unknown,
  previousValues: Array<string | null | undefined>,
  mode: BrandApplyMode,
): boolean {
  if (mode === 'override') return true;
  if (isBlank(current)) return true;
  return previousValues.some((p) => sameText(current, p));
}

/** Write `value` into `obj[key]` when it is brand-owned and differs. Returns true when it wrote. */
function put(
  obj: Record<string, unknown>,
  key: string,
  value: string | null,
  previousValues: Array<string | null | undefined>,
  mode: BrandApplyMode,
): boolean {
  if (!value) return false;
  const current = obj[key];
  if (current === value) return false;
  if (!isBrandOwned(current, previousValues, mode)) return false;
  obj[key] = value;
  return true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export interface ZoneIdentityInput {
  widgetType: string | null | undefined;
  cfg: Record<string, unknown>;
}

export interface ZoneIdentityResult {
  /** The patched config (a new object; the input is never mutated). */
  cfg: Record<string, unknown>;
  /** Which identity fields this zone changed. */
  changed: IdentityField[];
}

/**
 * Apply the brand's identity (name, tagline, initials, logo) to one zone.
 *
 *   EXTERNAL_HTML  textOverrides  brand.name / school.name / brand.restaurant ← name
 *                                 brand.tagline / school.motto               ← tagline
 *                                 school.initials / brand.initials / brand.mark ← initials
 *                                 brand.monogram                             ← first letter
 *                  imageOverrides brand.logo / school.logo                   ← logo
 *   LOGO           logoUrl, assetUrl ← logo; schoolName ← name; tagline ← tagline;
 *                  initials ← initials (only when the zone already has that key)
 *   HS_*           schoolName ← NAME (uppercase); schoolInitials ← initials
 *   anything else  only when the config already carries `schoolName`:
 *                  schoolName, and tagline / initials where those keys exist
 *                  (a STAFF_SPOTLIGHT `initials` is a person's; a sponsor
 *                  `tagline` is the sponsor's — neither has a schoolName).
 */
export function patchZoneIdentity(
  zone: ZoneIdentityInput,
  next: BrandLike | null | undefined,
  previous: BrandLike | null | undefined,
  mode: BrandApplyMode,
): ZoneIdentityResult {
  const id = identityFromBrand(next);
  const prev = previous ? identityFromBrand(previous) : null;
  const cfg: Record<string, unknown> = { ...(zone.cfg || {}) };
  const changed = new Set<IdentityField>();
  const prevName = [prev?.name];
  const prevTagline = [prev?.tagline];
  const prevInitials = [prev?.initials];
  const prevMonogram = [prev?.monogram];
  const prevLogo = [prev?.logoUrl];
  const type = String(zone.widgetType || '');

  if (type === 'EXTERNAL_HTML') {
    const text: Record<string, unknown> = {
      ...(asRecord(cfg.textOverrides) || {}),
    };
    let textChanged = false;
    for (const k of BOARD_NAME_FIELDS)
      if (put(text, k, id.name, prevName, mode)) {
        textChanged = true;
        changed.add('name');
      }
    for (const k of BOARD_TAGLINE_FIELDS)
      if (put(text, k, id.tagline, prevTagline, mode)) {
        textChanged = true;
        changed.add('tagline');
      }
    for (const k of BOARD_INITIALS_FIELDS)
      if (put(text, k, id.initials, prevInitials, mode)) {
        textChanged = true;
        changed.add('initials');
      }
    for (const k of BOARD_MONOGRAM_FIELDS)
      if (put(text, k, id.monogram, prevMonogram, mode)) {
        textChanged = true;
        changed.add('initials');
      }
    if (textChanged) cfg.textOverrides = text;

    const img: Record<string, unknown> = {
      ...(asRecord(cfg.imageOverrides) || {}),
    };
    let imgChanged = false;
    for (const k of BOARD_LOGO_SLOTS)
      if (put(img, k, id.logoUrl, prevLogo, mode)) {
        imgChanged = true;
        changed.add('logo');
      }
    if (imgChanged) cfg.imageOverrides = img;
  } else if (type === 'LOGO') {
    if (put(cfg, 'logoUrl', id.logoUrl, prevLogo, mode)) changed.add('logo');
    if (put(cfg, 'assetUrl', id.logoUrl, prevLogo, mode)) changed.add('logo');
    if (put(cfg, 'schoolName', id.name, prevName, mode)) changed.add('name');
    if (put(cfg, 'tagline', id.tagline, prevTagline, mode))
      changed.add('tagline');
    if (
      'initials' in cfg &&
      put(cfg, 'initials', id.initials, prevInitials, mode)
    )
      changed.add('initials');
  } else if (type.startsWith('HS_')) {
    if (
      put(
        cfg,
        'schoolName',
        id.name ? id.name.toUpperCase() : null,
        prevName,
        mode,
      )
    )
      changed.add('name');
    if (put(cfg, 'schoolInitials', id.initials, prevInitials, mode))
      changed.add('initials');
  } else if ('schoolName' in cfg) {
    if (put(cfg, 'schoolName', id.name, prevName, mode)) changed.add('name');
    if ('tagline' in cfg && put(cfg, 'tagline', id.tagline, prevTagline, mode))
      changed.add('tagline');
    if (
      'initials' in cfg &&
      put(cfg, 'initials', id.initials, prevInitials, mode)
    )
      changed.add('initials');
  }

  return { cfg, changed: Array.from(changed) };
}

// ── Colours and fonts (apply-to-templates) ───────────────────────────

/** What apply-to-templates derives from a brand's palette + fonts. */
export interface BrandStyle {
  ink: string | null;
  surface: string | null;
  primary: string | null;
  /** accent, falling back to primary — what apply-to-templates writes as accentColor. */
  accent: string | null;
  fontHeading: string | null;
  fontBody: string | null;
  /** The EXTERNAL_HTML `cfg.brand` token map the board shim reads. */
  tokens: Record<string, string>;
}

/**
 * Derive the style a brand stamps. `withDefaults` reproduces the
 * controller's fallbacks (ink #0f172a, surface #ffffff) for the NEW brand;
 * the PREVIOUS brand is derived without them so a hand-picked slate or
 * white is never mistaken for something an empty palette stamped.
 */
export function styleFromBrand(
  b: BrandLike | null | undefined,
  withDefaults: boolean,
): BrandStyle {
  const p = asRecord(b?.palette) || {};
  const s = (k: string) => str(p[k]);
  const primary = s('primary');
  const accent = s('accent') || primary;
  const ink = s('ink') || (withDefaults ? '#0f172a' : null);
  const surface =
    s('surface') ||
    s('surfaceAlt') ||
    primary ||
    (withDefaults ? '#ffffff' : null);
  const fontHeading = str(b?.fontHeading);
  const fontBody = str(b?.fontBody);
  const tokens: Record<string, string> = {};
  if (primary) tokens.primary = primary;
  if (accent) tokens.accent = accent;
  if (ink) tokens.text = ink;
  if (surface) tokens.surface = surface;
  const background = primary || surface;
  if (background) tokens.background = background;
  const muted = s('muted') || s('ink2') || s('ink3');
  if (muted) tokens.muted = muted;
  if (fontHeading) tokens.fontDisplay = fontHeading;
  if (fontBody) tokens.fontBody = fontBody;
  return { ink, surface, primary, accent, fontHeading, fontBody, tokens };
}

/** Every value the previous brand may have written into one `cfg.brand` key (server + editor paths). */
function previousTokenValues(prev: BrandLike, key: string): string[] {
  const st = styleFromBrand(prev, false);
  const p = asRecord(prev.palette) || {};
  const out: Array<string | null> = [st.tokens[key] ?? null];
  if (key === 'fontBody') out.push(st.fontHeading); // the editor writes fontBody || fontHeading
  if (key === 'accent') out.push(str(p.accent));
  return out.filter((v): v is string => !!v);
}

/**
 * Patch the colour / font / brand-token keys apply-to-templates writes on
 * one zone, with the brand-owned rule. Without a previous brand this is
 * exactly the old fill-blanks behaviour (a defined `cfg.brand` is left
 * alone); with one, values the previous brand stamped are replaced too.
 */
export function patchZoneStyle(
  zone: ZoneIdentityInput,
  next: BrandStyle,
  previous: BrandLike | null | undefined,
  mode: BrandApplyMode,
): { cfg: Record<string, unknown>; changed: boolean } {
  const cfg: Record<string, unknown> = { ...(zone.cfg || {}) };
  const prev = previous ? styleFromBrand(previous, false) : null;
  const prevPalette = asRecord(previous?.palette) || {};
  let changed = false;

  if (put(cfg, 'color', next.ink, [prev?.ink], mode)) changed = true;
  if (put(cfg, 'fontFamily', next.fontHeading, [prev?.fontHeading], mode))
    changed = true;
  if (
    put(
      cfg,
      'accentColor',
      next.accent,
      [prev?.accent, str(prevPalette.accent)],
      mode,
    )
  )
    changed = true;

  if (
    zone.widgetType === 'EXTERNAL_HTML' &&
    Object.keys(next.tokens).length > 0
  ) {
    const current = asRecord(cfg.brand);
    let out: Record<string, unknown> | null = null;
    if (mode === 'override' || cfg.brand === undefined || cfg.brand === null) {
      out = { ...next.tokens };
    } else if (current && previous) {
      const owned = (k: string) =>
        isBlank(current[k]) ||
        previousTokenValues(previous, k).some((v) => sameText(current[k], v));
      const keys = Object.keys(current);
      if (keys.every(owned)) {
        // The whole map is what the previous brand stamped: the new brand replaces it.
        out = { ...next.tokens };
      } else {
        // Hand-edited keys stay; brand-owned keys follow the new brand.
        out = { ...current };
        for (const k of keys) {
          if (!owned(k)) continue;
          if (next.tokens[k]) out[k] = next.tokens[k];
          else delete out[k];
        }
      }
    }
    if (out && JSON.stringify(out) !== JSON.stringify(cfg.brand)) {
      cfg.brand = out;
      changed = true;
    }
  }
  return { cfg, changed };
}

export interface TemplateBg {
  bgColor: string | null;
  bgGradient: string | null;
  bgImage: string | null;
}

function brandBackground(st: BrandStyle): {
  bgColor: string | null;
  bgGradient: string | null;
} {
  if (st.primary && st.accent && st.primary !== st.accent) {
    return {
      bgColor: st.primary,
      bgGradient: `linear-gradient(135deg, ${st.primary} 0%, ${st.accent} 100%)`,
    };
  }
  return { bgColor: st.surface, bgGradient: null };
}

/**
 * Template background. Written in 'override', when the template states no
 * background at all, or when its background is still the previous brand's
 * (its gradient, or its surface / primary as a flat colour) with no photo.
 */
export function patchTemplateBackground(
  tpl: TemplateBg,
  next: BrandStyle,
  previous: BrandLike | null | undefined,
  mode: BrandApplyMode,
): { bgColor?: string | null; bgGradient?: string | null } {
  const hasAnyBg = Boolean(tpl.bgColor || tpl.bgGradient || tpl.bgImage);
  let replace = mode === 'override' || !hasAnyBg;
  if (!replace && previous && !tpl.bgImage) {
    const prev = styleFromBrand(previous, false);
    const prevBg = brandBackground(prev);
    const p = asRecord(previous.palette) || {};
    const flat = [
      prevBg.bgColor,
      prev.surface,
      str(p.surface),
      str(p.surfaceAlt),
      prev.primary,
    ];
    const gradientOwned =
      isBlank(tpl.bgGradient) || sameText(tpl.bgGradient, prevBg.bgGradient);
    const colorOwned =
      isBlank(tpl.bgColor) || flat.some((v) => sameText(tpl.bgColor, v));
    replace = gradientOwned && colorOwned;
  }
  if (!replace) return {};
  const bg = brandBackground(next);
  if (!bg.bgColor && !bg.bgGradient) return {};
  if (
    bg.bgColor === tpl.bgColor &&
    (bg.bgGradient ?? null) === (tpl.bgGradient ?? null)
  )
    return {};
  return { bgColor: bg.bgColor, bgGradient: bg.bgGradient };
}
