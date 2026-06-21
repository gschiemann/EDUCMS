/**
 * Plain-language sponsor frequency mappings (item G, 2026-06-16).
 *
 * The operator complaint: "rotation weight 5 / 2 / 10" is meaningless to a
 * normal person, and "max per hour: uncapped" is a raw number textbox. These
 * helpers translate the underlying numeric fields the API already stores —
 * `weight` (1–10) and `frequencyCapPerHour` — into plain choices, with the
 * NUMERIC FIELD remaining the single source of truth (the adversarial critique:
 * don't introduce a second representation that can drift out of sync). The UI
 * picks a choice → we derive the number; the number maps back to the choice.
 */

// ── How often a sponsor appears (maps to `weight`) ─────────────────
export type FreqTier = 'occasional' | 'normal' | 'often';

export const FREQ_TIER_WEIGHT: Record<FreqTier, number> = {
  occasional: 2,
  normal: 4,
  often: 8,
};

export const FREQ_TIERS: { value: FreqTier; label: string; help: string }[] = [
  { value: 'occasional', label: 'Occasionally', help: 'Comes around less often' },
  { value: 'normal', label: 'Normal', help: 'Even rotation with the others' },
  { value: 'often', label: 'Often', help: 'Show this brand extra — a star sponsor' },
];

/** Bucket a stored weight (1–10) back into the plain tier the operator sees. */
export function weightToTier(w: number | null | undefined): FreqTier {
  const n = Number(w) || 0;
  if (n >= 6) return 'often';
  if (n <= 2) return 'occasional';
  return 'normal';
}

// ── "Don't show more than ___" cap (maps to `frequencyCapPerHour`) ──
// null = no limit (uncapped). 12/hr = once every 5 min, 6 = 10 min, etc.
export interface CapPreset {
  label: string;
  perHour: number | null;
}
export const CAP_PRESETS: CapPreset[] = [
  { label: 'No limit', perHour: null },
  { label: 'Once every 5 min', perHour: 12 },
  { label: 'Once every 10 min', perHour: 6 },
  { label: 'Once every 15 min', perHour: 4 },
  { label: 'Once every 30 min', perHour: 2 },
];

/** Render a stored cap (per-hour) as the dropdown label; a value that isn't a
 *  preset shows as an explicit custom label so nothing is silently lost. */
export function capLabel(perHour: number | null | undefined): string {
  if (perHour == null) return 'No limit';
  const hit = CAP_PRESETS.find((p) => p.perHour === perHour);
  if (hit) return hit.label;
  const everyMin = Math.round(60 / Math.max(1, perHour));
  return `Once every ${everyMin} min`;
}
