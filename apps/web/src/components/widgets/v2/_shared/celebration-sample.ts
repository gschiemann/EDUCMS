/**
 * Celebration fields nobody filled in (K-12 sports launch, lane B3, leftover a
 * — 2026-09-27).
 *
 * The 76 celebration scenes fall back to a sample for every field the operator
 * has not filled — "PLAYER", "SCORER", "7 TONIGHT", "21-14", "67 YD". That is
 * right in the BUILDER (a tile must never be blank; B2 made the samples
 * school-safe), and wrong on a REAL screen: a school's stadium board read
 * "PLAYER · +6 · 67 YD · 21-14" for a touchdown nobody described — a role
 * word where a name goes and numbers nobody entered.
 *
 * The rule, the same one the venue pack's SAMPLE stamp follows:
 *   • builder (the default surface) — a field with no value shows its sample;
 *   • real screen (`RenderSurfaceProvider surface="player"`: the player, the
 *     public /board and /ribbon pages) — a field with no value is BLANK, and
 *     the line that only exists to show it is not rendered at all.
 * A role word the pack used to SEED into a zone's saved config ("PLAYER",
 * "SCORER", …) counts as "no value" on a real screen: no school names a
 * student "SCORER". A saved NUMBER is never second-guessed — an operator's
 * "7 threes tonight" is indistinguishable from the old seed, and hiding a real
 * value is the worse failure (#295).
 * An explicit empty string stays empty on both surfaces (the operator cleared
 * it on purpose).
 */
import { useRenderSurface } from '../../render-surface';

/** Role words the pack seeded as the "who" of a celebration. */
export const CELEBRATION_ROLE_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'PLAYER',
  'SCORER',
  'SHOOTER',
  'WINNER',
  'ATHLETE',
  'PITCHER',
  'GOALIE',
  'WRESTLER',
  'RUNNER',
  'PASSER',
  'KICKER',
  'HOME TEAM',
]);

/** What a sampled field reads as on a real screen with nothing filled in. */
export type Sampled<T> = T extends readonly unknown[] ? T : T | '';

export type SampleFn = <T>(value: unknown, fallback: T) => Sampled<T>;

/** The pure rule (tests + non-React callers). */
export function sampleFor(realScreen: boolean): SampleFn {
  return <T,>(value: unknown, fallback: T): Sampled<T> => {
    if (value === undefined || value === null) {
      if (!realScreen) return fallback as Sampled<T>;
      return (Array.isArray(fallback) ? [] : '') as Sampled<T>;
    }
    if (realScreen && typeof value === 'string' && CELEBRATION_ROLE_PLACEHOLDERS.has(value.trim().toUpperCase())) {
      return '' as Sampled<T>;
    }
    return value as Sampled<T>;
  };
}

/** `sample(c.player, 'PLAYER')` — the field's value, its builder sample, or blank on a real screen. */
export function useCelebrationSample(): SampleFn {
  return sampleFor(useRenderSurface() === 'player');
}

/** Render a line only when its value is there (a blank field hides its whole line). */
export function has(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * A detail line built from several fields ("HOLE 5 · 452 YD"): the filled
 * parts joined with " · ", or '' when none is filled — never a separator or a
 * unit with nothing next to it.
 */
export function joinParts(...parts: unknown[]): string {
  return parts
    .filter(has)
    .map((p) => String(p))
    .join(' · ');
}

/** `withUnit(5, 'HOLE ')` → "HOLE 5"; a blank value → '' (for joinParts). */
export function withUnit(value: unknown, before = '', after = ''): string {
  return has(value) ? `${before}${String(value)}${after}` : '';
}
