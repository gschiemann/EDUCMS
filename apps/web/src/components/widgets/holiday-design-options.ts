/**
 * Multiple approved DESIGNS for one holiday board.
 *
 * A holiday board is addressed by variant + grade level (`es-halloween`), which
 * assumes exactly one design per holiday. Design review can approve several —
 * the 2026-08-21 elementary Halloween round shipped three — so a board key can
 * now carry a list of alternates that an operator picks between.
 *
 * Kept deliberately separate from holiday-source-contract.ts: that module owns
 * the canonical variant x grade x portrait routing for all eighteen boards, and
 * this one only adds opt-in alternates on top. A zone with no `design` set
 * resolves exactly as before, so every saved template keeps its board.
 */
import {
  HOLIDAY_HTML_CONTENT_VERSION,
  type HolidaySourceGradeLevel,
  type HolidaySourceVariant,
} from './holiday-source-contract';

export interface HolidayDesignOption {
  /** Stored in zone config as `design`. */
  key: string;
  /** Operator-facing name, as approved in design review. */
  label: string;
  /** File beneath public/holiday-templates, without the extension. */
  file: string;
}

/**
 * Keyed `${gradeLevel}-${variant}`. Order is the order design review presented
 * them, which is the order the editor should offer.
 */
export const HOLIDAY_DESIGN_OPTIONS: Readonly<Record<string, readonly HolidayDesignOption[]>> = {
  'es-halloween': [
    { key: 'moonlight', label: 'Friendly Moonlight', file: 'es-halloween-moonlight' },
    { key: 'parade', label: 'Costume Parade', file: 'es-halloween-parade' },
    { key: 'storybook', label: 'Storybook Night', file: 'es-halloween-storybook' },
  ],
  'ms-halloween': [
    { key: 'neon-circuit', label: 'Neon Circuit', file: 'ms-halloween-neon-circuit' },
    { key: 'spirit-zine', label: 'Spirit Zine', file: 'ms-halloween-spirit-zine' },
    { key: 'midnight-broadcast', label: 'Midnight Broadcast', file: 'ms-halloween-midnight-broadcast' },
  ],
};

export function holidayDesignsFor(
  variant: HolidaySourceVariant | string,
  gradeLevel: HolidaySourceGradeLevel | string,
): readonly HolidayDesignOption[] {
  return HOLIDAY_DESIGN_OPTIONS[`${gradeLevel}-${variant}`] ?? [];
}

/**
 * The board URL for an explicitly chosen design, or null when the zone has no
 * design set (or names one that no longer exists — a removed design must fall
 * back to the canonical board rather than 404 a live screen).
 */
export function resolveHolidayDesignSource({
  variant,
  gradeLevel,
  design,
  portrait,
}: {
  variant: HolidaySourceVariant | string;
  gradeLevel: HolidaySourceGradeLevel | string;
  design?: string | null;
  portrait: boolean;
}): string | null {
  if (!design) return null;
  const option = holidayDesignsFor(variant, gradeLevel).find((o) => o.key === design);
  if (!option) return null;
  const params = new URLSearchParams({ v: HOLIDAY_HTML_CONTENT_VERSION });
  // These boards author both orientations in one file and switch on `o`.
  if (portrait) params.set('o', 'portrait');
  return `/holiday-templates/${option.file}.html?${params.toString()}`;
}
