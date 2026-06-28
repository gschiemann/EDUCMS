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

import { parseHex, relativeLuminance } from './contrast';
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
  // The SECONDARY accent (2026-06-28) — used as a second, offset glow source so
  // the photoless background reads as a designed MESH, not a single-hue ramp.
  // Falls back to the primary accent when a theme/derived palette has no accent2.
  const accent2 = palette.accent2 ?? accent;

  // The accent glow — strength dialed by `glow` (0..1). Capped low so it tints
  // rather than paints; a glow of 1 lands at ~0.22 alpha at the hot spot.
  const g = Math.max(0, Math.min(1, style.glow));
  const glowAlpha = g * 0.22;
  // PRIMARY glow — a soft radial pooled top-center (the focal light source).
  const glow =
    glowAlpha > 0.001
      ? `radial-gradient(80% 60% at 50% 0%, ${hexToRgba(accent, glowAlpha)} 0%, ${hexToRgba(
          accent,
          0,
        )} 60%)`
      : '';
  // SECONDARY mesh blob — a smaller accent2 radial offset to a lower corner so
  // the field has TWO light sources (the studio "mesh gradient" move). Kept at a
  // lower alpha than the primary so the brand accent stays dominant. Decorative,
  // fades fully to transparent — never touches measured text contrast.
  const meshAlpha = g * 0.14;
  const mesh =
    meshAlpha > 0.001
      ? `radial-gradient(55% 45% at 88% 100%, ${hexToRgba(accent2, meshAlpha)} 0%, ${hexToRgba(
          accent2,
          0,
        )} 55%)`
      : '';
  // A corner VIGNETTE on dark themes — a faint darken at the edges so the board
  // has tactile depth instead of a flat digital ramp. Skipped on light themes
  // (a vignette muddies a clean light surface). Pure background layer, Taurus-safe.
  const isLight = relativeLuminance(background) > 0.5;
  const vignette = isLight
    ? ''
    : 'radial-gradient(135% 120% at 50% 42%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.26) 100%)';

  let base: string;
  switch (style.background) {
    case 'duotone':
      // A directional diagonal ramp with a 3rd stop pulling toward accent2 in the
      // far corner — richer + more energetic (sports / tech / retail).
      base = `linear-gradient(135deg, ${surface} 0%, ${background} 58%, ${blend(
        background,
        accent2,
        0.1,
      )} 100%)`;
      break;
    case 'wash':
      // A gentle near-flat radial — airy, for light/minimal themes.
      base = `radial-gradient(120% 120% at 50% 18%, ${surface} 0%, ${background} 78%)`;
      break;
    case 'spotlight':
    default:
      // A 3-STOP top-center spotlight (surface → a mid blend → background) over a
      // subtle vertical lift — so a dark theme where surface≈background still
      // shows visible FORM, not a flat near-black slab. (2026-06-28 richness.)
      base = `radial-gradient(110% 78% at 50% -10%, ${surface} 0%, ${blend(
        surface,
        background,
        0.55,
      )} 38%, ${background} 70%), linear-gradient(180deg, ${surface} 0%, ${background} 100%)`;
      break;
  }

  // Paint order (CSS paints first-listed on top): glow → mesh → vignette → base.
  return [glow, mesh, vignette, base].filter(Boolean).join(', ');
}

/**
 * The split-50 image-half gradient — a bold accent→surface diagonal so the
 * "image" half reads as a designed color field until a real photo lands.
 * (Already the richest surface in the engine; kept + centralized here.)
 */
export function imageHalfCss(theme: ThemeBundle): string {
  const { accent, surface, accent2 } = theme.palette;
  // A bold accent → accent2 diagonal (a true two-colour field), with a final
  // settle toward surface so it ties into the board. When there's no accent2 we
  // keep the original accent → surface ramp (zero regression).
  if (accent2 && accent2 !== accent) {
    return `linear-gradient(135deg, ${accent} 0%, ${accent2} 58%, ${blend(
      accent2,
      surface,
      0.5,
    )} 100%)`;
  }
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

/**
 * Build the accent divider CSS for a theme. By default the rule uses the
 * SECONDARY accent (accent2) so the eyebrow/divider carries the second colour
 * of the system while the primary accent stays reserved for the focal CTA/stat
 * — the "now it looks designed" 2-colour split. Pass `useSecondary:false` to
 * force the primary accent (e.g. the three-up card top-bar, where the card is
 * already a neutral surface and the primary pop reads best).
 */
export function dividerCss(theme: ThemeBundle, useSecondary = true): DividerCss {
  const { accent, accent2 } = theme.palette;
  const c = useSecondary ? accent2 ?? accent : accent;
  return {
    // A solid accent that fades to transparent — a tapered rule, not a hard bar.
    background: `linear-gradient(90deg, ${c} 0%, ${hexToRgba(c, 0)} 100%)`,
    thicknessPx: 4,
  };
}

// ---------------------------------------------------------------------------
// KICKER-AS-BADGE (2026-06-28 taste tier) — the enclosed eyebrow chip, the most
// universal "this was designed" micro-signal. The renderer renders the kicker
// inside an inline-flex padded pill when `badgeCss` is set.
// ---------------------------------------------------------------------------

export interface BadgeCss {
  /** Whether this theme uses a badge at all (some looks want bare type). */
  enabled: boolean;
  /** 'filled' (accent2 bg + onAccent2 text) or 'outline' (border + accent2 text). */
  variant: 'filled' | 'outline';
  /** The pill `background` CSS value (transparent for outline). */
  background: string;
  /** The pill text color. */
  color: string;
  /** A `1px solid <color>` border for the outline variant, else undefined. */
  border?: string;
  /** Corner radius in px (a high value = full capsule). */
  radiusPx: number;
}

/**
 * Build the kicker-badge recipe for a theme. High-energy themes get a FILLED
 * accent2 pill (the loud "designed" cue); minimal/luxury + light editorial
 * themes get an OUTLINE capsule (restrained) — and pure-serif luxury can skip
 * the badge entirely (bare letterspaced type IS the luxury look). Uses accent2
 * so the badge doesn't fight the primary-accent focal element.
 */
export function badgeCss(theme: ThemeBundle): BadgeCss {
  const { accent, accent2, onAccent2, onAccent, background } = theme.palette;
  const a2 = accent2 ?? accent;
  const on2 = onAccent2 ?? onAccent;
  const isLight = relativeLuminance(background) > 0.5;
  // Luxury / minimal: bare type is the look — no badge.
  if (theme.id === 'minimal-luxury') {
    return { enabled: false, variant: 'outline', background: 'transparent', color: a2, radiusPx: 0 };
  }
  // Light editorial + calm themes read better with a restrained OUTLINE capsule.
  const outline = isLight || theme.id === 'calm-clinic' || theme.id === 'sky-civic';
  if (outline) {
    return {
      enabled: true,
      variant: 'outline',
      background: 'transparent',
      color: a2,
      border: `1px solid ${hexToRgba(a2, 0.55)}`,
      radiusPx: 999,
    };
  }
  // Everything else: a FILLED accent2 pill.
  return {
    enabled: true,
    variant: 'filled',
    background: a2,
    color: on2,
    radiusPx: 999,
  };
}

// ---------------------------------------------------------------------------
// ENTRANCE MOTION CSS (2026-06-28 taste tier) — the @keyframes the renderer
// injects so a generated board reveals tastefully instead of being dead-static.
// Pure CSS keyframes (Chromium-83-safe — NO Web Animations API), transform +
// opacity ONLY. Authored ONCE by the renderer; the per-zone descriptor drives
// which keyframe + delay/duration each zone uses. Kept here so the engine owns
// the design and surface-css.spec can pin it.
// ---------------------------------------------------------------------------

/** The keyframes block the renderer injects once. Names are namespaced. */
export const ENTRANCE_KEYFRAMES_CSS = `
@keyframes sigd-rise-fade { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sigd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sigd-pop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
@keyframes sigd-float { 0% { transform: translateY(0); } 50% { transform: translateY(-1.4%); } 100% { transform: translateY(0); } }
@keyframes sigd-kenburns { from { transform: scale(1.0); } to { transform: scale(1.06); } }
`.trim();

/** Map an EntranceMotion.kind → the keyframe animation name. */
export function entranceAnimName(kind: string): string | undefined {
  switch (kind) {
    case 'rise-fade':
      return 'sigd-rise-fade';
    case 'fade':
      return 'sigd-fade';
    case 'pop':
      return 'sigd-pop';
    default:
      return undefined;
  }
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
