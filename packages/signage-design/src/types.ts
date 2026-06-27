/**
 * @cms/signage-design — TYPES
 *
 * The art-director contract + the engine vocabulary.
 *
 * THE CORE THESIS (see docs/research/2026-06-26-ai-flagship-rebuild):
 *   The LLM is an ART DIRECTOR, never a typesetter. It emits ONLY semantic
 *   intent — an archetype name, a theme id, copy strings, and an image plan.
 *   It NEVER emits coordinates, hex colors, or font sizes. Geometry, type
 *   scale, color, and contrast are DERIVED by the engine (archetypes.ts,
 *   type-scale.ts, themes.ts, contrast.ts) and made legal by validator.ts.
 *
 * Precedence when the layers disagree (defined by the plan critique §2.5):
 *   archetype  >  theme  >  validator
 *   - The archetype owns geometry (rects, slots, stacking). Nothing overrides it.
 *   - The theme owns palette + type pairing + scale + scrim defaults.
 *   - The validator NEVER invents a third look. It only makes the chosen
 *     archetype+theme combination LEGAL (resize to floors, flip a text token,
 *     drop a scrim) — the smallest correction that satisfies the rulebook.
 */

// ---------------------------------------------------------------------------
// 1. THE ART-DIRECTOR CONTRACT — the ONLY thing the LLM is allowed to emit.
//    No x/y/width/height. No hex. No font sizes. Ever.
// ---------------------------------------------------------------------------

/**
 * The curated layout enum. The LLM picks ONE of these by name; the resolver
 * (archetypes.ts) turns it into grid-locked geometry. Adding a value here is a
 * deliberate, designer-reviewed act — never a runtime/LLM invention.
 */
export type ArchetypeId =
  | 'hero-fullbleed' //  full-bleed image + scrim + one giant headline + kicker
  | 'split-50' //         image half / content half
  | 'lower-third-banner' // image fills, content in a bottom band
  | 'stat-spotlight' //   one huge number/stat + label
  | 'three-up-grid' //    three equal cards ("what's on today")
  | 'menu-list' //        priced rows, grid-aligned value column
  | 'poster-promo' //     full-bleed photo + scrim, centered punchy offer + CTA
  | 'quote-spotlight' //  large centered quote + attribution (testimonial/verse)
  | 'title-cta'; //       centered eyebrow + headline + body + one CTA (announcement)

/**
 * Named copy slots. Every archetype declares which subset it uses; the LLM
 * fills the ones the chosen archetype needs.
 */
export interface ArchetypeCopy {
  /** Small eyebrow line above the headline (e.g. "TODAY ONLY"). Optional. */
  kicker?: string;
  /** The one dominant message. Required on every archetype. */
  headline: string;
  /** Supporting line(s). Optional — subject to the 3x5 density cap. */
  body?: string;
  /** The single call-to-action / accent element. Optional. */
  cta?: string;
  /**
   * Repeatable rows for list/grid archetypes (menu-list, three-up-grid).
   * Each item carries a label and an optional value (price/time/stat).
   */
  items?: ArchetypeItem[];
}

export interface ArchetypeItem {
  label: string;
  /** Right-aligned value column: price, time, stat, etc. Optional. */
  value?: string;
  /** A short secondary description under the label. Optional. */
  detail?: string;
}

/**
 * The imagery plan. The engine wires this to the template background (when
 * `mode` is generate/brand/stock) paired with a contrast-guaranteed scrim.
 */
export interface ArchetypeImagePlan {
  mode: 'generate' | 'brand' | 'stock' | 'none';
  /** For mode:'generate' — the text-to-image prompt. */
  prompt?: string;
  /** For mode:'stock' — the search query. */
  query?: string;
}

/**
 * One designed screen. For single-screen boards this IS the spec. For
 * multi-scene kiosks each scene is its own full spec (own archetype + copy +
 * image) so every destination is a designed screen, never an empty shell.
 */
export interface SceneSpec {
  archetype: ArchetypeId;
  /** A ThemeBundle id, or the literal 'brand' to derive from the tenant kit. */
  theme: string;
  copy: ArchetypeCopy;
  image: ArchetypeImagePlan;
  /**
   * Which single slot gets the reserved accent color. Exactly one element may
   * carry the accent (R6 rule 12). Defaults to 'cta' when present.
   */
  accentSlot?: AccentSlot;
}

export type AccentSlot = 'kicker' | 'headline' | 'cta' | 'stat' | 'none';

/**
 * THE top-level art-director output. A single-screen board uses the top-level
 * fields; a multi-scene kiosk additionally supplies `scenes`.
 */
export interface ArtDirectorSpec extends SceneSpec {
  /** Multi-scene kiosk attract loop — each scene is a full SceneSpec. */
  scenes?: SceneSpec[];
}

// ---------------------------------------------------------------------------
// 2. CANVAS CLASSES — the physical surface the engine resolves geometry for.
// ---------------------------------------------------------------------------

export type CanvasClassId =
  | 'landscape-16-9' //  1920x1080 / 3840x2160 lobby + general boards
  | 'portrait-9-16' //   hallway pillars, menu, wayfinding
  | 'ultrawide-ribbon' // LED ribbon strips / 960x1080 posters daisy-chained
  | 'square'; //         square-ish LED tiles

export interface CanvasClass {
  id: CanvasClassId;
  /** Pixel width of the authored canvas. */
  w: number;
  /** Pixel height of the authored canvas. */
  h: number;
  /**
   * Default viewing distance in feet. Drives the type scale (type-scale.ts).
   * A passing-by lobby board defaults to 15ft; a hallway pillar a bit closer;
   * a ribbon wraps the venue so it is read from far away.
   */
  viewingDistanceFt: number;
  /** Coarse-pitch LED needs heavier strokes + larger min type (R6 rule 26). */
  coarsePitchLED: boolean;
}

/** The canonical canvas catalog. */
export const CANVAS_CLASSES: Record<CanvasClassId, CanvasClass> = {
  'landscape-16-9': {
    id: 'landscape-16-9',
    w: 1920,
    h: 1080,
    viewingDistanceFt: 15,
    coarsePitchLED: false,
  },
  'portrait-9-16': {
    id: 'portrait-9-16',
    w: 1080,
    h: 1920,
    viewingDistanceFt: 10,
    coarsePitchLED: false,
  },
  'ultrawide-ribbon': {
    id: 'ultrawide-ribbon',
    w: 1920,
    h: 360,
    viewingDistanceFt: 30,
    coarsePitchLED: true,
  },
  square: {
    id: 'square',
    w: 1080,
    h: 1080,
    viewingDistanceFt: 12,
    coarsePitchLED: false,
  },
};

/** Resolve a canvas class, applying any per-board overrides (real panel size). */
export function resolveCanvas(
  id: CanvasClassId,
  overrides?: Partial<Pick<CanvasClass, 'w' | 'h' | 'viewingDistanceFt' | 'coarsePitchLED'>>,
): CanvasClass {
  return { ...CANVAS_CLASSES[id], ...overrides };
}

/**
 * Classify an arbitrary pixel resolution into the nearest canvas class.
 * Used when a real screen reports its own w/h (LED posters, ribbons).
 */
export function classifyCanvas(w: number, h: number): CanvasClassId {
  if (w <= 0 || h <= 0) return 'landscape-16-9';
  const ratio = w / h;
  if (ratio >= 2.4) return 'ultrawide-ribbon';
  if (ratio <= 0.75) return 'portrait-9-16';
  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  return 'landscape-16-9';
}

// ---------------------------------------------------------------------------
// 3. ARCHETYPE definition (the engine side of the contract).
// ---------------------------------------------------------------------------

/** A named slot the archetype exposes for copy/imagery. */
export type SlotKind =
  | 'background'
  | 'kicker'
  | 'headline'
  | 'body'
  | 'cta'
  | 'stat'
  | 'statLabel'
  | 'logo'
  | 'image'
  | 'listItem';

/**
 * How a slot's text is sized — semantic roles that map onto the modular type
 * scale (type-scale.ts). The archetype declares roles; the engine derives px.
 */
export type TypeRole = 'display' | 'headline' | 'title' | 'body' | 'caption' | 'kicker';

export interface ArchetypeSlotSpec {
  slot: SlotKind;
  /** The widget that renders this slot (TEXT, IMAGE, etc.). */
  widgetType: string;
  /** The type role used to size text slots (ignored for image/logo). */
  typeRole?: TypeRole;
  /** Whether this slot is required for the archetype to read correctly. */
  required?: boolean;
}

export interface Archetype {
  id: ArchetypeId;
  /** Human label for galleries. */
  label: string;
  /** One-line description for the LLM's archetype menu. */
  description: string;
  /** Canvas classes this archetype supports (it re-stacks per orientation). */
  supports: CanvasClassId[];
  /** The slots this archetype exposes, in z-order (back to front). */
  slots: ArchetypeSlotSpec[];
  /** Whether a full-bleed background image is the default for this archetype. */
  backgroundMode: 'image' | 'surface' | 'gradient';
  /**
   * Resolve named slots into pixel-perfect, grid-locked, Taurus-safe rects for
   * a given canvas + theme. THIS is the function the server calls after the LLM
   * picks the archetype. The LLM never sees the output.
   */
  resolve: (canvas: CanvasClass, theme: ThemeBundle) => ResolvedZone[];
}

// ---------------------------------------------------------------------------
// 4. RESOLVED GEOMETRY — what the resolver emits; the persist/render input.
// ---------------------------------------------------------------------------

/**
 * A laid-out zone. Coordinates are PERCENTAGES (0-100) of canvas w/h — the same
 * shape TemplateZone uses in Prisma, so the resolver output drops straight into
 * the existing persist + render path.
 *
 * TAURUS-SAFE INVARIANT (CLAUDE.md rule #10): consumers translate these to
 * longhand top/right/bottom/left — never the `inset` shorthand, never `gap`.
 * `styleTokens` here carries ONLY token names, never raw geometry shorthands.
 */
export interface ResolvedZone {
  /** Stable slot identity for the renderer + click-to-edit. */
  slot: SlotKind;
  /** The widget that renders this zone. */
  widgetType: string;
  /** x as % of canvas width (left edge). 0-100. */
  x: number;
  /** y as % of canvas height (top edge). 0-100. */
  y: number;
  /** width as % of canvas width. 0-100. */
  width: number;
  /** height as % of canvas height. 0-100. */
  height: number;
  /** Layering order; 0 = back. */
  zIndex: number;
  /** Token-driven styling — resolved from the theme, never raw geometry. */
  styleTokens: ZoneStyleTokens;
}

export interface ZoneStyleTokens {
  /** Semantic color token: which palette role paints this zone's text/fill. */
  colorToken?: ColorToken;
  /** The type role (drives font size derivation). */
  typeRole?: TypeRole;
  /** Resolved font-family from the theme's pairing. */
  fontFamily?: string;
  /** Resolved font weight. */
  fontWeight?: number;
  /** Text alignment. */
  align?: 'left' | 'center' | 'right';
  /** Whether a scrim sits behind this zone (set by the contrast guard). */
  scrim?: ScrimSpec;
  /** Resolved pixel font size (set by type-scale + validator). */
  fontSizePx?: number;
  /** Whether this zone carries the reserved accent color. */
  isAccent?: boolean;
}

export type ColorToken = 'ink' | 'inkInverse' | 'surface' | 'accent' | 'muted';

export interface ScrimSpec {
  /** Scrim color (always resolves to a contrast-safe dark or light). */
  color: string;
  /** Opacity 0-1. */
  opacity: number;
  /** Direction the scrim gradient runs (for image backgrounds). */
  direction: 'none' | 'top' | 'bottom' | 'full';
}

// ---------------------------------------------------------------------------
// 5. THEME BUNDLE — swappable token bundle (themes.ts).
// ---------------------------------------------------------------------------

/**
 * A palette of resolved hex values. Every text token is GUARANTEED to pass the
 * contrast floor against its intended surface (enforced by themes.ts + tests).
 */
export interface ThemePalette {
  /** Page/board background. */
  background: string;
  /** Raised surface (cards, banners). */
  surface: string;
  /** Primary text — guaranteed-contrast against `background` + `surface`. */
  ink: string;
  /** Inverse text — for use over dark imagery / accent fills. */
  inkInverse: string;
  /** The single reserved accent (CTA / focal). */
  accent: string;
  /** Text color guaranteed legible ON the accent fill. */
  onAccent: string;
  /** A muted/secondary text tone (still passes large-text floor). */
  muted: string;
}

export interface FontPair {
  /** Display/headline family (700-800 weight). */
  display: string;
  /** Body family (400-500 weight). May equal display (single-family theme). */
  body: string;
  /** CSS font stack fallback appended to both. */
  fallback: string;
}

export interface ThemeMotion {
  /** Transition duration in ms (R6: 300-500 default). */
  durationMs: number;
  /** Easing — never 'linear' (R6 rule 21). */
  easing: 'ease-out' | 'ease-in' | 'ease-in-out';
}

export interface ThemeBundle {
  id: string;
  label: string;
  palette: ThemePalette;
  fontPair: FontPair;
  /** Modular scale ratio (Perfect Fourth 1.333 default). */
  typeScaleRatio: number;
  /** Default scrim strength applied when text sits over imagery. */
  scrim: ScrimSpec;
  motion: ThemeMotion;
  /** Corner radius token (px) for surfaces/cards. */
  radiusPx: number;
}

// ---------------------------------------------------------------------------
// 6. VALIDATOR result shapes (validator.ts).
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warn' | 'fixed';

export interface ValidationFinding {
  /** Machine code for the rule (e.g. 'CONTRAST_BELOW_FLOOR'). */
  code: string;
  severity: ValidationSeverity;
  /** Which slot/zone the finding applies to (or 'board' for board-level). */
  target: string;
  message: string;
}

export interface ValidationResult {
  /** True when no `error`-severity findings remain after auto-correction. */
  ok: boolean;
  findings: ValidationFinding[];
  /** The corrected zones (auto-fixes applied in place). */
  zones: ResolvedZone[];
}
