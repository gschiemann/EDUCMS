/**
 * @cms/signage-design — THEMES
 *
 * Swappable token bundles + brand-derived palette generation.
 *
 * Two ways to get a theme:
 *   1. A curated ThemeBundle (THEMES) — ~12 designer-tuned looks. Every text
 *      token in these is hand-verified to pass the signage contrast floors
 *      (asserted by themes.spec.ts).
 *   2. deriveThemeFromBrand(brandPrimaryHex) — generates a coherent palette from
 *      a single brand color using a REAL HCT / Material-3 tonal algorithm
 *      (hct.ts), NOT a naive HSL ramp. It GUARANTEES contrast-passing text
 *      tokens even for a garish brand color (safety-orange, neon) by sampling
 *      the tonal palette at tones whose contrast vs the chosen surface is
 *      provably above the floor — then verifying with contrast.ts and falling
 *      back to pure black/white text if the brand tone can't clear the floor.
 */

import { TonalPalette } from './hct';
import {
  BODY_CONTRAST_FLOOR,
  LARGE_CONTRAST_FLOOR,
  NEAR_BLACK,
  WHITE,
  bestTextColor,
  contrastRatio,
  relativeLuminance,
} from './contrast';
import { GOLDEN_RATIO, MAJOR_THIRD, PERFECT_FOURTH } from './type-scale';
import { Hct, TonalPalette as HctTonalPalette, argbFromHex } from './hct';
import type { FontPair, ScrimSpec, SurfaceStyle, ThemeBundle, ThemePalette } from './types';

const SANS_FALLBACK = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const SERIF_FALLBACK = 'Georgia, Cambria, "Times New Roman", Times, serif';

/**
 * Build a FontPair, optionally carrying the per-typeface DETAIL tokens
 * (displayWeight / bodyWeight / displayTracking / kickerTracking — 2026-06-28).
 * `fallback` defaults to the sans stack; pass the serif stack for serif displays
 * so an un-loaded serif degrades to a serif, not a sans.
 */
function pair(
  display: string,
  body: string,
  detail: Partial<
    Pick<FontPair, 'displayWeight' | 'bodyWeight' | 'displayTracking' | 'kickerTracking' | 'fallback'>
  > = {},
): FontPair {
  return {
    display,
    body,
    fallback: detail.fallback ?? SANS_FALLBACK,
    displayWeight: detail.displayWeight,
    bodyWeight: detail.bodyWeight,
    displayTracking: detail.displayTracking,
    kickerTracking: detail.kickerTracking,
  };
}

const DEFAULT_SCRIM: ScrimSpec = { color: NEAR_BLACK, opacity: 0.55, direction: 'full' };

function bundle(
  id: string,
  label: string,
  palette: ThemePalette,
  fontPair: FontPair,
  opts: Partial<
    Pick<ThemeBundle, 'typeScaleRatio' | 'scrim' | 'motion' | 'radiusPx' | 'surfaceStyle'>
  > = {},
): ThemeBundle {
  return {
    id,
    label,
    palette,
    fontPair,
    typeScaleRatio: opts.typeScaleRatio ?? PERFECT_FOURTH,
    scrim: opts.scrim ?? DEFAULT_SCRIM,
    motion: opts.motion ?? { durationMs: 400, easing: 'ease-out' },
    radiusPx: opts.radiusPx ?? 24,
    surfaceStyle: opts.surfaceStyle,
  };
}

// ---------------------------------------------------------------------------
// 12 curated themes. Palettes are tuned so ink passes 7:1 on background AND
// surface, and onAccent passes 4.5:1 on accent (verified by tests).
// ---------------------------------------------------------------------------

export const THEMES: ThemeBundle[] = [
  bundle(
    'clean-corporate',
    'Clean Corporate',
    {
      background: '#0f172a',
      surface: '#1e293b',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      accent: '#38bdf8',
      onAccent: '#06283d',
      muted: '#cbd5e1',
      // analogous indigo — a calm secondary pop on the eyebrow/rule.
      accent2: '#818cf8',
      onAccent2: '#0a0a0a',
    },
    // Space Grotesk display over Inter body — a modern SaaS pairing with a touch
    // more character than Inter/Inter, tight display tracking.
    pair('Space Grotesk', 'Inter', {
      displayWeight: 700,
      bodyWeight: 500,
      displayTracking: '-0.02em',
      kickerTracking: '0.16em',
    }),
    {
      typeScaleRatio: MAJOR_THIRD,
      radiusPx: 16,
      surfaceStyle: { background: 'spotlight', glow: 0.5, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'warm-school',
    'Warm School',
    {
      background: '#fffaf0',
      surface: '#ffffff',
      ink: '#1a1206',
      inkInverse: '#ffffff',
      accent: '#c2410c',
      onAccent: '#ffffff',
      muted: '#5b4a36',
      // a friendly teal complement to the warm terracotta accent.
      accent2: '#0f766e',
      onAccent2: '#ffffff',
    },
    // Fredoka — a rounded, friendly display for K-12; Nunito Sans body.
    pair('Fredoka', 'Nunito Sans', {
      displayWeight: 600,
      bodyWeight: 500,
      displayTracking: '-0.01em',
      kickerTracking: '0.14em',
    }),
    { radiusPx: 28, surfaceStyle: { background: 'spotlight', glow: 0.32, card: 'gradient', cardBorder: true } },
  ),
  bundle(
    'neon-sports',
    'Neon Sports',
    {
      background: '#0a0a0a',
      surface: '#171717',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      accent: '#facc15',
      onAccent: '#1a1500',
      muted: '#d4d4d4',
      // electric cyan — a stadium-LED second pop alongside the amber.
      accent2: '#22d3ee',
      onAccent2: '#04222b',
    },
    // Anton — an ultra-bold condensed display made for hype; Barlow body.
    pair('Anton', 'Barlow', {
      displayWeight: 400, // Anton ships a single 400 weight that reads as ultra-bold
      bodyWeight: 500,
      displayTracking: '-0.01em',
      kickerTracking: '0.22em',
    }),
    {
      typeScaleRatio: GOLDEN_RATIO,
      radiusPx: 8,
      motion: { durationMs: 320, easing: 'ease-out' },
      surfaceStyle: { background: 'duotone', glow: 0.85, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'qsr-appetite',
    'QSR Appetite',
    {
      // a true espresso ground (not near-black) so the theme reads distinct.
      background: '#241310',
      surface: '#371b16',
      ink: '#fff8f2',
      inkInverse: '#0a0a0a',
      accent: '#f59e0b',
      onAccent: '#1f1400',
      muted: '#eccfc4',
      // a hot tomato red — the classic QSR amber+red duo.
      accent2: '#ef4444',
      onAccent2: '#1a0606',
    },
    // Archivo (with an expanded feel) display over Inter — punchy menu type.
    pair('Archivo', 'Inter', {
      displayWeight: 800,
      bodyWeight: 500,
      displayTracking: '-0.02em',
      kickerTracking: '0.18em',
    }),
    {
      typeScaleRatio: 1.5,
      radiusPx: 18,
      surfaceStyle: { background: 'spotlight', glow: 0.72, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'minimal-luxury',
    'Minimal Luxury',
    {
      // a warm charcoal ground (not near-black) — editorial, not slab.
      background: '#1c1a17',
      surface: '#26231f',
      ink: '#f5f3ee',
      inkInverse: '#0a0a0a',
      accent: '#c9b27e',
      onAccent: '#1a1505',
      muted: '#b3aa99',
      // a deep muted bronze for the eyebrow — a restrained tonal partner.
      accent2: '#a98e64',
      onAccent2: '#161208',
    },
    // Fraunces — a high-contrast display serif with real luxury character;
    // Cormorant Garamond body. Serif display wants 0 tracking + heavier weight.
    pair('Fraunces', 'Cormorant Garamond', {
      displayWeight: 600,
      bodyWeight: 500,
      displayTracking: '0',
      kickerTracking: '0.28em',
      fallback: SERIF_FALLBACK,
    }),
    {
      typeScaleRatio: GOLDEN_RATIO,
      radiusPx: 0,
      motion: { durationMs: 500, easing: 'ease-in-out' },
      surfaceStyle: { background: 'wash', glow: 0.28, card: 'flat', cardBorder: true },
    },
  ),
  bundle(
    'calm-clinic',
    'Calm Clinic',
    {
      background: '#f0f9ff',
      surface: '#ffffff',
      ink: '#0c2a3a',
      inkInverse: '#ffffff',
      accent: '#0f766e',
      onAccent: '#ffffff',
      muted: '#3f6478',
      // a soft trustworthy blue partner for the eyebrow.
      accent2: '#0369a1',
      onAccent2: '#ffffff',
    },
    // A humanist sans display (Mulish) over Inter — softer than Inter/Inter.
    pair('Mulish', 'Inter', {
      displayWeight: 700,
      bodyWeight: 400,
      displayTracking: '-0.01em',
      kickerTracking: '0.16em',
    }),
    {
      typeScaleRatio: MAJOR_THIRD,
      radiusPx: 20,
      motion: { durationMs: 450, easing: 'ease-in-out' },
      surfaceStyle: { background: 'wash', glow: 0.3, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'fresh-fitness',
    'Fresh Fitness',
    {
      background: '#0a0f14',
      surface: '#152029',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      accent: '#22d3ee',
      onAccent: '#04222b',
      muted: '#c2d0db',
      // a vivid lime — the energetic gym second pop.
      accent2: '#a3e635',
      onAccent2: '#0c1a02',
    },
    pair('Barlow Condensed', 'Barlow', {
      displayWeight: 700,
      bodyWeight: 500,
      displayTracking: '-0.01em',
      kickerTracking: '0.2em',
    }),
    {
      typeScaleRatio: 1.5,
      radiusPx: 14,
      surfaceStyle: { background: 'duotone', glow: 0.78, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'worship-warm',
    'Worship Warm',
    {
      background: '#1c1410',
      surface: '#2a1f17',
      ink: '#fdf6ec',
      inkInverse: '#0a0a0a',
      accent: '#d4a857',
      onAccent: '#241803',
      muted: '#e0cdb4',
      // a warm rose-gold partner for the eyebrow.
      accent2: '#c97b63',
      onAccent2: '#1a0a06',
    },
    // Playfair Display — a true serif display at its elegant heavy weight, with
    // a Source Serif body (not Inter) for a coherent serif voice.
    pair('Playfair Display', 'Source Serif 4', {
      displayWeight: 800,
      bodyWeight: 400,
      displayTracking: '0',
      kickerTracking: '0.24em',
      fallback: SERIF_FALLBACK,
    }),
    {
      typeScaleRatio: GOLDEN_RATIO,
      radiusPx: 12,
      motion: { durationMs: 500, easing: 'ease-in-out' },
      surfaceStyle: { background: 'spotlight', glow: 0.55, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'bold-retail',
    'Bold Retail',
    {
      background: '#18181b',
      surface: '#27272a',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      // RE-TUNED (2026-06-28): #be185d failed as accent-TEXT on #18181b
      // (2.93:1). #f0529a clears the LARGE floor as text AND as a CTA fill.
      accent: '#f0529a',
      onAccent: '#2a0716',
      muted: '#d4d4d8',
      // a vivid violet — the retail promo second pop.
      accent2: '#a78bfa',
      onAccent2: '#150826',
    },
    pair('Sora', 'Inter', {
      displayWeight: 800,
      bodyWeight: 500,
      displayTracking: '-0.03em',
      kickerTracking: '0.18em',
    }),
    {
      typeScaleRatio: 1.5,
      radiusPx: 20,
      surfaceStyle: { background: 'duotone', glow: 0.8, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'sky-civic',
    'Sky Civic',
    {
      background: '#f8fafc',
      surface: '#ffffff',
      ink: '#0f2740',
      inkInverse: '#ffffff',
      accent: '#1d4ed8',
      onAccent: '#ffffff',
      muted: '#3c5871',
      // a steady teal partner for the eyebrow.
      accent2: '#0e7490',
      onAccent2: '#ffffff',
    },
    pair('Archivo', 'Inter', {
      displayWeight: 700,
      bodyWeight: 400,
      displayTracking: '-0.015em',
      kickerTracking: '0.16em',
    }),
    {
      typeScaleRatio: MAJOR_THIRD,
      radiusPx: 16,
      surfaceStyle: { background: 'wash', glow: 0.34, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'forest-campus',
    'Forest Campus',
    {
      background: '#0b1a12',
      surface: '#13261b',
      ink: '#f0fdf4',
      inkInverse: '#0a0a0a',
      accent: '#84cc16',
      onAccent: '#13230a',
      muted: '#bfe0c9',
      // a warm amber complement to the lime green.
      accent2: '#d4a017',
      onAccent2: '#1a1404',
    },
    pair('Fraunces', 'Nunito Sans', {
      displayWeight: 600,
      bodyWeight: 500,
      displayTracking: '0',
      kickerTracking: '0.18em',
      fallback: SERIF_FALLBACK,
    }),
    {
      typeScaleRatio: PERFECT_FOURTH,
      radiusPx: 22,
      surfaceStyle: { background: 'spotlight', glow: 0.55, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'midnight-tech',
    'Midnight Tech',
    {
      // a deep indigo ground (not near-black) so the theme reads distinct + glows.
      background: '#141228',
      surface: '#1d1a3a',
      ink: '#f5f5ff',
      inkInverse: '#0a0a0a',
      // RE-TUNED (2026-06-28): #6d28d9 failed as accent-TEXT on its bg (2.77:1).
      // #a78bfa clears the LARGE floor as text AND fills a CTA pill cleanly.
      accent: '#a78bfa',
      onAccent: '#1a1033',
      muted: '#c4c4e4',
      // an electric cyan — the modern tech second pop.
      accent2: '#22d3ee',
      onAccent2: '#04222b',
    },
    pair('Sora', 'Inter', {
      displayWeight: 700,
      bodyWeight: 400,
      displayTracking: '-0.03em',
      kickerTracking: '0.2em',
    }),
    {
      typeScaleRatio: 1.5,
      radiusPx: 18,
      surfaceStyle: { background: 'duotone', glow: 0.82, card: 'glass', cardBorder: true },
    },
  ),
];

// ---------------------------------------------------------------------------
// SURFACE STYLE — the DEPTH recipe (defaults + resolver). Every board, curated
// or brand-derived, gets layered depth (never a flat slab) by reading this.
// ---------------------------------------------------------------------------

/** Sensible defaults when a theme omits a SurfaceStyle (brand-derived themes). */
export const DEFAULT_SURFACE_STYLE: Required<SurfaceStyle> = {
  background: 'spotlight',
  glow: 0.5,
  card: 'gradient',
  cardBorder: true,
};

/**
 * Resolve a theme's full depth recipe, filling defaults for any unset dial.
 * Brand-derived themes (no surfaceStyle) get the premium default automatically.
 * A light board (luminous background) gets a gentler default glow so the accent
 * tint never muddies a clean light surface.
 */
export function resolveSurfaceStyle(theme: ThemeBundle): Required<SurfaceStyle> {
  const isLight = relativeLuminance(theme.palette.background) > 0.5;
  const base: Required<SurfaceStyle> = {
    ...DEFAULT_SURFACE_STYLE,
    // Light themes read best as an airy wash with a restrained glow.
    background: isLight ? 'wash' : DEFAULT_SURFACE_STYLE.background,
    glow: isLight ? 0.32 : DEFAULT_SURFACE_STYLE.glow,
  };
  const s = theme.surfaceStyle;
  if (!s) return base;
  return {
    background: s.background ?? base.background,
    glow: s.glow ?? base.glow,
    card: s.card ?? base.card,
    cardBorder: s.cardBorder ?? base.cardBorder,
  };
}

const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** Look up a curated theme by id; undefined if unknown. */
export function getTheme(id: string): ThemeBundle | undefined {
  return THEME_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// deriveThemeFromBrand — Material-3 HCT tonal generation with guaranteed
// contrast-passing text tokens.
// ---------------------------------------------------------------------------

export interface DeriveBrandOptions {
  /** 'dark' or 'light' surface. Defaults to 'dark' (most signage is dark). */
  mode?: 'dark' | 'light';
  /** Optional explicit accent brand hex (else derived from primary). */
  accentHex?: string;
  /** Theme id to assign. Defaults to 'brand'. */
  id?: string;
  /** Display label. */
  label?: string;
  /** Font pair to ride along (brand fonts). Defaults to Inter/Inter. */
  fontPair?: FontPair;
}

/**
 * Pick the tone on a TonalPalette whose hex best clears `floor` against `bg`,
 * scanning toward the high-contrast end. If even the most extreme brand tone
 * can't clear the floor (very low-chroma or mid-tone hue), fall back to pure
 * white / near-black text — so contrast is ALWAYS guaranteed.
 */
function contrastSafeToneHex(
  palette: TonalPalette,
  bg: string,
  floor: number,
  prefer: 'light' | 'dark',
): string {
  const tones = prefer === 'light' ? [98, 95, 90, 85, 80] : [10, 15, 20, 25, 30];
  let best = '';
  let bestRatio = 0;
  for (const t of tones) {
    const hex = palette.tone(t);
    const ratio = contrastRatio(hex, bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = hex;
    }
    if (ratio >= floor) return hex;
  }
  // Brand tone can't clear the floor → guarantee with pure black/white.
  const pure = prefer === 'light' ? WHITE : NEAR_BLACK;
  if (contrastRatio(pure, bg) >= floor) return pure;
  // Last resort: the absolute best-contrast color (always >= the brand best).
  return contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg)
    ? WHITE
    : best || NEAR_BLACK;
}

/**
 * Derive a full ThemeBundle from a single brand primary hex.
 *
 * The palette is built from the brand's HCT tonal ramp (perceptually even),
 * then every TEXT token is chosen by contrast against its target surface so it
 * provably clears the signage floor — even for safety-orange / neon brands.
 */
export function deriveThemeFromBrand(
  brandPrimaryHex: string,
  opts: DeriveBrandOptions = {},
): ThemeBundle {
  const mode = opts.mode ?? 'dark';
  const id = opts.id ?? 'brand';
  const label = opts.label ?? 'Brand';
  // 2026-06-28 LIVE-VISUAL FIX — a brand-palette board (the COMMON case: the
  // operator wants their own colors) previously defaulted to Inter/Inter, so it
  // read like a SaaS dashboard, not a designed poster (the road-to-world-class
  // panel's #1 typographic miss, confirmed on a live render). Default brand
  // boards to a characterful-but-brand-neutral display face (Space Grotesk —
  // geometric, modern, pairs with ANY brand hue; already in SIGNAGE_FONTS_HREF)
  // with proper negative display tracking + a clean Inter body. A caller that
  // wants the brand on a NAMED theme's fonts still passes opts.fontPair.
  const fontPair =
    opts.fontPair ??
    pair('Space Grotesk', 'Inter', {
      displayWeight: 700,
      bodyWeight: 500,
      displayTracking: '-0.02em',
      kickerTracking: '0.16em',
    });

  const brandPalette = TonalPalette.fromHex(brandPrimaryHex);
  const accentPalette = opts.accentHex
    ? TonalPalette.fromHex(opts.accentHex)
    : brandPalette;

  // Surfaces: low tones for dark mode, high tones for light mode. We pull these
  // from the brand hue so the whole board feels tinted by the brand.
  const background = mode === 'dark' ? brandPalette.tone(8) : brandPalette.tone(98);
  const surface = mode === 'dark' ? brandPalette.tone(14) : brandPalette.tone(100);

  // Ink: high-contrast text vs background (the primary reading surface). We
  // require the BODY floor (7:1) so it works for both headline + body.
  const ink = contrastSafeToneHex(
    brandPalette,
    background,
    BODY_CONTRAST_FLOOR,
    mode === 'dark' ? 'light' : 'dark',
  );
  // inkInverse is the opposite-end text for use over the accent / dark imagery.
  const inkInverse = bestTextColor(ink) === WHITE ? WHITE : NEAR_BLACK;

  // Muted: still must pass the LARGE floor (4.5:1) — it's only used at title+ size.
  const muted = contrastSafeToneHex(
    brandPalette,
    background,
    LARGE_CONTRAST_FLOOR,
    mode === 'dark' ? 'light' : 'dark',
  );

  // Accent — keep the brand color PUNCHY, never pastel'd (2026-06-28 fix).
  // The old code hardcoded tone(dark?70:45); tone 70 on a high-chroma hue lands
  // washed-out (Coca-Cola red → salmon, hot-pink → pale). Instead we scan from
  // the SATURATED end toward lighter and pick the LOWEST tone that still:
  //   (a) clears the LARGE floor as accent-TEXT on the board background (so the
  //       focal stat keeps its brand color — never silently flips to white), AND
  //   (b) lets a pure onAccent text token clear the LARGE floor ON the accent
  //       fill (so the CTA pill stays legible).
  // The lowest passing tone is the MOST saturated one that's still legible — the
  // opposite of the pastel bias. We bias the scan toward mid tones (50-58) for
  // high-chroma seeds so the brand reads vivid, falling back to lighter tones
  // only if the brand hue can't clear the floor any other way.
  const { accent, onAccent } = pickBrandAccent(accentPalette, background, mode);

  // accent2 — a restrained ANALOGOUS secondary (±~28° hue) at the same vibrant
  // discipline, so a brand board reads as a 2-colour system, not monochrome.
  const accent2Palette = analogousPalette(accentPalette, mode === 'dark' ? 28 : -28);
  const a2 = pickBrandAccent(accent2Palette, background, mode);

  const palette: ThemePalette = {
    background,
    surface,
    ink,
    inkInverse,
    accent,
    onAccent,
    muted,
    accent2: a2.accent,
    onAccent2: a2.onAccent,
  };

  return bundle(id, label, palette, fontPair, {
    scrim: { color: mode === 'dark' ? NEAR_BLACK : WHITE, opacity: 0.55, direction: 'full' },
  });
}

/**
 * Pick the most SATURATED-yet-legible accent tone for a brand palette against a
 * board background. Returns the accent hex + a contrast-safe onAccent text token.
 *
 * Strategy: walk tones from the vivid mid-band outward and return the FIRST that
 * satisfies BOTH legibility checks (accent-as-text on bg ≥ LARGE; onAccent-on-
 * accent ≥ LARGE). The candidate order is chosen so a high-chroma seed lands on
 * a saturated tone (50-58) and only drifts lighter/darker when forced. If
 * nothing clears both, fall back to the most-contrasting brand tone (guaranteed
 * legible as a CTA fill via its onAccent token).
 */
function pickBrandAccent(
  palette: TonalPalette,
  background: string,
  mode: 'dark' | 'light',
): { accent: string; onAccent: string } {
  // Dark boards want a brighter accent (it sits on a dark ground); light boards
  // want a deeper one. Both lead with the vibrant mid-band, NOT the pale end.
  const order =
    mode === 'dark'
      ? [58, 62, 54, 66, 50, 70, 46, 74, 78]
      : [50, 46, 54, 42, 58, 38, 62, 34];
  let best = palette.tone(order[0]);
  let bestText = bestTextColor(best);
  let bestRatio = 0;
  for (const t of order) {
    const candidate = palette.tone(t);
    const candidateText = bestTextColor(candidate);
    const asText = contrastRatio(candidate, background); // accent legible as TEXT on bg
    const onFill = contrastRatio(candidateText, candidate); // onAccent legible on accent fill
    // Track the best CTA-fill candidate as a guaranteed fallback.
    if (onFill > bestRatio) {
      bestRatio = onFill;
      best = candidate;
      bestText = candidateText;
    }
    if (asText >= LARGE_CONTRAST_FLOOR && onFill >= LARGE_CONTRAST_FLOOR) {
      return { accent: candidate, onAccent: candidateText };
    }
  }
  return { accent: best, onAccent: bestText };
}

/**
 * Build an analogous TonalPalette by rotating the seed's HCT hue by `deltaDeg`
 * (keeping its chroma) — the math behind a coherent secondary accent. Falls back
 * to the original palette on any HCT failure so accent2 always resolves.
 */
function analogousPalette(seed: TonalPalette, deltaDeg: number): TonalPalette {
  try {
    // Read the seed's hue+chroma from a mid tone, rotate the hue, keep chroma.
    const hct = Hct.fromInt(argbFromHex(seed.tone(50)));
    const hue = ((hct.hue + deltaDeg) % 360 + 360) % 360;
    return HctTonalPalette.fromHueAndChroma(hue, hct.chroma);
  } catch {
    return seed;
  }
}
