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
 *   the per-template adopt, and by apply-to-templates itself) plus its
 *   `stamped` history (the organisation brand the editor's "Brand this
 *   template" stamped, and the snapshots a later brand replaced). Comparison is
 *   case-insensitive and trimmed, so an HS widget's uppercased name still
 *   reads as brand-owned. Text an operator typed by hand (not blank, not the
 *   old brand) survives 'fill-blanks'; 'override' replaces regardless.
 *
 *   Only a value the brand actually has is ever written — an empty name,
 *   tagline or logo never blanks out existing content.
 *
 *   A zone identity value is also brand-owned when it still equals one of its
 *   renderer's OWN placeholders for that key (the DEFAULTS / FALLBACK /
 *   `|| 'literal'` text the widget paints when the key is absent): nobody
 *   typed it, so the organisation's identity replaces it — at clone time and
 *   on every "Apply to templates", for templates cloned before this rule too.
 *   The keys and placeholders are the shared, renderer-proven registry in
 *   `@cms/api-types` (brand-identity-keys.ts). Placeholder matching collapses
 *   whitespace and NBSP (normaliseIdentityText); previous-brand and style
 *   comparisons stay trimmed + case-insensitive (sameText), as before.
 *
 * No DB, no Nest: the controllers own transactions and audit rows.
 */

import {
  identityKeyApplies,
  identityKeysFor,
  normaliseIdentityText,
  placeholdersFor,
} from '@cms/api-types';

export type BrandApplyMode = 'fill-blanks' | 'override';

// ── Board (EXTERNAL_HTML) field keys ─────────────────────────────────
// PARITY: these lists and deriveInitials() must stay identical to the web
// editor's copies in apps/web/src/components/template-builder/brand-kit-actions.ts
// (BOARD_*_FIELDS, brandInitials). A rebrand recognises what the editor's
// "Brand this template" stamped only if both sides write the same keys with
// the same initials. Both test suites pin the same lists and examples, and
// brand-identity.spec.ts reads the web file to check it.
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
  /**
   * True on a snapshot apply-to-templates wrote: it stamped the default ink
   * (#0f172a) and surface (#ffffff) where the palette had none, so the next
   * rebrand derives this brand WITH those defaults to recognise them.
   */
  appliedDefaults?: boolean | null;
  /** 'tenant-branding' = a copy of the organisation brand, not a per-template detection. */
  inheritedFrom?: string | null;
  /**
   * Earlier brands stamped onto this template that the snapshot itself no
   * longer describes: the editor's "Brand this template" with the
   * organisation brand, and the snapshots a rebrand or an adopt replaced.
   */
  stamped?: unknown;
}

/**
 * The previous brand(s) of a template — one snapshot, or the snapshot plus
 * its `stamped` history (previousBrands()). Every value any of them produced
 * counts as brand-owned.
 */
export type PreviousBrands =
  | BrandLike
  | ReadonlyArray<BrandLike | null | undefined>
  | null
  | undefined;

function prevList(p: PreviousBrands): BrandLike[] {
  if (!p) return [];
  const list = Array.isArray(p) ? p : [p as BrandLike];
  return list.filter(
    (b): b is BrandLike => !!b && typeof b === 'object' && !Array.isArray(b),
  );
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
  opts: { appliedDefaults?: boolean } = {},
): Record<string, unknown> {
  return {
    ...(opts.appliedDefaults ? { appliedDefaults: true } : {}),
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

// ── Brand history (Template.brandKit.stamped) ────────────────────────
// The snapshot says which brand a template carries NOW. The history says
// which other brands were stamped onto it and may still be on its zones:
//   - the editor's "Brand this template" with the organisation brand (the
//     editor records it through POST /branding/templates/:id/stamped, which
//     appends; a canvas change the operator then discards stays covered);
//   - the snapshot a rebrand (apply-to-templates) or an adopt replaced.
// A rebrand treats a value ANY of them produced as brand-owned.

const HISTORY_CAP = 6;

function hasPaletteColour(p: unknown): boolean {
  const r = asRecord(p);
  return !!r && Object.values(r).some((v) => !!str(v));
}

/** The comparable part of a brand: what it stamps. Null when it stamps nothing. */
export function stampEntry(b: BrandLike | null | undefined): BrandLike | null {
  if (!b) return null;
  const palette = asRecord(b.palette);
  const e: BrandLike = {
    displayName: str(b.displayName),
    tagline: str(b.tagline),
    logoUrl: str(b.logoUrl),
    palette: palette ? { ...palette } : null,
    fontHeading: str(b.fontHeading),
    fontBody: str(b.fontBody),
  };
  if (b.appliedDefaults === true) e.appliedDefaults = true;
  const stamps =
    e.displayName ||
    e.tagline ||
    e.logoUrl ||
    e.fontHeading ||
    e.fontBody ||
    hasPaletteColour(e.palette);
  return stamps ? e : null;
}

/** JSON with sorted keys — Postgres jsonb does not keep key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function entryKey(e: BrandLike): string {
  return stableJson(stampEntry(e) ?? {});
}

/** The `stamped` history a brandKit carries (entries only). */
export function stampedHistory(raw: unknown): BrandLike[] {
  const k = brandKitAsBrand(raw);
  const list = k && Array.isArray(k.stamped) ? k.stamped : [];
  return list
    .map((e) => stampEntry(asRecord(e) as BrandLike | null))
    .filter((e): e is BrandLike => !!e);
}

/**
 * Every brand whose values on this template's zones are brand-owned: the
 * snapshot (when it stamps anything) and its history. Empty = no previous
 * brand (fill blanks only).
 */
export function previousBrands(raw: unknown): BrandLike[] {
  const k = brandKitAsBrand(raw);
  if (!k) return [];
  const out: BrandLike[] = [];
  if (stampEntry(k)) out.push(k);
  out.push(...stampedHistory(k));
  return out;
}

/** History + additions, deduplicated (latest kept), without `current`, newest last, capped. */
function mergeHistory(
  existing: BrandLike[],
  additions: Array<BrandLike | null | undefined>,
  current: BrandLike | null | undefined,
): BrandLike[] {
  const currentKey = current && stampEntry(current) ? entryKey(current) : null;
  let out: BrandLike[] = [];
  for (const raw of [...existing, ...additions]) {
    const e = stampEntry(raw);
    if (!e) continue;
    const key = entryKey(e);
    if (key === currentKey) continue;
    out = out.filter((x) => entryKey(x) !== key);
    out.push(e);
  }
  return out.slice(-HISTORY_CAP);
}

function withHistoryList(
  kit: Record<string, unknown>,
  history: BrandLike[],
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...kit };
  delete rest.stamped;
  return history.length > 0 ? { ...rest, stamped: history } : rest;
}

/**
 * The brandKit that replaces `oldRaw` with `next` (a rebrand's snapshot, or
 * a per-template adopt): `next`, carrying the old kit and its history as
 * history, so the zones the old brand stamped stay recognisable.
 */
export function replaceBrandKit(
  next: Record<string, unknown>,
  oldRaw: unknown,
): Record<string, unknown> {
  const old = brandKitAsBrand(oldRaw);
  const history = mergeHistory(
    old ? stampedHistory(old) : [],
    [old],
    next as BrandLike,
  );
  return withHistoryList(next, history);
}

/**
 * The brandKit after `brand` was stamped onto the template's zones while the
 * snapshot stays as it is (the editor's "Brand this template" with the
 * organisation brand; a duplicate that filled blanks with it): the existing
 * kit untouched, `brand` appended to its history. `{ stamped: [...] }` alone
 * when the template had no kit — it carries no palette, so nothing reads it
 * as a per-template brand.
 */
export function appendStampedBrand(
  oldRaw: unknown,
  brand: BrandLike | null | undefined,
): Record<string, unknown> | null {
  const old = brandKitAsBrand(oldRaw);
  const base: Record<string, unknown> = old
    ? { ...(old as Record<string, unknown>) }
    : {};
  const history = mergeHistory(old ? stampedHistory(old) : [], [brand], old);
  const out = withHistoryList(base, history);
  return Object.keys(out).length > 0 ? out : null;
}

/** A brand detected for one template (not a copy of the organisation brand). */
export function isPerTemplateKit(raw: unknown): boolean {
  const k = brandKitAsBrand(raw);
  return !!k && k.inheritedFrom !== 'tenant-branding' && !!stampEntry(k);
}

/**
 * The brandKit of a DUPLICATE. Its zones are the source's, with blanks
 * filled by the organisation brand as it is now (`currentSnapshot`):
 *   - a per-template kit stays, and the organisation brand joins its history;
 *   - otherwise (a copy of the organisation brand, or none) the current
 *     snapshot, with the source's kit and history as history — so a
 *     duplicate made after a rebrand does not hold brand B under snapshot A.
 * No organisation brand: the source's kit as it is.
 */
export function duplicateBrandKit(
  sourceRaw: unknown,
  currentSnapshot: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const src = brandKitAsBrand(sourceRaw);
  if (!currentSnapshot)
    return src ? { ...(src as Record<string, unknown>) } : null;
  if (isPerTemplateKit(src))
    return appendStampedBrand(src, currentSnapshot as BrandLike);
  return replaceBrandKit(currentSnapshot, src);
}

/** Same brandKit, ignoring the inheritedAt timestamp (a rebrand to the same brand changes nothing). */
export function sameBrandKit(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    const k = brandKitAsBrand(v);
    if (!k) return 'null';
    const rest: Record<string, unknown> = { ...(k as Record<string, unknown>) };
    delete rest.inheritedAt;
    return stableJson(rest);
  };
  return norm(a) === norm(b);
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

/**
 * Is `current` one of the renderer's own placeholders for this key? Compared
 * as a person reads it (normaliseIdentityText: NBSP, collapsed whitespace,
 * trimmed, lowercased), so an innerText capture still matches. An image slot
 * may hold a one-item list, as in sameText.
 */
export function isPlaceholder(
  current: unknown,
  placeholders: readonly string[],
): boolean {
  if (placeholders.length === 0) return false;
  let c: unknown = current;
  if (Array.isArray(c)) {
    const items = c.filter((x) => typeof x === 'string' && x.trim());
    if (items.length !== 1) return false;
    c = items[0];
  }
  const n = normaliseIdentityText(c);
  if (!n) return false;
  return placeholders.some((p) => normaliseIdentityText(p) === n);
}

/**
 * Write `value` into `obj[key]` when it is brand-owned (blank, a previous
 * brand's, 'override') or still one of the renderer's `placeholders`, and
 * differs. Returns true when it wrote.
 */
function put(
  obj: Record<string, unknown>,
  key: string,
  value: string | null,
  previousValues: Array<string | null | undefined>,
  mode: BrandApplyMode,
  placeholders: readonly string[] = [],
): boolean {
  if (!value) return false;
  const current = obj[key];
  if (current === value) return false;
  if (
    !isBrandOwned(current, previousValues, mode) &&
    !isPlaceholder(current, placeholders)
  )
    return false;
  obj[key] = value;
  return true;
}

/**
 * The nested copy of a dotted key (`cfg.school.name` for 'school.name'), or
 * undefined. BuilderZone's inline edit (setByPath, 2026-05-03 to 2026-10-27)
 * saved MS dotted fields nested, where pick() — which reads the FLAT key —
 * never sees them; the shadow still records what the operator meant.
 */
function nestedShadow(cfg: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return undefined;
  let v: unknown = cfg;
  for (const part of key.split('.')) {
    const r = asRecord(v);
    if (!r || !Object.prototype.hasOwnProperty.call(r, part)) return undefined;
    v = r[part];
  }
  return v;
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
 *   a type in WIDGET_IDENTITY_KEYS (@cms/api-types) — the keys its renderer
 *                  reads, e.g.
 *                  LOGO       logoUrl, assetUrl ← logo; schoolName ← name;
 *                             tagline ← tagline; initials ← initials (only
 *                             where the key exists, or on the athletics crest)
 *                  HS_*       schoolName ← NAME (uppercase); schoolInitials on
 *                             Varsity; nothing on Terminal / Transit
 *                  MS_*       'school.name' / 'brand.name' ← name (flat keys);
 *                             'school.logoUrl' / 'brand.logoUrl' /
 *                             'masthead.logoUrl' ← logo
 *                  FITNESS_*  gymLogoUrl ← logo
 *                  ANIMATED_WELCOME*  logoUrl ← logo;
 *                  ANIMATED_HALLWAY_SCHEDULE*  tagline ← tagline
 *                  A value still equal to that renderer's own placeholder
 *                  for the key counts as brand-owned.
 *   anything else  only when the config already carries `schoolName`:
 *                  schoolName, and tagline / initials / schoolInitials where
 *                  those keys exist
 *                  (a STAFF_SPOTLIGHT `initials` is a person's; a sponsor
 *                  `tagline` is the sponsor's — neither has a schoolName).
 */
export function patchZoneIdentity(
  zone: ZoneIdentityInput,
  next: BrandLike | null | undefined,
  previous: PreviousBrands,
  mode: BrandApplyMode,
): ZoneIdentityResult {
  const id = identityFromBrand(next);
  const prev = prevList(previous).map(identityFromBrand);
  const cfg: Record<string, unknown> = { ...(zone.cfg || {}) };
  const changed = new Set<IdentityField>();
  const prevName = prev.map((p) => p.name);
  const prevTagline = prev.map((p) => p.tagline);
  const prevInitials = prev.map((p) => p.initials);
  const prevMonogram = prev.map((p) => p.monogram);
  const prevLogo = prev.map((p) => p.logoUrl);
  const type = String(zone.widgetType || '');
  const specs = identityKeysFor(type);

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
  } else if (specs) {
    const valueOf: Record<IdentityField, string | null> = {
      name: id.name,
      tagline: id.tagline,
      initials: id.initials,
      logo: id.logoUrl,
    };
    const prevOf: Record<IdentityField, Array<string | null>> = {
      name: prevName,
      tagline: prevTagline,
      initials: prevInitials,
      logo: prevLogo,
    };
    // Selectors (variant / theme) read the zone as it was, before any write.
    const zoneCfg = { ...cfg };
    for (const spec of specs) {
      const raw = valueOf[spec.role];
      const value = raw && spec.upper ? raw.toUpperCase() : raw;
      if (!value) continue;
      if (!identityKeyApplies(spec, zoneCfg)) continue;
      const placeholders = placeholdersFor(spec, zoneCfg);
      const prevValues = prevOf[spec.role];
      // A nested shadow of a dotted key (an old inline edit pick() never
      // read) that holds typed text means the operator wrote something
      // there: fill-blanks leaves the flat key alone. A shadow that is
      // blank, a previous brand's or a placeholder changes nothing.
      const shadow = nestedShadow(zoneCfg, spec.key);
      if (
        mode !== 'override' &&
        shadow !== undefined &&
        !isBrandOwned(shadow, prevValues, mode) &&
        !isPlaceholder(shadow, placeholders)
      )
        continue;
      if (put(cfg, spec.key, value, prevValues, mode, placeholders))
        changed.add(spec.role);
    }
  } else if ('schoolName' in cfg) {
    if (put(cfg, 'schoolName', id.name, prevName, mode)) changed.add('name');
    if ('tagline' in cfg && put(cfg, 'tagline', id.tagline, prevTagline, mode))
      changed.add('tagline');
    if (
      'initials' in cfg &&
      put(cfg, 'initials', id.initials, prevInitials, mode)
    )
      changed.add('initials');
    if (
      'schoolInitials' in cfg &&
      put(cfg, 'schoolInitials', id.initials, prevInitials, mode)
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
 * controller's fallbacks (ink #0f172a, surface #ffffff) for the NEW brand.
 * A PREVIOUS brand is derived with them only when its snapshot records that
 * they were stamped (`appliedDefaults`, previousStyle()), so a hand-picked
 * slate or white is never mistaken for something an empty palette stamped.
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

/**
 * How a PREVIOUS brand is derived: with the default ink / surface only when
 * its snapshot records that apply-to-templates stamped them (appliedDefaults),
 * so a hand-picked slate or white is never mistaken for an empty palette's
 * default, and a default that WAS stamped is recognised.
 */
function previousStyle(prev: BrandLike): BrandStyle {
  return styleFromBrand(prev, prev.appliedDefaults === true);
}

/** Every value the previous brand(s) may have written into one `cfg.brand` key (server + editor paths). */
function previousTokenValues(prevs: BrandLike[], key: string): string[] {
  const out: Array<string | null> = [];
  for (const prev of prevs) {
    const st = previousStyle(prev);
    const p = asRecord(prev.palette) || {};
    out.push(st.tokens[key] ?? null);
    if (key === 'fontBody') out.push(st.fontHeading); // the editor writes fontBody || fontHeading
    if (key === 'accent') out.push(str(p.accent));
  }
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
  previous: PreviousBrands,
  mode: BrandApplyMode,
): { cfg: Record<string, unknown>; changed: boolean } {
  const cfg: Record<string, unknown> = { ...(zone.cfg || {}) };
  const prevs = prevList(previous);
  const prev = prevs.map(previousStyle);
  let changed = false;

  if (
    put(
      cfg,
      'color',
      next.ink,
      prev.map((p) => p.ink),
      mode,
    )
  )
    changed = true;
  // The editor writes the body font on some widgets (fontBody || fontHeading).
  if (
    put(
      cfg,
      'fontFamily',
      next.fontHeading,
      prev.flatMap((p) => [p.fontHeading, p.fontBody]),
      mode,
    )
  )
    changed = true;
  // apply-to-templates writes accent || primary; the editor writes primary.
  if (
    put(
      cfg,
      'accentColor',
      next.accent,
      prevs.flatMap((b, i) => [
        prev[i].accent,
        str((asRecord(b.palette) || {}).accent),
        prev[i].primary,
      ]),
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
    } else if (current && prevs.length > 0) {
      const owned = (k: string) =>
        isBlank(current[k]) ||
        previousTokenValues(prevs, k).some((v) => sameText(current[k], v));
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
  previous: PreviousBrands,
  mode: BrandApplyMode,
): { bgColor?: string | null; bgGradient?: string | null } {
  const hasAnyBg = Boolean(tpl.bgColor || tpl.bgGradient || tpl.bgImage);
  let replace = mode === 'override' || !hasAnyBg;
  const prevs = prevList(previous);
  if (!replace && prevs.length > 0 && !tpl.bgImage) {
    const gradients: Array<string | null> = [];
    const flat: Array<string | null> = [];
    for (const previousBrand of prevs) {
      const prev = previousStyle(previousBrand);
      const prevBg = brandBackground(prev);
      const p = asRecord(previousBrand.palette) || {};
      gradients.push(prevBg.bgGradient);
      flat.push(
        prevBg.bgColor,
        prev.surface,
        str(p.surface),
        str(p.surfaceAlt),
        prev.primary,
      );
    }
    const gradientOwned =
      isBlank(tpl.bgGradient) ||
      gradients.some((g) => sameText(tpl.bgGradient, g));
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
