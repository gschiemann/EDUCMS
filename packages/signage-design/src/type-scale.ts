/**
 * @cms/signage-design — TYPE SCALE
 *
 * Sizes are DERIVED, never model-chosen. A modular scale (Perfect Fourth 1.333
 * default) anchored on canvas HEIGHT and scaled by VIEWING DISTANCE produces a
 * coherent hierarchy that is legible at 8-30 ft (R6 §10.A).
 *
 * The numeric laws this file encodes (R6 §10.A):
 *   - Headline cap-height >= 6.5% of canvas height (15-ft default board).
 *   - Body cap-height    >= 3.5% of canvas height.
 *   - Multiply the floors by viewingDistance / 15.
 *   - Headline is 2-3x body.
 *   - Honor the existing auto-fit >= 50px floor.
 *
 * NOTE: we work in FONT SIZE (px), not cap-height. Cap-height is ~0.70 of font
 * size for the signage sans-serifs we ship (Inter/Roboto/Helvetica ~0.70-0.73).
 * So "cap-height >= 6.5% of H" => fontSize >= (0.065 / 0.70) * H. We bake that
 * conversion in so callers think in the published cap-height numbers.
 */

import type { CanvasClass, TypeRole } from './types';

/** Perfect Fourth — the standard signage hierarchy ratio (R3 §2). */
export const PERFECT_FOURTH = 1.333;
export const MAJOR_THIRD = 1.25;
export const GOLDEN_RATIO = 1.618;

/** Cap-height as a fraction of font size for our sans-serif allow-list. */
export const CAP_HEIGHT_RATIO = 0.7;

/** R6 §10.A cap-height floors (fraction of canvas height) at the 15-ft default. */
export const HEADLINE_CAP_FLOOR = 0.065;
export const BODY_CAP_FLOOR = 0.035;

/** The reference distance the published floors are calibrated to (R6 §10.A.2). */
export const REFERENCE_DISTANCE_FT = 15;

/** The hard auto-fit floor (CLAUDE.md / R6) — no text ever renders below this. */
export const MIN_FONT_PX = 50;

/**
 * Where each type role sits on the modular scale, expressed as the number of
 * RATIO STEPS up (+) or down (-) from the body baseline (step 0).
 *
 * With ratio 1.333:  body=1.00, title=1.33, headline=1.78, display=2.37
 * That puts headline at ~1.78x body and display at ~2.37x body — inside the
 * "headline 2-3x body" band once the headline/display roles are used as the
 * dominant element. caption/kicker sit below body.
 */
export const ROLE_STEPS: Record<TypeRole, number> = {
  display: 3,
  headline: 2,
  title: 1,
  body: 0,
  kicker: -1,
  caption: -1,
};

/**
 * The distance multiplier applied to the cap-height floors. A 10-ft board needs
 * smaller minimums than a 30-ft ribbon. Never drops below the 15-ft floor for a
 * passing-by board, so we clamp the LOWER bound at 1.0 only when the caller
 * marks the board passing-by; otherwise we honor closer distances down to ~0.6.
 */
export function distanceMultiplier(viewingDistanceFt: number, passingBy = false): number {
  const raw = viewingDistanceFt / REFERENCE_DISTANCE_FT;
  if (passingBy) return Math.max(1, raw);
  // Closer boards may shrink, but never below 0.6 of the reference floor.
  return Math.max(0.6, raw);
}

/**
 * The body font-size floor in px for a given canvas — the modular-scale anchor.
 * Derived from BODY_CAP_FLOOR (cap-height %) → font size, scaled by distance,
 * floored at MIN_FONT_PX.
 */
export function bodyBasePx(canvas: CanvasClass, passingBy = false): number {
  const mult = distanceMultiplier(canvas.viewingDistanceFt, passingBy);
  const fromCap = (BODY_CAP_FLOOR / CAP_HEIGHT_RATIO) * canvas.h * mult;
  // Coarse-pitch LED bumps the floor (R6 rule 26).
  const ledBump = canvas.coarsePitchLED ? 1.15 : 1;
  return Math.max(MIN_FONT_PX, fromCap * ledBump);
}

/**
 * The headline font-size floor in px — the published 6.5%-cap-height law.
 * The actual rendered headline is max(this floor, scaleStep(headline)).
 */
export function headlineFloorPx(canvas: CanvasClass, passingBy = false): number {
  const mult = distanceMultiplier(canvas.viewingDistanceFt, passingBy);
  const fromCap = (HEADLINE_CAP_FLOOR / CAP_HEIGHT_RATIO) * canvas.h * mult;
  const ledBump = canvas.coarsePitchLED ? 1.15 : 1;
  return Math.max(MIN_FONT_PX, fromCap * ledBump);
}

/**
 * The font size in px for a given type role on a canvas+theme.
 *
 * Algorithm:
 *   1. Anchor on the body floor (bodyBasePx).
 *   2. Walk the modular scale to the role's step.
 *   3. For headline/display, never fall below the published headline floor.
 *   4. Clamp at the 50px auto-fit floor.
 */
export function fontSizeForRole(
  role: TypeRole,
  canvas: CanvasClass,
  ratio: number = PERFECT_FOURTH,
  passingBy = false,
): number {
  const base = bodyBasePx(canvas, passingBy);
  const steps = ROLE_STEPS[role];
  let size = base * Math.pow(ratio, steps);
  if (role === 'headline' || role === 'display') {
    size = Math.max(size, headlineFloorPx(canvas, passingBy));
  }
  return Math.max(MIN_FONT_PX, Math.round(size));
}

/**
 * Compute every role's size in one shot — handy for resolvers/validators.
 */
export function buildTypeScale(
  canvas: CanvasClass,
  ratio: number = PERFECT_FOURTH,
  passingBy = false,
): Record<TypeRole, number> {
  return {
    display: fontSizeForRole('display', canvas, ratio, passingBy),
    headline: fontSizeForRole('headline', canvas, ratio, passingBy),
    title: fontSizeForRole('title', canvas, ratio, passingBy),
    body: fontSizeForRole('body', canvas, ratio, passingBy),
    kicker: fontSizeForRole('kicker', canvas, ratio, passingBy),
    caption: fontSizeForRole('caption', canvas, ratio, passingBy),
  };
}

/**
 * Headline-to-body ratio for a given scale — used by the validator to enforce
 * the "headline is 2-3x body" law. Returns the ratio of the dominant text role
 * (whichever of display/headline is used) over body.
 */
export function headlineToBodyRatio(
  dominantRole: TypeRole,
  canvas: CanvasClass,
  ratio: number = PERFECT_FOURTH,
  passingBy = false,
): number {
  const dom = fontSizeForRole(dominantRole, canvas, ratio, passingBy);
  const body = fontSizeForRole('body', canvas, ratio, passingBy);
  return dom / body;
}

/**
 * Cap-height (px) of a rendered font size — used to verify the published
 * %-of-canvas-height law in tests + the validator.
 */
export function capHeightPx(fontSizePx: number): number {
  return fontSizePx * CAP_HEIGHT_RATIO;
}

/** Cap-height as a fraction of canvas height. */
export function capHeightFraction(fontSizePx: number, canvas: CanvasClass): number {
  return capHeightPx(fontSizePx) / canvas.h;
}
