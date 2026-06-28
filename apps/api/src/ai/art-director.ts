/**
 * art-director.ts — the MAPPER that turns an ArtDirectorSpec (the only thing
 * the LLM emits) into a persistable Template (zones + background descriptor),
 * by running the @cms/signage-design engine pipeline.
 *
 * THE ARCHITECTURE (Wave 2 of the AI-template flagship rebuild):
 *   The LLM is an ART DIRECTOR — it picks an archetype + theme + writes copy +
 *   an image plan + an accentSlot. It emits NO coordinates, NO hex, NO font
 *   sizes. This module runs the engine (resolveArchetype → enforce) which OWNS
 *   geometry / type scale / color / contrast, then maps the engine's
 *   ResolvedZones into the SAME zone shape `sanitizeTouchTemplate` produces
 *   (so the result drops straight into the existing persist + render path),
 *   plus a `background` descriptor for the Template's bgColor/bgGradient/bgImage.
 *
 * Precedence inside the engine: archetype > theme > validator. We never
 * second-guess the engine's geometry/sizes — we only translate its tokens into
 * the renderer's `defaultConfig` vocabulary (absolute px, hex, scrim CSS).
 *
 * TAURUS NOTE (CLAUDE.md rule #10): geometry stays as %; the RENDERER
 * (WidgetRenderer SignageText / IMAGE block) translates to longhand
 * top/right/bottom/left — never `inset`/`gap`. This module emits no CSS.
 */

import {
  ARCHETYPE_IDS,
  LARGE_CONTRAST_FLOOR,
  THEMES,
  bestTextColor,
  cardFillCss,
  classifyCanvas,
  contrastRatio,
  deriveThemeFromBrand,
  dividerCss,
  getTheme,
  imageHalfCss,
  resolveArchetype,
  resolveCanvas,
  enforce,
  themeBackgroundCss,
  type ArchetypeId,
  type ArchetypeItem,
  type ArtDirectorSpec,
  type ResolvedZone,
  type SceneSpec,
  type ScrimSpec,
  type SurfaceStyle,
  type ThemeBundle,
  type ThemePalette,
} from '@cms/signage-design';

/** The zone shape `sanitizeTouchTemplate` produces (plus our `sceneRef`). */
export interface MappedZone {
  name?: string;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultConfig?: Record<string, any>;
  /** Scene NAME (controller resolves to created scene id). */
  sceneRef?: string;
  /**
   * FUNCTIONAL BINDING (2026-06-28) — an interactive tap action on the zone
   * (open-url/goto-scene/etc.). The sanitizer (sanitizeTouchTemplate) validates
   * + SSRF-guards it. Emitted for a CTA zone when a real ctaHref is supplied so
   * a generated kiosk CTA actually does something when tapped.
   */
  touchAction?: { type: string; target?: string; [k: string]: any };
}

export interface MappedBackground {
  bgColor?: string;
  bgGradient?: string;
  bgImage?: string;
}

export interface MappedTemplate {
  name: string;
  description?: string;
  zones: MappedZone[];
  scenes?: Array<{ name: string }>;
  background: MappedBackground;
}

export interface ArtDirectorMapOptions {
  screenWidth: number;
  screenHeight: number;
  brandPrimaryHex?: string;
  brandAccentHex?: string;
  /**
   * GUIDED-INTAKE directives (guided-intake.ts). All optional — when present each
   * is a HARD directive the engine honors; when absent the engine derives as
   * before (zero regression).
   *   - forcedSurfaceStyle: override the theme's SurfaceStyle dials (solid /
   *     gradient / textured background choice).
   *   - paletteOverride: replace specific palette tokens from custom swatches
   *     (the contrast guard still re-derives legible text against them).
   *   - requiredWidgets: content widgets the operator REQUIRES as zones; the
   *     mapper emits each as a supplemental zone with a sensible default.
   */
  forcedSurfaceStyle?: Partial<SurfaceStyle>;
  paletteOverride?: Partial<ThemePalette>;
  requiredWidgets?: GuidedRequiredWidget[];
  /**
   * FUNCTIONAL BINDING (2026-06-28) — tenant CONTEXT + user-supplied values that
   * make live/link widgets actually work. All optional + best-effort (a missing
   * value just leaves the widget on its prior no-op default — zero regression):
   *   - weatherLocation: the venue's "lat,lng" / city → WEATHER config.location.
   *   - logoUrl:         the tenant brand-kit logo → LOGO config.assetUrl.
   *   - eventDate:       ISO event date (from the spec copy) → COUNTDOWN config.targetDate.
   *   - ctaHref:         the real CTA/QR destination (from the spec copy) → QR
   *                      config.qrText AND a CTA zone's open-url touchAction.
   */
  weatherLocation?: string;
  logoUrl?: string;
  eventDate?: string;
  ctaHref?: string;
}

/** The content widgets the guided-intake may require (mirror of GuidedWidget). */
export type GuidedRequiredWidget =
  | 'headline'
  | 'subtext'
  | 'logo'
  | 'image'
  | 'clock'
  | 'date'
  | 'weather'
  | 'countdown'
  | 'menu'
  | 'ticker'
  | 'qr'
  | 'cta';

/**
 * The most scenes a generated template may carry (one per board in a "set").
 * Mirrors the `scenesIn.slice(0, MAX_GENERATED_SCENES)` cap in
 * `sanitizeTouchTemplate`.
 */
export const MAX_GENERATED_SCENES = 8;
/** Per-scene zone ceiling (richest archetype — menu-list/three-up — is ~8). */
export const MAX_ZONES_PER_SCENE = 20;
/**
 * GLOBAL zone ceiling across ALL scenes of one template. The old value was a
 * flat 20 — which silently truncated multi-scene "Build a set" output the
 * moment the running total hit 20 (a 6-board set with a couple of dense
 * menu-list / three-up scenes lost its tail boards entirely → blank scenes).
 * Sized for the worst REAL set (8 scenes × ~12 zones), still bounded against a
 * runaway/abusive AI emitting hundreds. `sanitizeTouchTemplate` slices to the
 * SAME constant so the two caps can never drift.
 */
export const MAX_GENERATED_TEMPLATE_ZONES = 96;

/** A SceneSpec that may carry an optional name (used to tag multi-scene zones). */
export type SceneSpecWithName = SceneSpec & { name?: string };

/** Round to 3 decimals to keep persisted geometry tidy + deterministic. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Archetypes whose default background is a full-bleed image (text rides a scrim). */
const IMAGE_BG_ARCHETYPES = new Set<ArchetypeId>([
  'hero-fullbleed',
  'lower-third-banner',
  'poster-promo',
]);

/**
 * Normalize a brand hex to #RGB or #RRGGBB — the only forms the engine's
 * argbFromHex accepts. A stored brand color can be 4/5/7/8 digits (the
 * /branding/adopt path persists unvalidated client palettes); passing one
 * straight to deriveThemeFromBrand THROWS (QA 2026-06-27, unhandled 500).
 * Returns undefined for unusable input so the caller defaults safely.
 */
function normalizeHex(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(h)) return undefined;
  if (h.length === 3 || h.length === 6) return '#' + h;
  if (h.length === 8 || h.length === 7) return '#' + h.slice(0, 6); // RRGGBB(AA) → RRGGBB
  if (h.length === 4 || h.length === 5) return '#' + h.slice(0, 3); // RGB(A) short → RGB
  return undefined;
}

/** Resolve the theme for a scene: 'brand' → derive from the tenant kit; else a curated id. */
function resolveTheme(theme: string, opts: ArtDirectorMapOptions): ThemeBundle {
  let bundle: ThemeBundle;
  if (theme === 'brand') {
    // A malformed stored brand hex must NEVER 500 a board generation — normalize
    // then guard, falling back to a curated theme on any derive failure.
    try {
      bundle = deriveThemeFromBrand(normalizeHex(opts.brandPrimaryHex) ?? '#2563eb', {
        mode: 'dark',
        accentHex: normalizeHex(opts.brandAccentHex),
      });
    } catch {
      bundle = getTheme('clean-corporate') ?? THEMES[0];
    }
  } else {
    bundle = getTheme(theme) ?? THEMES[0];
  }
  return applyThemeDirectives(bundle, opts);
}

/**
 * GUIDED-INTAKE: layer the operator's forced SurfaceStyle + custom-palette
 * directives onto the resolved theme. Returns a SHALLOW-CLONED bundle (never
 * mutates the shared curated THEMES) so each board can carry its own surface /
 * palette without leaking into the next generation.
 *
 * The custom-palette override only sets the BG/accent/surface hex; ink /
 * onAccent / muted stay theme-owned, and the engine's contrast guard re-derives
 * legible text against whatever surface we set (mapTextConfig's overImage /
 * accent floors) — so a custom palette can never produce illegible text.
 */
function applyThemeDirectives(theme: ThemeBundle, opts: ArtDirectorMapOptions): ThemeBundle {
  const hasSurface = opts.forcedSurfaceStyle && Object.keys(opts.forcedSurfaceStyle).length > 0;
  const hasPalette = opts.paletteOverride && Object.keys(opts.paletteOverride).length > 0;
  if (!hasSurface && !hasPalette) return theme;
  const next: ThemeBundle = { ...theme };
  if (hasSurface) {
    next.surfaceStyle = { ...(theme.surfaceStyle ?? {}), ...opts.forcedSurfaceStyle };
  }
  if (hasPalette) {
    next.palette = mergeCustomPalette(theme.palette, opts.paletteOverride!);
  }
  return next;
}

/** A hex (#rgb / #rrggbb) only — the engine's argbFromHex accepts nothing else. */
function isHex(v: string | undefined): boolean {
  return !!v && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

/**
 * Merge custom swatches (background / accent / surface) into a palette and
 * RE-DERIVE the text tokens (ink / inkInverse / muted / onAccent) so they stay
 * legible against the new surfaces. This is what makes a custom palette safe:
 * the operator never has to think about contrast — `bestTextColor` picks
 * black/white per WCAG against whatever background/accent they chose. Malformed
 * swatches (defense in depth — already hex-validated at the API boundary) fall
 * back to the theme's own token.
 */
function mergeCustomPalette(base: ThemePalette, override: Partial<ThemePalette>): ThemePalette {
  const background = isHex(override.background) ? override.background! : base.background;
  const accent = isHex(override.accent) ? override.accent! : base.accent;
  const surface = isHex(override.surface) ? override.surface! : base.surface;
  // Only re-derive the text tokens for surfaces the operator actually changed —
  // an untouched surface keeps the theme's hand-verified token.
  const bgChanged = isHex(override.background) && override.background !== base.background;
  const accentChanged = isHex(override.accent) && override.accent !== base.accent;
  return {
    background,
    surface,
    ink: bgChanged ? bestTextColor(background) : base.ink,
    inkInverse: bgChanged ? bestTextColor(surface) : base.inkInverse,
    muted: bgChanged ? bestTextColor(background) : base.muted,
    accent,
    onAccent: accentChanged ? bestTextColor(accent) : base.onAccent,
  };
}

/** Coerce an archetype id to a known one (LLM safety net — should already be valid). */
function resolveArchetypeId(id: string): ArchetypeId {
  return (ARCHETYPE_IDS as string[]).includes(id)
    ? (id as ArchetypeId)
    : 'hero-fullbleed';
}

/**
 * Resolve a text zone's hex from its color token — MIRRORS the validator's
 * `resolveTextHex` EXACTLY so the persisted color matches what the contrast
 * guard verified. (validator.ts resolveTextHex.)
 */
function resolveTextHex(z: ResolvedZone, palette: ThemePalette): string {
  if (z.styleTokens.isAccent) return palette.accent;
  switch (z.styleTokens.colorToken) {
    case 'inkInverse':
      return palette.inkInverse;
    case 'muted':
      return palette.muted;
    case 'accent':
      return palette.accent;
    case 'surface':
      return palette.ink; // text on a surface card uses ink
    case 'ink':
    default:
      return palette.ink;
  }
}

/** A short hex (#rgb/#rrggbb) → rgba(r,g,b,a). Falls back to the raw color on parse miss. */
function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Translate a ScrimSpec into a CSS background gradient. The renderer paints
 * this as a full-bleed overlay div behind the text (over the image/gradient).
 * Returns undefined for direction 'none' (no overlay needed).
 */
export function scrimToCss(s: ScrimSpec | undefined): string | undefined {
  if (!s || s.direction === 'none') return undefined;
  const rgba = hexToRgba(s.color, s.opacity);
  switch (s.direction) {
    case 'full':
      return `linear-gradient(0deg, ${rgba} 0%, ${rgba} 100%)`;
    case 'bottom':
      return `linear-gradient(0deg, ${rgba} 0%, transparent 62%)`;
    case 'top':
      return `linear-gradient(180deg, ${rgba} 0%, transparent 62%)`;
    default:
      return undefined;
  }
}

/**
 * The theme's board background — now a LAYERED, accent-tinted depth stack
 * (themeBackgroundCss in the engine) instead of the old flat surface→background
 * radial that read as a near-black slab on dark themes. Replaces every callsite
 * so EVERY non-image archetype gets the premium background. Signature stays
 * `(palette)`-shaped at the callsites via the theme wrapper below.
 */
function themeGradient(theme: ThemeBundle): string {
  return themeBackgroundCss(theme);
}

/** A bold accent→surface diagonal for the split-50 image half (no photo yet). */
function imageHalfGradient(theme: ThemeBundle): string {
  return imageHalfCss(theme);
}

/** Resolve the copy string for a text slot from the scene copy. */
function copyForSlot(
  slot: ResolvedZone['slot'],
  copy: SceneSpec['copy'],
  listIndex: number,
): string {
  switch (slot) {
    case 'kicker':
      return copy.kicker || '';
    case 'headline':
      return copy.headline || '';
    case 'body':
      return copy.body || '';
    case 'cta':
      return copy.cta || '';
    case 'stat':
      return copy.headline || ''; // stat = the big number, from headline
    case 'statLabel':
      return copy.body || '';
    case 'listItem':
      return copy.items?.[listIndex]?.label || '';
    default:
      return '';
  }
}

/** Whether an archetype renders text over imagery (so text needs a shadow). */
function isImageBoard(archetype: ArchetypeId): boolean {
  return IMAGE_BG_ARCHETYPES.has(archetype);
}

/** Map a single resolved text zone → defaultConfig. */
function mapTextConfig(
  z: ResolvedZone,
  theme: ThemeBundle,
  archetype: ArchetypeId,
  copy: SceneSpec['copy'],
  listIndex: number,
): { config: Record<string, any>; content: string } {
  const palette = theme.palette;
  const tokens = z.styleTokens;
  const role = tokens.typeRole;
  const isDisplay = role === 'display' || role === 'headline';
  const content = copyForSlot(z.slot, copy, listIndex);

  const overImage = isImageBoard(archetype) || !!tokens.scrim;
  // Text over a (dark) scrim must be a guaranteed-LEGIBLE color chosen against
  // the scrim — NOT the theme's `inkInverse`, which on a dark theme resolves to
  // near-black and renders invisible over the dark scrim. (Caught in render
  // review 2026-06-26: hero/lower-third/poster headlines were black-on-black.)
  const hex = (() => {
    if (overImage && !tokens.isAccent) {
      return bestTextColor(theme.scrim?.color ?? '#0a0a0a');
    }
    const base = resolveTextHex(z, palette);
    // Accent TEXT must clear the large-text floor against the surface it sits
    // on. A curated fill-accent (tuned for buttons) can be too dim as text on a
    // dark board (QA 2026-06-27: stat-spotlight #be185d on #18181b = 2.93:1,
    // below 4.5:1 — the focal stat rendered illegibly). When it fails, drop to a
    // guaranteed-legible color. (The CTA is a filled pill, handled in its own
    // branch with onAccent text, so this only affects accent TEXT like the stat.)
    if (tokens.isAccent) {
      const surface = overImage ? theme.scrim?.color ?? palette.background : palette.background;
      if (contrastRatio(palette.accent, surface) < LARGE_CONTRAST_FLOOR) {
        return bestTextColor(surface);
      }
    }
    return base;
  })();

  if (z.slot === 'cta') {
    // Filled accent button. The renderer centers + pads via paddingMode.
    return {
      content,
      config: {
        content,
        sizeMode: 'absolute',
        // A CTA is a PILL inside a short zone (~7-10% of canvas height). At the
        // full title px + button padding the pill is ~2x its zone and clips off
        // (QA 2026-06-27). Scale the CTA text down (but never below the 50px
        // signage floor) — the renderer's tight 0.3em button padding does the
        // rest so the pill fits its zone.
        fontSize: Math.max(50, Math.round((tokens.fontSizePx ?? 64) * 0.6)),
        fontFamily: tokens.fontFamily,
        fontWeight: tokens.fontWeight,
        color: palette.onAccent,
        bgColor: palette.accent,
        alignment: 'center',
        borderRadius: theme.radiusPx,
        paddingMode: 'button',
        lineHeight: 1.05,
      },
    };
  }

  if (z.slot === 'listItem' && archetype === 'menu-list') {
    const item = copy.items?.[listIndex];
    return {
      content: item?.label || content,
      config: {
        content: item?.label || content,
        detail: item?.detail || undefined,
        valueText: item?.value || undefined,
        sizeMode: 'absolute',
        fontSize: tokens.fontSizePx,
        fontFamily: tokens.fontFamily,
        color: hex,
        alignment: 'left',
        rowLayout: true,
        lineHeight: 1.2,
      },
    };
  }

  if (z.slot === 'listItem' && archetype === 'three-up-grid') {
    const item = copy.items?.[listIndex];
    // Card titles live in a NARROW column — the full display/title px overflows
    // and a long word breaks mid-letter ("Homecomin·g"). Scale the card title
    // down so a real label's longest word fits the column and wraps at spaces.
    const cardTitlePx = Math.max(50, Math.round((tokens.fontSizePx ?? 64) * 0.7));
    // PREMIUM card: a top-lit surface gradient + an accent hairline border + a
    // top accent bar — the antidote to the banned "flat rounded rect + shadow".
    const fill = cardFillCss(theme);
    const div = dividerCss(theme);
    return {
      content: item?.label || content,
      config: {
        content: item?.label || content,
        detail: item?.detail || undefined,
        sizeMode: 'absolute',
        fontSize: cardTitlePx,
        fontFamily: tokens.fontFamily,
        color: palette.ink,
        // The renderer paints `cardBg` (gradient) when present, else `bgColor`.
        bgColor: palette.surface,
        cardBg: fill.background,
        cardBorder: fill.border,
        // A thin accent bar across the card top — the per-card "designed" cue.
        cardAccentBar: div.background,
        alignment: 'left',
        cardLayout: true,
        borderRadius: theme.radiusPx,
        lineHeight: 1.2,
      },
    };
  }

  // Plain text slots (kicker / headline / body / cta-fallback / stat / statLabel).
  const config: Record<string, any> = {
    content,
    sizeMode: 'absolute',
    fontSize: tokens.fontSizePx,
    fontFamily: tokens.fontFamily,
    fontWeight: tokens.fontWeight,
    color: hex,
    alignment: tokens.align || 'left',
    lineHeight: isDisplay ? 1.1 : 1.35,
  };
  if (z.slot === 'kicker') {
    config.letterSpacing = '0.18em';
    config.textTransform = 'uppercase';
    // ACCENT DIVIDER — a short tapered accent rule under the eyebrow so the copy
    // is anchored, not floating (a $$$-design cue). The renderer draws it as a
    // thin element below the kicker text, aligned to the kicker's alignment.
    const div = dividerCss(theme);
    config.accentDivider = div.background;
    config.accentDividerThicknessPx = div.thicknessPx;
  }
  if (overImage) {
    config.textShadow = '0 2px 24px rgba(0,0,0,0.45)';
  }
  return { content, config };
}

/**
 * Map a single resolved IMAGE zone (background or split-50 image half).
 * NOTE: the scene's ArchetypeImagePlan is intentionally not consulted yet —
 * Wave 2a has no real imagery (image-gen lands in Wave 3); the slot rides the
 * theme gradient + scrim until then.
 */
function mapImageConfig(
  z: ResolvedZone,
  theme: ThemeBundle,
): Record<string, any> {
  if (z.slot === 'background') {
    // Wave 2a: NO real photo yet (image-gen is Wave 3) → omit assetUrl and
    // rely on the LAYERED theme background + scrim.
    return {
      fit: 'cover',
      bgGradient: themeGradient(theme),
      scrimCss: scrimToCss(z.styleTokens.scrim),
    };
  }
  // split-50 image half — a bold accent→surface diagonal placeholder (no photo).
  return {
    fit: 'cover',
    bgGradient: imageHalfGradient(theme),
    scrimCss: undefined,
  };
}

/**
 * Run the engine pipeline for ONE scene and map its ResolvedZones → MappedZones.
 * Drops a text zone whose resolved copy is empty EXCEPT the headline (which is
 * always required). Returns at most MAX_ZONES_PER_SCENE zones.
 */
function mapScene(
  scene: SceneSpec,
  opts: ArtDirectorMapOptions,
  sceneRef: string | undefined,
): { zones: MappedZone[]; theme: ThemeBundle; archetypeId: ArchetypeId; presentSlots: Set<string> } {
  const archetypeId = resolveArchetypeId(scene.archetype);
  const theme = resolveTheme(scene.theme, opts);
  // Classify the real screen w/h into a canvas class so the resolver re-stacks
  // for portrait / ribbon / square (Wave 3 "any screen size") AND picks the
  // right viewing-distance + coarse-pitch defaults — then override with the
  // actual pixel dimensions.
  const canvasClass = classifyCanvas(opts.screenWidth, opts.screenHeight);
  const canvas = resolveCanvas(canvasClass, {
    w: opts.screenWidth,
    h: opts.screenHeight,
  });

  // THE PIPELINE: resolve geometry → enforce (sizes + scrim + contrast).
  let zones = resolveArchetype(archetypeId, canvas, theme);
  const res = enforce(zones, {
    canvas,
    theme,
    passingBy: true,
    copy: scene.copy,
  });
  zones = res.zones;

  const mapped: MappedZone[] = [];
  const presentSlots = new Set<string>();
  let listIndex = 0;

  for (const z of zones) {
    let config: Record<string, any> | undefined;

    if (z.widgetType === 'IMAGE') {
      config = mapImageConfig(z, theme);
    } else {
      // text slot
      const isListItem = z.slot === 'listItem';
      const idx = isListItem ? listIndex : 0;
      const { content, config: textConfig } = mapTextConfig(
        z,
        theme,
        archetypeId,
        scene.copy,
        idx,
      );
      if (isListItem) listIndex += 1;
      // Drop empty text zones (except the always-required headline).
      const isEmpty = !content || !String(content).trim();
      if (isEmpty && z.slot !== 'headline') continue;
      config = textConfig;
    }

    const mZone: MappedZone = {
      name: z.slot,
      widgetType: z.widgetType,
      x: r3(z.x),
      y: r3(z.y),
      width: r3(z.width),
      height: r3(z.height),
      defaultConfig: config,
      sceneRef,
    };
    // FUNCTIONAL BINDING (2026-06-28): the archetype's own CTA becomes a tappable
    // open-url action when the spec carries a real ctaHref — so a generated kiosk
    // CTA actually does something. The sanitizer re-validates/SSRF-guards it.
    if (z.slot === 'cta' && opts.ctaHref) {
      mZone.touchAction = { type: 'open-url', target: opts.ctaHref };
    }
    mapped.push(mZone);
    presentSlots.add(z.slot);

    if (mapped.length >= MAX_ZONES_PER_SCENE) break;
  }

  return { zones: mapped, theme, archetypeId, presentSlots };
}

// ───────────────────────────────────────────────────────────────────────
// GUIDED-INTAKE: required-widget supplemental zones.
//
// The art-director archetypes only emit TEXT/IMAGE slots (headline / body /
// cta / image / list). When the operator REQUIRES content widgets the layout
// doesn't already carry (clock, weather, countdown, ticker, logo, qr, …), we
// append them as SUPPLEMENTAL zones placed in the board's safe-margin band so
// they sit ON TOP of the archetype content (appended last → highest sortOrder
// in the renderer). Each maps to a real WidgetRenderer widgetType that's also
// on the sanitizer's allow-list (TOUCH_GEN_ALLOWED_WIDGETS) so it survives the
// scrub.
// ───────────────────────────────────────────────────────────────────────

/** Map a required-widget key → the real widgetType the renderer + sanitizer accept. */
const REQUIRED_WIDGET_TYPE: Record<GuidedRequiredWidget, string> = {
  headline: 'TEXT',
  subtext: 'TEXT',
  logo: 'LOGO',
  image: 'IMAGE',
  clock: 'CLOCK',
  date: 'CLOCK',
  weather: 'WEATHER',
  countdown: 'COUNTDOWN',
  menu: 'LUNCH_MENU',
  ticker: 'TICKER',
  qr: 'IMAGE', // QR renders as an IMAGE zone (the renderer turns a qrText config into a real QR); IMAGE is allow-listed, QR_CODE is not.
  cta: 'TEXT',
};

/** Widget keys the archetype already covers via its text/image slots — never
 *  re-added so we don't double up the headline / body / CTA / image. The
 *  mapper's slot names map onto these. */
const SLOT_COVERS: Record<string, GuidedRequiredWidget | undefined> = {
  headline: 'headline',
  body: 'subtext',
  cta: 'cta',
  image: 'image',
  background: 'image',
  logo: 'logo',
};

/**
 * FUNCTIONAL BINDING (2026-06-28) — convert the art-director's `items` into the
 * format the LUNCH_MENU widget parses: a NEWLINE-joined string, one
 * "Label: value · detail" line per row (the renderer splits each line on the
 * first ':' into a day/label + the items). This lands the deals/prices the model
 * gathered onto the actual widget. Returns undefined for an empty/missing list
 * so the caller omits `menu` (widget keeps its placeholder).
 */
function itemsToMenuString(items: ArchetypeItem[] | undefined): string | undefined {
  if (!Array.isArray(items) || !items.length) return undefined;
  const lines: string[] = [];
  for (const it of items) {
    const label = (it?.label || '').trim();
    if (!label) continue;
    // Build the right-hand side from value (+ detail). The renderer shows the
    // text after the FIRST ':' as the row's items, so keep the label colon-free.
    const cleanLabel = label.replace(/:/g, ' ').trim();
    const rhsParts = [it?.value, it?.detail].map((p) => (p || '').trim()).filter(Boolean);
    const rhs = rhsParts.join(' · ');
    lines.push(rhs ? `${cleanLabel}: ${rhs}` : cleanLabel);
  }
  return lines.length ? lines.join('\n') : undefined;
}

/**
 * A sensible default defaultConfig per required widget, themed where it helps.
 *
 * FUNCTIONAL BINDING (2026-06-28): when the operator/tenant CONTEXT carries the
 * value a live/link widget needs (weather location, logo URL, event date, CTA
 * URL, menu items), we seed it here so the generated board WORKS instead of
 * shipping a placeholder. When the value is absent we keep the widget's prior
 * no-op default — zero regression.
 */
function requiredWidgetConfig(
  w: GuidedRequiredWidget,
  theme: ThemeBundle,
  opts: ArtDirectorMapOptions,
  copy?: SceneSpec['copy'],
): Record<string, any> {
  const palette = theme.palette;
  switch (w) {
    case 'headline':
      // Prefer the REAL headline the model wrote; the placeholder is a last resort.
      return { content: (copy?.headline || '').trim() || 'Headline', sizeMode: 'absolute', fontSize: 96, fontFamily: theme.fontPair.display, fontWeight: 800, color: palette.ink, alignment: 'left', lineHeight: 1.1 };
    case 'subtext':
      // Real supporting copy when present; the placeholder is filtered out by the
      // caller (no-placeholder rule) so it never actually ships to a board.
      return { content: (copy?.body || '').trim() || 'Add your supporting text here', sizeMode: 'absolute', fontSize: 44, fontFamily: theme.fontPair.body, color: palette.muted, alignment: 'left', lineHeight: 1.35 };
    case 'cta':
      // Real CTA copy when present, else a sensible default ("Learn more") — the
      // CTA is kept only when it has real copy OR a real ctaHref (caller rule).
      return { content: (copy?.cta || '').trim() || 'Learn more', sizeMode: 'absolute', fontSize: 50, fontFamily: theme.fontPair.body, fontWeight: 700, color: palette.onAccent, bgColor: palette.accent, alignment: 'center', borderRadius: theme.radiusPx, paddingMode: 'button', lineHeight: 1.05 };
    case 'logo':
      // Seed the tenant brand-kit logo so the widget shows a mark, not an empty
      // "Add Logo" shield. Absent → fit-only (the renderer's placeholder).
      return opts.logoUrl ? { fit: 'contain', assetUrl: opts.logoUrl } : { fit: 'contain' };
    case 'image':
      return { fit: 'cover', bgGradient: imageHalfGradient(theme) };
    case 'qr': {
      // The renderer builds a REAL scannable QR from `qrText`. Seed the real CTA
      // destination when we have one; OMIT qrText otherwise (a QR to example.com
      // is worse than no code — the renderer shows the load gradient instead).
      const cfg: Record<string, any> = { fit: 'contain', bgColor: '#ffffff' };
      if (opts.ctaHref) cfg.qrText = opts.ctaHref;
      return cfg;
    }
    case 'clock':
      return { showSeconds: false, hour12: true, color: palette.ink, fontFamily: theme.fontPair.display, fontSize: 72 };
    case 'date':
      return { mode: 'date', showDate: true, dateFormat: 'long', color: palette.ink, fontFamily: theme.fontPair.body, fontSize: 48 };
    case 'weather': {
      // Seed the venue's location so the widget shows THIS venue's weather, not
      // the placeholder city. Absent → the renderer's own default city.
      const cfg: Record<string, any> = { color: palette.ink, fontFamily: theme.fontPair.body, fontSize: 48 };
      if (opts.weatherLocation) cfg.location = opts.weatherLocation;
      return cfg;
    }
    case 'countdown': {
      // Seed the REAL event date so the countdown ticks to it. Absent → omit
      // targetDate (the renderer keeps its no-target behavior — never a fake
      // "now+30d" that we deliberately invented here).
      const cfg: Record<string, any> = { mode: 'date', label: 'Counting down to', units: ['days', 'hours', 'minutes', 'seconds'], color: palette.ink, accentColor: palette.accent, fontFamily: theme.fontPair.display, fontSize: 64 };
      if (opts.eventDate) cfg.targetDate = opts.eventDate;
      return cfg;
    }
    case 'menu': {
      // THE #1 FIX — populate the LUNCH_MENU's `menu` field from the items the
      // model wrote, in the renderer's expected format (a newline-joined string,
      // one "Label: value/detail" line per row). Without this the deals the AI
      // gathered are LOST and the widget falls back to the hardcoded cafeteria
      // sample. Absent items → omit `menu` (the widget then shows its own
      // placeholder, the prior behavior).
      const cfg: Record<string, any> = { color: palette.ink, fontFamily: theme.fontPair.body };
      const menu = itemsToMenuString(copy?.items);
      if (menu) cfg.menu = menu;
      return cfg;
    }
    case 'ticker': {
      // Use REAL messages the model wrote (body line + item labels) — never the
      // "Add your scrolling message here" placeholder. The caller drops a ticker
      // with no real copy (no-placeholder rule), so by the time we get here there
      // IS real copy; tickerMessages mirrors tickerHasRealCopy's source.
      const cfg: Record<string, any> = { color: palette.ink, bgColor: palette.surface, fontFamily: theme.fontPair.body, fontSize: 44 };
      const messages = tickerMessages(copy);
      if (messages.length) cfg.messages = messages;
      return cfg;
    }
    default:
      return {};
  }
}

/** The real lines a TICKER can scroll, drawn from copy the model actually wrote:
 *  the body line + any item labels (with their values). Empty when there's none. */
function tickerMessages(copy: SceneSpec['copy'] | undefined): string[] {
  const out: string[] = [];
  const body = (copy?.body || '').trim();
  if (body) out.push(body);
  for (const it of copy?.items ?? []) {
    const label = (it?.label || '').trim();
    if (!label) continue;
    const value = (it?.value || '').trim();
    out.push(value ? `${label} — ${value}` : label);
  }
  return out.slice(0, 12);
}

/** True when there is REAL copy for a ticker to scroll (no placeholder ship). */
function tickerHasRealCopy(copy: SceneSpec['copy'] | undefined): boolean {
  return tickerMessages(copy).length > 0;
}

/**
 * Build supplemental zones for the operator's REQUIRED widgets that the
 * archetype's own slots don't already cover. Lays them along the bottom safe-
 * margin band (and a top band for clock/date/weather chrome) so they don't
 * collide with the focal headline. Caller appends these AFTER the scene zones.
 */
function buildRequiredWidgetZones(
  required: GuidedRequiredWidget[],
  presentSlots: Set<string>,
  theme: ThemeBundle,
  sceneRef: string | undefined,
  opts: ArtDirectorMapOptions,
  copy?: SceneSpec['copy'],
): MappedZone[] {
  // De-dupe + drop widgets the archetype already provides (covered by a slot).
  const covered = new Set<GuidedRequiredWidget>();
  for (const slot of presentSlots) {
    const w = SLOT_COVERS[slot];
    if (w) covered.add(w);
  }
  const wanted: GuidedRequiredWidget[] = [];
  const seen = new Set<string>();
  for (const w of required) {
    if (covered.has(w) || seen.has(w)) continue;
    seen.add(w);
    // NO-PLACEHOLDER RULE (2026-06-28): never ship a TEXT-bearing supplemental
    // zone whose only content is the built-in placeholder. A 'subtext' with no
    // real body copy, a 'ticker' with no real messages, or a 'cta' with neither
    // real copy NOR a real ctaHref is a fill-in-the-blank dud — DROP it instead.
    if (w === 'subtext' && !(copy?.body || '').trim()) continue;
    if (w === 'ticker' && !tickerHasRealCopy(copy)) continue;
    if (w === 'cta' && !(copy?.cta || '').trim() && !opts.ctaHref) continue;
    wanted.push(w);
  }
  if (!wanted.length) return [];

  // Two bands: chrome (clock/date/weather) along the TOP; everything else along
  // the BOTTOM. Each band lays its members left→right in equal columns within
  // the safe margins (5%..95%). Heights are small so they never crowd the focus.
  const TOP = new Set<GuidedRequiredWidget>(['clock', 'date', 'weather']);
  const topRow = wanted.filter((w) => TOP.has(w));
  const bottomRow = wanted.filter((w) => !TOP.has(w));
  const zones: MappedZone[] = [];

  const layRow = (members: GuidedRequiredWidget[], yTop: number, h: number) => {
    if (!members.length) return;
    const left = 5;
    const usable = 90; // 5%..95%
    const gap = 2;
    const colW = (usable - gap * (members.length - 1)) / members.length;
    members.forEach((w, i) => {
      const x = left + i * (colW + gap);
      const zone: MappedZone = {
        name: w,
        widgetType: REQUIRED_WIDGET_TYPE[w],
        x: r3(x),
        y: r3(yTop),
        width: r3(colW),
        height: r3(h),
        defaultConfig: requiredWidgetConfig(w, theme, opts, copy),
        sceneRef,
      };
      // FUNCTIONAL BINDING: a CTA with a real destination becomes a tappable
      // open-url action (the sanitizer re-validates it). Without a ctaHref it
      // stays a plain text pill (kiosks add the tap by hand in the builder).
      if (w === 'cta' && opts.ctaHref) {
        zone.touchAction = { type: 'open-url', target: opts.ctaHref };
      }
      zones.push(zone);
    });
  };

  layRow(topRow, 5, 10);
  layRow(bottomRow, 82, 12);
  return zones;
}

/** Derive a board name (≤60 chars) from the spec copy. */
function deriveName(spec: ArtDirectorSpec): string {
  const headline = (spec.copy?.headline || '').trim();
  if (headline) return headline.slice(0, 60);
  return 'AI signage board';
}

/**
 * THE MAPPER. Turn an ArtDirectorSpec into a persistable Template — zones in
 * the `sanitizeTouchTemplate` shape + a `background` descriptor for the
 * Template's bg fields.
 *
 * Single-board: uses the top-level SceneSpec.
 * Multi-scene kiosk: one set of zones per scene, each zone tagged with that
 * scene's name on `sceneRef`; returns `scenes:[{name}]` for the controller to
 * create + resolve names→ids. (Wave 2a may reuse the same archetype per scene.)
 */
export function artDirectorSpecToTemplate(
  spec: ArtDirectorSpec,
  opts: ArtDirectorMapOptions,
): MappedTemplate {
  const zones: MappedZone[] = [];
  let primaryTheme: ThemeBundle | undefined;
  const scenesOut: Array<{ name: string }> = [];

  if (spec.scenes && spec.scenes.length) {
    const used = new Set<string>();
    for (let i = 0; i < spec.scenes.length && i < MAX_GENERATED_SCENES; i++) {
      const scene = spec.scenes[i] as SceneSpecWithName;
      // Unique scene name so name→id resolution is unambiguous.
      let name = (scene.name || '').trim();
      if (!name)
        name = (scene.copy?.headline || `Scene ${i + 1}`).trim().slice(0, 60);
      let candidate = name;
      let n = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${name} ${n++}`.slice(0, 60);
      }
      used.add(candidate.toLowerCase());
      scenesOut.push({ name: candidate });

      const { zones: sceneZones, theme, presentSlots } = mapScene(scene, opts, candidate);
      if (i === 0) primaryTheme = theme;
      for (const z of sceneZones) {
        if (zones.length >= MAX_GENERATED_TEMPLATE_ZONES) break;
        zones.push(z);
      }
      // GUIDED-INTAKE: each scene of a set is its own designed screen, so each
      // gets the operator's required widgets (de-duped against its own slots).
      if (opts.requiredWidgets && opts.requiredWidgets.length) {
        const extra = buildRequiredWidgetZones(opts.requiredWidgets, presentSlots, theme, candidate, opts, scene.copy);
        for (const z of extra) {
          if (zones.length >= MAX_GENERATED_TEMPLATE_ZONES) break;
          zones.push(z);
        }
      }
    }
  } else {
    // Single board — the top-level SceneSpec.
    const { zones: sceneZones, theme, presentSlots } = mapScene(spec, opts, undefined);
    primaryTheme = theme;
    for (const z of sceneZones) {
      if (zones.length >= MAX_GENERATED_TEMPLATE_ZONES) break;
      zones.push(z);
    }
    // GUIDED-INTAKE: append the operator's required widgets the layout lacks.
    if (opts.requiredWidgets && opts.requiredWidgets.length) {
      const extra = buildRequiredWidgetZones(opts.requiredWidgets, presentSlots, theme, undefined, opts, spec.copy);
      for (const z of extra) {
        if (zones.length >= MAX_GENERATED_TEMPLATE_ZONES) break;
        zones.push(z);
      }
    }
  }

  const theme = primaryTheme ?? THEMES[0];
  const palette = theme.palette;

  return {
    name: deriveName(spec),
    zones,
    scenes: scenesOut.length ? scenesOut : undefined,
    // Solid base + the LAYERED theme background (accent-tinted depth) so
    // surface/gradient archetypes are never a flat slab (image archetypes lay a
    // full-bleed bg zone on top).
    background: { bgColor: palette.background, bgGradient: themeGradient(theme) },
  };
}
