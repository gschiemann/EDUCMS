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
  THEMES,
  deriveThemeFromBrand,
  getTheme,
  resolveArchetype,
  resolveCanvas,
  enforce,
  type ArchetypeId,
  type ArtDirectorSpec,
  type ResolvedZone,
  type SceneSpec,
  type ScrimSpec,
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
}

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
]);

/** Resolve the theme for a scene: 'brand' → derive from the tenant kit; else a curated id. */
function resolveTheme(theme: string, opts: ArtDirectorMapOptions): ThemeBundle {
  if (theme === 'brand') {
    return deriveThemeFromBrand(opts.brandPrimaryHex ?? '#2563eb', {
      mode: 'dark',
      accentHex: opts.brandAccentHex,
    });
  }
  return getTheme(theme) ?? THEMES[0];
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

/** The theme's board gradient — surface → background radial, used on the bg slot. */
function themeGradient(palette: ThemePalette): string {
  return `radial-gradient(130% 120% at 50% 0%, ${palette.surface} 0%, ${palette.background} 70%)`;
}

/** A tinted gradient for the split-50 image half (no photo yet — Wave 3). */
function imageHalfGradient(palette: ThemePalette): string {
  return `linear-gradient(135deg, ${palette.accent} 0%, ${palette.surface} 100%)`;
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
  const hex = resolveTextHex(z, palette);

  const overImage = isImageBoard(archetype) || !!tokens.scrim;

  if (z.slot === 'cta') {
    // Filled accent button. The renderer centers + pads via paddingMode.
    return {
      content,
      config: {
        content,
        sizeMode: 'absolute',
        fontSize: tokens.fontSizePx,
        fontFamily: tokens.fontFamily,
        fontWeight: tokens.fontWeight,
        color: palette.onAccent,
        bgColor: palette.accent,
        alignment: 'center',
        borderRadius: theme.radiusPx,
        paddingMode: 'button',
        lineHeight: 1.1,
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
    return {
      content: item?.label || content,
      config: {
        content: item?.label || content,
        detail: item?.detail || undefined,
        sizeMode: 'absolute',
        fontSize: tokens.fontSizePx,
        fontFamily: tokens.fontFamily,
        color: palette.ink,
        bgColor: palette.surface,
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
  const palette = theme.palette;
  if (z.slot === 'background') {
    // Wave 2a: NO real photo yet (image-gen is Wave 3) → omit assetUrl and
    // rely on the theme gradient + scrim.
    return {
      fit: 'cover',
      bgGradient: themeGradient(palette),
      scrimCss: scrimToCss(z.styleTokens.scrim),
    };
  }
  // split-50 image half — a tinted gradient placeholder (no photo yet).
  return {
    fit: 'cover',
    bgGradient: imageHalfGradient(palette),
    scrimCss: undefined,
  };
}

/**
 * Run the engine pipeline for ONE scene and map its ResolvedZones → MappedZones.
 * Drops a text zone whose resolved copy is empty EXCEPT the headline (which is
 * always required). Returns at most 20 zones.
 */
function mapScene(
  scene: SceneSpec,
  opts: ArtDirectorMapOptions,
  sceneRef: string | undefined,
): { zones: MappedZone[]; theme: ThemeBundle; archetypeId: ArchetypeId } {
  const archetypeId = resolveArchetypeId(scene.archetype);
  const theme = resolveTheme(scene.theme, opts);
  const canvas = resolveCanvas('landscape-16-9', {
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

    mapped.push({
      name: z.slot,
      widgetType: z.widgetType,
      x: r3(z.x),
      y: r3(z.y),
      width: r3(z.width),
      height: r3(z.height),
      defaultConfig: config,
      sceneRef,
    });

    if (mapped.length >= 20) break;
  }

  return { zones: mapped, theme, archetypeId };
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
    for (let i = 0; i < spec.scenes.length && i < 8; i++) {
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

      const { zones: sceneZones, theme } = mapScene(scene, opts, candidate);
      if (i === 0) primaryTheme = theme;
      for (const z of sceneZones) {
        if (zones.length >= 20) break;
        zones.push(z);
      }
    }
  } else {
    // Single board — the top-level SceneSpec.
    const { zones: sceneZones, theme } = mapScene(spec, opts, undefined);
    primaryTheme = theme;
    for (const z of sceneZones) {
      if (zones.length >= 20) break;
      zones.push(z);
    }
  }

  const palette = (primaryTheme ?? THEMES[0]).palette;

  return {
    name: deriveName(spec),
    zones,
    scenes: scenesOut.length ? scenesOut : undefined,
    // The bg ZONE carries the gradient; the template bg is just the solid base.
    background: { bgColor: palette.background },
  };
}
