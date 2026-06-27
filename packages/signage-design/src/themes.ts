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
import { PERFECT_FOURTH } from './type-scale';
import type { FontPair, ScrimSpec, SurfaceStyle, ThemeBundle, ThemePalette } from './types';

const SANS_FALLBACK = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

function pair(display: string, body: string): FontPair {
  return { display, body, fallback: SANS_FALLBACK };
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
    },
    pair('Inter', 'Inter'),
    { radiusPx: 16, surfaceStyle: { background: 'spotlight', glow: 0.5, card: 'gradient', cardBorder: true } },
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
    },
    pair('Poppins', 'Inter'),
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
    },
    pair('Oswald', 'Inter'),
    {
      typeScaleRatio: 1.414,
      radiusPx: 8,
      motion: { durationMs: 320, easing: 'ease-out' },
      surfaceStyle: { background: 'duotone', glow: 0.85, card: 'gradient', cardBorder: true },
    },
  ),
  bundle(
    'qsr-appetite',
    'QSR Appetite',
    {
      background: '#1a0a0a',
      surface: '#2b0f0f',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      accent: '#f59e0b',
      onAccent: '#1f1400',
      muted: '#e5cfcf',
    },
    pair('Montserrat', 'Inter'),
    { radiusPx: 18, surfaceStyle: { background: 'spotlight', glow: 0.72, card: 'gradient', cardBorder: true } },
  ),
  bundle(
    'minimal-luxury',
    'Minimal Luxury',
    {
      background: '#0c0c0c',
      surface: '#161616',
      ink: '#f5f5f5',
      inkInverse: '#0a0a0a',
      accent: '#b8a06a',
      onAccent: '#1a1505',
      muted: '#a3a3a3',
    },
    pair('Cormorant Garamond', 'Inter'),
    {
      typeScaleRatio: 1.5,
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
    },
    pair('Inter', 'Inter'),
    {
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
      surface: '#141c24',
      ink: '#ffffff',
      inkInverse: '#0a0a0a',
      accent: '#22d3ee',
      onAccent: '#04222b',
      muted: '#c2d0db',
    },
    pair('Barlow', 'Inter'),
    { radiusPx: 14, surfaceStyle: { background: 'duotone', glow: 0.78, card: 'gradient', cardBorder: true } },
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
    },
    pair('Playfair Display', 'Inter'),
    {
      typeScaleRatio: 1.5,
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
      accent: '#be185d',
      onAccent: '#ffffff',
      muted: '#d4d4d8',
    },
    pair('Sora', 'Inter'),
    { radiusPx: 20, surfaceStyle: { background: 'duotone', glow: 0.8, card: 'gradient', cardBorder: true } },
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
    },
    pair('Inter', 'Inter'),
    { radiusPx: 16, surfaceStyle: { background: 'wash', glow: 0.34, card: 'gradient', cardBorder: true } },
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
    },
    pair('Poppins', 'Inter'),
    { radiusPx: 22, surfaceStyle: { background: 'spotlight', glow: 0.55, card: 'gradient', cardBorder: true } },
  ),
  bundle(
    'midnight-tech',
    'Midnight Tech',
    {
      background: '#0a0a14',
      surface: '#13131f',
      ink: '#f5f5ff',
      inkInverse: '#0a0a0a',
      accent: '#6d28d9',
      onAccent: '#ffffff',
      muted: '#c4c4d4',
    },
    pair('Space Grotesk', 'Inter'),
    { radiusPx: 18, surfaceStyle: { background: 'duotone', glow: 0.82, card: 'glass', cardBorder: true } },
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
  const fontPair = opts.fontPair ?? pair('Inter', 'Inter');

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

  // Accent: keep it vivid (mid tone) but ensure onAccent text clears the LARGE
  // floor (the accent is used on CTAs / focal elements — large text).
  // We pick the accent tone that is both vivid AND lets a text token pass.
  let accent = accentPalette.tone(mode === 'dark' ? 70 : 45);
  let onAccent = bestTextColor(accent);
  if (contrastRatio(onAccent, accent) < LARGE_CONTRAST_FLOOR) {
    // Push the accent toward an extreme where a pure text token clears the floor.
    for (const t of [60, 75, 50, 80, 40, 85, 35]) {
      const candidate = accentPalette.tone(t);
      const candidateText = bestTextColor(candidate);
      if (contrastRatio(candidateText, candidate) >= LARGE_CONTRAST_FLOOR) {
        accent = candidate;
        onAccent = candidateText;
        break;
      }
    }
  }

  const palette: ThemePalette = {
    background,
    surface,
    ink,
    inkInverse,
    accent,
    onAccent,
    muted,
  };

  return bundle(id, label, palette, fontPair, {
    scrim: { color: mode === 'dark' ? NEAR_BLACK : WHITE, opacity: 0.55, direction: 'full' },
  });
}
