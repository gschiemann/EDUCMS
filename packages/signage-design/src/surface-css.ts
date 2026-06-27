/**
 * @cms/signage-design — SURFACE CSS
 *
 * Builds the $$$-grade DEPTH treatment as pure CSS strings: a layered,
 * accent-tinted background (never a flat slab), premium card fills, and the
 * accent divider/rule that anchors a kicker or headline. The art-director
 * mapper (apps/api/src/ai/art-director.ts) calls these and drops the strings
 * into the renderer's existing `bgGradient` / `bgColor` / card / divider config
 * — so no renderer rewrite is needed for the background richness.
 *
 * WHY this lives in the engine (not the mapper): it's deterministic design math
 * (theme tokens → CSS) that we want to UNIT-TEST (surface-css.spec.ts) and keep
 * as the single source of truth shared by the API + any future web-side live
 * preview. The mapper stays a thin translator.
 *
 * TAURUS-SAFE INVARIANT (CLAUDE.md rule #10): we emit ONLY `linear-gradient` /
 * `radial-gradient` / solid color strings and `1px solid <color>` borders.
 *   - NO `inset` shorthand, NO `gap`, NO `backdrop-filter` (the renderer paints
 *     these as `background:` on a longhand top/right/bottom/left overlay div).
 *   - Multiple comma-separated gradients in ONE `background` value are Chromium-
 *     83-safe (CSS3 multiple backgrounds shipped in Chrome 1).
 *
 * CONTRAST-SAFE INVARIANT: every layer here is DECORATIVE and sits BEHIND text.
 *   - The accent glow is a LOW-alpha accent radial that fades to transparent —
 *     it tints, it never paints a solid block under text.
 *   - The base ramp runs between `surface` and `background`, both of which the
 *     theme already guarantees `ink`/`muted` clear the floor against (themes.ts
 *     + themes.spec.ts). A ramp between two passing tones still passes.
 *   - So these layers CANNOT lower the contrast the validator verified.
 */

import { parseHex } from './contrast';
import { resolveSurfaceStyle } from './themes';
import type { ThemeBundle } from './types';

/** A hex (#rgb / #rrggbb) → `rgba(r,g,b,a)`. Falls back to the raw value on a parse miss. */
export function hexToRgba(hex: string, alpha: number): string {
  try {
    const { r, g, b } = parseHex(hex);
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } catch {
    return hex;
  }
}

/**
 * THE board background. A layered gradient stack tuned to the theme's depth
 * recipe, replacing the old single weak surface→background radial (which on a
 * dark theme read as a flat near-black slab because surface≈background).
 *
 * Layer order (top-most listed first, as CSS paints):
 *   1. an accent-tinted GLOW (a soft radial that fades to transparent), giving
 *      the board a focal light source + brand tint;
 *   2. the BASE ramp between surface + background (spotlight / duotone / wash).
 */
export function themeBackgroundCss(theme: ThemeBundle): string {
  const { palette } = theme;
  const style = resolveSurfaceStyle(theme);
  const { accent, surface, background } = palette;

  // The accent glow — strength dialed by `glow` (0..1). Capped low so it tints
  // rather than paints; a glow of 1 lands at ~0.22 alpha at the hot spot.
  const glowAlpha = Math.max(0, Math.min(1, style.glow)) * 0.22;
  const glow =
    glowAlpha > 0.001
      ? `radial-gradient(80% 60% at 50% 0%, ${hexToRgba(accent, glowAlpha)} 0%, ${hexToRgba(
          accent,
          0,
        )} 60%)`
      : '';

  let base: string;
  switch (style.background) {
    case 'duotone':
      // A directional diagonal ramp — richer, more energetic (sports / tech).
      base = `linear-gradient(135deg, ${surface} 0%, ${background} 62%, ${background} 100%)`;
      break;
    case 'wash':
      // A gentle near-flat radial — airy, for light/minimal themes.
      base = `radial-gradient(120% 120% at 50% 18%, ${surface} 0%, ${background} 78%)`;
      break;
    case 'spotlight':
    default:
      // A top-center spotlight ramp over a subtle vertical lift — the premium
      // default. The surface tone pools at the top, fading to background.
      base = `radial-gradient(110% 75% at 50% -8%, ${surface} 0%, ${background} 60%), linear-gradient(180deg, ${surface} 0%, ${background} 100%)`;
      break;
  }

  return glow ? `${glow}, ${base}` : base;
}

/**
 * The split-50 image-half gradient — a bold accent→surface diagonal so the
 * "image" half reads as a designed color field until a real photo lands.
 * (Already the richest surface in the engine; kept + centralized here.)
 */
export function imageHalfCss(theme: ThemeBundle): string {
  const { accent, surface } = theme.palette;
  return `linear-gradient(135deg, ${accent} 0%, ${surface} 100%)`;
}

/** A card/surface fill descriptor — solid OR a subtle top-lit gradient. */
export interface CardFill {
  /** The CSS `background` value for the card. */
  background: string;
  /** A `1px solid <color>` border, or undefined when the theme opts out. */
  border?: string;
  /** A premium drop shadow string. */
  boxShadow: string;
}

/**
 * Build the card (three-up-grid tile / surface) fill. A `gradient` card gets a
 * subtle top-lit surface ramp + an accent hairline border — the antidote to the
 * banned "flat rounded rectangle with a shadow". `flat` keeps a solid fill for
 * minimal themes.
 */
export function cardFillCss(theme: ThemeBundle): CardFill {
  const { palette } = theme;
  const style = resolveSurfaceStyle(theme);
  const { surface, background, accent } = palette;

  // A subtle top→bottom lift on the surface so the card has form, not a slab.
  // We lighten the top edge by blending surface toward its own highlight (a low
  // -alpha white over the surface) and settle to the plain surface at the base.
  const top = `linear-gradient(180deg, ${hexToRgba(WHITE_FOR_LIFT, 0.06)} 0%, ${hexToRgba(
    WHITE_FOR_LIFT,
    0,
  )} 40%)`;

  let background_: string;
  switch (style.card) {
    case 'flat':
      background_ = surface;
      break;
    case 'glass':
      // A translucent surface over the board — used sparingly (midnight-tech).
      // We approximate "glass" WITHOUT backdrop-filter (Taurus-flaky): a
      // semi-opaque surface tint that lets the board's glow read through.
      background_ = `${top}, linear-gradient(180deg, ${hexToRgba(surface, 0.82)} 0%, ${hexToRgba(
        background,
        0.82,
      )} 100%)`;
      break;
    case 'gradient':
    default:
      background_ = `${top}, linear-gradient(180deg, ${surface} 0%, ${blend(
        surface,
        background,
        0.5,
      )} 100%)`;
      break;
  }

  // The hairline border — a low-alpha accent tint so the card edge reads as
  // "designed" without a heavy stroke.
  const border = style.cardBorder ? `1px solid ${hexToRgba(accent, 0.22)}` : undefined;

  return {
    background: background_,
    border,
    boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
  };
}

/**
 * The ACCENT DIVIDER — a short rule that anchors a kicker / headline so the copy
 * doesn't float. The renderer draws it as a thin element under (or beside) the
 * slot. We return the CSS `background` for the rule (a solid accent → fade) and
 * its orientation.
 */
export interface DividerCss {
  /** The CSS `background` for the rule bar. */
  background: string;
  /** Thickness of the rule in px. */
  thicknessPx: number;
}

/** Build the accent divider CSS for a theme. */
export function dividerCss(theme: ThemeBundle): DividerCss {
  const { accent } = theme.palette;
  return {
    // A solid accent that fades to transparent — a tapered rule, not a hard bar.
    background: `linear-gradient(90deg, ${accent} 0%, ${hexToRgba(accent, 0)} 100%)`,
    thicknessPx: 4,
  };
}

// ---------------------------------------------------------------------------
// small color helpers (local — contrast.ts owns the WCAG math; these are just
// presentation blends, kept here so surface-css is self-contained).
// ---------------------------------------------------------------------------

const WHITE_FOR_LIFT = '#ffffff';

/** Linear blend of two hex colors. t=0 → a, t=1 → b. */
export function blend(a: string, b: string, t: number): string {
  try {
    const ca = parseHex(a);
    const cb = parseHex(b);
    const k = Math.max(0, Math.min(1, t));
    const ch = (x: number, y: number) =>
      Math.round(x + (y - x) * k)
        .toString(16)
        .padStart(2, '0');
    return `#${ch(ca.r, cb.r)}${ch(ca.g, cb.g)}${ch(ca.b, cb.b)}`;
  } catch {
    return a;
  }
}
