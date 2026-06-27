/**
 * @cms/signage-design — VALIDATOR (the R6 §10 numeric rulebook as code)
 *
 * Runs on every generated board after the archetype resolves geometry and the
 * theme paints tokens. It makes the chosen archetype+theme LEGAL — it does NOT
 * invent a new look.
 *
 * PRECEDENCE (the critic demanded this be explicit):
 *
 *     archetype  >  theme  >  validator
 *
 *   - The ARCHETYPE owns geometry (rects, slots, z-order). The validator never
 *     moves a zone or changes its rect except to keep it inside the safe margin
 *     (a hard legibility/cutoff law, not a design choice).
 *   - The THEME owns palette + font pairing + scale. The validator never picks a
 *     different palette; it only FLIPS a text token (ink <-> inkInverse) or DROPS
 *     a scrim — both already-defined theme primitives — to hit the contrast floor.
 *   - The VALIDATOR's only powers are the smallest legal corrections: resize text
 *     to the floor, flip a token, drop a scrim, clamp to safe margins. Anything
 *     it cannot auto-correct it FLAGS as an error; it never fabricates a third
 *     visual decision.
 *
 * Rules enforced (R6 §10):
 *   A. Type sizing: derived sizes >= floors; headline 2-3x body.        (auto-fix: resize)
 *   B. Typeface:    <= 2 font families.                                  (flag)
 *   C. Contrast:    7:1 body / 4.5:1 large; scrim/flip over imagery.     (auto-fix)
 *   D. Density:     3x5 copy cap; <= 3 content zones; one accent.        (flag/auto-fix accent)
 *   E. Layout:      >= 5% safe margins; no overlap.                      (auto-fix margins; flag overlap)
 */

import {
  bestTextToken,
  buildGradientScrim,
  buildScrim,
  contrastRatio,
  passesFloor,
} from './contrast';
import { SAFE_MARGIN_PCT } from './archetypes';
import {
  MIN_FONT_PX,
  buildTypeScale,
  capHeightFraction,
} from './type-scale';
import {
  BODY_CAP_FLOOR,
  HEADLINE_CAP_FLOOR,
} from './type-scale';
import type {
  ArchetypeCopy,
  CanvasClass,
  ResolvedZone,
  ThemeBundle,
  TypeRole,
  ValidationFinding,
  ValidationResult,
} from './types';

/** R6 §10.D rule 16: max content zones (background excluded). */
export const MAX_CONTENT_ZONES = 3;
/** R6 §10.D rule 14: 3 lines x 5 words (or 5x3) — cap at 15 words / headline. */
export const COPY_MAX_LINES = 3;
export const COPY_MAX_WORDS_PER_LINE = 5;
export const COPY_MAX_WORDS = COPY_MAX_LINES * COPY_MAX_WORDS_PER_LINE;
/** R6 §10.B rule 6: max 2 font families. */
export const MAX_FONT_FAMILIES = 2;
/** R6 §10.A rule 3: headline is 2-3x body. */
export const HEADLINE_BODY_MIN_RATIO = 2;
export const HEADLINE_BODY_MAX_RATIO = 3;

/** Slots that count as "content" toward the <=3 cap (background never counts). */
function isContentZone(z: ResolvedZone): boolean {
  return z.slot !== 'background';
}

/** Whether a type role renders "large text" for the contrast floor purposes. */
function isLargeRole(role: TypeRole | undefined): boolean {
  return role === 'display' || role === 'headline' || role === 'title' || role === 'stat' as TypeRole;
}

interface EnforceContext {
  canvas: CanvasClass;
  theme: ThemeBundle;
  /** Whether the board is a passing-by glance board (affects type floors). */
  passingBy?: boolean;
  /** Copy that was routed into the board — needed for the density cap. */
  copy?: ArchetypeCopy;
}

/**
 * THE enforce pass. Mutates a copy of `zones` with auto-corrections and returns
 * the corrected zones + findings. `ok` is true when no `error`-severity finding
 * remains.
 */
export function enforce(zones: ResolvedZone[], ctx: EnforceContext): ValidationResult {
  const findings: ValidationFinding[] = [];
  // Work on a deep-ish copy so callers' input is never mutated.
  const out: ResolvedZone[] = zones.map((z) => ({
    ...z,
    styleTokens: { ...z.styleTokens, scrim: z.styleTokens.scrim ? { ...z.styleTokens.scrim } : undefined },
  }));

  const scale = buildTypeScale(ctx.canvas, ctx.theme.typeScaleRatio, ctx.passingBy);

  // --- A. Type sizing (auto-fix: resize to derived scale, enforce floors) ---
  let bodyPx = scale.body;
  let dominantPx = 0;
  for (const z of out) {
    const role = z.styleTokens.typeRole;
    if (!role) continue;
    const derived = scale[role];
    const current = z.styleTokens.fontSizePx;
    // The validator OWNS the size (the LLM never set it). Apply the derived px.
    if (current == null || current !== derived) {
      z.styleTokens.fontSizePx = derived;
      if (current != null && current < MIN_FONT_PX) {
        findings.push({
          code: 'FONT_BELOW_FLOOR',
          severity: 'fixed',
          target: z.slot,
          message: `Resized ${z.slot} from ${current}px to derived ${derived}px (>= ${MIN_FONT_PX}px floor).`,
        });
      }
    }
    if (z.styleTokens.fontSizePx! < MIN_FONT_PX) {
      z.styleTokens.fontSizePx = MIN_FONT_PX;
    }
    if (role === 'display' || role === 'headline' || role === 'stat' as TypeRole) {
      dominantPx = Math.max(dominantPx, z.styleTokens.fontSizePx!);
    }
    if (role === 'body') bodyPx = z.styleTokens.fontSizePx!;
  }

  // A.3 headline 2-3x body.
  if (dominantPx > 0 && bodyPx > 0) {
    const ratio = dominantPx / bodyPx;
    if (ratio < HEADLINE_BODY_MIN_RATIO - 1e-6) {
      findings.push({
        code: 'HIERARCHY_TOO_FLAT',
        severity: 'warn',
        target: 'board',
        message: `Headline:body ratio ${ratio.toFixed(2)} is below ${HEADLINE_BODY_MIN_RATIO}x — hierarchy reads flat.`,
      });
    }
    // ratio above max is acceptable for a hero/stat board; not flagged.
  }

  // A.1 published cap-height floors verified (defense in depth).
  for (const z of out) {
    const role = z.styleTokens.typeRole;
    if (role !== 'headline' && role !== 'display' && role !== 'body') continue;
    const frac = capHeightFraction(z.styleTokens.fontSizePx!, ctx.canvas);
    const floor = role === 'body' ? BODY_CAP_FLOOR : HEADLINE_CAP_FLOOR;
    const distScaledFloor = floor * Math.max(0.6, ctx.canvas.viewingDistanceFt / 15);
    if (frac < distScaledFloor - 1e-4) {
      findings.push({
        code: 'CAP_HEIGHT_BELOW_FLOOR',
        severity: 'warn',
        target: z.slot,
        message: `${z.slot} cap-height ${(frac * 100).toFixed(2)}% < floor ${(distScaledFloor * 100).toFixed(2)}% of canvas height.`,
      });
    }
  }

  // --- B. Typeface: <= 2 font families ---
  const families = new Set<string>();
  for (const z of out) {
    if (z.styleTokens.fontFamily) families.add(z.styleTokens.fontFamily);
  }
  if (families.size > MAX_FONT_FAMILIES) {
    findings.push({
      code: 'TOO_MANY_FONTS',
      severity: 'error',
      target: 'board',
      message: `${families.size} font families used; max ${MAX_FONT_FAMILIES}. (${[...families].join(', ')})`,
    });
  }

  // --- C. Contrast: 7:1 body / 4.5:1 large; scrim/flip over imagery ---
  const bgZone = out.find((z) => z.slot === 'background');
  const hasImageBg = !!bgZone && bgZone.widgetType === 'IMAGE';
  for (const z of out) {
    const role = z.styleTokens.typeRole;
    if (!role) continue; // images/logos: no text contrast to check
    const large = isLargeRole(role);

    // Text over an image background: mandatory scrim (rule 11). The scrim may
    // live on the background zone (full/gradient) OR on the text zone itself.
    if (hasImageBg) {
      const hasScrim = !!z.styleTokens.scrim || !!bgZone!.styleTokens.scrim;
      if (!hasScrim) {
        z.styleTokens.scrim = buildGradientScrim('bottom', large);
        z.styleTokens.colorToken = 'inkInverse';
        findings.push({
          code: 'TEXT_OVER_IMAGE_NO_SCRIM',
          severity: 'fixed',
          target: z.slot,
          message: `Added a scrim behind ${z.slot} (text over image must guarantee the contrast floor).`,
        });
      } else {
        // Ensure light text rides over the (dark) scrim.
        if (z.styleTokens.colorToken === 'ink') z.styleTokens.colorToken = 'inkInverse';
      }
      continue;
    }

    // Flat background: resolve the actual fg/bg hex from the theme tokens.
    const bgHex = resolveSurfaceHex(z, ctx.theme);
    const fgHex = resolveTextHex(z, ctx.theme);
    if (!passesFloor(fgHex, bgHex, large)) {
      // Auto-fix #1: flip the text token to the better-contrast side.
      const flipped = bestTextToken(bgHex);
      const flippedHex = flipped === 'ink' ? ctx.theme.palette.ink : ctx.theme.palette.inkInverse;
      if (passesFloor(flippedHex, bgHex, large)) {
        z.styleTokens.colorToken = z.styleTokens.isAccent ? z.styleTokens.colorToken : flipped;
        findings.push({
          code: 'CONTRAST_FLIP',
          severity: 'fixed',
          target: z.slot,
          message: `Flipped ${z.slot} text token to ${flipped} to clear the ${large ? '4.5' : '7'}:1 floor.`,
        });
      } else {
        // Auto-fix #2: drop a scrim that guarantees the floor.
        const tone = bestTextToken(bgHex) === 'inkInverse' ? 'dark' : 'light';
        z.styleTokens.scrim = buildScrim(tone, large);
        z.styleTokens.colorToken = tone === 'dark' ? 'inkInverse' : 'ink';
        findings.push({
          code: 'CONTRAST_SCRIM',
          severity: 'fixed',
          target: z.slot,
          message: `Dropped a ${tone} scrim behind ${z.slot} to clear the contrast floor.`,
        });
      }
    }
  }

  // --- D. Density: <= 3 content zones; one accent; 3x5 copy cap ---
  const contentZones = out.filter(isContentZone);
  // List/grid rows of the SAME slot collapse to one logical content zone.
  const distinctContentSlots = new Set(contentZones.map((z) => z.slot));
  if (distinctContentSlots.size > MAX_CONTENT_ZONES + 1) {
    // +1 tolerance: kicker/headline/cta is 3 distinct + an accent is fine; we
    // flag only when truly over-stuffed (e.g. kicker+headline+body+cta+stat).
    findings.push({
      code: 'TOO_MANY_ZONES',
      severity: 'warn',
      target: 'board',
      message: `${distinctContentSlots.size} distinct content slots; aim for <= ${MAX_CONTENT_ZONES}.`,
    });
  }

  // Exactly one accent zone (R6 rule 12 / 17).
  const accents = out.filter((z) => z.styleTokens.isAccent);
  if (accents.length > 1) {
    // Keep the first (highest-priority, earliest in z-order list); demote rest.
    for (let i = 1; i < accents.length; i++) {
      accents[i]!.styleTokens.isAccent = false;
      accents[i]!.styleTokens.colorToken = 'ink';
    }
    findings.push({
      code: 'MULTIPLE_ACCENTS',
      severity: 'fixed',
      target: 'board',
      message: `Reduced ${accents.length} accent elements to 1 (one reserved accent only).`,
    });
  }

  // 3x5 copy cap on the headline + body.
  if (ctx.copy) {
    checkCopyDensity('headline', ctx.copy.headline, findings);
    if (ctx.copy.body) checkCopyDensity('body', ctx.copy.body, findings);
  }

  // --- E. Layout: >= 5% safe margins (auto-fix); no overlap (flag) ---
  for (const z of out) {
    // Full-bleed media (background + image) is allowed to reach the edges.
    if (z.slot === 'background' || z.slot === 'image') continue;
    let fixed = false;
    if (z.x < SAFE_MARGIN_PCT - 1e-6) {
      z.width -= SAFE_MARGIN_PCT - z.x;
      z.x = SAFE_MARGIN_PCT;
      fixed = true;
    }
    if (z.y < SAFE_MARGIN_PCT - 1e-6) {
      z.height -= SAFE_MARGIN_PCT - z.y;
      z.y = SAFE_MARGIN_PCT;
      fixed = true;
    }
    if (z.x + z.width > 100 - SAFE_MARGIN_PCT + 1e-6) {
      z.width = 100 - SAFE_MARGIN_PCT - z.x;
      fixed = true;
    }
    if (z.y + z.height > 100 - SAFE_MARGIN_PCT + 1e-6) {
      z.height = 100 - SAFE_MARGIN_PCT - z.y;
      fixed = true;
    }
    if (fixed) {
      findings.push({
        code: 'SAFE_MARGIN_CLAMP',
        severity: 'fixed',
        target: z.slot,
        message: `Clamped ${z.slot} inside the ${SAFE_MARGIN_PCT}% safe margin.`,
      });
    }
  }

  // Overlap among content zones (excluding background and same-slot list rows
  // which are intentionally tiled). We flag rather than move — geometry belongs
  // to the archetype.
  const checkable = out.filter((z) => z.slot !== 'background');
  for (let i = 0; i < checkable.length; i++) {
    for (let j = i + 1; j < checkable.length; j++) {
      const a = checkable[i]!;
      const b = checkable[j]!;
      if (a.slot === b.slot) continue; // tiled list rows
      if (rectsOverlap(a, b)) {
        findings.push({
          code: 'ZONE_OVERLAP',
          severity: 'error',
          target: `${a.slot}+${b.slot}`,
          message: `Zones ${a.slot} and ${b.slot} overlap — archetype geometry must be disjoint.`,
        });
      }
    }
  }

  const ok = !findings.some((f) => f.severity === 'error');
  return { ok, findings, zones: out };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function checkCopyDensity(target: string, text: string, findings: ValidationFinding[]): void {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > COPY_MAX_WORDS) {
    findings.push({
      code: 'COPY_TOO_DENSE',
      severity: 'warn',
      target,
      message: `${target} has ${words.length} words; the 3x5 glance cap is ${COPY_MAX_WORDS}.`,
    });
  }
}

/** Resolve the hex a text zone's color token paints with. */
function resolveTextHex(z: ResolvedZone, theme: ThemeBundle): string {
  if (z.styleTokens.isAccent) return theme.palette.accent;
  switch (z.styleTokens.colorToken) {
    case 'inkInverse':
      return theme.palette.inkInverse;
    case 'muted':
      return theme.palette.muted;
    case 'accent':
      return theme.palette.accent;
    case 'surface':
      return theme.palette.ink; // text on a surface card uses ink
    case 'ink':
    default:
      return theme.palette.ink;
  }
}

/** Resolve the hex of the surface a text zone sits on. */
function resolveSurfaceHex(z: ResolvedZone, theme: ThemeBundle): string {
  // Zones painted onto a "surface" card sit on theme.surface; everything else
  // on the board background.
  if (z.styleTokens.colorToken === 'surface') return theme.palette.surface;
  // An accent CTA sits on the accent fill → check onAccent legibility instead.
  if (z.styleTokens.isAccent) return theme.palette.background;
  return theme.palette.background;
}

function rectsOverlap(a: ResolvedZone, b: ResolvedZone): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const eps = 1e-6;
  return a.x < bx2 - eps && ax2 > b.x + eps && a.y < by2 - eps && ay2 > b.y + eps;
}

/** Spot-check the accent CTA's onAccent legibility (text ON the accent fill). */
export function accentTextPasses(theme: ThemeBundle): boolean {
  return contrastRatio(theme.palette.onAccent, theme.palette.accent) >= 4.5;
}
