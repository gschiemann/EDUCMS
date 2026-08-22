/**
 * Public holiday-board source contract.
 *
 * Only ten of the eighteen boards have a dedicated `-portrait.html` asset.
 * The remaining eight have no portrait file. Selecting portrait must reuse
 * the canonical HTML instead of manufacturing a URL that resolves to 404.
 * The explicit orientation query activates responsive canonical boards and
 * is also the migration hook for the legacy Elementary boards while their
 * true portrait compositions move through design review.
 */

export type HolidaySourceVariant =
  | 'christmas'
  | 'easter'
  | 'halloween'
  | 'stpatricks'
  | 'thanksgiving'
  | 'valentines';

export type HolidaySourceGradeLevel = 'es' | 'ms' | 'hs';

/** Bump when any canonical or portrait holiday HTML changes. */
export const HOLIDAY_HTML_CONTENT_VERSION = '20260821-routing-2';

/**
 * Version already carried by every holiday HTML request for the shared style
 * bridge. It is exported so tests keep the static pack and the widget contract
 * in sync instead of allowing an unversioned bridge request to slip in.
 */
export const HOLIDAY_STYLE_BRIDGE_CONTENT_VERSION = '20260821-style-3';
export const HOLIDAY_STYLE_BRIDGE_SOURCE =
  `_style-bridge.js?v=${HOLIDAY_STYLE_BRIDGE_CONTENT_VERSION}`;

export const HOLIDAY_VARIANT_KEYS: readonly HolidaySourceVariant[] = [
  'christmas',
  'easter',
  'halloween',
  'stpatricks',
  'thanksgiving',
  'valentines',
];

export const HOLIDAY_GRADE_LEVEL_KEYS: readonly HolidaySourceGradeLevel[] = [
  'es',
  'ms',
  'hs',
];

/** Dedicated portrait assets that exist under public/holiday-templates. */
export const HOLIDAY_DEDICATED_PORTRAIT_BOARDS: ReadonlySet<string> = new Set([
  'ms-easter',
  'ms-halloween',
  'ms-stpatricks',
  'ms-thanksgiving',
  'ms-valentines',
  'hs-easter',
  'hs-halloween',
  'hs-stpatricks',
  'hs-thanksgiving',
  'hs-valentines',
]);

export interface HolidayTemplateSource {
  /** Browser URL for the iframe. */
  src: string;
  /** Static file selected beneath public/holiday-templates. */
  fileName: string;
  /** True when portrait safely falls back to the canonical board. */
  usesCanonicalPortraitFallback: boolean;
}

export function resolveHolidayTemplateSource({
  variant,
  gradeLevel,
  portrait,
}: {
  variant: HolidaySourceVariant;
  gradeLevel: HolidaySourceGradeLevel;
  portrait: boolean;
}): HolidayTemplateSource {
  const boardKey = `${gradeLevel}-${variant}`;
  const hasDedicatedPortrait =
    portrait && HOLIDAY_DEDICATED_PORTRAIT_BOARDS.has(boardKey);
  const usesCanonicalPortraitFallback = portrait && !hasDedicatedPortrait;
  const fileName = `${boardKey}${hasDedicatedPortrait ? '-portrait' : ''}.html`;
  const params = new URLSearchParams({ v: HOLIDAY_HTML_CONTENT_VERSION });

  // `o=portrait` is understood by the refreshed board runtime. Legacy boards
  // that have not yet been redesigned may still letterbox, but they no longer
  // 404 and will begin using the true portrait composition when promoted.
  if (usesCanonicalPortraitFallback) params.set('o', 'portrait');

  return {
    src: `/holiday-templates/${fileName}?${params.toString()}`,
    fileName,
    usesCanonicalPortraitFallback,
  };
}
