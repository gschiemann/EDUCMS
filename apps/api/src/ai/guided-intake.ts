/**
 * guided-intake.ts — the GUIDED-INTAKE directive layer for the AI board engine.
 *
 * The guided-intake UI lets an operator pick a PURPOSE, a friendly THEME label, a
 * PALETTE source, a BACKGROUND treatment, and the content WIDGETS they want — and
 * have the AI board engine HONOR every choice as a HARD directive (not a soft
 * hint buried in prose). This module is the single source of truth for:
 *   1. the friendly → real-id mappings (purpose → archetype, theme label → theme id),
 *   2. parsing/clamping the optional intake fields at the service boundary,
 *   3. applying the choices to the ArtDirectorSpec (force archetype + theme),
 *   4. deriving the mapper directives (forced SurfaceStyle + palette override +
 *      required widget zones) the engine consumes.
 *
 * ARCHITECTURE FIT: the LLM stays the ART DIRECTOR — but when the operator has
 * already DECIDED the layout family / mood / palette / surface, we OVERRIDE the
 * model's pick with the operator's intent BEFORE the engine runs (the engine
 * still owns geometry / type scale / contrast — we never emit px/hex here that
 * the engine doesn't validate). EVERY field is OPTIONAL: omitted/'auto' → the
 * existing derive-from-prompt + vertical-affinity behavior is UNCHANGED, so
 * nothing regresses.
 *
 * TAURUS NOTE (CLAUDE.md rule #10): this module emits NO CSS — it only sets
 * SurfaceStyle dials (consumed by surface-css.ts, which already emits only
 * gradient/solid strings) and palette hex. No `inset`, no `gap`.
 */

import {
  ARCHETYPE_IDS,
  getTheme,
  THEMES,
  type ArchetypeId,
  type ArtDirectorSpec,
  type SceneSpec,
  type SurfaceStyle,
  type ThemePalette,
} from '@cms/signage-design';

// ───────────────────────────────────────────────────────────────────────
// 1. THE GUIDED-INTAKE CONTRACT — every field optional; 'auto'/omitted = derive.
// ───────────────────────────────────────────────────────────────────────

export type GuidedPurpose =
  | 'welcome'
  | 'menu'
  | 'promo'
  | 'event'
  | 'announcement'
  | 'feature'
  | 'photo-hero'
  | 'auto';

export type GuidedBackground = 'solid' | 'gradient' | 'textured' | 'photo' | 'auto';

/** The content elements the operator can REQUIRE as zones on the board. */
export type GuidedWidget =
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

/** A palette directive: brand tokens, the theme palette, or custom swatches. */
export type GuidedPalette =
  | 'brand'
  | 'auto'
  | { colors: string[] };

/** The parsed, validated guided-intake the engine consumes. All optional. */
export interface GuidedIntake {
  purpose?: GuidedPurpose;
  /** A friendly theme label OR a real ThemeBundle id OR the literal 'brand'. */
  theme?: string;
  palette?: GuidedPalette;
  background?: GuidedBackground;
  widgets?: GuidedWidget[];
}

// ───────────────────────────────────────────────────────────────────────
// 2. FRIENDLY → REAL-ID MAPPINGS (the contract the FE lane must match).
// ───────────────────────────────────────────────────────────────────────

/**
 * purpose → the closest REAL archetype id (archetypes.ts).
 *   welcome      → hero-fullbleed   (full-bleed welcome hero)
 *   menu         → menu-list        (priced rows)
 *   promo        → poster-promo     (full-bleed offer + CTA)
 *   event        → title-cta        (eyebrow + headline + body + CTA; pairs with a COUNTDOWN widget)
 *   announcement → title-cta        (centered announcement)
 *   feature      → split-50         (image half / content half)
 *   photo-hero   → hero-fullbleed   (image-bg hero)
 *   auto         → (no override; derive)
 */
const PURPOSE_TO_ARCHETYPE: Record<Exclude<GuidedPurpose, 'auto'>, ArchetypeId> = {
  welcome: 'hero-fullbleed',
  menu: 'menu-list',
  promo: 'poster-promo',
  event: 'title-cta',
  announcement: 'title-cta',
  feature: 'split-50',
  'photo-hero': 'hero-fullbleed',
};

/**
 * Friendly theme label → real ThemeBundle id (themes.ts). Lower-cased keys; the
 * parser lower-cases the incoming label so "Modern"/"modern" both resolve.
 *   Modern  → clean-corporate   Bold    → neon-sports     Elegant → minimal-luxury
 *   Warm    → warm-school       Neon    → midnight-tech   Minimal → sky-civic
 *   Playful → forest-campus
 * Any REAL theme id (e.g. 'qsr-appetite') or the literal 'brand' passes through
 * unchanged.
 */
const FRIENDLY_THEME_TO_ID: Record<string, string> = {
  modern: 'clean-corporate',
  bold: 'neon-sports',
  elegant: 'minimal-luxury',
  warm: 'warm-school',
  neon: 'midnight-tech',
  minimal: 'sky-civic',
  playful: 'forest-campus',
};

const THEME_IDS = new Set(THEMES.map((t) => t.id));

/**
 * background → forced SurfaceStyle dials (surface-css.ts consumes these).
 *   solid    → flat surface, no glow      (a clean single-tone board)
 *   gradient → the premium spotlight ramp + glow
 *   textured → the directional duotone ramp + strong glow (depth/energy)
 *   photo    → handled by the IMAGE path (AI image-gen, gated); falls back to a
 *              rich gradient when image-gen is unavailable (never silent Tier-1 spend)
 *   auto     → (no override; resolveSurfaceStyle picks per-theme)
 */
const BACKGROUND_TO_SURFACE: Record<Exclude<GuidedBackground, 'auto' | 'photo'>, Partial<SurfaceStyle>> = {
  solid: { background: 'wash', glow: 0, card: 'flat' },
  gradient: { background: 'spotlight', glow: 0.5 },
  textured: { background: 'duotone', glow: 0.85 },
};

const GUIDED_PURPOSES = new Set<string>([
  'welcome', 'menu', 'promo', 'event', 'announcement', 'feature', 'photo-hero', 'auto',
]);
const GUIDED_BACKGROUNDS = new Set<string>(['solid', 'gradient', 'textured', 'photo', 'auto']);
const GUIDED_WIDGETS = new Set<string>([
  'headline', 'subtext', 'logo', 'image', 'clock', 'date',
  'weather', 'countdown', 'menu', 'ticker', 'qr', 'cta',
]);

// ───────────────────────────────────────────────────────────────────────
// 3. PARSE / CLAMP — the API boundary is the engine's input guard.
// ───────────────────────────────────────────────────────────────────────

/** #rgb / #rrggbb only — the engine's argbFromHex accepts nothing else. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_CUSTOM_COLORS = 6;

function parsePalette(raw: any): GuidedPalette | undefined {
  if (raw === 'brand') return 'brand';
  if (raw === 'auto') return 'auto';
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).colors)) {
    const colors = ((raw as any).colors as any[])
      .filter((c) => typeof c === 'string')
      .map((c) => c.trim())
      .filter((c) => HEX_RE.test(c))
      .slice(0, MAX_CUSTOM_COLORS);
    return colors.length ? { colors } : undefined; // empty/garbage → ignore (derive)
  }
  return undefined; // unknown → ignore
}

/**
 * Parse the OPTIONAL guided-intake fields off a raw request body. Ignores any
 * unknown values (enum membership only); a custom palette is an array of ≤6 hex
 * strings; widgets are de-duplicated known keys. Returns `undefined` when NO
 * usable directive is present — so the caller treats it as "no intake" and the
 * existing derive behavior is untouched.
 */
export function parseGuidedIntake(raw: any): GuidedIntake | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: GuidedIntake = {};

  if (typeof raw.purpose === 'string' && GUIDED_PURPOSES.has(raw.purpose) && raw.purpose !== 'auto') {
    out.purpose = raw.purpose as GuidedPurpose;
  }

  if (typeof raw.theme === 'string') {
    const id = resolveThemeId(raw.theme);
    if (id) out.theme = id;
  }

  const palette = parsePalette(raw.palette);
  if (palette && palette !== 'auto') out.palette = palette;

  if (typeof raw.background === 'string' && GUIDED_BACKGROUNDS.has(raw.background) && raw.background !== 'auto') {
    out.background = raw.background as GuidedBackground;
  }

  if (Array.isArray(raw.widgets)) {
    const seen = new Set<string>();
    const widgets: GuidedWidget[] = [];
    for (const w of raw.widgets) {
      if (typeof w !== 'string') continue;
      const key = w.trim().toLowerCase();
      if (GUIDED_WIDGETS.has(key) && !seen.has(key)) {
        seen.add(key);
        widgets.push(key as GuidedWidget);
      }
      if (widgets.length >= GUIDED_WIDGETS.size) break;
    }
    if (widgets.length) out.widgets = widgets;
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * Resolve a theme directive (friendly label OR real id OR 'brand') to a real
 * ThemeBundle id (or 'brand'). Returns undefined for an unrecognized value so
 * the caller derives instead of forcing a bogus theme.
 */
export function resolveThemeId(theme: string | undefined): string | undefined {
  if (!theme) return undefined;
  const t = theme.trim();
  if (!t) return undefined;
  if (t === 'brand') return 'brand';
  if (THEME_IDS.has(t)) return t; // already a real id
  const friendly = FRIENDLY_THEME_TO_ID[t.toLowerCase()];
  if (friendly) return friendly;
  return undefined;
}

/** purpose → archetype id (or undefined for 'auto'/omitted). */
export function archetypeForPurpose(purpose: GuidedPurpose | undefined): ArchetypeId | undefined {
  if (!purpose || purpose === 'auto') return undefined;
  return PURPOSE_TO_ARCHETYPE[purpose];
}

// ───────────────────────────────────────────────────────────────────────
// 4. APPLY TO SPEC — force the archetype + theme as a HARD directive.
// ───────────────────────────────────────────────────────────────────────

/**
 * Apply the guided-intake's archetype + theme directives to the ArtDirectorSpec
 * (and EVERY scene of a multi-scene set) BEFORE the engine runs — so the
 * operator's pick wins over the model's. Mutates a COPY's scene refs but is safe
 * to call on the live spec (it only sets fields). Returns the same spec.
 *
 *   - purpose set → spec.archetype is forced (overriding the model).
 *   - theme set   → spec.theme is forced (a real id or 'brand').
 *   - photo background → the spec's image plan is upgraded to 'generate' on an
 *     image-bg archetype (the actual gen is still gated downstream; this only
 *     signals intent so generateSignageBoardInner's withImage path can fire).
 * Omitted fields leave the spec untouched.
 */
export function applyGuidedIntakeToSpec(
  spec: ArtDirectorSpec,
  intake: GuidedIntake | undefined,
): ArtDirectorSpec {
  if (!intake) return spec;
  const archetype = archetypeForPurpose(intake.purpose);
  const theme = intake.theme; // already a real id or 'brand'

  const applyToScene = (scene: SceneSpec) => {
    if (archetype) scene.archetype = archetype;
    if (theme) scene.theme = theme;
    if (intake.background === 'photo' && isImageBgArchetype(scene.archetype)) {
      // Upgrade the image plan to 'generate' so the (gated) image path can fire.
      // We only ASK for a generated photo; the prompt is the model's image prompt
      // if it planned one, else a neutral fallback woven from the headline.
      const existing = scene.image;
      if (!existing || existing.mode === 'none') {
        scene.image = {
          mode: 'generate',
          prompt: (scene.copy?.headline || 'premium signage background').slice(0, 200),
        };
      } else if (existing.mode === 'stock' || existing.mode === 'brand') {
        scene.image = { mode: 'generate', prompt: existing.prompt || existing.query || (scene.copy?.headline || 'premium signage background').slice(0, 200) };
      }
    }
  };

  applyToScene(spec);
  if (spec.scenes && spec.scenes.length) {
    for (const sc of spec.scenes) applyToScene(sc);
  }
  return spec;
}

/** The image-bg archetypes (mirror of the mapper/service set; kept local + cheap). */
const IMAGE_BG_ARCHETYPES = new Set<string>(['hero-fullbleed', 'lower-third-banner', 'poster-promo']);
export function isImageBgArchetype(archetype: string | undefined): boolean {
  return !!archetype && IMAGE_BG_ARCHETYPES.has(archetype);
}

// ───────────────────────────────────────────────────────────────────────
// 5. MAPPER DIRECTIVES — forced SurfaceStyle + palette override + widgets.
// ───────────────────────────────────────────────────────────────────────

/**
 * Translate the guided-intake into the directives the art-director MAPPER
 * consumes (it forces the theme's SurfaceStyle, overrides the palette, and emits
 * the required widget zones). Returns `undefined` when nothing applies.
 *
 * `paletteOverride` (custom swatches) maps the first 1-3 hex into the palette's
 * background / accent / surface — leaving ink/onAccent/muted to the engine's
 * contrast guard (it re-derives legible text against whatever surface we set, so
 * a custom palette can NEVER produce illegible text — same guarantee the curated
 * themes carry).
 */
export interface GuidedMapperDirectives {
  /** Forced SurfaceStyle dials (background construction / glow / card). */
  forcedSurfaceStyle?: Partial<SurfaceStyle>;
  /** Custom palette swatches → partial palette override (bg / accent / surface). */
  paletteOverride?: Partial<ThemePalette>;
  /** Content widgets the engine MUST emit as zones. */
  requiredWidgets?: GuidedWidget[];
  /** True when 'photo' was requested (the service routes image-gen + signals fallback). */
  photoRequested?: boolean;
}

export function guidedMapperDirectives(
  intake: GuidedIntake | undefined,
): GuidedMapperDirectives | undefined {
  if (!intake) return undefined;
  const out: GuidedMapperDirectives = {};

  if (intake.background && intake.background !== 'photo') {
    out.forcedSurfaceStyle = BACKGROUND_TO_SURFACE[intake.background];
  }
  if (intake.background === 'photo') {
    out.photoRequested = true;
    // The board still needs a rich SURFACE under the (possibly-absent) photo so
    // the gradient fallback reads premium, not flat. Force the spotlight ramp.
    out.forcedSurfaceStyle = BACKGROUND_TO_SURFACE.gradient;
  }

  if (intake.palette && intake.palette !== 'brand' && intake.palette !== 'auto') {
    const colors = intake.palette.colors;
    if (colors.length) {
      const override: Partial<ThemePalette> = {};
      // 1st swatch → board background, 2nd → accent, 3rd → surface. The engine's
      // contrast guard re-derives ink/onAccent/muted against these (legibility
      // is never the operator's problem).
      if (colors[0]) override.background = colors[0];
      if (colors[1]) override.accent = colors[1];
      if (colors[2]) override.surface = colors[2];
      out.paletteOverride = override;
    }
  }

  if (intake.widgets && intake.widgets.length) {
    out.requiredWidgets = intake.widgets;
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * Whether the intake's palette directive is 'brand' — the service folds this to
 * spec.theme='brand' (derive the theme from the tenant BrandKit) so the brand
 * tokens flow through the SAME path theme:'brand' already uses.
 */
export function paletteIsBrand(intake: GuidedIntake | undefined): boolean {
  return !!intake && intake.palette === 'brand';
}
