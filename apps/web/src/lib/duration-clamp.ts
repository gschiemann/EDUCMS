/**
 * Item durations run from 1 to 600 seconds (below 1 s flickers; above 600 s
 * is almost certainly a typo, and the editor caps there too).
 *
 * Muse beta DEV-026 (2026-10-07): the playlist wizard clamped silently — type
 * 900 and it quietly became 600. This reports WHETHER it clamped so the UI
 * can say so.
 */
export const MIN_ITEM_SECONDS = 1;
export const MAX_ITEM_SECONDS = 600;
export const DEFAULT_ITEM_SECONDS = 10;

export function clampItemSeconds(raw: number): { seconds: number; clamped: 'low' | 'high' | null } {
  if (!Number.isFinite(raw)) return { seconds: DEFAULT_ITEM_SECONDS, clamped: null };
  if (raw < MIN_ITEM_SECONDS) return { seconds: MIN_ITEM_SECONDS, clamped: 'low' };
  if (raw > MAX_ITEM_SECONDS) return { seconds: MAX_ITEM_SECONDS, clamped: 'high' };
  return { seconds: raw, clamped: null };
}
