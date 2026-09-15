/**
 * A template must STATE its own background.
 *
 * The surfaces that draw a template disagree about what "no background"
 * looks like, and each of them is right for its own reasons:
 *
 *   BuilderCanvas.tsx : `meta.bgColor || '#ffffff'`  — you design on paper.
 *   templates/page.tsx: `t.bgColor  || '#ffffff'`    — the gallery card matches.
 *   player/page.tsx   : `tpl.bgColor || '#000000'`   — an unlit LED pixel is
 *                        black, and white bars around a contained template
 *                        would glare on a wall. That line also sits inside the
 *                        block that survived the 2026-05-13 Taurus incident,
 *                        where a screen went pure black because the wrapper
 *                        painted nothing at all.
 *
 * So the bug was never which fallback is correct. It was that a row could
 * leave the question open: `Template.bgColor` is nullable, and an operator who
 * made a blank template, put dark text on the white canvas they were looking
 * at, and never opened the Background panel got a board that read correctly in
 * the editor and in the gallery and rendered that text on black on the glass.
 *
 * The fix is to stop asking. Every write normalises a row that would declare
 * NO background at all — no colour, no gradient, no image — to an explicit
 * colour, so the fallbacks stay exactly as they are and simply stop being
 * reachable for anything new. Measured before choosing this: 3 of 588
 * production templates had no background, all three operator-made test rows
 * with no text zones, and 0 of the 459 system presets. A latent trap, not a
 * live one — which is why this is a write-time rule and not a migration.
 */

/**
 * What a template gets when it declares no background of any kind: the
 * colour the operator was already looking at while they designed it.
 */
export const TEMPLATE_DEFAULT_BG = '#ffffff';

/** The three fields that can state a template's background. */
export interface TemplateBackgroundLike {
  bgColor?: string | null;
  bgImage?: string | null;
  bgGradient?: string | null;
}

/** True when nothing on the row says what is behind the zones. */
export function statesNoBackground(row: TemplateBackgroundLike): boolean {
  return !row.bgColor && !row.bgImage && !row.bgGradient;
}

/**
 * The background colour to persist, given what the row would end up with and
 * an optional brand surface to prefer. Returns `undefined` when the row
 * already states a background and needs no help — callers should leave their
 * own values alone in that case rather than writing this one.
 */
export function backgroundToPersist(
  row: TemplateBackgroundLike,
  brandSurface?: string | null,
): string | undefined {
  if (!statesNoBackground(row)) return undefined;
  return brandSurface || TEMPLATE_DEFAULT_BG;
}
